<template>
	<!--
		「数据质量」Tab（1.0 `Telemetry/DataQuality.vue` 的 2.0 复刻）。

		数据来源三块，都在 `/metric/device` 的同一个设备事实里：
		· `device_quality` —— 1.0「探针质量」卡的对应字段：时延 µs、抖动 µs、丢包比 ppm、
		指标新鲜度（`metric_age_sec`）、`metric_valid`、对端数 `peer_count`（实测胖 AP：
		`16850 µs` / `249 µs` / `0 ppm` / `326 s`）；
		· `quality` —— 质量标记（`job_mixed` / `duplicate_samples` / `vendor_fields_unavailable`），
		键名原样显示、不翻译；
		· `sim` / `jobs` / `anchor_job` —— 该设备归属的仿真会话与采集作业。

		1.0 这页还会比对「探针可达性」与「网管侧可达性」两条独立链路：2.0 只有设备侧一份
		`device_quality`，没有第二条链路可比，这一条写在卡片下面的缺口卡里。
	-->
	<div class="space-y-3">
		<div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
			<MetricFactCard :title="$t('pages.telemetry.deviceQuality.probe')" :rows="probeRows">
				<p class="pt-2 text-xs text-(--ui-text-muted)">
					{{ $t("pages.telemetry.deviceQuality.probeNote") }}
				</p>
			</MetricFactCard>

			<MetricFactCard :title="$t('pages.telemetry.deviceQuality.collect')" :rows="collectRows" />
		</div>

		<MetricFactCard
			:title="$t('pages.telemetry.deviceQuality.flags')"
			:rows="flagRows"
			:empty-text="$t('pages.telemetry.deviceQuality.flagsEmpty')"
			data-testid="device-quality-flags"
		/>

		<MetricTelemetryGap
			tab="dataQualityProbe"
			:body="$t('pages.telemetry.gap.deviceProbeCompare')"
			:fields="$t('pages.telemetry.gap.deviceProbeCompareFields')"
		/>
	</div>
</template>

<script setup lang="ts">
	import type { MetricDeviceRow } from "~~/app/utils/metric/metricLedger";
	import { formatCount, textOrDash } from "~~/app/utils/metric/metricFormat";

	const props = defineProps<{
		/** 左栏台账的同一行（详情只读） */
		device: MetricDeviceRow
	}>();

	const { t } = useI18n();

	/** 微秒：单位符号属数据，直接拼；`null` ⇒ `—`（不换算成 ms，避免把 16850 µs 四舍五入成 16.9 ms） */
	function formatMicros(value: number | null): string {
		return typeof value === "number" && Number.isFinite(value) ? `${formatCount(value)} µs` : "—";
	}

	const probeRows = computed(() => [
		{ label: t("pages.telemetry.deviceQuality.latency"), value: formatMicros(props.device.qualityLatencyUs), testid: "device-quality-latency" },
		{ label: t("pages.telemetry.deviceQuality.jitter"), value: formatMicros(props.device.qualityJitterUs) },
		{ label: t("pages.telemetry.deviceQuality.lossRatio"), value: formatPpm(props.device.qualityLossRatioPpm) },
		{ label: t("pages.telemetry.deviceQuality.metricAge"), value: formatSeconds(props.device.qualityMetricAgeSec) },
		{ label: t("pages.telemetry.deviceQuality.metricValid"), value: formatCount(props.device.qualityMetricValid) },
		{ label: t("pages.telemetry.deviceQuality.peerCount"), value: formatCount(props.device.qualityPeerCount) }
	]);

	const collectRows = computed(() => [
		{ label: t("pages.telemetry.deviceQuality.session"), value: textOrDash(props.device.simSessionId) },
		{ label: t("pages.telemetry.deviceQuality.scenario"), value: textOrDash(props.device.simScenarioName), mono: false },
		{ label: t("pages.telemetry.deviceQuality.jobs"), value: props.device.jobs.length ? props.device.jobs.join(" · ") : "—", mono: false },
		{ label: t("pages.telemetry.deviceQuality.anchorJob"), value: textOrDash(props.device.anchorJob) }
	]);

	/** 质量标记：键名原样（属数据），置位即列出；一个都没有时走卡片自带空态 */
	const flagRows = computed(() => props.device.qualityKeys.map((key) => ({ label: key, value: t("pages.telemetry.deviceQuality.flagSet") })));

	/** ppm = 百万分之一：`0 ppm` 是真实读数（实测样本），不能省成 `0%` */
	function formatPpm(value: number | null): string {
		return typeof value === "number" && Number.isFinite(value) ? `${formatCount(value)} ppm` : "—";
	}

	/** 新鲜度（秒）：直接给秒，不换算成「x 分钟前」这种伪造视图 */
	function formatSeconds(value: number | null): string {
		return typeof value === "number" && Number.isFinite(value) ? `${formatCount(value)} s` : "—";
	}
</script>
