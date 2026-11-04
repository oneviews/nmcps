// layers/system/app/utils/auditDisplay.ts
// 审计日志（`/system/log`）的展示口径：枚举 → 颜色、时间格式、行摘要、筛选参数换算。
//
// 设计基准：NMCPS-DESIGN-005 §9.2 / §9.3（layers/content/collections/cn/architecture/2.domain/system.md）
//
// 与旧代的差别（NMCPS-ADR-0018 §三）：`category`（`session` / `api`）与 `result`（`1` / `2`）
// 都是旧代字段，新代用「端点」区分日志族、用字符串 `status` / `auth_decision` 表达结果；
// 后两者的**取值集合未实测**（审计库为空），所以这里只做「常见取值的染色 + 其余原样展示」，
// 绝不把未知值猜成「成功」或「失败」。
import type {
	AuditArchiveRecord,
	AuditLogKind,
	AuditOperationLog,
	AuditSecurityLog
} from "~~/shared/types/audit";
import { AUDIT_LOG_KIND } from "~~/shared/types/audit";

/** 徽标色调：与 `UBadge` 的 `color` 同集合的子集 */
export type AuditTone = "success" | "error" | "warning" | "neutral" | "info";

/** 取记录里的字符串字段（缺失 / 非字符串 → 空串），供摘要与详情统一取用 */
export function auditField(record: Record<string, unknown>, key: string): string {
	const value = record[key];
	if (value === undefined || value === null)
		return "";
	return typeof value === "string" ? value : String(value);
}

/** 视为「成功 / 放行」的取值：只认得归档记录实测的 `success` 与同类拼写 */
const AUDIT_OK = new Set(["success", "succeeded", "ok", "allow", "allowed", "pass", "passed", "1"]);

/** 视为「失败 / 拒绝」的取值 */
const AUDIT_BAD = new Set(["fail", "failed", "failure", "deny", "denied", "error", "blocked", "2"]);

/**
 * 结果 / 判定 → 色调。
 *
 * 未知取值一律 `neutral`：上游没文档化取值集合，染色只是在「认得的取值」上给个提示，
 * 认不出时不下结论（旧代把未知 `result` 染成中性，这里沿用同一态度）。
 */
export function auditStatusTone(value: string): AuditTone {
	const normalised = value.trim().toLowerCase();
	if (AUDIT_OK.has(normalised))
		return "success";
	if (AUDIT_BAD.has(normalised))
		return "error";
	return "neutral";
}

/**
 * 展示用时间：`2026-11-02T03:15:09+08:00` → `2026-11-02 03:15:09`。
 *
 * 只做格式裁剪，**不做时区换算**：上游回的是带偏移的本地时，换算到浏览器时区会让同一份日志
 * 在不同机器上显示不同的钟点，与账号 / 策略页的口径也不一致。
 */
export function auditTimeOf(value: string): string {
	if (!value)
		return "—";

	const matched = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/.exec(value);
	return matched ? `${matched[1]} ${matched[2]}` : value;
}

/**
 * `datetime-local` 的 `YYYY-MM-DDTHH:mm[:ss]` → **epoch 毫秒**。
 *
 * 新代的时间边界是整数（`created_from` / `created_to` / `logged_from` / `logged_to`），
 * `/audit/statistics` 的 openapi 明写「unix milli」，同服务族按同一口径处理。
 * `Date.parse()` 对不带偏移的日期时间按**本地时**解释，正好是用户在控件里选的那个钟点，
 * 不需要（也不应该）走 `toISOString()` 那样强行换成 UTC 字面值。
 */
export function auditEpochMs(value: string): number | undefined {
	const trimmed = value.trim();
	if (!trimmed)
		return undefined;

	const withSeconds = trimmed.length === 16 ? `${trimmed}:00` : trimmed;
	const parsed = Date.parse(withSeconds);
	return Number.isNaN(parsed) ? undefined : parsed;
}

/** 区间是否反了（同一格式的字符串可直接比较）：反了上游只回空集，页面先提示 */
export function auditRangeReversed(start: string, end: string): boolean {
	return !!start && !!end && start > end;
}

