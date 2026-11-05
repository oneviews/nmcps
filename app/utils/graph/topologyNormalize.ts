// app/utils/graph/topologyNormalize.ts
// 拓扑图**纯函数**归一（零 I/O、零状态）：把 8888 `/topology/graph` 的线格式收窄成本域口径。
//
// 设计基准：NMCPS-DESIGN-001 §6.1 / §七（图形形态）、NMCPS-ADR-0019 D1（图形自绘、布局走纯函数）。
// 字段口径见 `shared/types/topology.ts` 顶部注记（2026-10-14 只读实测）。
import type {
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
