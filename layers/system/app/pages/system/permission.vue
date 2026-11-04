<template>
	<div class="flex min-h-0 flex-1 flex-col">
		<!--
			页面根显式取 `flex-1 min-h-0`（NMCPS-ARCH-006 §3.3）：definite height 链在这里落定。
			身份 / 范围说明下移到详情栏顶部（见 `#detail`，NMCPS-DESIGN-005 §8.3）：
			页面顶部只留工具栏与两栏骨架，不再被一条横幅压掉左栏第一行。
		-->
		<!-- 内容页工具栏（NMCPS-ARCH-006 §4）：全页只有这一层 -->
		<Teleport to="#app-toolbar-left">
			<UTooltip v-if="toolbarPane === 'detail'" :text="$t('split.back')">
				<UButton
					size="sm"
					color="neutral"
					variant="ghost"
					icon="carbon:arrow-left"
					:aria-label="$t('split.back')"
					@click="clearSelection()"
				/>
			</UTooltip>
			<template v-else>
				<UInput
					v-model="keyword"
					size="sm"
					icon="carbon:search"
					:placeholder="$t('pages.system-permission.keywordPlaceholder')"
					:aria-label="$t('pages.system-permission.keywordPlaceholder')"
					class="w-40 min-w-0 sm:w-56"
				/>

				<UTooltip :text="$t('pages.system-permission.refresh')">
					<UButton
						size="sm"
						color="neutral"
						variant="ghost"
						icon="carbon:renew"
						:loading="loading"
						:aria-label="$t('pages.system-permission.refresh')"
						@click="reload"
					/>
				</UTooltip>
			</template>
		</Teleport>

		<!-- 右区 = 记录域 / 提交域 / 主 CTA（§4.1）；一页至多一个 primary -->
		<Teleport to="#app-toolbar-right">
			<template v-if="isCreating">
				<UButton
					size="sm"
					color="neutral"
					variant="ghost"
					:label="$t('pages.system-permission.createForm.cancel')"
					@click="clearSelection()"
				/>
				<UButton
					size="sm"
					:label="$t('pages.system-permission.createForm.submit')"
					:loading="createSubmitting"
					@click="createFormRef?.submit()"
				/>
			</template>
			<template v-else>
				<!-- 内置角色是共享只读模板（授权 / 删除都被上游拒），入口保留但禁用并给出原因 -->
				<UTooltip
					v-if="selected"
					:text="selected.isBuiltin
						? $t('pages.system-permission.builtinHint')
						: $t('pages.system-permission.deleteModal.hint')"
				>
					<UButton
						size="sm"
						color="error"
						variant="outline"
						icon="carbon:trash-can"
						:label="$t('pages.system-permission.delete')"
						:disabled="selected.isBuiltin"
						@click="openDelete()"
					/>
				</UTooltip>
				<!-- 覆盖式详情态不再给「新建」：那属于列表面板的动作（§4.4） -->
				<UButton
					v-if="toolbarPane === 'list'"
					size="sm"
					variant="outline"
					icon="carbon:add"
					:label="$t('pages.system-permission.create')"
					:disabled="!canUseDomain"
					@click="startCreate"
				/>
			</template>
		</Teleport>

		<!-- 两栏骨架（NMCPS-ARCH-006 §3 / NMCPS-ADR-0017 D1） -->
		<LayoutSplit
			id="permission"
			:has-selection="hasSelection"
			@update:shape="shape = $event"
		>
			<template #list>
				<!-- 栏内错误：右栏保持可用（§3.4） -->
				<div v-if="errorMessage" class="p-3">
					<UAlert
						color="error"
						variant="subtle"
						icon="carbon:warning-alt"
						:title="$t('pages.system-permission.loadFailed')"
						:description="errorMessage"
					>
						<template #actions>
							<UButton
								size="sm"
								color="neutral"
								variant="subtle"
								:label="$t('pages.system-permission.retry')"
								@click="reload"
							/>
						</template>
					</UAlert>
				</div>

				<div v-else-if="loading && rows.length === 0" class="space-y-2 p-3">
					<USkeleton v-for="index in 5" :key="index" class="h-10 w-full" />
				</div>

				<div v-else-if="rows.length === 0" class="flex flex-col items-center gap-2 p-6 text-center">
					<UIcon name="carbon:user-role" class="size-7 text-(--ui-text-muted)" />
					<p class="text-sm">
						{{ $t("pages.system-permission.empty") }}
					</p>
				</div>

				<!-- 自建 listbox（§3.6 / D8）：行可聚焦、`Enter` / `Space` 选中、带 `aria-selected` -->
				<ul
					v-else
					role="listbox"
					:aria-label="$t('pages.system-permission.listTitle')"
					class="flex flex-col"
					@keydown="onListKeydown"
				>
					<li
						v-for="(role, index) in rows"
						:key="role.roleCode"
						:ref="(element) => setRowRef(role.roleCode, element)"
						role="option"
						:aria-selected="role.roleCode === selectedId"
						:tabindex="role.roleCode === selectedId || (!selectedId && index === 0) ? 0 : -1"
						:title="`${role.roleName} · ${role.roleCode}`"
						class="cursor-pointer border-s-2 px-3 py-2 outline-none transition-colors hover:bg-elevated focus-visible:bg-elevated focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
						:class="role.roleCode === selectedId
							? 'border-primary bg-accented'
							: 'border-transparent'"
						@click="selection.select(role)"
						@keydown.enter.prevent="selection.select(role)"
						@keydown.space.prevent="selection.select(role)"
					>
						<div class="flex min-w-0 items-center justify-between gap-2">
							<p class="truncate text-sm font-medium">
								{{ role.roleName }}
							</p>
							<UBadge
								:color="role.isBuiltin ? 'neutral' : 'primary'"
								variant="subtle"
								size="sm"
							>
								{{ role.isBuiltin ? $t("pages.system-permission.isBuiltin") : $t("pages.system-permission.isCustom") }}
							</UBadge>
						</div>
						<p class="truncate font-mono text-xs text-(--ui-text-muted)">
							{{ role.roleCode }} · L{{ role.roleLevel }}
						</p>
					</li>
				</ul>
			</template>

			<!-- 列表尾部（滚动区之外）：计数 + 每页条数 + 分页（§3.8 / D2） -->
			<template #list-footer>
				<LayoutListFooter
					v-model:page="page"
					v-model:page-size="pageSize"
					:total="total"
					:disabled="loading"
				>
					{{ $t("pages.system-permission.total", { total }) }}
				</LayoutListFooter>
			</template>

			<template #detail>
				<div class="flex min-h-full flex-col">
					<!--
						身份 / 范围说明（NMCPS-DESIGN-005 §8.3）：放在详情栏顶部，
						它回答的是「这个角色在什么范围内可改」，属于所选记录的上下文而不是页面级横幅；
						因此三种详情状态（含未选中空态）都在最上面看到它，覆盖式下随详情页一起出现。
					-->
					<div v-if="loaded" class="shrink-0 px-4 pt-4">
						<UAlert
							:color="scopeAlert.color"
							variant="subtle"
							icon="carbon:user-role"
							:title="$t(scopeAlert.title)"
							:description="$t(scopeAlert.description)"
						/>
					</div>
					<!-- create 态：右栏内联表单（D3） -->
					<div v-if="isCreating" class="max-w-[640px] px-4 pt-4">
						<h2 class="text-base font-semibold">
							{{ $t("pages.system-permission.createForm.title") }}
						</h2>
					</div>
					<PermissionRoleCreateForm
						v-if="isCreating"
						ref="createFormRef"
						:level-options="levelOptions"
						@created="onCreated"
					/>

					<!-- `?id` 不在当前 rows：零详情请求 + 一次提示，不清空 URL（D6） -->
					<div v-else-if="isMissing" class="p-4">
						<UAlert
							color="warning"
							variant="subtle"
							icon="carbon:unlink"
							:title="$t('pages.system-permission.selectionMissingTitle')"
							:description="$t('pages.system-permission.selectionMissing', { id: selectedId })"
						>
							<template #actions>
								<UButton
									size="sm"
									color="neutral"
									variant="subtle"
									:label="$t('pages.system-permission.selectionClear')"
									@click="clearSelection()"
								/>
							</template>
						</UAlert>
					</div>

					<!-- view 态：左「角色信息」/ 右「权限矩阵」（NMCPS-ARCH-006 §3.7 并排的例外 / NMCPS-DESIGN-005 §8.3） -->
					<div v-else-if="selected" class="@container p-4">
						<div class="grid gap-5 @min-[48rem]:grid-cols-2">
							<!-- 左列：概览字段（NMCPS-ARCH-006 §3.7 并排的例外） -->
							<div class="min-w-0 space-y-5">
								<div class="min-w-0">
									<h2 class="truncate text-base font-semibold">
										{{ selected.roleName }}
									</h2>
									<p class="truncate font-mono text-xs text-(--ui-text-muted)">
										{{ selected.roleCode }}
									</p>
								</div>

								<dl class="grid grid-cols-[minmax(5rem,auto)_1fr] items-baseline gap-x-4 gap-y-3 text-sm">
									<dt class="text-(--ui-text-muted)">
										{{ $t("pages.system-permission.columns.roleLevel") }}
									</dt>
									<dd>L{{ selected.roleLevel }}</dd>

									<dt class="text-(--ui-text-muted)">
										{{ $t("pages.system-permission.columns.tenantId") }}
									</dt>
									<dd class="font-mono text-xs">
										{{ selected.tenantId }}
									</dd>

									<dt class="text-(--ui-text-muted)">
										{{ $t("pages.system-permission.columns.status") }}
									</dt>
									<dd>
										<UBadge :color="policyStatusColor(selected.status)" variant="subtle">
											{{ $t(policyStatusKey(selected.status, 'pages.system-permission'), { status: selected.status }) }}
										</UBadge>
									</dd>

									<dt class="text-(--ui-text-muted)">
										{{ $t("pages.system-permission.columns.description") }}
									</dt>
									<!-- 上游对「未填写」回空串：原样落成占位，不编造文案 -->
									<dd class="break-words">
										{{ selected.description || $t("pages.system-permission.noDescription") }}
									</dd>

									<dt class="text-(--ui-text-muted)">
										{{ $t("pages.system-permission.columns.createdAt") }}
									</dt>
									<!-- 上游 `GET` 返回 UTC、`POST` 返回本地时（UP-POL-05）：原样展示 -->
									<dd class="font-mono text-xs">
										{{ selected.createdAt }}
									</dd>
								</dl>

								<UAlert
									v-if="selected.isBuiltin"
									color="info"
									variant="subtle"
									icon="carbon:locked"
									:title="$t('pages.system-permission.builtinHintTitle')"
									:description="$t('pages.system-permission.builtinHint')"
								/>
								<p v-else class="text-xs text-(--ui-text-muted)">
									{{ $t("pages.system-permission.customHint") }}
								</p>
							</div>

							<!-- 右列：授权矩阵（两列 —— 资源类 / 接口类，与左侧字段各占一半） -->
							<section class="min-w-0 space-y-3">
								<div class="flex items-baseline justify-between gap-2">
									<h3 class="text-sm font-semibold">
										{{ $t("pages.system-permission.matrix.title") }}
									</h3>
									<span class="text-xs text-(--ui-text-muted)">
										{{ $t("pages.system-permission.matrix.grantedCount", { granted: grantedCodes.size }) }}
									</span>
								</div>
								<p class="text-xs text-(--ui-text-muted)">
									{{ $t("pages.system-permission.matrix.hint") }}
								</p>

								<div v-if="permError" class="py-2">
									<UAlert
										color="error"
										variant="subtle"
										icon="carbon:warning-alt"
										:title="$t('pages.system-permission.matrix.loadFailed')"
										:description="permError"
									>
										<template #actions>
											<UButton
												size="sm"
												color="neutral"
												variant="subtle"
												:label="$t('pages.system-permission.retry')"
												@click="reloadMatrix"
											/>
										</template>
									</UAlert>
								</div>

								<div v-else-if="matrixLoading" class="space-y-2">
									<USkeleton v-for="index in 4" :key="index" class="h-12 w-full" />
								</div>

								<div v-else-if="matrixGroups.length === 0" class="space-y-1">
									<p class="text-sm text-(--ui-text-muted)">
										{{ $t("pages.system-permission.matrix.empty") }}
									</p>
								</div>
								<!-- 两列：左列资源类（`resourceType` ≠ 4），右列接口类（`4`）；窄容器自动堆叠，接口列始终在第二列 -->
								<div v-else class="grid gap-4 @min-[48rem]:grid-cols-2">
									<div v-for="column in matrixColumns" :key="column.key" class="min-w-0 space-y-2">
										<div class="flex items-baseline justify-between gap-2">
											<h4 class="text-xs font-semibold">
												{{ $t(column.labelKey) }}
											</h4>
											<span class="text-xs text-(--ui-text-muted)">
												{{ $t("pages.system-permission.matrix.columns.count", { count: column.count }) }}
											</span>
										</div>
										<p v-if="column.groups.length === 0" class="text-xs text-(--ui-text-muted)">
											{{ $t("pages.system-permission.matrix.columns.empty") }}
										</p>
										<div v-for="group in column.groups" :key="group.resourceType" class="space-y-1">
											<p class="text-xs font-medium text-(--ui-text-muted)">
												{{ $t(group.labelKey) }}
											</p>
											<ul class="divide-y divide-(--ui-border) rounded-md border border-(--ui-border)">
												<li
													v-for="perm in group.items"
													:key="perm.permCode"
													class="flex items-start justify-between gap-3 px-3 py-2"
												>
													<div class="min-w-0">
														<p class="truncate text-sm">
															{{ perm.permName }}
														</p>
														<p class="break-all font-mono text-xs text-(--ui-text-muted)">
															{{ perm.permCode }}
														</p>
														<p class="truncate font-mono text-[11px] text-(--ui-text-muted)">
															{{ perm.resourcePath }} · {{ perm.action }}
															<span v-if="perm.fieldScope"> · {{ perm.fieldScope }}</span>
														</p>
													</div>
													<USwitch
														:model-value="grantedCodes.has(perm.permCode)"
														:disabled="!canToggle || pendingCodes.has(perm.permCode)"
														:aria-label="`${perm.permName} ${perm.permCode}`"
														@update:model-value="(value: boolean) => toggle(perm, value)"
													/>
												</li>
											</ul>
										</div>
									</div>
								</div>
							</section>
						</div>
					</div>

					<!-- 无选中：右栏空态（D3） -->
					<div v-else class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
						<UIcon name="carbon:document-blank" class="size-8 text-(--ui-text-muted)" />
						<p class="text-sm font-medium">
							{{ $t("pages.system-permission.detailEmpty") }}
						</p>
						<p class="max-w-xs text-xs text-(--ui-text-muted)">
							{{ $t("pages.system-permission.detailEmptyHint") }}
						</p>
					</div>
				</div>
			</template>
		</LayoutSplit>

		<!-- 破坏性确认：动作入口在右栏工具栏，弹窗只确认这一次写操作（D7） -->
		<PermissionRoleDeleteModal
			v-model:open="deleteOpen"
			:role="deleteTarget"
			@deleted="onDeleted"
		/>
	</div>
