<template>
	<!--
		导出任务（`POST /api/audit/export` + `GET /api/audit/export`）：异步产出，**没有详情端点**（UP-AUD-07）。
		因此本弹窗只做两件事：按时间窗创建任务、回读任务列表；不摆「进度条」也不自动轮询 ——
		轮询一个没有进度字段的列表，只是把「不知道」包装成「正在加载」。
	-->
	<UModal
		v-model:open="open"
		:title="t('pages.system-log.export.title')"
		:description="t('pages.system-log.export.description')"
		:dismissible="!submitting"
		:ui="{ footer: 'justify-end' }"
	>
		<template #body>
			<div class="space-y-4">
				<UAlert
					color="info"
					variant="subtle"
					icon="carbon:information"
					:description="t('pages.system-log.export.hint')"
				/>

				<div class="space-y-3">
					<UFormField
						:label="t('pages.system-log.export.name')"
						:error="errors.exportName"
						required
					>
						<UInput
							v-model="state.exportName"
							class="w-full"
							maxlength="64"
							autocomplete="off"
							:placeholder="t('pages.system-log.export.namePlaceholder')"
						/>
					</UFormField>

					<div class="grid gap-3 sm:grid-cols-2">
						<UFormField
							:label="t('pages.system-log.export.start')"
							:error="errors.startTime"
							required
						>
							<UInput v-model="state.startTime" type="datetime-local" class="w-full" />
						</UFormField>
						<UFormField
							:label="t('pages.system-log.export.end')"
							:error="errors.endTime"
							required
						>
							<UInput v-model="state.endTime" type="datetime-local" class="w-full" />
						</UFormField>
					</div>

					<UAlert
						v-if="rangeReversed"
						color="warning"
						variant="subtle"
						icon="carbon:warning-alt"
						:description="t('pages.system-log.export.reversed')"
					/>

					<p class="text-xs text-(--ui-text-muted)">
						{{ t("pages.system-log.export.scopeHint", { category: scopeCategory, account: scopeAccount }) }}
					</p>
				</div>

				<UAlert
					v-if="submitError"
					color="error"
					variant="subtle"
					icon="carbon:warning-alt"
					:title="t('pages.system-log.export.failed')"
					:description="submitError"
				/>
				<!-- 任务列表：创建成功后立刻回读一次，让「刚建的那个」出现在眼前 -->
				<div class="space-y-2 border-t border-(--ui-border) pt-3">
					<div class="flex items-center justify-between gap-2">
						<p class="text-xs font-medium">
							{{ t("pages.system-log.export.jobs") }}
						</p>
						<UButton
							size="xs"
							color="neutral"
							variant="ghost"
							icon="carbon:renew"
							:loading="jobsLoading"
							:label="t('pages.system-log.export.refreshJobs')"
							@click="loadJobs"
						/>
					</div>

					<USkeleton v-if="jobsLoading && jobs.length === 0" class="h-12 w-full" />

					<p v-else-if="jobs.length === 0" class="text-xs text-(--ui-text-muted)">
						{{ t("pages.system-log.export.jobsEmpty") }}
					</p>

					<ul v-else class="max-h-56 space-y-1 overflow-auto">
						<li
							v-for="job in jobs"
							:key="job.exportCode"
							class="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 odd:bg-elevated/40"
						>
							<div class="min-w-0">
								<p class="truncate text-sm">
									{{ job.exportName }}
								</p>
								<p class="truncate font-mono text-[11px] text-(--ui-text-muted)">
									{{ job.exportCode }} · {{ auditTimeOf(job.createdAt) }} · {{ t("pages.system-log.export.records", { count: job.totalRecords }) }}
								</p>
							</div>
							<div class="flex shrink-0 items-center gap-2">
								<!-- 状态是裸数字：上游没有文档化取值，页面不猜「生成中 / 已完成」 -->
								<UBadge color="neutral" variant="subtle" size="sm">
									{{ t("pages.system-log.export.status", { status: job.status }) }}
								</UBadge>
								<UButton
									v-if="job.downloadUrl"
									size="xs"
									variant="outline"
									icon="carbon:download"
									:label="t('pages.system-log.export.download')"
									:to="job.downloadUrl"
									target="_blank"
									external
								/>
								<span v-else class="text-[11px] text-(--ui-text-muted)">
									{{ t("pages.system-log.export.notReady") }}
								</span>
							</div>
						</li>
					</ul>

					<UAlert
						v-if="jobsError"
						color="warning"
						variant="subtle"
						icon="carbon:warning-alt"
						:description="jobsError"
					/>
				</div>
			</div>
		</template>

		<template #footer>
			<UButton
				size="sm"
				color="neutral"
				variant="ghost"
				:label="t('pages.system-log.export.close')"
				:disabled="submitting"
				@click="open = false"
			/>
			<UButton
				size="sm"
				icon="carbon:download"
				:label="t('pages.system-log.export.submit')"
				:loading="submitting"
				@click="submit"
			/>
		</template>
	</UModal>
