<template>
	<!--
		授权试算（`POST /api/access/dryrun`）：纯计算端点，不落库（NMCPS-DESIGN-005 §7.2）。
		上游接受 `clientIp` / `deviceCode` / `resourceTags` / `accountLevel` 但实测不参与判定（UP-POL-06），
		因此本表单**不提供**这四个输入 —— 摆了控件就等于承诺「改它能影响结果」。
	-->
	<UModal
		v-model:open="open"
		:title="t('pages.system-policy.dryrun.title')"
		:description="t('pages.system-policy.dryrun.description')"
		:dismissible="!submitting"
		:ui="{ footer: 'justify-end' }"
	>
		<template #body>
			<div class="space-y-4">
				<UAlert
					color="info"
					variant="subtle"
					icon="carbon:chemistry"
					:description="t('pages.system-policy.dryrun.hint')"
				/>

				<UForm
					ref="formRef"
					:schema="schema"
					:state="state"
					class="space-y-4"
					@submit="submit"
				>
					<UFormField
						:label="t('pages.system-policy.dryrun.account')"
						name="accountId"
						required
						:hint="accountsHint"
					>
						<USelect
							v-model="state.accountId"
							:items="accountItems"
							:loading="accountsLoading"
							:placeholder="t('pages.system-policy.dryrun.accountPlaceholder')"
							class="w-full"
						/>
					</UFormField>

					<UFormField
						:label="t('pages.system-policy.dryrun.path')"
						name="path"
						required
						:hint="t('pages.system-policy.dryrun.pathHint')"
					>
						<UInput
							v-model="state.path"
							class="w-full font-mono"
							placeholder="/api/v1/device/list"
							autocomplete="off"
						/>
					</UFormField>

					<UFormField
						:label="t('pages.system-policy.dryrun.method')"
						name="method"
						required
					>
						<USelect
							v-model="state.method"
							:items="methodItems"
							class="w-full"
						/>
					</UFormField>
				</UForm>

				<UAlert
					v-if="accountsError"
					color="warning"
					variant="subtle"
					icon="carbon:warning-alt"
					:title="t('pages.system-policy.dryrun.accountsFailed')"
					:description="accountsError"
				/>

				<!-- 结论：只有「允许 / 拒绝」两种，不给「大概可以」这种模糊说法 -->
				<div v-if="result" class="space-y-2">
					<UAlert
						:color="result.allow ? 'success' : 'error'"
						variant="subtle"
						:icon="result.allow ? 'carbon:checkmark-filled' : 'carbon:close-filled'"
						:title="result.allow ? t('pages.system-policy.dryrun.allow') : t('pages.system-policy.dryrun.deny')"
						:description="result.denyReason || undefined"
					/>
					<dl class="grid grid-cols-[minmax(5rem,auto)_1fr] items-baseline gap-x-4 gap-y-2 text-sm">
						<dt class="text-(--ui-text-muted)">
							{{ t("pages.system-policy.dryrun.matchedRule") }}
						</dt>
						<!-- 空串 = 未命中任何 ABAC 规则（RBAC 直接决定） -->
						<dd class="font-mono text-xs">
							{{ result.matchedRule || t("pages.system-policy.dryrun.noRule") }}
						</dd>

						<dt class="text-(--ui-text-muted)">
							{{ t("pages.system-policy.dryrun.allowedFields") }}
						</dt>
						<!-- 上游恒回 `null`（未见非空样本），不把 null 说成「无字段限制」 -->
						<dd class="font-mono text-xs">
							{{ result.allowedFields?.length ? result.allowedFields.join(", ") : t("pages.system-policy.dryrun.noFields") }}
						</dd>
					</dl>
				</div>

				<UAlert
					v-if="submitError"
					color="error"
					variant="subtle"
					icon="carbon:warning-alt"
					:title="t('pages.system-policy.dryrun.failed')"
					:description="submitError"
				/>
			</div>
		</template>

		<template #footer>
			<UButton
				color="neutral"
				variant="ghost"
				:label="t('pages.system-policy.dryrun.close')"
				:disabled="submitting"
				@click="open = false"
			/>
			<UButton
				:label="t('pages.system-policy.dryrun.submit')"
				icon="carbon:play"
				:loading="submitting"
				@click="submit"
			/>
		</template>
	</UModal>
</template>

