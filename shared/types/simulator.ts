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

/**
 * LLDP 邻接发现的**邻居项**（`GET /api/lldp/neighbors/{node_id}` 的 `neighbors[]`）。
 *
 * 字段口径是 2026-11-07 对 8001 的**实测原样**（`/tmp/lldp-probe.out`，探针 `n1` / `n4` / `n5` / `n10`）：
 * 一条记录 = 本端一台设备的一个邻接，两端接口分成 `local_interface` / `remote_interface`；对端身份有两套
 * ——`neighbor_id` / `neighbor_name` 是平台内部台账（`n1` / `N1`），`chassis_id` / `port_id` / `sys_name`
 * 是 LLDP MIB 字段（实测 `chassis_id` 恒为 `00:00:00:00:00:00`，**不能**拿它当唯一键）；`mib_oids` 是
 * 「字段名 → OID」的对照表，不是值。旧契约（`{ id, name, local_port, remote_port }`）与实测不符，已取缔。
 */
export interface SimulatorLldpNeighbor {
	/** 对端仿真节点 id（`n1`），与 `runtime-inventory` 的 `nodes[].id` 同源 */
	neighbor_id: string
	/** 对端类型原样（`router` / `switch` / `ap` / `station`），属数据不翻译 */
	neighbor_type: string
	/** 对端台账名（`N1`），通常与 `sys_name`（`核心路由器-1`）不同：两个都照实展示 */
	neighbor_name: string
	/** 本端接口（`n4-eth1`） */
	local_interface: string
	/** 对端接口（`n1-eth2`） */
	remote_interface: string
	chassis_id: string
	/** `mac` / … 原样 */
	chassis_id_subtype: string
	/** 对端端口 id（实测与 `remote_interface` 同值） */
	port_id: string
	/** `ifname` / … 原样 */
	port_id_subtype: string
	port_descr: string
	/** 对端自报系统名（`核心路由器-1`） */
	sys_name: string
	sys_desc: string
	/** LLDP TTL（秒），实测 120 */
	ttl: number
	/** `wired` / `wireless` */
	link_type: string
	/** `up` / `down` */
	link_status: string
	/** 上游本地时间字符串，**不带时区**（`2026-11-05T10:38:56.863667`）：展示不做时区换算 */
	discovered_at: string
	/** 字段名 → OID（`lldpRemChassisId` → `1.0.8802.1.1.2.1.4.1.1.5`），不是取值 */
	mib_oids: Record<string, string>
}

/**
 * `GET /api/lldp/summary`：实测是「本轮扫描的规模 + 一个示例端点」，**不是**按交换机分组的邻居计数。
 *
 * `local_*` 三项是**某一台**设备的自报身份（实测为首个被扫描节点 `n1`），把它读成「全网汇总」就是编数据；
 * 页面若要「哪台有邻居」必须逐节点请求 `neighbors/{node_id}`，summary 只配当页头规模读数。
 */
export interface SimulatorLldpSummary {
	/** 参与扫描的节点数（实测 36） */
	node_count: number
	/** 邻居条目总数（实测 96） */
	neighbor_entry_count: number
	/** 采集模式（实测 `native`） */
	mode: string
	/** 实测 `IEEE 802.1AB` */
	mib_standard: string
	/** 实测 `1.0.8802.1.1.2.1.4.1.1`（`lldpRemTable`） */
	lldp_mib_oid: string
	local_sys_name: string
	local_sys_desc: string
	local_chassis_id: string
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
