<template>
	<div class="flex min-h-0 flex-1 flex-col gap-3 p-3">
		<Teleport to="#app-toolbar-left">
			<div class="flex items-center gap-1">
				<UButton
					data-testid="mininet-refresh"
					size="xs"
					color="neutral"
					variant="subtle"
					icon="carbon:renew"
					:loading="loading"
					:label="$t('pages.scenario-simulator.toolbar.refresh')"
					@click="load()"
				/>
				<UDropdownMenu v-if="canCreate" :items="addItems" :content="{ align: 'start' }">
					<UButton
						data-testid="mininet-add-menu"
						size="xs"
						color="neutral"
						variant="subtle"
						icon="carbon:add"
						trailing-icon="carbon:chevron-down"
						:label="$t('pages.scenario-simulator.toolbar.add')"
					/>
				</UDropdownMenu>
				<USwitch
					v-model="showLabels"
					data-testid="mininet-labels-toggle"
					size="sm"
					:label="$t('pages.scenario-simulator.toolbar.labels')"
				/>
			</div>
		</Teleport>

		<Teleport to="#app-toolbar-right">
			<div class="flex items-center gap-1">
				<LayoutToolbarBadge
					v-for="stat in statBadges"
					:key="stat.key"
					:data-testid="`mininet-stat-${stat.key}`"
					variant="subtle"
					color="neutral"
					:icon="stat.icon"
					:label="`${stat.label} ${stat.text}`"
				/>
			</div>
		</Teleport>

		<UAlert
			v-if="error"
			data-testid="mininet-error"
			color="error"
			variant="subtle"
			icon="carbon:warning-alt"
			:title="$t('pages.scenario-simulator.error.title')"
			:description="error"
		>
			<template #actions>
				<UButton
					size="sm"
					color="neutral"
					variant="subtle"
					:label="$t('pages.scenario-simulator.toolbar.refresh')"
					@click="load()"
				/>
			</template>
		</UAlert>

		<div v-else-if="loading && !positioned.length" class="flex min-h-0 flex-1 items-center justify-center">
			<USkeleton class="h-full min-h-96 w-full rounded-lg" />
		</div>

		<div
			v-else-if="!network"
			data-testid="mininet-empty"
			class="flex min-h-0 flex-1 items-center justify-center"
		>
			<div class="flex max-w-md flex-col items-center gap-3 text-center">
				<UIcon name="carbon:network-4" class="size-12 text-(--ui-text-muted)" />
				<h2 class="text-lg font-semibold">
					{{ $t("pages.scenario-simulator.empty.title") }}
				</h2>
				<p class="text-sm text-(--ui-text-muted)">
					{{ $t("pages.scenario-simulator.empty.body") }}
				</p>
			</div>
		</div>

		<div v-else class="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
			<div class="relative min-h-[420px] flex-1 overflow-hidden rounded-lg border border-(--ui-border)">
				<GraphTopologyCanvas
					v-if="positioned.length"
					:nodes="positioned"
					:links="graphLinks"
					:width="canvasWidth"
					:height="canvasHeight"
					:selected-id="selectedId"
					:selected-link-key="selectedLinkKey"
					:link-title="linkTitle"
					:show-labels="showLabels"
					:draggable="canOperate"
					:label="$t('pages.scenario-simulator.canvasLabel')"
					@select="selectNode"
					@select-link="selectLink"
					@offset-change="onNodeMoved"
				/>
				<div v-else class="flex h-full min-h-96 items-center justify-center">
					<p class="text-sm text-(--ui-text-muted)">
						{{ $t("pages.scenario-simulator.empty.topology") }}
					</p>
				</div>
			</div>

			<aside data-testid="mininet-detail" class="flex w-full shrink-0 flex-col gap-3 lg:w-72">
				<div class="rounded-lg border border-(--ui-border) p-3">
					<h2 class="mb-2 text-sm font-semibold">
						{{ $t("pages.scenario-simulator.network.title") }}
					</h2>
					<dl class="grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
						<template v-for="row in networkRows" :key="row.key">
							<dt class="text-(--ui-text-muted)">
								{{ row.label }}
							</dt>
							<dd class="truncate">
								{{ row.value }}
							</dd>
						</template>
					</dl>
				</div>

				<div class="rounded-lg border border-(--ui-border) p-3">
					<h2 class="mb-2 text-sm font-semibold">
						{{ $t("pages.scenario-simulator.detail.title") }}
					</h2>

					<template v-if="selectedLink">
						<div class="flex items-center justify-between gap-2">
							<span class="truncate font-medium">{{ selectedLink.source }} ↔ {{ selectedLink.target }}</span>
							<UBadge size="sm" variant="subtle" color="success">
								{{ $t("pages.scenario-simulator.detail.link") }}
							</UBadge>
						</div>
						<dl class="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.scenario-simulator.detail.from") }}
							</dt>
							<dd class="truncate">
								{{ selectedLink.source }}
							</dd>
							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.scenario-simulator.detail.to") }}
							</dt>
							<dd class="truncate">
								{{ selectedLink.target }}
							</dd>
						</dl>
						<UButton
							v-if="canOperate"
							data-testid="mininet-remove-link"
							class="mt-3 w-full justify-center"
							size="xs"
							color="error"
							variant="subtle"
							icon="carbon:unlink"
							:label="$t('pages.scenario-simulator.edit.removeLink')"
							@click="askRemoveLink"
						/>
					</template>

					<template v-else-if="selectedNode">
						<div class="flex items-center justify-between gap-2">
							<span class="truncate font-medium">{{ selectedNode.positioned.label }}</span>
							<UBadge size="sm" variant="subtle" color="neutral">
								{{ selectedNode.kind }}
							</UBadge>
						</div>
						<dl class="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
							<template v-for="row in nodeRows" :key="row.key">
								<dt class="text-(--ui-text-muted)">
									{{ row.label }}
								</dt>
								<dd class="truncate">
									{{ row.value }}
								</dd>
							</template>
						</dl>

						<!--
							交换机附加项（NMCPS-ADR-0022 W2 / W2b）：OpenFlow 版本与流表写入（`lab:operate`）。
							流表落库在交换机侧（`ovs-ofctl`），页面只呈现原文 —— 解析归后端；
							单条删除的行号按「含 actions= 的行」计，口径见 labFlowRowsOf()。
						-->
						<div v-if="selectedNode.kind === 'switch'" class="mt-3 space-y-2">
							<UFormField v-if="canOperate" :label="$t('pages.scenario-simulator.edit.openflow')">
								<USelect
									data-testid="mininet-openflow"
									size="xs"
									class="w-full"
									:items="openflowItems"
									:model-value="openflowValue"
									@update:model-value="applyOpenflow"
								/>
							</UFormField>
							<div>
								<div class="mb-1 flex items-center justify-between gap-2">
									<h3 class="text-xs font-medium">
										{{ $t("pages.scenario-simulator.flows.title") }}
									</h3>
									<UButton
										v-if="canOperate"
										data-testid="mininet-flow-reload"
										size="xs"
										color="neutral"
										variant="ghost"
										icon="carbon:renew"
										:aria-label="$t('pages.scenario-simulator.flows.reload')"
										@click="reloadFlows"
									/>
								</div>
								<p v-if="flowLoading" class="text-xs text-(--ui-text-muted)">
									{{ $t("pages.scenario-simulator.flows.loading") }}
								</p>
								<p v-else-if="flowError" data-testid="mininet-flow-error" class="text-xs text-(--ui-text-error)">
									{{ flowError }}
								</p>
								<template v-else>
									<div
										v-if="flowRows.length"
										data-testid="mininet-flows"
										class="max-h-40 space-y-1 overflow-auto rounded bg-(--ui-bg-elevated) p-2 text-[11px] leading-4"
									>
										<div
											v-for="(row, index) in flowRows"
											:key="`${row.id ?? 'note'}-${index}`"
											class="flex items-start gap-1"
										>
											<code class="min-w-0 flex-1 break-all">{{ row.text }}</code>
											<UButton
												v-if="canOperate && row.id"
												data-testid="mininet-flow-remove"
												:data-flow-id="row.id"
												size="xs"
												color="error"
												variant="ghost"
												icon="carbon:trash-can"
												:aria-label="$t('pages.scenario-simulator.flows.remove', { id: row.id })"
												@click="removeFlow(row.id)"
											/>
										</div>
									</div>
									<p v-else class="text-xs text-(--ui-text-muted)">
										{{ $t("pages.scenario-simulator.flows.empty") }}
									</p>
								</template>
							</div>

							<!-- 写失败（加流 / 删流）原话照实显示：页面不吞上游 4xx，也不自造文案 -->
							<p v-if="actionError" data-testid="lab-flow-error" class="text-xs text-(--ui-text-error)">
								{{ actionError }}
							</p>

							<!-- 加流（lab:operate）：动作必填，其余留空走上游默认 -->
							<div v-if="canOperate" class="space-y-1.5 rounded border border-(--ui-border) p-2">
								<!-- 就地报错：三条校验各落到出错的那个字段，不再挤在优先级下面 -->
								<UFormField
									:label="$t('pages.scenario-simulator.flows.match')"
									:error="flowDraftError === 'matchInvalid' ? flowDraftErrorText : undefined"
								>
									<UInput
										v-model="flowDraft.match"
										data-testid="lab-flow-match"
										size="xs"
										class="w-full"
										:placeholder="$t('pages.scenario-simulator.flows.matchPlaceholder')"
									/>
								</UFormField>
								<UFormField
									:label="$t('pages.scenario-simulator.flows.actions')"
									:error="flowDraftError === 'actionsRequired' ? flowDraftErrorText : undefined"
								>
									<UInput
										v-model="flowDraft.actions"
										data-testid="lab-flow-actions"
										size="xs"
										class="w-full"
										:placeholder="$t('pages.scenario-simulator.flows.actionsPlaceholder')"
									/>
								</UFormField>
								<UFormField
									:label="$t('pages.scenario-simulator.flows.priority')"
									:error="flowDraftError === 'priorityInvalid' ? flowDraftErrorText : undefined"
								>
									<UInput
										v-model="flowDraft.priority"
										data-testid="lab-flow-priority"
										size="xs"
										class="w-full"
										type="number"
										min="0"
										:max="LAB_FLOW_PRIORITY_MAX"
										:placeholder="$t('pages.scenario-simulator.flows.priorityPlaceholder')"
									/>
								</UFormField>
								<UButton
									data-testid="lab-flow-submit"
									class="w-full justify-center"
									size="xs"
									color="primary"
									variant="subtle"
									icon="carbon:flow"
									:label="$t('pages.scenario-simulator.flows.submit')"
									:loading="acting"
									@click="addFlow"
								/>
							</div>
						</div>

						<!-- 连线（`lab:create`）：从选中节点连到另一台设备，单向一次请求 -->
						<div v-if="canCreate && linkTargetItems.length" class="mt-3 space-y-2">
							<UFormField :label="$t('pages.scenario-simulator.edit.linkTo')">
								<USelect
									v-model="linkTarget"
									data-testid="mininet-link-target"
									size="xs"
									class="w-full"
									:items="linkTargetItems"
									:placeholder="$t('pages.scenario-simulator.edit.linkPlaceholder')"
								/>
							</UFormField>
							<UButton
								data-testid="mininet-link-create"
								class="w-full justify-center"
								size="xs"
								color="primary"
								variant="subtle"
								icon="carbon:link"
								:label="$t('pages.scenario-simulator.edit.linkSubmit')"
								:disabled="!linkTarget"
								:loading="acting"
								@click="createLink"
							/>
						</div>

						<UButton
							v-if="canDelete"
							data-testid="mininet-remove-node"
							class="mt-3 w-full justify-center"
							size="xs"
							color="error"
							variant="subtle"
							icon="carbon:trash-can"
							:label="$t('pages.scenario-simulator.edit.removeNode')"
							@click="askRemoveNode"
						/>
					</template>

					<p v-else class="text-xs text-(--ui-text-muted)">
						{{ $t("pages.scenario-simulator.detail.hint") }}
					</p>
				</div>
			</aside>
		</div>

		<!--
			新增 / 删除的确认层（NMCPS-ADR-0022 W2）：表单与确认都是 `UModal` 原生组件，
			请求由页面发（页面是唯一写入方），组件只负责校验与文案。
		-->
		<SimulatorNodeFormModal
			v-if="createKind"
			v-model:open="createOpen"
			:kind="createKind"
			:existing="nodeIds"
			:origin="createOrigin"
			:sequence="nodes.length + 1"
			:submitting="acting"
			:error="actionError"
			@submit="createNode"
		/>
		<SimulatorDeleteTargetModal
			v-model:open="removeOpen"
			:target="removeTarget"
			:submitting="acting"
			:error="actionError"
			@confirm="confirmRemove"
		/>
	</div>
