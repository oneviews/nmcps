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
// `layers/topology/app/composables/useNodeTrend.ts`。
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
	meta_source: "l1" | "backend" | "name-only"
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

/** 设备健康（`metric_DeviceFact.health`）：三项都可能缺 */
export interface MetricDeviceHealth {
	cpu_percent?: number | null
	mem_percent?: number | null
	temperature_c?: number | null
}

/** 端口汇总（`metric_DeviceFact.interface_summary`；上游由端口现算，禁取 `ifNumber`） */
export interface MetricInterfaceSummary {
	total?: number
	up?: number
	down?: number
}

/** 设备流量（`metric_DeviceFact.traffic`；一期速率类恒 `null`） */
export interface MetricDeviceTraffic {
	in_bps?: number | null
	out_bps?: number | null
	total_bps?: number | null
	in_octets_total?: number | null
	out_octets_total?: number | null
}

/** 设备台账条目（§九；`/metric/device` 的 `data.list[]`） */
export interface MetricDeviceFact {
	/** 设备主键（台账 `?id` 用它；缺失 ⇒ 条目丢弃） */
	device_code?: string
	/** 管理 IP：`/metric/name` 与 `/metric/datapoint` 的唯一入参；缺失 ⇒ 取不到时序 */
	mgmt_ip?: string | null
	role?: string
	vendor?: string
	model?: string | null
	sys_name?: string | null
	/** `online` / `offline` / `degraded`（未知取值原样展示） */
	status?: string | null
	uptime_sec?: number | null
	health?: MetricDeviceHealth
	interface_summary?: MetricInterfaceSummary
	traffic?: MetricDeviceTraffic
}

/** 链路单侧端点（`identity.{source,target}`）；**没有 `mgmt_ip`**，这是链路级时序缺口的根因 */
export interface MetricLinkEndpoint {
	device_code?: string
	device_role?: string
	interface_id?: string
	if_index?: number | null
	interface_name?: string | null
	medium?: string
	oper_status?: number | null
	capacity_mbps?: number | null
	rssi_dbm?: number | null
	tx_rate_mbps?: number | null
}

/** 链路身份（`metric_LinkFact.identity`）：`link_id` 两侧字典序 ⇒ 交换不变 */
export interface MetricLinkIdentity {
	link_id?: string
	source?: MetricLinkEndpoint
	target?: MetricLinkEndpoint
	discovery?: string
	ssid?: string | null
}

/** 链路当前值（`metric_LinkFact.metrics`；单位后缀强制，不可判定 ⇒ `null`） */
export interface MetricLinkMetrics {
	status?: string | null
	graph_status?: string | null
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
}

/** 链路台账条目（§九；`/metric/link` 的 `data.list[]`） */
export interface MetricLinkFact {
	identity?: MetricLinkIdentity
	metrics?: MetricLinkMetrics
	/** 质量标记（只读；本层不据此派生契约字段） */
	quality?: Record<string, boolean>
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
