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
				<UFormField :label="$t('auth.username')" name="username">
					<UInput
						v-model="state.username"
						variant="subtle"
						size="lg"
						autocomplete="username"
						:placeholder="$t('auth.usernamePlaceholder')"
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

				<UAlert
					v-if="upstreamMissing"
					color="warning"
					variant="subtle"
					icon="carbon:warning-alt"
					:description="$t('auth.bffUpstreamMissing')"
				>
					<template #actions>
						<UButton size="xs" variant="soft" :loading="probing" @click="recheckUpstream">
							{{ $t("auth.recheckUpstream") }}
						</UButton>
					</template>
				</UAlert>

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
	const { isConfigured } = useApi();

	const schema = z.object({
		username: z.string().min(1, t("auth.usernameRequired")),
		password: z.string().min(1, t("auth.passwordRequired"))
	});

	type Schema = zInfer<typeof schema>;

	/** 演示程序：默认预填种子账号（平台管理员），身份可一键切换，字段仍可手改 */
	const state = reactive<Schema>({
		username: DEFAULT_DEMO_ACCOUNT.username,
		password: DEFAULT_DEMO_ACCOUNT.password
	});

	/** 当前选中的演示身份 —— 只驱动按钮高亮，手动改字段不改变「预填来源」 */
	const activeDemoId = ref(DEFAULT_DEMO_ACCOUNT.id);

	const submitting = ref(false);
	const errorMessage = ref<string>();
	/**
	 * 上游未配置 ⇒ 所有 `/api/auth/*` 都会 503（NMCPS-ARCH-003 §7.7）：进页面先探一次，
	 * 别等到提交才报错；探针逻辑（缓存 / 重探 / 桌面端跳过）见 `useBffUpstream()`。
	 */
	const {
		upstreamMissing,
		probing,
		probe: probeUpstream,
		recheck: recheckUpstream
	} = useBffUpstream();

	onMounted(probeUpstream);

	/** 切换演示身份：账号 / 口令整体回填（新代无租户编码、无动态口令） */
	function applyDemoAccount(account: DemoAccount): void {
		state.username = account.username;
		state.password = account.password;
		activeDemoId.value = account.id;
		errorMessage.value = undefined;
	}

	/** 上游业务码 → 本地化文案（未知码回落 BFF/上游原始 message，不吞信息） */
	function describeError(error: unknown): string {
		if (error instanceof ApiError) {
			// 新代口令错/账号不存在统一 10003（NMCPS-ADR-0018 §4.1），401 是 BFF 还原后的状态码
			if (error.code === 401 || error.code === 10003)
				return t("auth.invalidCredentials");
			if (error.code === 403)
				return t("auth.forbidden");
			// 上游未配置 / 掉线 / 超时是运维问题，不是凭据问题：给出可执行的修复指引
			const hint = upstreamHintKey(error);
			if (hint)
				return t(hint);
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
			await login({
				username: state.username.trim(),
				password: state.password
			});

			await fetchSession(true);

			// 只接受站内相对路径（`//host` 会被当成协议相对地址，必须排除）
			const target = route.query.redirect;
			const redirect = typeof target === "string" && target.startsWith("/") && !target.startsWith("//")
				? target
				: undefined;

			// 新代没有 `mustResetPassword`（NMCPS-ADR-0018 缺口 G2）：强制改密入口不再由登录判定，
			// `/auth/change-password` 保留给自助改密与后续 BFF 侧策略命中。
			await navigateTo(redirect ?? "/dashboard/overview");
		} catch (error) {
			errorMessage.value = describeError(error);
		} finally {
			submitting.value = false;
		}
	}
</script>
