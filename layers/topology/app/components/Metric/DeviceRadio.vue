<template>
	<!--
		「射频」Tab（1.0 `Telemetry/Radio.vue` 的 2.0 复刻）。

		数据来源是 `/metric/device` 的 `radio` 块（实测胖 AP 样本给 SSID、信道 36、5.18 GHz、20 MHz、
		发射功率 36 dBm、噪声 -93 dBm、关联 1 个客户端，并逐个列出 `associations[]` 的 RSSI / 速率 /
		状态）—— 这页**不是**缺口页。

		`radio` 整块为 `null` 时不下结论：可能是非无线设备，也可能是没上报，页面只写「上游没给 radio
		块」，不替上游选一种解释。
	-->
	<div class="space-y-3">
		<template v-if="radio">
			<div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
				<MetricFactCard :title="$t('pages.telemetry.radio.params')" :rows="paramRows">
					<p class="pt-2 text-xs text-(--ui-text-muted)">
						{{ $t("pages.telemetry.radio.enumNote") }}
					</p>
				</MetricFactCard>

				<MetricFactCard :title="$t('pages.telemetry.radio.clients')" :rows="clientRows">
					<p class="pt-2 text-xs text-(--ui-text-muted)">
						{{ $t("pages.telemetry.radio.ratesNote", { rates: rateText }) }}
					</p>
				</MetricFactCard>
			</div>

			<!-- 关联清单：空数组是真实回答（确实没有客户端），不画空表 -->
			<div v-if="radio.associations.length" class="space-y-1">
				<h3 class="text-xs font-semibold text-(--ui-text-muted)">
					{{ $t("pages.telemetry.radio.assocTable") }}
				</h3>
				<UTable
					data-testid="device-radio-associations"
					:data="radio.associations"
					:columns="associationColumns"
					:ui="{ td: 'py-1.5 px-2', th: 'py-2 px-2' }"
					class="rounded-lg border border-(--ui-border)"
				>
					<template #rssiDbm-cell="{ row }">
						{{ formatDbm(row.original.rssiDbm, 0) }}
					</template>
					<template #txRateMbps-cell="{ row }">
						{{ formatMbpsOrDash(row.original.txRateMbps) }}
					</template>
					<template #status-cell="{ row }">
						{{ textOrDash(row.original.status) }}
					</template>
				</UTable>
			</div>
			<p v-else data-testid="device-radio-no-client" class="text-xs text-(--ui-text-muted)">
				{{ $t("pages.telemetry.radio.clientsEmpty") }}
			</p>
			<!-- MLO 多链路：`multilinks` 是数组（实测只有终端报：9 台共 15 条），空数组同样是真实回答 -->
			<div v-if="radio.multilinks.length" class="space-y-1">
				<h3 class="text-xs font-semibold text-(--ui-text-muted)">
					{{ $t("pages.telemetry.radio.multilinks") }}
				</h3>
				<UTable
					data-testid="device-radio-multilinks"
					:data="radio.multilinks"
					:columns="multilinkColumns"
					:ui="{ td: 'py-1.5 px-2', th: 'py-2 px-2' }"
					class="rounded-lg border border-(--ui-border)"
				>
					<!-- 数值列 `null` ⇒ `—`（§九：空白单元格会被读成 0 或空串） -->
					<template #band-cell="{ row }">
						{{ numberOrDash(row.original.band) }}
					</template>
					<template #channel-cell="{ row }">
						{{ numberOrDash(row.original.channel) }}
					</template>
					<template #rssiDbm-cell="{ row }">
						{{ formatDbm(row.original.rssiDbm, 0) }}
					</template>
					<template #txRateMbps-cell="{ row }">
						{{ formatMbpsOrDash(row.original.txRateMbps) }}
					</template>
					<template #status-cell="{ row }">
						{{ textOrDash(row.original.status) }}
					</template>
				</UTable>
			</div>
			<p v-else data-testid="device-radio-no-multilink" class="text-xs text-(--ui-text-muted)">
				{{ $t("pages.telemetry.radio.multilinksEmpty") }}
			</p>
		</template>

		<MetricTelemetryGap
			v-else
			tab="radio"
			:body="$t('pages.telemetry.radio.absentBody')"
			:fields="$t('pages.telemetry.radio.absentFields')"
		/>
	</div>
</template>

