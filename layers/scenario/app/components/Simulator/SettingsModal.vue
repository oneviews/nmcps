<template>
	<!--
		实验台设置（复刻旧「文件 → 设置」里仍属本页的两项，NMCPS-ADR-0022 §六）：
		默认交换机类型 / 默认 OpenFlow / 默认链路属性。语言、主题、显示开关各有归属
		（全局布局与「视图」菜单），这里不再重复一份。
	-->
	<UModal
		v-model:open="open"
		:title="t('pages.scenario-simulator.settings.title')"
		:description="t('pages.scenario-simulator.settings.hint')"
		:ui="{ footer: 'justify-end' }"
	>
		<template #body>
			<div class="space-y-3">
				<UFormField :label="t('pages.scenario-simulator.settings.switchType')">
					<USelect
						v-model="draft.switchType"
						data-testid="lab-settings-switch-type"
						size="sm"
						class="w-full"
						:items="switchTypeItems"
					/>
				</UFormField>

				<UFormField
					:label="t('pages.scenario-simulator.settings.openflow')"
					:help="t('pages.scenario-simulator.settings.openflowHint')"
				>
					<USelect
						v-model="draft.openflow"
						data-testid="lab-settings-openflow"
						size="sm"
						class="w-full"
						:items="openflowItems"
					/>
				</UFormField>

				<div class="space-y-2 border-t border-(--ui-border) pt-2">
					<h3 class="text-xs font-medium">
						{{ t("pages.scenario-simulator.settings.linkTitle") }}
					</h3>
					<p class="text-[11px] text-(--ui-text-muted)">
						{{ t("pages.scenario-simulator.settings.linkHint") }}
					</p>
					<div class="grid grid-cols-2 gap-2">
						<UFormField :label="t('pages.scenario-simulator.settings.bw')">
							<UInput
								v-model.number="draft.link.bw"
								data-testid="lab-settings-bw"
								type="number"
								min="0"
								size="sm"
								class="w-full"
								:placeholder="t('pages.scenario-simulator.settings.unset')"
							/>
						</UFormField>
						<UFormField :label="t('pages.scenario-simulator.settings.delay')">
							<UInput
								v-model.number="draft.link.delay"
								data-testid="lab-settings-delay"
								type="number"
								min="0"
								size="sm"
								class="w-full"
								:placeholder="t('pages.scenario-simulator.settings.unset')"
							/>
						</UFormField>
						<UFormField :label="t('pages.scenario-simulator.settings.jitter')">
							<UInput
								v-model.number="draft.link.jitter"
								data-testid="lab-settings-jitter"
								type="number"
								min="0"
								size="sm"
								class="w-full"
								:placeholder="t('pages.scenario-simulator.settings.unset')"
							/>
						</UFormField>
						<UFormField :label="t('pages.scenario-simulator.settings.loss')">
							<UInput
								v-model.number="draft.link.loss"
								data-testid="lab-settings-loss"
								type="number"
								min="0"
								max="100"
								size="sm"
								class="w-full"
								:placeholder="t('pages.scenario-simulator.settings.unset')"
							/>
						</UFormField>
					</div>
				</div>
			</div>
		</template>

		<template #footer>
			<UButton
				color="neutral"
				variant="ghost"
				:label="t('pages.scenario-simulator.settings.cancel')"
				@click="open = false"
			/>
			<UButton
				data-testid="lab-settings-save"
				color="primary"
				icon="carbon:save"
				:label="t('pages.scenario-simulator.settings.save')"
				@click="save"
			/>
		</template>
	</UModal>
</template>

<script setup lang="ts">
	import type { LabPreferences } from "#layers/scenario/shared/types/labPreferences";
	import { LAB_OPENFLOW_VERSIONS, LAB_SWITCH_TYPES } from "#layers/scenario/shared/types/labNodes";
	import {
		labPreferencesFrom
	} from "#layers/scenario/shared/types/labPreferences";

	/**
	 * 偏好表单：编辑的是**副本**，点「保存」才回传 —— 取消不该悄悄改掉下一页的行为。
	 */
	const props = defineProps<{ preferences: LabPreferences }>();

	const emit = defineEmits<{ save: [preferences: LabPreferences] }>();

	const open = defineModel<boolean>("open", { required: true });

	const { t } = useI18n();

	const draft = ref<LabPreferences>(labPreferencesFrom(props.preferences));

	watch(open, (value) => {
		if (!value)
			return;
		draft.value = labPreferencesFrom(props.preferences);
	});

	const switchTypeItems = computed(() => LAB_SWITCH_TYPES.map((value) => ({ label: value, value })));

	const openflowItems = computed(() => [
		{ label: t("pages.scenario-simulator.settings.openflowAuto"), value: "auto" },
		...LAB_OPENFLOW_VERSIONS.map((value) => ({ label: value, value }))
	]);

	/**
	 * 数字输入清空后 `v-model.number` 给的是空串：归一化时要变回 `null`，
	 * 否则 `0` 会被当成「带宽 0」发给上游（那是限速到零，不是「不设置」）。
	 */
	function save(): void {
		emit("save", labPreferencesFrom(draft.value));
		open.value = false;
	}
</script>
