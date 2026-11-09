// shared/types/metric.ts
// 指标契约（`NMCPS-CONTRACT-002`）在 2.0 的类型落点：
//   §二 指标类型（`MetricType`）、§三 可查询性三分类（`MetricCatalogKind`）、
//   §五 数据点（`MetricDatapoint`）、§六 `/metric/datapoint` 取数口径（`MetricDatapointData`）、
//   §七 指标名清单（`/metric/name` 的 `MetricNameData` + 双形态条目 `RawMetricItem`）、
//   §八 目录 join（`MetricCatalogItem`）、§九 指标台账（`/metric/device` 与 `/metric/link` 的
//   `MetricDeviceFact` / `MetricLinkFact` 与分页信封 `MetricLedgerData`）。
//
// 只登记**要消费**的形状，不做归一：解包 / 排序 / 去重 / 降采样落在
// `app/utils/chart/metricSeries.ts`（无状态纯函数），页面取数在
// `layers/topology/app/composables/useMetricSeries.ts`。
//
// 两条硬约束（§6.3）：
//   · 采样值**恒为字符串**，消费方解包后必须 `Number()`，禁止直接参与比较或比例尺；
//   · 非法点（`""` / `"NaN"` / `null`）丢弃且计入一次丢弃计数，**不补 0、不插值**。

/** 指标类型（§二）：由 SNMP `dataType` 派生，供速率自动判定与单位格式化 */
export const METRIC_TYPES = ["counter", "gauge", "duration", "string", "event", "other"] as const;
export type MetricType = (typeof METRIC_TYPES)[number];

/** 可查询性三分类（§三）：`numeric` 可绘图 / `text` 文本载体 / `collector` 采集器自监控 */
export const METRIC_CATALOG_KINDS = ["numeric", "text", "collector"] as const;
export type MetricCatalogKind = (typeof METRIC_CATALOG_KINDS)[number];

/** 目录条目（§四；本层暂未消费，随指标页 P1 落地时接入选择器） */
export interface MetricCatalogItem {
	code: string
	cn_name: string
	en_name: string
	category: string
	unit: string
	metric_type: MetricType
	description: string
	kind: MetricCatalogKind
	/** = `kind === "numeric"` */
	selectable: boolean
	has_series: boolean | null
	/**
	 * 证据来源（`NMCPS-CONTRACT-002` §8.4 / §8.6）：
	 * `backend` = 名字与目录都命中；`name-only` = 只有名字；`catalog-only` = 只有目录证据
	 * （名字清单没报它，并集候选把它带进来）；`l1` = 静态字典（本层未接）。
	 */
	meta_source: "l1" | "backend" | "name-only" | "catalog-only"
}

/** 单个点对：`[Unix 秒, 字符串值]`（§五；时间单位是秒，转毫秒只在展示层） */
export type MetricPointPair = [number, string];

/** 一条序列（§五）：标签键是 `metric`（不是 `labels`）；`realtime` 用 `value`、`range` 用 `values`，不并存 */
export interface MetricDatapoint {
	metric: Record<string, string>
	value?: MetricPointPair
	values?: MetricPointPair[]
}

/** `GET /api/metric/datapoint` 的 `data`（§6.2；`from` / `to` 回显是整数 Unix 秒，不能用回请求侧） */
export interface MetricDatapointData {
	mode: "realtime" | "range"
	/** 批量请求时为 `null`（禁空串） */
	mgmt_ip: string | null
	metric_code: string | null
	rate: boolean
	from?: number
	to?: number
	step?: number
	/** `[]` 是合法空（该时段确实无数据），不是错误 */
	results: MetricDatapoint[]
}

/** `metric/name` 的**对象形态**条目（旧路径实测字段；新路径只给字符串，见 `RawMetricItem`） */
export interface RawMetricEntry {
	metric_code?: string
	metric_name?: string
	metric_group?: string
	unit?: string
	data_type?: string
	description?: string
}

/** `data.metrics[]` 的**双形态**条目：新路径 `metric/name` 为字符串，旧路径为对象 */
export type RawMetricItem = string | RawMetricEntry;

