// app/utils/graph/topologyNormalize.ts
// 拓扑图**纯函数**归一（零 I/O、零状态）：把 8888 `/topology/graph` 的线格式收窄成本域口径。
//
// 设计基准：NMCPS-DESIGN-001 §6.1 / §七（图形形态）、NMCPS-ADR-0019 D1（图形自绘、布局走纯函数）。
// 字段口径见 `shared/types/topology.ts` 顶部注记（2026-10-14 只读实测）。
import type {
	TopologyCombo,
	TopologyGraph,
	TopologyGraphLink,
	TopologyGraphNode,
	TopologyLinkStatus,
	TopologyNodeCategory,
	TopologyNodeStatus
} from "~~/shared/types/topology";

/** 节点状态归一：上游给数值（1/2/0）、字符串（up/down/online…）或布尔时都收敛到联合类型 */
export function normalizeNodeStatus(value: unknown): TopologyNodeStatus {
	if (typeof value === "string") {
		const s = value.trim().toLowerCase();
		if (s === "online" || s === "up" || s === "normal")
			return "online";
		if (s === "warning" || s === "degraded")
			return "warning";
		if (s === "critical" || s === "error")
			return "critical";
		if (s === "offline" || s === "down")
			return "offline";
		return "unknown";
	}

	if (typeof value === "number")
		return value === 1 ? "online" : value === 2 ? "warning" : "offline";

	if (typeof value === "boolean")
		return value ? "online" : "offline";

	return "unknown";
}

/** 链路状态归一（`up` / `down` → `online` / `offline`；`flapping` → `switching`） */
export function normalizeLinkStatus(value: unknown): TopologyLinkStatus {
	if (typeof value === "string") {
		const s = value.trim().toLowerCase();
		if (s === "up" || s === "online")
			return "online";
		if (s === "down" || s === "offline")
			return "offline";
		if (s === "degraded" || s === "warning")
			return "degraded";
		if (s === "congested")
			return "congested";
		if (s === "switching" || s === "flapping")
			return "switching";
		return "unknown";
	}

	if (typeof value === "number")
		return value === 1 ? "online" : value === 2 ? "degraded" : "offline";

	if (typeof value === "boolean")
		return value ? "online" : "offline";

	return "unknown";
}

/** 节点类别归一（实测只有三类，其余按 `unknown`） */
export function normalizeNodeCategory(value: unknown): TopologyNodeCategory {
	if (typeof value !== "string")
		return "unknown";

	const s = value.trim().toLowerCase();
	if (s === "network-device" || s === "device")
		return "network-device";
	if (s === "ap" || s === "wireless-ap")
		return "ap";
	if (s === "client" || s === "station" || s === "terminal")
		return "client";
	return "unknown";
}

/** 取链路数组：上游两种键名（`edges` / `links`）都出现过，`edges` 优先 */
export function topologyLinksOf(graph: TopologyGraph | undefined | null): TopologyGraphLink[] {
	if (!graph)
		return [];
	return graph.edges?.length ? graph.edges : (graph.links ?? []);
}

/** 节点展示名：`name` → `hostname` → `label` → `id`（实测 `id` 是管理 IP，只能兜底） */
export function topologyNodeLabel(node: TopologyGraphNode): string {
	for (const candidate of [node.name, node.hostname, node.label]) {
		if (typeof candidate === "string" && candidate.trim())
			return candidate.trim();
	}
	return node.id;
}

/** 节点管理 IP：`ip` 缺省时 `id` 本身就是 IP（实测口径） */
export function topologyNodeIp(node: TopologyGraphNode): string {
	if (typeof node.ip === "string" && node.ip.trim())
		return node.ip.trim();
	return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(node.id) ? node.id : "";
}

/** `tier` 归一：实测只有 2 / 4 两档，其余按中间层（3）排，保持图形可读 */
export function normalizeTier(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 4
		? Math.trunc(value)
		: 3;
}

