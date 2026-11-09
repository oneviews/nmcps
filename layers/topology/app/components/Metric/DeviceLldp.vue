<template>
	<!--
		「LLDP」Tab（1.0 `Telemetry/Lldp.vue` 的 2.0 复刻）。

		数据来源是 `/metric/device` 的 `lldp` 块：`ports[]` 是本机端点（`port_num` / `port_id` /
		`port_desc`），`neighbors[]` 是邻居，其中 `local_port_num` **与本机 `ports[].port_num` 同域**，
		所以「本机哪个口接了对端哪个口」是能把两边对上账的（实测：`1272` → `n10-wlan1` ⇄
		`n28-wlan0`，`1305` → `n10-eth2` ⇄ `n4-eth5`）。

		2026-11-08 实测补上三列/一行之前被丢掉的字段：本机 `lldp.man_addr`（管理地址），以及邻居的
		`man_addr`（对端管理地址，可与设备台账 join）与 `sys_desc`（对端系统描述，实测是 Linux 发行版串）
		—— 三者都是上游给的真字段，原样展示。

		`lldp` 整块为 `null` 时，这是**该设备**没上报（同一批里有的设备回 null），不是端点缺失：
		如实说明并按缺口卡样式呈现，不画空表。
	-->
	<div class="space-y-3">
		<template v-if="device.lldpPresent">
			<div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
				<MetricFactCard :title="$t('pages.telemetry.lldp.local')" :rows="localRows" />
				<MetricFactCard :title="$t('pages.telemetry.lldp.counts')" :rows="countRows" />
			</div>

			<div v-if="device.lldpPorts.length" class="space-y-1">
				<h3 class="text-xs font-semibold text-(--ui-text-muted)">
					{{ $t("pages.telemetry.lldp.ports") }}
				</h3>
				<UTable
					data-testid="device-lldp-ports"
					:data="device.lldpPorts"
					:columns="portColumns"
					:ui="{ td: 'py-1.5 px-2', th: 'py-2 px-2' }"
					class="rounded-lg border border-(--ui-border)"
				/>
			</div>

			<div v-if="device.lldpNeighbors.length" class="space-y-1">
				<h3 class="text-xs font-semibold text-(--ui-text-muted)">
					{{ $t("pages.telemetry.lldp.neighbors") }}
				</h3>
				<UTable
					data-testid="device-lldp-neighbors"
					:data="neighborRows"
					:columns="neighborColumns"
					:ui="{ td: 'py-1.5 px-2', th: 'py-2 px-2' }"
					class="rounded-lg border border-(--ui-border)"
				>
					<!-- `man_addr` / `sys_desc` 实测多数有、少数是 `null`：空单元格会被读成「空字符串」，
						按 §九 的 `null` 口径统一写 `—` -->
					<template #manAddr-cell="{ row }">
						{{ textOrDash(row.original.manAddr) }}
					</template>
					<template #sysDesc-cell="{ row }">
						{{ textOrDash(row.original.sysDesc) }}
					</template>
				</UTable>
			</div>

			<p v-else data-testid="device-lldp-no-neighbor" class="text-xs text-(--ui-text-muted)">
				{{ $t("pages.telemetry.lldp.neighborsEmpty") }}
			</p>
		</template>

		<MetricTelemetryGap
			v-else
			tab="lldp"
			:body="$t('pages.telemetry.lldp.absentBody')"
			:fields="$t('pages.telemetry.lldp.absentFields')"
		/>
	</div>
</template>

<script setup lang="ts">
	import type { TableColumn } from "@nuxt/ui";
	import type { MetricDeviceRow, MetricLldpNeighborView, MetricLldpPortView } from "~~/app/utils/metric/metricLedger";
	import { formatCount, textOrDash } from "~~/app/utils/metric/metricFormat";

	const props = defineProps<{
		/** 左栏台账的同一行（详情只读） */
		device: MetricDeviceRow
	}>();

	const { t } = useI18n();

	const localRows = computed(() => [
		{ label: t("pages.telemetry.lldp.chassisId"), value: textOrDash(props.device.lldpChassisId), testid: "device-lldp-chassis" },
		{ label: t("pages.telemetry.lldp.manAddr"), value: textOrDash(props.device.lldpManAddr), testid: "device-lldp-man-addr" },
		{ label: t("pages.telemetry.lldp.sysDesc"), value: textOrDash(props.device.lldpSysDesc), mono: false }
	]);

	const countRows = computed(() => [
		{ label: t("pages.telemetry.lldp.portCount"), value: formatCount(props.device.lldpPorts.length) },
		{ label: t("pages.telemetry.lldp.neighborCount"), value: formatCount(props.device.lldpNeighbors.length) }
	]);

	/** 邻居行：`localPortNum` 反查本机 `port_id`，查不到就把编号原样留下（不猜） */
	interface NeighborTableRow extends MetricLldpNeighborView {
		localPortName: string
	}

	const neighborRows = computed<NeighborTableRow[]>(() => props.device.lldpNeighbors.map((neighbor) => {
		const local = props.device.lldpPorts.find((port) => port.portNum === neighbor.localPortNum);
		return { ...neighbor, localPortName: local?.portId || neighbor.localPortNum };
	}));

	const portColumns = computed<TableColumn<MetricLldpPortView>[]>(() => [
		{ accessorKey: "portNum", header: t("pages.telemetry.lldp.columns.portNum") },
		{ accessorKey: "portId", header: t("pages.telemetry.lldp.columns.portId") },
		{ accessorKey: "portDesc", header: t("pages.telemetry.lldp.columns.portDesc") }
	]);

	const neighborColumns = computed<TableColumn<NeighborTableRow>[]>(() => [
		{ accessorKey: "sysName", header: t("pages.telemetry.lldp.columns.sysName") },
		{ accessorKey: "localPortName", header: t("pages.telemetry.lldp.columns.localPort") },
		{ accessorKey: "portId", header: t("pages.telemetry.lldp.columns.remotePort") },
		{ accessorKey: "manAddr", header: t("pages.telemetry.lldp.columns.manAddr") },
		{ accessorKey: "chassisId", header: t("pages.telemetry.lldp.columns.chassisId") },
		{ accessorKey: "sysDesc", header: t("pages.telemetry.lldp.columns.sysDesc") }
	]);
</script>
