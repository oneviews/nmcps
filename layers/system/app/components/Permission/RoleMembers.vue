<template>
	<!--
		详情「已分配用户」（NMCPS-DESIGN-005 §8.3 第 6 条）：只做读 + 分配 + 撤销。

		上游 `GET /iam/subject-roles` 只认 `subject_id`（按角色反查不在契约里），因此这里一次拉全量
		关系行再按 `role_id` 过滤；用户候选来自 `/api/iam/users`，指向已删用户的孤儿行按存在性过滤（UP-RBAC-10）。
	-->
	<section class="min-w-0 space-y-3">
		<div class="flex items-baseline justify-between gap-2">
			<h3 class="text-sm font-semibold">
				{{ t("pages.system-permission.members.title") }}
			</h3>
			<span class="text-xs text-(--ui-text-muted)">
				{{ t("pages.system-permission.members.count", { count: assigned.length }) }}
			</span>
		</div>
		<p class="text-xs text-(--ui-text-muted)">
			{{ t("pages.system-permission.members.hint") }}
		</p>

		<UAlert
			v-if="errorMessage"
			color="error"
			variant="subtle"
			icon="carbon:warning-alt"
			:title="t('pages.system-permission.members.loadFailed')"
			:description="errorMessage"
		>
			<template #actions>
				<UButton
					size="sm"
					color="neutral"
					variant="subtle"
					:label="t('pages.system-permission.retry')"
					@click="reload"
				/>
			</template>
		</UAlert>

		<div v-else-if="loading" class="space-y-2">
			<USkeleton v-for="index in 2" :key="index" class="h-10 w-full" />
		</div>

		<template v-else>
			<div class="flex items-center gap-2">
				<USelect
					v-model="assignId"
					:items="candidates"
					:placeholder="t('pages.system-permission.members.assignPlaceholder')"
					:aria-label="t('pages.system-permission.members.assignPlaceholder')"
					:disabled="candidates.length === 0 || assigning"
					class="w-56"
				/>
				<UButton
					size="sm"
					variant="outline"
					icon="carbon:add"
					:label="t('pages.system-permission.members.assign')"
					:loading="assigning"
					:disabled="!assignId || assigning"
					@click="assign"
				/>
			</div>

			<p v-if="assigned.length === 0" class="text-sm text-(--ui-text-muted)">
				{{ t("pages.system-permission.members.empty") }}
			</p>

			<ul v-else class="divide-y divide-(--ui-border) rounded-md border border-(--ui-border)">
				<li
					v-for="member in assigned"
					:key="member.id"
					class="flex items-center justify-between gap-3 px-3 py-2"
				>
					<div class="min-w-0">
						<p class="truncate text-sm">
							{{ member.name }}
						</p>
						<p class="break-all font-mono text-xs text-(--ui-text-muted)">
							{{ member.subject_id }}
						</p>
					</div>
					<UButton
						size="xs"
						color="neutral"
						variant="ghost"
						:label="t('pages.system-permission.members.revoke')"
						:loading="pendingSubjects.has(member.subject_id)"
						@click="revoke(member.subject_id)"
					/>
				</li>
			</ul>

			<p v-if="orphanCount > 0" class="text-xs text-(--ui-text-muted)">
				{{ t("pages.system-permission.members.orphanHint", { count: orphanCount }) }}
			</p>
		</template>
	</section>
</template>