// ── 线格式的**两层形状**归一（A27，NMCPS-DESIGN-001 §6.10） ─────────────────────
// 8888 `/topology/graph` 的节点 / 链路是 G6 的**元素形态**，事实字段全在 `data` 里：
//   · 节点 `{ id, data: { deviceName, label, type, tier, status, cpu, memory, … }, style: { x, y }, combo }`
//   · 链路 `{ id, source, target, data: { linkType, bandwidth: "100 Mbps", status, bandwidth_util_pct } }`
// 本节之前的读模型（`TopologyGraphNode` 的扁平字段）是**归一后**的形状。少了这一步，`tier` /
// `status` / 名称 / 指标全部落空：`normalizeTier(undefined)` 一律回落到 3 ⇒ 分层布局把 36 个节点
// 全塞进同一条水平线（2026-11-07 用户反馈「页面没看到变化」的真因），名称退化成管理 IP、
// 状态全成 `unknown`、详情栏全写「—」。
//
// 归一在 **BFF 取数边界**做一次（`useTopologyMonitor.loadGraph()`），布局 / 事实层 / 画布都只吃扁平读模型
// —— 读表的地方不该各自再猜一次 `data` 在哪。

/** 任意 JSON 记录（上游线格式没有类型保证：先收窄再取值） */
type JsonRecord = Record<string, unknown>;

/** 非数组对象收窄；其余（含 `null` / 数组 / 标量）一律当「没有」 */
function asRecord(value: unknown): JsonRecord | null {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRecord : null;
}

/** 取第一个**非空字符串**候选（优先级由调用方按 1.0 的口径排列） */
function firstString(...candidates: readonly unknown[]): string | null {
	for (const candidate of candidates) {
		if (typeof candidate === "string" && candidate.trim())
			return candidate.trim();
	}
	return null;
}

/** 元素的 `data` 外壳（两层形状）；单层形状（老接口 / 自检假上游）就是空表 */
function dataOf(raw: unknown): JsonRecord {
	return asRecord(asRecord(raw)?.data) ?? {};
}

/**
 * 节点线格式 → 扁平读模型（**幂等**：已经是扁平形状的输入原样返回）。
 *
 * 取值优先级与 1.0 的 `normalizeTopologyInput()`（`_reference/nmcps-v1/shared/connector/topologyAdapt.ts`）
 * 对齐：`data.*` 优先、扁平字段兜底 —— 上游哪天把字段挪回顶层也不会丢；`name` 取
 * `data.deviceName → data.label → 顶层 name / hostname / label`，绝不先回 `id`（那是管理 IP）。
 */
export function flattenTopologyNode(raw: TopologyGraphNode): TopologyGraphNode {
	const data = dataOf(raw);
	const lifted = <K extends keyof TopologyGraphNode>(key: K): TopologyGraphNode[K] =>
		(data[key as string] ?? raw[key]) as TopologyGraphNode[K];

	return {
		...raw,
		id: firstString(raw.id, data.id) ?? "",
		name: firstString(data.deviceName, data.label, raw.name, raw.hostname, raw.label, data.name),
		hostname: firstString(raw.hostname, data.hostname),
		label: firstString(raw.label, data.label),
		ip: firstString(raw.ip, data.ip),
		category: firstString(raw.category, data.category),
		type: firstString(raw.type, data.type),
		status: lifted("status"),
		tier: lifted("tier"),
		icon: firstString(raw.icon, data.icon),
		brand: firstString(raw.brand, data.brand),
		color: firstString(raw.color, data.color),
		sysDescr: firstString(raw.sysDescr, data.sysDescr),
		cpu: lifted("cpu"),
		memory: lifted("memory"),
		interfaces: lifted("interfaces"),
		neighbors: lifted("neighbors"),
		traffic: lifted("traffic"),
		traffic_in: lifted("traffic_in"),
		traffic_out: lifted("traffic_out"),
		trafficInKbps: lifted("trafficInKbps"),
		trafficOutKbps: lifted("trafficOutKbps"),
		trafficTotalKbps: lifted("trafficTotalKbps"),
		uptime: lifted("uptime"),
		location: lifted("location"),
		// 无线事实（AP）：字符串 / 数字各自收窄，缺省保持 `undefined`（= 未知，不补 0）
		ssid: firstString(raw.ssid, data.ssid),
		band: firstString(raw.band, data.band),
		channel: (data.channel ?? raw.channel) as number | null | undefined,
		dbm: (data.dbm ?? raw.dbm) as number | null | undefined,
		clients: (data.clients ?? raw.clients) as number | null | undefined,
		util: (data.util ?? raw.util) as number | null | undefined,
		tx_power: (data.tx_power ?? raw.tx_power) as number | null | undefined
	};
}