<script setup lang="ts">
	import type { TableColumn } from "@nuxt/ui";
	import type { MetricDeviceRow, MetricRadioAssocView, MetricRadioMultilinkView } from "~~/app/utils/metric/metricLedger";
	import { formatCount, formatDbm, textOrDash } from "~~/app/utils/metric/metricFormat";

	const props = defineProps<{
		/** 左栏台账的同一行（详情只读） */
		device: MetricDeviceRow
	}>();

	const { t } = useI18n();

	const radio = computed(() => props.device.radio);

	/** 枚举数值（`mode` / `band` / `interference_level`）原样显示，不猜语义（§7.2） */
	function numberOrDash(value: number | null): string {
		return typeof value === "number" && Number.isFinite(value) ? String(value) : "—";
	}

	const paramRows = computed(() => [
		{ label: t("pages.telemetry.radio.ssid"), value: textOrDash(radio.value?.ssid), mono: false },
		{ label: t("pages.telemetry.radio.channel"), value: numberOrDash(radio.value?.channel ?? null), testid: "device-radio-channel" },
		{ label: t("pages.telemetry.radio.frequency"), value: formatMhz(radio.value?.frequencyMhz) },
		{ label: t("pages.telemetry.radio.bandwidth"), value: formatMhz(radio.value?.bandwidthMhz) },
		{ label: t("pages.telemetry.radio.band"), value: numberOrDash(radio.value?.band ?? null) },
		{ label: t("pages.telemetry.radio.mode"), value: numberOrDash(radio.value?.mode ?? null) },
		{ label: t("pages.telemetry.radio.bssType"), value: numberOrDash(radio.value?.bssType ?? null) },
		{ label: t("pages.telemetry.radio.role"), value: numberOrDash(radio.value?.role ?? null) },
		{ label: t("pages.telemetry.radio.powerMgmt"), value: numberOrDash(radio.value?.powerMgmtMode ?? null) },
		{ label: t("pages.telemetry.radio.txPower"), value: formatDbm(radio.value?.txPowerDbm, 0) },
		{ label: t("pages.telemetry.radio.noise"), value: formatDbm(radio.value?.noiseDbm, 0) },
		{ label: t("pages.telemetry.radio.interference"), value: numberOrDash(radio.value?.interferenceLevel ?? null) }
	]);

	/** 关联 / 多链路计数、支持速率与对端 AP：缺就是 `—`（不写「无对端」这种结论） */
	const clientRows = computed(() => [
		{ label: t("pages.telemetry.radio.assocCount"), value: formatCount(radio.value?.assocCount ?? null), testid: "device-radio-assoc-count" },
		{ label: t("pages.telemetry.radio.assocListed"), value: formatCount(radio.value?.associations.length ?? 0) },
		{ label: t("pages.telemetry.radio.multilinkCount"), value: formatCount(radio.value?.multilinks.length ?? 0) },
		{ label: t("pages.telemetry.radio.rateTx"), value: formatMbpsOrDash(radio.value?.supportedRatesTxMbps ?? null) },
		{ label: t("pages.telemetry.radio.rateRx"), value: formatMbpsOrDash(radio.value?.supportedRatesRxMbps ?? null) },
		{ label: t("pages.telemetry.radio.peerAp"), value: textOrDash(radio.value?.peerApName), mono: false, testid: "device-radio-peer-ap" },
		{ label: t("pages.telemetry.radio.peerApMac"), value: textOrDash(radio.value?.peerApMac) }
	]);

	const rateText = computed(() => radio.value && radio.value.operationalRates.length
		? radio.value.operationalRates.join(" / ")
		: "—");

	const associationColumns = computed<TableColumn<MetricRadioAssocView>[]>(() => [
		{ accessorKey: "staName", header: t("pages.telemetry.radio.columns.sta") },
		{ accessorKey: "staMac", header: t("pages.telemetry.radio.columns.mac") },
		{ accessorKey: "rssiDbm", header: t("pages.telemetry.radio.columns.rssi") },
		{ accessorKey: "txRateMbps", header: t("pages.telemetry.radio.columns.tx") },
		{ accessorKey: "status", header: t("pages.telemetry.radio.columns.status") }
	]);

	const multilinkColumns = computed<TableColumn<MetricRadioMultilinkView>[]>(() => [
		{ accessorKey: "index", header: t("pages.telemetry.radio.columns.index") },
		{ accessorKey: "bssid", header: t("pages.telemetry.radio.columns.bssid") },
		{ accessorKey: "band", header: t("pages.telemetry.radio.columns.band") },
		{ accessorKey: "channel", header: t("pages.telemetry.radio.columns.channel") },
		{ accessorKey: "rssiDbm", header: t("pages.telemetry.radio.columns.rssi") },
		{ accessorKey: "txRateMbps", header: t("pages.telemetry.radio.columns.tx") },
		{ accessorKey: "status", header: t("pages.telemetry.radio.columns.status") }
	]);

	/** 频率：单位符号属数据，直接拼；`null` ⇒ `—` */
	function formatMhz(value: number | null | undefined): string {
		return typeof value === "number" && Number.isFinite(value) ? `${value} MHz` : "—";
	}

	function formatMbpsOrDash(value: number | null): string {
		return typeof value === "number" && Number.isFinite(value) ? `${value} Mbps` : "—";
	}
</script>
