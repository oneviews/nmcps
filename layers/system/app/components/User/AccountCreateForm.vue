<template>
	<!--
		右栏 `create` 态的内联建号表单（NMCPS-ADR-0017 D3 / 附录 B）。
		原 `AccountCreateModal.vue` 的弹窗形态已删除：两栏形态下「新建」是右栏的一个视图态，
		再套一层弹窗等于把同一个表单讲两遍（NMCPS-ARCH-006 §3.2 禁止项）。

		提交域按钮在**右栏工具栏**（取消 / 创建），因此本组件不自带 footer：
		页面调 `submit()`，提交成功由 `created` 事件把真实记录交回页面去 `replace` `?id`。

		字段集对齐新代 `POST /iam/users`（NMCPS-ADR-0018 §4.2）：`username` / `password` /
		`email?` / `display_name?` / `department_id?`。旧代的 `accountLevel` 与 `tenantId` 都不在
		请求体里 —— 等级模型已废（缺口 G1），租户归属由部门携带。
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
				:label="t('pages.system-user.createForm.username')"
				name="username"
				required
				:hint="t('pages.system-user.createForm.usernameHint')"
			>
				<UInput
					v-model="state.username"
					class="w-full"
					:placeholder="t('pages.system-user.createForm.usernamePlaceholder')"
					autocomplete="off"
				/>
			</UFormField>

			<UFormField
				:label="t('pages.system-user.createForm.displayName')"
				name="displayName"
				:hint="t('pages.system-user.createForm.displayNameHint')"
			>
				<UInput
					v-model="state.displayName"
					class="w-full"
					:placeholder="t('pages.system-user.createForm.displayNamePlaceholder')"
					autocomplete="off"
				/>
			</UFormField>

			<UFormField
				:label="t('pages.system-user.createForm.email')"
				name="email"
				:hint="t('pages.system-user.createForm.emailHint')"
			>
				<UInput
					v-model="state.email"
					type="email"
					class="w-full"
					:placeholder="t('pages.system-user.createForm.emailPlaceholder')"
					autocomplete="off"
				/>
			</UFormField>

			<UFormField
				v-if="departmentOptions?.length || departmentLoading"
				:label="t('pages.system-user.createForm.department')"
				name="departmentId"
				:hint="departmentHint"
			>
				<USelect
					v-model="state.departmentId"
					:items="departmentOptions"
					:loading="departmentLoading"
					:placeholder="t('pages.system-user.createForm.departmentPlaceholder')"
					class="w-full"
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
		</UForm>

		<!-- 非字段级失败（网络、上游内部错误）走整体提示；字段级失败由 setErrors 内联 -->
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
	import type { IamUser, IamUserCreatePayload } from "~~/shared/types/account";

	/**
	 * 新建用户表单（`POST /api/iam/users`）。
	 *
	 * 设计基准：NMCPS-ADR-0018 §4.2（`POST /account` → `POST /iam/users`）、
	 * NMCPS-DESIGN-005 §6.1（layers/content/collections/cn/architecture/2.domain/system.md）。
	 *
	 * 实测（2026-11-04）：上游请求体只收 `department_id`（没有 `tenant_id`），新号一律 `active`
	 * 且未绑定 MFA —— 因此表单既没有租户下拉，也没有「要求两步验证 / 首次强制改密」开关
	 * （新代没有 `mustResetPassword`，缺口 G2）。
	 */
	const props = defineProps<{
		/** 部门候选（部门自带租户，选中部门即选定归属租户） */
		departmentOptions?: { label: string, value: string }[]
		departmentLoading?: boolean
	}>();

	const emit = defineEmits<{ created: [user: IamUser | undefined] }>();

	const { t } = useI18n();
	const toast = useToast();
	const { create } = useAccounts();

	const formRef = ref<{ setErrors: (errors: { name: string, message: string }[]) => void }>();
	const submitting = ref(false);
	const submitError = ref<string>();

	/** 只允许字母 / 数字 / `_` / `-` / `.`：与上游用户名口径一致，避免建号后才 400 */
	const schema = computed(() => z.object({
		username: z.string()
			.min(2, t("pages.system-user.errors.usernameTooShort"))
			.max(64, t("pages.system-user.errors.usernameTooLong"))
			.regex(/^[\w.-]+$/, t("pages.system-user.errors.usernamePattern")),
		displayName: z.string().max(64, t("pages.system-user.errors.displayNameTooLong")).optional(),
		email: z.union([
			z.literal(""),
			z.email(t("pages.system-user.errors.emailInvalid"))
		]).optional(),
		departmentId: z.string().optional(),
		// 上游实测口径：「密码长度应为 6-128 字符」（40001），不再有旧代的复杂度 / 历史重复校验
		password: z.string()
			.min(6, t("pages.system-user.errors.passwordTooShort"))
			.max(128, t("pages.system-user.errors.passwordTooLong"))
	}));

	type Schema = zInfer<typeof schema.value>;

	const state = reactive<Schema>({
		username: "",
		displayName: "",
		email: "",
		departmentId: undefined,
		password: ""
	});

	/** 部门候选是异步来的：到了之后补默认值（单租户环境常见），不覆盖用户已选项 */
	watch(() => props.departmentOptions, (options) => {
		if (state.departmentId === undefined && options?.length)
			state.departmentId = options[0]!.value;
	}, { immediate: true });

	/** 部门提示：讲清「为什么这一步影响归属」——部门携带租户，新版没有租户下拉 */
	const departmentHint = computed(() =>
		props.departmentLoading
			? t("pages.system-user.createForm.departmentLoading")
			: t("pages.system-user.createForm.departmentHint"));

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

		const payload: IamUserCreatePayload = {
			username: state.username.trim(),
			password: state.password,
			email: state.email?.trim() || undefined,
			display_name: state.displayName?.trim() || undefined,
			department_id: state.departmentId || undefined
		};

		try {
			const user = await create(payload);
			toast.add({ title: t("pages.system-user.createForm.success"), color: "success" });
			emit("created", user);
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
