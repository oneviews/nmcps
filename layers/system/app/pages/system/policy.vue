<template>
	<div class="flex min-h-0 flex-1 flex-col">
		<!--
			页面根显式取 `flex-1 min-h-0`（NMCPS-ARCH-006 §3.3）：definite height 链在这里落定。
			身份 / 范围说明下移到详情栏顶部（见 `#detail`，NMCPS-DESIGN-005 §7.3）：
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
				<!--
					上游 `GET /abac/rule` 没有 `keyword` 参数（UP-POL-04）：搜索在客户端做，
					因此先全量拉取再过滤，而不是把关键字发给上游假装它能筛。
				-->
				<UInput
					v-model="keyword"
					size="sm"
					icon="carbon:search"
					:placeholder="$t('pages.system-policy.keywordPlaceholder')"
					:aria-label="$t('pages.system-policy.keywordPlaceholder')"
					class="w-40 min-w-0 sm:w-56"
				/>

				<UTooltip :text="$t('pages.system-policy.refresh')">
					<UButton
						size="sm"
						color="neutral"
						variant="ghost"
						icon="carbon:renew"
						:loading="loading"
						:aria-label="$t('pages.system-policy.refresh')"
						@click="reload"
					/>
				</UTooltip>
			</template>
		</Teleport>

		<!--
			本域在新代没有任何写端点（`iam/roles` / `iam/policies` 的迁移见 C4c），
			因此右区不再挂「授权试算」按钮：`POST /access/dryrun` 在新代不存在（缺口 G5）。
		-->

		<!-- 两栏骨架（NMCPS-ARCH-006 §3 / NMCPS-ADR-0017 D1） -->
		<LayoutSplit
			id="policy"
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
						:title="$t('pages.system-policy.loadFailed')"
						:description="errorMessage"
					>
						<template #actions>
							<UButton
								size="sm"
								color="neutral"
								variant="subtle"
								:label="$t('pages.system-policy.retry')"
								@click="reload"
							/>
						</template>
					</UAlert>
				</div>

				<div v-else-if="loading && rows.length === 0" class="space-y-2 p-3">
					<USkeleton v-for="index in 5" :key="index" class="h-10 w-full" />
				</div>

				<div v-else-if="rows.length === 0" class="flex flex-col items-center gap-2 p-6 text-center">
					<UIcon name="carbon:rule" class="size-7 text-(--ui-text-muted)" />
					<p class="text-sm">
						{{ appliedKeyword ? $t("pages.system-policy.emptySearch") : $t("pages.system-policy.empty") }}
					</p>
				</div>

				<!-- 自建 listbox（§3.6 / D8）：行可聚焦、`Enter` / `Space` 选中、带 `aria-selected` -->
				<ul
					v-else
					role="listbox"
					:aria-label="$t('pages.system-policy.listTitle')"
					class="flex flex-col"
					@keydown="onListKeydown"
				>
					<li
						v-for="(rule, index) in pageRows"
						:key="rule.ruleId"
						:ref="(element) => setRowRef(String(rule.ruleId), element)"
						role="option"
						:aria-selected="String(rule.ruleId) === selectedId"
						:tabindex="String(rule.ruleId) === selectedId || (!selectedId && index === 0) ? 0 : -1"
						:title="`${rule.ruleName} · ${rule.ruleCode}`"
						class="cursor-pointer border-s-2 px-3 py-2 outline-none transition-colors hover:bg-elevated focus-visible:bg-elevated focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
						:class="String(rule.ruleId) === selectedId
							? 'border-primary bg-accented'
							: 'border-transparent'"
						@click="selection.select(rule)"
						@keydown.enter.prevent="selection.select(rule)"
						@keydown.space.prevent="selection.select(rule)"
					>
						<div class="flex min-w-0 items-center justify-between gap-2">
							<p class="truncate text-sm font-medium">
								{{ rule.ruleName }}
							</p>
							<UBadge :color="policyStatusColor(rule.status)" variant="subtle" size="sm">
								{{ $t(policyStatusKey(rule.status, 'pages.system-policy'), { status: rule.status }) }}
							</UBadge>
						</div>
						<p class="truncate font-mono text-xs text-(--ui-text-muted)">
							{{ rule.ruleCode }} · {{ $t("pages.system-policy.priorityShort", { priority: rule.priority }) }} · {{ rule.roleCode || $t("pages.system-policy.globalScope") }}
						</p>
					</li>
				</ul>
			</template>

			<!--
				列表尾部（滚动区之外）：计数 + 每页条数 + 分页（§3.8 / D2）。
				本页是全量加载后客户端过滤 + 客户端分页：分页只切渲染层，命中判定与 `?id` 深链仍对全量生效。
			-->
			<template #list-footer>
				<LayoutListFooter
					v-model:page="uiPage"
					v-model:page-size="pageSize"
					:total="rows.length"
					:disabled="loading"
				>
					{{ $t("pages.system-policy.total", { total: rows.length, all: allRules.length }) }}
				</LayoutListFooter>
			</template>

			<template #detail>
				<div class="flex min-h-full flex-col">
					<!--
						身份 / 范围说明（NMCPS-DESIGN-005 §7.3）：放在详情栏顶部，
						它回答的是「这条规则在什么范围内可信」，属于所选记录的上下文而不是页面级横幅；
						因此三种详情状态（含未选中空态）都在最上面看到它，覆盖式下随详情页一起出现。
					-->
					<div v-if="loaded" class="shrink-0 px-4 pt-4">
						<UAlert
							:color="scopeAlert.color"
							variant="subtle"
							icon="carbon:rule"
							:title="$t(scopeAlert.title)"
							:description="$t(scopeAlert.description)"
						/>
					</div>
					<!-- `?id` 不在当前 rows：零详情请求 + 一次提示，不清空 URL（D6） -->
					<div v-if="isMissing" class="p-4">
						<UAlert
							color="warning"
							variant="subtle"
							icon="carbon:unlink"
							:title="$t('pages.system-policy.selectionMissingTitle')"
							:description="$t('pages.system-policy.selectionMissing', { id: selectedId })"
						>
							<template #actions>
								<UButton
									size="sm"
									color="neutral"
									variant="subtle"
									:label="$t('pages.system-policy.selectionClear')"
									@click="clearSelection()"
								/>
							</template>
						</UAlert>
					</div>

					<!-- view 态：规则字段 + DSL 原文（只读，上游没有改 / 删端点） -->
					<div v-else-if="selected" class="max-w-[720px] space-y-5 p-4">
						<div class="min-w-0">
							<h2 class="truncate text-base font-semibold">
								{{ selected.ruleName }}
							</h2>
							<p class="truncate font-mono text-xs text-(--ui-text-muted)">
								{{ selected.ruleCode }}
							</p>
						</div>

						<dl class="grid grid-cols-[minmax(5rem,auto)_1fr] items-baseline gap-x-4 gap-y-3 text-sm">
							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.system-policy.columns.ruleId") }}
							</dt>
							<dd class="font-mono text-xs">
								{{ selected.ruleId }}
							</dd>

							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.system-policy.columns.roleCode") }}
							</dt>
							<!-- 空串 = 全局规则（上游用空串而不是 null，见 NMCPS-CONTRACT-001 §四） -->
							<dd class="font-mono text-xs">
								{{ selected.roleCode || $t("pages.system-policy.globalScope") }}
							</dd>

							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.system-policy.columns.priority") }}
							</dt>
							<dd>{{ selected.priority }}</dd>

							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.system-policy.columns.status") }}
							</dt>
							<dd>
								<UBadge :color="policyStatusColor(selected.status)" variant="subtle">
									{{ $t(policyStatusKey(selected.status, "pages.system-policy"), { status: selected.status }) }}
								</UBadge>
							</dd>
						</dl>

						<section class="space-y-2">
							<div class="flex items-center justify-between gap-2">
								<h3 class="text-sm font-semibold">
									{{ $t("pages.system-policy.columns.conditionDsl") }}
								</h3>
								<UButton
									size="xs"
									color="neutral"
									variant="ghost"
									icon="carbon:copy"
									:label="$t('pages.system-policy.copyDsl')"
									@click="copyDsl(selected.conditionDsl)"
								/>
							</div>
							<!-- 原样展示：上游不校验语法（UP-POL-02），这里也不做「美化」或「修正」 -->
							<pre class="overflow-x-auto rounded-md border border-(--ui-border) bg-elevated/40 p-3 font-mono text-xs whitespace-pre-wrap break-words">{{ selected.conditionDsl || $t("pages.system-policy.emptyDsl") }}</pre>
							<p class="text-xs text-(--ui-text-muted)">
								{{ $t("pages.system-policy.dslHint") }}
							</p>
						</section>

						<UAlert
							color="info"
							variant="subtle"
							icon="carbon:locked"
							:title="$t('pages.system-policy.readonlyTitle')"
							:description="$t('pages.system-policy.readonly')"
						/>
					</div>

					<!-- 无选中：右栏空态（D3） -->
					<div v-else class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
						<UIcon name="carbon:document-blank" class="size-8 text-(--ui-text-muted)" />
						<p class="text-sm font-medium">
							{{ $t("pages.system-policy.detailEmpty") }}
						</p>
						<p class="max-w-xs text-xs text-(--ui-text-muted)">
							{{ $t("pages.system-policy.detailEmptyHint") }}
						</p>
					</div>
				</div>
			</template>
		</LayoutSplit>
	</div>
