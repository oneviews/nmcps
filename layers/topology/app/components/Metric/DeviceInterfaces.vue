<template>
	<!--
		「接口列表」Tab（1.0 `Telemetry/Interfaces.vue` 的 2.0 复刻，两段式）。

		① 端口清单：`/metric/device` 的 `lldp.ports[]` 就是这台设备上报的端口（`port_num` / `port_id` /
		`port_desc`）—— 上游**有**端口清单，只是只有标识、没有逐端口的计数与状态；
		② 逐端口取值：`/metric/datapoint` 的 `results` 每条序列带 `ifIndex` 标签（`NMCPS-CONTRACT-002`
		§6.9），同一指标按 `ifIndex` 分组就是一张端口值表。入向 / 出向由用户指定（候选来自该设备的
		`/metric/name` + 目录 join），不按名字猜。

		1.0 端口表里的状态 / 容量 / 错误计数 / 单播包数仍然没有来源，统一降到表下的缺口卡。
	-->
	<div class="space-y-3">
		<!-- ① 上游给的端口清单（`lldp.ports`）：有就列，没有就不占位 -->
		<div v-if="lldpPorts.length" class="space-y-1" data-testid="interface-lldp-ports">
			<h3 class="text-xs font-semibold text-(--ui-text-muted)">
				{{ $t("pages.telemetry.interfaces.lldpPorts", { count: lldpPorts.length }) }}
			</h3>
			<UTable
				:data="lldpPorts"
				:columns="lldpColumns"
				:ui="{ td: 'py-1.5 px-2', th: 'py-2 px-2' }"
				class="rounded-lg border border-(--ui-border)"
			/>
			<p class="text-xs text-(--ui-text-muted)">
				{{ $t("pages.telemetry.interfaces.lldpPortsNote") }}
			</p>
		</div>

		<div class="flex flex-wrap items-end gap-2">
			<UFormField :label="$t('pages.telemetry.interfaces.inbound')" size="sm">
				<USelect
					v-model="inboundCode"
					data-testid="interface-inbound-picker"
					:items="pickerItems"
					size="sm"
					class="w-52"
					:placeholder="$t('pages.topology-metrics.pickerPlaceholder')"
					:disabled="!hasIp || pickerItems.length === 0"
				/>
			</UFormField>
			<UFormField :label="$t('pages.telemetry.interfaces.outbound')" size="sm">
				<USelect
					v-model="outboundCode"
					data-testid="interface-outbound-picker"
					:items="pickerItems"
					size="sm"
					class="w-52"
					:placeholder="$t('pages.topology-metrics.pickerPlaceholder')"
					:disabled="!hasIp || pickerItems.length === 0"
				/>
			</UFormField>
			<UTooltip :text="$t('pages.topology-metrics.refresh')">
				<UButton
					size="sm"
					color="neutral"
					variant="ghost"
					icon="carbon:renew"
					:loading="loading"
					:disabled="!hasIp"
					:aria-label="$t('pages.topology-metrics.refresh')"
					@click="reload()"
				/>
			</UTooltip>
			<UBadge v-if="rows.length" variant="outline" color="neutral" size="sm" data-testid="interface-row-count">
				{{ $t("pages.telemetry.interfaces.rowCount", { count: rows.length }) }}
			</UBadge>
		</div>

		<!-- 目录不可用不是取数失败（§8.4）：只说明单位可能缺、文本指标可能被判成数值 -->
		<UAlert
			v-if="degraded"
			color="warning"
			variant="subtle"
			icon="carbon:warning-alt"
			:title="$t('pages.topology-metrics.degradedTitle')"
			:description="$t('pages.topology-metrics.degradedBody')"
		/>

		<p v-if="!hasIp" data-testid="interface-no-ip" class="py-6 text-center text-xs text-(--ui-text-muted)">
			{{ missingIpText }}
		</p>

		<template v-else>
			<p v-if="!inboundCode && !outboundCode" data-testid="interface-hint" class="py-6 text-center text-xs text-(--ui-text-muted)">
				{{ $t("pages.telemetry.interfaces.hint") }}
			</p>

			<USkeleton v-else-if="loading && rows.length === 0" class="h-32 w-full rounded-md" />

			<UTable
				v-else-if="rows.length"
				data-testid="interface-table"
				:data="tableRows"
				:columns="columns"
				:ui="{ td: 'py-1.5 px-2', th: 'py-2 px-2' }"
				class="rounded-lg border border-(--ui-border)"
			/>

			<p v-else-if="!error" data-testid="interface-empty" class="py-6 text-center text-xs text-(--ui-text-muted)">
				{{ $t("pages.telemetry.interfaces.empty") }}
			</p>

			<!-- 失败语义（§6.7）：上游原话逐字给出 + 重试，不静默降级成「没有端口」 -->
			<UAlert
				v-if="error"
				color="error"
				variant="subtle"
				icon="carbon:warning-alt"
				data-testid="interface-error"
				:title="$t('pages.topology-metrics.errorTitle')"
				:description="error.message"
			>
				<template #actions>
					<UButton
						size="sm"
						color="neutral"
						variant="subtle"
						:label="$t('pages.topology-metrics.retry')"
						@click="reload()"
					/>
				</template>
			</UAlert>

			<p v-if="stale" class="text-xs text-(--ui-warning)">
				{{ $t("pages.topology-metrics.stale") }}
			</p>
			<p v-if="dropped > 0" class="text-xs text-(--ui-text-muted)">
				{{ $t("pages.topology-metrics.dropped", { count: dropped }) }}
			</p>

			<MetricTelemetryGap
				tab="interfaces"
				:body="$t('pages.telemetry.gap.interfaces')"
				:fields="$t('pages.telemetry.gap.interfacesFields')"
			/>
		</template>
	</div>
