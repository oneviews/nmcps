// app/utils/metric/metricFormat.ts
// 指标展示层的数值格式化（纯函数，无 i18n）：**`null` / 非有限值一律 `—`**。
//
// 这条规则不是排版偏好，是契约（`NMCPS-CONTRACT-002` §6.3 / §九）：
// `null` 表示「不可判定」，写成 `0` 就是伪造事实；空串同理。带单位的后缀（`%` / `ms` / `Mbps` /
// `dBm` / `bps`）是**单位符号**，属数据不属文案，因此不进 `i18n/locales`。

/** 不可判定的统一占位符（全站同一字符，便于断言） */
export const METRIC_DASH = "—";

/** 原样文本：`null` / 空串 / 非字符串 ⇒ `—`（不把缺失写成空单元格） */
export function textOrDash(value: string | null | undefined): string {
	const text = typeof value === "string" ? value.trim() : "";
	return text || METRIC_DASH;
}

/** 百分数：`12.3%`；`null` ⇒ `—` */
export function formatPercent(value: number | null | undefined, digits = 1): string {
	return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(digits)}%` : METRIC_DASH;
}

/** 毫秒：`1.2 ms`；`null` ⇒ `—` */
export function formatMillis(value: number | null | undefined, digits = 1): string {
	return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(digits)} ms` : METRIC_DASH;
}

/**
 * Mbps：后端 `*_mbps` 字段**已经是 Mbps**，不再按 bps 换算（换错量级比缺数更糟）。
 * 小数位随量级走（>=100 一位、>=1 两位、其余四位），小流量不会显示成 `0.0 Mbps`。
 */
export function formatMbps(value: number | null | undefined): string {
	if (typeof value !== "number" || !Number.isFinite(value))
		return METRIC_DASH;
	if (value >= 100)
		return `${value.toFixed(1)} Mbps`;
	if (value >= 1)
		return `${value.toFixed(2)} Mbps`;

	return `${value.toFixed(4)} Mbps`;
}

/** dBm：`-62 dBm`；`null` ⇒ `—` */
export function formatDbm(value: number | null | undefined, digits = 1): string {
	return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(digits)} dBm` : METRIC_DASH;
}

/** 摄氏度：`45.0 °C`；`null` ⇒ `—`（不要用 `formatPercent` 顶替，`%` 不是温度的单位） */
export function formatCelsius(value: number | null | undefined, digits = 1): string {
	return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(digits)} °C` : METRIC_DASH;
}

/** 计数：千分位整数；`null` ⇒ `—` */
export function formatCount(value: number | null | undefined): string {
	return typeof value === "number" && Number.isFinite(value) ? Math.round(value).toLocaleString("en-US") : METRIC_DASH;
}

/** 速率（bps）：按量级选 `bps` / `Kbps` / `Mbps` / `Gbps`；`null` ⇒ `—` */
export function formatBps(value: number | null | undefined): string {
	if (typeof value !== "number" || !Number.isFinite(value))
		return METRIC_DASH;
	if (value >= 1e9)
		return `${(value / 1e9).toFixed(2)} Gbps`;
	if (value >= 1e6)
		return `${(value / 1e6).toFixed(2)} Mbps`;
	if (value >= 1e3)
		return `${(value / 1e3).toFixed(1)} Kbps`;

	return `${Math.round(value)} bps`;
}

/**
 * 值 + 指标单位（单位来自目录 `unit` 字段，属数据不属文案；没有单位就只给数字，**不猜单位**）。
 * 小数位：整数原样，其余最多两位且去掉尾随 0（`1.2300` → `1.23`，`10.0` → `10`）。
 */
export function formatValueWithUnit(value: number | null | undefined, unit: string): string {
	if (typeof value !== "number" || !Number.isFinite(value))
		return METRIC_DASH;

	const text = Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
	return unit ? `${text} ${unit}` : text;
}

/** 采样时刻（毫秒 → 本地 `HH:MM:SS`）；`null` ⇒ `—`（不写「刚刚」这类伪造新鲜度的词） */
export function formatSampleTime(value: number | null | undefined): string {
	if (typeof value !== "number" || !Number.isFinite(value))
		return METRIC_DASH;

	return new Date(value).toLocaleTimeString(undefined, { hour12: false });
}

/** 运行时长拆分（天 / 时 / 分）：单位文案在组件里按 i18n 拼，这里只给数字 */
export interface DurationParts {
	days: number
	hours: number
	minutes: number
}

export function splitDuration(seconds: number | null | undefined): DurationParts | null {
	if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0)
		return null;

	const total = Math.floor(seconds);
	return {
		days: Math.floor(total / 86_400),
		hours: Math.floor((total % 86_400) / 3600),
		minutes: Math.floor((total % 3600) / 60)
	};
}
