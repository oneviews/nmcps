<template>
	<!--
		清空流表确认（NMCPS-ADR-0022 W2b）：批量 `DELETE /flows` 的唯一入口。
		文案必须写出交换机 id 并说明不可撤销 —— 上游真跑 `ovs-ofctl del-flows`，
		删掉的流表项不会自己回来。匹配域留空 = 清整表，填了就只删命中项：
		这是上游 `build_flow_match()` 的语义，组件不在这里另发明。
	-->
	<UModal
		v-model:open="open"
		:title="t('pages.scenario-simulator.flows.clearTitle')"
		:description="summary"
		:dismissible="!submitting"
		:ui="{ footer: 'justify-end' }"
	>
		<template #body>
			<div class="space-y-3">
				<UAlert
					color="warning"
					variant="subtle"
					icon="carbon:warning-alt"
					:title="t('pages.scenario-simulator.flows.clearIrreversible')"
					:description="t('pages.scenario-simulator.flows.clearBody', { count: rowCount })"
				/>
				<UFormField
					:label="t('pages.scenario-simulator.flows.clearMatchLabel')"
					:hint="t('pages.scenario-simulator.flows.clearMatchHint')"
					:error="matchError"
				>
					<UInput
						v-model="match"
						data-testid="lab-flow-clear-match"
						size="xs"
						class="w-full"
						:placeholder="t('pages.scenario-simulator.flows.clearMatchPlaceholder')"
					/>
				</UFormField>
				<UAlert
					v-if="error"
					data-testid="lab-flow-clear-failed"
					color="error"
					variant="subtle"
					icon="carbon:warning-alt"
					:title="t('pages.scenario-simulator.flows.clearFailed')"
					:description="error"
				/>
			</div>
		</template>

		<template #footer>
			<UButton
				color="neutral"
				variant="ghost"
				:label="t('pages.scenario-simulator.flows.clearCancel')"
				:disabled="submitting"
				@click="open = false"
			/>
			<UButton
				data-testid="lab-flow-clear-confirm"
				color="error"
				:label="t('pages.scenario-simulator.flows.clearSubmit')"
				:loading="submitting"
				@click="emit('confirm')"
			/>
		</template>
	</UModal>
</template>

<script setup lang="ts">
	/**
	 * 批量删流（`DELETE /flows`）的确认弹窗。
	 *
	 * 与 `DeleteTargetModal` 分开写：那个是「删节点 / 删链路」两种目标的合成，语义是
	 * 「去掉台账里的对象」；这里是「对一个交换机批量删流」，多一个可选匹配域，
	 * 硬塞进同一个组件会让两套文案互相牵制。
	 */
	const props = defineProps<{
		/** 目标交换机 id：写进标题与说明，避免「点了确认不知道清的是谁」 */
		switchId: string | null
		/** 当前读到的流表条数，只用于说明「要删掉多少」 */
		rowCount: number
		submitting?: boolean
		/** 上游失败原话（403 / 404 / 409 / 503…），逐字展示 */
		error?: string
		/** 本地校验报错（`match` 夹带 `actions=`），就地挂在输入框上 */
		matchError?: string
	}>();

	const emit = defineEmits<{ confirm: [] }>();

	const open = defineModel<boolean>("open", { required: true });
	/** 匹配域由页面持有（切交换机时一并重置），组件只负责渲染与回传 */
	const match = defineModel<string>("match", { required: true });

	const { t } = useI18n();

	const summary = computed(() => t("pages.scenario-simulator.flows.clearSummary", {
		id: props.switchId ?? "",
		count: props.rowCount
	}));
</script>
