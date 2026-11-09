<template>
	<!--
		「节点概览」Tab（1.0 `Telemetry/Overview.vue` 的 2.0 复刻）。

		字段全部来自 `/metric/device` 的 `MetricDeviceFact`（`NMCPS-CONTRACT-002` §九），按实测响应
		取全：identity / health / interface_summary / traffic + `sys_*` / `hw` / `neighbors` /
		`neighbor_summary`。`null` 一律显示 `—`（契约禁 0 伪造）；`health` 整块为 `null` 时（实测胖 AP
		如此）三行都是 `—`，并在卡下说明「上游这一块没给」，不写成 0%。
	-->
	<div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
		<MetricFactCard :title="$t('pages.telemetry.device.basic')" :rows="basicRows" />

		<MetricFactCard :title="$t('pages.telemetry.device.system')" :rows="systemRows">
			<p class="pt-2 text-xs text-(--ui-text-muted)">
				{{ $t("pages.telemetry.device.systemGap") }}
			</p>
		</MetricFactCard>

		<MetricFactCard :title="$t('pages.telemetry.device.health')" :rows="healthRows">
			<p class="pt-2 text-xs text-(--ui-text-muted)">
				{{ healthNote }}
			</p>
		</MetricFactCard>

		<MetricFactCard :title="$t('pages.telemetry.device.hardware')" :rows="hardwareRows">
			<p v-if="device.hwEntities.length" class="pt-2 text-xs text-(--ui-text-muted)">
				{{ $t("pages.telemetry.device.hwEntitiesNote", { count: device.hwEntities.length }) }}
			</p>
		</MetricFactCard>

		<!-- 硬件实体：实测只有交换机报（36 台里 9 台各 1 条），空数组是真实回答，不画空表 -->
		<div v-if="device.hwEntities.length" class="space-y-1 lg:col-span-2">
			<h3 class="text-xs font-semibold text-(--ui-text-muted)">
				{{ $t("pages.telemetry.device.hwEntityTable") }}
			</h3>
			<UTable
				data-testid="device-hw-entities"
				:data="device.hwEntities"
				:columns="entityColumns"
				:ui="{ td: 'py-1.5 px-2', th: 'py-2 px-2' }"
				class="rounded-lg border border-(--ui-border)"
			/>
		</div>

		<MetricFactCard :title="$t('pages.telemetry.device.ports')" :rows="portRows">
			<p class="pt-2 text-xs text-(--ui-text-muted)">
				{{ $t("pages.telemetry.device.portsGap") }}
			</p>
		</MetricFactCard>

		<MetricFactCard :title="$t('pages.telemetry.device.neighbors')" :rows="neighborRows">
			<p class="pt-2 text-xs text-(--ui-text-muted)">
				{{ neighborListText }}
			</p>
		</MetricFactCard>

		<MetricFactCard :title="$t('pages.telemetry.device.traffic')" :rows="trafficRows">
			<p class="pt-2 text-xs text-(--ui-text-muted)">
				{{ $t("pages.telemetry.device.trafficGap") }}
			</p>
		</MetricFactCard>
	</div>
</template>

