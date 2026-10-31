<template>
	<div class="relative flex min-h-svh items-center justify-center overflow-hidden bg-default/50 p-4">
		<DesignTopBlob />
		<DesignBottomBlob />

		<UCard class="relative z-10 w-full max-w-sm">
			<template #header>
				<div class="flex flex-col items-center gap-y-2 text-center">
					<SvgoLogo :filled="true" :font-controlled="false" class="size-14" />
					<h1 class="text-lg font-semibold font-heading">
						{{ $t("auth.title") }}
					</h1>
					<p class="text-sm text-muted">
						{{ $t("auth.description") }}
					</p>
				</div>
			</template>

			<div class="mb-4 flex flex-col gap-y-2">
				<div class="flex items-center justify-between gap-2">
					<span class="text-xs font-medium text-muted">{{ $t("auth.demo.title") }}</span>
					<div class="flex gap-1">
						<UButton
							v-for="account in DEMO_ACCOUNTS"
							:key="account.id"
							type="button"
							size="xs"
							:color="activeDemoId === account.id ? 'primary' : 'neutral'"
							:variant="activeDemoId === account.id ? 'solid' : 'subtle'"
							@click="applyDemoAccount(account)"
						>
							{{ $t(account.labelKey) }}
						</UButton>
					</div>
				</div>
				<p class="text-xs text-muted">
					{{ $t("auth.demo.hint") }}
				</p>
			</div>

			<UForm :state="state" :schema="schema" class="flex flex-col gap-y-4" @submit="submit">
				<UFormField :label="$t('auth.accountName')" name="accountName">
					<UInput
						v-model="state.accountName"
						variant="subtle"
						size="lg"
						autocomplete="username"
						:placeholder="$t('auth.accountNamePlaceholder')"
						class="w-full"
					/>
				</UFormField>

				<UFormField :label="$t('auth.password')" name="password">
					<UInput
						v-model="state.password"
						type="password"
						variant="subtle"
						size="lg"
						autocomplete="current-password"
						:placeholder="$t('auth.passwordPlaceholder')"
						class="w-full"
					/>
				</UFormField>

				<UFormField :label="$t('auth.tenantCode')" name="tenantCode">
					<UInput
						v-model="state.tenantCode"
						variant="subtle"
						size="lg"
						autocomplete="off"
						:placeholder="$t('auth.tenantCodePlaceholder')"
						class="w-full"
					/>
				</UFormField>

				<UFormField v-if="mfaRequired" :label="$t('auth.mfaCode')" name="mfaCode">
					<UInput
						v-model="state.mfaCode"
						variant="subtle"
						size="lg"
						autocomplete="one-time-code"
						inputmode="numeric"
						:placeholder="$t('auth.mfaCodePlaceholder')"
						class="w-full"
					/>
				</UFormField>

				<UAlert
					v-if="mfaRequired"
					color="info"
					variant="subtle"
					icon="carbon:security"
					:description="$t('auth.mfaHint')"
				/>

				<UAlert
					v-if="mustResetPassword"
					color="warning"
					variant="subtle"
					icon="carbon:password"
					:description="$t('auth.resetRequired')"
				/>

				<UAlert
					v-if="upstreamMissing"
					color="warning"
					variant="subtle"
					icon="carbon:warning-alt"
					:description="$t('auth.bffUpstreamMissing')"
				/>

				<UAlert
					v-if="errorMessage"
					color="error"
					variant="subtle"
					icon="carbon:warning-alt"
					:description="errorMessage"
				/>

				<UButton type="submit" size="lg" block :loading="submitting" :disabled="!isConfigured">
					{{ submitting ? $t("auth.submitting") : $t("auth.submit") }}
				</UButton>

				<p v-if="!isConfigured" class="text-center text-xs text-muted">
					{{ $t("auth.bffNotConfigured") }}
				</p>
			</UForm>
		</UCard>
	</div>
</template>

