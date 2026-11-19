<template>
	<!--
		生成拓扑（复刻旧 `Side.vue`「生成拓扑」+ `TopologyForm.vue`，NMCPS-ADR-0022 §六 / W4）：
		三种预置形状，数量与控制器由用户选；表单只做「确定错」的校验，
		节点与链路由页面按计划串行创建（上游单网络只允许一个在途写操作）。
	-->
	<UModal
		v-model:open="open"
		:title="t('pages.scenario-simulator.generate.title')"
		:description="t('pages.scenario-simulator.generate.hint')"
		:dismissible="!submitting"
		:ui="{ footer: 'justify-end' }"
	>
		<template #body>
			<div class="space-y-3">
				<UFormField :label="t('pages.scenario-simulator.generate.shape')">
					<USelect
						v-model="draft.shape"
						data-testid="lab-generate-shape"
						size="sm"
						class="w-full"
						:items="shapeItems"
					/>
				</UFormField>

				<UFormField
					v-if="draft.shape === 'single'"
					:label="t('pages.scenario-simulator.generate.hosts')"
					:error="countError"
					required
				>
					<UInput
						v-model.number="draft.hosts"
						data-testid="lab-generate-hosts"
						type="number"
						min="1"
						size="sm"
						class="w-full"
					/>
				</UFormField>

				<template v-if="draft.shape === 'linear'">
					<UFormField
						:label="t('pages.scenario-simulator.generate.switches')"
						:error="countError"
						required
					>
						<UInput
							v-model.number="draft.switches"
							data-testid="lab-generate-switches"
							type="number"
							min="1"
							size="sm"
							class="w-full"
						/>
					</UFormField>
					<UFormField
						:label="t('pages.scenario-simulator.generate.hostsPerSwitch')"
						:error="countError"
						required
					>
						<UInput
							v-model.number="draft.hostsPerSwitch"
							data-testid="lab-generate-hosts-per-switch"
							type="number"
							min="1"
							size="sm"
							class="w-full"
						/>
					</UFormField>
				</template>

				<template v-if="draft.shape === 'tree'">
					<UFormField
						:label="t('pages.scenario-simulator.generate.layers')"
						:error="countError"
						required
					>
						<UInput
							v-model.number="draft.layers"
							data-testid="lab-generate-layers"
							type="number"
							min="1"
							size="sm"
							class="w-full"
						/>
					</UFormField>
					<UFormField
						:label="t('pages.scenario-simulator.generate.fanout')"
						:error="countError"
						required
					>
						<UInput
							v-model.number="draft.fanout"
							data-testid="lab-generate-fanout"
							type="number"
							min="1"
							size="sm"
							class="w-full"
						/>
					</UFormField>
				</template>

				<UFormField :label="t('pages.scenario-simulator.generate.controller')">
					<USelect
						v-model="draft.controller"
						data-testid="lab-generate-controller"
						size="sm"
						class="w-full"
						:items="controllerItems"
					/>
				</UFormField>

				<p data-testid="lab-generate-summary" class="text-[11px] text-(--ui-text-muted)">
					{{ t('pages.scenario-simulator.generate.summary', { count: nodeCount }) }}
				</p>

				<UAlert
					v-if="error"
					data-testid="lab-generate-error"
					color="error"
					variant="subtle"
					icon="carbon:warning-alt"
					:title="t('pages.scenario-simulator.generate.failed')"
					:description="error"
				/>
			</div>
		</template>

		<template #footer>
			<UButton
				color="neutral"
				variant="ghost"
				:label="t('pages.scenario-simulator.generate.cancel')"
				:disabled="submitting"
				@click="open = false"
			/>
			<UButton
				data-testid="lab-generate-submit"
				color="primary"
				icon="carbon:chemistry"
				:label="t('pages.scenario-simulator.generate.submit')"
				:loading="submitting"
				@click="submit"
			/>
		</template>
	</UModal>
</template>

<script setup lang="ts">
	import type { LabGenerateDraft } from "#layers/scenario/shared/types/labGenerate";
	import {
		LAB_TOPOLOGY_SHAPES,
		labGenerateDraftOf,
		labGenerateError,
		labGenerateNodeCount
	} from "#layers/scenario/shared/types/labGenerate";

	/**
	 * 生成拓扑表单：形状 + 数量 + 控制器。
	 *
	 * 本地只校验数量（正整数、总数上限），重名由计划生成器错开序号，
	 * 控制器是否存在仍归上游（`POST /switches` 对未知控制器回 400）。
	 */
	const props = defineProps<{
		/** 台账里已有的控制器 id（空 = 不关联） */
		controllers: readonly string[]
		submitting?: boolean
		error?: string
	}>();

	const emit = defineEmits<{ submit: [draft: LabGenerateDraft] }>();

	const open = defineModel<boolean>("open", { required: true });

	const { t } = useI18n();

	const draft = ref<LabGenerateDraft>(labGenerateDraftOf());

	const shapeItems = computed(() => LAB_TOPOLOGY_SHAPES.map((shape) => ({
		label: t(`pages.scenario-simulator.generate.shapes.${shape}`),
		value: shape
	})));

	const controllerItems = computed(() => [
		{ label: t("pages.scenario-simulator.generate.noController"), value: "" },
		...props.controllers.map((id) => ({ label: id, value: id }))
	]);

	const nodeCount = computed(() => labGenerateNodeCount(draft.value));

	/** 数量区的就地报错：两条校验共用一个错误位（同一次提交只可能命中其中一条） */
	const countError = computed(() => {
		const failure = labGenerateError(draft.value);
		return failure
			? t(`pages.scenario-simulator.generate.errors.${failure}`)
			: undefined;
	});

	// 每次打开都重新起一份草稿：上一次取消时的半成品不该串到下一次
	watch(open, (value) => {
		if (!value)
			return;
		draft.value = labGenerateDraftOf();
	});

	function submit(): void {
		if (labGenerateError(draft.value))
			return;
		emit("submit", { ...draft.value });
	}
</script>