/**
 * 时间范围的快捷项（工具栏左区常驻控件的候选值，NMCPS-DESIGN-005 §9.3 第 2 条）。
 *
 * `all` = 不设边界；其余是「从现在往回推」的定长窗口。键名与
 * `pages.system-log.filter.range.*` 一一对应，加减项必须两边同时改。
 */
export const AUDIT_RANGE_PRESETS = ["all", "15m", "1h", "24h", "7d"] as const;
export type AuditRangePreset = typeof AUDIT_RANGE_PRESETS[number];

/** 各快捷项的窗口长度（毫秒）：`all` 无边界，故不进表 */
const PRESET_SPAN_MS: Record<Exclude<AuditRangePreset, "all">, number> = {
	"15m": 15 * 60_000,
	"1h": 60 * 60_000,
	"24h": 24 * 60 * 60_000,
	"7d": 7 * 24 * 60 * 60_000
};

/** `Date` → `datetime-local` 认的 `YYYY-MM-DDTHH:mm`（浏览器本地时，分钟精度） */
function toDatetimeLocal(value: Date): string {
	const pad = (input: number) => String(input).padStart(2, "0");
	return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

/**
 * 快捷区间 → 两个 `datetime-local` 值（喂 `startFilter` / `endFilter`）。
 *
 * 只做「本地时往回减」，不做时区换算：窗口是用户看到的字面钟点，
 * 换算成毫秒发生在 `auditEpochMs()` 这一步，且仍以本地时解释。
 */
export function auditQuickRange(preset: AuditRangePreset, now: Date = new Date()): { start: string, end: string } {
	if (preset === "all")
		return { start: "", end: "" };

	return {
		start: toDatetimeLocal(new Date(now.getTime() - PRESET_SPAN_MS[preset])),
		end: toDatetimeLocal(now)
	};
}

/**
 * 工具栏时间范围控件的值（`components/Audit/RangePicker.vue`）。
 *
 * 三个字段同源：`start` / `end` 是 `datetime-local` 字面值（喂 `startFilter` / `endFilter`），
 * `preset` 只决定按钮文案与快捷项高亮，`custom` = 手选了日历日期或手改了时间。
 */
export interface AuditRangeValue {
	start: string
	end: string
	preset: AuditRangePreset | "custom"
}

/**
 * 日历里的某一天 → `datetime-local` 边界值（整天窗口，含首尾两端）。
 *
 * 收尾用 `23:59:59` 而不是 `23:59`：页面按秒给出窗口，
 * 少 59 秒会把当天最后半分钟的记录筛掉（`auditEpochMs()` 认这个 19 位格式）。
 */
export function auditDayBound(day: string, edge: "start" | "end"): string {
	return `${day}T${edge === "start" ? "00:00:00" : "23:59:59"}`;
}

/** 列表行的摘要（三族字段不同，行渲染统一走这里，模板里不写三套分支） */
export interface AuditRowView {
	/** 记录主键，同时是详情端点的路径段与 `?id` 的取值 */
	id: string
	/** 主标题：这一行「是什么」 */
	title: string
	/** 副标题：时间 · 归属 · 次要标识（缺失项自动省略） */
	subtitle: string
	/** 结果 / 判定徽标的文本（空串 = 不渲染徽标） */
	badge: string
	/** 徽标色调 */
	tone: AuditTone
}

/** 把「有值的片段」用 ` · ` 连起来，空片段直接跳过（不产出 `· ·`） */
function joinParts(parts: string[]): string {
	return parts.filter((part) => !!part).join(" · ");
}

/**
 * 记录 → 列表行摘要。
 *
 * 三族的**主标题与副标题来源不同**：操作日志看 `operation`、安全日志看 `action`、
 * 归档记录看 `table_name`。每个字段都可能缺失（操作 / 安全日志的条目字段集合未实测），
 * 所以全部走「有值才显示、都没有就回落到 `id`」——行永远可读、且不假装有数据。
 */
export function auditRowOf(
	kind: AuditLogKind,
	record: AuditOperationLog | AuditSecurityLog | AuditArchiveRecord
): AuditRowView {
	const raw = record as unknown as Record<string, unknown>;
	const id = auditField(raw, "id");

	if (kind === AUDIT_LOG_KIND.ARCHIVE) {
		const rows = auditField(raw, "rows_archived");
		return {
			id,
			title: auditField(raw, "table_name") || id,
			subtitle: joinParts([
				auditTimeOf(auditField(raw, "created_at")),
				rows ? `${rows} 行` : ""
			]),
			badge: auditField(raw, "status"),
			tone: auditStatusTone(auditField(raw, "status"))
		};
	}

	if (kind === AUDIT_LOG_KIND.SECURITY) {
		const decision = auditField(raw, "auth_decision");
		return {
			id,
			title: auditField(raw, "action") || auditField(raw, "subject_name") || id,
			subtitle: joinParts([
				auditTimeOf(auditField(raw, "logged_at")),
				auditField(raw, "subject_name"),
				auditField(raw, "resource")
			]),
			badge: decision,
			tone: auditStatusTone(decision)
		};
	}

	const status = auditField(raw, "status");
	return {
		id,
		title: auditField(raw, "operation") || auditField(raw, "target_type") || id,
		subtitle: joinParts([
			auditTimeOf(auditField(raw, "created_at")),
			auditField(raw, "module"),
			auditField(raw, "username")
		]),
		badge: status,
		tone: auditStatusTone(status)
	};
}

/**
 * 详情栏要渲染的字段清单（顺序即展示顺序），`label` 是 `pages.system-log.*` 下的后缀。
 *
 * 只列「已登记字段」；记录里出现的**未登记字段**由页面单独成段原样展示
 * （`auditExtraFields()`），这样上游加字段时页面不会静默吞掉它。
 */
export const AUDIT_DETAIL_FIELDS: Record<AuditLogKind, { key: string, label: string }[]> = {
	[AUDIT_LOG_KIND.OPERATION]: [
		{ key: "user_id", label: "detail.userId" },
		{ key: "username", label: "detail.username" },
		{ key: "module", label: "detail.module" },
		{ key: "operation", label: "detail.operation" },
		{ key: "target_type", label: "detail.targetType" },
		{ key: "target_id", label: "detail.targetId" },
		{ key: "status", label: "detail.status" },
		{ key: "ip_address", label: "detail.ip" },
		{ key: "trace_id", label: "detail.trace" },
		{ key: "created_at", label: "detail.time" }
	],
	[AUDIT_LOG_KIND.SECURITY]: [
		{ key: "subject_type", label: "detail.subjectType" },
		{ key: "subject_id", label: "detail.subjectId" },
		{ key: "subject_name", label: "detail.subjectName" },
		{ key: "action", label: "detail.action" },
		{ key: "resource", label: "detail.resource" },
		{ key: "auth_decision", label: "detail.authDecision" },
		{ key: "ip_address", label: "detail.ip" },
		{ key: "trace_id", label: "detail.trace" },
		{ key: "logged_at", label: "detail.time" }
	],
	[AUDIT_LOG_KIND.ARCHIVE]: [
		{ key: "table_name", label: "detail.tableName" },
		{ key: "archive_batch", label: "detail.archiveBatch" },
		{ key: "rows_archived", label: "detail.rowsArchived" },
		{ key: "status", label: "detail.status" },
		{ key: "cutoff_before", label: "detail.cutoffBefore" },
		{ key: "started_at", label: "detail.startedAt" },
		{ key: "finished_at", label: "detail.finishedAt" },
		{ key: "created_at", label: "detail.time" }
	]
};

/**
 * 记录里**不在字段清单里**的字段（键值对，保持上游顺序）。
 *
 * 用途：操作 / 安全日志的条目字段集合未实测（见 `shared/types/audit.ts` 文件头），
 * 上游多给的字段不该被页面静默丢掉 —— 单独一段原样列出，比「猜它是哪个字段」诚实。
 */
export function auditExtraFields(
	kind: AuditLogKind,
	record: Record<string, unknown>
): { key: string, value: string }[] {
	const known = new Set(["id", ...AUDIT_DETAIL_FIELDS[kind].map((field) => field.key)]);

	return Object.entries(record)
		.filter(([key]) => !known.has(key))
		.map(([key, value]) => ({ key, value: value === null || value === undefined ? "" : String(value) }));
}
