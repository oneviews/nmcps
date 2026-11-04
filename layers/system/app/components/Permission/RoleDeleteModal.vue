<template>
	<!--
		删除确认（NMCPS-ARCH-006 §3.7「Modal = 破坏性确认」/ NMCPS-ADR-0017 D7）。
		动作入口在**右栏工具栏**（记录域动作不下行到行内，D5），本弹窗只确认这一次写操作。

		两条文案不是客套话，都是实测事实（NMCPS-REC-005）：
		- `is_system: true` **不是保护**：`DELETE` 对种子角色同样返回成功（UP-RBAC-02）；
		- 角色与策略 / 用户的关系在独立资源上（`role-policies` / `subject-roles`），
			删角色会留下孤儿关系行（UP-RBAC-10），上游没有恢复端点。
	-->
	<UModal
		v-model:open="open"
		:title="t('pages.system-permission.deleteModal.title')"
		:description="role ? t('pages.system-permission.deleteModal.description', { name: role.name }) : undefined"
		:dismissible="!submitting"
		:ui="{ footer: 'justify-end' }"
	>
		<template #body>
			<div v-if="role" class="space-y-4">
				<div class="flex items-center justify-between gap-3 rounded-md border border-(--ui-border) px-3 py-2">
					<span class="font-mono text-xs">{{ role.code }}</span>
					<UBadge :color="role.is_system ? 'neutral' : 'primary'" variant="subtle">
						{{ role.is_system ? t("pages.system-permission.systemBadge") : t("pages.system-permission.customBadge") }}
					</UBadge>
				</div>

				<UAlert
					v-if="role.is_system"
					color="error"
					variant="subtle"
					icon="carbon:warning-alt"
					:title="t('pages.system-permission.deleteModal.systemTitle')"
					:description="t('pages.system-permission.deleteModal.systemHint')"
				/>
				<UAlert
					v-else
					color="warning"
					variant="subtle"
					icon="carbon:information"
					:description="t('pages.system-permission.deleteModal.hint')"
				/>

				<UAlert
					v-if="submitError"
					color="error"
					variant="subtle"
					icon="carbon:warning-alt"
					:title="t('pages.system-permission.deleteModal.failed')"
					:description="submitError"
				/>
			</div>
		</template>

		<template #footer>
			<UButton
				color="neutral"
				variant="ghost"
				:label="t('pages.system-permission.deleteModal.cancel')"
				:disabled="submitting"
				@click="open = false"
			/>
			<UButton
				color="error"
				:label="t('pages.system-permission.deleteModal.submit')"
				:loading="submitting"
				:disabled="!role"
				@click="submit"
			/>
		</template>
	</UModal>
</template>

<script setup lang="ts">
	import type { IamRole } from "~~/shared/types/policy";

	/**
		* 删除角色确认（`DELETE /api/iam/roles/{id}`）。
		*
		* 设计基准：NMCPS-DESIGN-005 §8.3 第 3 条（删除系统角色前弹确认，文案写明「上游不保护系统对象」）、
		* §8.4（删除失败可能是 `200 {code:400}`）。
		*
		* 系统角色不禁用删除入口：上游对 `is_system` 没有保护（UP-RBAC-02），
		* 假装拦一道只会让用户以为「界面坏了」。
		*/
	const props = defineProps<{ role: IamRole | null }>();

	const emit = defineEmits<{ deleted: [] }>();

	const open = defineModel<boolean>("open", { required: true });

	const { t } = useI18n();
	const toast = useToast();
	const { deleteRole } = usePermissions();

	const submitting = ref(false);
	const submitError = ref<string>();

	watch(open, (value) => {
		if (value)
			submitError.value = undefined;
	});

	function describeError(error: unknown): string {
		const key = policyErrorKey(error, "pages.system-permission");
		if (key)
			return t(key);

		return error instanceof ApiError && error.message
			? error.message
			: t("pages.system-permission.errors.failed");
	}

	async function submit(): Promise<void> {
		if (!props.role || submitting.value)
			return;

		submitting.value = true;
		submitError.value = undefined;

		try {
			await deleteRole(props.role.id);
			toast.add({ title: t("pages.system-permission.deleteModal.success"), color: "success" });
			open.value = false;
			emit("deleted");
		} catch (error) {
			submitError.value = describeError(error);
		} finally {
			submitting.value = false;
		}
	}
</script>
