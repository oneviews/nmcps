<template>
	<!--
		停止 / 重启网络确认（NMCPS-ADR-0022 W3）：`POST /stop` 的唯一入口。

		它不是普通写操作：上游会终止全部节点进程、跑 `mn -c`，再按台账重建一套**未启动**的
		拓扑对象。节点与链路不丢，但正在跑的 ping / 抓包 / 终端全部失效 —— 所以按一次要确认。

		重启 = 停止 + 启动，第一步就是这条 `POST /stop`，后果完全一致，因此共用同一个弹窗，
		只换标题 / 说明 / 确认按钮与失败标题（`mode`）。
	-->
	<UModal
		v-model:open="open"
		:title="t(`pages.scenario-simulator.run.${intent}Title`)"
		:description="t(`pages.scenario-simulator.run.${intent}Body`)"
		:dismissible="!submitting"
		:ui="{ footer: 'justify-end' }"
	>
		<template #body>
			<UAlert
				v-if="error"
				data-testid="mininet-run-stop-failed"
				color="error"
				variant="subtle"
				icon="carbon:warning-alt"
				:title="t(`pages.scenario-simulator.run.${intent}Failed`)"
				:description="error"
			/>
		</template>

		<template #footer>
			<UButton
				color="neutral"
				variant="ghost"
				:label="t('pages.scenario-simulator.run.stopCancel')"
				:disabled="submitting"
				@click="open = false"
			/>
			<UButton
				data-testid="mininet-run-stop-confirm"
				color="error"
				:label="t(`pages.scenario-simulator.run.${intent}Confirm`)"
				:loading="submitting"
				@click="emit('confirm')"
			/>
		</template>
	</UModal>
</template>

<script setup lang="ts">
	/**
	 * 停网 / 重启确认弹窗。
	 *
	 * 与 `DeleteTargetModal` / `ClearFlowsModal` 分开写：那两个针对「某个台账对象」，
	 * 这个针对「整个网络进程」，文案里没有 id 可写，只有后果说明。
	 */
	const props = withDefaults(defineProps<{
		/** `stop` = 停网；`restart` = 停止后立刻启动（同一条 `POST /stop` 前置） */
		mode?: "stop" | "restart"
		submitting?: boolean
		/** 上游失败原话（409 在途 / 503 通道…），逐字展示，不翻译 */
		error?: string
	}>(), { mode: "stop" });

	const emit = defineEmits<{ confirm: [] }>();

	const open = defineModel<boolean>("open", { required: true });

	const { t } = useI18n();

	/** 这次弹窗讲的是「停止」还是「重启」：两组文案只差键后缀 */
	const intent = computed(() => (props.mode === "restart" ? "restart" : "stop"));
</script>
