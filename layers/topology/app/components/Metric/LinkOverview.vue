<template>
	<!--
		「链路概览」Tab（1.0 `linkMetrics.vue` 的 overview 面板 + `Telemetry/Overview.vue` 的链路版）。

		只呈现 `/metric/link` 的 `metric_LinkFact`（`NMCPS-CONTRACT-002` §九）真有的字段：
		`identity`（两端 + 发现方式 + SSID）和 `metrics`（带宽 / 流量 / 利用率 / 时延）。
		1.0 概览里靠遥测快照补的「链路名称 / 描述 / 拓扑来源」在 2.0 没有字段，不列空行。
	-->
	<div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
		<MetricFactCard :title="$t('pages.telemetry.link.identity')" :rows="identityRows" />

		<MetricFactCard :title="$t('pages.telemetry.link.traffic')" :rows="trafficRows">
			<p class="pt-2 text-xs text-(--ui-text-muted)">
				{{ $t("pages.telemetry.link.trafficGap") }}
			</p>
		</MetricFactCard>

		<MetricFactCard :title="$t('pages.telemetry.link.qualityFlags')" :rows="flagRows">
			<div v-if="link.qualityKeys.length" class="flex flex-wrap gap-1 pt-2">
				<UBadge v-for="key in link.qualityKeys" :key="key" variant="subtle" color="warning" size="sm">
					{{ key }}
				</UBadge>
			</div>
			<p v-else class="pt-2 text-xs text-(--ui-text-muted)">
				{{ $t("pages.telemetry.link.qualityFlagsEmpty") }}
			</p>
		</MetricFactCard>

		<MetricFactCard :title="$t('pages.telemetry.link.endpoints')" :rows="endpointRows">
			<p class="pt-2 text-xs text-(--ui-text-muted)">
				{{ $t("pages.telemetry.link.endpointsGap") }}
			</p>
		</MetricFactCard>
	</div>
</template>

<script setup lang="ts">
	import type { MetricLinkRow } from "~~/app/utils/metric/metricLedger";
	import { formatCount, formatDbm, formatMbps, formatMillis, formatPercent, textOrDash } from "~~/app/utils/metric/metricFormat";

	const props = defineProps<{
		/** 左栏台账的同一行（详情只读，不再回查 `/metric/link`） */
		link: MetricLinkRow
	}>();

	const { t } = useI18n();

	/** 采集作业：`jobs[]` 原样拼一行（实测一条链路跨 2~3 个 job） */
	const jobText = computed(() => (props.link.jobs.length ? props.link.jobs.join(" · ") : "—"));

	const identityRows = computed(() => [
		{ label: t("pages.telemetry.link.id"), value: textOrDash(props.link.id), testid: "link-detail-id" },
		{ label: t("pages.telemetry.link.status"), value: textOrDash(props.link.status), mono: false },
		{ label: t("pages.telemetry.link.graphStatus"), value: textOrDash(props.link.graphStatus), mono: false },
		{ label: t("pages.telemetry.link.graphMedium"), value: textOrDash(props.link.graphMedium), mono: false },
		{ label: t("pages.telemetry.link.medium"), value: textOrDash(props.link.medium), mono: false },
		{ label: t("pages.telemetry.link.discovery"), value: textOrDash(props.link.discovery), mono: false },
		{ label: t("pages.telemetry.link.ssid"), value: textOrDash(props.link.ssid), mono: false },
		{ label: t("pages.telemetry.link.jobs"), value: jobText.value, mono: false }
	]);

	const trafficRows = computed(() => [
		{ label: t("pages.telemetry.link.bandwidth"), value: formatMbps(props.link.bandwidthMbps) },
		{ label: t("pages.telemetry.link.trafficIn"), value: formatMbps(props.link.trafficInMbps) },
		{ label: t("pages.telemetry.link.trafficOut"), value: formatMbps(props.link.trafficOutMbps) },
		{ label: t("pages.telemetry.link.usage"), value: formatPercent(props.link.usagePercent) },
		{ label: t("pages.telemetry.link.latency"), value: formatMillis(props.link.latencyMs) },
		{ label: t("pages.telemetry.link.jitter"), value: formatMillis(props.link.jitterMs) },
		{ label: t("pages.telemetry.link.loss"), value: formatPercent(props.link.packetLossPercent) },
		{ label: t("pages.telemetry.link.errorRate"), value: formatPercent(props.link.errorRatePercent, 4) },
		{ label: t("pages.telemetry.link.rxPower"), value: formatDbm(props.link.rxPowerDbm) }
	]);

	/** 质量标记本身是**键名**（上游原样），值只用 badge 呈现，不在这里翻译 */
	const flagRows = computed(() => [
		{ label: t("pages.telemetry.link.qualityFlagCount"), value: String(props.link.qualityKeys.length) },
		{ label: t("pages.telemetry.link.metricValid"), value: formatCount(props.link.metricValid) }
	]);

	const endpointRows = computed(() => [
		{ label: t("pages.telemetry.link.sourceCode"), value: textOrDash(props.link.source.deviceCode) },
		{ label: t("pages.telemetry.link.targetCode"), value: textOrDash(props.link.target.deviceCode) },
		{ label: t("pages.telemetry.link.sourceIf"), value: textOrDash(props.link.source.interfaceName) },
		{ label: t("pages.telemetry.link.targetIf"), value: textOrDash(props.link.target.interfaceName) },
		{ label: t("pages.telemetry.link.sourceMac"), value: textOrDash(props.link.source.ifPhysAddress) },
		{ label: t("pages.telemetry.link.targetMac"), value: textOrDash(props.link.target.ifPhysAddress) }
	]);
</script>
