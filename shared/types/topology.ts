// shared/types/topology.ts
// 拓扑图契约（上游 `GET /api/v1/topology/graph` ↔ BFF `/api/topology/graph`）。
//
// 设计基准：NMCPS-DESIGN-001 §6.1（主数据源）与 §七（图形形态）。
// 字段口径取自 1.0 对同一端点的**只读实测消费**（2026-10-14：36 节点 / 47~48 链路 / 3 combos，
// 见 `_reference/nmcps-v1/shared/connector/topologyAdapt.ts` 的 `normalizeTopologyInput()`）：
//   · 节点 `id` 是**管理 IP**（如 `10.0.0.2`），展示名在 `name` / `hostname` / `label`；
//   · 节点 `status` 数值口径 `1=在线 / 2=告警 / 0=离线`，也会直接给字符串；
//   · 链路 `bandwidth` 实测**全为 0**（真值缺失），因此页面不得把 `0` 当带宽展示；
//   · 链路另有 `linkType` / `bandwidth_util_pct` / `sourcePort` / `targetPort`，`medium` 上游没有。
//
// 形状可能被信封包一层（`{ code, data: { nodes, edges } }`）或直接平铺；BFF 网关统一包成
// `ApiResponse` 后 `data` 即本文件描述的对象，解包与状态归一由 `app/utils/graph/topologyNormalize.ts` 完成。

/** 节点类别（实测 `network-device` / `ap` / `client`；新取值按 `unknown` 处理） */
export const TOPOLOGY_NODE_CATEGORIES = ["network-device", "ap", "client", "unknown"] as const;
export type TopologyNodeCategory = (typeof TOPOLOGY_NODE_CATEGORIES)[number];

/** 节点状态（数值口径 `1=在线 / 2=告警 / 0=离线` 归一到本联合） */
export const TOPOLOGY_NODE_STATUSES = ["online", "warning", "critical", "offline", "unknown"] as const;
export type TopologyNodeStatus = (typeof TOPOLOGY_NODE_STATUSES)[number];

/** 链路状态（`up` / `down` 分别归一为 `online` / `offline`） */
export const TOPOLOGY_LINK_STATUSES = ["online", "degraded", "congested", "switching", "offline", "unknown"] as const;
export type TopologyLinkStatus = (typeof TOPOLOGY_LINK_STATUSES)[number];

/** `GET /api/topology/graph` 的查询参数（实测只有这四个生效） */
export interface TopologyGraphQuery {
	/** 不传则用会话租户 */
	tenant_id?: string
	/** 是否含虚拟节点 */
	include_virtual?: boolean
	/** `true` 时节点自带状态（状态色来源） */
	include_status?: boolean
	/** 组合分组维度 */
	group_by?: string
}

/** 图节点（线格式；`status` 可能是数值，收窄走 `normalizeNodeStatus()`） */
export interface TopologyGraphNode {
	/** 管理 IP（实测）——与 8001 运行态节点的 `ip_address` 对齐用 */
	id: string
	name?: string | null
	hostname?: string | null
	label?: string | null
	ip?: string | null
	category?: string | null
	/** 契约口径的角色（`core` / `distribution` / …，实测多为空） */
	type?: string | null
	status?: string | number | boolean | null
	tier?: number | null
	icon?: string | null
	brand?: string | null
	color?: string | null
	sysDescr?: string | null
}

/** 图链路（线格式；`bandwidth` 实测全为 0） */
export interface TopologyGraphLink {
	id?: string | null
	source: string
	target: string
	/** 上游实测为 0（真值缺失）；页面不得把 0 当带宽 */
	bandwidth?: number | string | null
	linkType?: string | null
	status?: string | number | null
	bandwidth_util_pct?: number | null
	bandwidthUtilPct?: number | null
	sourcePort?: string | null
	targetPort?: string | null
}

/** 组合（上游 3 个；字段未逐项取证，页面只按 `id` 去重计数） */
export interface TopologyCombo {
	id: string
	label?: string | null
	[key: string]: unknown
}

/** `GET /api/topology/graph` 的 `data`（`edges` / `links` 两种键名都出现过，解包时二选一） */
export interface TopologyGraph {
	nodes: TopologyGraphNode[]
	edges?: TopologyGraphLink[]
	links?: TopologyGraphLink[]
	combos?: TopologyCombo[]
	/** 上游若有总数字段（未取证时不依赖它） */
	total?: number
}
