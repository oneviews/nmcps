// shared/types/simulator.ts
// 8001 仿真平台实体契约：BFF `server/api/sim/**` 白名单通道的**归一形状**。
//
// 设计基准：NMCPS-CONTRACT-001 §六（字段口径五条例外）、NMCPS-ARCH-002 §六（第二数据源）、
// NMCPS-ADR-0019 §4（裁决 B）。字段形状取自 2026-11-05 实测响应与上游 `openapi.json`
// （113 条路径 / 40 个 schema）。
//
// 五条例外（改这里之前先读）：
//   1. **沿用上游 `snake_case`**：不做驼峰转换，只有 BFF 自造的错误信封字段例外；
//   2. **带单位字段保持 `string`**：`bandwidth: "4000Mbps"` / `delay: "2ms"` / `loss: "0%"`，
//      数值化由页面纯函数完成，类型层不解析；
//   3. **可空显式 `| null`**：上游明确给 `null` 的字段禁止退化成可选 `?:`；
//   4. **未取证子对象不透明**：一律 `SimulatorOpaqueObject`，禁止 `any`；
//   5. **枚举与线格式分离**：线格式字段保持 `string`（上游会加取值），另定义联合类型 + 守卫
//      （`SimulatorNodeType` / `SimulatorLinkType` / `SimulatorSessionState`）供页面收窄，
//      守卫必须带 `unknown` 兜底分支。

/** 未逐字段取证的子对象（接口 / 弱网 / 协议 / 真实统计 / 流控） */
export type SimulatorOpaqueObject = Record<string, unknown>;

/** 节点类型（实测 `router` 3 / `switch` 6 / `ap` 18 / `station` 9；上游会加取值，故线格式仍是 `string`） */
export const SIMULATOR_NODE_TYPES = ["router", "switch", "ap", "station"] as const;
export type SimulatorNodeType = (typeof SIMULATOR_NODE_TYPES)[number];

/** 链路类型：有线 / 无线（实测 `wired` 40 / `wireless` 8） */
export const SIMULATOR_LINK_TYPES = ["wired", "wireless"] as const;
export type SimulatorLinkType = (typeof SIMULATOR_LINK_TYPES)[number];

/** 会话状态（`status.status`，上游另有 `build_timing` 阶段进度） */
export const SIMULATOR_SESSION_STATES = ["created", "building", "running", "paused", "stopped", "error"] as const;
export type SimulatorSessionState = (typeof SIMULATOR_SESSION_STATES)[number];

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
	return typeof value === "string" && (values as readonly string[]).includes(value);
}

/** 节点类型守卫（带 `unknown` 兜底：新取值按 `undefined` 处理，不抛错） */
export function isSimulatorNodeType(value: unknown): value is SimulatorNodeType {
	return isOneOf(SIMULATOR_NODE_TYPES, value);
}

/** 链路类型守卫（同上） */
export function isSimulatorLinkType(value: unknown): value is SimulatorLinkType {
	return isOneOf(SIMULATOR_LINK_TYPES, value);
}

/** 会话状态守卫（同上） */
export function isSimulatorSessionState(value: unknown): value is SimulatorSessionState {
	return isOneOf(SIMULATOR_SESSION_STATES, value);
}

/** `GET /api/sim/channel`：通道能力位（BFF 自产，不是上游资源的透传） */
export interface SimulatorChannelInfo {
	/** `runtimeConfig.simulator.baseUrl` 非空 ⇒ 通道已启用（`false` 不是错误） */
	configured: boolean
	/** `allowWrite`：写按钮可不可点的**唯一**依据（前端不猜） */
	writeEnabled: boolean
	/** 单次出站超时（毫秒），页面用于解释 504 */
	timeoutMs: number
	/** 就绪探针路径（运维排查用；不回 `baseUrl`，避免把上游地址泄露给浏览器） */
	readinessPath: string
}

/** `GET /api/health`（`regulatory` 实测为 `US`） */
export interface SimulatorHealth {
	status: string
	app: string
	engine_available: string[]
	regulatory: string
}

