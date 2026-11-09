<template>
	<!--
		「链路质量」Tab（1.0 `Telemetry/LinkQuality.vue` 的 2.0 复刻）。

		来源：`/metric/link` 的 `metrics.latency_ms` / `jitter_ms` / `packet_loss_percent` /
		`rx_power_dbm` 与 `quality`（只有布尔键，值为 `true` 才算置位，原样不翻译 —— §九）。

		2026-11-08 实测补上 `probe_peer` / `probe_dir` / `rtt_mdev_us`（探针侧：47/47 条有值）与四个
		新鲜度 `*_age_sec` + `metric_valid` —— 这些是真字段，此前被当成「2.0 没有端点」是误判。
		仍然真缺的只有重传 / 乱序计数与分端点的质量拆分（缺口卡如实列出）。
	-->
	<div class="space-y-3">
		<div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
			<MetricFactCard :title="$t('pages.telemetry.link.quality')" :rows="qualityRows">
				<div class="flex flex-wrap gap-1 pt-2">
					<UBadge v-for="key in link.qualityKeys" :key="key" variant="subtle" color="warning" size="sm">
						{{ key }}
					</UBadge>
					<p v-if="!link.qualityKeys.length" class="text-xs text-(--ui-text-muted)">
						{{ $t("pages.telemetry.link.qualityFlagsEmpty") }}
					</p>
				</div>
			</MetricFactCard>

			<MetricFactCard :title="$t('pages.telemetry.link.probe')" :rows="probeRows">
				<p class="pt-2 text-xs text-(--ui-text-muted)">
					{{ $t("pages.telemetry.link.probeNote") }}
				</p>
			</MetricFactCard>
		</div>

		<MetricTelemetryGap
			tab="packets"
			:body="$t('pages.telemetry.gap.linkPackets')"
			:fields="$t('pages.telemetry.gap.linkPacketsFields')"
		/>
	</div>
</template>

<script setup lang="ts">
	import type { MetricLinkRow } from "~~/app/utils/metric/metricLedger";
	import { formatCount, formatDbm, formatMillis, formatPercent, textOrDash } from "~~/app/utils/metric/metricFormat";

	const props = defineProps<{
		link: MetricLinkRow
	}>();

	const { t } = useI18n();

	const qualityRows = computed(() => [
		{ label: t("pages.telemetry.link.latency"), value: formatMillis(props.link.latencyMs), testid: "link-latency" },
		{ label: t("pages.telemetry.link.jitter"), value: formatMillis(props.link.jitterMs), testid: "link-jitter" },
		{ label: t("pages.telemetry.link.loss"), value: formatPercent(props.link.packetLossPercent, 4) },
		{ label: t("pages.telemetry.link.rxPower"), value: formatDbm(props.link.rxPowerDbm) },
		{ label: t("pages.telemetry.link.sourceRssi"), value: formatDbm(props.link.source.rssiDbm) },
		{ label: t("pages.telemetry.link.targetRssi"), value: formatDbm(props.link.target.rssiDbm) }
	]);

	/** 探针侧：对端、方向（数值枚举原样）、rtt 偏差，以及四个字段各自的新鲜度（秒） */
	const probeRows = computed(() => [
		{ label: t("pages.telemetry.link.probePeer"), value: textOrDash(props.link.probePeer), testid: "link-probe-peer" },
		{ label: t("pages.telemetry.link.probeDir"), value: formatCount(props.link.probeDir) },
		{ label: t("pages.telemetry.link.rttMdev"), value: formatMicros(props.link.rttMdevUs) },
		{ label: t("pages.telemetry.link.metricValid"), value: formatCount(props.link.metricValid) },
		{ label: t("pages.telemetry.link.latencyAge"), value: formatSeconds(props.link.latencyAgeSec) },
		{ label: t("pages.telemetry.link.jitterAge"), value: formatSeconds(props.link.jitterAgeSec) },
		{ label: t("pages.telemetry.link.lossAge"), value: formatSeconds(props.link.lossAgeSec) },
		{ label: t("pages.telemetry.link.rateAge"), value: formatSeconds(props.link.rateAgeSec) }
	]);

	/** 微秒：`rtt_mdev_us` 是上游微秒原值，不换算成毫秒（换错量级比缺数更糟） */
	function formatMicros(value: number | null): string {
		return typeof value === "number" && Number.isFinite(value) ? `${formatCount(value)} µs` : "—";
	}

	/** 新鲜度（秒）：直接给秒，不换算成「x 分钟前」这种伪造视图 */
	function formatSeconds(value: number | null): string {
		return typeof value === "number" && Number.isFinite(value) ? `${formatCount(value)} s` : "—";
	}
</script>
