<template>
	<!--
		删除确认（NMCPS-ARCH-006 §3.7「Modal = 破坏性确认」/ NMCPS-ADR-0017 D7）。
		动作入口在**右栏工具栏**（记录域动作不下行到行内，D5），本弹窗只确认这一次写操作。

		两条文案不是客套话，都是实测事实（NMCPS-REC-005）：
		- `is_system: true` **不是保护**：`DELETE` 对种子策略同样返回成功（UP-RBAC-02）；
		- 策略与角色的关系在独立资源 `role-policies` 上，删策略会留下孤儿关系行（UP-RBAC-10）。
	-->
	<UModal
		v-model:open="open"
		:title="t('pages.system-policy.deleteModal.title')"
		:description="policy ? t('pages.system-policy.deleteModal.description', { name: policy.name, code: policy.code }) : undefined"
		:dismissible="!submitting"
		:ui="{ footer: 'justify-end' }"
	>
		<template #body>
			<div v-if="policy" class="space-y-4">
				<UAlert
					v-if="policy.is_system"
					color="error"
					variant="subtle"
					icon="carbon:warning-alt"
					:title="t('pages.system-policy.deleteModal.systemTitle')"
					:description="t('pages.system-policy.deleteModal.systemHint')"
				/>
				<UAlert
					v-else
					color="warning"
					variant="subtle"
					icon="carbon:warning-alt"
					:description="t('pages.system-policy.deleteModal.hint')"
				/>

				<UAlert
					v-if="submitError"
					color="error"
					variant="subtle"
					icon="carbon:warning-alt"
					:title="t('pages.system-policy.deleteModal.failed')"
					:description="submitError"
				/>
			</div>
		</template>

		<template #footer>
			<UButton
				color="neutral"
				variant="ghost"
				:label="t('pages.system-policy.deleteModal.cancel')"
				:disabled="submitting"
				@click="open = false"
			/>
			<UButton
				color="error"
				:label="t('pages.system-policy.deleteModal.submit')"
				:loading="submitting"
				:disabled="!policy"
				@click="submit"
			/>
		</template>
	</UModal>
</template>

<script setup lang="ts">
	import type { IamPolicy } from "~~/shared/types/policy";

	/**
	 * 删除策略确认（`DELETE /api/iam/policies/{id}`）。
	 *
	 * 设计基准：NMCPS-DESIGN-005 §7.3 第 3 条（系统策略不禁用删除入口，但确认弹窗必须写明
	 * 「上游不保护系统策略，删除后不可恢复」）、§7.4（删除失败可能是 `200 {code:400}`）。
	 */
	const props = defineProps<{ policy: IamPolicy | null }>();

	const emit = defineEmits<{ deleted: [] }>();

	const open = defineModel<boolean>("open", { required: true });

	const { t } = useI18n();
	const toast = useToast();
	const { remove } = usePolicies();

	const submitting = ref(false);
	const submitError = ref<string>();

	watch(open, (value) => {
		if (value)
			submitError.value = undefined;
	});

	function describeError(error: unknown): string {
		const key = policyErrorKey(error, "pages.system-policy");
		if (key)
			return t(key);

		return error instanceof ApiError && error.message
			? error.message
			: t("pages.system-policy.errors.failed");
	}

	async function submit(): Promise<void> {
		if (!props.policy || submitting.value)
			return;

		submitting.value = true;
		submitError.value = undefined;

		try {
			await remove(props.policy.id);
			toast.add({ title: t("pages.system-policy.deleteModal.success"), color: "success" });
			open.value = false;
			emit("deleted");
		} catch (error) {
			submitError.value = describeError(error);
		} finally {
			submitting.value = false;
		}
	}
</script>
