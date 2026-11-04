<template>
	<!--
		右栏 `create` 态的内联建角色表单（NMCPS-ADR-0017 D3）。
		提交域按钮在**右栏工具栏**（取消 / 创建），因此本组件不自带 footer：
		页面调 `submit()`，成功由 `created` 事件把真实角色交回页面去 `replace` `?id`。
	-->
	<div class="max-w-[640px] space-y-5 p-4">
		<p class="text-sm text-(--ui-text-muted)">
			{{ t("pages.system-permission.createForm.description") }}
		</p>

		<UForm
			ref="formRef"
			:schema="schema"
			:state="state"
			class="space-y-4"
			@submit="submit"
		>
			<UFormField
				:label="t('pages.system-permission.createForm.roleCode')"
				name="roleCode"
				required
				:hint="t('pages.system-permission.createForm.roleCodeHint')"
			>
				<UInput
					v-model="state.roleCode"
					class="w-full"
					:placeholder="t('pages.system-permission.createForm.roleCodePlaceholder')"
					autocomplete="off"
				/>
			</UFormField>

			<UFormField
				:label="t('pages.system-permission.createForm.roleName')"
				name="roleName"
				required
			>
				<UInput
					v-model="state.roleName"
					class="w-full"
					:placeholder="t('pages.system-permission.createForm.roleNamePlaceholder')"
					autocomplete="off"
				/>
			</UFormField>

			<UFormField
				:label="t('pages.system-permission.createForm.roleLevel')"
				name="roleLevel"
				required
				:hint="t('pages.system-permission.createForm.roleLevelHint')"
			>
				<USelect
					v-model="state.roleLevel"
					:items="levelOptions"
					class="w-full"
				/>
			</UFormField>

			<UFormField
				:label="t('pages.system-permission.createForm.descriptionLabel')"
				name="description"
			>
				<UTextarea
					v-model="state.description"
					:rows="3"
					class="w-full"
					:placeholder="t('pages.system-permission.createForm.descriptionPlaceholder')"
				/>
			</UFormField>
		</UForm>

		<!-- 非字段级失败（上游 20103 / 10509、网络）走整体提示；字段级失败由 setErrors 内联 -->
		<UAlert
			v-if="submitError"
			color="error"
			variant="subtle"
			icon="carbon:warning-alt"
			:title="t('pages.system-permission.createForm.failed')"
			:description="submitError"
		/>
	</div>
</template>

<script setup lang="ts">
	import type { RoleCreatePayload, RoleSummary } from "~~/shared/types/policy";

	/**
	 * 新建角色表单（`POST /api/role`）。
	 *
	 * 设计基准：NMCPS-DESIGN-005 §8.1 / §8.3（layers/content/collections/cn/architecture/2.domain/system.md）
	 * - 角色等级只能**低于**自身：租户管理员建 `0` / `1` 会被上游拒（`20103`，UP-POL-05），
	 *   可选项由父级收敛后传入；
	 * - `roleCode` 重复回 `409 10302`、缺必填回 `500 10509`（UP-POL-04），因此必填先在本地拦下；
	 * - 只有自建角色（`isBuiltin: false`）能改授权与删除，内置角色是共享只读模板。
	 */
	const props = defineProps<{
		/** 当前身份允许创建的角色等级（由页面按会话 `accountLevel` 决定） */
		levelOptions: { label: string, value: number }[]
	}>();

	const emit = defineEmits<{
		/** 建角色成功：把真实角色交给页面，由页面 `replace` `?id` 到 `roleCode`（D6） */
		created: [role: RoleSummary]
	}>();

	const { t } = useI18n();
	const toast = useToast();
	const { createRole } = usePermissions();

	const formRef = ref<{ submit: () => Promise<void>, setErrors: (errors: { name: string, message: string }[]) => void }>();
	const submitting = ref(false);
	const submitError = ref<string>();

	/** 只允许字母 / 数字 / `_` / `-`：上游没有文档化编码规则，先按内置角色的命名习惯收敛 */
	const schema = z.object({
		roleCode: z.string()
			.min(3, t("pages.system-permission.errors.codeTooShort"))
			.max(64, t("pages.system-permission.errors.codeTooLong"))
			.regex(/^[\w-]+$/, t("pages.system-permission.errors.codePattern")),
		roleName: z.string()
			.min(1, t("pages.system-permission.errors.nameRequired"))
			.max(64, t("pages.system-permission.errors.nameTooLong")),
		roleLevel: z.number(),
		description: z.string().max(255, t("pages.system-permission.errors.descriptionTooLong"))
	});

	type Schema = zInfer<typeof schema>;

	const state = reactive<Schema>({
		roleCode: "",
		roleName: "",
		roleLevel: props.levelOptions[0]?.value ?? 3,
		description: ""
	});

	/** 业务码 → 文案（`policyErrorKey` 已把 20103 / 40308 / 10509 收成可读句子） */
	function describeError(error: unknown): string {
		const key = policyErrorKey(error, "pages.system-permission");
		if (key)
			return t(key);

		return error instanceof ApiError && error.message
			? error.message
			: t("pages.system-permission.errors.failed");
	}

	async function submit(): Promise<void> {
		if (submitting.value)
			return;

		submitting.value = true;
		submitError.value = undefined;
		formRef.value?.setErrors([]);

		const payload: RoleCreatePayload = {
			roleCode: state.roleCode.trim(),
			roleName: state.roleName.trim(),
			roleLevel: state.roleLevel
		};

		// 空描述不发：上游会把 `description: ""` 原样存下，展示时与「未填写」无法区分
		if (state.description.trim())
			payload.description = state.description.trim();

		try {
			const role = await createRole(payload);
			toast.add({ title: t("pages.system-permission.createForm.success"), color: "success" });
			emit("created", role);
		} catch (error) {
			const message = describeError(error);
			const code = error instanceof ApiError ? error.code : 0;

			// `10302` 是编码冲突：只有这一个码能内联到字段上
			if (code === 10302)
				formRef.value?.setErrors([{ name: "roleCode", message }]);
			else
				submitError.value = message;
		} finally {
			submitting.value = false;
		}
	}

	/** 提交域按钮在右栏工具栏：把 `submit` 与 `submitting`（加载态）交出去 */
	defineExpose({ submit, submitting });
</script>
