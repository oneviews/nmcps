<template>
	<LayoutTile
		:title="$t('pages.user-security.title')"
		:description="$t('pages.user-security.description')"
	>
		<div class="space-y-6">
			<!-- 未登录引导态：设置页不做硬跳转，避免打断浏览（写操作本身由 BFF 401 拦住） -->
			<UAlert
				v-if="loaded && !isAuthenticated"
				color="warning"
				variant="subtle"
				icon="carbon:warning-alt"
				:title="$t('pages.user-security.loginRequired')"
				:description="$t('pages.user-security.loginRequiredHint')"
			>
				<template #actions>
					<UButton
						size="sm"
						:label="$t('auth.login')"
						to="/auth/login?redirect=/user/security"
					/>
				</template>
			</UAlert>

			<UAlert
				v-else-if="isAuthenticated"
				color="neutral"
				variant="subtle"
				icon="carbon:user-avatar"
				:title="$t('pages.user-security.account')"
				:description="displayName || user?.username || ''"
			/>

			<!-- 两步验证：新代 iam 无 MFA 端点（NMCPS-ADR-0018 缺口 G8），绑定/确认流程整体下线 -->
			<UAlert
				color="neutral"
				variant="subtle"
				icon="carbon:two-factor-authentication"
				:title="$t('pages.user-security.mfaTitle')"
				:description="$t('pages.user-security.mfaUnavailable')"
				data-testid="mfa-unavailable"
			/>

			<!-- 修改口令 -->
			<UCard :ui="{ root: 'rounded-lg' }">
				<template #header>
					<div class="space-y-1">
						<h2 class="text-base font-semibold">
							{{ $t("pages.user-security.passwordTitle") }}
						</h2>
						<p class="text-sm text-(--ui-text-muted)">
							{{ $t("pages.user-security.passwordHint") }}
						</p>
					</div>
				</template>

				<UForm :state="passwordState" :schema="passwordSchema" class="space-y-4" @submit="submitPassword">
					<UFormField :label="$t('pages.user-security.oldPassword')" name="oldPassword">
						<UInput
							v-model="passwordState.oldPassword"
							type="password"
							autocomplete="current-password"
							:placeholder="$t('pages.user-security.oldPasswordPlaceholder')"
							size="lg"
							class="w-full"
							:disabled="!isAuthenticated"
							data-testid="old-password"
						/>
					</UFormField>

					<UFormField :label="$t('pages.user-security.newPassword')" name="newPassword">
						<UInput
							v-model="passwordState.newPassword"
							type="password"
							autocomplete="new-password"
							:placeholder="$t('pages.user-security.newPasswordPlaceholder')"
							size="lg"
							class="w-full"
							:disabled="!isAuthenticated"
							data-testid="new-password"
						/>
					</UFormField>

					<UFormField :label="$t('pages.user-security.confirmPassword')" name="confirmPassword">
						<UInput
							v-model="passwordState.confirmPassword"
							type="password"
							autocomplete="new-password"
							:placeholder="$t('pages.user-security.confirmPasswordPlaceholder')"
							size="lg"
							class="w-full"
							:disabled="!isAuthenticated"
							data-testid="confirm-password"
						/>
					</UFormField>

					<div class="flex justify-end">
						<UButton
							type="submit"
							size="lg"
							:disabled="!isAuthenticated"
							:loading="submittingPassword"
							:label="submittingPassword ? $t('pages.user-security.passwordSubmitting') : $t('pages.user-security.passwordSubmit')"
						/>
					</div>
				</UForm>
			</UCard>
		</div>
	</LayoutTile>
</template>

<script setup lang="ts">
	definePageMeta({ sort: 4, icon: "carbon:security" });

	const { t } = useI18n();
	const toast = useToast();

	const {
		user,
		displayName,
		isAuthenticated,
		/** 会话是否问过（首屏避免闪出「请先登录」） */
		loaded,
		fetchSession,
		changePassword
	} = useAuth();

	onMounted(() => {
		void fetchSession();
	});

	/** 上游业务码 → 本地化文案（未知码回落上游 message，不吞信息） */
	function describeError(error: unknown): string {
		if (error instanceof ApiError) {
			// 上游未配置 / 掉线 / 超时是运维问题，不是口令问题：给与登录页同一条修复指引（NMCPS-ARCH-003 §7.7）
			const hint = upstreamHintKey(error);
			if (hint)
				return t(hint);
			// 新代旧口令错误统一 10003（实测 HTTP 200 + 该码，BFF 已还原为 400）
			if (error.code === 10003 || error.code === 401)
				return t("pages.user-security.oldPasswordInvalid");
			if (isUnauthorizedCode(error.code))
				return t("pages.user-security.sessionExpired");
			if (error.message)
				return error.message;
		}

		return t("pages.user-security.failed");
	}

	function notifyError(error: unknown): void {
		toast.add({ title: t("pages.user-security.failed"), description: describeError(error), color: "error" });
	}

	// ── 修改口令 ──
	const submittingPassword = ref(false);

	const passwordSchema = z.object({
		oldPassword: z.string().min(1, t("pages.user-security.oldPasswordRequired")),
		newPassword: z.string()
			.min(1, t("pages.user-security.newPasswordRequired"))
			.min(8, t("pages.user-security.newPasswordTooShort")),
		confirmPassword: z.string().min(1, t("pages.user-security.confirmPasswordRequired"))
	})
		.refine((data) => data.newPassword !== data.oldPassword, {
			error: t("pages.user-security.newPasswordSame"),
			path: ["newPassword"]
		})
		.refine((data) => data.newPassword === data.confirmPassword, {
			error: t("pages.user-security.confirmPasswordMismatch"),
			path: ["confirmPassword"]
		});

	type PasswordSchema = zInfer<typeof passwordSchema>;

	const passwordState = reactive<PasswordSchema>({
		oldPassword: "",
		newPassword: "",
		confirmPassword: ""
	});

	async function submitPassword(): Promise<void> {
		if (submittingPassword.value)
			return;

		submittingPassword.value = true;

		try {
			await changePassword(passwordState.newPassword, passwordState.oldPassword);
			toast.add({ title: t("pages.user-security.passwordChanged"), color: "success" });
			passwordState.oldPassword = "";
			passwordState.newPassword = "";
			passwordState.confirmPassword = "";
		} catch (error) {
			notifyError(error);
		} finally {
			submittingPassword.value = false;
		}
	}
</script>
