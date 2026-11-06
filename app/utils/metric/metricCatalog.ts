// app/utils/metric/metricCatalog.ts
// 指标目录（`/metric/definition`）× 指标名清单（`/metric/name`）的 **join + 三分类**纯函数内核
// （`NMCPS-CONTRACT-002` §八）。零 I/O、零状态：请求在
// `layers/topology/app/composables/useMetricSeries.ts`，这里只做「把两份上游数据拼成能用的目录」。
//
// 判定顺序固定为 §8.3 的三步，调用方不得各自再写 `if`：
//   ① 名字命中 `up` / `scrape_*` ⇒ `collector`（采集器自监控，连目录里都可能没有）；
//   ② 目录 `metric_type ∈ {string, event}` 或 `has_series === false` ⇒ `text`；
//   ③ 其余（含目录里没有这个名字）⇒ `numeric`。
//
// 目录条目形状**未在 openapi 定稿**（`metric_listDefinition` 只声明 `metric_BaseResp` 信封），
// 所以解析一律「能取到就用、取不到就退回 name-only」（§8.2）：不按固定字段名硬解，也不因为
// 目录拿不到就把图表变成错误态。
import type { MetricCatalogItem, MetricCatalogKind, MetricType, RawMetricItem } from "~~/shared/types/metric";
import { isCollectorMetricName, metricNameOf } from "~~/app/utils/chart/metricSeries";
import { METRIC_TYPES } from "~~/shared/types/metric";

/** 目录条目的原始形状（§8.2）：字段可能缺、也可能叫别的名字，全部可选 */
export interface RawMetricDefinition {
	code?: string
	metric_code?: string
	name?: string
	metric_name?: string
	metric_type?: string
	cn_name?: string
	en_name?: string
	category?: string
	metric_group?: string
	unit?: string
	description?: string
	has_series?: boolean | null
}

/** `GET /metric/definition` 的 `data`（分页信封；只消费 `list`，`total` 备用） */
export interface MetricDefinitionData {
	list?: RawMetricDefinition[] | null
	page?: number
	page_size?: number
	total?: number
}

/** 解析后的一条目录证据：缺的字段留空串，`metric_type` 缺失记 `""`（= 没有类型证据） */
export interface ParsedMetricDefinition {
	code: string
	cn_name: string
	en_name: string
	category: string
	unit: string
	metric_type: MetricType | ""
	description: string
	has_series: boolean | null
}

/** 目录 join 结果：条目 + 是否已降级（目录不可用 ⇒ 全部只有名字证据，§8.4） */
export interface MetricCatalog {
	items: MetricCatalogItem[]
	degraded: boolean
}

function readString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

/** 类型只认 `METRIC_TYPES`；上游给了别的字符串一律当作「没有证据」，不进三分类 */
function readMetricType(value: unknown): MetricType | "" {
	const raw = readString(value);
	return (METRIC_TYPES as readonly string[]).includes(raw) ? raw as MetricType : "";
}

/** 条目编码：`code` → `metric_code` → `name` → `metric_name`（§8.2 的取值顺序） */
export function metricDefinitionCode(raw: RawMetricDefinition | null | undefined): string {
	if (!raw || typeof raw !== "object")
		return "";

	for (const candidate of [raw.code, raw.metric_code, raw.name, raw.metric_name]) {
		const code = readString(candidate);
		if (code)
			return code;
	}

	return "";
}

/**
 * 目录条目 → `code → 证据` 映射：没有编码的条目直接丢弃（拼不出 join 键），
 * 同编码后者覆盖前者（上游分页重叠时不至于留下两份半证据）。
 */
export function toDefinitionMap(list: RawMetricDefinition[] | null | undefined): Map<string, ParsedMetricDefinition> {
	const map = new Map<string, ParsedMetricDefinition>();

	for (const raw of list ?? []) {
		const code = metricDefinitionCode(raw);
		if (!code)
			continue;

		map.set(code, {
			code,
			cn_name: readString(raw.cn_name),
			en_name: readString(raw.en_name),
			category: readString(raw.category) || readString(raw.metric_group),
			unit: readString(raw.unit),
			metric_type: readMetricType(raw.metric_type),
			description: readString(raw.description),
			has_series: typeof raw.has_series === "boolean" ? raw.has_series : null
		});
	}

	return map;
}

/** 三分类（§8.3，顺序固定）：名字判据永远排第一，目录只作类型证据 */
export function classifyMetricKind(code: string, definition?: ParsedMetricDefinition | null): MetricCatalogKind {
	if (isCollectorMetricName(code))
		return "collector";

	if (!definition)
		return "numeric";

	if (definition.has_series === false)
		return "text";

	if (definition.metric_type === "string" || definition.metric_type === "event")
		return "text";

	return "numeric";
}

/**
 * 把「该设备的指标名清单」join 到目录上，得到选择器可直接用的条目。
 *
 * `definitions === null` 表示目录没取到（§8.4）：所有条目落 `name-only`、`degraded = true`，
 * 只有名字判据生效 —— 图表照常出，但文本指标可能被当数值画，缺口如实留给页面提示。
 */
export function buildMetricCatalog(
	names: RawMetricItem[] | null | undefined,
	definitions: Map<string, ParsedMetricDefinition> | null
): MetricCatalog {
	const items: MetricCatalogItem[] = [];
	const seen = new Set<string>();

	for (const raw of names ?? []) {
		const code = metricNameOf(raw);
		if (!code || seen.has(code))
			continue;

		seen.add(code);

		const definition = definitions?.get(code) ?? null;
		const kind = classifyMetricKind(code, definition);

		items.push({
			code,
			cn_name: definition?.cn_name ?? "",
			en_name: definition?.en_name ?? "",
			category: definition?.category ?? "",
			unit: definition?.unit ?? "",
			metric_type: definition?.metric_type || "other",
			description: definition?.description ?? "",
			kind,
			selectable: kind === "numeric",
			has_series: definition?.has_series ?? null,
			meta_source: definition ? "backend" : "name-only"
		});
	}

	return { items, degraded: !definitions || definitions.size === 0 };
}

/** 选择器选项：只列 `selectable` 的条目（`text` / `collector` 可见但不可选，§三） */
export function selectableMetrics(items: MetricCatalogItem[]): MetricCatalogItem[] {
	return items.filter((item) => item.selectable);
}

/** 默认画哪一条：首个 `selectable`，一个都没有就返回 `""`（页面走空态，不硬画） */
export function pickPaintableMetricCode(items: MetricCatalogItem[]): string {
	return items.find((item) => item.selectable)?.code ?? "";
}

/** 选项文案：`en_name` 兜 `code`，有单位就在后面补一个括号（单位是数据，不翻译） */
export function metricOptionLabel(item: MetricCatalogItem): string {
	const name = item.en_name || item.code;
	return item.unit ? `${name} (${item.unit})` : name;
}
