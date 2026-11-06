// app/utils/chart/metricSeries.ts
// 指标序列的**纯函数**内核（零 I/O、零状态）：把 `/metric/datapoint` 回的 VM 风格 matrix
// 收成可以直接画的一条折线，并按 `NMCPS-CONTRACT-002` §6.6 的固定管线处理：
//
//   解包 → 丢弃非法点 → 按 ts 升序 → 同 ts 去重（保留最后一条） → 像素级降采样 → 渲染
//
// 每一步独立可测：`unpackSeries` / `sortAndDedupeSeries` / `normalizeMetricSeries` /
// `downsampleSeries` / `seriesExtent`。设计基准见 `NMCPS-DESIGN-001` §七（`TrendChart`）。
//
// 三条硬约束来自 §6.3，写在这里免得调用方各自实现：
//   ① 值恒为字符串 ⇒ 必须 `Number()`，禁止直接比较（`"9" > "10"`）；
//   ② 非法点（`""` / `"NaN"` / `null`）丢弃并计数，**不补 0、不插值**；
//   ③ 点对首元素是 Unix 秒，转毫秒只在这里乘 1000（不再按本地时区解析）。
import type { MetricPointPair, RawMetricItem } from "~~/shared/types/metric";

/** 画线用的一个点：`t` 是**毫秒**（上游给秒，已在本文件换算）、`v` 是数值 */
export interface MetricSeriesPoint {
	t: number
	v: number
}

/** 解包结果：保留的点 + 丢弃计数（丢弃数是事实，页面可展示「已忽略 N 个非法点」） */
export interface MetricSeriesResult {
	points: MetricSeriesPoint[]
	dropped: number
}

/** 采集器自监控命名空间（`NMCPS-CONTRACT-002` §三 `collector`）：`up` / `scrape_*`，不是设备业务指标 */
export function isCollectorMetricName(code: string): boolean {
	return code === "up" || code.startsWith("scrape_");
}

/**
 * 点对 → `{ t(ms), v }`：值不是有限数字的点直接丢弃并计数（§6.3 ②）。
 *
 * 空串必须显式判掉：`Number("")` 是 `0`，光用 `Number.isFinite` 会把「没采到」画成一条
 * 贴地的 0 值曲线 —— 这正是契约里「不得补 0」要防的那类伪造。
 */
export function unpackSeries(pairs: MetricPointPair[] | undefined | null): MetricSeriesResult {
	const points: MetricSeriesPoint[] = [];
	let dropped = 0;

	for (const pair of pairs ?? []) {
		if (!Array.isArray(pair) || pair.length < 2) {
			dropped += 1;
			continue;
		}

		const [seconds, raw] = pair;
		const numeric = typeof raw === "number" || (typeof raw === "string" && raw.trim() !== "");
		const value = Number(raw);
		const t = Number(seconds) * 1000;

		if (!numeric || !Number.isFinite(value) || !Number.isFinite(t)) {
			dropped += 1;
			continue;
		}

		points.push({ t, v: value });
	}

	return { points, dropped };
}

/** 按 ts 升序 + 同 ts 去重（保留**最后一条**：后到的采样覆盖同秒的旧值） */
export function sortAndDedupeSeries(points: MetricSeriesPoint[]): MetricSeriesPoint[] {
	const sorted = [...points].sort((a, b) => a.t - b.t);
	const result: MetricSeriesPoint[] = [];

	for (const point of sorted) {
		const last = result.at(-1);
		if (last && last.t === point.t)
			result[result.length - 1] = point;
		else
			result.push(point);
	}

	return result;
}

/** 管线前三步（解包 → 升序 → 去重）；页面拿到的就是可直接降采样的序列 */
export function normalizeMetricSeries(pairs: MetricPointPair[] | undefined | null): MetricSeriesResult {
	const { points, dropped } = unpackSeries(pairs);
	return { points: sortAndDedupeSeries(points), dropped };
}

/**
 * 像素级降采样（§6.6）：点数 > 2 × 列宽才触发，每列保留 **min / max** 两个点（保住毛刺），
 * 不取平均。列数按画布宽度给（`TrendChart` 传自己的 `columns`），列内按时间顺序输出。
 */
export function downsampleSeries(points: MetricSeriesPoint[], columns: number): MetricSeriesPoint[] {
	const width = Math.max(1, Math.trunc(columns));

	if (points.length <= width * 2)
		return points;

	const first = points[0];
	const last = points[points.length - 1];
	if (!first || !last)
		return points;

	const span = last.t - first.t || 1;
	const buckets = new Map<number, MetricSeriesPoint[]>();

	for (const point of points) {
		const column = Math.min(width - 1, Math.floor(((point.t - first.t) / span) * width));
		const bucket = buckets.get(column);
		if (bucket)
			bucket.push(point);
		else
			buckets.set(column, [point]);
	}

	const result: MetricSeriesPoint[] = [];
	for (const column of [...buckets.keys()].sort((a, b) => a - b)) {
		const bucket = buckets.get(column) as MetricSeriesPoint[];
		if (bucket.length <= 2) {
			result.push(...bucket);
			continue;
		}

		let min = bucket[0];
		let max = bucket[0];
		if (!min || !max)
			continue;

		for (const point of bucket) {
			if (point.v < min.v)
				min = point;
			if (point.v > max.v)
				max = point;
		}

		result.push(...(min.t <= max.t ? [min, max] : [max, min]));
	}

	return result;
}

/** 纵轴范围：空序列返回 `null`（页面据此走空态，绝不画一条 0 值直线） */
export function seriesExtent(points: MetricSeriesPoint[]): { min: number, max: number } | null {
	const head = points[0];
	if (!head)
		return null;

	let min = head.v;
	let max = head.v;
	for (const point of points) {
		if (point.v < min)
			min = point.v;
		if (point.v > max)
			max = point.v;
	}

	return { min, max };
}

/** `metric/name` 的双形态条目 → 指标名（字符串原样、对象取 `metric_code` 再兜 `metric_name`） */
export function metricNameOf(item: RawMetricItem): string {
	if (typeof item === "string")
		return item.trim();

	for (const candidate of [item.metric_code, item.metric_name]) {
		if (typeof candidate === "string" && candidate.trim())
			return candidate.trim();
	}

	return "";
}

/**
 * 从可用指标名清单里挑**一个**用来画趋势的编码。
 *
 * 只排除采集器自监控命名空间（`up` / `scrape_*`，§三 `collector` 的判据），**不按名字猜类型**
 * —— 「cpu」子串之于 `gauge` 只是巧合，类型判定只认目录条目（§6.5）。文本 / 事件指标落成
 * 一条直线的风险由指标页 P1 的目录 join 解决，这里如实登记为缺口，不靠命名绕过。
 */
export function pickTrendMetricCode(items: RawMetricItem[] | undefined | null): string {
	for (const item of items ?? []) {
		const name = metricNameOf(item);
		if (name && !isCollectorMetricName(name))
			return name;
	}

	return "";
}
