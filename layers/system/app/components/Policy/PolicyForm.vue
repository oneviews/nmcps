<template>
	<!--
		右栏 `create` / `edit` 两态共用的策略表单（NMCPS-ADR-0017 D3：新建是右栏的一个视图态，不是弹窗）。

		提交域按钮在**右栏工具栏**（取消 / 创建 / 保存），因此本组件不自带 footer：
		页面调 `submit()`，成功后由 `saved` 事件把真实记录交回页面去 `replace` `?id`。

		字段口径（NMCPS-DESIGN-005 §7.1 / §7.2，2026-11-04 实测）：
		- `POST /iam/policies` 收 `name` / `code` / `policy_type` / `document` / `description`；
		没有 `tenant_id`（落会话租户）、没有 `enabled` / `is_system`（上游自己置）；
		- `PUT /iam/policies/{id}` 只有 `name` / `document` / `description` 生效，
		因此编辑态里 `code` / `policy_type` / `document` 一律只读 —— 文档不提供编辑器（§7.2）。
	-->
	<div class="max-w-[720px] space-y-5 p-4">
		<p class="text-sm text-(--ui-text-muted)">
			{{ isEdit ? t("pages.system-policy.form.editDescription") : t("pages.system-policy.form.description") }}
		</p>

		<UForm
			ref="formRef"
			:schema="schema"
			:state="state"
			class="space-y-4"
			@submit="submit"
		>
			<UFormField
				:label="t('pages.system-policy.form.name')"
				name="name"
				required
			>
				<UInput
					v-model="state.name"
					class="w-full"
					:placeholder="t('pages.system-policy.form.namePlaceholder')"
					autocomplete="off"
				/>
			</UFormField>

			<UFormField
				:label="t('pages.system-policy.form.code')"
				name="code"
				:required="!isEdit"
				:hint="isEdit ? t('pages.system-policy.form.codeImmutable') : t('pages.system-policy.form.codeHint')"
			>
				<UInput
					v-model="state.code"
					class="w-full font-mono"
					:placeholder="t('pages.system-policy.form.codePlaceholder')"
					autocomplete="off"
					:disabled="isEdit"
				/>
			</UFormField>

			<UFormField
				:label="t('pages.system-policy.form.policyType')"
				name="policyType"
				:required="!isEdit"
				:hint="isEdit ? t('pages.system-policy.form.policyTypeImmutable') : t('pages.system-policy.form.policyTypeHint')"
			>
				<UInput
					v-model="state.policyType"
					class="w-full font-mono"
					:placeholder="t('pages.system-policy.form.policyTypePlaceholder')"
					autocomplete="off"
					:disabled="isEdit"
				/>
			</UFormField>

			<UFormField
				:label="t('pages.system-policy.form.descriptionLabel')"
				name="description"
			>
				<UInput
					v-model="state.description"
					class="w-full"
					:placeholder="t('pages.system-policy.form.descriptionPlaceholder')"
					autocomplete="off"
				/>
			</UFormField>

			<!-- 创建态：文档一次性粘贴 + 前端 parse（只为挡掉必然失败的 22P02，不是语义校验） -->
			<UFormField
				v-if="!isEdit"
				:label="t('pages.system-policy.form.document')"
				name="document"
				required
				:hint="t('pages.system-policy.form.documentHint')"
			>
				<UTextarea
					v-model="state.document"
					:rows="8"
					class="w-full"
					:placeholder="t('pages.system-policy.form.documentPlaceholder')"
				/>
			</UFormField>

			<!-- 编辑态：文档只读预览（§7.2 不提供编辑器），提示里讲清「改不了什么」 -->
			<section v-else class="space-y-2">
				<h3 class="text-sm font-semibold">
					{{ t("pages.system-policy.columns.document") }}
				</h3>
				<pre class="max-h-64 overflow-auto rounded-md border border-(--ui-border) bg-elevated/40 p-3 font-mono text-xs whitespace-pre-wrap break-words">{{ documentPreview.text }}</pre>
				<p class="text-xs text-(--ui-text-muted)">
					{{ t("pages.system-policy.form.documentReadonly") }}
				</p>
			</section>
		</UForm>

		<!-- 非字段级失败（网络、上游原始 SQL 之外的其它错误）走整体提示；字段级失败由 setErrors 内联 -->
		<UAlert
			v-if="submitError"
			color="error"
			variant="subtle"
			icon="carbon:warning-alt"
			:title="t('pages.system-policy.form.failed')"
			:description="submitError"
		/>
	</div>
