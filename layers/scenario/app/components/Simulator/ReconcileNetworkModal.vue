<template>
	<!--
		台账对账确认（NMCPS-ADR-0023）：`POST /api/lab/networks/{id}/sync` 的唯一入口。

		这条不改上游，只把台账清单整体重写成上游此刻的事实 —— 清单外冒出来的节点会被
		「接管」进租户边界，上游已删掉的 id 会被清掉。与破坏性重建同档：双权限位 +
		逐字输入网络 ID，BFF 侧同一个值（`{ confirm: "<id>" }`）是硬闸门。
	-->
	<UModal
		v-model:open="open"
		:title="t('pages.scenario-simulator.reconcile.title')"
		:description="t('pages.scenario-simulator.reconcile.summary', { id: networkId ?? '' })"
		:dismissible="!submitting"
		:ui="{ footer: 'justify-end' }"
	>
		<template #body>
			<div class="space-y-3">
				<UAlert
					color="warning"
					variant="subtle"
					icon="carbon:data-check"
					:title="t('pages.scenario-simulator.reconcile.title')"
					:description="t('pages.scenario-simulator.reconcile.body')"
				/>
				<UFormField
					:label="t('pages.scenario-simulator.reconcile.inputLabel')"
					:hint="t('pages.scenario-simulator.reconcile.inputHint', { id: networkId ?? '' })"
					:error="touched && !confirmed ? t('pages.scenario-simulator.reconcile.mismatch') : undefined"
				>
					<UInput
						v-model="typed"
						data-testid="mininet-reconcile-confirm-input"
						size="xs"
						class="w-full"
						:placeholder="t('pages.scenario-simulator.reconcile.placeholder')"
						:disabled="submitting"
						@blur="touched = true"
					/>
				</UFormField>
				<UAlert
					v-if="error"
					data-testid="mininet-reconcile-failed"
					color="error"
					variant="subtle"
					icon="carbon:warning-alt"
					:title="t('pages.scenario-simulator.reconcile.failed')"
					:description="error"
				/>
			</div>
		</template>

		<template #footer>
			<UButton
				color="neutral"
				variant="ghost"
				:label="t('pages.scenario-simulator.reconcile.cancel')"
				:disabled="submitting"
				@click="open = false"
			/>
			<UButton
				data-testid="mininet-reconcile-confirm"
				color="primary"
				:label="t('pages.scenario-simulator.reconcile.confirm')"
				:loading="submitting"
				:disabled="!confirmed"
				@click="emit('confirm', typed.trim())"
			/>
		</template>
	</UModal>
</template>

<script setup lang="ts">
	/**
	 * 台账对账弹窗（NMCPS-ADR-0023 D8）。
	 *
	 * 输入框的取值归组件，但**是否放行由页面与 BFF 再判**：组件只是 UX，
	 * 页面把 `typed` 原样发成 `{ confirm }`，值不匹配时 BFF 回 400
	 * `lab_confirm_required`，失败原话照实显示在这里。
	 */
	const props = defineProps<{
		/** 目标网络 id：写进说明，也是要逐字输入的值 */
		networkId: string | null
		submitting?: boolean
		/** 上游 / BFF 失败原话（400 / 404 / 409 / 503…），逐字展示 */
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