/** 运行态节点（`runtime-inventory` 的 `nodes[]`；与 8888 节点对齐的键是 `id` / `name` / `ip_address`） */
export interface SimulatorRuntimeNode {
	id: string
	name: string
	/** `router` / `switch` / `ap` / `station`…（线格式 `string`，收窄用 `isSimulatorNodeType`） */
	type: string
	/** `online` / `offline`… */
	status: string
	/** 仿真侧画布坐标；未布置时为 `null`（8888 拓扑图不依赖它） */
	x: number | null
	y: number | null
	interfaces: SimulatorOpaqueObject[]
	ip_address: string | null
	mac_address: string | null
	device_type: string
	role: string | null
	ports: Array<{ name: string, ip: string }>
	weaknet_config: SimulatorOpaqueObject | null
	protocol_config: SimulatorOpaqueObject | null
	radio: SimulatorOpaqueObject | null
}

/** 运行态链路（`runtime-inventory` 的 `links[]`；`bandwidth` / `delay` / `loss` 保持带单位字符串） */
export interface SimulatorRuntimeLink {
	id: string
	source: string
	target: string
	source_interface: string | null
	target_interface: string | null
	/** `wired` / `wireless`（线格式 `string`，收窄用 `isSimulatorLinkType`） */
	type: string
	/** `up` / `down` */
	status: string
	bandwidth: string | null
	delay: string | null
	loss: string | null
	real_stats: SimulatorOpaqueObject | null
	weaknet_config: SimulatorOpaqueObject | null
	protocol_config: SimulatorOpaqueObject | null
	tc: SimulatorOpaqueObject | null
}

/** 运行态台账（`GET /api/network/runtime-inventory`）：**运行态唯一入口**，一次取全量 */
export interface SimulatorRuntimeInventory {
	running: boolean
	scenario: string | null
	overrides: {
		exists: boolean
		updated_at: string | null
		node_count: number
		link_count: number
		topology_count: number
	}
	nodes: SimulatorRuntimeNode[]
	links: SimulatorRuntimeLink[]
}

/** `GET /api/network/stats`：`nodes_by_type` / `links_by_type` 是**动态键 */
export interface SimulatorNetworkStats {
	node_count: number
	link_count: number
	nodes_by_type: Record<string, number>
	links_by_type: Record<string, number>
	nodes_online: number
	links_up: number
}

/** LLDP 邻接发现邻居项（`discovered_at` 是上游本地时间字符串，**不带时区**） */
export interface SimulatorLldpNeighbor {
	id: string
	name: string
	local_port: string
	remote_port: string
	ttl: number
	mib_oids: Record<string, string>
	discovered_at?: string
}

/** `GET /api/lldp/summary` */
export interface SimulatorLldpSummary {
	neighbor_count: number
	switches: string[]
}

/** `GET /api/lldp/neighbors/{node_id}` */
export interface SimulatorLldpNeighbors {
	node_id: string
	neighbors: SimulatorLldpNeighbor[]
}

/** `GET /api/simulation/sessions/{sim_id}/status` 的启动阶段进度（`d_s` 为秒） */
export interface SimulatorSessionPhase {
	msg: string
	pct: number
	d_s: number
}

/** `GET /api/simulation/sessions/{sim_id}/status` */
export interface SimulatorSessionStatus {
	sim_id: string
	status: string
	build_timing?: {
		phases: SimulatorSessionPhase[]
	}
	[key: string]: unknown
}

/** `GET /api/simulation/sessions` 的列表项 */
export interface SimulatorSession {
	sim_id: string
	scenario?: string | null
	state?: string
	created_at?: string
}

/** 列表信封 `{ count, items[] }` */
export interface SimulatorSessionList {
	count: number
	items: SimulatorSession[]
}

/** `GET /api/metrics/summary/{sim_id}` */
export interface SimulatorMetricsSummary {
	sample_count: number
	tick_count: number
	avg_utilization_pct: number
	avg_rtt_ms: number
	avg_loss_pct: number
}

/** 逐链路采样（`at` 为上游本地时间字符串；`*_age_s` 是采样龄期） */
export interface SimulatorMetricsSample {
	link_id: string
	utilization_pct: number
	rtt_ms: number
	loss_pct: number
	jitter_us: number
	jitter_valid: boolean
	utilization_age_s: number
	rtt_age_s: number
	loss_age_s: number
	at: string
}

/** `GET /api/metrics/current/{sim_id}` */
export interface SimulatorMetricsCurrent {
	sim_id: string
	at: string
	samples: SimulatorMetricsSample[]
}
