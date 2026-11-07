// shared/types/alarm.ts
// 告警事件契约（上游 `GET /api/v1/alarm/alarm-events` ↔ BFF `/api/alarm/alarm-events`）。
//
// 设计基准：NMCPS-DESIGN-001 §6.1「告警叠加」；字段口径是 2026-11-07 对现网**实测原样**：
//
//   ① 响应 `data` 是分页信封 `{ list, page, page_size, total }`，且 `status` 过滤在**上游**生效
//      （同一时刻不带过滤 185 条、带 `status=firing` 77 条）—— 页面只取 firing，不自己筛；
//   ② `target_type` 实测**只有 `device`**（旧文档写的 `node` 不存在），`target_id` 就是设备管理 IP，
//      正好等于 8888 拓扑节点的 `id`（§6.10「节点 id 是管理 IP」）—— 对齐不需要额外映射表；
//   ③ 77 条 firing 里 9 条 `target_id` 是空串、另有 43 个目标（`10.1.0.x` / `10.2.0.x` 段）不在当前
//      36 节点图上 —— 这些一律**不落角标**（把空 id 聚成一个「未知节点」角标就是编数据）；
//   ④ `severity` 实测只有 `critical` / `warning`（54 / 23）；本文件仍接受 `info`，未登记取值归到 `info`
//      （最低档：宁可显示得轻，也不能把未知升级成 critical）。
//
// 本域只读：规则管理 / 抑制 / 通知都不属拓扑监控（DESIGN-001 §二）。

/** 告警严重度（上游实测 `critical` / `warning`；`info` 是兜底档，见文件头 ④） */
export const ALARM_SEVERITIES = ["critical", "warning", "info"] as const;
export type AlarmSeverity = (typeof ALARM_SEVERITIES)[number];

/** 告警事件状态（页面只消费 `firing`；其余原样保留但不展示） */
export const ALARM_EVENT_STATUSES = ["firing", "resolved", "suppressed", "closed"] as const;
export type AlarmEventStatus = (typeof ALARM_EVENT_STATUSES)[number];

/**
 * 告警事件（`data.list[]` 的一项）。
 *
 * 只登记页面真的读的字段：`context` / `related_events` / `rule_id` 等原样留在上游，
 * 这里不解包（`context` 是字符串化的 JSON，解析它属于告警域自己的事，不是拓扑页的活）。
 */
export interface AlarmEvent {
	/** 事件 id（`5c8c44de-…`） */
	id: string
	/** 严重度（收窄走 `normalizeAlarmSeverity()`） */
	severity: AlarmSeverity
	/** 上游严重度原样（未知取值时与本条的 `severity` 不同，提示「这是兜底档」） */
	severityRaw: string
	/** 事件状态（`firing` 才进角标） */
	status: string
	/** 事件类型（`wired_cpu_high` / `device_offline` …，上游原样，属数据不翻译） */
	eventType: string | null
	/** 目标类型（实测只有 `device`） */
	targetType: string | null
	/** 目标 id = 设备管理 IP = 拓扑节点 `id` */
	targetId: string
	/** 目标名（上游原样；部分事件没有） */
	targetName: string | null
	/** 事件描述（上游原话，**逐字展示**，不翻译、不改写） */
	message: string
	/** 首次触发时间（上游 ISO 字符串，原样） */
	firstTriggeredAt: string | null
	/** 最近触发时间（上游 ISO 字符串，原样） */
	lastTriggeredAt: string | null
	/** 触发次数（上游给的计数） */
	triggerCount: number | null
}

/** `GET /api/alarm/alarm-events` 的 `data` 信封 */
export interface AlarmEventPage {
	list: AlarmEvent[]
	page: number
	page_size: number
	total: number
}
