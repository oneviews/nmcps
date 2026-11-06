// layers/topology/app/composables/useNodeTrend.ts
// `/topology/monitor` 详情栏的节点趋势取数（NMCPS-DESIGN-001 §6.5 / §九 A3）。
//
// 取数内核在 `useMetricSeries()`（目录 join + 取数 + 竞态），本文件只是它的**薄封装**：监控页
// 不需要选择器与速率开关，只需要「自动挑一条能画的序列」。保留这层封装的原因只有一个 ——
// 监控页的 `reason` 词汇表比内核少一档（页面只有「没指标名」与「没数据点」两句空态文案），
// 内核的 `no_paintable_metric` 在这里并回 `no_metric_names`，页面模板因此不用改。
import type { MetricSeriesPoint } from "~~/app/utils/chart/metricSeries";
import type { MetricSeriesError } from "~~/layers/topology/app/composables/useMetricSeries";
import { useMetricSeries } from "~~/layers/topology/app/composables/useMetricSeries";

/** 「没有可画的序列」的两种正常原因（不是错误，不显示上游文案） */
export type NodeTrendReason = "" | "no_metric_names" | "no_datapoints";

/** 失败信息：`code` 保留 BFF / 上游语义，`message` 是原话（数据，不翻译） */
export type NodeTrendError = MetricSeriesError;

export function useNodeTrend(ip: Ref<string>) {
	const series = useMetricSeries(ip);

	/**
	 * 空态原因收敛到监控页的两种口径：清单里一条可画的都没有时，对页面而言等同于「没有可查指标」。
	 * 选择器页面（`device-metrics`）直接用内核的三种原因，因为它要区分「这条是文本指标」。
	 */
	const reason = computed<NodeTrendReason>(() => {
		const current = series.reason.value;

		if (current === "no_paintable_metric")
			return "no_metric_names";

		// 监控页不传 `ifIndex`（§6.9 的过滤只用于链路页），这条内核原因在这里不可能出现；
		// 万一将来出现，按「没有可画点」处理，仍不伪造 0 值曲线。
		if (current === "no_interface_series")
			return "no_datapoints";

		return current as NodeTrendReason;
	});

	return {
		/** 正在画的指标编码（`""` = 还没有） */
		metricCode: series.selectedCode,
		points: series.points as Ref<MetricSeriesPoint[]>,
		/** 被丢弃的非法点数（`""` / `"NaN"` / `null`；不补 0，只计数） */
		dropped: series.dropped,
		/** 「没有可画序列」的正常原因（页面按 i18n 映射文案） */
		reason,
		error: series.error,
		loading: series.loading,
		stale: series.stale,
		reload: series.reload
	};
}
