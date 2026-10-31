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
				:description="displayName || user?.accountName || ''"
			/>

			<!-- 两步验证 -->
			<UCard :ui="{ root: 'rounded-lg' }">
				<template #header>
					<div class="flex items-start justify-between gap-3">
						<div class="space-y-1">
							<h2 class="text-base font-semibold">
								{{ $t("pages.user-security.mfaTitle") }}
							</h2>
							<p class="text-sm text-(--ui-text-muted)">
								{{ $t("pages.user-security.mfaHint") }}
							</p>
						</div>
						<UBadge :color="mfaBadge.color" variant="subtle">
							{{ mfaBadge.label }}
						</UBadge>
					</div>
				</template>

				<div class="space-y-4">
					<!-- 一次性凭证：只存在于本页内存，取消 / 刷新即丢 -->
					<template v-if="otpauthUrl">
						<UFormField :label="$t('pages.user-security.mfaUri')">
							<div class="flex items-center gap-2">
								<UInput
									:model-value="otpauthUrl"
									readonly
									class="min-w-0 flex-1 font-mono text-xs"
									data-testid="mfa-uri"
								/>
								<UButton
									icon="carbon:copy"
									color="neutral"
									variant="subtle"
									:aria-label="$t('pages.user-security.mfaCopy')"
									@click="copyValue(otpauthUrl)"
								/>
							</div>
						</UFormField>

						<UFormField :label="$t('pages.user-security.mfaSecret')">
							<div class="flex items-center gap-2">
								<UInput
									:model-value="mfaSecret"
									readonly
									class="min-w-0 flex-1 font-mono text-xs"
									data-testid="mfa-secret"
								/>
								<UButton
									icon="carbon:copy"
									color="neutral"
									variant="subtle"
									:aria-label="$t('pages.user-security.mfaCopy')"
									@click="copyValue(mfaSecret)"
								/>
							</div>
						</UFormField>

						<p class="text-xs text-(--ui-text-muted)">
							{{ $t("pages.user-security.mfaUriHint") }}
						</p>

						<UForm
							:state="mfaState"
							:schema="mfaSchema"
							class="flex w-full flex-col items-end gap-3 sm:flex-row sm:items-start"
							@submit="submitMfa"
						>
							<UFormField
								:label="$t('pages.user-security.mfaCode')"
								name="mfaCode"
								class="w-full sm:flex-1"
							>
								<UInput
									v-model="mfaState.mfaCode"
									:placeholder="$t('pages.user-security.mfaCodePlaceholder')"
									inputmode="numeric"
									autocomplete="one-time-code"
									maxlength="6"
									size="lg"
									class="w-full"
									data-testid="mfa-code"
								/>
							</UFormField>
							<UButton
								type="submit"
								size="lg"
								:loading="confirming"
								:label="confirming ? $t('pages.user-security.mfaConfirming') : $t('pages.user-security.mfaConfirm')"
							/>
						</UForm>

						<UButton
							color="neutral"
							variant="ghost"
							size="sm"
							:label="$t('pages.user-security.mfaBindCancel')"
							@click="resetBinding"
						/>
					</template>

					<!-- 二次确认：重新绑定会作废已配对的验证器 -->
					<UAlert
						v-else-if="pendingRebind"
						color="warning"
						variant="subtle"
						icon="carbon:warning-alt"
						:title="$t('pages.user-security.mfaBindWarn')"
					>
						<template #actions>
							<UButton
								size="sm"
								color="warning"
								:loading="binding"
								:label="$t('pages.user-security.mfaBindConfirm')"
								@click="startBind"
							/>
							<UButton
								size="sm"
								color="neutral"
								variant="ghost"
								:label="$t('pages.user-security.mfaBindCancel')"
								@click="pendingRebind = false"
							/>
						</template>
					</UAlert>

					<UButton
						v-else
						icon="carbon:qr-code"
						color="primary"
						variant="subtle"
						size="lg"
						:disabled="!isAuthenticated"
						:loading="binding"
						:label="binding
							? $t('pages.user-security.mfaBindGenerating')
							: mfaEnabled === true
								? $t('pages.user-security.mfaRebind')
								: $t('pages.user-security.mfaBind')"
						data-testid="mfa-bind"
						@click="startBind"
					/>
				</div>
			</UCard>
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
		bindMfa,
		confirmMfa,
		changePassword
	} = useAuth();

	onMounted(() => {
		void fetchSession();
	});

	const mfaEnabled = computed(() => user.value?.mfaEnabled ?? null);

	const mfaBadge = computed(() => {
		if (mfaEnabled.value === true)
			return { color: "success" as const, label: t("pages.user-security.mfaEnabled") };
		if (mfaEnabled.value === false)
			return { color: "neutral" as const, label: t("pages.user-security.mfaDisabled") };

		return { color: "neutral" as const, label: t("pages.user-security.mfaUnknown") };
	});

	/** 上游业务码 → 本地化文案（未知码回落上游 message，不吞信息） */
	function describeError(error: unknown): string {
		if (error instanceof ApiError) {
			// 上游未配置 / 掉线 / 超时是运维问题，不是口令问题：给与登录页同一条修复指引（NMCPS-ARCH-003 §7.7）
			const hint = upstreamHintKey(error);
			if (hint)
				return t(hint);
			if (error.code === 20201 || error.code === 401)
				return t("pages.user-security.oldPasswordInvalid");
			if (error.code === 20204)
				return t("pages.user-security.mfaCodeInvalid");
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

	/** 复制：失败（无剪贴板权限 / 非安全上下文）时不静默，提示手动选择文本 */
	async function copyValue(value: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(value);
			toast.add({ title: t("pages.user-security.mfaCopied"), color: "success" });
		} catch {
			toast.add({ title: t("pages.user-security.mfaCopyFailed"), color: "error" });
		}
	}

	// ── 两步验证（TOTP） ──
	const otpauthUrl = ref<string>();
	const pendingRebind = ref(false);
	const binding = ref(false);
	const confirming = ref(false);

	const mfaSchema = z.object({
		mfaCode: z.string().regex(/^\d{6}$/, t("pages.user-security.mfaCodeRequired"))
	});

	const mfaState = reactive<{ mfaCode: string }>({ mfaCode: "" });

	/** 从 `otpauth://` 链接取 `secret`：不引入二维码依赖时，手动录入只能靠它 */
	const mfaSecret = computed(() => {
		if (!otpauthUrl.value)
			return "";

		try {
			return new URL(otpauthUrl.value).searchParams.get("secret") ?? "";
		} catch {
			return "";
		}
	});

	function resetBinding(): void {
		otpauthUrl.value = undefined;
		mfaState.mfaCode = "";
		pendingRebind.value = false;
	}

	/** 已启用时先走二次确认（重新绑定会作废现有验证器），未启用直接生成 */
	async function startBind(): Promise<void> {
		if (mfaEnabled.value === true && !pendingRebind.value) {
			pendingRebind.value = true;
			return;
		}

		binding.value = true;

		try {
			const result = await bindMfa(1);
			otpauthUrl.value = result.otpauthUrl;
			pendingRebind.value = false;
		} catch (error) {
			notifyError(error);
		} finally {
			binding.value = false;
		}
	}

	async function submitMfa(): Promise<void> {
		if (confirming.value)
			return;

		confirming.value = true;

		try {
			await confirmMfa(mfaState.mfaCode);
			toast.add({ title: t("pages.user-security.mfaConfirmed"), color: "success" });
			resetBinding();
		} catch (error) {
			notifyError(error);
		} finally {
			confirming.value = false;
		}
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
