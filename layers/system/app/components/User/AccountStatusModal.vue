<template>
	<!--
		破坏性确认（NMCPS-ARCH-006 §3.7「Modal = 破坏性确认」/ NMCPS-ADR-0017 D7）。
		动作入口在**右栏工具栏**的「记录域」（D5：危险动作不得下行到行内），
		本弹窗只负责「确认这一次写操作」，不再提供状态下拉：
		同一时刻列出三种状态会让「改哪一条、改成什么」出现两处来源。
	-->
	<UModal
		v-model:open="open"
		:title="copy.title"
		:description="account ? copy.description(account.displayName || account.accountName) : undefined"
		:dismissible="!submitting"
		:ui="{ footer: 'justify-end' }"
	>
		<template #body>
			<div v-if="account" class="space-y-4">
				<div class="flex items-center justify-between gap-3 rounded-md border border-(--ui-border) px-3 py-2">
					<span class="text-sm text-(--ui-text-muted)">{{ t("pages.system-user.statusModal.current") }}</span>
					<UBadge :color="accountStatusColor(account.status)" variant="subtle">
						{{ t(accountStatusKey(account.status), { status: account.status }) }}
					</UBadge>
				</div>

				<!-- 上游没有 DELETE 端点：禁用就是「删号」的替代语义，必须明说 -->
				<UAlert
					v-if="targetStatus === ACCOUNT_STATUS.DISABLED"
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
				:color="targetStatus === ACCOUNT_STATUS.DISABLED ? 'error' : 'primary'"
				:label="copy.submit"
				:loading="submitting"
				:disabled="!account"
				@click="submit"
			/>
		</template>
	</UModal>
</template>

<script setup lang="ts">
	import type { AccountStatus, AccountSummary } from "~~/shared/types/account";
	import { ACCOUNT_STATUS } from "~~/shared/types/account";

	/**
	 * 变更账号状态确认（`PUT /api/account/{accountCode}/status`）。
	 *
	 * 设计基准：NMCPS-DESIGN-005 §6.1 / §6.2（layers/content/collections/cn/architecture/2.domain/system.md）
	 * - 上游只有这一个写入口，因此「编辑资料 / 删号」都用它承接（删号 ≡ 禁用）；
	 * - 目标状态由调用方给定（右栏工具栏的「禁用 / 启用」），弹窗不再提供下拉；
	 * - `4`（待激活）由建号时 `mustResetPassword` 决定，`0` / `5` 上游报 `10101`，两者都不出现。
	 */
	const props = defineProps<{
		account: AccountSummary | null
		/** 本次要写入的目标状态（禁用 / 启用） */
		targetStatus: AccountStatus
	}>();

	const emit = defineEmits<{ updated: [] }>();

	const open = defineModel<boolean>("open", { required: true });

	const { t } = useI18n();
	const toast = useToast();
	const { updateStatus } = useAccounts();

	const submitting = ref(false);
	const submitError = ref<string>();

	/** 两种目标状态各一套文案：禁用有删号语义，启用没有 */
	const copy = computed(() => (props.targetStatus === ACCOUNT_STATUS.DISABLED
		? {
			title: t("pages.system-user.statusModal.disableTitle"),
			description: (value: string) => t("pages.system-user.statusModal.disableDescription", { name: value }),
			submit: t("pages.system-user.statusModal.disableSubmit")
		}
		: {
			title: t("pages.system-user.statusModal.enableTitle"),
			description: (value: string) => t("pages.system-user.statusModal.enableDescription", { name: value }),
			submit: t("pages.system-user.statusModal.enableSubmit")
		}));

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
		if (!props.account || submitting.value)
			return;

		// 目标状态与当前一致时没必要发请求（上游会 `ok`，但白改一次没意义）
		if (props.targetStatus === props.account.status) {
			open.value = false;
			return;
		}

		submitting.value = true;
		submitError.value = undefined;

		try {
			await updateStatus(props.account.accountCode, props.targetStatus);
			toast.add({ title: t("pages.system-user.statusModal.success"), color: "success" });
			open.value = false;
			emit("updated");
		} catch (error) {
			submitError.value = describeError(error);
		} finally {
			submitting.value = false;
		}
	}
</script>
