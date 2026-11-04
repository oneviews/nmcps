<template>
	<!--
		详情右栏「已授权策略」（NMCPS-DESIGN-005 §8.3 第 4 条 / 第 7 条）。

		授权是**策略勾选**而不是权限点开关：新代没有权限点目录（缺口 G3），权限点由策略 `document`
		的 `actions` 表达。候选 = `GET /iam/policies`（本租户 3 条），已勾状态 =
		`GET /iam/role-policies?role_id=` 的 `policy_id` 集合，写用 `AttachPolicy` / `DetachPolicy`。
	-->
	<section class="min-w-0 space-y-3">
		<div class="flex items-baseline justify-between gap-2">
			<h3 class="text-sm font-semibold">
				{{ t("pages.system-permission.policies.title") }}
			</h3>
			<span class="text-xs text-(--ui-text-muted)">
				{{ t("pages.system-permission.policies.grantedCount", { granted: grantedIds.size }) }}
			</span>
		</div>
		<p class="text-xs text-(--ui-text-muted)">
			{{ t("pages.system-permission.policies.hint") }}
		</p>

		<UAlert
			v-if="errorMessage"
			color="error"
			variant="subtle"
			icon="carbon:warning-alt"
			:title="t('pages.system-permission.policies.loadFailed')"
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
			<USkeleton v-for="index in 3" :key="index" class="h-12 w-full" />
		</div>

		<p v-else-if="policies.length === 0" class="text-sm text-(--ui-text-muted)">
			{{ t("pages.system-permission.policies.empty") }}
		</p>

		<ul v-else class="divide-y divide-(--ui-border) rounded-md border border-(--ui-border)">
			<li
				v-for="policy in policies"
				:key="policy.id"
				:data-policy-code="policy.code"
				class="flex items-start justify-between gap-3 px-3 py-2"
			>
				<div class="min-w-0">
					<p class="truncate text-sm">
						{{ policy.name }}
					</p>
					<p class="break-all font-mono text-xs text-(--ui-text-muted)">
						{{ policy.code }}
					</p>
					<p v-if="policy.description" class="truncate text-xs text-(--ui-text-muted)">
						{{ policy.description }}
					</p>
				</div>
				<USwitch
					:model-value="grantedIds.has(policy.id)"
					:disabled="!canToggle || pendingIds.has(policy.id)"
					:aria-label="`${policy.name} ${policy.code}`"
					@update:model-value="(value) => toggle(policy, value === true)"
				/>
			</li>
		</ul>

		<!-- 孤儿关系行（UP-RBAC-10）：指向已删策略的 `policy_id` 不渲染成「未知策略」，只报数量 -->
		<p v-if="orphanCount > 0" class="text-xs text-(--ui-text-muted)">
			{{ t("pages.system-permission.policies.orphanHint", { count: orphanCount }) }}
		</p>
	</section>
</template>

<script setup lang="ts">
	import type { IamPolicy, IamRole, IamRolePolicy } from "~~/shared/types/policy";

	/**
		* 策略 × 角色授权矩阵（`role-policies` 关系的读写面）。
		*
		* 设计基准：NMCPS-DESIGN-005 §8.1（关系型授权）/ §8.3 第 4 条（乐观更新 + 失败回滚，
		* 并发按 `role_id + policy_id` 去重）/ §8.4（重复挂载回 `SQLSTATE 23505`）。
		*
		* 三条不做的假设：
		* - 不做「保存」按钮：`AttachPolicy` / `DetachPolicy` 逐条即时生效；
		* - 不做 effect：关系行存在即已挂，字段里没有允许 / 拒绝（旧代 `UP-POL-03` 的字段已消失）；
		* - 不在客户端拦 `is_system`：上游对系统角色没有保护（UP-RBAC-02），拦了只会误导。
		*/
	const props = defineProps<{ role: IamRole }>();

	const { t } = useI18n();
	const toast = useToast();
	const { list: listPolicies } = usePolicies();
	const { listRolePolicies, attachPolicy, detachPolicy } = usePermissions();

	const policies = ref<IamPolicy[]>([]);
	const links = ref<IamRolePolicy[]>([]);
	const loading = ref(false);
	const errorMessage = ref<string>();
	/** 正在落库的 `policy_id`：开关在请求返回前禁用，避免连点产生「摘除后才到的挂载」 */
	const pendingIds = ref<Set<string>>(new Set());

	/** 已挂载的 `policy_id` 集合（关系行存在即已挂，没有 effect 维度） */
	const grantedIds = computed(() => new Set(links.value.map((link) => link.policy_id)));
	/** 指向已删策略的关系行：只报数量，不伪造策略名（UP-RBAC-10） */
	const orphanCount = computed(() => {
		const catalog = new Set(policies.value.map((policy) => policy.id));
		return links.value.filter((link) => !catalog.has(link.policy_id)).length;
	});
	const canToggle = computed(() => !!props.role.enabled);

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
			const [catalog, relation] = await Promise.all([
				// 候选策略一次拉全量：上游 `policies` 只有本租户 3 条（实测），分页反而要处理翻页态
				listPolicies({ page: 1, page_size: 100 }),
				listRolePolicies({ role_id: props.role.id, page: 1, page_size: 100 })
			]);

			policies.value = catalog.list ?? [];
			links.value = relation.list ?? [];
		} catch (error) {
			policies.value = [];
			links.value = [];
			errorMessage.value = describeError(error);
		} finally {
			loading.value = false;
		}
	}

	function reload(): void {
		void load();
	}

	function withId(source: Set<string>, id: string, present: boolean): Set<string> {
		const next = new Set(source);
		if (present)
			next.add(id);
		else
			next.delete(id);

		return next;
	}

	/**
		* 勾选即写：先乐观更新关系行（`id` 用临时值，成功后按最新关系重取校准），
		* 失败则回滚到操作前的快照并把原因说出口。
		*/
	async function toggle(policy: IamPolicy, grant: boolean): Promise<void> {
		if (pendingIds.value.has(policy.id))
			return;

		const snapshot = links.value;
		pendingIds.value = withId(pendingIds.value, policy.id, true);
		links.value = grant
			? [...links.value, { id: `pending-${policy.id}`, role_id: props.role.id, policy_id: policy.id }]
			: links.value.filter((link) => link.policy_id !== policy.id);

		try {
			if (grant)
				await attachPolicy(props.role.id, policy.id);
			else
				await detachPolicy(props.role.id, policy.id);

			toast.add({
				title: t(grant ? "pages.system-permission.policies.granted" : "pages.system-permission.policies.revoked", { name: policy.name }),
				color: "success"
			});

			// 关系行主键由上游给：乐观插入的那条是临时 id，这里按最新关系重取
			const relation = await listRolePolicies({ role_id: props.role.id, page: 1, page_size: 100 });
			links.value = relation.list ?? [];
		} catch (error) {
			links.value = snapshot;
			toast.add({
				title: t("pages.system-permission.policies.toggleFailed"),
				description: describeError(error),
				color: "error"
			});
		} finally {
			pendingIds.value = withId(pendingIds.value, policy.id, false);
		}
	}

	// 换角色 = 换矩阵：重新取候选策略与关系行（关系行按 `role_id` 过滤）
	watch(() => props.role.id, () => {
		void load();
	});

	onMounted(() => {
		void load();
	});
</script>
