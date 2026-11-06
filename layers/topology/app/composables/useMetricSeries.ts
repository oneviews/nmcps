// layers/topology/app/composables/useMetricSeries.ts
// 指标趋势的**通用取数内核**（`NMCPS-DESIGN-001` §6.6 / `NMCPS-CONTRACT-002` §6、§7、§8）。
//
// 三步、都走 BFF 网关（页面不直连上游）：
//   ① `GET /api/metric/definition?page=1&page_size=200` —— 指标目录（与设备无关，一个会话取一次）；
//   ② `GET /api/metric/name?mgmt_ip=…` —— 该设备可用指标名清单（双形态，归一在纯函数里）；
//   ③ `GET /api/metric/datapoint?mode=range&mgmt_ip=…&metric_code=…&from=…&to=…&step=60`
//      —— 近 1 小时窗口，回 VM 风格 matrix（点对是 `[Unix 秒, 字符串值]`）。
//
// ①+② 的 join 与三分类落在 `app/utils/metric/metricCatalog.ts`（§八），解包 / 排序 / 去重 / 降采样
// 落在 `app/utils/chart/metricSeries.ts`（§6.6）。本文件只管请求、状态与竞态序号。
//
// 失败语义（§6.7）：`code !== 0` 与网络错误都进 `error`（`message` 是上游原话，逐字展示）；
// 同一设备的网络错误保留上一次成功序列并标 `stale`；目录失败**不是**取数失败（§8.4），只置
// `degraded` 让页面提示一句。
import type { ApiRequestOptions } from "~~/app/composables/useApi";
import type { MetricSeriesPoint } from "~~/app/utils/chart/metricSeries";
import type { MetricDefinitionData, RawMetricDefinition } from "~~/app/utils/metric/metricCatalog";
import type { MetricCatalogItem, MetricDatapointData, MetricNameData, RawMetricItem } from "~~/shared/types/metric";
import { selectMetricSeries } from "~~/app/utils/chart/metricSeries";
import { buildMetricCatalog, pickPaintableMetricCode, selectableMetrics, toDefinitionMap } from "~~/app/utils/metric/metricCatalog";

/** 时间窗：近 1 小时（DESIGN-001 §6.4 的默认窗口口径） */
const WINDOW_MS = 60 * 60 * 1000;
/** 聚合步长（秒）：1 小时 → 60s 一个点，60 个点足够看清趋势且不放大请求 */
const STEP_SECONDS = 60;
/** 目录一次取多少条：覆盖单租户目录，避免「翻页丢了条目」被当成「目录里没有」（§8.1） */
const CATALOG_PAGE_SIZE = 200;

/** 「没有可画的序列」的四种正常原因（不是错误，不显示上游文案） */
export type MetricSeriesReason = "" | "no_metric_names" | "no_paintable_metric" | "no_datapoints" | "no_interface_series";

/** 失败信息：`code` 保留 BFF / 上游语义，`message` 是原话（数据，不翻译） */
export interface MetricSeriesError {
	code: number
	message: string
}

export interface MetricSeriesOptions {
	/** 用户在选择器里选的编码（由页面持有）；不传或不在目录里就取首个可绘图项 */
	code?: Ref<string>
	/** 速率开关（只对 `counter` 有意义，§6.5）：由用户显式勾选，默认 `false` */
	rate?: Ref<boolean>
	/**
	 * 接口维度过滤（`NMCPS-CONTRACT-002` §6.9）：链路页传端点 `if_index`，只画该端口的序列；
	 * 不传 = 设备页 / 监视页口径（按组键升序取第一组）。给了却一条都没匹配上走
	 * `no_interface_series` 空态，**不回落**设备级。
	 */
	ifIndex?: Ref<number | string | null | undefined>
}

/**
 * 目录缓存：与设备无关，一个应用会话取一次（§8.1）。
 * 失败**不缓存**（把 promise 放回 `null`），下次进页面还能重试 —— 否则一次抖动会把目录钉死成空。
 */
let catalogPromise: Promise<RawMetricDefinition[] | null> | null = null;

