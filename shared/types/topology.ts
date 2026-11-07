// shared/types/topology.ts
// 拓扑图契约（上游 `GET /api/v1/topology/graph` ↔ BFF `/api/topology/graph`）。
//
// 设计基准：NMCPS-DESIGN-001 §6.1（主数据源）与 §七（图形形态）。
// 字段口径取自 1.0 对同一端点的**只读实测消费**（2026-10-14：36 节点 / 47~48 链路 / 3 combos，
// 见 `_reference/nmcps-v1/shared/connector/topologyAdapt.ts` 的 `normalizeTopologyInput()`）：
//   · 节点 / 链路是 **G6 元素形态的两层形状**：`{ id, data: { …事实… }, style, combo }`，
//     本文件描述的扁平字段是 `flattenTopologyNode()` / `flattenTopologyLink()` 归一后的**读模型**
//     （2026-11-07 复测：节点 `data.tier` 实测 1/2/3/4 四档齐全、`data.status` 是 `online|warning|…`，
//     链路 `data.bandwidth` 是 `"100 Mbps"`）—— `NMCPS-DESIGN-001` §6.10；
//   · 节点 `id` 是**管理 IP**（如 `10.0.0.2`），展示名在 `data.deviceName` / `data.label`；
//   · 节点 `status` 数值口径 `1=在线 / 2=告警 / 0=离线`，也会直接给字符串；
//   · 链路 `bandwidth` 实测是**字符串**（`"100 Mbps"` / `"1 Gbps"` / `"4 Gbps"`，数字 0 也出现过，
//     0 = 真值缺失，页面不得把 0 当带宽）；`medium` / `relation` / `admin_status` / `telemetry`
//     2026-11-07 复测 48/48 齐全，形态见 `TopologyLinkTelemetry`；
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
	/**
	 * 上游**实际**线格式的 `data` 外壳（G6 元素形态，2026-11-07 只读实测）：
	 * 事实字段全在这里（`deviceName` / `label` / `type` / `tier` / `status` / `cpu` / `memory` …），
	 * 与本接口的扁平字段**不是两份数据** —— `flattenTopologyNode()` 把 `data.*` 抬到扁平槽位，
	 * 布局与详情栏只读扁平槽位（`NMCPS-DESIGN-001` §6.10 / A27）。
	 */
	data?: Record<string, unknown> | null
	/** 上游预置的几何（`{ x, y }`）：2.0 不复用它（几何唯一由 `layoutTopology()` 产生，§6.8） */
	style?: Record<string, unknown> | null
	/** 上游的分组 id（1.0 的 combo 归属；2.0 只按 `combos` 计数） */
	combo?: string | null
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
	// ── 节点指标事实（1.0 对同一端点的消费口径见 `_reference/nmcps-v1/shared/types/topology.ts`
	//    的 `TopologyNodeData`：`cpu` / `memory` 是百分比，`traffic*` 是 Mbps）──
	//
	// 口径铁律（NMCPS-CONTRACT-002 §6.3）：**缺省即未知，不当 0**。1.0 用 `-1` 表示「取不到」，
	// 这里两者都收（`-1` 与缺省等价），展示层统一成「—」而不是 `0%`。
	/** CPU 使用率（%）；`-1` / 缺省 = 未知 */
	cpu?: number | null
	/** 内存使用率（%）；`-1` / 缺省 = 未知 */
	memory?: number | null
	/** 接口总数；缺省 = 未知（0 是真实值，不与之混淆） */
	interfaces?: number | null
	/** 邻居数（上游口径；画布上的邻居数另由链路推导，见 `topologyNeighborsOf()`） */
	neighbors?: number | null
	/** 总流量（Mbps，1.0 口径 = `traffic_in + traffic_out`） */
	traffic?: number | null
	/** 入流量（Mbps） */
	traffic_in?: number | null
	/** 出流量（Mbps） */
	traffic_out?: number | null
	/** 旧口径（Kbps）：1.0 的 `trafficInKbps` 等，归一为 Mbps 时 /1000 */
	trafficInKbps?: number | null
	trafficOutKbps?: number | null
	trafficTotalKbps?: number | null
	/** 运行时长（秒） */
	uptime?: number | null
	location?: string | null
	// ── 无线事实（AP；2026-11-07 复测：27/36 节点带这组字段，`bssid` / `temperature` 各 9/36）──
	// 缺省即未知（同 §6.3 铁律）：没有这组字段的节点不画无线卡，而不是画一排「—」。
	/** SSID（上游原样，属数据不翻译） */
	ssid?: string | null
	/** 频段（实测 `2.4G` / `5G` 这种写法，原样展示，不做单位换算） */
	band?: string | null
	/** 信道号 */
	channel?: number | null
	/** 信号强度（dBm，负值正常） */
	dbm?: number | null
	/** 关联终端数 */
	clients?: number | null
	/** 信道利用率（%） */
	util?: number | null
	/** 发射功率（dBm） */
	tx_power?: number | null
}

