// shared/types/metric.ts
// 指标契约（`NMCPS-CONTRACT-002`）在 2.0 的类型落点：
//   §二 指标类型（`MetricType`）、§三 可查询性三分类（`MetricCatalogKind`）、
//   §五 数据点（`MetricDatapoint`）、§六 `/metric/datapoint` 取数口径（`MetricDatapointData`）、
//   §七 指标名清单（`/metric/name` 的 `MetricNameData` + 双形态条目 `RawMetricItem`）。
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
