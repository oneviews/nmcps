// layers/system/app/utils/auditDisplay.ts
// 审计日志（`/system/log`）的展示口径：枚举 → i18n 键、时间格式、筛选参数换算。
//
// 设计基准：NMCPS-DESIGN-005 §9.2（layers/content/collections/cn/architecture/2.domain/system.md）
// 缺陷背景：NMCPS-REC-004 —— `category` 大小写敏感且未知值被静默忽略（UP-AUD-02）、
// 时间筛选同时接受空格格式与 RFC3339（UP-AUD-04）、未知 `result` 无语义（页面不猜）。
import { AUDIT_CATEGORY, AUDIT_RESULT } from "~~/shared/types/audit";

/** 类别 → i18n 键：只承认 `session` / `api`，其余（含大写、空串）走 `unknown` 并带出原值 */
export function auditCategoryKey(category: string): string {
	switch (category) {
		case AUDIT_CATEGORY.SESSION:
			return "pages.system-log.category.session";
		case AUDIT_CATEGORY.API:
			return "pages.system-log.category.api";
		default:
			return "pages.system-log.category.unknown";
	}
}

/** 类别 → badge 颜色（会话蓝、接口中性、未知警告色） */
export function auditCategoryColor(category: string): "info" | "neutral" | "warning" {
	switch (category) {
		case AUDIT_CATEGORY.SESSION:
			return "info";
		case AUDIT_CATEGORY.API:
			return "neutral";
		default:
			return "warning";
	}
}

/** 结果 → i18n 键（`1` 成功 / `2` 失败；其余取值不猜语义） */
export function auditResultKey(result: number): string {
	switch (result) {
		case AUDIT_RESULT.SUCCESS:
			return "pages.system-log.result.success";
		case AUDIT_RESULT.FAILURE:
			return "pages.system-log.result.failure";
		default:
			return "pages.system-log.result.unknown";
	}
}

/** 结果 → badge 颜色（成功绿、失败红、未知中性） */
export function auditResultColor(result: number): "success" | "error" | "neutral" {
	switch (result) {
		case AUDIT_RESULT.SUCCESS:
			return "success";
		case AUDIT_RESULT.FAILURE:
			return "error";
		default:
			return "neutral";
	}
}

/**
 * 展示用时间：`2026-11-02T03:15:09+08:00` → `2026-11-02 03:15:09`。
 *
 * 只做格式裁剪，**不做时区换算**：上游回的是带偏移的本地时，换算到浏览器时区会让同一份日志
 * 在不同机器上显示不同的钟点，与账号 / 策略页的口径也不一致（NMCPS-REC-002 UP-ACC-05 同理）。
 */
export function auditTimeOf(value: string): string {
	if (!value)
		return "—";

	const matched = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/.exec(value);
	return matched ? `${matched[1]} ${matched[2]}` : value;
}

/**
 * `datetime-local` 的 `YYYY-MM-DDTHH:mm` → 上游接受的 `YYYY-MM-DD HH:MM:SS`。
 *
 * 上游两种格式都收（UP-AUD-04），这里固定用不带偏移的空格格式：浏览器本地时原样发出，
 * 不会被 `toISOString()` 悄悄换成 UTC。
 */
export function toAuditTimeParam(value: string): string | undefined {
	const trimmed = value.trim();
	if (!trimmed)
		return undefined;

	const withSeconds = trimmed.length === 16 ? `${trimmed}:00` : trimmed;
	return withSeconds.replace("T", " ");
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
 * 只做「本地时往回减」，**不做时区换算**：与 `toAuditTimeParam()` 同一口径，窗口是字面值，
 * 免得 `toISOString()` 顺手把整段挪 8 小时（上游只认字面值，UP-AUD-04）。
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
 * 收尾用 `23:59:59` 而不是 `23:59`：上游按字面值比较（UP-AUD-04），少 59 秒会把当天
 * 最后半分钟的记录筛掉。`toAuditTimeParam()` 认这个 19 位格式，原样发成 `YYYY-MM-DD HH:MM:SS`。
 */
export function auditDayBound(day: string, edge: "start" | "end"): string {
	return `${day}T${edge === "start" ? "00:00:00" : "23:59:59"}`;
}

/** `datetime-local` 值 → 展示文本（详情 / 对话框里说明「本次校验窗口」用） */
export function auditRangeLabel(start: string, end: string): string {
	const left = start ? start.replace("T", " ") : "…";
	const right = end ? end.replace("T", " ") : "…";
	return `${left} → ${right}`;
}