/** `GET /api/metric/name` 的 `data`（§七）：未传 `mgmt_ip` 时回显 `null`（禁空串） */
export interface MetricNameData {
	mgmt_ip?: string | null
	ips?: string[] | null
	metrics?: RawMetricItem[] | null
}

// ══════════════════════════════════════════════════════════════════════════════
// 九、指标台账：`/metric/device` 与 `/metric/link`（§九）
//
// 两条台账端点是**指标页左栏**的数据源：`/metric/datapoint` 只回「某个 `mgmt_ip` 的某条指标的
// 历史」，回答不了「有哪些设备 / 哪些链路、当前值多少」。字段口径取自 openapi 的
// `metric_DeviceFact` / `metric_LinkFact`（`_reference` 里 1.0 的同一份 schema），
// `null` = 不可判定（契约禁 0 / 空串伪造），展示层显示 `—`。
// ══════════════════════════════════════════════════════════════════════════════

/** 设备健康（`metric_DeviceFact.health`）：三项都可能缺，**整块也可能是 `null`**（实测胖 AP 即如此） */
export interface MetricDeviceHealth {
	cpu_percent?: number | null
	mem_percent?: number | null
	temperature_c?: number | null
}

/**
 * 端口汇总（`metric_DeviceFact.interface_summary`；上游由端口现算，禁取 `ifNumber`）。
 * 实测除 `total` / `up` / `down` 外还带 `unknown` / `wired` / `wireless` / `filtered_others`。
 */
export interface MetricInterfaceSummary {
	total?: number
	up?: number
	down?: number
	unknown?: number | null
	wired?: number | null
	wireless?: number | null
	filtered_others?: number | null
}

/**
 * 硬件实体（`metric_DeviceFact.hw.entities[]`）：实测只有交换机报（36 台里 9 台，各 1 条），
 * `admin_status` / `oper_status` 是上游数值枚举，原样展示不映射。
 */
export interface MetricHwEntity {
	index?: string | null
	board_name?: string | null
	model_name?: string | null
	admin_status?: number | null
	oper_status?: number | null
}

/** 硬件 / 转发面事实（`metric_DeviceFact.hw`）：键恒在，值可能全为 `null` */
export interface MetricDeviceHardware {
	entities?: MetricHwEntity[] | null
	vlan_count?: number | null
	route_count?: number | null
	fdb_count?: number | null
	mstp_status?: string | null
}

/** 邻居分类计数（`metric_DeviceFact.neighbor_summary`） */
export interface MetricNeighborSummary {
	total?: number
	router?: number
	l3_switch?: number
	l2_switch?: number
	ap?: number
	sta?: number
}

/** 协议栈计数器（`metric_DeviceFact.protocol.{ip,icmp,tcp,udp}`）：逐项可为 `null`（不补 0） */
export interface MetricProtocolIpCounters {
	in_receives?: number | null
	in_hdr_errors?: number | null
	in_addr_errors?: number | null
	forw_datagrams?: number | null
	in_unknown_protos?: number | null
	in_discards?: number | null
	in_delivers?: number | null
	out_requests?: number | null
	out_discards?: number | null
	out_no_routes?: number | null
	routing_discards?: number | null
}

export interface MetricProtocolIcmpCounters {
	in_msgs?: number | null
	in_errors?: number | null
	in_dest_unreachs?: number | null
	in_time_excds?: number | null
	out_msgs?: number | null
	out_errors?: number | null
	out_dest_unreachs?: number | null
	out_time_excds?: number | null
}

export interface MetricProtocolTcpCounters {
	active_opens?: number | null
	passive_opens?: number | null
	attempt_fails?: number | null
	estab_resets?: number | null
	curr_estab?: number | null
	in_segs?: number | null
	out_segs?: number | null
	retrans_segs?: number | null
	in_errs?: number | null
	out_rsts?: number | null
}

export interface MetricProtocolUdpCounters {
	in_datagrams?: number | null
	no_ports?: number | null
	in_errors?: number | null
	out_datagrams?: number | null
}

