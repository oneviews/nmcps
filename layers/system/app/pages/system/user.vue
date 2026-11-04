<template>
	<div class="flex min-h-0 flex-1 flex-col">
		<!--
			页面根显式取 `flex-1 min-h-0`（NMCPS-ARCH-006 §3.3）：definite height 链在这里落定。
			身份 / 范围说明在详情栏顶部（见 `#detail`，NMCPS-DESIGN-005 §6.3）：
			页面顶部只留工具栏与两栏骨架，不再被一条横幅压掉左栏第一行。
		-->
		<!--
			内容页工具栏（NMCPS-ARCH-006 §4）：全页只有这一层。
			左区 = 集合域动作（搜索 / 筛选 / 刷新）；覆盖式详情态换成唯一「返回」。
		-->
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
					:placeholder="$t('pages.system-user.keywordPlaceholder')"
					:aria-label="$t('pages.system-user.keywordPlaceholder')"
					class="w-40 min-w-0 sm:w-56"
				/>

				<UPopover>
					<UButton
						size="sm"
						color="neutral"
						variant="ghost"
						icon="carbon:filter"
						:class="filtersActive ? 'text-primary' : ''"
						:aria-label="$t('pages.system-user.filter.title')"
					/>
					<template #content>
						<!-- 只有 keyword / status / department_id 是新代登记过的过滤参数（NMCPS-ADR-0018 §4.2） -->
						<div class="w-56 space-y-3 p-3">
							<p class="text-xs font-medium">
								{{ $t("pages.system-user.filter.title") }}
							</p>
							<USelect
								v-model="statusFilter"
								:items="statusFilterItems"
								size="sm"
								class="w-full"
								:aria-label="$t('pages.system-user.filter.status')"
							/>
							<USelect
								v-model="departmentFilter"
								:items="departmentFilterItems"
								size="sm"
								class="w-full"
								:aria-label="$t('pages.system-user.filter.department')"
							/>
							<UButton
								v-if="filtersActive"
								block
								size="sm"
								color="neutral"
								variant="subtle"
								:label="$t('pages.system-user.resetFilters')"
								@click="resetFilters"
							/>
						</div>
					</template>
				</UPopover>

				<UTooltip :text="$t('pages.system-user.refresh')">
					<UButton
						size="sm"
						color="neutral"
						variant="ghost"
						icon="carbon:renew"
						:loading="loading"
						:aria-label="$t('pages.system-user.refresh')"
						@click="reload"
					/>
				</UTooltip>
			</template>
		</Teleport>

		<!--
			右区 = 记录域 / 提交域 / 主 CTA（§4.1）；
			一页至多一个 primary：创建态是「创建」，其余时候是「新建」。
		-->
		<Teleport to="#app-toolbar-right">
			<template v-if="isCreating">
				<UButton
					size="sm"
					color="neutral"
					variant="ghost"
					:label="$t('pages.system-user.createForm.cancel')"
					@click="clearSelection()"
				/>
				<UButton
					size="sm"
					:label="$t('pages.system-user.createForm.submit')"
					:loading="createSubmitting"
					@click="createFormRef?.submit()"
				/>
			</template>
			<template v-else>
				<UTooltip
					v-if="selected"
					:text="isSelf(selected) ? $t('pages.system-user.selfHint') : $t('pages.system-user.changeStatusHint')"
				>
					<UButton
						size="sm"
						:color="targetStatus === IAM_USER_STATUS.DISABLED ? 'error' : 'neutral'"
						variant="outline"
						:icon="targetStatus === IAM_USER_STATUS.DISABLED ? 'carbon:locked' : 'carbon:unlocked'"
						:label="targetStatus === IAM_USER_STATUS.DISABLED
							? $t('pages.system-user.status.disabled')
							: $t('pages.system-user.status.active')"
						:disabled="isSelf(selected)"
						@click="openStatus"
					/>
				</UTooltip>
				<!-- 删号：新代 `DELETE /iam/users/{id}`（旧代缺口 UP-ACC-04 闭环），只在选中记录上出现 -->
				<UTooltip
					v-if="selected"
					:text="isSelf(selected) ? $t('pages.system-user.selfHint') : $t('pages.system-user.deleteHint')"
				>
					<UButton
						size="sm"
						color="error"
						variant="ghost"
						icon="carbon:trash-can"
						:aria-label="$t('pages.system-user.delete')"
						:disabled="isSelf(selected)"
						@click="openDelete"
					/>
				</UTooltip>
				<!-- 覆盖式详情态不再给「新建」：那属于列表面板的动作（§4.4） -->
				<UButton
					v-if="toolbarPane === 'list'"
					size="sm"
					icon="carbon:add"
					:label="$t('pages.system-user.create')"
					@click="startCreate"
				/>
			</template>
		</Teleport>

		<!--
			两栏骨架（NMCPS-ARCH-006 §3 / NMCPS-ADR-0017 D1）：左列表 / 右详情，
			窄了自动落覆盖式；两种形态共用同一份 `?id` 契约。
		-->
		<LayoutSplit
			id="user"
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
						:title="$t('pages.system-user.loadFailed')"
						:description="errorMessage"
					>
						<template #actions>
							<UButton
								size="sm"
								color="neutral"
								variant="subtle"
								:label="$t('pages.system-user.retry')"
								@click="reload"
							/>
						</template>
					</UAlert>
				</div>

				<!-- 加载：骨架行 × 5，不整块 spinner（§3.4）；刷新时保留旧数据 -->
				<div v-else-if="loading && displayRows.length === 0" class="space-y-2 p-3">
					<USkeleton v-for="index in 5" :key="index" class="h-10 w-full" />
				</div>

				<!-- 空态在栏内，不塞进表格（§3.4）；「新建」只在工具栏一处入口（§4） -->
				<div v-else-if="displayRows.length === 0" class="flex flex-col items-center gap-2 p-6 text-center">
					<UIcon name="carbon:user-multiple" class="size-7 text-(--ui-text-muted)" />
					<p class="text-sm">
						{{ $t("pages.system-user.empty") }}
					</p>
				</div>

				<!--
					列表：自建 listbox（§3.6 / D8）—— 行必须可聚焦、`Enter` / `Space` 选中、
					带 `aria-selected`；`UTable` 的行不输出 `aria-selected`，所以左栏不用表格。
					行内动作 0 个：整行点击就是「选中」，写操作一律在右栏工具栏（D2 / D5）。
				-->
				<ul
					v-else
					role="listbox"
					:aria-label="$t('pages.system-user.listTitle')"
					class="flex flex-col"
					@keydown="onListKeydown"
				>
					<li
						v-for="(userRow, index) in displayRows"
						:key="userRow.id"
						:ref="(element) => setRowRef(userRow.id, element)"
						role="option"
						:aria-selected="userRow.id === selectedId"
						:tabindex="userRow.id === selectedId || (!selectedId && index === 0) ? 0 : -1"
						:title="`${userRow.display_name || userRow.username} · ${userRow.id}`"
						class="cursor-pointer border-s-2 px-3 py-2 outline-none transition-colors hover:bg-elevated focus-visible:bg-elevated focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
						:class="userRow.id === selectedId
							? 'border-primary bg-accented'
							: 'border-transparent'"
						@click="selection.select(userRow)"
						@keydown.enter.prevent="selection.select(userRow)"
						@keydown.space.prevent="selection.select(userRow)"
					>
						<div class="flex min-w-0 items-center justify-between gap-2">
							<p class="truncate text-sm font-medium">
								{{ userRow.username }}
							</p>
							<UBadge :color="accountStatusColor(userRow.status)" variant="subtle" size="sm">
								{{ $t(accountStatusKey(userRow.status), { status: userRow.status }) }}
							</UBadge>
						</div>
						<p class="truncate text-xs text-(--ui-text-muted)">
							{{ rowSubtitle(userRow) }}
						</p>
					</li>
				</ul>
			</template>

			<!-- 列表尾部（滚动区之外）：计数 + 每页条数 + 分页（§3.8 / D2），翻页时不跟着滚走 -->
			<template #list-footer>
				<LayoutListFooter
					v-model:page="page"
					v-model:page-size="pageSize"
					:total="total"
					:disabled="loading"
				>
					{{ $t("pages.system-user.total", { total }) }}
				</LayoutListFooter>
			</template>

			<template #detail>
				<div class="flex min-h-full flex-col">
					<!--
						身份 / 范围说明（NMCPS-DESIGN-005 §6.3）：放在详情栏顶部，
						它回答的是「这批用户在什么范围内可见」，属于所选记录的上下文而不是页面级横幅。
					-->
					<div v-if="loaded" class="shrink-0 px-4 pt-4">
						<UAlert
							:color="scopeAlert.color"
							variant="subtle"
							icon="carbon:user-multiple"
							:title="$t(scopeAlert.title)"
							:description="$t(scopeAlert.description)"
						/>
					</div>

					<!-- create 态：原建号弹窗改为右栏内联表单（D3 / 附录 B） -->
					<div v-if="isCreating" class="max-w-[640px] px-4 pt-4">
						<h2 class="text-base font-semibold">
							{{ $t("pages.system-user.createForm.title") }}
						</h2>
					</div>
					<UserAccountCreateForm
						v-if="isCreating"
						ref="createFormRef"
						:department-options="departmentOptions"
						:department-loading="departmentsLoading"
						@created="onCreated"
					/>

					<!-- `?id` 不在当前 rows：零详情请求 + 一次提示，不清空 URL（D6） -->
					<div v-else-if="isMissing" class="p-4">
						<UAlert
							color="warning"
							variant="subtle"
							icon="carbon:unlink"
							:title="$t('pages.system-user.selectionMissingTitle')"
							:description="$t('pages.system-user.selectionMissing', { id: selectedId })"
						>
							<template #actions>
								<UButton
									size="sm"
									color="neutral"
									variant="subtle"
									:label="$t('pages.system-user.selectionClear')"
									@click="clearSelection()"
								/>
							</template>
						</UAlert>
					</div>

					<!-- view 态：只读详情（改资料走 `PUT`，本页暂不提供编辑态，见 C4b） -->
					<div v-else-if="selected" class="max-w-[640px] space-y-5 p-4">
						<div class="min-w-0">
							<h2 class="truncate text-base font-semibold">
								{{ selected.display_name || selected.username }}
							</h2>
							<p class="truncate font-mono text-xs text-(--ui-text-muted)">
								{{ selected.id }}
							</p>
						</div>
						<dl class="grid grid-cols-[minmax(5rem,auto)_1fr] items-baseline gap-x-4 gap-y-3 text-sm">
							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.system-user.columns.username") }}
							</dt>
							<dd class="break-all font-mono">
								{{ selected.username }}
							</dd>

							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.system-user.columns.id") }}
							</dt>
							<dd class="break-all font-mono text-xs">
								{{ selected.id }}
							</dd>

							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.system-user.columns.displayName") }}
							</dt>
							<dd>{{ selected.display_name || "—" }}</dd>

							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.system-user.columns.email") }}
							</dt>
							<dd class="break-all">
								{{ selected.email || "—" }}
							</dd>

							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.system-user.columns.tenant") }}
							</dt>
							<dd>{{ tenantName(selected.tenant_id) }}</dd>

							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.system-user.columns.department") }}
							</dt>
							<dd>{{ departmentName(selected.department_id) }}</dd>

							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.system-user.columns.status") }}
							</dt>
							<dd>
								<UBadge :color="accountStatusColor(selected.status)" variant="subtle">
									{{ $t(accountStatusKey(selected.status), { status: selected.status }) }}
								</UBadge>
							</dd>

							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.system-user.columns.mfa") }}
							</dt>
							<dd>{{ selected.mfa_enabled ? $t("pages.system-user.mfaOn") : $t("pages.system-user.mfaOff") }}</dd>

							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.system-user.columns.createdAt") }}
							</dt>
							<!-- 上游 RFC3339 带偏移（`2026-11-03T18:59:06+08:00`）：原样展示，不换算也不加 (UTC) -->
							<dd class="font-mono text-xs">
								{{ selected.created_at || "—" }}
							</dd>
						</dl>

						<p class="text-xs text-(--ui-text-muted)">
							{{ $t("pages.system-user.immutableHint") }}
						</p>
					</div>

					<!-- 无选中：右栏空态（D3）。「新建」只在工具栏一处入口（§4），空态里不再重复 -->
					<div v-else class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
						<UIcon name="carbon:document-blank" class="size-7 text-(--ui-text-muted)" />
						<p class="text-sm font-medium">
							{{ $t("pages.system-user.detailEmpty") }}
						</p>
						<p class="max-w-xs text-xs text-(--ui-text-muted)">
							{{ $t("pages.system-user.detailEmptyHint") }}
						</p>
					</div>
				</div>
			</template>
		</LayoutSplit>

		<!-- 破坏性确认：动作入口在右栏工具栏，弹窗只确认这一次写操作（D7） -->
		<UserAccountStatusModal
			v-model:open="statusOpen"
			:user="statusTarget"
			mode="status"
			@updated="reload"
		/>
		<UserAccountStatusModal
			v-model:open="deleteOpen"
			:user="statusTarget"
			mode="delete"
			@updated="onDeleted"
		/>
	</div>