<script setup lang="ts">
	import type { DemoAccount } from "~~/shared/constants/demoAccounts";
	import { isTauri } from "@tauri-apps/api/core";
	import { DEFAULT_DEMO_ACCOUNT, DEMO_ACCOUNTS } from "~~/shared/constants/demoAccounts";

	// 登录页不带业务外壳（无 header / 侧栏），且不进导航（无 sort）
	// 命名 / 预填口径：NMCPS-ADR-0013（layers/content/collections/cn/records/adr/adr-0013.md）
	// 预填范围与身份口径：NMCPS-ARCH-003（layers/content/collections/cn/architecture/1.architecture/iam-architecture.md）§7.7
	definePageMeta({
		layout: false,
		hide: true
	});

	const { t } = useI18n();
	const route = useRoute();
	const { login, fetchSession } = useAuth();
	const { isConfigured, bffBase } = useApi();

	const schema = z.object({
		accountName: z.string().min(1, t("auth.accountNameRequired")),
		password: z.string().min(1, t("auth.passwordRequired")),
		tenantCode: z.string().optional(),
		mfaCode: z.string().optional()
	});

	type Schema = zInfer<typeof schema>;

	/** 演示程序：默认预填种子账号（超级管理员），身份可一键切换，字段仍可手改 */
	const state = reactive<Schema>({
		accountName: DEFAULT_DEMO_ACCOUNT.accountName,
		password: DEFAULT_DEMO_ACCOUNT.password,
		tenantCode: DEFAULT_DEMO_ACCOUNT.tenantCode,
		mfaCode: ""
	});

	/** 当前选中的演示身份 —— 只驱动按钮高亮，手动改字段不改变「预填来源」 */
	const activeDemoId = ref(DEFAULT_DEMO_ACCOUNT.id);

	const submitting = ref(false);
	const errorMessage = ref<string>();
	const mfaRequired = ref(false);
	const mustResetPassword = ref(false);
	/** 上游未配置 ⇒ 所有 `/api/auth/*` 都会 503（NMCPS-ARCH-003 §7.7）：进页面先探一次，别等到提交才报错 */
	const upstreamMissing = ref(false);

	/**
	 * 用 `/ready` 探上游配置：无上游时 BFF 返回 503 + `upstream.configured:false`。
	 * 探针失败（网络中断、桌面端无同源 Nitro）不作为结论 —— 保持 false，交给登录动作报错。
	 */
	async function probeUpstream(): Promise<void> {
		if (isTauri())
			return;

		try {
			await $fetch("/ready", { baseURL: bffBase, credentials: "include" });
			upstreamMissing.value = false;
		} catch (error) {
			const report = (error as { data?: { upstream?: { configured?: boolean } } }).data;
			upstreamMissing.value = report?.upstream?.configured === false;
		}
	}

	onMounted(probeUpstream);

	/** 切换演示身份：账号 / 口令 / 租户编码整体回填，动态口令不动（MFA 属于当次登录） */
	function applyDemoAccount(account: DemoAccount): void {
		state.accountName = account.accountName;
		state.password = account.password;
		state.tenantCode = account.tenantCode;
		activeDemoId.value = account.id;
		errorMessage.value = undefined;
	}

	/** 上游业务码 → 本地化文案（未知码回落 BFF/上游原始 message，不吞信息） */
	function describeError(error: unknown): string {
		if (error instanceof ApiError) {
			if (error.code === 401 || error.code === 20201 || error.code === 20202)
				return t("auth.invalidCredentials");
			if (error.code === 20205)
				return t("auth.mfaRequired");
			if (error.code === 403)
				return t("auth.forbidden");
			// 上游未配置是运维问题，不是凭据问题：给出可执行的修复指引
			if (error.code === 503 && error.message === "bff_upstream_missing")
				return t("auth.bffUpstreamMissing");
			if (error.message)
				return error.message;
		}

		return t("auth.failed");
	}

	async function submit(): Promise<void> {
		if (submitting.value)
			return;

		submitting.value = true;
		errorMessage.value = undefined;

		try {
			const result = await login({
				accountName: state.accountName.trim(),
				password: state.password,
				tenantCode: state.tenantCode?.trim() || undefined,
				mfaCode: state.mfaCode?.trim() || undefined
			});

			mfaRequired.value = result.mfaRequired;
			mustResetPassword.value = result.mustResetPassword;

			await fetchSession(true);

			// 只接受站内相对路径（`//host` 会被当成协议相对地址，必须排除）
			const target = route.query.redirect;
			const redirect = typeof target === "string" && target.startsWith("/") && !target.startsWith("//")
				? target
				: "/dashboard/overview";

			await navigateTo(redirect);
		} catch (error) {
			// 需要动态口令时上游会拒绝本次登录：保留账号口令，只让用户补码后重试
			if (error instanceof ApiError && error.code === 20205)
				mfaRequired.value = true;

			errorMessage.value = describeError(error);
		} finally {
			submitting.value = false;
		}
	}
</script>