/** 链路线格式 → 扁平读模型（同 `flattenTopologyNode()`：`data.*` 优先、顶层兜底） */
export function flattenTopologyLink(raw: TopologyGraphLink): TopologyGraphLink {
	const data = dataOf(raw);
	const bandwidth = data.bandwidth ?? raw.bandwidth;

	return {
		...raw,
		id: firstString(raw.id, data.id),
		source: firstString(raw.source, data.source) ?? "",
		target: firstString(raw.target, data.target) ?? "",
		// 实测带宽是字符串（`"100 Mbps"`）：原样保留，读的人自己判单位（契约里 Type 是 `number | string`）
		bandwidth: (typeof bandwidth === "number" || typeof bandwidth === "string" ? bandwidth : null),
		linkType: firstString(raw.linkType, data.linkType),
		status: (data.status ?? raw.status) as TopologyGraphLink["status"],
		bandwidth_util_pct: (data.bandwidth_util_pct ?? raw.bandwidth_util_pct) as number | null | undefined,
		bandwidthUtilPct: (data.bandwidth_util_pct ?? raw.bandwidthUtilPct) as number | null | undefined,
		sourcePort: firstString(raw.sourcePort, data.sourcePort),
		targetPort: firstString(raw.targetPort, data.targetPort),
		// 基础事实（2026-11-07 复测 48/48 齐全）：介质 / 关系 / 管理状态在上游 `data` 里，
		// 都是**字符串原样**（`wifi24` / `optical`、`up` / `peer`、`enabled`），不做词表映射 —— 映射会丢真值。
		medium: firstString(raw.medium, data.medium),
		relation: firstString(raw.relation, data.relation),
		admin_status: firstString(raw.admin_status, data.admin_status),
		// 遥测：整个对象原样抬上来（嵌套字段的口径收窄归 `linkFactsOf()`，这里不做默认值）
		telemetry: asRecord(data.telemetry) ?? asRecord(raw.telemetry)
	};
}

/**
 * 组合线格式 → 读模型：`data.label` / `data.children` / `data.counts` 抬到扁平槽位。
 *
 * 上游实测（§6.11）：`{ id, data: { label, layer, root, counts: { distro, access, terminal } }, children: [...] }`。
 * `children` 实测在顶层，`counts` 在 `data` 里 —— 两处都收，谁在就认谁；`ids` 只保留字符串项。
 */
export function flattenTopologyCombo(raw: TopologyCombo): TopologyCombo {
	const data = dataOf(raw);
	const children = data.children ?? raw.children;
	const counts = data.counts ?? raw.counts;

	return {
		...raw,
		id: firstString(raw.id, data.id) ?? "",
		label: firstString(data.label, raw.label),
		children: Array.isArray(children)
			? children.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
			: null,
		counts: asRecord(counts) as Record<string, number> | null
	};
}

/**
 * 整张图归一（节点 + 链路 + 组合都拍平；`edges` / `links` 两种键名各自保留，解包仍由 `topologyLinksOf()` 决定）。
 *
 * 这是**唯一**把线格式变成读模型的地方：布局（`layoutTopology()`）、事实层（`nodeFactsOf()`）、
 * 画布都只吃它的产物，同一份上游数据因此只有一套字段口径。
 */
export function normalizeTopologyGraph(graph: TopologyGraph): TopologyGraph {
	return {
		...graph,
		nodes: (graph.nodes ?? []).map(flattenTopologyNode),
		...(graph.edges ? { edges: graph.edges.map(flattenTopologyLink) } : {}),
		...(graph.links ? { links: graph.links.map(flattenTopologyLink) } : {}),
		...(graph.combos ? { combos: graph.combos.map(flattenTopologyCombo) } : {})
	};
}

/**
 * 链路的稳定标识（画布与页面**同一套算法**，用于「选中的那条链路」跨轮询不丢）。
 *
 * 上游实测链路带 `id`；没有 `id` 时退回 `source|target|index` —— 加 `index` 是为了平行链路
 * （同一对端点多条边是真实存在的，去重会掩盖它，见 `topologyNeighborsOf()` 的口径）各自可选。
 */
export function topologyLinkKey(link: TopologyGraphLink, index = 0): string {
	return link.id?.trim() ? link.id.trim() : `${link.source}|${link.target}|${index}`;
}
