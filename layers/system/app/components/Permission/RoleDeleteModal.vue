<template>
	<!--
		破坏性确认（NMCPS-ARCH-006 §3.7 / NMCPS-ADR-0017 D7）：
		动作入口在右栏工具栏的记录域，弹窗只确认这一次写操作。
	-->
	<UModal
		v-model:open="open"
		:title="t('pages.system-permission.deleteModal.title')"
		:description="role ? t('pages.system-permission.deleteModal.description', { name: role.roleName }) : undefined"
		:dismissible="!submitting"
		:ui="{ footer: 'justify-end' }"
	>
		<template #body>
			<div v-if="role" class="space-y-4">
				<div class="flex items-center justify-between gap-3 rounded-md border border-(--ui-border) px-3 py-2">
					<span class="font-mono text-xs">{{ role.roleCode }}</span>
					<UBadge :color="role.isBuiltin ? 'neutral' : 'primary'" variant="subtle">
						{{ role.isBuiltin ? t("pages.system-permission.isBuiltin") : t("pages.system-permission.isCustom") }}
					</UBadge>
				</div>

				<!-- 删除角色会连带解除该角色的全部授权，且没有「恢复」端点 -->
				<UAlert
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
	import type { RoleSummary } from "~~/shared/types/policy";

	/**
	 * 删除自建角色（`DELETE /api/role/{roleCode}`）。
	 *
	 * 设计基准：NMCPS-DESIGN-005 §8.1（layers/content/collections/cn/architecture/2.domain/system.md）
	 * - 内置角色（`isBuiltin: true`）被上游拒绝（`40303`），因此调用方只在自建角色上提供入口；
	 * - 角色编码即路径段；删除后 `GET /role/{code}` 回 `10301`（实测），列表需重拉。
	 */
	const props = defineProps<{ role: RoleSummary | null }>();

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
			await deleteRole(props.role.roleCode);
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
