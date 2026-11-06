import type { MetricSeriesPoint } from "~~/app/utils/chart/metricSeries";
// layers/topology/app/composables/useNodeTrend.ts
// `/topology/monitor` 详情栏的节点趋势取数（NMCPS-DESIGN-001 §6.5 / §九 A3）。
//
// 两步、都走 BFF 网关（页面不直连上游）：
//   ① `GET /api/metric/name?mgmt_ip=<管理 IP>` —— 该设备可用指标名清单（双形态，归一在
//      `app/utils/chart/metricSeries.ts::pickTrendMetricCode`，只排除采集器自监控命名空间）；
//   ② `GET /api/metric/datapoint?mode=range&mgmt_ip=…&metric_code=…&from=…&to=…&step=60`
//      —— 近 1 小时窗口，回 VM 风格 matrix（点对是 `[Unix 秒, 字符串值]`）。
//
// 解包 / 排序 / 去重 / 降采样全部落在纯函数里（`NMCPS-CONTRACT-002` §6.6），本文件只管请求与状态。
// 失败语义（§6.7）：`code !== 0` 与网络错误都进 `error`（文案是上游原话，展示时逐字给出）；
// 同一节点的网络错误保留上一次成功序列并标 `stale`，不把面板清空成空态。
import type { MetricDatapointData, MetricNameData } from "~~/shared/types/metric";
import { normalizeMetricSeries, pickTrendMetricCode } from "~~/app/utils/chart/metricSeries";

/** 时间窗：近 1 小时（DESIGN-001 §6.4 的默认窗口口径） */
const WINDOW_MS = 60 * 60 * 1000;
/** 聚合步长（秒）：1 小时 → 60s 一个点，60 个点足够看清趋势且不放大请求 */
const STEP_SECONDS = 60;

/** 「没有可画的序列」的两种正常原因（不是错误，不显示上游文案） */
export type NodeTrendReason = "" | "no_metric_names" | "no_datapoints";

/** 失败信息：`code` 保留 BFF / 上游语义，`message` 是原话（数据，不翻译） */
export interface NodeTrendError {
	code: number
	message: string
}

export function useNodeTrend(ip: Ref<string>) {
	const api = useApi();

	const metricCode = ref("");
	const points = ref<MetricSeriesPoint[]>([]);
	const dropped = ref(0);
	const reason = ref<NodeTrendReason>("");
	const error = ref<NodeTrendError | null>(null);
	const loading = ref(false);
	/** 保留的是上一次成功数据（网络抖动时页面据此提示「数据可能不是最新」） */
	const stale = ref(false);

	/** 请求序号：只有最后一次选择对应的响应能落盘（快速连点节点不会画错曲线） */
	let sequence = 0;
	/** 当前点列属于哪个设备（用于判断「换节点」还是「同节点重取」） */
	let loadedFor = "";

	/**
	 * 取该节点的近 1 小时趋势。
	 *
	 * 换节点时先清空点列：否则新节点的面板上会飘着上一个设备的曲线（比空态更误导）。
	 * 同一节点重取失败则保留旧点列并置 `stale`（§6.7：清除等于把抖动升级成「没数据」）。
	 */
	async function load(): Promise<void> {
		const target = ip.value.trim();
		const token = ++sequence;

		if (target !== loadedFor) {
			points.value = [];
			dropped.value = 0;
			metricCode.value = "";
		}

		reason.value = "";
		error.value = null;
		stale.value = false;

		if (!target) {
			loading.value = false;
			loadedFor = "";
			return;
		}

		loading.value = true;

		try {
			const names = await api.get<MetricNameData>("/api/metric/name", { query: { mgmt_ip: target } });
			if (token !== sequence)
				return;

			const code = pickTrendMetricCode(names?.metrics);
			if (!code) {
				reason.value = "no_metric_names";
				points.value = [];
				dropped.value = 0;
				metricCode.value = "";
				loadedFor = target;
				return;
			}

			metricCode.value = code;

			const to = new Date();
			const from = new Date(to.getTime() - WINDOW_MS);
			const data = await api.get<MetricDatapointData>("/api/metric/datapoint", {
				query: {
					mode: "range",
					mgmt_ip: target,
					metric_code: code,
					from: from.toISOString(),
					to: to.toISOString(),
					step: STEP_SECONDS
				}
			});
			if (token !== sequence)
				return;

			// 单设备单指标 ⇒ `results` 恒一条；多条时取第一条（不合并不同标签集的序列，那会画成假线）
			const series = data?.results?.[0];
			const { points: normalized, dropped: discarded } = normalizeMetricSeries(series?.values);

			points.value = normalized;
			dropped.value = discarded;
			reason.value = normalized.length ? "" : "no_datapoints";
			loadedFor = target;
		} catch (raw) {
			if (token !== sequence)
				return;

			const { code, message } = raw as Partial<NodeTrendError>;
			error.value = { code: code ?? 0, message: message ?? "api_network_error" };
			stale.value = points.value.length > 0;
			reason.value = points.value.length ? "" : "no_datapoints";
		} finally {
			if (token === sequence)
				loading.value = false;
		}
	}

	watch(ip, () => void load(), { immediate: true });

	return {
		/** 正在画的指标编码（`""` = 还没有） */
		metricCode,
		points,
		/** 被丢弃的非法点数（`""` / `"NaN"` / `null`；不补 0，只计数） */
		dropped,
		/** 「没有可画序列」的正常原因（页面按 i18n 映射文案） */
		reason,
		error,
		loading,
		stale,
		reload: load
	};
}