</template>

<script setup lang="ts">
	import type { TableColumn } from "@nuxt/ui";
	import type { MetricLldpPortView } from "~~/app/utils/metric/metricLedger";
	import { metricOptionLabel } from "~~/app/utils/metric/metricCatalog";
	import { formatCount, formatSampleTime, formatValueWithUnit } from "~~/app/utils/metric/metricFormat";
	import { useMetricInterfaces } from "~~/layers/topology/app/composables/useMetricInterfaces";

	const props = withDefaults(defineProps<{
		/** 该设备的管理 IP；空串 = 没有 IP（说明原因并停在这里，不发明请求） */
		ip: string
		/** 没有 IP 时的一句话（由页面提供，链路 / 设备语义不同） */
		missingIpText: string
		/** 上游给的端口清单（`/metric/device` 的 `lldp.ports`）；没有就是空数组 */
		lldpPorts?: MetricLldpPortView[]
	}>(), { lldpPorts: () => [] });

	const { t } = useI18n();

	const lldpColumns = computed<TableColumn<MetricLldpPortView>[]>(() => [
		{ accessorKey: "portNum", header: t("pages.telemetry.lldp.columns.portNum") },
		{ accessorKey: "portId", header: t("pages.telemetry.lldp.columns.portId") },
		{ accessorKey: "portDesc", header: t("pages.telemetry.lldp.columns.portDesc") }
	]);

	const ip = computed(() => props.ip);
	const hasIp = computed(() => props.ip.trim().length > 0);

	/** 入向 / 出向的指标编码由用户指定：命名约定不是契约事实，不替用户挑 */
	const inboundCode = ref("");
	const outboundCode = ref("");

	const { options, degraded, rows, loading, error, stale, dropped, reload }
		= useMetricInterfaces(ip, inboundCode, outboundCode);

	const pickerItems = computed(() => options.value.map((item) => ({
		label: metricOptionLabel(item),
		value: item.code
	})));

	/** `code → unit`：单位来自目录（属数据）；目录降级时可能为空 ⇒ 只显示数字，不猜单位 */
	const unitByCode = computed(() => new Map(options.value.map((item) => [item.code, item.unit])));
	const unitOf = (code: string): string => unitByCode.value.get(code.trim()) ?? "";

	interface InterfaceTableRow {
		port: string
		inbound: string
		outbound: string
		sampledAt: string
		series: string
	}

	/** 两个方向取较新的那个采样时刻（同 `ifIndex` 的两列本就来自同一时间窗） */
	function latestSample(at: Array<number | null | undefined>): number | null {
		const known = at.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
		return known.length ? Math.max(...known) : null;
	}

	const tableRows = computed<InterfaceTableRow[]>(() => rows.value.map((row) => ({
		port: row.ifIndex === "" ? t("pages.telemetry.interfaces.deviceLevel") : row.ifIndex,
		inbound: formatValueWithUnit(row.inbound?.value, unitOf(inboundCode.value)),
		outbound: formatValueWithUnit(row.outbound?.value, unitOf(outboundCode.value)),
		sampledAt: formatSampleTime(latestSample([row.inbound?.t, row.outbound?.t])),
		series: formatCount((row.inbound?.seriesCount ?? 0) + (row.outbound?.seriesCount ?? 0))
	})));

	const columns = computed<TableColumn<InterfaceTableRow>[]>(() => [
		{ accessorKey: "port", header: t("pages.telemetry.interfaces.columns.port") },
		{ accessorKey: "inbound", header: t("pages.telemetry.interfaces.columns.inbound") },
		{ accessorKey: "outbound", header: t("pages.telemetry.interfaces.columns.outbound") },
		{ accessorKey: "sampledAt", header: t("pages.telemetry.interfaces.columns.sampledAt") },
		{ accessorKey: "series", header: t("pages.telemetry.interfaces.columns.series") }
	]);
</script>