export interface MetricDeviceProtocol {
	ip?: MetricProtocolIpCounters | null
	icmp?: MetricProtocolIcmpCounters | null
	tcp?: MetricProtocolTcpCounters | null
	udp?: MetricProtocolUdpCounters | null
}

/** LLDP 本机端口（`metric_DeviceFact.lldp.ports[]`）：只有标识，没有计数与状态 */
export interface MetricLldpLocalPort {
	port_num?: string | null
	port_id?: string | null
	port_id_subtype?: number | null
	port_desc?: string | null
}

/** LLDP 邻居（`metric_DeviceFact.lldp.neighbors[]`）：`local_port_num` 是**本机端口号**，与 `ports[].port_num` 同域 */
export interface MetricLldpNeighbor {
	sys_name?: string | null
	chassis_id?: string | null
	chassis_id_subtype?: number | null
	local_port_num?: string | null
	port_id?: string | null
	port_id_subtype?: number | null
	port_desc?: string | null
	sys_desc?: string | null
	man_addr?: string | null
}

/** LLDP 事实（`metric_DeviceFact.lldp`）：**整块可能是 `null`** = 该设备没上报 LLDP（不是失败） */
export interface MetricDeviceLldp {
	chassis_id?: string | null
	chassis_id_subtype?: number | null
	sys_desc?: string | null
	man_addr?: string | null
	man_addr_subtype?: number | null
	ports?: MetricLldpLocalPort[] | null
	neighbors?: MetricLldpNeighbor[] | null
}

/** 无线关联客户端（`metric_DeviceFact.radio.associations[]`）：`status` 是上游数值，原样展示 */
export interface MetricRadioAssociation {
	index?: string | null
	sta_name?: string | null
	sta_mac?: string | null
	rssi_dbm?: number | null
	tx_rate_mbps?: number | null
	status?: string | null
}

/** 无线多链路（MLO，`metric_DeviceFact.radio.multilinks[]`）：实测只有**终端**报（9 台共 15 条，1~2 条/台） */
export interface MetricRadioMultilink {
	index?: string | null
	band?: number | null
	channel?: number | null
	bssid?: string | null
	rssi_dbm?: number | null
	tx_rate_mbps?: number | null
	status?: string | null
}

/** 射频事实（`metric_DeviceFact.radio`）：非无线设备为 `null`；`mode` / `band` / `role` / `bss_type` 是上游枚举数值 */
export interface MetricDeviceRadio {
	role?: number | null
	ssid?: string | null
	mode?: number | null
	band?: number | null
	channel?: number | null
	frequency_mhz?: number | null
	bandwidth_mhz?: number | null
	tx_power_dbm?: number | null
	noise_dbm?: number | null
	interference_level?: number | null
	assoc_count?: number | null
	power_mgmt_mode?: number | null
	bss_type?: number | null
	supported_rates_tx_mbps?: number | null
	supported_rates_rx_mbps?: number | null
	operational_rates_mbps?: number[] | null
	associations?: MetricRadioAssociation[] | null
	/** MLO 多链路：AP 上报的从链路，逐条带 BSSID / 信道 / RSSI */
	multilinks?: MetricRadioMultilink[] | null
	/** 对端 AP：实测 9 台**终端**报（值是它关联的那个 AP），名称与 MAC 原样 */
	peer_ap_name?: string | null
	peer_ap_mac?: string | null
}

/**
 * 设备质量（`metric_DeviceFact.device_quality`）：这就是 1.0「探针质量」卡的对应字段 ——
 * 时延 / 抖动 / 丢包比（ppm）/ 指标新鲜度 / 对端数。整块可能缺。
 */
export interface MetricDeviceQuality {
	device_latency_us?: number | null
	device_jitter_us?: number | null
	device_loss_ratio_ppm?: number | null
	metric_age_sec?: number | null
	metric_valid?: number | null
	peer_count?: number | null
}

/** 仿真归属（`metric_DeviceFact.sim`）：真实设备为 `null` */
export interface MetricDeviceSim {
	session_id?: string | null
	scenario_name?: string | null
}

