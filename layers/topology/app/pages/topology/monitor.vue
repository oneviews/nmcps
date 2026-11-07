<template>
	<div class="flex min-h-0 flex-1 flex-col gap-3 p-3">
		<!-- 工具栏（NMCPS-ARCH-006 §4）：左区集合域动作，右区仿真控制（写入口未开放时整体 disabled） -->
		<Teleport to="#app-toolbar-left">
			<UTooltip :text="$t('pages.topology-monitor.refresh')">
				<UButton
					data-testid="topology-refresh"
					size="sm"
					color="neutral"
					variant="ghost"
					icon="carbon:renew"
					:loading="refreshing"
					:aria-label="$t('pages.topology-monitor.refresh')"
					@click="refresh()"
				/>
			</UTooltip>

			<!-- 2D 布局切换（§6.8）：词表只有三种，都是 2.0 自己算得出来的几何 -->
			<UDropdownMenu :items="layoutItems" :content="{ align: 'start' }">
				<UButton
					data-testid="topology-layout-switcher"
					:data-layout="layoutMode"
					size="sm"
					color="neutral"
					variant="ghost"
					icon="carbon:flow"
					trailing-icon="carbon:chevron-down"
					:label="$t(`pages.topology-monitor.layouts.${layoutMode}`)"
				/>
			</UDropdownMenu>
		</Teleport>

		<Teleport to="#app-toolbar-right">
			<!-- 仿真写入口（NMCPS-DESIGN-001 §6.2）：两个节点动作，权限来自 `/api/sim/channel` 的 `writeEnabled` -->
			<UTooltip :text="simControlHint">
				<span class="inline-flex">
					<UButton
						data-testid="sim-action"
						data-action="stop"
						size="sm"
						color="neutral"
						variant="outline"
						icon="carbon:stop-outline"
						:label="$t('pages.topology-monitor.simControls.nodeStop')"
						:disabled="!canOperate"
						:loading="acting === 'stop'"
						@click="askAction('stop')"
					/>
				</span>
			</UTooltip>
			<UTooltip :text="simControlHint">
				<span class="inline-flex">
					<UButton
						data-testid="sim-action"
						data-action="restart"
						size="sm"
						color="neutral"
						variant="outline"
						icon="carbon:restart"
						:label="$t('pages.topology-monitor.simControls.nodeRestart')"
						:disabled="!canOperate"
						:loading="acting === 'restart'"
						@click="askAction('restart')"
					/>
				</span>
			</UTooltip>
		</Teleport>

		<!-- 页头计数：全部来自已取到的数据，无数据时显示「—」而不是 0 -->
		<div class="flex flex-wrap gap-2">
			<GraphSparkStat
				:label="$t('pages.topology-monitor.stats.nodes')"
				:value="graph ? nodeCount : null"
				icon="carbon:network-4"
			/>
			<GraphSparkStat
				:label="$t('pages.topology-monitor.stats.links')"
				:value="graph ? linkCount : null"
				icon="carbon:connect"
			/>
			<GraphSparkStat
				:label="$t('pages.topology-monitor.stats.combos')"
				:value="graph ? comboCount : null"
				icon="carbon:group-objects"
			/>
			<GraphSparkStat
				:label="$t('pages.topology-monitor.stats.simulated')"
				:value="simState === 'ok' ? simulatedCount : null"
				:color="running ? 'success' : 'neutral'"
				icon="carbon:simulation"
			/>
		</div>

		<!-- 仿真通道降级：讲清「缺哪一路、影响哪些区块、能否重试」（§八 硬性要求） -->
		<UAlert
			v-if="simState === 'disabled'"
			data-testid="sim-degraded"
			color="neutral"
			variant="subtle"
			icon="carbon:plug"
			:title="$t('pages.topology-monitor.degraded.disabledTitle')"
			:description="$t('pages.topology-monitor.degraded.disabledBody')"
		/>
		<UAlert
			v-else-if="simState === 'unreachable'"
			data-testid="sim-degraded"
			color="warning"
			variant="subtle"
			icon="carbon:warning-alt"
			:title="$t('pages.topology-monitor.degraded.unreachableTitle')"
			:description="$t('pages.topology-monitor.degraded.unreachableBody', { reason: simReason })"
		/>

		<!-- 主上游失败：页面级错误 + 重试，不白屏（A5） -->
		<div v-if="graphError" data-testid="topology-error" class="p-3">
			<UAlert
				color="error"
				variant="subtle"
				icon="carbon:warning-alt"
				:title="$t('pages.topology-monitor.error.title')"
				:description="graphError.message"
			>
				<template #actions>
					<UButton
						size="sm"
						color="neutral"
						variant="subtle"
						:label="$t('pages.topology-monitor.error.retry')"
						@click="refresh()"
					/>
				</template>
			</UAlert>
		</div>

		<!-- 首屏骨架：只在第一次取数时出现，轮询不闪 -->
		<div v-else-if="loading" class="flex min-h-0 flex-1 items-center justify-center">
			<USkeleton class="h-full w-full rounded-lg" />
		</div>

		<!-- 空拓扑：空态而不是空白画布（A4） -->
		<div
			v-else-if="nodeCount === 0"
			data-testid="topology-empty"
			class="flex min-h-0 flex-1 items-center justify-center"
		>
			<div class="flex max-w-sm flex-col items-center gap-3 text-center">
				<UIcon name="carbon:network-4" class="size-12 text-(--ui-text-muted)" />
				<h2 class="text-lg font-semibold">
					{{ $t("pages.topology-monitor.empty.title") }}
				</h2>
				<p class="text-sm text-(--ui-text-muted)">
					{{ $t("pages.topology-monitor.empty.body") }}
				</p>
				<UButton
					size="sm"
					color="neutral"
					variant="subtle"
					icon="carbon:renew"
					:label="$t('pages.topology-monitor.error.retry')"
					@click="refresh()"
				/>
			</div>
		</div>
		<div v-else class="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
			<!-- 画布：布局由纯函数注入，交互收敛在 `useGraphInteraction()` -->
			<div class="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-(--ui-border) bg-(--ui-bg)">
				<GraphTopologyCanvas
					ref="canvasRef"
					:nodes="layout.nodes"
					:links="layout.links"
					:width="layout.width"
					:height="layout.height"
					:selected-id="selectedId"
					:markers="markers"
					:offsets="nodeOffsets"
					:label="$t('pages.topology-monitor.canvasLabel')"
					@select="selectNode"
					@offset-change="moveNode"
					@viewport-change="(dirty: boolean) => (viewportDirty = dirty)"
				/>

				<!-- 裁剪角标（§八）：超出 400 节点 / 1,200 链路时说明裁了多少 -->
				<UBadge
					v-if="layout.croppedNodes > 0 || layout.croppedLinks > 0"
					data-testid="topology-cropped"
					size="sm"
					color="warning"
					variant="subtle"
					class="absolute top-2 left-2"
				>
					{{ $t("pages.topology-monitor.cropped", { nodes: layout.croppedNodes, links: layout.croppedLinks }) }}
				</UBadge>

				<!-- 径向扇旋转控件（§6.8，1.0 v0.28 同款）：只在 `radial` 布局出现 ——
					其它布局不读这个角度，摆一个置灰的滑块等于暗示「拖了会有区别」 -->
				<div
					v-if="canRotate"
					data-testid="topology-rotate"
					class="absolute top-2 right-2 flex items-center gap-1 rounded-md border border-(--ui-border) bg-(--ui-bg)/90 px-1.5 py-1"
				>
					<USlider
						:model-value="rotationDeg"
						:min="TOPOLOGY_ROTATE_MIN"
						:max="TOPOLOGY_ROTATE_MAX"
						:step="1"
						size="sm"
						class="w-24"
						:aria-label="$t('pages.topology-monitor.rotate.label')"
						@update:model-value="onRotate"
					/>
					<UBadge size="sm" variant="outline" color="neutral" class="min-w-10 justify-center tabular-nums">
						{{ rotationDeg }}°
					</UBadge>
					<UFieldGroup size="sm">
						<UButton
							data-testid="topology-rotate-ccw"
							size="xs"
							color="neutral"
							variant="subtle"
							icon="carbon:rotate-ccw"
							:aria-label="$t('pages.topology-monitor.rotate.ccw')"
							@click="nudgeRotation(TOPOLOGY_ROTATE_STEP)"
						/>
						<UButton
							data-testid="topology-rotate-cw"
							size="xs"
							color="neutral"
							variant="subtle"
							icon="carbon:rotate-cw"
							:aria-label="$t('pages.topology-monitor.rotate.cw')"
							@click="nudgeRotation(-TOPOLOGY_ROTATE_STEP)"
						/>
					</UFieldGroup>
					<UTooltip :text="$t('pages.topology-monitor.rotate.reset')">
						<UButton
							data-testid="topology-rotate-reset"
							size="xs"
							color="neutral"
							variant="ghost"
							icon="carbon:reset"
							:disabled="rotationDeg === RADIAL_ROTATE_DEG"
							:aria-label="$t('pages.topology-monitor.rotate.reset')"
							@click="resetRotation()"
						/>
					</UTooltip>
				</div>

				<!-- 恢复默认配置（§6.9，1.0 v0.36 同款三合一）：清位移 → 旋转角回默认 → 视口复位。
					放在画布左下角而不是顶栏：它只作用于这张画布，顶栏左区留给「刷新 + 布局」两个集合域动作。 -->
				<div class="absolute bottom-2 left-2">
					<UTooltip
						:text="canResetView
							? $t('pages.topology-monitor.resetView.label')
							: $t('pages.topology-monitor.resetView.hint')"
					>
						<UButton
							data-testid="topology-reset-view"
							:data-offsets="nodeOffsetCount"
							size="xs"
							color="neutral"
							variant="subtle"
							icon="carbon:reset"
							:label="$t('pages.topology-monitor.resetView.label')"
							:disabled="!canResetView"
							@click="resetViewConfig()"
						/>
					</UTooltip>
				</div>
			</div>

			<!-- 详情栏：选中节点 → 现网口径 + 仿真标记；未选中给图例 -->
			<aside class="flex w-full shrink-0 flex-col gap-3 lg:w-72">
				<div class="rounded-lg border border-(--ui-border) p-3">
					<h2 class="mb-2 text-sm font-semibold">
						{{ $t("pages.topology-monitor.detail.title") }}
					</h2>

					<template v-if="selected">
						<div class="flex items-center justify-between gap-2">
							<span class="truncate font-medium">{{ selected.label }}</span>
							<UBadge size="sm" variant="subtle" :color="nodeStatusColor(selected.status)">
								{{ $t(statusI18nKey(selected.status)) }}
							</UBadge>
						</div>
						<dl class="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.topology-monitor.detail.ip") }}
							</dt>
							<dd class="truncate">
								{{ selected.ip || "—" }}
							</dd>
							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.topology-monitor.detail.tier") }}
							</dt>
							<dd>{{ selected.tier }}</dd>
							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.topology-monitor.detail.category") }}
							</dt>
							<dd class="truncate">
								{{ selected.category || "—" }}
							</dd>
						</dl>

						<!-- 节点事实（NMCPS-DESIGN-001 §6.5）：CPU / 内存进度条 + 接口·邻居·流量 KPI。
						未知（上游没给 / 1.0 的 `-1` 哨兵）一律写「—」且不画空进度条 —— 空条读成 0%。 -->
						<div class="mt-3 flex flex-col gap-2 border-t border-(--ui-border) pt-2 text-xs">
							<div v-for="meter in percentMeters" :key="meter.key">
								<div class="mb-1 flex items-baseline justify-between gap-2">
									<span class="text-(--ui-text-muted)">{{ $t(meter.label) }}</span>
									<span
										:data-testid="`topology-fact-${meter.key}`"
										class="font-medium tabular-nums"
										:class="meter.value === null ? 'text-(--ui-text-muted)' : 'text-(--ui-text)'"
									>{{ formatPercent(meter.value) }}</span>
								</div>
								<UProgress
									v-if="meter.value !== null"
									data-testid="topology-meter"
									:model-value="meter.value"
									:color="percentColor(meter.value)"
									size="xs"
								/>
							</div>

							<dl class="grid grid-cols-3 gap-1.5 pt-1 text-center">
								<div v-for="card in factCards" :key="card.key" class="rounded-md bg-(--ui-bg-elevated) py-1">
									<dt class="text-[11px] text-(--ui-text-muted)">
										{{ card.label }}
									</dt>
									<dd :data-testid="`topology-fact-${card.key}`" class="text-sm font-semibold tabular-nums">
										{{ card.text }}<span v-if="card.unit" class="ml-0.5 text-[10px] font-normal text-(--ui-text-muted)">{{ card.unit }}</span>
									</dd>
								</div>
							</dl>
						</div>

						<!-- 邻居列表（1.0 的「邻居情况」）：只列**当前画布**上真实存在的链路，点一条跳过去 -->
						<div class="mt-3 border-t border-(--ui-border) pt-2 text-xs">
							<h3 class="mb-1 flex items-baseline justify-between gap-2 font-medium">
								<span>{{ $t("pages.topology-monitor.detail.neighborsTitle") }}</span>
								<span class="text-(--ui-text-muted)">{{ selectedNeighbors.length }}</span>
							</h3>
							<ul v-if="selectedNeighbors.length" class="flex flex-col gap-0.5">
								<li v-for="(neighbor, index) in selectedNeighbors" :key="`${neighbor.id}-${index}`">
									<UButton
										data-testid="topology-neighbor"
										:data-node-id="neighbor.id"
										size="xs"
										color="neutral"
										variant="ghost"
										block
										class="justify-start gap-1.5"
										@click="selectNode(neighbor.id)"
									>
										<span class="size-2 shrink-0 rounded-full" :class="nodeFillClass(neighbor.status)" />
										<span class="truncate">{{ neighbor.label }}</span>
										<UBadge size="sm" variant="subtle" :color="linkStatusColor(neighbor.linkStatus)" class="ml-auto">
											{{ $t(statusI18nKey(neighbor.linkStatus)) }}
										</UBadge>
									</UButton>
								</li>
							</ul>
							<p v-else class="text-(--ui-text-muted)">
								{{ $t("pages.topology-monitor.detail.neighborsEmpty") }}
							</p>
						</div>

						<div class="mt-3 border-t border-(--ui-border) pt-2 text-xs">
							<template v-if="selected.marker">
								<div class="flex items-center gap-1 font-medium">
									<UIcon name="carbon:simulation" class="size-3.5 text-(--ui-info)" />
									{{ $t("pages.topology-monitor.detail.simulated") }}
								</div>
								<dl class="mt-1 grid grid-cols-2 gap-x-2 gap-y-1">
									<dt class="text-(--ui-text-muted)">
										{{ $t("pages.topology-monitor.detail.simName") }}
									</dt>
									<dd class="truncate">
										{{ selected.marker.name }}
									</dd>
									<dt class="text-(--ui-text-muted)">
										{{ $t("pages.topology-monitor.detail.simStatus") }}
									</dt>
									<dd>{{ selected.marker.status }}</dd>
								</dl>
							</template>
							<p v-else class="text-(--ui-text-muted)">
								{{ simState === "ok" ? $t("pages.topology-monitor.detail.notSimulated") : $t("pages.topology-monitor.detail.simUnavailable") }}
							</p>
						</div>
					</template>

					<p v-else class="text-xs text-(--ui-text-muted)">
						{{ $t("pages.topology-monitor.detail.empty") }}
					</p>
				</div>

				<!-- 节点趋势（NMCPS-DESIGN-001 §6.5 / A3）：选中节点 → `/api/metric/name` 挑编码 →
					`/api/metric/datapoint` 取近 1 小时序列 → `TrendChart` 自绘折线 -->
				<div class="rounded-lg border border-(--ui-border) p-3">
					<div class="mb-2 flex items-baseline justify-between gap-2">
						<h2 class="text-sm font-semibold">
							{{ $t("pages.topology-monitor.trend.title") }}
						</h2>
						<span v-if="selected && trendMetricCode" class="truncate font-mono text-xs text-(--ui-text-muted)">
							{{ trendMetricCode }}
						</span>
					</div>

					<template v-if="selected">
						<USkeleton v-if="trendLoading" class="h-24 w-full rounded-md" />
						<!--
							纯失败态（手上没有可保留的旧序列）不画图：否则图里写着「该时间窗内无采集数据」、
							下面的告警写着「指标取数失败」，两句互相矛盾（NMCPS-CONTRACT-002 §6.7 / A15）。
							上游抖动但还有上次成功的数据时（`stale`）照旧画，另有一行 stale 提示。
						-->
						<GraphTrendChart
							v-else-if="!trendError || trendPoints.length > 0"
							:points="trendPoints"
							:label="$t('pages.topology-monitor.trend.chartLabel', { name: selected.label, metric: trendMetricCode || '—' })"
							:empty-text="trendEmptyText"
						/>
						<!-- 失败语义（CONTRACT-002 §6.7）：上游原话逐字给出 + 重试，不静默降级成「无数据」 -->
						<div v-if="trendError" data-testid="trend-error" class="mt-2">
							<UAlert
								color="error"
								variant="subtle"
								icon="carbon:warning-alt"
								:title="$t('pages.topology-monitor.trend.errorTitle')"
								:description="trendError.message"
							>
								<template #actions>
									<UButton
										size="sm"
										color="neutral"
										variant="subtle"
										:label="$t('pages.topology-monitor.error.retry')"
										@click="reloadTrend()"
									/>
								</template>
							</UAlert>
						</div>
						<p v-else-if="trendDropped > 0" class="mt-2 text-xs text-(--ui-text-muted)">
							{{ $t("pages.topology-monitor.trend.dropped", { count: trendDropped }) }}
						</p>
						<p v-if="trendStale" class="mt-2 text-xs text-(--ui-warning)">
							{{ $t("pages.topology-monitor.trend.stale") }}
						</p>
					</template>

					<p v-else class="text-xs text-(--ui-text-muted)">
						{{ $t("pages.topology-monitor.trend.selectNode") }}
					</p>
				</div>

				<!-- 图例：与画布同一套语义色（`topologyStatusStyle.ts`） -->
				<div class="rounded-lg border border-(--ui-border) p-3">
					<h2 class="mb-2 text-sm font-semibold">
						{{ $t("pages.topology-monitor.legend.title") }}
					</h2>
					<ul class="flex flex-col gap-1 text-xs">
						<li v-for="status in legendStatuses" :key="status" class="flex items-center gap-2">
							<span class="size-2.5 rounded-full" :class="nodeFillClass(status)" />
							{{ $t(statusI18nKey(status)) }}
						</li>
					</ul>
					<p class="mt-2 text-xs text-(--ui-text-muted)">
						{{ $t("pages.topology-monitor.legend.simulatedHint") }}
					</p>
				</div>
			</aside>
		</div>

		<!-- 二次确认（NMCPS-DESIGN-001 §6.2 / A9）：动作直接作用在正在跑的仿真上，不可撤销 -->
		<UModal
			v-model:open="confirmOpen"
			:title="$t('pages.topology-monitor.simControls.confirmTitle')"
			:description="confirmDescription"
			:dismissible="!acting"
			:ui="{ footer: 'justify-end' }"
		>
			<template #body>
				<div class="space-y-3">
					<UAlert
						color="warning"
						variant="subtle"
						icon="carbon:warning-alt"
						:title="$t('pages.topology-monitor.simControls.irreversibleTitle')"
						:description="$t('pages.topology-monitor.simControls.irreversibleBody')"
					/>
					<UAlert
						v-if="actionError"
						data-testid="sim-action-error"
						color="error"
						variant="subtle"
						icon="carbon:warning-alt"
						:title="$t('pages.topology-monitor.simControls.actionFailed')"
						:description="actionError"
					/>
				</div>
			</template>

			<template #footer>
				<UButton
					color="neutral"
					variant="ghost"
					:label="$t('pages.topology-monitor.simControls.cancel')"
					:disabled="!!acting"
					@click="confirmOpen = false"
				/>
				<UButton
					data-testid="sim-confirm"
					color="error"
					:label="$t('pages.topology-monitor.simControls.confirmSubmit')"
					:loading="!!acting"
					@click="submitAction()"
				/>
			</template>
		</UModal>
	</div>
