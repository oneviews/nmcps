<template>
	<!--
		指标趋势面板（`NMCPS-CONTRACT-002` §6 / §7 / §8）：选择器 + 速率开关 + 折线。
		`device-metrics` 与 `link-metrics` 共用这一份 —— 两页的差别只在「哪台设备的 IP」，
		面板内部一律交给 `useMetricSeries()`，不在页面里重复取数逻辑。

		空态分三类，都来自 `reason`（不是错误）：
			`no_metric_names`    这台设备没有任何指标名（§七：合法空）；
			`no_paintable_metric` 有名字但全是文本 / 采集器命名空间（§8.3：不硬画一条直线）；
			`no_datapoints`      取到了名字，窗口内没有合法采样点（§6.3：非法点丢弃不计 0）。
-->
	<div class="space-y-3">
		<div class="flex flex-wrap items-center gap-2">
			<USelect
				v-model="selectedCode"
				data-testid="metric-picker"
				:items="pickerItems"
				size="sm"
				class="w-56 min-w-0"
				:aria-label="$t('pages.topology-metrics.pickerLabel')"
				:placeholder="$t('pages.topology-metrics.pickerPlaceholder')"
				:disabled="!hasIp || pickerItems.length === 0"
			/>
			<!-- 速率开关只在 `counter` 上出现（§6.5）：类型未定就不摆一个点了没反应的开关 -->
			<USwitch
				v-if="rateAvailable"
				v-model="rate"
				data-testid="metric-rate"
				size="sm"
				:label="$t('pages.topology-metrics.rate')"
			/>
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
			<span v-if="selectedCode" class="truncate font-mono text-xs text-(--ui-text-muted)">
				{{ selectedCode }}
			</span>
		</div>

		<!-- 目录不可用不是取数失败（§8.4）：只说明「可能把文本指标画成数值」，图表照常出 -->
		<UAlert
			v-if="degraded"
			data-testid="metric-catalog-degraded"
			color="warning"
			variant="subtle"
			icon="carbon:warning-alt"
			:title="$t('pages.topology-metrics.degradedTitle')"
			:description="$t('pages.topology-metrics.degradedBody')"
		/>

		<!-- 没有管理 IP：链路 / 设备都可能走到这里，缺的是请求入参，不是数据（不发空 `mgmt_ip` 请求） -->
		<p v-if="!hasIp" data-testid="metric-no-ip" class="py-6 text-center text-xs text-(--ui-text-muted)">
			{{ missingIpText }}
		</p>

		<template v-else>
			<USkeleton v-if="loading" class="h-24 w-full rounded-md" />
			<GraphTrendChart
				v-else
				:points="points"
				:label="$t('pages.topology-metrics.chartLabel', { name, metric: selectedCode || '—' })"
				:empty-text="emptyText"
			/>

			<!-- 失败语义（§6.7）：上游原话逐字给出 + 重试，不静默降级成「无数据」 -->
			<div v-if="error" data-testid="metric-trend-error">
				<UAlert
					color="error"
					variant="subtle"
					icon="carbon:warning-alt"
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
			</div>
			<p v-else-if="dropped > 0" class="text-xs text-(--ui-text-muted)">
				{{ $t("pages.topology-metrics.dropped", { count: dropped }) }}
			</p>
			<p v-if="stale" class="text-xs text-(--ui-warning)">
				{{ $t("pages.topology-metrics.stale") }}
			</p>
		</template>
	</div>
</template>

<script setup lang="ts">
	import { metricOptionLabel } from "~~/app/utils/metric/metricCatalog";
	import { useMetricSeries } from "~~/layers/topology/app/composables/useMetricSeries";

	const props = defineProps<{
		/** 该设备的管理 IP；空串 = 没有 IP（面板说明原因并停在这里，不发明请求） */
		ip: string
		/** 图表无障碍标签里的对象名（设备名 / 链路标识，数据原样） */
		name: string
		/** 没有 IP 时的一句话（由页面按自己的语义传入：设备缺 IP / 链路 source 端缺 IP） */
		missingIpText: string
	}>();

	const { t } = useI18n();

	const ip = computed(() => props.ip);
	const hasIp = computed(() => props.ip.trim().length > 0);

	/** 编码与速率开关由面板持有：`useMetricSeries` 的 `code` ref 与选择器同一个 */
	const selectedCode = ref("");
	const rate = ref(false);

	const { options, points, dropped, rateAvailable, degraded, reason, error, loading, stale, reload }
		= useMetricSeries(ip, { code: selectedCode, rate });

	const pickerItems = computed(() => options.value.map((item) => ({
		label: metricOptionLabel(item),
		value: item.code
	})));

	const emptyText = computed(() => {
		if (reason.value === "no_metric_names")
			return t("pages.topology-metrics.emptyNoNames");

		if (reason.value === "no_paintable_metric")
			return t("pages.topology-metrics.emptyNoPlottable");

		return t("pages.topology-metrics.emptyNoData");
	});
</script>