<script setup lang="ts">
	import type { TableColumn } from "@nuxt/ui";
	import type { MetricDeviceRow, MetricHwEntityView } from "~~/app/utils/metric/metricLedger";
	import { formatBps, formatCelsius, formatCount, formatPercent, splitDuration, textOrDash } from "~~/app/utils/metric/metricFormat";

	const props = defineProps<{
		/** 左栏台账的同一行（详情只读，不再回查 `/metric/device`） */
		device: MetricDeviceRow
	}>();

	const { t } = useI18n();

	/**
	 * 端口三项计数各自独立降级：`up` / `down` / `total` 缺哪项就那一项 `—`，
	 * 不拿另外两项补齐（`total - up` 顶出来的 `down` 是推算值，不是采集值）。
	 */
	function countOrDash(value: number | null): string {
		return typeof value === "number" && Number.isFinite(value) ? formatCount(value) : "—";
	}

	const uptimeText = computed(() => {
		const parts = splitDuration(props.device.uptimeSec);
		return parts
			? t("pages.telemetry.device.uptimeValue", { days: parts.days, hours: parts.hours, minutes: parts.minutes })
			: "—";
	});

	const basicRows = computed(() => [
		{ label: t("pages.telemetry.device.name"), value: textOrDash(props.device.name) },
		{ label: t("pages.telemetry.device.code"), value: textOrDash(props.device.id) },
		{ label: t("pages.telemetry.device.mgmtIp"), value: textOrDash(props.device.mgmtIp), testid: "device-detail-ip" },
		{ label: t("pages.telemetry.device.role"), value: textOrDash(props.device.role), mono: false },
		{ label: t("pages.telemetry.device.vendor"), value: textOrDash(props.device.vendor), mono: false },
		{ label: t("pages.telemetry.device.model"), value: textOrDash(props.device.model), mono: false },
		{ label: t("pages.telemetry.device.status"), value: textOrDash(props.device.status), mono: false },
		{ label: t("pages.telemetry.device.uptime"), value: uptimeText.value }
	]);

	/** 系统信息：`sys_*` 是设备自述（属数据），原样展示，中英文都不改写 */
	const systemRows = computed(() => [
		{ label: t("pages.telemetry.device.sysDescr"), value: textOrDash(props.device.sysDescr), mono: false, testid: "device-detail-descr" },
		{ label: t("pages.telemetry.device.sysLocation"), value: textOrDash(props.device.sysLocation), mono: false },
		{ label: t("pages.telemetry.device.sysContact"), value: textOrDash(props.device.sysContact), mono: false },
		{ label: t("pages.telemetry.device.sysObjectId"), value: textOrDash(props.device.sysObjectId) },
		{ label: t("pages.telemetry.device.sysServices"), value: countOrDash(props.device.sysServices) }
	]);

	const healthRows = computed(() => [
		{ label: t("pages.telemetry.device.cpu"), value: formatPercent(props.device.cpu), testid: "device-detail-cpu" },
		{ label: t("pages.telemetry.device.mem"), value: formatPercent(props.device.mem) },
		{ label: t("pages.telemetry.device.temperature"), value: formatCelsius(props.device.temperatureC) }
	]);

	/** `health` 整块缺失与「三项各自缺失」是两件事：前者说明来源没有，后者逐项 `—` 即可 */
	const healthNote = computed(() => (props.device.cpu === null && props.device.mem === null && props.device.temperatureC === null
		? t("pages.telemetry.device.healthAbsent")
		: t("pages.telemetry.device.healthGap")));

	/** 硬件事实：`hw` 键恒在、值可能全 `null`（实测胖 AP 即全 null） */
	const hardwareRows = computed(() => [
		{ label: t("pages.telemetry.device.hwEntities"), value: countOrDash(props.device.hwEntityCount) },
		{ label: t("pages.telemetry.device.hwVlan"), value: countOrDash(props.device.hwVlanCount) },
		{ label: t("pages.telemetry.device.hwRoute"), value: countOrDash(props.device.hwRouteCount) },
		{ label: t("pages.telemetry.device.hwFdb"), value: countOrDash(props.device.hwFdbCount) },
		{ label: t("pages.telemetry.device.hwMstp"), value: textOrDash(props.device.hwMstpStatus) }
	]);

	/** 硬件实体表列：`admin_status` / `oper_status` 是上游数值枚举，原样不映射 */
	const entityColumns = computed<TableColumn<MetricHwEntityView>[]>(() => [
		{ accessorKey: "index", header: t("pages.telemetry.device.columns.entityIndex") },
		{ accessorKey: "boardName", header: t("pages.telemetry.device.columns.board") },
		{ accessorKey: "modelName", header: t("pages.telemetry.device.columns.model") },
		{ accessorKey: "adminStatus", header: t("pages.telemetry.device.columns.adminStatus") },
		{ accessorKey: "operStatus", header: t("pages.telemetry.device.columns.operStatus") }
	]);

	const portRows = computed(() => [
		{ label: t("pages.telemetry.device.portsUp"), value: countOrDash(props.device.portsUp) },
		{ label: t("pages.telemetry.device.portsDown"), value: countOrDash(props.device.portsDown) },
		{ label: t("pages.telemetry.device.portsUnknown"), value: countOrDash(props.device.portsUnknown) },
		{ label: t("pages.telemetry.device.portsTotal"), value: countOrDash(props.device.portsTotal) },
		{ label: t("pages.telemetry.device.portsWired"), value: countOrDash(props.device.portsWired) },
		{ label: t("pages.telemetry.device.portsWireless"), value: countOrDash(props.device.portsWireless) }
	]);

	const neighborRows = computed(() => [
		{ label: t("pages.telemetry.device.neighborTotal"), value: countOrDash(props.device.neighborTotal) },
		{ label: t("pages.telemetry.device.neighborRouter"), value: countOrDash(props.device.neighborRouter) },
		{ label: t("pages.telemetry.device.neighborL3"), value: countOrDash(props.device.neighborL3Switch) },
		{ label: t("pages.telemetry.device.neighborL2"), value: countOrDash(props.device.neighborL2Switch) },
		{ label: t("pages.telemetry.device.neighborAp"), value: countOrDash(props.device.neighborAp) },
		{ label: t("pages.telemetry.device.neighborSta"), value: countOrDash(props.device.neighborSta) }
	]);

	/** 邻居名称清单原样拼一行（`neighbors[]` 是数据：不排序、不去重、不翻译） */
	const neighborListText = computed(() => (props.device.neighbors.length
		? props.device.neighbors.join(" · ")
		: t("pages.telemetry.device.neighborsEmpty")));

	const trafficRows = computed(() => [
		{ label: t("pages.telemetry.device.trafficIn"), value: formatBps(props.device.trafficInBps) },
		{ label: t("pages.telemetry.device.trafficOut"), value: formatBps(props.device.trafficOutBps) },
		{ label: t("pages.telemetry.device.trafficTotal"), value: formatBps(props.device.trafficTotalBps) },
		{ label: t("pages.telemetry.device.octetsIn"), value: formatCount(props.device.trafficInOctetsTotal) },
		{ label: t("pages.telemetry.device.octetsOut"), value: formatCount(props.device.trafficOutOctetsTotal) }
	]);
</script>