</template>

<script setup lang="ts">
	// `/topology/monitor` 网络拓扑总览（NMCPS-DESIGN-001 §二 / §七 / §八）。
	// 主数据源 8888 `/api/topology/graph`，第二数据源 8001 `runtime-inventory`（只读叠加）。
	// 仿真通道未配置 / 不可达时页面照常只读：拓扑与统计继续渲染，仿真区块单独降级。
	import type { TopologyLayoutMode } from "~~/app/utils/graph/topologyLayout";
	import type { SimulatorChannelState, SimulatorNodeAction } from "~~/layers/topology/app/composables/useTopologyMonitor";
	import type { TopologyNodeStatus } from "~~/shared/types/topology";
	import {
		RADIAL_ROTATE_DEG,
		TOPOLOGY_LAYOUT_MODES,
		TOPOLOGY_ROTATE_MAX,
		TOPOLOGY_ROTATE_MIN,
		TOPOLOGY_ROTATE_STEP
	} from "~~/app/utils/graph/topologyLayout";
	import { nodeFactsOf, topologyNeighborsOf } from "~~/app/utils/graph/topologyNodeFacts";
	import { linkStatusColor, nodeFillClass, nodeStatusColor, statusI18nKey } from "~~/app/utils/graph/topologyStatusStyle";
	import { SIMULATOR_MESSAGES } from "~~/shared/constants/upstreamReasons";

	definePageMeta({ sort: 1, icon: "carbon:network-3" });

	const { t } = useI18n();
	const toast = useToast();

	const {
		graph,
		layout,
		loading,
		refreshing,
		graphError,
		simState,
		simReason,
		markers,
		running,
		simulatedCount,
		selectedId,
		selected,
		selectNode,
		refresh,
		writeEnabled,
		canWrite,
		acting,
		performNodeAction,
		nodeCount,
		linkCount,
		comboCount,
		layoutMode,
		setLayoutMode,
		rotationDeg,
		canRotate,
		rotateTo,
		nudgeRotation,
		resetRotation,
		nodeOffsets,
		moveNode,
		resetNodeOffsets,
		nodeOffsetCount
	} = useTopologyMonitor();

	/** 画布组件实例：只为「恢复默认配置」的视口复位（`resetViewport()`）暴露 */
	const canvasRef = ref<{ resetViewport: () => void } | null>(null);
	/** 视口是否已被缩放 / 平移（画布 `viewportChange` 上报）：复位按钮的禁用态要诚实反映它 */
	const viewportDirty = ref(false);

	/** 是否还有可复位的用户改动（位移 / 旋转角偏离默认 / 视口被动过）—— 三者在同一处判定 */
	const canResetView = computed(() =>
		nodeOffsetCount.value > 0 || rotationDeg.value !== RADIAL_ROTATE_DEG || viewportDirty.value
	);

	/**
	 * 「恢复默认配置」（1.0 v0.36 同款三合一）：清位移 → 旋转角回默认 → 视口复位。
	 * 三步都只是**清增量**，几何基准不动；顺序无关，但一起做完用户才看得到「真的回去了」。
	 */
	function resetViewConfig(): void {
		resetNodeOffsets();
		resetRotation();
		canvasRef.value?.resetViewport();
	}

	/**
	 * 布局下拉项（§6.8）：一项一个 `checked`，当前布局打勾 —— 下拉本身就是「当前在哪一档」的读数。
	 * 词表来自 `TOPOLOGY_LAYOUT_MODES`（页面不自己列），未复刻的 force / grid / circular 不出现在这里。
	 */
	const layoutItems = computed(() => [
		TOPOLOGY_LAYOUT_MODES.map((mode: TopologyLayoutMode) => ({
			label: t(`pages.topology-monitor.layouts.${mode}`),
			type: "checkbox" as const,
			checked: layoutMode.value === mode,
			onSelect: () => setLayoutMode(mode)
		}))
	]);

	/** 滑块回调（`USlider` 的 modelValue 可能是 `undefined` ⇒ 忽略，别把角度写成 NaN） */
	function onRotate(value: number | number[] | undefined): void {
		if (typeof value !== "number")
			return;
		rotateTo(value);
	}

	/** 图例固定四档 + 未知：与 `TopologyNodeStatus` 同集合，新增档位必须同时改这里与 i18n */
	const legendStatuses: readonly TopologyNodeStatus[] = ["online", "warning", "critical", "offline"];

	// 节点趋势（A3）：选中节点的管理 IP 是唯一入参 —— 交给 8888 的永远是设备管理 IP，不是节点 id
	const {
		metricCode: trendMetricCode,
		points: trendPoints,
		dropped: trendDropped,
		reason: trendReason,
		error: trendError,
		loading: trendLoading,
		stale: trendStale,
		reload: reloadTrend
	} = useNodeTrend(computed(() => selected.value?.ip ?? ""));

	/** 空态文案按原因分流：没指标名 / 该时段没数据，是两件事，别写成一句「无数据」 */
	const trendEmptyText = computed(() => (trendReason.value === "no_metric_names"
		? t("pages.topology-monitor.trend.noMetricNames")
		: t("pages.topology-monitor.trend.empty")));

	// ── 节点事实（NMCPS-DESIGN-001 §6.5，复刻 1.0 的详情栏口径）─────────────────────────────
	// 1.0 把 `cpu / memory / interfaces / traffic` 直接铺在节点 `data` 上、用 `-1` 表示取不到，
	// 详情栏据此画进度条与三张 KPI 卡。2.0 把读表收进 `nodeFactsOf()`：**未知一律 `null`**，
	// 展示成「—」而不是 `0%`（CONTRACT-002 §6.3 不补 0）。
	const selectedFacts = computed(() => nodeFactsOf(selected.value?.node));

	/** 邻居从**当前画布**的链路推导（与 1.0 的「邻居数」同源），不是上游自报的 `neighbors` */
	const selectedNeighbors = computed(() => (selected.value
		? topologyNeighborsOf(layout.value, selected.value.id)
		: []));

	/** CPU / 内存两条进度条：`value === null` 时只留「—」，不画空进度条（空条会读成 0%） */
	const percentMeters = computed(() => [
		{ key: "cpu", label: "pages.topology-monitor.detail.cpu", value: selectedFacts.value.cpu },
		{ key: "memory", label: "pages.topology-monitor.detail.memory", value: selectedFacts.value.memory }
	]);

	/** 三张 KPI 卡：接口数 / 邻居数 / 流量（流量单位 Mbps，与 1.0 同口径） */
	const factCards = computed(() => [
		{
			key: "interfaces",
			label: t("pages.topology-monitor.detail.interfaces"),
			text: formatCount(selectedFacts.value.interfaces),
			unit: ""
		},
		{
			key: "neighbors",
			label: t("pages.topology-monitor.detail.neighbors"),
			text: `${selectedNeighbors.value.length}`,
			unit: ""
		},
		{
			key: "traffic",
			label: t("pages.topology-monitor.detail.traffic"),
			text: formatTraffic(selectedFacts.value.traffic),
			// 未知时不带单位：`— Mbps` 会被读成「0 Mbps 只是没写小数点」
			unit: selectedFacts.value.traffic === null ? "" : t("pages.topology-monitor.detail.trafficUnit")
		}
	]);

	/** 百分比：未知写「—」，已知保留一位小数 */
	function formatPercent(value: number | null): string {
		return value === null ? "—" : `${Math.round(value * 10) / 10}%`;
	}

	/** 计数：未知写「—」；`0` 是真实值，照写 */
	function formatCount(value: number | null): string {
		return value === null ? "—" : `${value}`;
	}

	/** 流量（Mbps）：1.0 口径保留两位小数；未知写「—」 */
	function formatTraffic(value: number | null): string {
		return value === null ? "—" : `${Math.round(value * 100) / 100}`;
	}

	/** 百分比阈值色：>80 错误、>60 警告、其余主色；未知不画进度条，颜色无意义 */
	function percentColor(value: number | null): "primary" | "warning" | "error" {
		if (value === null)
			return "primary";
		return value > 80 ? "error" : value > 60 ? "warning" : "primary";
	}

	/** 动作目标：选中节点在仿真侧的那一条（没有就说明这个节点不在仿真里，写不了） */
	const actionTarget = computed(() => selected.value?.marker ?? null);

	const pendingAction = ref<SimulatorNodeAction | null>(null);
	const confirmOpen = ref(false);
	const actionError = ref("");

	/** 两个条件缺一不可：通道 + 写开关（`canWrite`），以及一个可下发的仿真节点 */
	const canOperate = computed(() => canWrite.value && !!actionTarget.value && !acting.value);

	const pendingLabel = computed(() => (pendingAction.value === "stop"
		? t("pages.topology-monitor.simControls.nodeStop")
		: t("pages.topology-monitor.simControls.nodeRestart")));

	/** 确认弹窗的正文：目标（仿真名 + 仿真 id）+ 动作，缺一样都别让人按下去 */
	const confirmDescription = computed(() => {
		const target = actionTarget.value;
		if (!target)
			return "";
		return t("pages.topology-monitor.simControls.confirmDescription", {
			action: pendingLabel.value,
			name: target.name,
			id: target.simId
		});
	});

	/**
	 * 按钮禁用原因：按「通道 → 写开关 → 选中 → 是否在仿真里」的顺序各说一句话。
	 * 顺序即优先级——先说缺的那一层，用户才知道该找运维开开关还是先去点节点。
	 */
	const simControlHint = computed(() => {
		const state: SimulatorChannelState = simState.value;
		if (state === "loading")
			return t("pages.topology-monitor.simControls.loading");
		if (state === "disabled")
			return t("pages.topology-monitor.simControls.disabled");
		if (state === "unreachable")
			return t("pages.topology-monitor.simControls.unreachable");
		if (!writeEnabled.value)
			return t("pages.topology-monitor.simControls.writeDisabled");
		if (!selected.value)
			return t("pages.topology-monitor.simControls.selectNode");
		if (!actionTarget.value)
			return t("pages.topology-monitor.simControls.notSimulated");
		return t("pages.topology-monitor.simControls.ready", { name: actionTarget.value.name });
	});

	/** 失败原因：本方词汇（未开写 / 不可达 / 超时）翻成文案，其余是上游原话，照原样展示 */
	function describeActionError(message: string): string {
		if (message === SIMULATOR_MESSAGES.writeDisabled)
			return t("pages.topology-monitor.simControls.writeDisabled");
		if (message === SIMULATOR_MESSAGES.unreachable)
			return t("pages.topology-monitor.simControls.unreachable");
		if (message === SIMULATOR_MESSAGES.timeout)
			return t("pages.topology-monitor.simControls.timeout");
		return message;
	}

	function askAction(action: SimulatorNodeAction): void {
		if (!canOperate.value)
			return;

		actionError.value = "";
		pendingAction.value = action;
		confirmOpen.value = true;
	}

	async function submitAction(): Promise<void> {
		const target = actionTarget.value;
		const action = pendingAction.value;
		if (!target || !action || acting.value)
			return;

		const result = await performNodeAction(action, target.simId);

		if (!result.ok) {
			actionError.value = describeActionError(result.message);
			return;
		}

		toast.add({
			title: t(action === "stop"
				? "pages.topology-monitor.simControls.stopped"
				: "pages.topology-monitor.simControls.restarted"),
			description: target.name,
			color: "success"
		});
		confirmOpen.value = false;
		pendingAction.value = null;
	}
</script>
