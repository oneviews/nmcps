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

/**
 * 一条 `results` 入口的分组键：接口维度标签（`NMCPS-CONTRACT-002` §6.9）。
 *
 * 空串 = 该序列**没有**接口维度标签，即设备级（`sysUpTime` 这类）；接口级指标才有值。
 * 只认接口索引标签，不看 `job` / `auth` / `sys_name` / `node_uuid` —— 同一接口在两个 job 下是
 * **同一个物理对象**，拿 `job` 当身份会把一条曲线画成两条。
 *
 * 标签名不唯一（2026-11-08 实测 `metric_code=simIfaceInKbps` 回的是 `simIfaceMetricIndex`，
 * 不是 `ifIndex`）：优先 `ifIndex`，其次唯一的 `*Index` 标签。**出现多个 `*Index` 标签时不猜**，
 * 如实回落设备级（宁可少一个端口表，也不把两条不同口径的索引混成一组）。
 */
export function seriesGroupKey(metric: Record<string, unknown> | null | undefined): string {
	if (!metric)
		return "";

	const direct = labelText(metric.ifIndex);
	if (direct)
		return direct;

	const indexLabels = Object.keys(metric).filter((key) => key.endsWith("Index"));
	if (indexLabels.length !== 1)
		return "";

	return labelText(metric[indexLabels[0] as string]) ?? "";
}

/** 标签值 → 组键：字符串原样 trim、有限数字转字符串，其余（缺 / null / 对象）为空 */
function labelText(value: unknown): string | null {
	if (typeof value === "string") {
		const text = value.trim();
		return text || null;
	}
	if (typeof value === "number" && Number.isFinite(value))
		return String(value);

	return null;
}

/** 选组结果：一条可画的曲线 + 它是谁（页面据此如实标注「端口级 / 设备级」） */
export interface MetricSeriesSelection {
	points: MetricSeriesPoint[]
	/** 非法点丢弃计数（组内各序列求和） */
	dropped: number
	/** 命中组的组键：`ifIndex` 字符串；空串 = 设备级 */
	ifIndex: string
	/** 参与合并的原始序列条数（> 1 说明同一接口被多个 job 重复采集，已按时间戳取均值） */
	seriesCount: number
}

/**
 * 同时间戳**算术均值**合并多条点列（§6.9）：同一 `ip` + `ifIndex` 被多个采集 job 重复上报时，
 * 它们是同一个物理对象的重复采样 —— 取均值，绝不相加（相加会把流量翻倍）。
 */
export function averageSeriesPoints(lists: MetricSeriesPoint[][]): MetricSeriesPoint[] {
	if (lists.length <= 1)
		return sortAndDedupeSeries(lists[0] ?? []);

	const buckets = new Map<number, { sum: number, count: number }>();
	for (const list of lists) {
		for (const point of list) {
			const bucket = buckets.get(point.t);
			if (bucket) {
				bucket.sum += point.v;
				bucket.count += 1;
			} else {
				buckets.set(point.t, { sum: point.v, count: 1 });
			}
		}
	}

	return [...buckets.keys()]
		.sort((a, b) => a - b)
		.map((t) => ({ t, v: (buckets.get(t) as { sum: number, count: number }).sum / (buckets.get(t) as { sum: number, count: number }).count }));
}

/**
 * 从 `/metric/datapoint` 的 `results` 里选出**一条**要画的曲线（`NMCPS-CONTRACT-002` §6.9）。
 *
 * - `ifIndex` 给了（链路页传端点端口索引）⇒ 取同 `ifIndex` 的组；**该指标本身没有 `ifIndex` 标签**
 *   （整份 `results` 只有设备级一组）时如实回落设备级（`ifIndex` 返空串，页面据此标注「设备级」），
 *   而「有接口维度但没这个索引」返回 `null`，由调用方走 `no_interface_series` 空态 —— 不拿别的端口顶替；
 * - `ifIndex` 没给（设备页 / 监视页）⇒ 按组键升序取第一组（设备级 `""` 最前），结果确定性；
 * - 组内多条（跨 job）按时间戳取均值，点集沿用 §6.3 的解包与丢弃规则。
 *
 * 取代旧实现「单设备单指标 ⇒ `results[0]`」的未取证假设。
 */
