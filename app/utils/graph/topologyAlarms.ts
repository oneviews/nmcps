// app/utils/graph/topologyAlarms.ts
// 告警角标读表（**纯函数**，零 I/O、零状态）：把 `/api/alarm/alarm-events` 的 firing 事件按**节点 id**
// 聚成角标读数，供画布角标与详情栏共用同一份表。
//
// 设计基准：NMCPS-DESIGN-001 §6.1「告警叠加」（`target_type` + `target_id` 用于节点角标）与
// §6.11 的取证口径；字段实测结论见 `shared/types/alarm.ts` 文件头。三条硬约束：
//
//   ① **只认 join 得上的目标**：`target_id` 为空 / 不在当前画布上的事件不参与聚合（§6.1 的
//      `target_id` 就是节点 id 的前提是「这个 id 在图上」，不在图上的 43 个目标没有角标可挂）；
//   ② **未知严重度不升级**：未登记取值归 `info`（最低档），绝不因为「看不清」就画成 critical；
//   ③ **角标只报计数与最高档**：`severity` = 该节点 firing 事件里最高的那一档（critical > warning > info），
//      详情栏再按同一顺序列出原文 —— 两处读的是同一份排序结果，不各算一次。
import type { AlarmEvent, AlarmSeverity } from "~~/shared/types/alarm";
import type { StatusColor } from "./topologyStatusStyle";

/** 严重度排序权重（角标取最高档、详情栏按它降序排） */
const SEVERITY_RANK: Record<AlarmSeverity, number> = {
	critical: 3,
	warning: 2,
	info: 1
};

/** 单节点角标读数 */
export interface NodeAlarmSummary {
	/** firing 事件数（角标数字） */
	count: number
	/** 最高严重度（角标颜色） */
	severity: AlarmSeverity
	/** 该节点的事件（已按「严重度降序 → 最近触发降序」排好） */
	events: AlarmEvent[]
}

/** 节点 id → 角标读数（只在有 firing 事件的节点上出现键） */
export type TopologyAlarmIndex = Record<string, NodeAlarmSummary>;

/** 详情栏最多列几条（余下的归到「还有 N 条」，不把卡片撑成一页日志） */
export const ALARM_EVENTS_SHOWN = 3;