/**
 * 链路遥测（`data.telemetry`；2026-11-07 复测 48/48 链路都带，字段固定为下表七项）。
 *
 * 口径警告：`in_util_pct` / `out_util_pct` / `packet_loss` / `error_rate` 实测**全为 0**，
 * 而同一批链路的 `traffic_in` / `traffic_out` 有 21/48 非零 —— 说明这四个 0 是「没算」不是「空闲」。
 * 展示层因此只在 `> 0` 时才认这四个维度，否则写「未计算」，绝不写 `0%`（`NMCPS-DESIGN-001` §6.11）。
 */
export interface TopologyLinkTelemetry {
	/** 入流量（Mbps） */
	traffic_in?: number | null
	/** 出流量（Mbps） */
	traffic_out?: number | null
	/** 入向利用率（%）；实测恒 0 = 未计算 */
	in_util_pct?: number | null
	/** 出向利用率（%）；同上 */
	out_util_pct?: number | null
	/** 丢包率（%）；同上 */
	packet_loss?: number | null
	/** 误码率（%）；同上 */
	error_rate?: number | null
	/** 遥测采集时间（上游原样字符串） */
	metric_updated_at?: string | null
}

/** 图链路（线格式；`bandwidth` 实测为字符串 `"100 Mbps"` 或 0） */
export interface TopologyGraphLink {
	id?: string | null
	/**
	 * 上游**实际**线格式的 `data` 外壳（G6 元素形态）：`linkType` / `bandwidth` / `status` /
	 * `bandwidth_util_pct` / `telemetry` 都在这里 —— 由 `flattenTopologyLink()` 抬到扁平槽位（§6.10）。
	 */
	data?: Record<string, unknown> | null
	source: string
	target: string
	/** 上游实测为 0（真值缺失）或字符串 `"100 Mbps"`；页面不得把 0 当带宽 */
	bandwidth?: number | string | null
	linkType?: string | null
	status?: string | number | null
	bandwidth_util_pct?: number | null
	bandwidthUtilPct?: number | null
	sourcePort?: string | null
	targetPort?: string | null
	// ── 链路基础事实（2026-11-07 复测：48/48 链路齐全，拆自 `data.*`）──
	/** 介质（实测 `wifi24` / `eth100m` / `copper1g` / `optical`，上游原样，属数据不翻译） */
	medium?: string | null
	/** 上下游关系（实测 `up` / `peer` / `down`） */
	relation?: string | null
	/** 管理状态（上游原样，如 `enabled` / `disabled`） */
	admin_status?: string | null
	/** 遥测（环境 / 流量；利用率口径见 `TopologyLinkTelemetry` 的口径警告） */
	telemetry?: TopologyLinkTelemetry | null
}

/**
 * 组合（上游实测 3 组、每组 `children` 11 个）：`{ id, data: { label, layer, root, counts }, children }`。
 * `counts` 实测形如 `{ distro, access, terminal }` —— 折叠角标与分组卡片都只读它（`NMCPS-DESIGN-001` §6.11）。
 */
export interface TopologyCombo {
	id: string
	label?: string | null
	/** 上游 `data` 外壳（`label` / `layer` / `root` / `counts` 都在里面） */
	data?: Record<string, unknown> | null
	/** 组内节点 id 清单（`flattenTopologyCombo()` 已把 `data.children` 抬到这里） */
	children?: string[] | null
	/** 组内分层计数（`distro` / `access` / `terminal`）；缺省时页面按 `children` 长度兜底 */
	counts?: Record<string, number> | null
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