</template>

<script setup lang="ts">
	import type { IamPolicy, IamPolicyCreatePayload, IamPolicyUpdatePayload } from "~~/shared/types/policy";

	/**
	 * 新建 / 编辑策略表单（`POST /api/iam/policies`、`PUT /api/iam/policies/{id}`）。
	 *
	 * 设计基准：NMCPS-DESIGN-005 §7.1 / §7.2（layers/content/collections/cn/architecture/2.domain/system.md）、
	 * NMCPS-ADR-0018 §4.3（`/abac/rule` → `iam/policies`）。
	 */
	const props = defineProps<{
		/** 传了就是编辑态（只允许改名称 / 描述；文档取当前值原样回传） */
		policy?: IamPolicy | null
	}>();

	const emit = defineEmits<{ saved: [policy: IamPolicy | undefined] }>();

	const isEdit = computed(() => !!props.policy);

	const { t } = useI18n();
	const toast = useToast();
	const { create, update } = usePolicies();

	const formRef = ref<{ setErrors: (errors: { name: string, message: string }[]) => void }>();
	const submitting = ref(false);
	const submitError = ref<string>();

	const state = reactive({
		name: props.policy?.name ?? "",
		code: props.policy?.code ?? "",
		policyType: props.policy?.policy_type ?? "custom",
		description: props.policy?.description ?? "",
		document: props.policy?.document ?? ""
	});

	const documentPreview = computed(() => previewPolicyDocument(props.policy?.document));

	/** 合法 JSON 判定：`jsonb` 只要求「能解析」，不要求是数组或符合 policy 语法 */
	function isJsonDocument(value: string): boolean {
		try {
			JSON.parse(value);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * 校验口径：
	 * - `name` / `code` 必填（上游不校验必填，缺字段的失败形态还没摸清，UP-RBAC-07）；
	 * - `document` 只校验「是合法 JSON」——上游没有策略语义校验，页面也不假装有；
	 * - `code` 一旦创建不可改（`PUT` 不收该字段），因此编辑态不参与校验。
	 */
	const schema = computed(() => z.object({
		name: z.string().trim().min(1, t("pages.system-policy.errors.nameRequired")).max(64, t("pages.system-policy.errors.nameTooLong")),
		code: isEdit.value
			? z.string()
			: z.string().trim().min(2, t("pages.system-policy.errors.codeTooShort")).max(64, t("pages.system-policy.errors.codeTooLong")).regex(/^[\w.-]+$/, t("pages.system-policy.errors.codePattern")),
		policyType: isEdit.value
			? z.string()
			: z.string().trim().min(1, t("pages.system-policy.errors.policyTypeRequired")),
		description: z.string().max(255, t("pages.system-policy.errors.descriptionTooLong")).optional(),
		document: isEdit.value
			? z.string()
			: z.string().trim().min(1, t("pages.system-policy.errors.documentRequired")).refine(isJsonDocument, t("pages.system-policy.errors.documentInvalid"))
	}));

	/** 业务失败 → 文案：命中登记形态用页面文案（原始 SQL 不外泄），其余回落上游原文 */
	function describeError(error: unknown): string {
		const key = policyErrorKey(error, "pages.system-policy");
		if (key)
			return t(key);

		return error instanceof ApiError && error.message
			? error.message
			: t("pages.system-policy.errors.failed");
	}

	/** 唯一键冲突内联到 `code`（上游只回原始 SQL，没有字段信息），其余整体提示 */
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
			if (props.policy) {
				const payload: IamPolicyUpdatePayload = {
					id: props.policy.id,
					name: state.name,
					description: state.description,
					// 文档不可编辑：原样回传当前值（§7.2），避免「只改名字却清空文档」
					document: props.policy.document
				};

				await update(payload);
				toast.add({ title: t("pages.system-policy.form.saved"), color: "success" });
				emit("saved", undefined);
			} else {
				const payload: IamPolicyCreatePayload = {
					name: state.name,
					code: state.code,
					policy_type: state.policyType,
					document: state.document.trim(),
					description: state.description.trim() || undefined
				};

				const created = await create(payload);
				toast.add({ title: t("pages.system-policy.form.created"), color: "success" });
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