</template>

<script setup lang="ts">
	import type { IamUser } from "~~/shared/types/account";
	import type { IamDepartment } from "~~/shared/types/department";
	import type { IamTenant } from "~~/shared/types/tenant";
	import { DEFAULT_PAGE_SIZE } from "~~/shared/constants/paging";
	import { IAM_USER_STATUS } from "~~/shared/types/account";

	/**
	 * `/system/user` 用户管理（两栏落码，NMCPS-ADR-0017 迁移步骤 4）。
	 *
	 * 设计基准：NMCPS-ARCH-006 §3（layers/content/collections/cn/architecture/1.architecture/ui-architecture.md）
	 * 领域口径：NMCPS-DESIGN-005 §六（layers/content/collections/cn/architecture/2.domain/system.md）
	 * 契约来源：NMCPS-ADR-0018 §4.2（`/account` → `iam/users`）
	 *
	 * ── 新代能力矩阵（2026-11-04 实测 192.168.1.55:8888）─────────────────────
	 * | 能力 | 旧代 | 新代 |
	 * | :--- | :--- | :--- |
	 * | 列表 / 搜索 | `accountName` | `keyword` 命中 `username` / `display_name` / `email` |
	 * | 状态过滤 | 数值 `1/2/3/4` | 字符串 `active` / `disabled` / `locked` |
	 * | 归属过滤 | 无（列表缺 `tenantId`，UP-ACC-05） | `department_id`（部门自带租户） |
	 * | 建号 | `accountName` + `accountLevel` + `tenantId` | `username` / `password` / `email?` / `display_name?` / `department_id?` |
	 * | 改资料 | **无端点**（UP-ACC-04） | `PUT /iam/users/{id}`（本页右栏仍只读，见 C4b） |
	 * | 改状态 | `PUT /account/{code}/status` | `PUT /iam/users/{id}` |
	 * | 删号 | **无端点**（用禁用替代） | `DELETE /iam/users/{id}`（软删 `deleted_at`） |
	 * | 等级 | `accountLevel` 0–4 | **不存在**（缺口 G1）：等级模型被角色取代 |
	 *
	 * 这些收敛**只是不引导用户踩上游缺口**，不是安全边界：BFF 只做白名单透传，鉴权仍在上游。
	 */
	definePageMeta({ sort: 1, icon: "carbon:user" });

	const { t } = useI18n();
	const { user, isSuperAdmin, loaded } = useAuth();
	const { list } = useAccounts();

	/** 当前形态（由 `Layout/Split.vue` 判定并外抛）：决定 `?id` 写历史时用 `replace` 还是 `push` */
	const shape = ref<"two" | "overlay">("two");

	const rows = ref<IamUser[]>([]);
	const total = ref(0);
	const page = ref(1);
	const pageSize = ref(DEFAULT_PAGE_SIZE);
	const loading = ref(false);
	const errorMessage = ref<string>();

	/**
	 * 列表展示顺序的**唯一来源**（NMCPS-ARCH-006 §3.6）：默认选中必须与展示顺序同源。
	 * 上游新代支持 `sort_by` / `sort_order`，但本页暂不提供客户端排序，因此这里只是把
	 * 「顺序」具名化：将来加排序只改这一处，`defaultRecord` 自动跟随。
	 */
	function byListOrder(userList: IamUser[]): IamUser[] {
		return userList;
	}

	const displayRows = computed(() => byListOrder(rows.value));

	/**
	 * 记录选择契约（NMCPS-ARCH-006 §5.2 / NMCPS-ADR-0017 D2 / D6）：`?id` 是「当前选中哪条」的唯一事实源。
	 *
	 * - 命中判定只在当前页 `displayRows` 里做：`?id` **不进** `list()` 的请求参数，
	 *   因此改选中 / 深链进入都不会重新拉列表；
	 * - `?id` 不在当前结果集时只出空态提示，**不静默翻页去捞**（会让筛选状态与 URL 不一致）；
	 * - `createId: "new"`：`?id=new` 是「新建」状态（D6），不参与命中判定，也不报「记录不存在」。
	 */
	const selection = useRecordSelection<IamUser>({
		rows: displayRows,
		getId: (record) => record.id,
		getLabel: (record) => record.display_name || record.username,
		isLoading: loading,
		isOverlay: () => shape.value === "overlay",
		autoSelect: true,
		defaultRecord: (userList) => byListOrder(userList)[0],
		createId: "new"
	});

	const { selectedId, selected, isMissing, isCreating, clear: clearSelection } = selection;

	const hasSelection = computed(() => !!selectedId.value);

	/**
	 * 工具栏内容跟随当前面板（NMCPS-ARCH-006 §4.4）：两栏 = 左区集合域 + 右区记录域同屏；
	 * 覆盖式列表态只给集合域动作（含「新建」），详情态左区换成唯一「返回」、右区只给记录域动作。
	 */
	const toolbarPane = computed<"list" | "detail">(() =>
		shape.value === "overlay" && (hasSelection.value || isCreating.value) ? "detail" : "list");

	/** 面包屑记录段（§5.1）：create 态显示「新建用户」，否则显示选中记录名 */
	const recordLabel = computed(() => isCreating.value
		? t("pages.system-user.createForm.title")
		: selection.label.value);

	const { clearRequests } = useRecordContext(recordLabel);

	// 记录段被点击 = 清除选择（工具栏不直接写 URL，URL 只由 useRecordSelection 写）
	watch(clearRequests, () => clearSelection());

	// ── 键盘：listbox 语义（§3.6 / D8）────────────────────────────────────────
	/** 行元素（`<li role="option">`）：`↑/↓/Home/End` 要能把焦点搬到目标行 */
	const rowElements = new Map<string, HTMLElement>();

	function setRowRef(id: string, element: unknown): void {
		if (element instanceof HTMLElement)
			rowElements.set(id, element);
		else
			rowElements.delete(id);
	}

	/** `↑/↓/Home/End` 移动焦点并同步选中（selection follows focus）；`Enter` / `Space` 由行自己处理 */
	function onListKeydown(event: KeyboardEvent): void {
		const ids = displayRows.value.map((record) => record.id);
		if (ids.length === 0)
			return;

		const current = selectedId.value ? ids.indexOf(selectedId.value) : -1;
		let next: number;

		switch (event.key) {
		case "ArrowDown":
			next = current < 0 ? 0 : Math.min(ids.length - 1, current + 1);
			break;
		case "ArrowUp":
			next = current < 0 ? ids.length - 1 : Math.max(0, current - 1);
			break;
		case "Home":
			next = 0;
			break;
		case "End":
			next = ids.length - 1;
			break;
		default:
			return;
		}

		event.preventDefault();
		const id = ids[next]!;
		selection.set(id);
		// v-for 重渲染可能替换节点，聚焦放到下一拍
		void nextTick(() => rowElements.get(id)?.focus());
	}

	// ── 新建（`?id=new` → 右栏 create 态）────────────────────────────────────
	/** 右栏工具栏的「创建」要驱动表单提交：模板 ref 拿子组件暴露的 `submit()` / `submitting` */
	const createFormRef = ref<{ submit: () => Promise<void>, submitting: boolean }>();
	const createSubmitting = computed(() => createFormRef.value?.submitting === true);

	/** 「新建」是集合域动作；覆盖式下 `push` 进详情 */
	function startCreate(): void {
		selection.set("new");
	}

	/**
	 * 建号成功（D3 / D6）：先把新用户就地 patch 进列表，再 `replace` `?id` 为真实主键，
	 * 最后静默刷新校准 —— 不重置滚动、不清空选中。
	 *
	 * 新代 `POST /iam/users` 回的是 `{ code, message, id }`（没有 `data`），composable 用
	 * `keyword` 回读刚建好的那一行；拿不到时回落到整表刷新（不做猜测式选中）。
	 */
	function onCreated(created: IamUser | undefined): void {
		if (!created?.id) {
			reload();
			return;
		}

		rows.value = [created, ...rows.value];
		total.value += 1;
		selection.set(created.id);
		reload();
	}

	// ── 写操作（危险动作在右栏工具栏，弹窗只确认）────────────────────────────
	const statusOpen = ref(false);
	const deleteOpen = ref(false);
	const statusTarget = ref<IamUser | null>(null);

	/** 目标状态：`active` → `disabled`，其余 → `active`（与 `AccountStatusModal` 的口径一致） */
	const targetStatus = computed<string>(() =>
		selected.value?.status === IAM_USER_STATUS.ACTIVE ? IAM_USER_STATUS.DISABLED : IAM_USER_STATUS.ACTIVE);

	/** 本人账号：改状态 / 删号都会自锁，两个入口直接禁用 */
	function isSelf(record: IamUser): boolean {
		return !!user.value?.username && user.value.username === record.username;
	}

	function openStatus(): void {
		if (!selected.value || isSelf(selected.value))
			return;

		statusTarget.value = selected.value;
		statusOpen.value = true;
	}

	function openDelete(): void {
		if (!selected.value || isSelf(selected.value))
			return;

		statusTarget.value = selected.value;
		deleteOpen.value = true;
	}

	/** 删号成功后当前选中记录已不存在：清掉 `?id` 再刷新，避免停在「记录不存在」空态 */
	function onDeleted(): void {
		clearSelection();
		reload();
	}

	// ── 归属维度：部门（建号候选 + 过滤）与租户（展示名翻译）────────────────
	const { list: listDepartments } = useDepartments();
	const { list: listTenants } = useTenants();

	const departments = ref<IamDepartment[]>([]);
	const departmentsLoading = ref(false);
	const tenants = ref<IamTenant[]>([]);

	/** 租户 / 部门名翻译：取不到就显示原始标识，不伪造名称 */
	function tenantName(id: string | null | undefined): string {
		if (!id)
			return t("pages.system-user.platformScope");

		return tenants.value.find((item) => item.id === id)?.name ?? id;
	}

	function departmentName(id: string | null | undefined): string {
		if (!id)
			return t("pages.system-user.noDepartment");

		return departments.value.find((item) => item.id === id)?.name ?? id;
	}

	/** 行副标题：显示名 · 租户 / 部门（左栏只有两行，第三个信息必须最有用） */
	function rowSubtitle(record: IamUser): string {
		const parts = [record.display_name || record.username];
		if (record.tenant_id)
			parts.push(tenantName(record.tenant_id));
		if (record.department_id)
			parts.push(departmentName(record.department_id));

		return parts.join(" · ");
	}

	/** 建号候选：部门自带租户，标签写成「租户 / 部门」让人看得懂归属 */
	const departmentOptions = computed(() => departments.value.map((item) => ({
		label: `${tenantName(item.tenant_id)} / ${item.name}`,
		value: item.id
	})));

	/** 归属一次性拉齐（当前环境 3 个租户 / 4 个部门）；失败不阻断列表 —— 表单会因无候选而提交不了 */
	onMounted(() => {
		departmentsLoading.value = true;
		void Promise.allSettled([listDepartments(), listTenants()])
			.then(([departmentResult, tenantResult]) => {
				departments.value = departmentResult.status === "fulfilled" ? departmentResult.value : [];
				tenants.value = tenantResult.status === "fulfilled" ? tenantResult.value : [];
			})
			.finally(() => {
				departmentsLoading.value = false;
			});
	});

	/**
	 * 身份说明三态：平台级（`tenant_id: null`）/ 租户级 / 未登录。
	 *
	 * 注意这是**近似**：新代没有 `accountLevel`（缺口 G1），角色化判定要读
	 * `subject-roles` + `roles`（"platform_admin" 之类），规则本身需要新 ADR，
	 * 因此本页暂时只按「平台级 vs 租户级」讲范围，不宣称权限等级。
	 */
	const scopeAlert = computed(() => {
		if (user.value && isSuperAdmin.value)
			return { color: "neutral" as const, title: "pages.system-user.scopeSuperAdminTitle", description: "pages.system-user.scopeSuperAdmin" };

		if (user.value && !isSuperAdmin.value)
			return { color: "info" as const, title: "pages.system-user.scopeTenantAdminTitle", description: "pages.system-user.scopeTenantAdmin" };

		return { color: "warning" as const, title: "pages.system-user.scopeUnknownTitle", description: "pages.system-user.scopeUnknown" };
	});

	function describeError(error: unknown): string {
		const key = accountErrorKey(error);
		if (key)
			return t(key);

		return error instanceof ApiError && error.message
			? error.message
			: t("pages.system-user.errors.failed");
	}

	// ── 筛选状态（声明在 `load()` 之前：`load` 读 `applied`，先声明再取数）───────────
	// 输入态与生效态分开：搜索防抖 300ms 才落生效（D2），改筛选一律回到第一页
	const keyword = ref("");
	/** `""` = 不限（新代 `status` 是字符串枚举，没有旧代那种「0 被当未提供」的坑） */
	const statusFilter = ref<string>("");
	/** `""` = 不限；其余是 `department_id`（部门自带租户，所以这一个筛选覆盖「归属」维度） */
	const departmentFilter = ref<string>("");
	const applied = ref<{ keyword: string, status: string, department: string }>({ keyword: "", status: "", department: "" });

	// ── 取数 ──────────────────────────────────────────────────────────────────
	async function load(): Promise<void> {
		if (loading.value)
			return;

		loading.value = true;
		errorMessage.value = undefined;

		try {
			const result = await list({
				page: page.value,
				page_size: pageSize.value,
				keyword: applied.value.keyword || undefined,
				// 空串是「不限」哨兵：不发出去（上游对 `status=""` 不过滤，但没必要多带参数）
				status: applied.value.status || undefined,
				department_id: applied.value.department || undefined
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

	// ── 筛选选项与生效 ─────────────────────────────────────────────────────────
	const filtersActive = computed(() =>
		applied.value.keyword !== "" || applied.value.status !== "" || applied.value.department !== "");

	const statusFilterItems = computed(() => [
		{ label: t("pages.system-user.filter.anyStatus"), value: "" },
		{ label: t("pages.system-user.status.active"), value: IAM_USER_STATUS.ACTIVE },
		{ label: t("pages.system-user.status.disabled"), value: IAM_USER_STATUS.DISABLED },
		{ label: t("pages.system-user.status.locked"), value: IAM_USER_STATUS.LOCKED }
	]);

	/** 部门候选来自同一个 `GET /iam/departments`（与建号表单共用），标签带租户前缀 */
	const departmentFilterItems = computed(() => [
		{ label: t("pages.system-user.filter.anyDepartment"), value: "" },
		...departmentOptions.value
	]);

	/** 落生效态并重新取第一页（`page` 变了由 `watch(page)` 触发加载，避免重复请求） */
	function applyFilters(): void {
		applied.value = {
			keyword: keyword.value.trim(),
			status: statusFilter.value,
			department: departmentFilter.value
		};

		if (page.value !== 1) {
			page.value = 1;
			return;
		}

		reload();
	}

	function resetFilters(): void {
		keyword.value = "";
		statusFilter.value = "";
		departmentFilter.value = "";
		applyFilters();
	}

	// 搜索框防抖 300ms（D2）：输入即生效，不需要再点「筛选」
	watchDebounced(keyword, () => applyFilters(), { debounce: 300 });
	// 两个下拉是离散选择，改完立刻生效
	watch([statusFilter, departmentFilter], () => applyFilters());
	// 单页条数变化同样走 `applyFilters()`：换条数后 `page * pageSize` 的偏移必然错位，必须回第一页
	watch(pageSize, () => applyFilters());

	watch(page, () => {
		void load();
	});

	onMounted(() => {
		void load();
	});
</script>
