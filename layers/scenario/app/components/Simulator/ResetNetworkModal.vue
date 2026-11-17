<template>
	<!--
		破坏性重建确认（NMCPS-ADR-0022 W5）：`POST /full_reset` 的唯一入口。

		与停网 / 删节点不同，这条会连既有拓扑一起清掉：上游删除全部节点、链路与流表，
		再按空台账重建。所以确认方式不是「按一个红色按钮」，而是**逐字输入网络 ID** ——
		BFF 侧同一个值（`{ confirm: "<id>" }`）是硬闸门，缺了直接 400 `lab_confirm_required`，
		不触达上游。组件只是把那道闸门提前摆到人眼前：输入不匹配时确认按钮根本不可点。
	-->
	<UModal
		v-model:open="open"
		:title="t('pages.scenario-simulator.reset.title')"
		:description="t('pages.scenario-simulator.reset.summary', { id: networkId ?? '' })"
		:dismissible="!submitting"
		:ui="{ footer: 'justify-end' }"
	>
		<template #body>
			<div class="space-y-3">
				<UAlert
					color="error"
					variant="subtle"
					icon="carbon:warning-alt"
					:title="t('pages.scenario-simulator.reset.title')"
					:description="t('pages.scenario-simulator.reset.body')"
				/>
				<UFormField
					:label="t('pages.scenario-simulator.reset.inputLabel')"
					:hint="t('pages.scenario-simulator.reset.inputHint', { id: networkId ?? '' })"
					:error="touched && !confirmed ? t('pages.scenario-simulator.reset.mismatch') : undefined"
				>
					<UInput
						v-model="typed"
						data-testid="mininet-reset-confirm-input"
						size="xs"
						class="w-full"
						:placeholder="t('pages.scenario-simulator.reset.placeholder')"
						:disabled="submitting"
						@blur="touched = true"
					/>
				</UFormField>
				<UAlert
					v-if="error"
					data-testid="mininet-reset-failed"
					color="error"
					variant="subtle"
					icon="carbon:warning-alt"
					:title="t('pages.scenario-simulator.reset.failed')"
					:description="error"
				/>
			</div>
		</template>

		<template #footer>
			<UButton
				color="neutral"
				variant="ghost"
				:label="t('pages.scenario-simulator.reset.cancel')"
				:disabled="submitting"
				@click="open = false"
			/>
			<UButton
				data-testid="mininet-reset-confirm"
				color="error"
				:label="t('pages.scenario-simulator.reset.confirm')"
				:loading="submitting"
				:disabled="!confirmed"
				@click="emit('confirm', typed.trim())"
			/>
		</template>
	</UModal>
</template>

<script setup lang="ts">
	/**
	 * `full_reset` 确认弹窗。
	 *
	 * 输入框的取值归组件（它只服务这一次确认），但**是否放行由页面再判一次**：
	 * 组件只是 UX，BFF 才是边界 —— 页面把 `typed` 原样发成 `{ confirm }`，
	 * 值不匹配时上游闸门会回 400，失败原话照实显示在这里。
	 */
	const props = defineProps<{
		/** 目标网络 id：写进说明，也是要逐字输入的值 */
		networkId: string | null
		submitting?: boolean
		/** 上游失败原话（400 lab_confirm_required / 409 / 503…），逐字展示 */
		error?: string
	}>();

	const emit = defineEmits<{ confirm: [value: string] }>();

	const open = defineModel<boolean>("open", { required: true });

	const { t } = useI18n();

	const typed = ref("");
	/** 失焦后才提示「不一致」：边输边报错会把正常输入过程变成一串错误 */
	const touched = ref(false);

	const confirmed = computed(() => !!props.networkId && typed.value.trim() === props.networkId);

	// 每次重新打开都清空：上一次输对的值不该替下一次确认背书
	watch(open, (value) => {
		if (value) {
			typed.value = "";
			touched.value = false;
		}
	});
</script>
