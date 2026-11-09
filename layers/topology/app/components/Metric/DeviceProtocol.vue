<template>
	<!--
		「协议」Tab（1.0 `Telemetry/Protocol.vue` 的 2.0 复刻）。

		数据来源是 `/metric/device` 的 `protocol.{ip,icmp,tcp,udp}` —— 实测每个设备都带这四组计数器
		（胖 AP 样本：`tcp.retrans_segs=487114`、`udp.in_datagrams=50111034`、`icmp.in_errors=1760`），
		所以这页**不是**「2.0 没有端点」的缺口页。逐项 `null` 照实显示 `—`（IP 组在实测样本里整组为
		`null`），不补 0。

		真正的缺口只有一条：1.0 这页还列 OSPF / BGP 邻居状态，`/metric/device` 里没有邻居协议表 ——
		它在卡片下方如实说明，而不是把整页变成缺口卡。
	-->
	<div class="space-y-3">
		<div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
			<MetricFactCard
				:title="$t('pages.telemetry.protocol.ip')"
				:rows="rowsOf(device.protocolIp)"
				data-testid="device-protocol-ip"
			/>
			<MetricFactCard
				:title="$t('pages.telemetry.protocol.icmp')"
				:rows="rowsOf(device.protocolIcmp)"
				data-testid="device-protocol-icmp"
			/>
			<MetricFactCard
				:title="$t('pages.telemetry.protocol.tcp')"
				:rows="rowsOf(device.protocolTcp)"
				data-testid="device-protocol-tcp"
			/>
			<MetricFactCard
				:title="$t('pages.telemetry.protocol.udp')"
				:rows="rowsOf(device.protocolUdp)"
				data-testid="device-protocol-udp"
			/>
		</div>

		<!-- 整块全空时才说「上游没上报」，且只描述事实，不臆测原因 -->
		<UAlert
			v-if="allNull"
			color="neutral"
			variant="subtle"
			icon="carbon:information"
			data-testid="device-protocol-empty"
			:title="$t('pages.telemetry.protocol.allNullTitle')"
			:description="$t('pages.telemetry.protocol.allNullBody')"
		/>

		<MetricTelemetryGap
			tab="protocolStack"
			:body="$t('pages.telemetry.gap.deviceProtocolStack')"
			:fields="$t('pages.telemetry.gap.deviceProtocolStackFields')"
		/>
	</div>
</template>

<script setup lang="ts">
	import type { MetricCounterView, MetricDeviceRow } from "~~/app/utils/metric/metricLedger";
	import { formatCount } from "~~/app/utils/metric/metricFormat";

	const props = defineProps<{
		/** 左栏台账的同一行（详情只读） */
		device: MetricDeviceRow
	}>();

	/**
	* 计数器表：**标签用上游 schema 原样键名**（`in_retrans_segs` 这类名字属数据，不翻译），
	* 值走 `formatCount`（`null` ⇒ `—`）。顺序由归一内核固定，不随 JSON 抖动。
	*/
	function rowsOf(counters: MetricCounterView[]): Array<{ label: string, value: string }> {
		return counters.map((counter) => ({ label: counter.field, value: formatCount(counter.value) }));
	}

	/** 四组全为 `null` 才算「上游没上报」：只要有一组有值，就照实展示 */
	const allNull = computed(() => [...props.device.protocolIp, ...props.device.protocolIcmp, ...props.device.protocolTcp, ...props.device.protocolUdp]
		.every((counter) => counter.value === null));
</script>
