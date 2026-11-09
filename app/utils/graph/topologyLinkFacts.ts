// app/utils/graph/topologyLinkFacts.ts
// 拓扑**链路事实读表**（纯函数，零 I/O、零状态）。
//
// 设计基准：`NMCPS-DESIGN-001` §6.11（2026-11-07 对现网 36 节点 / 48 链路逐字段取证）与
// `NMCPS-CONTRACT-002` §6.3（缺省即未知，不补 0）。两条口径与节点事实层（`topologyNodeFacts.ts`）刻意不同：
//
//   ① 利用率 / 丢包 / 误码这四项**只在 `> 0` 时才算「有值」**：实测 48/48 链路的
//      `in_util_pct` / `out_util_pct` / `packet_loss` / `error_rate` 全是 0，而同一批链路的
//      `traffic_in|out` 有 21/48 非零（例：`traffic_out: 16.18` 而 `out_util_pct: 0`）——
//      这四个 0 是「没算」不是「空闲」，画成 0% 就是撒谎，因此一律 `null` → 展示「未计算」；
//   ② 带宽按 `bandwidth` **原样**带单位展示（实测 `"100 Mbps"` / `"1 Gbps"` / `"4 Gbps"`），
//      不做单位换算；数字 `0` 是缺真值（早期实测口径）⇒ `null`。
import type { TopologyGraphLink } from "~~/shared/types/topology";

/** 链路可展示的事实：`null` = 上游没给 / 给了也等于没算（展示为「—」或「未计算」） */
export interface TopologyLinkFacts {
	/** 链路类型（`fiber` / `1GE` / `radio` …，上游原样） */
	linkType: string | null
	/** 介质（`optical` / `copper1g` / `wifi24` …，上游原样） */
	medium: string | null
	/** 上下游关系（`up` / `peer` / `down`，上游原样） */
	relation: string | null
	/** 管理状态（上游原样） */
	adminStatus: string | null
	/** 带宽原文（带单位，不换算）；上游给 `0` / 缺省时为 `null` */
	bandwidth: string | null
	/** 入流量（Mbps） */
	trafficIn: number | null
	/** 出流量（Mbps） */
	trafficOut: number | null
	/** 入向利用率（%）；**只在 `> 0` 时有值**，`0` = 未计算 */
	utilIn: number | null
	/** 出向利用率（%）；同上 */
	utilOut: number | null
	/** 丢包率（%）；同上 */
	packetLoss: number | null
	/** 误码率（%）；同上 */
	errorRate: number | null
}

/** 计数收窄：非有限数 / 负数 → `null`；`0` 是真实值（流量为 0 就是没流量） */
function readCount(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
		return null;
	return value;
}

/** 正数收窄：`null` / 非有限数 / `<= 0` → `null`（0 在本域表示「没算」，见文件头口径 ①） */
function readPositive(value: unknown): number | null {
	const count = readCount(value);
	return count === null || count === 0 ? null : count;
}