function readText(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readCount(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/** 严重度收窄：登记三档之外一律 `info`（口径 ②） */
export function normalizeAlarmSeverity(value: unknown): AlarmSeverity {
	const text = readText(value)?.toLowerCase();
	return text === "critical" || text === "warning" || text === "info" ? text : "info";
}

/** 角标颜色：与节点状态色同词表（`StatusColor`），`info` 复用中性色 */
export function alarmSeverityColor(severity: AlarmSeverity): StatusColor {
	if (severity === "critical")
		return "error";
	if (severity === "warning")
		return "warning";
	return "neutral";
}

/**
 * 角标圆点填充类（画布 SVG 用）。
 *
 * 与 `alarmSeverityColor()` 一一对应，只是形状不同：徽标要语义色名，SVG 要 `fill-(--ui-*)` 类。
 * 两处都由本文件给出，避免「徽标是橙的、圆点是绿的」。
 */
const ALARM_BADGE_FILL: Record<AlarmSeverity, string> = {
	critical: "fill-(--ui-error)",
	warning: "fill-(--ui-warning)",
	info: "fill-(--ui-info)"
};

export function alarmBadgeFillClass(severity: AlarmSeverity): string {
	return ALARM_BADGE_FILL[severity];
}

/** 角标数字：三位以内原样，超出写 `99+`（角标是读数不是报表） */
export function alarmBadgeText(count: number): string {
	return count > 99 ? "99+" : `${count}`;
}

/** 事件时间：直接切上游 ISO 字符串的 `MM-DD HH:mm`（不转时区、不重排，避免二次解释） */
export function alarmTimeText(iso: string | null): string {
	if (!iso)
		return "—";
	const match = /^\d{4}-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(iso);
	return match ? `${match[1]}-${match[2]} ${match[3]}:${match[4]}` : iso;
}

/**
 * 解包 + 收窄：接受 `{ list: [...] }` 信封或裸数组，只留 `firing` 且 `target_id` 非空的事件。
 *
 * `status` 缺省时**按 firing 处理**（上游没给状态 ≠ 已恢复）；显式给了非 firing 的才丢掉。
 */
export function normalizeAlarmEvents(payload: unknown): AlarmEvent[] {
	const source = Array.isArray(payload)
		? payload
		: Array.isArray((payload as { list?: unknown } | null)?.list)
			? (payload as { list: unknown[] }).list
			: [];

	const events: AlarmEvent[] = [];
	for (const raw of source) {
		if (!raw || typeof raw !== "object")
			continue;

		const item = raw as Record<string, unknown>;
		const status = (readText(item.status) ?? "firing").toLowerCase();
		const targetId = readText(item.target_id);
		const message = readText(item.message);
		if (status !== "firing" || !targetId || !message)
			continue;

		events.push({
			id: readText(item.id) ?? `${targetId}#${events.length}`,
			severity: normalizeAlarmSeverity(item.severity),
			severityRaw: readText(item.severity) ?? "",
			status,
			eventType: readText(item.event_type),
			targetType: readText(item.target_type),
			targetId,
			targetName: readText(item.target_name),
			message,
			firstTriggeredAt: readText(item.first_triggered_at),
			lastTriggeredAt: readText(item.last_triggered_at),
			triggerCount: readCount(item.trigger_count)
		});
	}

	return events;
}

/** 排序：严重度降序 → 最近触发降序（同一批 ISO 字符串可直接比大小，不解析时间） */
function compareEvents(a: AlarmEvent, b: AlarmEvent): number {
	const bySeverity = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
	if (bySeverity !== 0)
		return bySeverity;
	return (b.lastTriggeredAt ?? "").localeCompare(a.lastTriggeredAt ?? "");
}

/**
 * 聚合：节点 id → 角标读数。
 *
 * `keep` 是「当前画布上真实存在的节点 id」集合：传了就只保留 join 得上的目标（口径 ①），
 * 不传则全部保留（分组卡片 / 页头这类「不依赖画布」的读数用得到）。
 */
export function alarmIndexOf(events: readonly AlarmEvent[], keep?: ReadonlySet<string>): TopologyAlarmIndex {
	const index: TopologyAlarmIndex = {};
	for (const event of events) {
		if (keep && !keep.has(event.targetId))
			continue;

		const current = index[event.targetId];
		if (!current) {
			index[event.targetId] = { count: 1, severity: event.severity, events: [event] };
			continue;
		}

		current.count += 1;
		current.events.push(event);
		if (SEVERITY_RANK[event.severity] > SEVERITY_RANK[current.severity])
			current.severity = event.severity;
	}

	for (const summary of Object.values(index))
		summary.events.sort(compareEvents);

	return index;
}

/** 取某个节点的角标读数；没有 firing 事件时返回 `null`（画布据此不画角标） */
export function alarmsOfNode(index: TopologyAlarmIndex, nodeId: string | null | undefined): NodeAlarmSummary | null {
	if (!nodeId)
		return null;
	return index[nodeId] ?? null;
}

/** 详情栏要列的那几条 + 「还有 N 条」的后半句数据（不在此处拼 i18n 文案） */
export function alarmEventsShown(summary: NodeAlarmSummary | null): { shown: AlarmEvent[], hidden: number } {
	if (!summary)
		return { shown: [], hidden: 0 };
	return {
		shown: summary.events.slice(0, ALARM_EVENTS_SHOWN),
		hidden: Math.max(0, summary.events.length - ALARM_EVENTS_SHOWN)
	};
}