<script setup lang="ts">
	import type { IamRole, IamSubjectRole } from "~~/shared/types/policy";

	/**
		* 角色 ↔ 用户（`subject-roles` 关系的读写面）。
		*
		* 设计基准：NMCPS-DESIGN-005 §8.3 第 6 条 —— 只做「读 + 分配 + 撤销」，不在此页建号。
		*
		* 两条实测约束（NMCPS-REC-005）：
		* - `GET /iam/subject-roles` 只认 `subject_id`：按角色反查由本组件在前端过滤；
		* - 关系行不随用户软删清理（UP-RBAC-10）：指向已删用户的绑定只报数量，不渲染幽灵成员。
		*/
	const props = defineProps<{ role: IamRole }>();

	const { t } = useI18n();
	const toast = useToast();
	const { list: listUsers } = useAccounts();
	const { listSubjectRoles, assignRole, revokeRole } = usePermissions();

	const links = ref<IamSubjectRole[]>([]);
	/** 用户目录：`id` → 展示名（`display_name` 优先，回落 `username`） */
	const users = ref<Map<string, string>>(new Map());
	const loading = ref(false);
	const errorMessage = ref<string>();
	const assignId = ref<string>();
	const assigning = ref(false);
	const pendingSubjects = ref<Set<string>>(new Set());

	/** 本角色的绑定：上游不能按 `role_id` 过滤，这里按关系行自身字段筛 */
	const roleLinks = computed(() => links.value.filter((link) => link.role_id === props.role.id));

	/** 已分配用户（按用户目录存在性过滤孤儿行，UP-RBAC-10） */
	const assigned = computed(() => roleLinks.value
		.filter((link) => users.value.has(link.subject_id))
		.map((link) => ({ id: link.id, subject_id: link.subject_id, name: users.value.get(link.subject_id) ?? link.subject_id })));

	const orphanCount = computed(() => roleLinks.value.filter((link) => !users.value.has(link.subject_id)).length);

	const assignedIds = computed(() => new Set(roleLinks.value.map((link) => link.subject_id)));

	/** 候选用户：还没分配到这个角色的用户（上游没有「用户已在别的角色」这类约束可依赖） */
	const candidates = computed(() => [...users.value.entries()]
		.filter(([id]) => !assignedIds.value.has(id))
		.map(([id, name]) => ({ label: name, value: id })));

	function describeError(error: unknown): string {
		const key = policyErrorKey(error, "pages.system-permission");
		if (key)
			return t(key);

		return error instanceof ApiError && error.message
			? error.message
			: t("pages.system-permission.errors.failed");
	}

	async function load(): Promise<void> {
		loading.value = true;
		errorMessage.value = undefined;

		try {
			const [relation, userList] = await Promise.all([
				listSubjectRoles({ page: 1, page_size: 100 }),
				listUsers({ page: 1, page_size: 100 })
			]);

			links.value = relation.list ?? [];
			users.value = new Map((userList.list ?? []).map((user) => [user.id, user.display_name || user.username]));
		} catch (error) {
			links.value = [];
			users.value = new Map();
			errorMessage.value = describeError(error);
		} finally {
			loading.value = false;
		}
	}

	function reload(): void {
		void load();
	}

	async function assign(): Promise<void> {
		const subjectId = assignId.value;
		if (!subjectId || assigning.value)
			return;

		assigning.value = true;

		try {
			await assignRole(subjectId, props.role.id);
			toast.add({
				title: t("pages.system-permission.members.assigned", { name: users.value.get(subjectId) ?? subjectId }),
				color: "success"
			});
			assignId.value = undefined;
			await load();
		} catch (error) {
			toast.add({
				title: t("pages.system-permission.members.failed"),
				description: describeError(error),
				color: "error"
			});
		} finally {
			assigning.value = false;
		}
	}

	async function revoke(subjectId: string): Promise<void> {
		if (pendingSubjects.value.has(subjectId))
			return;

		pendingSubjects.value = new Set(pendingSubjects.value).add(subjectId);

		try {
			await revokeRole(subjectId, props.role.id);
			toast.add({
				title: t("pages.system-permission.members.revoked", { name: users.value.get(subjectId) ?? subjectId }),
				color: "success"
			});
			await load();
		} catch (error) {
			toast.add({
				title: t("pages.system-permission.members.failed"),
				description: describeError(error),
				color: "error"
			});
		} finally {
			const next = new Set(pendingSubjects.value);
			next.delete(subjectId);
			pendingSubjects.value = next;
		}
	}

	// 换角色 = 换成员：绑定与用户目录一起重取
	watch(() => props.role.id, () => {
		void load();
	});

	onMounted(() => {
		void load();
	});
</script>
