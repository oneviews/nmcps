<template>
	<div class="flex min-h-0 flex-1 flex-col">
		<!--
			页面根显式取 `flex-1 min-h-0`（NMCPS-ARCH-006 §3.3）：definite height 链在这里落定。
			身份 / 范围说明下移到详情栏顶部（见 `#detail`，NMCPS-DESIGN-005 §6.3）：
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
						<!-- 只有 keyword / status 可靠（`accountLevel=0` 被上游当未提供，见 NMCPS-REC-002 UP-ACC-02） -->
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
								v-model="levelFilter"
								:items="levelFilterItems"
								size="sm"
								class="w-full"
								:aria-label="$t('pages.system-user.filter.level')"
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
						:color="targetStatus === ACCOUNT_STATUS.DISABLED ? 'error' : 'neutral'"
						variant="outline"
						:icon="targetStatus === ACCOUNT_STATUS.DISABLED ? 'carbon:locked' : 'carbon:unlocked'"
						:label="targetStatus === ACCOUNT_STATUS.DISABLED
							? $t('pages.system-user.status.disabled')
							: $t('pages.system-user.status.enabled')"
						:disabled="isSelf(selected)"
						@click="openStatus()"
					/>
				</UTooltip>
				<!-- 覆盖式详情态不再给「新建」：那属于列表面板的动作（§4.4）；view 态无 primary，故 outline -->
				<UButton
					v-if="toolbarPane === 'list'"
					size="sm"
					variant="outline"
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
						v-for="(account, index) in displayRows"
						:key="account.accountCode"
						:ref="(element) => setRowRef(account.accountCode, element)"
						role="option"
						:aria-selected="account.accountCode === selectedId"
						:tabindex="account.accountCode === selectedId || (!selectedId && index === 0) ? 0 : -1"
						:title="`${account.displayName || account.accountName} · ${account.accountCode}`"
						class="cursor-pointer border-s-2 px-3 py-2 outline-none transition-colors hover:bg-elevated focus-visible:bg-elevated focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
						:class="account.accountCode === selectedId
							? 'border-primary bg-accented'
							: 'border-transparent'"
						@click="selection.select(account)"
						@keydown.enter.prevent="selection.select(account)"
						@keydown.space.prevent="selection.select(account)"
					>
						<div class="flex min-w-0 items-center justify-between gap-2">
							<p class="truncate text-sm font-medium">
								{{ account.accountName }}
							</p>
							<UBadge :color="accountStatusColor(account.status)" variant="subtle" size="sm">
								{{ $t(accountStatusKey(account.status), { status: account.status }) }}
							</UBadge>
						</div>
						<p class="truncate text-xs text-(--ui-text-muted)">
							{{ account.displayName || account.accountCode }}
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
						它回答的是「这批账号在什么范围内可见」，属于所选记录的上下文而不是页面级横幅；
						因此三种详情状态（含未选中空态）都在最上面看到它，覆盖式下随详情页一起出现。
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
						:level-options="levelOptions"
						:tenant-options="tenantOptions"
						:tenant-loading="tenantsLoading"
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

					<!-- view 态：只读详情（无编辑入口，D3 的 `edit` 三态在两栏首例挂起） -->
					<div v-else-if="selected" class="max-w-[640px] space-y-5 p-4">
						<!-- 内容区标题（§4 / §5.3）：记录标题不进工具栏，覆盖式下它就是「我在看哪一条」 -->
						<div class="min-w-0">
							<h2 class="truncate text-base font-semibold">
								{{ selected.displayName || selected.accountName }}
							</h2>
							<p class="truncate font-mono text-xs text-(--ui-text-muted)">
								{{ selected.accountCode }}
							</p>
						</div>
						<dl class="grid grid-cols-[minmax(5rem,auto)_1fr] items-baseline gap-x-4 gap-y-3 text-sm">
							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.system-user.columns.accountName") }}
							</dt>
							<dd class="break-all font-mono">
								{{ selected.accountName }}
							</dd>

							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.system-user.columns.accountCode") }}
							</dt>
							<dd class="break-all font-mono text-xs">
								{{ selected.accountCode }}
							</dd>

							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.system-user.columns.displayName") }}
							</dt>
							<dd>{{ selected.displayName }}</dd>

							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.system-user.columns.accountLevel") }}
							</dt>
							<dd>
								<UBadge :color="accountLevelColor(selected.accountLevel)" variant="subtle">
									{{ $t(accountLevelKey(selected.accountLevel), { level: selected.accountLevel }) }}
								</UBadge>
							</dd>

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
							<dd>{{ selected.mfaEnabled ? $t("pages.system-user.mfaOn") : $t("pages.system-user.mfaOff") }}</dd>

							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.system-user.columns.createdAt") }}
							</dt>
							<!-- 上游同一字段两种时区（UP-ACC-05）：原样展示，不换算也不加 (UTC) -->
							<dd class="font-mono text-xs">
								{{ selected.createdAt }}
							</dd>
						</dl>

						<p class="text-xs text-(--ui-text-muted)">
							{{ $t("pages.system-user.immutableHint") }}
						</p>
					</div>

					<!-- 无选中：右栏空态（D3）。「新建」只在工具栏一处入口（§4），空态里不再重复 -->
					<div v-else class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
						<UIcon name="carbon:document-blank" class="size-8 text-(--ui-text-muted)" />
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
			:account="statusTarget"
			:target-status="targetStatus"
			@updated="reload"
		/>
	</div>