function catalogFrom(api: ReturnType<typeof useApi>): Promise<RawMetricDefinition[] | null> {
	if (!catalogPromise) {
		const query: ApiRequestOptions["query"] = { page: 1, page_size: CATALOG_PAGE_SIZE };
		catalogPromise = api.get<MetricDefinitionData>("/api/metric/definition", { query })
			.then((data) => data?.list ?? [])
			.catch(() => {
				catalogPromise = null;
				return null;
			});
	}

	return catalogPromise;
}

export function useMetricSeries(ip: Ref<string>, options: MetricSeriesOptions = {}) {
	const api = useApi();

	/** 当前选中的编码：页面可传入自己的 ref 以绑定选择器，否则内部持有 */
	const selectedCode = options.code ?? ref("");
	const rate = options.rate ?? ref(false);
	const ifIndex = options.ifIndex ?? ref<number | string | null | undefined>(null);

	const catalog = ref<MetricCatalogItem[]>([]);
	/** 目录不可用（§8.4）：只有名字证据，页面提示一句但不进错误态 */
	const degraded = ref(false);
	const points = ref<MetricSeriesPoint[]>([]);
	const dropped = ref(0);
	const reason = ref<MetricSeriesReason>("");
	const error = ref<MetricSeriesError | null>(null);
	const loading = ref(false);
	/** 保留的是上一次成功数据（网络抖动时页面据此提示「数据可能不是最新」） */
	const stale = ref(false);
	/** 已画曲线的组键：`ifIndex` 字符串；空串 = 设备级（页面据此区分「端口级 / 设备级」） */
	const seriesIfIndex = ref("");
	/** 参与合并的原始序列条数（> 1 = 跨 job 重复，已取均值；页面可据此如实标注） */
	const seriesCount = ref(0);

	/** 选择器选项 = 目录里 `selectable` 的条目（§8.3） */
	const metricOptions = computed(() => selectableMetrics(catalog.value));
	const selectedMetric = computed(() => catalog.value.find((item) => item.code === selectedCode.value) ?? null);
	/** 速率开关只在 `counter` 上出现（§6.5） */
	const rateAvailable = computed(() => selectedMetric.value?.metric_type === "counter");

	/** 请求序号：只有最后一次选择对应的响应能落盘（快速连点不会画错曲线） */
	let sequence = 0;
	/** 当前点列属于哪个设备（用于判断「换设备」还是「同设备重取」） */
	let loadedFor = "";
	/** 名字清单按设备缓存：换指标 / 开关速率不重取清单 */
	let namesFor = "";
	let namesRaw: RawMetricItem[] = [];
	/** 已按此组合取过数：内部自动挑编码后不再重复发一轮请求 */
	let appliedKey = "";

	function reset(): void {
		catalog.value = [];
		degraded.value = false;
		points.value = [];
		dropped.value = 0;
		seriesIfIndex.value = "";
		seriesCount.value = 0;
		reason.value = "";
		error.value = null;
		stale.value = false;
		loading.value = false;
	}

	/**
	 * 取该设备近 1 小时的指标序列。
	 *
	 * 换设备时先清空点列：否则新设备面板上会飘着上一个设备的曲线（比空态更误导）。
	 * 同一设备重取失败则保留旧点列并置 `stale`（§6.7：清除等于把抖动升级成「没数据」）。
	 */
	async function load(): Promise<void> {
		const target = ip.value.trim();
		const token = ++sequence;

		if (!target) {
			loadedFor = "";
			namesFor = "";
			namesRaw = [];
			appliedKey = "";
			reset();
			return;
		}

		if (target !== loadedFor) {
			points.value = [];
			dropped.value = 0;
			seriesIfIndex.value = "";
			seriesCount.value = 0;
		}

		reason.value = "";
		error.value = null;
		stale.value = false;
		loading.value = true;

		try {
			const definitions = await catalogFrom(api);
			if (token !== sequence)
				return;

			if (namesFor !== target) {
				const names = await api.get<MetricNameData>("/api/metric/name", { query: { mgmt_ip: target } });
				if (token !== sequence)
					return;

				namesFor = target;
				namesRaw = names?.metrics ?? [];
			}

			const built = buildMetricCatalog(namesRaw, definitions ? toDefinitionMap(definitions) : null);
			catalog.value = built.items;
			degraded.value = built.degraded;

			/** 页面选的编码必须在目录里且可绘图，否则回落首个可绘图项（不画「不可选」的序列） */
			const chosen = built.items.find((item) => item.code === selectedCode.value && item.selectable);
			const effective = chosen?.code ?? pickPaintableMetricCode(built.items);

			if (effective !== selectedCode.value)
				selectedCode.value = effective;

			appliedKey = `${target}|${effective}|${rate.value}|${ifIndexKey()}`;

			if (!effective) {
				points.value = [];
				dropped.value = 0;
				seriesIfIndex.value = "";
				seriesCount.value = 0;
				reason.value = built.items.length ? "no_paintable_metric" : "no_metric_names";
				loadedFor = target;
				return;
			}

			/** `rate` 只对 `counter` 有意义，其余类型恒不传（§6.5：类型未定就不开速率） */
			const withRate = rate.value && built.items.some((item) => item.code === effective && item.metric_type === "counter");

			const to = new Date();
			const from = new Date(to.getTime() - WINDOW_MS);
			const query: ApiRequestOptions["query"] = {
				mode: "range",
				mgmt_ip: target,
				metric_code: effective,
				from: from.toISOString(),
				to: to.toISOString(),
				step: STEP_SECONDS
			};

			if (withRate)
				query.rate = true;

			const data = await api.get<MetricDatapointData>("/api/metric/datapoint", { query });
			if (token !== sequence)
				return;

			/**
			 * 多条 `results` 是常态（同设备多 job 重复采集、接口级指标还按 `ifIndex` 分组），
			 * 选组与跨 job 取均值的规则在 `NMCPS-CONTRACT-002` §6.9；这里只把结果落盘。
			 */
			const wantedIfIndex = ifIndex.value === null || ifIndex.value === undefined ? "" : String(ifIndex.value).trim();
			const picked = selectMetricSeries(data?.results, wantedIfIndex || null);

			points.value = picked?.points ?? [];
			dropped.value = picked?.dropped ?? 0;
			seriesIfIndex.value = picked?.ifIndex ?? "";
			seriesCount.value = picked?.seriesCount ?? 0;
			reason.value = picked?.points.length
				? ""
				: (wantedIfIndex && !picked ? "no_interface_series" : "no_datapoints");
			loadedFor = target;
		} catch (raw) {
			if (token !== sequence)
				return;

			const { code, message } = raw as Partial<MetricSeriesError>;
			error.value = { code: code ?? 0, message: message ?? "api_network_error" };
			stale.value = points.value.length > 0;
			reason.value = points.value.length ? "" : "no_datapoints";
		} finally {
			if (token === sequence)
				loading.value = false;
		}
	}

	/** `ifIndex` 的空值归一：`null` / `undefined` / 空串都视为「不过滤」 */
	function ifIndexKey(): string {
		return ifIndex.value === null || ifIndex.value === undefined ? "" : String(ifIndex.value).trim();
	}

	// 设备 / 编码 / 速率 / 接口任一变化就重取；内部自动挑编码只写 `appliedKey`，不再触发一轮同名请求
	watch(
		[ip, selectedCode, rate, ifIndex],
		() => {
			if (`${ip.value.trim()}|${selectedCode.value}|${rate.value}|${ifIndexKey()}` === appliedKey)
				return;

			void load();
		},
		{ immediate: true }
	);

	return {
		/** 目录条目（含不可选的那些，页面只把 `selectable` 的塞进选择器） */
		catalog,
		/** 选择器选项 */
		options: metricOptions,
		/** 当前选中项（取 `metric_type` / `unit` 用） */
		selectedMetric,
		/** 正在画的指标编码（`""` = 还没有） */
		selectedCode,
		/** 速率开关是否对该指标有意义 */
		rateAvailable,
		/** 目录不可用（§8.4）：只提示，不当作取数失败 */
		degraded,
		points,
		/** 被丢弃的非法点数（`""` / `"NaN"` / `null`；不补 0，只计数） */
		dropped,
		/** 已画曲线的组键：`ifIndex` 字符串；空串 = 设备级（§6.9） */
		seriesIfIndex,
		/** 参与合并的原始序列条数（> 1 = 跨 job 重复，已取均值） */
		seriesCount,
		/** 「没有可画序列」的正常原因（页面按 i18n 映射文案） */
		reason,
		error,
		loading,
		stale,
		reload: load
	};
}
