// app/utils/metric/metricDeepLink.ts
// 拓扑 → 指标页的**深链身份解析**（纯函数）：`NMCPS-DESIGN-001` §6.15。
//
// 两个域的记录标识**不是同一个键**，这里如实分开，不做「看起来像就当成同一个」的拼接：
//   · 拓扑节点 id 是**管理 IP**（`shared/types/topology.ts` 实测），链路上只有两端的 IP；
//   · `/metric/device` 的 `?id` 是 `device_code`，`/metric/link` 的 `?id` 是 `link_id`
//     （`device_code:iface--device_code:iface`）。
// 因此深链带的是**拓扑侧真有**的身份（管理 IP），目标页用自己已经取到的台账把它解析成自己的
// 记录标识，再走 `useRecordSelection` 写 `?id`：
//   · 设备页：`/metric/device` 的每行都带 `mgmt_ip` ⇒ 直接按 IP 命中；
//   · 链路页：链路没有 `mgmt_ip`，但页面本来就取了一份 `/metric/device` 建
//     `device_code → mgmt_ip` 索引（§6.6）⇒ 用两端的 IP 反查 `device_code` 再命中。
//
// 命中不了（该设备 / 该链路不在**当前页**台账里）时不再直接放弃：台账一页 15 条，而现网 36 台设备 /
// 48 条链路，深链目标落在第 2 页以后是常态 —— 目标不在第一页就不给选，等于「点了『遥测』什么都没选中」。
// 因此由 `resolveDeepLink()` 接管这一步：**只由深链触发**、有页数上限、命中后页面切到那一页再写 `?id`。
// `?id` 本身仍然不参与请求键、也永不触发扫描（`NMCPS-ARCH-006` §5.2 的规则原样保留）。
import type { MetricDeviceRow, MetricLinkRow } from "./metricLedger";

/** 设备页深链的查询键（管理 IP；与 `?id` 并存，命中后由页面收敛成 `?id`） */
export const DEVICE_DEEP_LINK_KEY = "mgmt_ip";
/** 链路页深链的查询键（两端管理 IP） */
export const LINK_SOURCE_DEEP_LINK_KEY = "source_ip";
export const LINK_TARGET_DEEP_LINK_KEY = "target_ip";

/** 页面跳转目标（`navigateTo()` 直接吃这个形状） */
export interface MetricsDeepLink {
	path: string
	query: Record<string, string>
}

/** 未入参时的两条路由（词表只在这里出现一次，页面不各写一份字符串） */
export const DEVICE_METRICS_PATH = "/topology/device-metrics";
export const LINK_METRICS_PATH = "/topology/link-metrics";

/** 设备详情 → 设备指标页：带上该节点的管理 IP（空串 ⇒ 不带查询，落在台账首页） */
export function deviceMetricsDeepLink(mgmtIp: string | null | undefined): MetricsDeepLink {
	const ip = (mgmtIp ?? "").trim();
	return {
		path: DEVICE_METRICS_PATH,
		query: ip ? { [DEVICE_DEEP_LINK_KEY]: ip } : {}
	};
}

/** 链路详情 → 链路指标页：带上两端的节点 id（画布节点 id 就是管理 IP） */
export function linkMetricsDeepLink(
	sourceIp: string | null | undefined,
	targetIp: string | null | undefined
): MetricsDeepLink {
	const source = (sourceIp ?? "").trim();
	const target = (targetIp ?? "").trim();
	const query: Record<string, string> = {};
	if (source)
		query[LINK_SOURCE_DEEP_LINK_KEY] = source;
	if (target)
		query[LINK_TARGET_DEEP_LINK_KEY] = target;
	return { path: LINK_METRICS_PATH, query };
}

/**
 * 深链解析允许扫描的**页数上限**（含第 1 页）。
 *
 * 台账一页 15 条（`shared/constants/paging`）：现网 36 台设备 = 3 页、48 条链路 = 4 页，
 * 20 页 = 300 条已经比台账规模大一个量级。上限的作用不是省流量，而是让「扫不到」有一个
 * 确定的终点 —— 没有上限的扫描在下游把 `total` 报大时会变成一直翻页。
 */
export const DEEP_LINK_MAX_PAGES = 20;

/** 深链解析结果：命中的**页码**与该页上的记录标识 */
export interface DeepLinkHit {
	page: number
	id: string
}

/**
 * 深链解析：先看**当前页**，再按页扫描（上限 `maxPages`）。
 *
 * `NMCPS-ARCH-006` §5.2 禁止的是「`?id` 不在当前行就静默翻页」—— 那会让筛选状态与 URL 悄悄分叉，
 * 用户并不知道自己看的是第几页的结果。深链是另一件事：用户**带着一个明确目标**进来的，
 * 目标不在第一页时不给翻页，等于「点了『遥测』什么都没选中」。因此放行条件收紧成三条：
 *   ① 只由深链触发（`?mgmt_ip` / `?source_ip&target_ip`），`?id` 永远不触发扫描；
 *   ② 扫描有上限（`DEEP_LINK_MAX_PAGES`），命中即停；
 *   ③ 命中后页面**切到那一页**再写 `?id` —— 选中的行一定在左栏里，URL 与所见仍然一致。
 * 找不到就返回 `null`，页面保持默认选中（不静默停在一个与原目标无关的页上）。
 *
 * `loadPage` 返回 `null`（请求失败）即视为停止：失败不该继续往后扫，那只是在放大器上再加一级。
 */
export async function resolveDeepLink<T>(
	loadPage: (page: number) => Promise<readonly T[] | null>,
	pick: (rows: readonly T[]) => string | null,
	options: { firstPage?: readonly T[], maxPages?: number } = {}
): Promise<DeepLinkHit | null> {
	const maxPages = options.maxPages ?? DEEP_LINK_MAX_PAGES;
	const firstPage = options.firstPage;

	if (firstPage && firstPage.length > 0) {
		const id = pick(firstPage);
		if (id)
			return { page: 1, id };
	}

	// 当前页已经取过就不重复请求；否则从第 1 页开始扫
	for (let page = firstPage ? 2 : 1; page <= maxPages; page++) {
		const rows = await loadPage(page);
		if (!rows || rows.length === 0)
			return null;

		const id = pick(rows);
		if (id)
			return { page, id };
	}

	return null;
}

/** 管理 IP → `device_code`（命中返回台账的 `?id`；命中不了返回 `null`） */
export function deviceIdByMgmtIp(
	rows: readonly MetricDeviceRow[],
	mgmtIp: string | null | undefined
): string | null {
	const ip = (mgmtIp ?? "").trim();
	if (!ip)
		return null;
	const hit = rows.find((row) => row.mgmtIp.trim() === ip);
	return hit ? hit.id : null;
}

/**
 * 两端管理 IP → `link_id`。
 *
 * 方向不敏感：链路台账的 source / target 是**发现顺序**，不是方向语义，拓扑那边也一样；
 * 只按同一方向匹配会让一半链路「点了没反应」。
 */
export function linkIdByEndpoints(
	rows: readonly MetricLinkRow[],
	ipIndex: ReadonlyMap<string, string>,
	sourceIp: string | null | undefined,
	targetIp: string | null | undefined
): string | null {
	const source = (sourceIp ?? "").trim();
	const target = (targetIp ?? "").trim();
	if (!source || !target)
		return null;

	for (const row of rows) {
		const from = ipIndex.get(row.sourceCode) ?? "";
		const to = ipIndex.get(row.targetCode) ?? "";
		if ((from === source && to === target) || (from === target && to === source))
			return row.id;
	}

	return null;
}
