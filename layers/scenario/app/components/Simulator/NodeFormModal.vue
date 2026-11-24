<template>
	<!--
		新增节点（NMCPS-ADR-0022 W2）：五类节点共用一张表单，字段由 `LAB_NODE_KINDS` 决定。
		请求由页面发出（`POST /api/mininet/<collection>`），本组件只做「校验 + 组装请求体」，
		失败原话回填在弹窗里 —— 404 / 409 / 503 的解释权在 BFF，不在表单。
	-->
	<UModal
		v-model:open="open"
		:title="t('pages.scenario-simulator.add.title', { kind: kindLabel })"
		:description="t('pages.scenario-simulator.add.hint')"
		:dismissible="!submitting"
		:ui="{ footer: 'justify-end' }"
	>
		<template #body>
			<div class="space-y-3">
				<!-- 落点（拖拽新增时由画布落点换算而来）：写的就是这个坐标，先让用户看得见 -->
				<p data-testid="lab-node-origin" class="text-[11px] text-(--ui-text-muted)">
					{{ t('pages.scenario-simulator.add.origin', { x: origin.x, y: origin.y }) }}
				</p>

				<UFormField
					:label="t('pages.scenario-simulator.add.name')"
					:error="fieldError === 'nameRequired' || fieldError === 'nameInvalid' || fieldError === 'nameTaken'
						? t(`pages.scenario-simulator.add.errors.${fieldError}`)
						: undefined"
					required
				>
					<UInput
						v-model="draft.name"
						data-testid="lab-node-name"
						size="sm"
						class="w-full"
						:placeholder="t('pages.scenario-simulator.add.namePlaceholder')"
					/>
				</UFormField>

				<UFormField :label="t('pages.scenario-simulator.add.label')">
					<UInput
						v-model="draft.label"
						data-testid="lab-node-label"
						size="sm"
						class="w-full"
						:placeholder="t('pages.scenario-simulator.add.labelPlaceholder')"
					/>
				</UFormField>

				<UFormField
					v-if="showIp"
					:label="t('pages.scenario-simulator.add.ip')"
					:error="fieldError === 'ipRequired' || fieldError === 'ipInvalid'
						? t(`pages.scenario-simulator.add.errors.${fieldError}`)
						: undefined"
					required
				>
					<UInput v-model="draft.ip" data-testid="lab-node-ip" size="sm" class="w-full" />
				</UFormField>

				<UFormField
					v-if="showMac"
					:label="t('pages.scenario-simulator.add.mac')"
					:error="fieldError === 'macInvalid' ? t('pages.scenario-simulator.add.errors.macInvalid') : undefined"
				>
					<UInput v-model="draft.mac" data-testid="lab-node-mac" size="sm" class="w-full" />
				</UFormField>

				<template v-if="kind === 'switch'">
					<UFormField
						:label="t('pages.scenario-simulator.add.ports')"
						:error="fieldError === 'portsInvalid' ? t('pages.scenario-simulator.add.errors.portsInvalid') : undefined"
						required
					>
						<UInput v-model.number="draft.ports" data-testid="lab-node-ports" type="number" min="1" size="sm" class="w-full" />
					</UFormField>
					<UFormField :label="t('pages.scenario-simulator.add.switchType')">
						<USelect
							v-model="draft.switchType"
							data-testid="lab-node-switch-type"
							size="sm"
							class="w-full"
							:items="switchTypeItems"
						/>
					</UFormField>
				</template>

				<UFormField
					v-if="kind === 'controller'"
					:label="t('pages.scenario-simulator.add.controllerPort')"
					:error="fieldError === 'portInvalid' ? t('pages.scenario-simulator.add.errors.portInvalid') : undefined"
					required
				>
					<UInput v-model.number="draft.controllerPort" data-testid="lab-node-port" type="number" min="1" max="65535" size="sm" class="w-full" />
				</UFormField>

				<UAlert
					v-if="error"
					data-testid="lab-node-error"
					color="error"
					variant="subtle"
					icon="carbon:warning-alt"
					:title="t('pages.scenario-simulator.add.failed')"
					:description="error"
				/>
			</div>
		</template>

		<template #footer>
			<UButton
				color="neutral"
				variant="ghost"
				:label="t('pages.scenario-simulator.add.cancel')"
				:disabled="submitting"
				@click="open = false"
			/>
			<UButton
				data-testid="lab-node-submit"
				color="primary"
				icon="carbon:add"
				:label="t('pages.scenario-simulator.add.submit')"
				:loading="submitting"
				@click="submit"
			/>
		</template>
	</UModal>
</template>

<script setup lang="ts">
	import type { LabNodeDraft, LabNodeDraftError, LabNodeKind, LabNodeOrigin } from "#layers/scenario/shared/types/labNodes";
	import {
		LAB_SWITCH_TYPES,
		labNodeDraftError,
		labNodeDraftOf,
		labNodePayloadOf,
		labNodeUsesIp,
		labNodeUsesMac
	} from "#layers/scenario/shared/types/labNodes";

	/**
	 * 新增节点表单（`lab:create`）：字段集由节点类型决定，提交前先本地校验。
	 *
	 * 校验只拦「确定错」的输入（空名字、重名、明显不是 IP / MAC），语义合法性仍归上游：
	 * 表单不复制一份上游规则，不然两边迟早不一致。
	 */
	const props = defineProps<{
		kind: LabNodeKind
		/** 画布上已有的节点 id：重名会被上游静默 `updated`，这里先拦 */
		existing: readonly string[]
		/** 新节点的默认坐标（上游 `x` / `y` 口径） */
		origin: LabNodeOrigin
		/** 已有节点数：默认名 / 默认 IP 的序号（`h3`、`10.0.0.3`） */
		sequence: number
		submitting?: boolean
		error?: string
	}>();

	const emit = defineEmits<{ submit: [payload: Record<string, unknown>] }>();

	const open = defineModel<boolean>("open", { required: true });

	const { t } = useI18n();

	const draft = ref<LabNodeDraft>(labNodeDraftOf(props.kind, props.sequence));
	const fieldError = ref<LabNodeDraftError>();

	const kindLabel = computed(() => t(`pages.scenario-simulator.kinds.${props.kind}`));
	const showIp = computed(() => labNodeUsesIp(props.kind));
	const showMac = computed(() => labNodeUsesMac(props.kind));
	const switchTypeItems = computed(() => LAB_SWITCH_TYPES.map((value) => ({ label: value, value })));

	// 每次打开都重新起一份草稿：上一次取消时的半成品不该跟着类型串到下一次
	watch(open, (value) => {
		if (!value)
			return;
		draft.value = labNodeDraftOf(props.kind, props.sequence);
		fieldError.value = undefined;
	});

	function submit(): void {
		const failure = labNodeDraftError(props.kind, draft.value, props.existing);
		fieldError.value = failure;
		if (failure)
			return;

		emit("submit", labNodePayloadOf(props.kind, draft.value, props.origin));
	}
</script>
