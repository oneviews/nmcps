<template>
	<!--
		破坏性确认（NMCPS-ARCH-006 §3.7「Modal = 破坏性确认」/ NMCPS-ADR-0017 D7）。
		动作入口在**右栏工具栏**的「记录域」（D5：危险动作不得下行到行内），
		本弹窗只负责「确认这一次写操作」，不再提供状态下拉：
		同一时刻列出多种状态会让「改哪一条、改成什么」出现两处来源。

		两种模式共用一个确认壳（`mode`）：
		- `status`：启用 ↔ 禁用（`PUT /iam/users/{id}`），禁用即「停用登录」；
		- `delete`：真删号（`DELETE /iam/users/{id}`，软删 `deleted_at`）——新代才有这个端点，
		旧代缺口 `UP-ACC-04` 已闭环，所以这里不再把「禁用」当成删号的唯一替代。
	-->
	<UModal
		v-model:open="open"
		:title="copy.title"
		:description="user ? copy.description(user.display_name || user.username) : undefined"
		:dismissible="!submitting"
		:ui="{ footer: 'justify-end' }"
	>
		<template #body>
			<div v-if="user" class="space-y-4">
				<div class="flex items-center justify-between gap-3 rounded-md border border-(--ui-border) px-3 py-2">
					<span class="text-sm text-(--ui-text-muted)">{{ t("pages.system-user.statusModal.current") }}</span>
					<UBadge :color="accountStatusColor(user.status)" variant="subtle">
						{{ t(accountStatusKey(user.status), { status: user.status }) }}
					</UBadge>
				</div>

				<UAlert
					v-if="mode === 'delete'"
					color="error"
					variant="subtle"
					icon="carbon:trash-can"
					:description="t('pages.system-user.statusModal.deleteHint')"
				/>

				<UAlert
					v-else-if="targetStatus === IAM_USER_STATUS.DISABLED"
					color="warning"
					variant="subtle"
					icon="carbon:information"
					:description="t('pages.system-user.statusModal.disableHint')"
				/>

				<UAlert
					v-if="submitError"
					color="error"
					variant="subtle"
					icon="carbon:warning-alt"
					:title="t('pages.system-user.statusModal.failed')"
					:description="submitError"
				/>
			</div>
		</template>

		<template #footer>
			<UButton
				color="neutral"
				variant="ghost"
				:label="t('pages.system-user.statusModal.cancel')"
				:disabled="submitting"
				@click="open = false"
			/>
			<UButton
				:color="mode === 'delete' || targetStatus === IAM_USER_STATUS.DISABLED ? 'error' : 'primary'"
				:label="copy.submit"
				:loading="submitting"
				:disabled="!user"
				@click="submit"
			/>
		</template>
	</UModal>
</template>

<script setup lang="ts">
	import type { IamUser } from "~~/shared/types/account";
	import { IAM_USER_STATUS } from "~~/shared/types/account";

	/**
	 * 用户写操作确认：改状态（`PUT /api/iam/users/{id}`）或删号（`DELETE /api/iam/users/{id}`）。
	 *
	 * 设计基准：NMCPS-ADR-0018 §4.2（`PUT /account/{code}/status` → `PUT /iam/users/{id}`，
	 * 并新增 `DELETE /iam/users/{id}`）。
	 * - 目标状态由调用方给定（右栏工具栏的「禁用 / 启用」），弹窗不再提供下拉；
	 * - 新代状态是字符串 `active` / `disabled` / `locked`：`locked` 由上游在失败登录时置位，页面不写。
	 */
	const props = defineProps<{
		user: IamUser | null
		/** `status`：启用 ↔ 禁用；`delete`：软删该账号 */
		mode: "status" | "delete"
	}>();

	const emit = defineEmits<{ updated: [] }>();

	const open = defineModel<boolean>("open", { required: true });

	const { t } = useI18n();
	const toast = useToast();
	const { updateStatus, remove } = useAccounts();

	const submitting = ref(false);
	const submitError = ref<string>();

	/**
	 * 状态模式下的目标状态：`active` → `disabled`，其余 → `active`。
	 * 已锁定（`locked`）的账号同样按「启用」处理：让用户从锁定态恢复是运维诉求。
	 */
	const targetStatus = computed<string>(() =>
		props.user?.status === IAM_USER_STATUS.ACTIVE ? IAM_USER_STATUS.DISABLED : IAM_USER_STATUS.ACTIVE);

	/** 三种模式各一套文案：删号最重，禁用次之，启用无风险 */
	const copy = computed(() => {
		if (props.mode === "delete") {
			return {
				title: t("pages.system-user.statusModal.deleteTitle"),
				description: (value: string) => t("pages.system-user.statusModal.deleteDescription", { name: value }),
				submit: t("pages.system-user.statusModal.deleteSubmit")
			};
		}

		return props.user?.status === IAM_USER_STATUS.ACTIVE
			? {
				title: t("pages.system-user.statusModal.disableTitle"),
				description: (value: string) => t("pages.system-user.statusModal.disableDescription", { name: value }),
				submit: t("pages.system-user.statusModal.disableSubmit")
			}
			: {
				title: t("pages.system-user.statusModal.enableTitle"),
				description: (value: string) => t("pages.system-user.statusModal.enableDescription", { name: value }),
				submit: t("pages.system-user.statusModal.enableSubmit")
			};
	});

	watch(open, (value) => {
		if (value)
			submitError.value = undefined;
	});

	function describeError(error: unknown): string {
		const key = accountErrorKey(error);
		if (key)
			return t(key);

		return error instanceof ApiError && error.message
			? error.message
			: t("pages.system-user.errors.failed");
	}

	async function submit(): Promise<void> {
		if (!props.user || submitting.value)
			return;

		// 状态模式：目标与当前一致时没必要发请求（上游会 `ok`，但白改一次没意义）
		if (props.mode === "status" && props.user.status === targetStatus.value) {
			open.value = false;
			return;
		}

		submitting.value = true;
		submitError.value = undefined;

		try {
			if (props.mode === "delete")
				await remove(props.user.id);
			else
				await updateStatus(props.user.id, targetStatus.value);

			toast.add({
				title: t(props.mode === "delete"
					? "pages.system-user.statusModal.deleteSuccess"
					: "pages.system-user.statusModal.success"),
				color: "success"
			});
			open.value = false;
			emit("updated");
		} catch (error) {
			submitError.value = describeError(error);
		} finally {
			submitting.value = false;
		}
	}
</script>
