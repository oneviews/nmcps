<template>
	<!--
		右栏 `create` / `edit` 两态共用的角色表单（NMCPS-ADR-0017 D3：新建是右栏的一个视图态，不是弹窗）。

		提交域按钮在**右栏工具栏**（取消 / 创建 / 保存），因此本组件不自带 footer：
		页面调 `submit()`，成功后由 `saved` 事件把真实记录交回页面去 `replace` `?id`。

		字段口径（NMCPS-DESIGN-005 §8.1 / §8.3，2026-11-04 实测）：
		- `POST /iam/roles` 收 `name` / `code` / `description`，三者都**不是必填**（空 body 也 200，
			落一条空角色，UP-RBAC-07）→ 三个字段都在前端必填，放过就是脏数据；
		- `PUT /iam/roles/{id}` 只有 `name` / `description` 生效（`enabled` 被忽略，UP-RBAC-03），
			因此编辑态 `code` 只读、没有启停开关。
	-->
	<div class="max-w-[640px] space-y-5 p-4">
		<p class="text-sm text-(--ui-text-muted)">
			{{ isEdit ? t("pages.system-permission.form.editDescription") : t("pages.system-permission.form.description") }}
		</p>

		<UForm
			ref="formRef"
			:schema="schema"
			:state="state"
			class="space-y-4"
			@submit="submit"
		>
			<UFormField
				:label="t('pages.system-permission.form.name')"
				name="name"
				required
			>
				<UInput
					v-model="state.name"
					class="w-full"
					:placeholder="t('pages.system-permission.form.namePlaceholder')"
					autocomplete="off"
				/>
			</UFormField>

			<UFormField
				:label="t('pages.system-permission.form.code')"
				name="code"
				:required="!isEdit"
				:hint="isEdit ? t('pages.system-permission.form.codeImmutable') : t('pages.system-permission.form.codeHint')"
			>
				<UInput
					v-model="state.code"
					class="w-full font-mono"
					:placeholder="t('pages.system-permission.form.codePlaceholder')"
					autocomplete="off"
					:disabled="isEdit"
				/>
			</UFormField>

			<UFormField
				:label="t('pages.system-permission.form.descriptionLabel')"
				name="description"
			>
				<UTextarea
					v-model="state.description"
					:rows="3"
					class="w-full"
					:placeholder="t('pages.system-permission.form.descriptionPlaceholder')"
				/>
			</UFormField>
		</UForm>

		<!-- 非字段级失败（网络、上游 23503 之外的其它错误）走整体提示；字段级失败由 setErrors 内联 -->
		<UAlert
			v-if="submitError"
			color="error"
			variant="subtle"
			icon="carbon:warning-alt"
			:title="t('pages.system-permission.form.failed')"
			:description="submitError"
		/>
	</div>
</template>

<script setup lang="ts">
	import type { IamRole, IamRoleCreatePayload, IamRoleUpdatePayload } from "~~/shared/types/policy";

	/**
		* 新建 / 编辑角色表单（`POST /iam/roles`、`PUT /iam/roles/{id}`）。
		*
		* 设计基准：NMCPS-DESIGN-005 §8.3 第 5 条（建角色三字段都做前端必填）与 §8.1（`PUT` 只认
		* `name` / `description`）。`is_system` 不是保护（UP-RBAC-02），因此表单不为系统角色做特殊处理。
		*/
	const props = defineProps<{
		/** 传入 = 编辑当前角色；不传 = 新建 */
		role?: IamRole | null
	}>();

	const emit = defineEmits<{
		/** 保存成功：编辑回 `undefined`，新建回真实角色（页面据此 `replace` `?id`，D6） */
		saved: [role: IamRole | undefined]
	}>();

	const { t } = useI18n();
	const toast = useToast();
	const { createRole, updateRole } = usePermissions();

	const isEdit = computed(() => !!props.role?.id);

	const formRef = ref<{ submit: () => Promise<void>, setErrors: (errors: { name: string, message: string }[]) => void }>();
	const submitting = ref(false);
	const submitError = ref<string>();

	/**
		* 校验口径：
		* - `name` / `code` 必填 —— 上游不校验必填（UP-RBAC-07），本地拦下；
		* - `code` 一旦创建不可改（`PUT` 不收该字段），因此编辑态不参与校验；
		* - 编码只允许字母 / 数字 / `_` / `.` / `-`：上游没有文档化编码规则，先按种子角色的命名习惯收敛。
		*/
	const schema = computed(() => z.object({
		name: z.string().trim().min(1, t("pages.system-permission.errors.nameRequired")).max(64, t("pages.system-permission.errors.nameTooLong")),
		code: isEdit.value
			? z.string()
			: z.string().trim().min(2, t("pages.system-permission.errors.codeTooShort")).max(64, t("pages.system-permission.errors.codeTooLong")).regex(/^[\w.-]+$/, t("pages.system-permission.errors.codePattern")),
		description: z.string().max(255, t("pages.system-permission.errors.descriptionTooLong")).optional()
	}));

	const state = reactive({
		name: props.role?.name ?? "",
		code: props.role?.code ?? "",
		description: props.role?.description ?? ""
	});

	/** 业务失败 → 文案：命中登记形态用页面文案（原始 SQL 不外泄），其余回落上游原文 */
	function describeError(error: unknown): string {
		const key = policyErrorKey(error, "pages.system-permission");
		if (key)
			return t(key);

		return error instanceof ApiError && error.message
			? error.message
			: t("pages.system-permission.errors.failed");
	}

	/** 唯一键冲突（`code` 重复）内联到 `code`（上游只回原始 SQL，没有字段信息），其余整体提示 */
	function errorField(error: unknown): "code" | undefined {
		if (!(error instanceof ApiError))
			return undefined;

		return (error.message ?? "").includes("SQLSTATE 23505") ? "code" : undefined;
	}

	async function submit(): Promise<void> {
		if (submitting.value)
			return;

		submitting.value = true;
		submitError.value = undefined;
		formRef.value?.setErrors([]);

		try {
			if (props.role) {
				const payload: IamRoleUpdatePayload = {
					id: props.role.id,
					name: state.name,
					description: state.description
				};

				await updateRole(payload);
				toast.add({ title: t("pages.system-permission.form.saved"), color: "success" });
				emit("saved", undefined);
			} else {
				const payload: IamRoleCreatePayload = {
					name: state.name,
					code: state.code,
					description: state.description.trim() || undefined
				};

				const created = await createRole(payload);
				toast.add({ title: t("pages.system-permission.form.created"), color: "success" });
				emit("saved", created);
			}
		} catch (error) {
			const message = describeError(error);
			const field = errorField(error);

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
