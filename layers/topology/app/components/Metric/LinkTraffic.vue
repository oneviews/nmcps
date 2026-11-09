<template>
	<!--
		「流量方向」Tab（1.0 `Telemetry/LinkTraffic.vue` 的 2.0 复刻）。

		2.0 的 `/metric/link` 只给链路级两个标量 `metrics.traffic_in_mbps` / `traffic_out_mbps`
		（`NMCPS-CONTRACT-002` §九），契约**没有**规定「哪端进哪端出」，也没有分端点的流量；
		因此这里并排列出两个方向的上报值，而不是按设备逐端拆一张方向表（拆出来的另一半是猜的）。
	-->
	<div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
		<MetricFactCard :title="$t('pages.telemetry.link.traffic')" :rows="trafficRows">
			<p class="pt-2 text-xs text-(--ui-text-muted)">
				{{ $t("pages.telemetry.link.trafficDirectionGap") }}
			</p>
		</MetricFactCard>

		<MetricFactCard :title="$t('pages.telemetry.link.capacity')" :rows="capacityRows">
			<p class="pt-2 text-xs text-(--ui-text-muted)">
				{{ $t("pages.telemetry.link.capacityGap") }}
			</p>
		</MetricFactCard>
	</div>
</template>

<script setup lang="ts">
	import type { MetricLinkRow } from "~~/app/utils/metric/metricLedger";
	import { formatMbps, formatPercent } from "~~/app/utils/metric/metricFormat";

	const props = defineProps<{
		link: MetricLinkRow
	}>();

	const { t } = useI18n();

	const trafficRows = computed(() => [
		{ label: t("pages.telemetry.link.trafficIn"), value: formatMbps(props.link.trafficInMbps), testid: "link-traffic-in" },
		{ label: t("pages.telemetry.link.trafficOut"), value: formatMbps(props.link.trafficOutMbps), testid: "link-traffic-out" }
	]);

	const capacityRows = computed(() => [
		{ label: t("pages.telemetry.link.bandwidth"), value: formatMbps(props.link.bandwidthMbps) },
		{ label: t("pages.telemetry.link.usage"), value: formatPercent(props.link.usagePercent) },
		{ label: t("pages.telemetry.link.sourceCapacity"), value: formatMbps(props.link.source.capacityMbps) },
		{ label: t("pages.telemetry.link.targetCapacity"), value: formatMbps(props.link.target.capacityMbps) }
	]);
</script>