/** 设备流量（`metric_DeviceFact.traffic`；一期速率类恒 `null`） */
export interface MetricDeviceTraffic {
	in_bps?: number | null
	out_bps?: number | null
	total_bps?: number | null
	in_octets_total?: number | null
	out_octets_total?: number | null
}

/**
 * 设备台账条目（§九；`/metric/device` 的 `data.list[]`）。
 *
 * 字段清单按 **2026-11-08 实测响应**登记（`GET /api/v1/metric/device`，胖 AP 样本）：除左栏要用的
 * identity / health / interface_summary / traffic 之外，上游还给 `sys_*`、`hw`、`neighbors`、
 * `neighbor_summary`、`protocol.{ip,icmp,tcp,udp}`、`lldp.{ports,neighbors}`、`radio`、`device_quality`、
 * `quality`、`sim`、`jobs`。**这些是真来源，不能当成「2.0 没有端点」** —— 之前只登记前六个字段，
 * 详情页的协议 / 射频 / LLDP / 数据质量四页就被误判成缺口卡。
 */
export interface MetricDeviceFact {
	/** 设备主键（台账 `?id` 用它；缺失 ⇒ 条目丢弃） */
	device_code?: string
	/** 管理 IP：`/metric/name` 与 `/metric/datapoint` 的唯一入参；缺失 ⇒ 取不到时序 */
	mgmt_ip?: string | null
	role?: string
	vendor?: string
	model?: string | null
	sys_name?: string | null
	/** 系统描述（`sys_descr`）：设备自述，属数据，原样展示 */
	sys_descr?: string | null
	/** `sysObjectID`（原样字符串） */
	sys_object_id?: string | null
	/** 联系人（`sys_contact`）：属数据，原样展示 */
	sys_contact?: string | null
	/** 位置（`sys_location`）：属数据，原样展示 */
	sys_location?: string | null
	/** 启用的服务位图（`sys_services`）：上游数值，原样展示，不翻译 */
	sys_services?: number | null
	/** 运行时长（秒） */
	uptime_sec?: number | null
	/** 运行时长（`sysUpTime` ticks，百分之一秒）：与 `uptime_sec` 并存，展示层只用秒 */
	sys_uptime_ticks?: number | null
	/** `online` / `offline` / `degraded`（未知取值原样展示） */
	status?: string | null
	/** 健康三项；**整块可能是 `null`**（实测胖 AP 无 CPU / 内存 / 温度来源） */
	health?: MetricDeviceHealth | null
	/** 硬件事实；键恒在、值可能全 `null` */
	hw?: MetricDeviceHardware | null
	interface_summary?: MetricInterfaceSummary
	/** 邻居名称清单（`neighbors[]`）：来自拓扑发现，属数据 */
	neighbors?: string[] | null
	neighbor_summary?: MetricNeighborSummary | null
	traffic?: MetricDeviceTraffic
	/** 协议栈计数器（IP / ICMP / TCP / UDP） */
	protocol?: MetricDeviceProtocol | null
	/** LLDP 本机端点与邻居；`null` = 该设备没上报（不是失败） */
	lldp?: MetricDeviceLldp | null
	/** 仿真归属 */
	sim?: MetricDeviceSim | null
	/** 参与的采集作业（`jobs[]`，原样字符串）与锚点作业 */
	jobs?: string[] | null
	anchor_job?: string | null
	/** 射频事实；非无线设备为 `null` */
	radio?: MetricDeviceRadio | null
	/** 探针侧质量（时延 / 抖动 / 丢包 / 新鲜度 / 对端数） */
	device_quality?: MetricDeviceQuality | null
	/** 质量标记：只读，取值语义不在本层猜（原样展示键名） */
	quality?: Record<string, boolean> | null
}

/**
 * 链路单侧端点（`identity.{source,target}`）；**没有 `mgmt_ip`**，这是链路级时序缺口的根因。
 *
 * 字段清单按 **2026-11-08 实测 `/api/v1/metric/link`**（47 条）登记：除身份四件套之外，上游逐端还回
 * `if_mtu` / `if_phys_address` / `if_speed_bps` / `if_alias` / `if_last_change_ticks` / `in_octets` /
 * `out_octets`，`target` 侧的 `admin_status` / `capacity_mbps` / `if_phys_address` / `if_speed_bps`
 * 可能是 `null`（对端不在采集范围内）。
 */