</template>

<script setup lang="ts">
	import type { AccountStatus, AccountSummary } from "~~/shared/types/account";
	import type { TenantSummary } from "~~/shared/types/tenant";
	import { DEFAULT_PAGE_SIZE } from "~~/shared/constants/paging";
	import { ACCOUNT_LEVEL, ACCOUNT_STATUS, creatableAccountLevels } from "~~/shared/types/account";

	/**
	 * `/system/user` 用户管理（两栏落码，NMCPS-ADR-0017 迁移步骤 4）。
	 *
	 * 设计基准：NMCPS-ARCH-006 §3（`layers/content/collections/cn/architecture/1.architecture/ui-architecture.md`）
	 * 领域口径：NMCPS-DESIGN-005 §六（`layers/content/collections/cn/architecture/2.domain/system.md`）
	 * 上游缺陷：NMCPS-REC-002（`layers/content/collections/cn/records/defects/account-upstream-defects.md`）
	 *
	 * ── 决策矩阵：两个身份下本页暴露什么（实测口径，详见 §6.3）───────────────
	 * | 能力 | 超级管理员（level 0） | 租户管理员（level 1） |
	 * | :--- | :--- | :--- |
	 * | 列表范围 | 全平台 | 仅本租户（上游强约束） |
	 * | 筛选 keyword / status | 可用 | 可用（受租户范围约束） |
	 * | 筛选 accountLevel | 只提供「租户管理员」项：`0` 被上游当未提供（UP-ACC-02） | 同 |
	 * | 新建账号 | 可建 `L1`–`L3`，**必须选所属租户**（缺 `tenantId` → `10101`，UP-ACC-07） | 可建 `L2` / `L3`（同级 / 更高级回 `20103`） |
	 * | 变更状态 | 任意账号 | 本租户账号；跨租户上游回 `10301`（客户端不预判） |
	 * | 变更本人状态 | 禁用（防自锁） | 禁用（防自锁） |
	 * | 编辑资料 | 不提供：上游无 `PUT /account/{code}`（UP-ACC-04）→ 右栏无「编辑」入口 |
	 * | 删除账号 | 不提供：用「禁用」承接（`status=2`） |
	 * | 角色绑定 / 租户成员 | 不提供：超级管理员调 `/account/role` 恒 `10201`、列表无 `tenantId` 无法定位（UP-ACC-06） |
	 *
	 * 这些收敛**只是不引导用户踩上游缺口**，不是安全边界：BFF 只做白名单透传，鉴权仍在上游。
	 */
	definePageMeta({ sort: 1, icon: "carbon:user" });

	const { t } = useI18n();
	const { user, isSuperAdmin, loaded } = useAuth();
	const { list } = useAccounts();

	/** 当前形态（由 `Layout/Split.vue` 判定并外抛）：决定 `?id` 写历史时用 `replace` 还是 `push` */
	const shape = ref<"two" | "overlay">("two");

	const rows = ref<AccountSummary[]>([]);
	const total = ref(0);
	const page = ref(1);
	const pageSize = ref(DEFAULT_PAGE_SIZE);
	const loading = ref(false);
	const errorMessage = ref<string>();

	/**
	 * 列表展示顺序的**唯一来源**（NMCPS-ARCH-006 §3.6）：默认选中必须与展示顺序同源，
	 * 否则会出现「默认选中的不是第一行」。当前没有客户端排序（上游无排序参数），
	 * 因此这里只是把「顺序」具名化：将来加排序只改这一处，`defaultRecord` 自动跟随。
	 */
	function byListOrder(accountList: AccountSummary[]): AccountSummary[] {
		return accountList;
	}

	const displayRows = computed(() => byListOrder(rows.value));

	/**
	 * 记录选择契约（NMCPS-ARCH-006 §5.2 / NMCPS-ADR-0017 D2 / D6）：`?id` 是「当前选中哪条」的唯一事实源。
	 *
	 * - 命中判定只在当前页 `displayRows` 里做：上游没有详情端点，列表结果是唯一可靠来源；
	 *   `?id` **不进** `list()` 的请求参数，因此改选中 / 深链进入都不会重新拉列表。
	 * - `?id` 不在当前结果集时只出空态提示，**不静默翻页去捞**（会让筛选状态与 URL 不一致）。
	 * - `autoSelect` 开启：两栏形态落第一行（右栏默认只读，选中即得上下文）；覆盖式形态由
	 *   composable 自行跳过（否则首屏直接进详情，看不到列表）。
	 * - `createId: "new"`：`?id=new` 是「新建」状态（D6），不参与命中判定，也不报「记录不存在」。
	 */
	const selection = useRecordSelection<AccountSummary>({
		rows: displayRows,
		getId: (account) => account.accountCode,
		getLabel: (account) => account.displayName || account.accountName,
		isLoading: loading,
		isOverlay: () => shape.value === "overlay",
		autoSelect: true,
		defaultRecord: (accountList) => byListOrder(accountList)[0],
		createId: "new"
	});

	const { selectedId, selected, isMissing, isCreating, clear: clearSelection } = selection;

	const hasSelection = computed(() => !!selectedId.value);
	/** 右栏工具栏只在「有内容可操作」时渲染（D5：空工具栏不渲染背景与分隔线） */
	/**
	 * 工具栏内容跟随当前面板（NMCPS-ARCH-006 §4.4）：两栏 = 左区集合域 + 右区记录域同屏；
	 * 覆盖式列表态只给集合域动作（含「新建」），详情态左区换成唯一「返回」、右区只给记录域 / 提交域动作。
	 */
	const toolbarPane = computed<"list" | "detail">(() =>
		shape.value === "overlay" && (hasSelection.value || isCreating.value) ? "detail" : "list");

	/** 面包屑记录段（§5.1）：create 态显示「新建账号」，否则显示选中记录名 */
	const recordLabel = computed(() => isCreating.value
		? t("pages.system-user.createForm.title")
		: selection.label.value);

	const { clearRequests } = useRecordContext(recordLabel);

	// 记录段被点击 = 清除选择（工具栏不直接写 URL，URL 只由 useRecordSelection 写）
	watch(clearRequests, () => clearSelection());

	// ── 键盘：listbox 语义（§3.6 / D8）────────────────────────────────────────
	/** 行元素（`<li role="option">`）：`↑/↓/Home/End` 要能把焦点搬到目标行 */
	const rowElements = new Map<string, HTMLElement>();

	function setRowRef(code: string, element: unknown): void {
		if (element instanceof HTMLElement)
			rowElements.set(code, element);
		else
			rowElements.delete(code);
	}

	/** `↑/↓/Home/End` 移动焦点并同步选中（selection follows focus）；`Enter` / `Space` 由行自己处理 */
	function onListKeydown(event: KeyboardEvent): void {
		const codes = displayRows.value.map((account) => account.accountCode);
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
	/** 右栏工具栏的「创建」要驱动表单提交：模板 ref 拿子组件暴露的 `submit()` / `submitting` */
	const createFormRef = ref<{ submit: () => Promise<void>, submitting: boolean }>();
	const createSubmitting = computed(() => createFormRef.value?.submitting === true);

	/** 「新建」是集合域动作（左栏工具栏与右栏空态 CTA 是同一语义的两个入口）；覆盖式下 `push` 进详情 */
	function startCreate(): void {
		selection.set("new");
	}

	/**
	 * 建号成功（D3 / D6）：先把新账号就地 patch 进列表，再 `replace` `?id` 为真实标识，
	 * 最后静默刷新校准 —— 不重置滚动、不清空选中。
	 */
	function onCreated(account: AccountSummary): void {
		if (!account?.accountCode) {
			// 上游若没回账号体，只能靠重新拉列表来定位（不做猜测式选中）
			reload();
			return;
		}

		rows.value = [account, ...rows.value];
		total.value += 1;
		selection.set(account.accountCode);
		reload();
	}

	// ── 变更状态（危险动作在右栏工具栏，弹窗只确认）──────────────────────────
	const statusOpen = ref(false);
	const statusTarget = ref<AccountSummary | null>(null);

	/** 唯一可写的账号变更是状态：启用 ↔ 禁用（「锁定」由上游在失败登录时置位，页面不写） */
	const targetStatus = computed<AccountStatus>(() =>
		selected.value?.status === ACCOUNT_STATUS.ENABLED ? ACCOUNT_STATUS.DISABLED : ACCOUNT_STATUS.ENABLED);

	/** 本人账号：状态变更会自锁，按钮直接禁用 */
	function isSelf(account: AccountSummary): boolean {
		return !!user.value?.username && user.value.username === account.accountName;
	}

	function openStatus(): void {
		if (!selected.value || isSelf(selected.value))
			return;

		statusTarget.value = selected.value;
		statusOpen.value = true;
	}

	// ── 筛选 ──────────────────────────────────────────────────────────────────
	// 输入态与生效态分开：搜索防抖 300ms 才落生效（D2），改筛选一律回到第一页
	const keyword = ref("");
	/** `0` = 不限（上游会把 `status: 0` 报 `10101`，所以 `0` 不会被发出去） */
	const statusFilter = ref<number>(0);
	/** `0` = 不限；等级 `0`（超级管理员）不作为过滤值，见 UP-ACC-02 */
	const levelFilter = ref<number>(0);
	const applied = ref<{ keyword: string, status: number, level: number }>({ keyword: "", status: 0, level: 0 });

	const filtersActive = computed(() =>
		applied.value.keyword !== "" || applied.value.status !== 0 || applied.value.level !== 0);

	const statusFilterItems = computed(() => [
		{ label: t("pages.system-user.filter.anyStatus"), value: 0 },
		{ label: t("pages.system-user.status.enabled"), value: ACCOUNT_STATUS.ENABLED },
		{ label: t("pages.system-user.status.disabled"), value: ACCOUNT_STATUS.DISABLED },
		{ label: t("pages.system-user.status.locked"), value: ACCOUNT_STATUS.LOCKED },
		{ label: t("pages.system-user.status.pending"), value: ACCOUNT_STATUS.PENDING }
	]);

	/** 只提供有语义、且上游确实能过滤的等级：`0` 会被当「未提供」，`2`–`4` 语义未定义 */
	const levelFilterItems = computed(() => [
		{ label: t("pages.system-user.filter.anyLevel"), value: 0 },
		{ label: t("pages.system-user.level.tenantAdmin"), value: ACCOUNT_LEVEL.TENANT_ADMIN }
	]);

	/** 建号可选等级 = **严格低于自己且 ≤ 3**（2026-11-03 复测口径，NMCPS-DESIGN-005 §6.3） */
	const creatableLevels = computed(() =>
		creatableAccountLevels(ACCOUNT_LEVEL.TENANT_ADMIN));

	/**
	 * 建号等级下拉按身份推导：超级管理员 `L1`–`L3`、租户管理员 `L2`–`L3`。
	 *
	 * 2026-11-03 前这里写死「超级管理员 `0`/`1`、租户管理员只有 `1`」：上游改成
	 * 「只能向下管控」（同级 / 更高回 `20103`）之后，两种身份的下拉都只剩必被拒的值，
	 * 租户管理员建号 100% 失败。等级是上游归属层决定的，不该由页面写死。
	 */
	const levelOptions = computed(() => creatableLevels.value.map((level) => ({
		label: `L${level}`,
		value: level
	})));

	/** 超级管理员建号的「所属租户」候选（`GET /api/tenant`，UP-ACC-07）；租户管理员不需要 */
	const { list: listTenants } = useTenants();
	const tenants = ref<TenantSummary[]>([]);
	const tenantsLoading = ref(false);
	const tenantOptions = computed(() => tenants.value.map((tenant) => ({
		label: `${tenant.tenantName}（${tenant.tenantCode}）`,
		value: tenant.tenantId
	})));

	/** 只有超级管理员才拉租户列表：租户管理员的租户由上游按令牌推断，多发一次请求没有意义 */
	watch(isSuperAdmin, (superAdmin) => {
		if (!superAdmin || tenants.value.length || tenantsLoading.value)
			return;

		tenantsLoading.value = true;
		void listTenants()
			.then((list) => {
				tenants.value = list;
			})
			// 租户列表拉不到时不阻断列表：表单会因无候选而提交不了，提示语由表单给出
			.catch(() => {
				tenants.value = [];
			})
			.finally(() => {
				tenantsLoading.value = false;
			});
	}, { immediate: true });

	/**
	 * 身份说明三态：`0` / `1` 以外的等级（上游接受 `2`–`4` 但无语义）不能冒充租户管理员来说，
	 * 否则页面上写的「受租户范围约束」会变成未经验证的断言。
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

	// ── 取数 ──────────────────────────────────────────────────────────────────
	async function load(): Promise<void> {
		if (loading.value)
			return;

		loading.value = true;
		errorMessage.value = undefined;

		try {
			const result = await list({
				page: page.value,
				pageSize: pageSize.value,
				keyword: applied.value.keyword || undefined,
				// `0` 是「不限」哨兵：不能透传（`status: 0` → 10101、`accountLevel: 0` → 被忽略）
				status: applied.value.status || undefined,
				accountLevel: applied.value.level || undefined
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
	function applyFilters(): void {
		applied.value = {
			keyword: keyword.value.trim(),
			status: statusFilter.value,
			level: levelFilter.value
		};

		if (page.value !== 1) {
			page.value = 1;
			return;
		}

		reload();
	}

	function resetFilters(): void {
		keyword.value = "";
		statusFilter.value = 0;
		levelFilter.value = 0;
		applyFilters();
	}

	// 搜索框防抖 300ms（D2）：输入即生效，不需要再点「筛选」
	watchDebounced(keyword, () => applyFilters(), { debounce: 300 });
	// 两个下拉是离散选择，改完立刻生效
	watch([statusFilter, levelFilter], () => applyFilters());
	// 单页条数变化同样走 `applyFilters()`：换条数后 `page * pageSize` 的偏移必然错位，必须回第一页
	watch(pageSize, () => applyFilters());

	watch(page, () => {
		void load();
	});

	onMounted(() => {
		void load();
	});
</script>