</template>

<script setup lang="ts">
	import type { AbacRule } from "~~/shared/types/policy";
	import { DEFAULT_PAGE_SIZE } from "~~/shared/constants/paging";

	/**
	 * `/system/policy` 策略配置（两栏落码，NMCPS-ADR-0017 迁移步骤 6）。
	 *
	 * 设计基准：NMCPS-ARCH-006 §3（`layers/content/collections/cn/architecture/1.architecture/ui-architecture.md`）
	 * 领域口径：NMCPS-DESIGN-005 §七（`layers/content/collections/cn/architecture/2.domain/system.md`）
	 * 上游缺陷：NMCPS-REC-003（`layers/content/collections/cn/records/defects/policy-upstream-defects.md`）
	 *
	 * ── 决策矩阵：本页只读的理由（实测口径，详见 §7.3）─────────────────────────
	 * | 能力 | 超级管理员（level 0） | 租户管理员（level 1） |
	 * | :--- | :--- | :--- |
	 * | 规则列表 | 不提供：策略域四端点全部 `401 10201`（UP-POL-08） | 可用（`page` / `pageSize` 之外没有过滤参数） |
	 * | 关键字搜索 | 不提供 | 客户端过滤：上游不接受 `keyword`（UP-POL-04） |
	 * | 新建规则 | 不提供 | **不提供**：规则建了既不能改也不能删（`PUT`/`DELETE` 实测 `404`，UP-POL-01），且 `conditionDsl` 不做语法校验（UP-POL-02） |
	 * | 修改 / 删除规则 | 不提供 | 不提供：同上，端点不存在 |
	 * | 启停规则 | 不提供 | 不提供：`status` 只能由上游改库 |
	 * | 授权试算 | 不提供 | **下线**：`POST /access/dryrun` 在新代不存在（缺口 G5），入口与弹窗一并移除 |
	 *
	 * 这些收敛**只是不引导用户踩上游缺口**，不是安全边界：BFF 只做白名单透传，鉴权仍在上游。
	 * 尤其「新建规则」：一个只能创建、不能回收的写入口，比没有入口更危险，故本页不提供。
	 */
	definePageMeta({ sort: 2, icon: "carbon:rule" });

	const { t } = useI18n();
	const toast = useToast();
	const { user, isSuperAdmin, loaded } = useAuth();
	const { listRules } = usePolicies();

	/** 当前形态（由 `Layout/Split.vue` 判定并外抛）：决定 `?id` 写历史时用 `replace` 还是 `push` */
	const shape = ref<"two" | "overlay">("two");

	/** 全量规则（上游无 keyword 参数，搜索只能在客户端做，因此必须先拉全） */
	const allRules = ref<AbacRule[]>([]);
	const loading = ref(false);
	const errorMessage = ref<string>();

	/** 上游分页拉全的上限：防御 `total` 异常导致的死循环 */
	const MAX_RULE_PAGES = 10;

	// ── 筛选（客户端）──────────────────────────────────────────────────────────
	/** 输入态与生效态分开：搜索防抖 300ms 才落生效（D2） */
	const keyword = ref("");
	const appliedKeyword = ref("");

	/** 展示行 = 过滤 + 稳定排序；列表渲染与默认选中都只依赖它（§3.6） */
	const displayRows = computed(() => {
		const needle = appliedKeyword.value.trim().toLowerCase();
		const matched = needle
			? allRules.value.filter((rule) =>
				[rule.ruleCode, rule.ruleName, rule.roleCode, rule.conditionDsl]
					.some((field) => field.toLowerCase().includes(needle)))
			: allRules.value;

		// 上游语义「priority 越小越先匹配」：列表按匹配顺序展示，页面上不需要再解释一次
		return byAbacPriority(matched);
	});

	/**
	 * 命中全集：`?id` 命中判定与默认选中都以它为准（NMCPS-ARCH-006 §3.8 的客户端分页例外）。
	 * 若换成切片后的 `pageRows`，第 2 页上的深链会被判成「记录不存在」。
	 */
	const rows = computed(() => displayRows.value);

	// ── 客户端分页（§3.8）：切片只作用于渲染层 ────────────────────────────────
	/** 界面分页游标（与 `loadAll()` 里的上游取数页无关） */
	const uiPage = ref(1);
	const pageSize = ref(DEFAULT_PAGE_SIZE);

	const pageRows = computed(() => {
		const start = (uiPage.value - 1) * pageSize.value;
		return rows.value.slice(start, start + pageSize.value);
	});

	/** 命中集合或条数变化后，游标可能已越界（如搜索把 3 页缩成 1 页）：夹回最后一页 */
	watch([rows, pageSize], () => {
		const lastPage = Math.max(1, Math.ceil(rows.value.length / pageSize.value));
		if (uiPage.value > lastPage)
			uiPage.value = lastPage;
	});

	/**
	 * 记录选择契约（NMCPS-ARCH-006 §5.2 / D2 / D6）：`?id` = `ruleId`。
	 *
	 * - 命中判定只在当前 `rows` 里做，`?id` **不进** `listRules()` 的请求参数；
	 * - 客户端搜索把记录过滤掉时落「不在当前结果内」空态，不静默改搜索条件去捞；
	 * - 本页没有 create 态：上游不允许新建规则（UP-POL-01），故不传 `createId`。
	 */
	const selection = useRecordSelection<AbacRule>({
		rows,
		getId: (rule) => String(rule.ruleId),
		getLabel: (rule) => rule.ruleName,
		isLoading: loading,
		isOverlay: () => shape.value === "overlay",
		autoSelect: true,
		defaultRecord: (ruleList) => ruleList[0]
	});

	const { selectedId, selected, isMissing, clear: clearSelection } = selection;

	const hasSelection = computed(() => !!selectedId.value);

	/** 工具栏内容跟随当前面板（NMCPS-ARCH-006 §4.4） */
	const toolbarPane = computed<"list" | "detail">(() =>
		shape.value === "overlay" && hasSelection.value ? "detail" : "list");

	/** 面包屑记录段（§5.1）：选中规则的名称 */
	const recordLabel = computed(() => selection.label.value);

	const { clearRequests } = useRecordContext(recordLabel);

	watch(clearRequests, () => clearSelection());

	// ── 身份口径 ──────────────────────────────────────────────────────────────
	/** 策略域对超级管理员不开放（四端点全 `401 10201`，UP-POL-08）：入口处就说清楚，不发注定失败的请求 */
	const canUseDomain = computed(() => !!user.value && !isSuperAdmin.value);

	/** 身份说明三态：`0` / `1` 以外的等级不能冒充租户管理员来讲范围约束 */
	const scopeAlert = computed<{ color: "neutral" | "info" | "warning", title: string, description: string }>(() => {
		if (!!user.value && isSuperAdmin.value) {
			return {
				color: "neutral",
				title: "pages.system-policy.scopeSuperAdminTitle",
				description: "pages.system-policy.scopeSuperAdmin"
			};
		}

		if (!!user.value && !isSuperAdmin.value) {
			return {
				color: "info",
				title: "pages.system-policy.scopeTenantAdminTitle",
				description: "pages.system-policy.scopeTenantAdmin"
			};
		}

		return {
			color: "warning",
			title: "pages.system-policy.scopeUnknownTitle",
			description: "pages.system-policy.scopeUnknown"
		};
	});

	// ── 键盘：listbox 语义（NMCPS-ARCH-006 §3.6 / D8）────────────────────────
	const rowElements = new Map<string, HTMLElement>();

	function setRowRef(id: string, element: unknown): void {
		if (element instanceof HTMLElement)
			rowElements.set(id, element);
		else
			rowElements.delete(id);
	}

	/** `↑/↓/Home/End` 移动焦点并同步选中（selection follows focus）；`Enter` / `Space` 由行自己处理 */
	function onListKeydown(event: KeyboardEvent): void {
		// 键盘只在**当前页可见行**里移动：跨页跳转会让焦点落到屏幕外的行上
		const ids = pageRows.value.map((rule) => String(rule.ruleId));
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
		void nextTick(() => rowElements.get(id)?.focus());
	}

	// ── 取数 ──────────────────────────────────────────────────────────────────
	function describeError(error: unknown): string {
		const key = policyErrorKey(error, "pages.system-policy");
		if (key)
			return t(key);

		return error instanceof ApiError && error.message
			? error.message
			: t("pages.system-policy.errors.failed");
	}

	/**
	 * 全量规则：逐页累加到不足一页为止。
	 *
	 * 为什么不吃首页就算：客户端搜索必须覆盖全部规则，只搜当前页会让「搜不到」变成假结论。
	 * `MAX_RULE_PAGES` 是 `total` 异常时的兜底，不是产品上限。
	 */
	async function loadAll(): Promise<void> {
		// 超管调策略域恒 `401 10201`（UP-POL-08）：不发这次注定失败的请求，理由由页面级 Alert 说明
		if (!canUseDomain.value || loading.value)
			return;

		loading.value = true;
		errorMessage.value = undefined;

		/**
		 * 一次拉多少条（与界面上的「每页条数」无关）：界面分页是客户端切片，见 `rows` / `pageRows`。
		 * 取 100 是为了少跑几轮请求，同时不超过上游隐性上限（UP-AUD-03 同族问题）。
		 */
		const FETCH_PAGE_SIZE = 100;
		const collected: AbacRule[] = [];

		try {
			// 注意：这里的 `page` 是**上游取数页**，与界面上的客户端分页游标无关（后者叫 `uiPage`）
			for (let page = 1; page <= MAX_RULE_PAGES; page++) {
				const result = await listRules(page, FETCH_PAGE_SIZE);
				const chunk = result.list ?? [];
				collected.push(...chunk);

				if (chunk.length < FETCH_PAGE_SIZE || collected.length >= (result.total ?? 0))
					break;
			}

			allRules.value = collected;
		} catch (error) {
			allRules.value = [];
			errorMessage.value = describeError(error);
		} finally {
			loading.value = false;
		}
	}

	function reload(): void {
		void loadAll();
	}

	/** 生效态落定：客户端过滤，不触发任何请求；游标回第一页（换命中集合后旧页码无意义） */
	function applyKeyword(): void {
		appliedKeyword.value = keyword.value.trim();
		uiPage.value = 1;
	}

	// 搜索框防抖 300ms（D2）：输入即生效，不需要再点「筛选」
	watchDebounced(keyword, () => applyKeyword(), { debounce: 300 });

	/** 复制 DSL 原文：`navigator.clipboard` 在非安全上下文不可用，失败要说出口而不是静默 */
	async function copyDsl(dsl: string): Promise<void> {
		if (!dsl)
			return;

		try {
			await navigator.clipboard.writeText(dsl);
			toast.add({ title: t("pages.system-policy.copied"), color: "success" });
		} catch {
			toast.add({ title: t("pages.system-policy.copyFailed"), color: "error" });
		}
	}

	onMounted(() => {
		void loadAll();
	});
</script>
