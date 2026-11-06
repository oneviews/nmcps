<template>
	<div class="flex min-h-0 flex-1 flex-col gap-3 p-3">
		<!-- 工具栏（NMCPS-ARCH-006 §4）：左区集合域动作，右区仿真控制（写入口未开放时整体 disabled） -->
		<Teleport to="#app-toolbar-left">
			<UTooltip :text="$t('pages.topology-monitor.refresh')">
				<UButton
					size="sm"
					color="neutral"
					variant="ghost"
					icon="carbon:renew"
					:loading="refreshing"
					:aria-label="$t('pages.topology-monitor.refresh')"
					@click="refresh()"
				/>
			</UTooltip>
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
					:nodes="layout.nodes"
					:links="layout.links"
					:width="layout.width"
					:height="layout.height"
					:selected-id="selectedId"
					:markers="markers"
					:label="$t('pages.topology-monitor.canvasLabel')"
					@select="selectNode"
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
	import type { SimulatorChannelState, SimulatorNodeAction } from "~~/layers/topology/app/composables/useTopologyMonitor";
	import type { TopologyNodeStatus } from "~~/shared/types/topology";
	import { nodeFillClass, nodeStatusColor, statusI18nKey } from "~~/app/utils/graph/topologyStatusStyle";
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
		comboCount
	} = useTopologyMonitor();

	/** 图例固定四档 + 未知：与 `TopologyNodeStatus` 同集合，新增档位必须同时改这里与 i18n */
	const legendStatuses: readonly TopologyNodeStatus[] = ["online", "warning", "critical", "offline"];

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