</template>

<script setup lang="ts">
	import type { AuditExportJob } from "~~/shared/types/audit";

	/**
	 * 审计导出弹窗。
	 *
	 * 设计基准：NMCPS-DESIGN-005 §9.3（`layers/content/collections/cn/architecture/2.domain/system.md`）
	 * 上游缺陷：NMCPS-REC-004 —— 必填缺参回 `500 10509`（UP-AUD-06）→ 本地先拦；
	 * 无详情 / 删除端点（UP-AUD-07）→ 只读列表；列表 `createdAt` 多 8 小时（UP-AUD-08）→ 原样展示。
	 */
	/** 弹窗打开时继承页面上已生效的筛选窗口；创建仍以表单为准，继承值只做预填与说明 */
	const props = defineProps<{
		defaultStart?: string
		defaultEnd?: string
		category?: string
		accountId?: number
	}>();

	const open = defineModel<boolean>("open", { required: true });

	const { t } = useI18n();
	const toast = useToast();
	const { listJobs, create } = useAuditExport();

	const submitting = ref(false);
	const submitError = ref<string>();

	const jobs = ref<AuditExportJob[]>([]);
	const jobsLoading = ref(false);
	const jobsError = ref<string>();

	const state = reactive({ exportName: "", startTime: "", endTime: "" });
	const errors = reactive<{ exportName?: string, startTime?: string, endTime?: string }>({});

	const rangeReversed = computed(() => auditRangeReversed(state.startTime, state.endTime));

	/** 继承的筛选条件一并带给上游（`category` / `accountId` 都是导出入参） */
	const scopeCategory = computed(() => props.category || t("pages.system-log.export.anyCategory"));
	const scopeAccount = computed(() => (props.accountId ? String(props.accountId) : t("pages.system-log.export.anyAccount")));

	function describeError(error: unknown): string {
		const key = auditErrorKey(error);
		if (key)
			return t(key);

		return error instanceof ApiError && error.message
			? error.message
			: t("pages.system-log.errors.failed");
	}

	/** 默认任务名的唯一作用是可读：`audit-20261102031509` 比一串随机码更容易在列表里认出来 */
	function defaultName(): string {
		const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
		return `audit-${stamp}`;
	}

	async function loadJobs(): Promise<void> {
		if (jobsLoading.value)
			return;

		jobsLoading.value = true;
		jobsError.value = undefined;

		try {
			const jobPage = await listJobs(1, 20);
			jobs.value = jobPage.list ?? [];
		} catch (error) {
			jobs.value = [];
			jobsError.value = describeError(error);
		} finally {
			jobsLoading.value = false;
		}
	}

	/** 打开即刷新：任务状态由上游异步推进，列表是唯一能回读它的地方（UP-AUD-07） */
	watch(open, (value) => {
		if (!value)
			return;

		submitError.value = undefined;
		errors.exportName = undefined;
		errors.startTime = undefined;
		errors.endTime = undefined;

		state.exportName = state.exportName || defaultName();
		state.startTime = props.defaultStart || state.startTime;
		state.endTime = props.defaultEnd || state.endTime;

		void loadJobs();
	});

	function validate(): boolean {
		errors.exportName = state.exportName.trim() ? undefined : t("pages.system-log.export.errors.nameRequired");
		errors.startTime = state.startTime ? undefined : t("pages.system-log.export.errors.startRequired");
		errors.endTime = state.endTime ? undefined : t("pages.system-log.export.errors.endRequired");

		if (!errors.startTime && !errors.endTime && rangeReversed.value) {
			errors.endTime = t("pages.system-log.export.errors.reversed");
			return false;
		}

		return !errors.exportName && !errors.startTime && !errors.endTime;
	}

	async function submit(): Promise<void> {
		if (submitting.value || !validate())
			return;

		submitting.value = true;
		submitError.value = undefined;

		try {
			const job = await create({
				exportName: state.exportName.trim(),
				// `validate()` 已保证两个时间非空，这里的兜底只是为了类型收敛
				startTime: toAuditTimeParam(state.startTime) ?? state.startTime,
				endTime: toAuditTimeParam(state.endTime) ?? state.endTime,
				category: props.category || undefined,
				accountId: props.accountId || undefined
			});

			toast.add({
				title: t("pages.system-log.export.created", { name: job.exportName || state.exportName.trim() }),
				color: "success"
			});

			await loadJobs();
		} catch (error) {
			submitError.value = describeError(error);
		} finally {
			submitting.value = false;
		}
	}
</script>
