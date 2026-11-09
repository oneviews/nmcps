<template>
	<!--
		「错误统计」Tab（1.0 `Telemetry/Errors.vue` 的 2.0 复刻）。

		2026-11-08 实测更正：`/metric/link` 的 `metrics` 逐条都有 `in_errors` / `out_errors` /
		`in_discards` / `out_discards` / `in_unknown_protos` / `out_qlen` 与四个单播 / 非单播报文计数
		（47/47 条），此前把它们写成「2.0 没有端点」是误判。真正没有的只有 CRC / 对齐错误 / 冲突
		这三类**物理层**错误计数，写在卡下的缺口卡里。
	-->
	<div class="space-y-3">
		<div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
			<MetricFactCard :title="$t('pages.telemetry.link.errors')" :rows="errorRows">
				<p class="pt-2 text-xs text-(--ui-text-muted)">
					{{ $t("pages.telemetry.link.errorsNote") }}
				</p>
			</MetricFactCard>

			<MetricFactCard :title="$t('pages.telemetry.link.packets')" :rows="packetRows">
				<p class="pt-2 text-xs text-(--ui-text-muted)">
					{{ $t("pages.telemetry.link.packetsNote") }}
				</p>
			</MetricFactCard>
		</div>

		<MetricTelemetryGap
			tab="errors"
			:body="$t('pages.telemetry.gap.linkErrors')"
			:fields="$t('pages.telemetry.gap.linkErrorsFields')"
		/>
	</div>
</template>

<script setup lang="ts">
	import type { MetricLinkRow } from "~~/app/utils/metric/metricLedger";
	import { formatCount, formatPercent } from "~~/app/utils/metric/metricFormat";

	const props = defineProps<{
		link: MetricLinkRow
	}>();

	const { t } = useI18n();

	/** 错误率按四位小数给（`0.0123%` 这类值四位才看得见，截到一位就成 `0.0%`） */
	const errorRows = computed(() => [
		{ label: t("pages.telemetry.link.errorRate"), value: formatPercent(props.link.errorRatePercent, 4), testid: "link-error-rate" },
		{ label: t("pages.telemetry.link.loss"), value: formatPercent(props.link.packetLossPercent, 4), testid: "link-loss" },
		{ label: t("pages.telemetry.link.inErrors"), value: formatCount(props.link.inErrors), testid: "link-in-errors" },
		{ label: t("pages.telemetry.link.outErrors"), value: formatCount(props.link.outErrors) },
		{ label: t("pages.telemetry.link.inDiscards"), value: formatCount(props.link.inDiscards) },
		{ label: t("pages.telemetry.link.outDiscards"), value: formatCount(props.link.outDiscards) },
		{ label: t("pages.telemetry.link.inUnknownProtos"), value: formatCount(props.link.inUnknownProtos) },
		{ label: t("pages.telemetry.link.outQlen"), value: formatCount(props.link.outQlen) }
	]);

	/** 报文计数：单播 / 非单播两个方向，字段名原样列在标签里（上游 schema 键名属数据） */
	const packetRows = computed(() => [
		{ label: t("pages.telemetry.link.inUcastPkts"), value: formatCount(props.link.inUcastPkts), testid: "link-in-ucast" },
		{ label: t("pages.telemetry.link.outUcastPkts"), value: formatCount(props.link.outUcastPkts) },
		{ label: t("pages.telemetry.link.inNucastPkts"), value: formatCount(props.link.inNucastPkts) },
		{ label: t("pages.telemetry.link.outNucastPkts"), value: formatCount(props.link.outNucastPkts) }
	]);
</script>