</template>

<script setup lang="ts">
	import type { PositionedTopologyNode } from "~~/app/utils/graph/topologyLayout";
	import type { TopologyNodeRole } from "~~/app/utils/graph/topologyRoleStyle";
	import type { LabNetworkSummary } from "~~/shared/types/lab";
	import type { TopologyGraphLink, TopologyGraphNode } from "~~/shared/types/topology";
	import type { LabFlowDraftError } from "#layers/scenario/shared/types/labFlows";
	import type { LabNodeKind, LabNodeOrigin, LabRemoveTarget } from "#layers/scenario/shared/types/labNodes";
	import type { MininetChannelCapabilities, MininetChannelInfo } from "#layers/scenario/shared/types/mininet";
	import { topologyLinkKey } from "~~/app/utils/graph/topologyNormalize";
	import {
		LAB_FLOW_PRIORITY_MAX,
		labFlowDraftError,
		labFlowDraftOf,
		labFlowPayloadOf,
		labFlowRowsOf
	} from "#layers/scenario/shared/types/labFlows";
	import {
		LAB_NODE_COLLECTIONS,
		LAB_NODE_KINDS,
		LAB_OPENFLOW_VERSIONS
	} from "#layers/scenario/shared/types/labNodes";

	definePageMeta({ sort: 1, icon: "carbon:flash" });

	interface RawMininetNode {
		id?: string
		name?: string
		label?: string
		type?: string
		x?: unknown
		y?: unknown
		ip?: string
		mac?: string
		controller?: string
		ports?: number
		switch_type?: string
		of_version?: string | null
	}

	type NodeKind = LabNodeKind;

	/** 节点类型 → 图标 / i18n 后缀（新增菜单与徽章共用一张表，不各写一份） */
	const NODE_KIND_ICONS: Record<NodeKind, string> = {
		host: "carbon:laptop",
		switch: "carbon:switch-layer-3",
		router: "carbon:router",
		nat: "carbon:network-4",
		controller: "carbon:control"
	};

	interface GraphNode {
		key: string
		kind: NodeKind
		raw: RawMininetNode
		positioned: PositionedTopologyNode
	}

	const api = useApi();
	const { t } = useI18n();
	const toast = useToast();

	const loading = ref(false);
	const error = ref<string | null>(null);
	const networks = ref<LabNetworkSummary[]>([]);
	const nodes = ref<GraphNode[]>([]);
	const graphLinks = ref<TopologyGraphLink[]>([]);
	const canvasWidth = ref(960);
	const canvasHeight = ref(640);
	const showLabels = ref(true);
	const selectedId = ref<string | null>(null);
	const selectedLinkKey = ref<string | null>(null);

	/**
	 * 会话能力位（`GET /api/lab/channel`，NMCPS-ADR-0022 D3）：
	 * 写动作**先读能力位再渲染**，不靠「先渲染、点下去再收 403/405」。
	 * 读不到（通道未配置 / 主上游不可用）时保持只读 —— 失败关闭。
	 */
	const capabilities = ref<MininetChannelCapabilities | null>(null);
	const canCreate = computed(() => capabilities.value?.create === true);
	const canOperate = computed(() => capabilities.value?.operate === true);
	const canDelete = computed(() => capabilities.value?.delete === true);

	/** 正在进行的写操作（按钮 loading / 弹窗不可关闭）与失败原话 */
	const acting = ref(false);
	const actionError = ref<string>();

	/** 新增节点弹窗：`createKind` 为空时不挂载组件，草稿因此不会跨类型串味 */
	const createOpen = ref(false);
	const createKind = ref<NodeKind | null>(null);

	/** 删除确认（节点 / 链路共用一个弹窗） */
	const removeOpen = ref(false);
	const removeTarget = ref<LabRemoveTarget | null>(null);

	/** 连线目标（从选中节点连出去） */
	const linkTarget = ref<string>();

	/** 交换机流表：原文 + 失败原话（上游原话逐字展示，不翻译） */
	const flowLoading = ref(false);
	const flowText = ref("");
	const flowError = ref<string>();

	/** 加流草稿（`lab:operate` 才渲染表单；切换交换机时重置） */
	const flowDraft = ref(labFlowDraftOf());
	const flowDraftError = ref<LabFlowDraftError>();

	const network = computed(() => networks.value[0] ?? null);
	const positioned = computed(() => nodes.value.map((item) => item.positioned));
	const nodeIds = computed(() => nodes.value.map((item) => item.positioned.id));
	const selectedNode = computed(() => nodes.value.find((item) => item.positioned.id === selectedId.value) ?? null);
	const selectedLink = computed(() => {
		const index = graphLinks.value.findIndex((link, position) => topologyLinkKey(link, position) === selectedLinkKey.value);
		return index >= 0 ? graphLinks.value[index] ?? null : null;
	});

	/**
	 * 流表按行渲染：上游回的是 `ovs-ofctl` 原文，页面不解析（解析归后端）。
	 * 行号只对含 `actions=` 的行给出，口径与上游 `delete_flow_by_id()` 一致。
	 */
	const flowRows = computed(() => labFlowRowsOf(flowText.value));

	/** 加流表单的报错文案：键后缀 → 完整 i18n 键 */
	const flowDraftErrorText = computed(() => (flowDraftError.value
		? t(`pages.scenario-simulator.flows.errors.${flowDraftError.value}`)
		: undefined));

	/** 用户一动草稿就撤掉上一次的就地报错 —— 留着会指向已经改过的字段 */
	watch(flowDraft, () => {
		flowDraftError.value = undefined;
	}, { deep: true });

	/** 新增菜单：一项一个节点类型，只在有 `lab:create` 时出现 */
	const addItems = computed(() => [
		LAB_NODE_KINDS.map((kind) => ({
			label: t(`pages.scenario-simulator.kinds.${kind}`),
			icon: NODE_KIND_ICONS[kind],
			onSelect: () => openCreate(kind)
		}))
	]);

	/** 新节点的默认落点：按已有节点数错开，避免叠在原点（上游 `x` / `y` 口径） */
	const createOrigin = computed<LabNodeOrigin>(() => ({
		x: 120 + (nodes.value.length % 5) * 140,
		y: 120 + Math.floor(nodes.value.length / 5) * 130
	}));

	/** 连线目标：除自己以外的全部节点（同一对节点重复连线由上游 400 拦） */
	const linkTargetItems = computed(() => nodeIds.value
		.filter((id) => id !== selectedId.value)
		.map((id) => ({ label: id, value: id })));

	/** OpenFlow 下拉：`auto` = 跟随上游默认（上游把 `auto` 归一成 `null`） */
	const openflowItems = computed(() => [
		{ label: t("pages.scenario-simulator.edit.openflowAuto"), value: "auto" },
		...LAB_OPENFLOW_VERSIONS.map((value) => ({ label: value, value }))
	]);
	const openflowValue = computed(() => selectedNode.value?.raw.of_version || "auto");

	function messageOf(value: unknown): string {
		return value instanceof Error ? value.message : String(value);
	}

	function asRecord(value: unknown): Record<string, unknown> | undefined {
		return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
	}

	function rawNodesOf(payload: unknown, kind: NodeKind): RawMininetNode[] {
		const list: RawMininetNode[] = [];
		if (Array.isArray(payload)) {
			for (const item of payload) {
				const record = asRecord(item);
				if (record)
					list.push({ ...record as RawMininetNode, type: kind });
			}
			return list;
		}

		const record = asRecord(payload);
		if (!record)
			return list;
		for (const [key, item] of Object.entries(record)) {
			const value = asRecord(item);
			if (!value)
				continue;
			list.push({
				...value as RawMininetNode,
				name: typeof value.name === "string" ? value.name : key,
				type: kind
			});
		}
		return list;
	}

	function rawLinksOf(payload: unknown): TopologyGraphLink[] {
		if (!Array.isArray(payload))
			return [];
		return payload.flatMap((item) => {
			const record = asRecord(item);
			const source = typeof record?.from === "string" ? record.from : undefined;
			const target = typeof record?.to === "string" ? record.to : undefined;
			if (!source || !target)
				return [];
			return [{
				source,
				target,
				status: "online",
				linkType: "ethernet"
			} satisfies TopologyGraphLink];
		});
	}

	function roleOf(kind: NodeKind): TopologyNodeRole {
		if (kind === "switch")
			return "access";
		if (kind === "host")
			return "terminal";
		return "core";
	}

	function coordinate(value: unknown, fallback: number): number {
		return typeof value === "number" && Number.isFinite(value) ? value : fallback;
	}

	function buildGraph(rawNodes: RawMininetNode[], rawLinks: TopologyGraphLink[]): void {
		const seen = new Set<string>();
		const unique = rawNodes.filter((node) => {
			const key = node.name ?? node.id;
			if (!key || seen.has(key))
				return false;
			seen.add(key);
			return true;
		});

		const layoutNodes: GraphNode[] = [];
		const usedIds = new Set<string>();
		const columns = Math.max(1, Math.ceil(Math.sqrt(unique.length)));
		const xs = unique.map((node) => node.x).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
		const ys = unique.map((node) => node.y).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
		const hasSpread = xs.length > 0 && ys.length > 0
			&& (Math.max(...xs) - Math.min(...xs) > 1 || Math.max(...ys) - Math.min(...ys) > 1);
		const minX = hasSpread ? Math.min(...xs) : 0;
		const minY = hasSpread ? Math.min(...ys) : 0;

		for (const [index, raw] of unique.entries()) {
			const label = raw.label || raw.name || raw.id || `node-${index + 1}`;
			const kind = (raw.type ?? "host") as NodeKind;
			let id = raw.name || raw.id || label;
			if (usedIds.has(id))
				id = `${id}-${index}`;
			usedIds.add(id);

			const role = roleOf(kind);
			const graphNode: TopologyGraphNode = {
				id,
				name: label,
				label,
				ip: raw.ip,
				category: kind === "host" ? "client" : "network-device",
				type: kind,
				status: "online"
			};
			const x = hasSpread ? coordinate(raw.x, 0) - minX + 80 : 80 + (index % columns) * 160;
			const y = hasSpread ? coordinate(raw.y, 0) - minY + 80 : 80 + Math.floor(index / columns) * 140;

			layoutNodes.push({
				key: label,
				kind,
				raw,
				positioned: {
					node: graphNode,
					id,
					label,
					labelShift: 0,
					labelDirDx: 0,
					labelDirDy: 1,
					tier: role === "terminal" ? 4 : role === "core" ? 1 : 3,
					rank: role === "terminal" ? 2 : role === "core" ? 0 : 1,
					role,
					x,
					y
				}
			});
		}

		const ids = new Set(layoutNodes.map((item) => item.positioned.id));
		nodes.value = layoutNodes;
		graphLinks.value = rawLinks.filter((link) => ids.has(link.source) && ids.has(link.target));
		canvasWidth.value = Math.max(720, ...layoutNodes.map((item) => item.positioned.x + 120));
		canvasHeight.value = Math.max(480, ...layoutNodes.map((item) => item.positioned.y + 100));

		if (selectedId.value && !ids.has(selectedId.value))
			selectedId.value = null;
	}

	function resetGraph(): void {
		nodes.value = [];
		graphLinks.value = [];
		selectedId.value = null;
		selectedLinkKey.value = null;
	}

	async function load(): Promise<void> {
		loading.value = true;
		error.value = null;

		try {
			// 能力位与台账并行取：通道读不到（未配置 / 主上游故障）时降级为只读，不影响看拓扑
			const [networkResult, channelResult] = await Promise.allSettled([
				api.get<LabNetworkSummary[]>("/api/lab/networks"),
				api.get<MininetChannelInfo>("/api/lab/channel")
			]);

			capabilities.value = channelResult.status === "fulfilled" ? channelResult.value.capabilities : null;

			if (networkResult.status === "rejected")
				throw networkResult.reason;

			networks.value = networkResult.value;
			if (!networks.value.length) {
				resetGraph();
				return;
			}

			const requests: Array<{ kind: NodeKind, path: string }> = [
				{ kind: "host", path: "/api/lab/hosts" },
				{ kind: "switch", path: "/api/lab/switches" },
				{ kind: "router", path: "/api/lab/routers" },
				{ kind: "nat", path: "/api/lab/nats" },
				{ kind: "controller", path: "/api/lab/controllers" }
			];

			const [nodeResults, linkResult] = await Promise.all([
				Promise.allSettled(requests.map((item) => api.get<unknown>(item.path))),
				Promise.allSettled([api.get<unknown>("/api/lab/links")])
			]);

			const rawNodes: RawMininetNode[] = [];
			const failures: unknown[] = [];
			for (const [index, result] of nodeResults.entries()) {
				if (result.status === "fulfilled")
					rawNodes.push(...rawNodesOf(result.value, requests[index]!.kind));
				else
					failures.push(result.reason);
			}

			const linkOutcome = linkResult[0]!;
			if (linkOutcome.status === "rejected")
				failures.push(linkOutcome.reason);

			if (!rawNodes.length && failures.length)
				throw failures[0];

			buildGraph(
				rawNodes,
				linkOutcome.status === "fulfilled" ? rawLinksOf(linkOutcome.value) : []
			);
		} catch (caught) {
			resetGraph();
			error.value = messageOf(caught);
		} finally {
			loading.value = false;
		}
	}

	function selectNode(id: string): void {
		selectedId.value = id;
		selectedLinkKey.value = null;
		linkTarget.value = undefined;

		const node = nodes.value.find((item) => item.positioned.id === id);
		if (node?.kind === "switch")
			void loadFlows(id);
		else
			clearFlows();
	}

	function selectLink(key: string): void {
		selectedLinkKey.value = key;
		selectedId.value = null;
		linkTarget.value = undefined;
		clearFlows();
	}

	function linkTitle(link: TopologyGraphLink): string {
		return `${link.source} ↔ ${link.target}`;
	}

	/* ── 写操作（NMCPS-ADR-0022 W2）──────────────────────────────────────────
	 * 全部走 `/api/lab/**`：权限位、审计、串行化锁、台账归属都在 BFF，
	 * 页面只做「发什么 + 失败原话回显」。成功后统一 `load()`，让画布回到台账事实，
	 * 不在前端自己算一份「应该长什么样」。
	 */

	function openCreate(kind: NodeKind): void {
		actionError.value = undefined;
		createKind.value = kind;
		createOpen.value = true;
	}

	async function createNode(payload: Record<string, unknown>): Promise<void> {
		const kind = createKind.value;
		if (!kind || acting.value)
			return;

		acting.value = true;
		actionError.value = undefined;

		try {
			await api.post(LAB_NODE_COLLECTIONS[kind], payload);
			toast.add({ title: t("pages.scenario-simulator.edit.created", { id: String(payload.name ?? payload.id) }), color: "success" });
			createOpen.value = false;
			createKind.value = null;
			await load();
		} catch (caught) {
			actionError.value = messageOf(caught);
		} finally {
			acting.value = false;
		}
	}

	function askRemoveNode(): void {
		if (!selectedNode.value)
			return;
		actionError.value = undefined;
		removeTarget.value = { kind: "node", id: selectedNode.value.positioned.id };
		removeOpen.value = true;
	}

	function askRemoveLink(): void {
		if (!selectedLink.value)
			return;
		actionError.value = undefined;
		removeTarget.value = { kind: "link", source: selectedLink.value.source, target: selectedLink.value.target };
		removeOpen.value = true;
	}

	async function confirmRemove(): Promise<void> {
		const target = removeTarget.value;
		if (!target || acting.value)
			return;

		acting.value = true;
		actionError.value = undefined;

		try {
			if (target.kind === "link") {
				await api.del(`/api/lab/delete_link/${encodeURIComponent(target.source ?? "")}/${encodeURIComponent(target.target ?? "")}`);
			} else if (target.id) {
				await api.del(`/api/lab/delete_node/${encodeURIComponent(target.id)}`);
			}

			removeOpen.value = false;
			removeTarget.value = null;
			await load();
		} catch (caught) {
			actionError.value = messageOf(caught);
		} finally {
			acting.value = false;
		}
	}

	/** 连线：从选中节点连到 `linkTarget`（上游 `LinkCreate` 的 `{src, dst}` 形态） */
	async function createLink(): Promise<void> {
		const source = selectedId.value;
		const target = linkTarget.value;
		if (!source || !target || acting.value)
			return;

		acting.value = true;
		actionError.value = undefined;

		try {
			await api.post("/api/lab/links", { src: source, dst: target });
			toast.add({ title: t("pages.scenario-simulator.edit.linked", { source, target }), color: "success" });
			linkTarget.value = undefined;
			await load();
		} catch (caught) {
			actionError.value = messageOf(caught);
		} finally {
			acting.value = false;
		}
	}

	/**
	 * 拖动落点（`POST /api/lab/node_position`）。
	 *
	 * 画布给的是**相对几何坐标的累计增量**，上游存的是绝对值：把增量加回 `raw.x` / `raw.y`
	 * 即可。画布展示坐标做过「减去 minX + 80」的平移，那是常量偏移，对增量不产生影响。
	 */
	async function onNodeMoved(id: string, offset: { dx: number, dy: number }): Promise<void> {
		const node = nodes.value.find((item) => item.positioned.id === id);
		if (!node || !canOperate.value || acting.value)
			return;

		const x = Math.round(coordinate(node.raw.x, node.positioned.x) + offset.dx);
		const y = Math.round(coordinate(node.raw.y, node.positioned.y) + offset.dy);

		acting.value = true;
		actionError.value = undefined;

		try {
			await api.post("/api/lab/node_position", { node_id: id, position: [x, y] });
			await load();
		} catch (caught) {
			actionError.value = messageOf(caught);
		} finally {
			acting.value = false;
		}
	}

	/** OpenFlow 版本：`auto` 原样发给上游（上游归一成 `null`，即跟随默认） */
	async function applyOpenflow(value: unknown): Promise<void> {
		const id = selectedNode.value?.positioned.id;
		if (!id || !canOperate.value || acting.value)
			return;

		acting.value = true;
		actionError.value = undefined;

		try {
			await api.put(`/api/lab/switches/${encodeURIComponent(id)}/openflow`, { of_version: typeof value === "string" ? value : "auto" });
			await load();
		} catch (caught) {
			actionError.value = messageOf(caught);
		} finally {
			acting.value = false;
		}
	}

	function clearFlows(): void {
		flowText.value = "";
		flowError.value = undefined;
		flowLoading.value = false;
		flowDraft.value = labFlowDraftOf();
		flowDraftError.value = undefined;
	}

	/**
	 * 流表读数（`GET /api/lab/flows/{switch}`）：上游回 `ovs-ofctl dump-flows` 原文。
	 * 未启动网络时上游回 400，原话照实显示 —— 「没启动」和「没有流」不是同一件事。
	 */
	async function loadFlows(id: string): Promise<void> {
		clearFlows();
		flowLoading.value = true;

		try {
			const result = await api.get<{ switch?: string, flows?: string }>(`/api/lab/flows/${encodeURIComponent(id)}`);
			flowText.value = typeof result?.flows === "string" ? result.flows : "";
		} catch (caught) {
			flowError.value = messageOf(caught);
		} finally {
			flowLoading.value = false;
		}
	}

	/** 手动重读（`lab:operate`）：流表会被 `pingall` / 控制器改写，页面不能假设它静止 */
	function reloadFlows(): void {
		const id = selectedNode.value?.positioned.id;
		if (id)
			void loadFlows(id);
	}

	/**
	 * 加流（`POST /api/lab/flows`，`lab:operate`）：校验在本地先拦一道，
	 * 真正的合法性交给上游 `ovs-ofctl add-flow`（失败回 400，原话照实显示）。
	 */
	async function addFlow(): Promise<void> {
		const id = selectedNode.value?.positioned.id;
		if (!id || !canOperate.value || acting.value)
			return;

		const invalid = labFlowDraftError(flowDraft.value);
		flowDraftError.value = invalid;
		if (invalid)
			return;

		acting.value = true;
		actionError.value = undefined;

		try {
			await api.post("/api/lab/flows", labFlowPayloadOf(id, flowDraft.value));
			toast.add({ title: t("pages.scenario-simulator.flows.created", { id }), color: "success" });
			await loadFlows(id);
		} catch (caught) {
			actionError.value = messageOf(caught);
		} finally {
			acting.value = false;
		}
	}

	/**
	 * 删单条流（`DELETE /api/lab/flows/{switch}/{flow_id}`，`lab:operate`）。
	 * `flow_id` 是上游按「含 `actions=` 的行」数的 1 基序号 —— 见 `labFlowRowsOf()`。
	 */
	async function removeFlow(flowId: number): Promise<void> {
		const id = selectedNode.value?.positioned.id;
		if (!id || !canOperate.value || acting.value)
			return;

		acting.value = true;
		actionError.value = undefined;

		try {
			await api.del(`/api/lab/flows/${encodeURIComponent(id)}/${flowId}`);
			toast.add({ title: t("pages.scenario-simulator.flows.removed", { id: flowId, switch: id }), color: "success" });
			await loadFlows(id);
		} catch (caught) {
			actionError.value = messageOf(caught);
		} finally {
			acting.value = false;
		}
	}

	const statBadges = computed(() => [
		{ key: "network", label: t("pages.scenario-simulator.stats.network"), text: network.value?.state ?? "—", icon: "carbon:flash" },
		{ key: "nodes", label: t("pages.scenario-simulator.stats.nodes"), text: String(nodes.value.length), icon: "carbon:bare-metal-server" },
		{ key: "links", label: t("pages.scenario-simulator.stats.links"), text: String(graphLinks.value.length), icon: "carbon:link" }
	]);

	const networkRows = computed(() => network.value
		? [
			{ key: "id", label: t("pages.scenario-simulator.network.id"), value: network.value.id },
			{ key: "engine", label: t("pages.scenario-simulator.network.engine"), value: network.value.engine },
			{ key: "state", label: t("pages.scenario-simulator.network.state"), value: network.value.state },
			{ key: "nodeCount", label: t("pages.scenario-simulator.network.nodeCount"), value: network.value.node_count === null ? "—" : String(network.value.node_count) }
		]
		: []);

	const nodeRows = computed(() => selectedNode.value
		? [
			{ key: "id", label: t("pages.scenario-simulator.detail.id"), value: selectedNode.value.positioned.id },
			{ key: "ip", label: t("pages.scenario-simulator.detail.ip"), value: selectedNode.value.raw.ip || "—" },
			{ key: "mac", label: t("pages.scenario-simulator.detail.mac"), value: selectedNode.value.raw.mac || "—" },
			{ key: "links", label: t("pages.scenario-simulator.detail.links"), value: String(graphLinks.value.filter((link) => link.source === selectedNode.value?.positioned.id || link.target === selectedNode.value?.positioned.id).length) }
		]
		: []);

	onMounted(load);
</script>
