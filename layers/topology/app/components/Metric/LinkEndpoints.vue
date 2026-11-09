<template>
	<!--
		「端点对比」Tab（1.0 链路详情的端口对卡片）。

		两端字段全部原样透出 `identity.{source,target}`（`NMCPS-CONTRACT-002` §九）：
		`oper_status` 是**数值**且枚举未定稿，这里不映射成 up/down（猜错方向比显示数字更糟）。
	-->
	<div class="space-y-3">
		<MetricCompareTable
			testid="link-endpoint-compare"
			:title="$t('pages.telemetry.link.endpointCompare')"
			:left-title="selected.source.deviceCode || $t('pages.telemetry.link.source')"
			:right-title="selected.target.deviceCode || $t('pages.telemetry.link.target')"
			:rows="rows"
			:note="$t('pages.telemetry.link.endpointCompareNote')"
		/>
	</div>
</template>

<script setup lang="ts">
	import type { MetricLinkRow } from "~~/app/utils/metric/metricLedger";
	import { formatBps, formatDbm, formatMbps, textOrDash } from "~~/app/utils/metric/metricFormat";

	const props = defineProps<{
		selected: MetricLinkRow
	}>();

	const { t } = useI18n();

	/** 数值字段同样走「不可判定 ⇒ `—`」：`String(null)` 会写出一个假 `null` */
	function textOf(value: number | null): string {
		return typeof value === "number" && Number.isFinite(value) ? String(value) : "—";
	}

	const rows = computed(() => [
		{ label: t("pages.telemetry.link.deviceCode"), left: textOrDash(props.selected.source.deviceCode), right: textOrDash(props.selected.target.deviceCode) },
		{ label: t("pages.telemetry.link.deviceRole"), left: textOrDash(props.selected.source.deviceRole), right: textOrDash(props.selected.target.deviceRole) },
		{ label: t("pages.telemetry.link.interfaceName"), left: textOrDash(props.selected.source.interfaceName), right: textOrDash(props.selected.target.interfaceName) },
		{ label: t("pages.telemetry.link.interfaceId"), left: textOrDash(props.selected.source.interfaceId), right: textOrDash(props.selected.target.interfaceId) },
		{ label: t("pages.telemetry.link.ifIndex"), left: textOf(props.selected.source.ifIndex), right: textOf(props.selected.target.ifIndex) },
		{ label: t("pages.telemetry.link.ifAlias"), left: textOrDash(props.selected.source.ifAlias), right: textOrDash(props.selected.target.ifAlias) },
		{ label: t("pages.telemetry.link.ifMtu"), left: textOf(props.selected.source.ifMtu), right: textOf(props.selected.target.ifMtu) },
		{ label: t("pages.telemetry.link.ifPhysAddress"), left: textOrDash(props.selected.source.ifPhysAddress), right: textOrDash(props.selected.target.ifPhysAddress) },
		{ label: t("pages.telemetry.link.ifSpeed"), left: formatBps(props.selected.source.ifSpeedBps), right: formatBps(props.selected.target.ifSpeedBps) },
		{ label: t("pages.telemetry.link.medium"), left: textOrDash(props.selected.source.medium), right: textOrDash(props.selected.target.medium) },
		{ label: t("pages.telemetry.link.adminStatus"), left: textOf(props.selected.source.adminStatus), right: textOf(props.selected.target.adminStatus) },
		{ label: t("pages.telemetry.link.operStatus"), left: textOf(props.selected.source.operStatus), right: textOf(props.selected.target.operStatus) },
		{ label: t("pages.telemetry.link.capacity"), left: formatMbps(props.selected.source.capacityMbps), right: formatMbps(props.selected.target.capacityMbps) },
		{ label: t("pages.telemetry.link.txRate"), left: formatMbps(props.selected.source.txRateMbps), right: formatMbps(props.selected.target.txRateMbps) },
		{ label: t("pages.telemetry.link.rssi"), left: formatDbm(props.selected.source.rssiDbm), right: formatDbm(props.selected.target.rssiDbm) }
	]);
</script>