export interface MetricLinkEndpoint {
	device_code?: string
	device_role?: string
	interface_id?: string
	if_index?: number | null
	interface_name?: string | null
	/** `ifAlias`：实测 47 条全为 `null`（设备没配描述） */
	if_alias?: string | null
	if_type?: number | null
	if_mtu?: number | null
	if_phys_address?: string | null
	if_speed_bps?: number | null
	if_last_change_ticks?: number | null
	in_octets?: number | null
	out_octets?: number | null
	medium?: string
	admin_status?: number | null
	oper_status?: number | null
	capacity_mbps?: number | null
	rssi_dbm?: number | null
	tx_rate_mbps?: number | null
}

/** 链路身份（`metric_LinkFact.identity`）：`link_id` 是 `A:port--B:port` 复合键，同一条链路两侧 47 条不重复 */
export interface MetricLinkIdentity {
	link_id?: string
	source?: MetricLinkEndpoint
	target?: MetricLinkEndpoint
	discovery?: string
	if_type?: number | null
	ssid?: string | null
}

/**
 * 链路当前值（`metric_LinkFact.metrics`；单位后缀强制，不可判定 ⇒ `null`）。
 *
 * 这份清单按 **2026-11-08 实测**对齐：之前只登记 12 个字段，于是「错误统计」与「链路质量」两页
 * 把 `in_errors` / `in_discards` / `in_ucast_pkts` / `probe_peer` / `rtt_mdev_us` / `*_age_sec` 等
 * **真实存在的字段**写成了「2.0 没有端点」的缺口卡（与设备页四页同源的误判）。
 */
export interface MetricLinkMetrics {
	status?: string | null
	graph_status?: string | null
	/** 图谱介质键（实测 `eth100m`）：与 `medium`（`ethernet`）不是同一个词表，两者都原样展示 */
	graph_medium?: string | null
	medium?: string | null
	bandwidth_mbps?: number | null
	traffic_in_mbps?: number | null
	traffic_out_mbps?: number | null
	bandwidth_usage_percent?: number | null
	latency_ms?: number | null
	jitter_ms?: number | null
	packet_loss_percent?: number | null
	error_rate_percent?: number | null
	rx_power_dbm?: number | null
	// ── 报文与错误计数（实测逐条都在，不可判定才是 null）────────────────────
	in_errors?: number | null
	out_errors?: number | null
	in_discards?: number | null
	out_discards?: number | null
	in_ucast_pkts?: number | null
	out_ucast_pkts?: number | null
	in_nucast_pkts?: number | null
	out_nucast_pkts?: number | null
	in_unknown_protos?: number | null
	out_qlen?: number | null
	// ── 探针侧与新鲜度（实测有值；`redundancy_state` / `real_if_index` 恒 null）──
	probe_peer?: string | null
	/** 探针方向（上游数值枚举，原样展示） */
	probe_dir?: number | null
	rtt_mdev_us?: number | null
	latency_age_sec?: number | null
	jitter_age_sec?: number | null
	loss_age_sec?: number | null
	rate_age_sec?: number | null
	metric_valid?: number | null
	real_if_index?: number | null
	redundancy_state?: string | null
}

/** 链路台账条目（§九；`/metric/link` 的 `data.list[]`） */
export interface MetricLinkFact {
	identity?: MetricLinkIdentity
	metrics?: MetricLinkMetrics
	/** 参与的采集作业（`jobs[]`，实测一条链路跨 2~3 个 job，原样字符串） */
	jobs?: string[] | null
	/** 质量标记（只读；本层不据此派生契约字段） */
	quality?: Record<string, boolean> | null
}

/** 台账分页信封（两条端点同构）：`total` 是**命中总数**，不是本页条数 */
export interface MetricLedgerData<TFact> {
	list?: TFact[] | null
	page?: number
	page_size?: number
	total?: number
	/** ISO 8601（UTC） */
	generated_at?: string
}