/** 字符串原样：空串 / 非字符串 → `null` */
function readText(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** 带宽原文：字符串原样带单位；数字只在 `> 0` 时转成字符串（`0` = 上游缺真值） */
function readBandwidth(value: unknown): string | null {
	if (typeof value === "string")
		return readText(value);
	if (typeof value === "number" && Number.isFinite(value) && value > 0)
		return String(value);
	return null;
}

/**
 * 带宽原文 → Mbps（画布的线宽要一个可比的数字，详情栏仍展示原文）。
 *
 * 实测口径是**带单位的字符串**（`"100 Mbps"` / `"1 Gbps"` / `"4 Gbps"`），单位前缀换算到 Mbps：
 * `k` → 1e-3、空 → 1、`m` → 1、`g` → 1e3、`t` → 1e6。三条例外都不编数：
 *   · 缺省 / `0` / 非有限数 → `null`（上游缺真值，见文件头口径 ②）；
 *   · 认不出单位的字符串（`"fast"`）→ `null`；
 *   · **数字**形态（契约的 `number | string`）按 Mbps 读 —— 数字口径只有老上游会给，它没有单位可带，
 *     而现网 48/48 都是字符串，所以这条例外只影响「本来就没单位」的那种输入。
 */
export function bandwidthMbps(value: unknown): number | null {
	if (typeof value === "number")
		return Number.isFinite(value) && value > 0 ? value : null;

	if (typeof value !== "string")
		return null;

	const match = /^(\d+(?:\.\d+)?)\s*([kmgt]?)i?bps$/i.exec(value.trim());
	if (match) {
		const factors: Record<string, number> = { "": 1, k: 1e-3, m: 1, g: 1e3, t: 1e6 };
		const factor = factors[match[2]!.toLowerCase()];
		const amount = Number(match[1]);
		if (factor === undefined || !Number.isFinite(amount) || amount <= 0)
			return null;
		return amount * factor;
	}

	// 只有数字的字符串（`"1000"`）：同样按 Mbps 读，理由与数字形态一致
	const bare = Number(value.trim());
	return Number.isFinite(bare) && bare > 0 ? bare : null;
}

/**
 * 是否**空口**链路（画布据此画虚线，§6.15 要求 4）。
 *
 * 判据取 `medium` 与 `linkType` 两列：实测 `medium` 给介质（`wifi5` / `wifi24` / `optical` /
 * `copper1g`），而部分样本只给 `linkType: "wireless"`（自检的 mesh 样本就是这样）。
 * 词表只认「明确说了是无线」的三种写法，其余一律当有线 —— 猜错方向会把有线画成虚线。
 */
export function linkIsWireless(link: TopologyGraphLink | undefined | null): boolean {
	if (!link)
		return false;
	const medium = (readText(link.medium) ?? "").toLowerCase();
	const type = (readText(link.linkType) ?? "").toLowerCase();
	return medium.startsWith("wifi")
		|| medium === "wireless"
		|| medium === "radio"
		|| type === "wireless"
		|| type === "wifi"
		|| type === "radio";
}

/**
 * 链路事实读表（入参是**拍平后**的读模型，上游 `data` 外壳见 §6.10）。
 *
 * `telemetry` 整个对象可能缺（老样本 / 非现网上游）：此时四个「未计算」维度与两个流量都是 `null`，
 * 而基础事实（类型 / 介质 / 关系 / 管理状态 / 带宽）照常可读 —— 提示不会因为缺遥测而只剩一行字。
 */
export function linkFactsOf(link: TopologyGraphLink | undefined | null): TopologyLinkFacts {
	if (!link) {
		return {
			linkType: null,
			medium: null,
			relation: null,
			adminStatus: null,
			bandwidth: null,
			trafficIn: null,
			trafficOut: null,
			utilIn: null,
			utilOut: null,
			packetLoss: null,
			errorRate: null
		};
	}

	const telemetry = link.telemetry ?? {};

	return {
		linkType: readText(link.linkType),
		medium: readText(link.medium),
		relation: readText(link.relation),
		adminStatus: readText(link.admin_status),
		bandwidth: readBandwidth(link.bandwidth),
		trafficIn: readCount(telemetry.traffic_in),
		trafficOut: readCount(telemetry.traffic_out),
		utilIn: readPositive(telemetry.in_util_pct),
		utilOut: readPositive(telemetry.out_util_pct),
		packetLoss: readPositive(telemetry.packet_loss),
		errorRate: readPositive(telemetry.error_rate)
	};
}

/** 四个「利用率维度」是否至少有一个真有值：都没有时提示写「未计算」而不是列四行 0% */
export function linkHasUtilization(facts: TopologyLinkFacts): boolean {
	return [facts.utilIn, facts.utilOut, facts.packetLoss, facts.errorRate].some((value) => value !== null);
}
