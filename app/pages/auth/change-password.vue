<!--
	强制改密页（`NMCPS-ARCH-003` §7.2 第 14 条 / §7.8 第 9 项）。

	上游对 `mustResetPassword` 只给标志、不拦接口，所以强制改密完全靠客户端执行：
	登录页收到该标志就把人送到这里，改完立刻登出、用新口令重登 —— 初始口令不上路。
	有意**不带** `firstReset: true`：该字段会跳过旧口令校验（`NMCPS-REC-001` UP-AUTH-02），
	而用户刚用旧口令登录过，让他再填一次即可，不把上游的后门写进前端。
-->
<template>
	<div class="relative flex min-h-svh items-center justify-center overflow-hidden bg-default/50 p-4">
		<DesignTopBlob />
		<DesignBottomBlob />

		<UCard class="relative z-10 w-full max-w-sm">
			<template #header>
				<div class="flex flex-col items-center gap-y-2 text-center">
					<SvgoLogo :filled="true" :font-controlled="false" class="size-14" />
					<h1 class="text-lg font-semibold font-heading">
						{{ $t("auth.resetTitle") }}
					</h1>
					<p class="text-sm text-muted">
						{{ $t("auth.resetDescription") }}
					</p>
				</div>
			</template>

			<UForm :state="state" :schema="schema" class="flex flex-col gap-y-4" @submit="submit">
				<UFormField :label="$t('auth.resetOldPassword')" name="oldPassword">
					<UInput
						v-model="state.oldPassword"
						type="password"
						variant="subtle"
						size="lg"
						autocomplete="current-password"
						:placeholder="$t('auth.passwordPlaceholder')"
						class="w-full"
					/>
				</UFormField>

				<UFormField :label="$t('auth.resetNewPassword')" name="newPassword">
					<UInput
						v-model="state.newPassword"
						type="password"
						variant="subtle"
						size="lg"
						autocomplete="new-password"
						:placeholder="$t('auth.resetNewPasswordPlaceholder')"
						class="w-full"
					/>
				</UFormField>

				<UFormField :label="$t('auth.resetConfirmPassword')" name="confirmPassword">
					<UInput
						v-model="state.confirmPassword"
						type="password"
						variant="subtle"
						size="lg"
						autocomplete="new-password"
						:placeholder="$t('auth.resetConfirmPasswordPlaceholder')"
						class="w-full"
					/>
				</UFormField>

				<UAlert
					v-if="errorMessage"
					color="error"
					variant="subtle"
					icon="carbon:warning-alt"
					:description="errorMessage"
				/>

				<UButton type="submit" size="lg" block :loading="submitting" :disabled="!isConfigured">
					{{ submitting ? $t("auth.resetSubmitting") : $t("auth.resetSubmit") }}
				</UButton>
			</UForm>
		</UCard>
	</div>
</template>

<script setup lang="ts">
	// 同登录页：不套控制台布局
	definePageMeta({
		layout: false,
		hide: true
	});

	const { t } = useI18n();
	const route = useRoute();
	const toast = useToast();
	const { fetchSession, changePassword, logout } = useAuth();
	const { isConfigured } = useApi();

	/** 改完要回到哪儿：只接受站内相对路径（`//host` 会被当成协议相对地址） */
	const redirectTarget = computed(() => {
		const target = route.query.redirect;
		return typeof target === "string" && target.startsWith("/") && !target.startsWith("//")
			? target
			: undefined;
	});

	const schema = z.object({
		oldPassword: z.string().min(1, t("auth.resetOldRequired")),
		newPassword: z.string()
			.min(1, t("auth.resetNewRequired"))
			.min(8, t("auth.resetNewTooShort")),
		confirmPassword: z.string().min(1, t("auth.resetConfirmRequired"))
	})
		.refine((data) => data.newPassword !== data.oldPassword, {
			error: t("auth.resetSameAsOld"),
			path: ["newPassword"]
		})
		.refine((data) => data.newPassword === data.confirmPassword, {
			error: t("auth.resetMismatch"),
			path: ["confirmPassword"]
		});

	type Schema = zInfer<typeof schema>;

	const state = reactive<Schema>({
		oldPassword: "",
		newPassword: "",
		confirmPassword: ""
	});

	const submitting = ref(false);
	const errorMessage = ref<string>();

	/**
	 * 未登录直接进来（手动敲地址 / 改密途中会话过期）：送回登录页并带回跳，
	 * 全局守卫不覆盖 `/auth/**`（`NMCPS-ARCH-003` §7.6），所以这一页自己判。
	 */
	onMounted(async () => {
		const session = await fetchSession(true);
		if (!session.authenticated) {
			await navigateTo({ path: "/auth/login", query: { redirect: "/auth/reset-password" } });
		}
	});

	/** 上游业务码 → 本地化文案（未知码回落原始 message，不吞信息） */
	function describeError(error: unknown): string {
		if (error instanceof ApiError) {
			const hint = upstreamHintKey(error);
			if (hint)
				return t(hint);
			if (error.code === 20201 || error.code === 401)
				return t("auth.resetOldPasswordInvalid");
			// 口令策略在上游：复杂度不足 400 20101，与近期历史重复 400 20302
			if (error.code === 20101)
				return t("auth.resetTooWeak");
			if (error.code === 20302)
				return t("auth.resetReused");
			if (isUnauthorizedCode(error.code))
				return t("auth.resetSessionExpired");
			if (error.message)
				return error.message;
		}

		return t("auth.resetFailed");
	}

	async function submit(): Promise<void> {
		if (submitting.value)
			return;

		submitting.value = true;
		errorMessage.value = undefined;

		try {
			// 第三参刻意不带 `firstReset`：见文件头注释
			await changePassword(state.newPassword, state.oldPassword);

			toast.add({ title: t("auth.resetSuccess"), color: "success" });

			// 强制重登：初始口令已经作废，旧会话不再复用
			await logout();
			await navigateTo({ path: "/auth/login", query: redirectTarget.value ? { redirect: redirectTarget.value } : undefined });
		} catch (error) {
			errorMessage.value = describeError(error);
		} finally {
			submitting.value = false;
		}
	}
</script>