export function selectMetricSeries(
	results: Array<{ metric?: Record<string, unknown>, values?: MetricPointPair[] }> | undefined | null,
	ifIndex?: number | string | null
): MetricSeriesSelection | null {
	const entries = (results ?? []).filter(Boolean);
	if (!entries.length)
		return null;

	const wanted = ifIndex === null || ifIndex === undefined ? "" : String(ifIndex).trim();
	const groups = new Map<string, MetricPointPair[][]>();

	for (const entry of entries) {
		const key = seriesGroupKey(entry.metric);
		const bucket = groups.get(key);
		if (bucket)
			bucket.push(entry.values ?? []);
		else
			groups.set(key, [entry.values ?? []]);
	}

	let key: string;

	if (wanted) {
		if (groups.has(wanted)) {
			key = wanted;
		} else if (groups.size === 1 && groups.has("")) {
			/**
			 * 这条指标**本身就没有 `ifIndex` 标签**（`sysUpTime` 这类设备级指标）：如实回落设备级序列，
			 * 由页面标注「这是设备级，不是端口级」—— 比画一条空态更有信息量，也没有伪造端口维度。
			 */
			key = "";
		} else {
			/** 端口没匹配上（该指标有接口维度，但没有这个索引）：空态，不拿别的端口顶替 */
			return null;
		}
	} else {
		/** 组键升序：数字索引按数值比（`9` < `10`），设备级 `""` 排最前 */
		key = [...groups.keys()].sort(compareGroupKeys)[0] ?? "";
	}
	const lists: MetricSeriesPoint[][] = [];
	let dropped = 0;

	for (const pairs of groups.get(key) ?? []) {
		const unpacked = unpackSeries(pairs);
		dropped += unpacked.dropped;
		lists.push(unpacked.points);
	}

	return {
		points: averageSeriesPoints(lists),
		dropped,
		ifIndex: key,
		seriesCount: lists.length
	};
}

/**
 * 逐端口一行（`Metric/Telemetry/DeviceInterfaces.vue` 的表格行）：一个 `ifIndex` 一组。
 *
 * 与 `selectMetricSeries()` 的区别只在**输出粒度**：那个选一组画一条线，这个把每组都留下来，
 * 「接口列表」Tab 才有逐端口的值可列。合并规则完全一致（`NMCPS-CONTRACT-002` §6.9）：
 * 同 `ifIndex` 跨 job 重复上报 ⇒ 按时间戳取均值，绝不相加。
 */
export interface MetricInterfaceValue {
	/** `ifIndex` 字符串；空串 = 该指标**没有接口维度**（设备级），不是某个端口 */
	ifIndex: string
	/** 该组最后一个合法采样值；`null` = 窗口内没有合法点（不补 0） */
	value: number | null
	/** 该值的时间（毫秒）；`null` = 无合法点 */
	t: number | null
	/** 组内非法点丢弃计数（不补 0，只计数） */
	dropped: number
	/** 参与合并的原始序列条数（> 1 = 同端口被多个 job 采集） */
	seriesCount: number
}

/**
 * `results` → 逐组（`ifIndex`）最新值，组键升序（设备级 `""` 最前，数字索引按数值）。
 * 空 `results` ⇒ `[]`（合法空，不是错误）。
 */
export function groupSeriesByInterface(
	results: Array<{ metric?: Record<string, unknown>, values?: MetricPointPair[] }> | undefined | null
): MetricInterfaceValue[] {
	const groups = new Map<string, MetricPointPair[][]>();

	for (const entry of (results ?? []).filter(Boolean)) {
		const key = seriesGroupKey(entry.metric);
		const bucket = groups.get(key);

		if (bucket)
			bucket.push(entry.values ?? []);
		else
			groups.set(key, [entry.values ?? []]);
	}

	return [...groups.keys()].sort(compareGroupKeys).map((key) => {
		const lists: MetricSeriesPoint[][] = [];
		let dropped = 0;

		for (const pairs of groups.get(key) ?? []) {
			const unpacked = unpackSeries(pairs);
			dropped += unpacked.dropped;
			lists.push(unpacked.points);
		}

		const points = averageSeriesPoints(lists);
		const last = points.at(-1);

		return {
			ifIndex: key,
			value: last?.v ?? null,
			t: last?.t ?? null,
			dropped,
			seriesCount: lists.length
		};
	});
}

/** 组键比较：空串（设备级）最前，数字按数值，其余按字典序 */
function compareGroupKeys(a: string, b: string): number {
	if (a === b)
		return 0;
	if (!a)
		return -1;
	if (!b)
		return 1;

	const na = Number(a);
	const nb = Number(b);
	if (Number.isFinite(na) && Number.isFinite(nb))
		return na - nb;

	return a < b ? -1 : 1;
}
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