</template>

<script setup lang="ts">
	import type { PermissionSummary, RoleSummary } from "~~/shared/types/policy";
	import { DEFAULT_PAGE_SIZE } from "~~/shared/constants/paging";
	import { PERMISSION_RESOURCE_TYPE } from "~~/shared/types/policy";

	/**
	 * `/system/permission` 权限管理（两栏落码，NMCPS-ADR-0017 迁移步骤 5）。
	 *
	 * 设计基准：NMCPS-ARCH-006 §3（`layers/content/collections/cn/architecture/1.architecture/ui-architecture.md`）
	 * 领域口径：NMCPS-DESIGN-005 §八（`layers/content/collections/cn/architecture/2.domain/system.md`）
	 * 上游缺陷：NMCPS-REC-003（`layers/content/collections/cn/records/defects/policy-upstream-defects.md`）
	 *
	 * ── 决策矩阵：两个身份下本页暴露什么（实测口径，详见 §8.3）───────────────
	 * | 能力 | 超级管理员（level 0） | 租户管理员（level 1） |
	 * | :--- | :--- | :--- |
	 * | 角色列表 / 权限点目录 | 不提供：策略域四端点全部 `401 10201`（UP-POL-08） | 可用（本租户 + 平台内置模板） |
	 * | 查看授权矩阵 | 不提供 | 可用（内置角色同样可看） |
	 * | 授权 / 撤销 | 不提供 | 仅自建角色：内置角色回 `40307` / `40305`（UP-POL-09） |
	 * | 新建角色 | 不提供 | 可建 L2–L4；同级或更高回 `20103`、越界回 `40308`（UP-POL-05） |
	 * | 删除角色 | 不提供 | 仅自建角色；内置角色回 `40303`（UP-POL-09） |
	 * | 角色状态启停 | 不提供：上游没有 `PUT /role/{code}/status`（UP-POL-01） |
	 * | 账号绑定角色 | 不提供：`GET /account/role` 不存在（`404`），只能写不能读（UP-POL-07） |
	 *
	 * 这些收敛**只是不引导用户踩上游缺口**，不是安全边界：BFF 只做白名单透传，鉴权仍在上游。
	 */
	definePageMeta({ sort: 3, icon: "carbon:user-role" });

	const { t } = useI18n();
	const toast = useToast();
	const { user, isSuperAdmin, loaded } = useAuth();
	const {
		listRoles,
		listAllPermissions,
		listRolePermissions,
		grantPermission,
		revokePermission
	} = usePermissions();

	/** 当前形态（由 `Layout/Split.vue` 判定并外抛）：决定 `?id` 写历史时用 `replace` 还是 `push` */
	const shape = ref<"two" | "overlay">("two");

	const rows = ref<RoleSummary[]>([]);
	const total = ref(0);
	const page = ref(1);
	const pageSize = ref(DEFAULT_PAGE_SIZE);
	const loading = ref(false);
	const errorMessage = ref<string>();

	/**
	 * 记录选择契约（NMCPS-ARCH-006 §5.2 / D2 / D6）：`?id` 是「当前选中哪个角色」的唯一事实源。
	 *
	 * - 命中判定只在当前页 `rows` 里做；`?id` **不进** `listRoles()` 的请求参数，
	 *   因此改选中 / 深链进入都不会重新拉列表；
	 * - `?id` 不在当前结果集时只出空态提示，不静默翻页去捞；
	 * - `createId: "new"`：`?id=new` 是「新建角色」状态，不参与命中判定，也不报「记录不存在」。
	 */
	const selection = useRecordSelection<RoleSummary>({
		rows,
		getId: (role) => role.roleCode,
		getLabel: (role) => role.roleName,
		isLoading: loading,
		isOverlay: () => shape.value === "overlay",
		autoSelect: true,
		defaultRecord: (roleList) => roleList[0],
		createId: "new"
	});

	const { selectedId, selected, isMissing, isCreating, clear: clearSelection } = selection;

	const hasSelection = computed(() => !!selectedId.value);

	/** 工具栏内容跟随当前面板（NMCPS-ARCH-006 §4.4） */
	const toolbarPane = computed<"list" | "detail">(() =>
		shape.value === "overlay" && (hasSelection.value || isCreating.value) ? "detail" : "list");

	/** 面包屑记录段（§5.1）：create 态显示「新建角色」，否则显示选中角色名 */
	const recordLabel = computed(() => isCreating.value
		? t("pages.system-permission.createForm.title")
		: selection.label.value);

	const { clearRequests } = useRecordContext(recordLabel);

	watch(clearRequests, () => clearSelection());

	// ── 身份口径 ──────────────────────────────────────────────────────────────
	/**
	 * 策略域对超级管理员不开放（实测四端点全 `401 10201`，UP-POL-08）：
	 * 与其让页面发一堆注定失败的请求，不如在入口处就说清楚。
	 */
	const canUseDomain = computed(() => !!user.value && !isSuperAdmin.value);

	/**
	 * 身份说明三态：`0` / `1` 以外的等级（上游接受 `2`–`4` 但无语义）不能冒充租户管理员来说，
	 * 否则页面上写的「受租户范围约束」会变成未经验证的断言。
	 */
	const scopeAlert = computed<{ color: "neutral" | "info" | "warning", title: string, description: string }>(() => {
		if (!!user.value && isSuperAdmin.value) {
			return {
				color: "neutral",
				title: "pages.system-permission.scopeSuperAdminTitle",
				description: "pages.system-permission.scopeSuperAdmin"
			};
		}

		if (!!user.value && !isSuperAdmin.value) {
			return {
				color: "info",
				title: "pages.system-permission.scopeTenantAdminTitle",
				description: "pages.system-permission.scopeTenantAdmin"
			};
		}

		return {
			color: "warning",
			title: "pages.system-permission.scopeUnknownTitle",
			description: "pages.system-permission.scopeUnknown"
		};
	});

	/** 建角色可选等级：只能低于自身（租户管理员 = `1`，故 `2`–`4`；`0`/`1` 回 `20103`） */
	const levelOptions = computed(() => [2, 3, 4].map((level) => ({ label: `L${level}`, value: level })));

	// ── 权限点目录 + 授权矩阵 ─────────────────────────────────────────────────
	const catalog = ref<PermissionSummary[]>([]);
	const catalogLoading = ref(false);
	const catalogError = ref<string>();

	/** 当前角色已授权的 `permCode` 集合（上游不回 `effect`，见 UP-POL-03） */
	const grantedCodes = ref<Set<string>>(new Set());
	/** 正在落库的权限点：开关在请求返回前禁用，避免连点产生「撤销后才到的授权」 */
	const pendingCodes = ref<Set<string>>(new Set());
	const rolePermLoading = ref(false);
	const rolePermError = ref<string>();

	const matrixLoading = computed(() => catalogLoading.value || rolePermLoading.value);
	const permError = computed(() => catalogError.value ?? rolePermError.value);

	/** 授权矩阵：按 `resourceType` 分组，组内按 `permCode` 稳定排序 */
	const matrixGroups = computed(() => {
		const buckets = new Map<number, PermissionSummary[]>();

		for (const perm of catalog.value) {
			const bucket = buckets.get(perm.resourceType) ?? [];
			bucket.push(perm);
			buckets.set(perm.resourceType, bucket);
		}

		return [...buckets.entries()]
			.sort(([left], [right]) => left - right)
			.map(([resourceType, items]) => ({
				resourceType,
				labelKey: resourceTypeKey(resourceType),
				items: [...items].sort((left, right) => left.permCode.localeCompare(right.permCode))
			}));
	});

	/**
	 * 矩阵两列：左列资源类（`resourceType` ≠ `4`），右列接口类（`4`）。
	 *
	 * 接口点在目录里占大头（2026-11-02 实测 24 条里 15 条是 `4`），与资源类分组混排会把
	 * 「单设备 / 指标 / 告警」压到最下面；拆成两列后资源授权在上、接口授权在右，
	 * 列序固定为「资源类 → 接口类」，窄容器由 `auto-fit` 自动堆叠成上下两段。
	 */
	const matrixColumns = computed(() =>
		[
			{
				key: "resource",
				labelKey: "pages.system-permission.matrix.columns.resource",
				groups: matrixGroups.value.filter((group) => group.resourceType !== PERMISSION_RESOURCE_TYPE.API)
			},
			{
				key: "api",
				labelKey: "pages.system-permission.matrix.columns.api",
				groups: matrixGroups.value.filter((group) => group.resourceType === PERMISSION_RESOURCE_TYPE.API)
			}
		].map((column) => ({
			...column,
			count: column.groups.reduce((sum, group) => sum + group.items.length, 0)
		}))
	);

	/** 只有自建角色可改授权：内置角色是共享只读模板（`40307` / `40305`） */
	const canToggle = computed(() => canUseDomain.value && !!selected.value && !selected.value.isBuiltin);

	/** 不可变集合更新：`ref(new Set())` 原地 `add` 不会触发渲染 */
	function withCode(source: Set<string>, code: string, present: boolean): Set<string> {
		const next = new Set(source);
		if (present)
			next.add(code);
		else
			next.delete(code);

		return next;
	}

	// ── 键盘：listbox 语义（NMCPS-ARCH-006 §3.6 / D8）────────────────────────
	/** 行元素（`<li role="option">`）：`↑/↓/Home/End` 要把焦点搬到目标行 */
	const rowElements = new Map<string, HTMLElement>();

	function setRowRef(code: string, element: unknown): void {
		if (element instanceof HTMLElement)
			rowElements.set(code, element);
		else
			rowElements.delete(code);
	}

	/** `↑/↓/Home/End` 移动焦点并同步选中（selection follows focus）；`Enter` / `Space` 由行自己处理 */
	function onListKeydown(event: KeyboardEvent): void {
		const codes = rows.value.map((role) => role.roleCode);
		if (codes.length === 0)
			return;

		const current = selectedId.value ? codes.indexOf(selectedId.value) : -1;
		let next: number;

		switch (event.key) {
		case "ArrowDown":
			next = current < 0 ? 0 : Math.min(codes.length - 1, current + 1);
			break;
		case "ArrowUp":
			next = current < 0 ? codes.length - 1 : Math.max(0, current - 1);
			break;
		case "Home":
			next = 0;
			break;
		case "End":
			next = codes.length - 1;
			break;
		default:
			return;
		}

		event.preventDefault();
		const code = codes[next]!;
		selection.set(code);
		// v-for 重渲染可能替换节点，聚焦放到下一拍
		void nextTick(() => rowElements.get(code)?.focus());
	}

	// ── 新建（`?id=new` → 右栏 create 态）────────────────────────────────────
	const createFormRef = ref<{ submit: () => Promise<void>, submitting: boolean }>();
	const createSubmitting = computed(() => createFormRef.value?.submitting === true);

	function startCreate(): void {
		selection.set("new");
	}

	/**
	 * 建角色成功（D3 / D6）：先把新角色就地 patch 进列表，再 `replace` `?id` 为 `roleCode`，
	 * 最后静默刷新校准 —— 不重置滚动、不清空选中。
	 */
	function onCreated(role: RoleSummary): void {
		if (!role?.roleCode) {
			// 上游若没回角色体，只能靠重新拉列表来定位（不做猜测式选中）
			reload();
			return;
		}

		rows.value = [role, ...rows.value];
		total.value += 1;
		selection.set(role.roleCode);
		reload();
	}

	// ── 删除（危险动作在右栏工具栏，弹窗只确认）──────────────────────────────
	const deleteOpen = ref(false);
	const deleteTarget = ref<RoleSummary | null>(null);

	function openDelete(): void {
		if (!selected.value || selected.value.isBuiltin)
			return;

		deleteTarget.value = selected.value;
		deleteOpen.value = true;
	}

	/** 删除后 `?id` 指向的角色已不存在：先清选择再拉列表，避免右栏闪一次「记录不存在」 */
	function onDeleted(): void {
		clearSelection();
		reload();
	}

	// ── 筛选 ──────────────────────────────────────────────────────────────────
	// 输入态与生效态分开：搜索防抖 300ms 才落生效（D2），改筛选一律回到第一页
	const keyword = ref("");
	const appliedKeyword = ref("");

	function describeError(error: unknown): string {
		const key = policyErrorKey(error, "pages.system-permission");
		if (key)
			return t(key);

		return error instanceof ApiError && error.message
			? error.message
			: t("pages.system-permission.errors.failed");
	}

	// ── 取数 ──────────────────────────────────────────────────────────────────
	async function load(): Promise<void> {
		// 超管调策略域恒 `401 10201`（UP-POL-08）：不发这次注定失败的请求，理由由页面级 Alert 说明
		if (!canUseDomain.value || loading.value)
			return;

		loading.value = true;
		errorMessage.value = undefined;

		try {
			const result = await listRoles({
				page: page.value,
				pageSize: pageSize.value,
				keyword: appliedKeyword.value || undefined
			});

			rows.value = result.list ?? [];
			total.value = result.total ?? 0;

			// 命中变少时回退到最后一页，避免停在空白页
			const lastPage = Math.max(1, Math.ceil(total.value / pageSize.value));
			if (page.value > lastPage) {
				page.value = lastPage;
				loading.value = false;
				await load();
			}
		} catch (error) {
			rows.value = [];
			total.value = 0;
			errorMessage.value = describeError(error);
		} finally {
			loading.value = false;
		}
	}

	function reload(): void {
		void load();
	}

	/** 落生效态并重新取第一页（`page` 变了由 `watch(page)` 触发加载，避免重复请求） */
	function applyKeyword(): void {
		appliedKeyword.value = keyword.value.trim();

		if (page.value !== 1) {
			page.value = 1;
			return;
		}

		reload();
	}

	// 搜索框防抖 300ms（D2）：输入即生效，不需要再点「筛选」
	watchDebounced(keyword, () => applyKeyword(), { debounce: 300 });

	// 单页条数变化：走 `applyKeyword()` 同一条路径（换条数后 `page * pageSize` 偏移必然错位，回第一页再取数）
	watch(pageSize, () => applyKeyword());

	watch(page, () => {
		void load();
	});

	/**
	 * 权限点目录：与角色列表分开加载 —— 目录是静态参考数据，角色切换时不该重拉。
	 * 目录失败只挡住矩阵（`permError`），不影响角色详情其它字段。
	 */
	async function loadCatalog(): Promise<void> {
		if (!canUseDomain.value || catalogLoading.value || catalog.value.length > 0)
			return;

		catalogLoading.value = true;
		catalogError.value = undefined;

		try {
			catalog.value = await listAllPermissions();
		} catch (error) {
			catalogError.value = describeError(error);
		} finally {
			catalogLoading.value = false;
		}
	}

	/**
	 * 当前角色已授权的权限点。
	 *
	 * 上游只回权限点本体、不回 `effect`（UP-POL-03）：这里的集合是「有这条授权」，
	 * 页面因此不提供「拒绝」开关 —— 拒授权写入后回读不到，做了就是让用户看假象。
	 */
	async function loadRolePermissions(): Promise<void> {
		const role = selected.value;
		if (!role || !canUseDomain.value)
			return;

		rolePermLoading.value = true;
		rolePermError.value = undefined;

		try {
			const result = await listRolePermissions(role.roleCode);
			grantedCodes.value = new Set((result.list ?? []).map((perm) => perm.permCode));
		} catch (error) {
			grantedCodes.value = new Set();
			rolePermError.value = describeError(error);
		} finally {
			rolePermLoading.value = false;
		}
	}

	/** 矩阵的「重试」：目录缺了就补目录，否则只重拉当前角色授权 */
	function reloadMatrix(): void {
		if (catalog.value.length === 0)
			void loadCatalog();

		void loadRolePermissions();
	}

	/**
	 * 选中变化 → 重拉授权矩阵；离开记录（create / 无选中 / 记录丢失）时清空集合，
	 * 否则右栏会短暂显示上一个角色的勾选状态（串数据）。
	 */
	watch(() => selected.value?.roleCode, () => {
		if (!selected.value) {
			grantedCodes.value = new Set();
			rolePermError.value = undefined;
			return;
		}

		void loadCatalog();
		void loadRolePermissions();
	});

	/**
	 * 逐条授权 / 撤销：乐观更新 + 失败回滚。
	 *
	 * 开关禁用条件三选一：身份无策略域、内置角色只读、该权限点正在落库。
	 * 回滚是必须的 —— 停在「看起来已授权」的状态等于对用户说谎。
	 */
	async function toggle(perm: PermissionSummary, grant: boolean): Promise<void> {
		const role = selected.value;
		if (!role || role.isBuiltin || !canToggle.value || pendingCodes.value.has(perm.permCode))
			return;

		const snapshot = grantedCodes.value;
		if (snapshot.has(perm.permCode) === grant)
			return;

		pendingCodes.value = withCode(pendingCodes.value, perm.permCode, true);
		grantedCodes.value = withCode(snapshot, perm.permCode, grant);

		try {
			if (grant)
				await grantPermission(role.roleCode, perm.permCode);
			else
				await revokePermission(role.roleCode, perm.permCode);

			toast.add({
				title: t(grant ? "pages.system-permission.matrix.granted" : "pages.system-permission.matrix.revoked", { name: perm.permName }),
				color: "success"
			});
		} catch (error) {
			grantedCodes.value = snapshot;
			toast.add({
				title: t("pages.system-permission.matrix.toggleFailed"),
				description: describeError(error),
				color: "error"
			});
		} finally {
			pendingCodes.value = withCode(pendingCodes.value, perm.permCode, false);
		}
	}

	onMounted(() => {
		void load();
		void loadCatalog();
	});
</script>