<script setup lang="ts">
	import type { AccountSummary } from "~~/shared/types/account";
	import type { AccessDryrunPayload, AccessDryrunResult } from "~~/shared/types/policy";

	/**
	 * 授权试算弹窗（`POST /api/access/dryrun`）。
	 *
	 * 设计基准：NMCPS-DESIGN-005 §7.2 / §7.4（layers/content/collections/cn/architecture/2.domain/system.md）
	 * - 只发实测参与判定的三个字段（`accountId` / `path` / `method`），可选上下文一律不发（UP-POL-06）；
	 * - `path` 必须带 `/api/v1` 前缀，否则 RBAC 判「未授权」是假阴性而不是真实结论，表单本地先拦；
	 * - 试算不落库、不产生副作用，所以它不是「危险动作」，用普通弹窗而不是确认弹窗（§3.7）。
	 */
	const open = defineModel<boolean>("open", { required: true });

	const { t } = useI18n();
	const { list } = useAccounts();
	const { dryrun } = usePolicies();

	const formRef = ref<{ setErrors: (errors: { name: string, message: string }[]) => void }>();
	const submitting = ref(false);
	const submitError = ref<string>();
	const result = ref<AccessDryrunResult>();

	const accounts = ref<AccountSummary[]>([]);
	const accountsTotal = ref(0);
	const accountsLoading = ref(false);
	const accountsError = ref<string>();

	/** 账号下拉只能列出前 100 个：说清楚边界，不让用户以为「查不到就是不存在」 */
	const accountsHint = computed(() => (accountsTotal.value > accounts.value.length
		? t("pages.system-policy.dryrun.accountsTruncated", { listed: accounts.value.length, total: accountsTotal.value })
		: undefined));

	const accountItems = computed(() => accounts.value.map((account) => ({
		label: `${account.displayName || account.accountName} · ${account.accountId}`,
		value: account.accountId
	})));

	const methodItems = ["GET", "POST", "PUT", "PATCH", "DELETE"];

	const state = reactive<{ accountId?: number, path: string, method: string }>({
		accountId: undefined,
		path: "/api/v1/device/list",
		method: "GET"
	});

	const schema = z.object({
		accountId: z.number({ error: t("pages.system-policy.dryrun.errors.accountRequired") })
			.int()
			.positive(t("pages.system-policy.dryrun.errors.accountRequired")),
		path: z.string()
			.min(1, t("pages.system-policy.dryrun.errors.pathRequired"))
			.regex(/^\/api\/v1\/\S*$/, t("pages.system-policy.dryrun.errors.pathPrefix")),
		method: z.string().min(1, t("pages.system-policy.dryrun.errors.methodRequired"))
	});

	function describeError(error: unknown): string {
		const key = policyErrorKey(error, "pages.system-policy");
		if (key)
			return t(key);

		return error instanceof ApiError && error.message
			? error.message
			: t("pages.system-policy.errors.failed");
	}

	/** 打开即刷新账号列表：租户内的账号可能在两次试算之间被增删 */
	watch(open, async (value) => {
		if (!value)
			return;

		submitError.value = undefined;
		result.value = undefined;
		accountsError.value = undefined;
		accountsLoading.value = true;

		try {
			const page = await list({ page: 1, pageSize: 100 });
			accounts.value = page.list ?? [];
			accountsTotal.value = page.total ?? 0;

			// 默认选中第一个账号：试算表单最常被用来「拿最近一个账号试一条路径」
			if (state.accountId === undefined && accounts.value.length > 0)
				state.accountId = accounts.value[0]!.accountId;
		} catch (error) {
			accounts.value = [];
			accountsTotal.value = 0;
			accountsError.value = describeError(error);
		} finally {
			accountsLoading.value = false;
		}
	});

	async function submit(): Promise<void> {
		if (submitting.value)
			return;

		if (state.accountId === undefined) {
			formRef.value?.setErrors([{ name: "accountId", message: t("pages.system-policy.dryrun.errors.accountRequired") }]);
			return;
		}

		submitting.value = true;
		submitError.value = undefined;
		result.value = undefined;

		const payload: AccessDryrunPayload = {
			accountId: state.accountId,
			path: state.path.trim(),
			method: state.method
		};

		try {
			result.value = await dryrun(payload);
		} catch (error) {
			submitError.value = describeError(error);
		} finally {
			submitting.value = false;
		}
	}
</script>
