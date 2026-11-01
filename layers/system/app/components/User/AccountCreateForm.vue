<template>
	<!--
		右栏 `create` 态的内联建号表单（NMCPS-ADR-0017 D3 / 附录 B）。
		原 `AccountCreateModal.vue` 的弹窗形态已删除：两栏形态下「新建」是右栏的一个视图态，
		再套一层弹窗等于把同一个表单讲两遍（NMCPS-ARCH-006 §3.2 禁止项）。

		提交域按钮在**右栏工具栏**（取消 / 创建），因此本组件不自带 footer：
		页面调 `submit()`，提交成功由 `created` 事件把真实账号交回页面去 `replace` `?id`。
	-->
	<div class="max-w-[640px] space-y-5 p-4">
		<p class="text-sm text-(--ui-text-muted)">
			{{ t("pages.system-user.createForm.description") }}
		</p>

		<UForm
			ref="formRef"
			:schema="schema"
			:state="state"
			class="space-y-4"
			@submit="submit"
		>
			<UFormField
				:label="t('pages.system-user.createForm.accountName')"
				name="accountName"
				required
				:hint="t('pages.system-user.createForm.accountNameHint')"
			>
				<UInput
					v-model="state.accountName"
					class="w-full"
					:placeholder="t('pages.system-user.createForm.accountNamePlaceholder')"
					autocomplete="off"
				/>
			</UFormField>

			<UFormField
				:label="t('pages.system-user.createForm.displayName')"
				name="displayName"
				required
			>
				<UInput
					v-model="state.displayName"
					class="w-full"
					:placeholder="t('pages.system-user.createForm.displayNamePlaceholder')"
					autocomplete="off"
				/>
			</UFormField>

			<UFormField
				:label="t('pages.system-user.createForm.password')"
				name="password"
				required
				:hint="t('pages.system-user.createForm.passwordHint')"
			>
				<UInput
					v-model="state.password"
					type="password"
					class="w-full"
					:placeholder="t('pages.system-user.createForm.passwordPlaceholder')"
					autocomplete="new-password"
				/>
			</UFormField>

			<UFormField
				:label="t('pages.system-user.createForm.accountLevel')"
				name="accountLevel"
				required
				:hint="levelHint"
			>
				<USelect
					v-model="state.accountLevel"
					:items="levelOptions"
					class="w-full"
				/>
			</UFormField>

			<div class="flex flex-col gap-3">
				<USwitch
					v-model="state.mfaEnabled"
					:label="t('pages.system-user.createForm.mfaEnabled')"
					:description="t('pages.system-user.createForm.mfaEnabledHint')"
				/>
				<USwitch
					v-model="state.mustResetPassword"
					:label="t('pages.system-user.createForm.mustResetPassword')"
					:description="t('pages.system-user.createForm.mustResetPasswordHint')"
				/>
			</div>
		</UForm>

		<!-- 非字段级失败（上游 10201 / 10509、网络）走整体提示；字段级失败由 setErrors 内联 -->
		<UAlert
			v-if="submitError"
			color="error"
			variant="subtle"
			icon="carbon:warning-alt"
			:title="t('pages.system-user.createForm.failed')"
			:description="submitError"
		/>
	</div>
</template>

<script setup lang="ts">
	import type { AccountCreatePayload, AccountSummary } from "~~/shared/types/account";

	/**
	 * 新建账号表单（`POST /api/account`）。
	 *
	 * 设计基准：NMCPS-DESIGN-005 §6.1 / §6.3（layers/content/collections/cn/architecture/2.domain/system.md）
	 * - 上游没有「改资料」端点，所以这是**只建不改**的表单；
	 * - 等级可选项由父级按身份传入（超级管理员 `0`/`1`，租户管理员仅 `1`），
	 *   把「租户管理员越级建号」（NMCPS-REC-002 UP-ACC-01）挡在 UI 之外；
	 * - 上游缺参报 `500 10509`，因此必填与口令长度必须先在本地拦下。
	 */
	const props = defineProps<{
		/** 当前身份允许创建的等级（由页面按 `isSuperAdmin` 决定） */
		levelOptions: { label: string, value: number }[]
	}>();

	const emit = defineEmits<{
		/** 建号成功：把真实账号交给页面，由页面 `replace` `?id` 到真实标识（D6） */
		created: [account: AccountSummary]
	}>();

	const { t } = useI18n();
	const toast = useToast();
	const { create } = useAccounts();

	const formRef = ref<{ submit: () => Promise<void>, setErrors: (errors: { name: string, message: string }[]) => void }>();
	const submitting = ref(false);
	const submitError = ref<string>();

	/** 只允许字母 / 数字 / `_` / `-` / `.`：与上游账号名口径一致，避免建号后才 400 */
	const schema = z.object({
		accountName: z.string()
			.min(4, t("pages.system-user.errors.nameTooShort"))
			.max(32, t("pages.system-user.errors.nameTooLong"))
			.regex(/^[\w.-]+$/, t("pages.system-user.errors.namePattern")),
		displayName: z.string()
			.min(1, t("pages.system-user.errors.displayNameRequired"))
			.max(64, t("pages.system-user.errors.displayNameTooLong")),
		password: z.string().min(8, t("pages.system-user.errors.passwordTooShort")),
		accountLevel: z.number(),
		mfaEnabled: z.boolean(),
		mustResetPassword: z.boolean()
	});

	type Schema = zInfer<typeof schema>;

	const state = reactive<Schema>({
		accountName: "",
		displayName: "",
		password: "",
		accountLevel: props.levelOptions[0]?.value ?? 1,
		mfaEnabled: false,
		// 默认强制首次改密：初始口令交给对方后由本人替换（上游不拦，靠客户端约定）
		mustResetPassword: true
	});

	/** 父级收敛后的提示语：两种身份口径不同，别一句「按需选择」糊过去 */
	const levelHint = computed(() =>
		props.levelOptions.length > 1
			? t("pages.system-user.createForm.levelHintSuperAdmin")
			: t("pages.system-user.createForm.levelHintTenantAdmin")
	);

	/** 业务码 → 文案：字段级错误内联，其余整体提示 */
	function describeError(error: unknown): string {
		const key = accountErrorKey(error);
		if (key)
			return t(key);

		return error instanceof ApiError && error.message
			? error.message
			: t("pages.system-user.errors.failed");
	}

	async function submit(): Promise<void> {
		if (submitting.value)
			return;

		submitting.value = true;
		submitError.value = undefined;
		formRef.value?.setErrors([]);

		const payload: AccountCreatePayload = {
			accountName: state.accountName.trim(),
			displayName: state.displayName.trim(),
			password: state.password,
			accountLevel: state.accountLevel,
			mfaEnabled: state.mfaEnabled,
			mustResetPassword: state.mustResetPassword
		};

		try {
			const account = await create(payload);
			toast.add({ title: t("pages.system-user.createForm.success"), color: "success" });
			emit("created", account);
		} catch (error) {
			const message = describeError(error);
			const field = accountErrorField(error);

			if (field)
				formRef.value?.setErrors([{ name: field, message }]);
			else
				submitError.value = message;
		} finally {
			submitting.value = false;
		}
	}

	/** 提交域按钮在右栏工具栏：把 `submit` 与 `submitting`（加载态）交出去 */
	defineExpose({ submit, submitting });
</script>
