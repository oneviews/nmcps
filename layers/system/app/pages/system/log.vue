<template>
	<div class="flex min-h-0 flex-1 flex-col">
		<!--
			页面根显式取 `flex-1 min-h-0`（NMCPS-ARCH-006 §3.3）：definite height 链在这里落定。
			身份 / 范围说明放在详情栏顶部（NMCPS-DESIGN-005 §9.3），页面顶部只留工具栏与两栏骨架。
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
					左区常驻两个筛选控件（NMCPS-DESIGN-005 §9.3 第 2 条）：时间范围与类别决定「我看的是不是全量」，
					藏进浮层最容易把过滤后的 `total` 当全量读；其余标识类筛选留在浮层。
					常驻控件只占左区 ≤2 个、总宽 ≤45% 内容盒，控件一律用 Nuxt UI v4 原生组件
					（NMCPS-ARCH-006 §4.1），不自写等价控件；时间范围用 `Audit/RangePicker.vue`。
				-->
				<AuditRangePicker v-model="rangeModel" :label="rangeLabel" />

				<USelect
					v-model="categoryModel"
					:items="categoryItems"
					size="sm"
					class="w-32"
					:aria-label="$t('pages.system-log.filter.category')"
				/>

				<!--
					浮层：只有 swagger 列出的参数（`accountId` / `deviceCode` / `sessionId` / `traceId`）。
					上游没有 `keyword`、也不认 `result`（UP-AUD-03），所以不给搜索框 —— 摆了就等于承诺它能筛。
				-->
				<UPopover>
					<UButton
						size="sm"
						color="neutral"
						variant="ghost"
						icon="carbon:filter"
						:class="popoverFiltersActive ? 'text-primary' : ''"
						:aria-label="$t('pages.system-log.filter.title')"
					/>
					<template #content>
						<div class="w-64 space-y-3 p-3">
							<p class="text-xs font-medium">
								{{ $t("pages.system-log.filter.title") }}
							</p>

							<UInput
								v-model.number="accountIdFilter"
								type="number"
								min="1"
								size="sm"
								class="w-full"
								:placeholder="$t('pages.system-log.filter.accountPlaceholder')"
								:aria-label="$t('pages.system-log.filter.accountPlaceholder')"
							/>

							<!-- 三个标识都是「从别处粘一个 ID 过来定位」：上游确实按它们过滤，不是装饰 -->
							<UInput
								v-model="deviceCodeFilter"
								size="sm"
								class="w-full"
								autocomplete="off"
								:placeholder="$t('pages.system-log.filter.devicePlaceholder')"
								:aria-label="$t('pages.system-log.filter.devicePlaceholder')"
							/>

							<UInput
								v-model="sessionIdFilter"
								size="sm"
								class="w-full"
								autocomplete="off"
								:placeholder="$t('pages.system-log.filter.sessionPlaceholder')"
								:aria-label="$t('pages.system-log.filter.sessionPlaceholder')"
							/>

							<UInput
								v-model="traceIdFilter"
								size="sm"
								class="w-full"
								autocomplete="off"
								:placeholder="$t('pages.system-log.filter.tracePlaceholder')"
								:aria-label="$t('pages.system-log.filter.tracePlaceholder')"
							/>

							<UButton
								v-if="filtersActive"
								block
								size="sm"
								color="neutral"
								variant="subtle"
								:label="$t('pages.system-log.resetFilters')"
								@click="resetFilters"
							/>
						</div>
					</template>
				</UPopover>

				<UTooltip :text="$t('pages.system-log.refresh')">
					<UButton
						size="sm"
						color="neutral"
						variant="ghost"
						icon="carbon:renew"
						:loading="loading"
						:aria-label="$t('pages.system-log.refresh')"
						@click="reload"
					/>
				</UTooltip>
			</template>
		</Teleport>

		<!-- 右区 = 集合域的两个只读动作：校验链完整性、导出任务（都不是单条记录的动作） -->
		<Teleport to="#app-toolbar-right">
			<template v-if="toolbarPane === 'list'">
				<UTooltip :text="$t('pages.system-log.verify.hint')">
					<UButton
						size="sm"
						color="neutral"
						variant="outline"
						icon="carbon:data-check"
						:label="$t('pages.system-log.verify.open')"
						:loading="verifying"
						:disabled="!loaded"
						@click="runVerify"
					/>
				</UTooltip>
				<UButton
					size="sm"
					variant="outline"
					icon="carbon:download"
					:label="$t('pages.system-log.export.open')"
					:disabled="!loaded"
					@click="exportOpen = true"
				/>
			</template>
		</Teleport>

		<!-- 两栏骨架（NMCPS-ARCH-006 §3 / NMCPS-ADR-0017 D1） -->
		<LayoutSplit
			id="log"
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
						:title="$t('pages.system-log.loadFailed')"
						:description="errorMessage"
					>
						<template #actions>
							<UButton
								size="sm"
								color="neutral"
								variant="subtle"
								:label="$t('pages.system-log.retry')"
								@click="reload"
							/>
						</template>
					</UAlert>
				</div>

				<div v-else-if="loading && rows.length === 0" class="space-y-2 p-3">
					<USkeleton v-for="index in 5" :key="index" class="h-12 w-full" />
				</div>

				<div v-else-if="rows.length === 0" class="flex flex-col items-center gap-2 p-6 text-center">
					<UIcon name="carbon:list-checked" class="size-7 text-(--ui-text-muted)" />
					<p class="text-sm">
						{{ filtersActive ? $t("pages.system-log.emptyFiltered") : $t("pages.system-log.empty") }}
					</p>
				</div>

				<!-- 自建 listbox（§3.6 / D8）：行可聚焦、`Enter` / `Space` 选中、带 `aria-selected` -->
				<ul
					v-else
					role="listbox"
					:aria-label="$t('pages.system-log.listTitle')"
					class="flex flex-col"
					@keydown="onListKeydown"
				>
					<li
						v-for="(log, index) in rows"
						:key="log.logCode"
						:ref="(element) => setRowRef(log.logCode, element)"
						role="option"
						:aria-selected="log.logCode === selectedId"
						:tabindex="log.logCode === selectedId || (!selectedId && index === 0) ? 0 : -1"
						:title="`${log.action} · ${log.logCode}`"
						class="cursor-pointer border-s-2 px-3 py-2 outline-none transition-colors hover:bg-elevated focus-visible:bg-elevated focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
						:class="log.logCode === selectedId
							? 'border-primary bg-accented'
							: 'border-transparent'"
						@click="selection.select(log)"
						@keydown.enter.prevent="selection.select(log)"
						@keydown.space.prevent="selection.select(log)"
					>
						<div class="flex min-w-0 items-center justify-between gap-2">
							<p class="truncate text-sm font-medium">
								{{ log.action }}
							</p>
							<UBadge :color="auditResultColor(log.result)" variant="subtle" size="sm">
								{{ $t(auditResultKey(log.result), { result: log.result }) }}
							</UBadge>
						</div>
						<p class="truncate text-xs text-(--ui-text-muted)">
							{{ auditTimeOf(log.eventTime) }} · {{ $t(auditCategoryKey(log.category), { category: log.category }) }} · #{{ log.accountId }}
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
					{{ $t("pages.system-log.total", { total }) }}
				</LayoutListFooter>
			</template>

			<template #detail>
				<div class="flex min-h-full flex-col">
					<!--
						顶部固定块（滚动区之外）：身份 / 范围说明 + 校验结果。
						本域的越权边界在上游（BFF 只白名单透传），所以「谁能看什么」必须在页面里讲清楚，
						而不是等用户点开一条记录才收到 401。
					-->
					<div v-if="loaded" class="shrink-0 space-y-2 border-b border-(--ui-border) px-4 py-3">
						<UAlert
							color="info"
							variant="subtle"
							icon="carbon:information"
							:title="$t('pages.system-log.scope.title')"
							:description="scopeMessage"
						/>

						<UAlert
							v-if="verifyResult"
							:color="verifyEmpty ? 'warning' : verifyResult.intact ? 'success' : 'error'"
							variant="subtle"
							:icon="verifyEmpty ? 'carbon:information' : verifyResult.intact ? 'carbon:checkmark-filled' : 'carbon:warning-alt'"
							:title="$t('pages.system-log.verify.resultTitle')"
							:description="verifySummary"
						>
							<template #actions>
								<UButton
									size="xs"
									color="neutral"
									variant="subtle"
									:label="$t('pages.system-log.verify.dismiss')"
									@click="verifyResult = undefined"
								/>
							</template>
						</UAlert>
					</div>

					<div v-if="selected" class="max-w-[720px] space-y-4 p-4">
						<div class="space-y-1">
							<div class="flex flex-wrap items-center gap-2">
								<UBadge :color="auditCategoryColor(selected.category)" variant="subtle" size="sm">
									{{ $t(auditCategoryKey(selected.category), { category: selected.category }) }}
								</UBadge>
								<UBadge :color="auditResultColor(selected.result)" variant="subtle" size="sm">
									{{ $t(auditResultKey(selected.result), { result: selected.result }) }}
								</UBadge>
								<span class="font-mono text-xs text-(--ui-text-muted)">{{ selected.logCode }}</span>
							</div>
							<h2 class="text-base font-semibold break-all">
								{{ selected.action }}
							</h2>
							<p class="text-xs text-(--ui-text-muted)">
								{{ auditTimeOf(selected.eventTime) }}
							</p>
						</div>

						<UAlert
							v-if="detailError"
							color="error"
							variant="subtle"
							icon="carbon:warning-alt"
							:title="$t('pages.system-log.detailFailed')"
							:description="detailError"
						/>

						<USkeleton v-else-if="detailLoading" class="h-24 w-full" />

						<!-- 列表字段 + 详情字段：字段名沿用上游，空值统一显示 `—` -->
						<dl v-else class="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.system-log.detail.account") }}
							</dt>
							<dd>#{{ detail?.accountId ?? selected.accountId }}</dd>

							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.system-log.detail.clientIp") }}
							</dt>
							<dd class="break-all">
								{{ orDash(detail?.clientIp ?? selected.clientIp) }}
							</dd>

							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.system-log.detail.device") }}
							</dt>
							<dd class="break-all">
								{{ orDash(detail?.deviceCode ?? selected.deviceCode) }}
							</dd>

							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.system-log.detail.session") }}
							</dt>
							<dd class="break-all">
								{{ orDash(detail?.sessionId ?? selected.sessionId) }}
							</dd>

							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.system-log.detail.trace") }}
							</dt>
							<dd class="break-all">
								{{ orDash(detail?.traceId ?? selected.traceId) }}
							</dd>

							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.system-log.detail.resource") }}
							</dt>
							<dd class="break-all">
								{{ orDash(detail?.resource ?? selected.resource) }}
							</dd>

							<template v-if="detail">
								<dt class="text-(--ui-text-muted)">
									{{ $t("pages.system-log.detail.sourceService") }}
								</dt>
								<dd class="break-all">
									{{ orDash(detail.sourceService) }}
								</dd>
							</template>
						</dl>

						<!-- 链信息：`verify` 报断点时，靠这两段哈希去定位具体条目 -->
						<div class="space-y-1">
							<p class="text-xs font-medium">
								{{ $t("pages.system-log.detail.chain") }}
							</p>
							<p class="font-mono text-[11px] break-all text-(--ui-text-muted)">
								<span class="select-none">{{ $t("pages.system-log.detail.logHash") }}: </span>{{ orDash(detail?.logHash ?? selected.logHash) }}
							</p>
							<p v-if="detail?.prevHash" class="font-mono text-[11px] break-all text-(--ui-text-muted)">
								<span class="select-none">{{ $t("pages.system-log.detail.prevHash") }}: </span>{{ detail.prevHash }}
							</p>
						</div>

						<!-- 快照：实测三项恒为空串（UP-AUD-09），有值才渲染，避免摆三个空盒子 -->
						<div v-if="snapshots.length > 0" class="space-y-2">
							<p class="text-xs font-medium">
								{{ $t("pages.system-log.detail.snapshots") }}
							</p>
							<UAlert
								color="warning"
								variant="subtle"
								icon="carbon:warning-alt"
								:description="$t('pages.system-log.detail.snapshotsHint')"
							/>
							<div v-for="snapshot in snapshots" :key="snapshot.label">
								<p class="text-xs text-(--ui-text-muted)">
									{{ snapshot.label }}
								</p>
								<pre class="mt-1 max-h-48 overflow-auto rounded-md bg-elevated/40 p-2 text-[11px] leading-relaxed">{{ snapshot.value }}</pre>
							</div>
						</div>
					</div>

					<div v-else class="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
						<UIcon name="carbon:select-window" class="size-7 text-(--ui-text-muted)" />
						<p class="text-sm text-(--ui-text-muted)">
							{{ $t("pages.system-log.selectHint") }}
						</p>
					</div>
				</div>
			</template>
		</LayoutSplit>

		<AuditExportModal
			v-model:open="exportOpen"
			:default-start="applied.start"
			:default-end="applied.end"
			:category="applied.category"
			:account-id="applied.accountId"
		/>
	</div>
</template>

<script setup lang="ts">
	import type { AuditRangeValue } from "~~/layers/system/app/utils/auditDisplay";
	import type { AuditLog, AuditLogDetail, AuditVerifyResult } from "~~/shared/types/audit";
	import { DEFAULT_PAGE_SIZE } from "~~/shared/constants/paging";
	import { AUDIT_CATEGORY } from "~~/shared/types/audit";

	/**
	 * `/system/log` 审计日志（两栏落码，NMCPS-ADR-0017 迁移步骤 6）。
	 *
	 * 设计基准：NMCPS-DESIGN-005 §九（`layers/content/collections/cn/architecture/2.domain/system.md`）
	 * 界面骨架：NMCPS-ARCH-006（`layers/content/collections/cn/architecture/1.architecture/ui-architecture.md`）
	 * 上游缺陷：NMCPS-REC-004（`layers/content/collections/cn/records/defects/audit-upstream-defects.md`）
	 *
	 * ── 决策矩阵：两个身份下本页暴露什么（2026-11-02 实测）─────────────────────
	 * | 能力 | 超级管理员（level 0） | 租户管理员（level 1） |
	 * | :--- | :--- | :--- |
	 * | 列表 / 详情 | 全平台 | **可用，范围由上游按租户过滤**（同一时刻 total 1893 vs 1709） |
	 * | 校验哈希链 | 可用（写操作：自身 +1 条日志） | 同样可用（已复核 `code: 0`） |
	 * | 校验结果 | `checkedCount` 是真正校验的条数；零条窗口仍回 `intact: true`（UP-AUD-04）→ 0 条时按中性提示渲染 | 同左 |
	 * | 导出任务 | 可用（无详情端点，UP-AUD-07） | 同样可用 |
	 * | 筛选 category | 只给 `session` / `api`：其余取值被静默忽略并返回全量（UP-AUD-02） | 同左 |
	 * | 筛选 result / keyword | 不提供：上游静默忽略（UP-AUD-03），摆了就等于承诺能筛 | 同左 |
	 * | 单页条数 | 上限 100：`pageSize=500` 回 20 条却回显 500（UP-AUD-03） | 同左 |
	 *
	 * 这些收敛只是「不引导用户踩上游缺口」，不是安全边界：BFF 只做白名单透传，鉴权仍在上游。
	 * 早先记录的「租户管理员一律 401 10201」（UP-AUD-01）已作废：那是过期令牌造成的伪影。
	 */
	definePageMeta({ sort: 4, icon: "carbon:list" });

	const { t } = useI18n();
	const toast = useToast();
	const { isSuperAdmin, loaded } = useAuth();
	const { list: listLogs, get: getLog, verify: verifyChain } = useAuditLogs();

	/** 当前形态（由 `Layout/Split.vue` 判定并外抛）：决定 `?id` 写历史时用 `replace` 还是 `push` */
	const shape = ref<"two" | "overlay">("two");

	const rows = ref<AuditLog[]>([]);
	const total = ref(0);
	const page = ref(1);
	const pageSize = ref(DEFAULT_PAGE_SIZE);
	const loading = ref(false);
	const errorMessage = ref<string>();

	/**
	 * 读权限：两种身份都能读，差别只在**数据范围**。
	 *
	 * 2026-11-02 复核更正 UP-AUD-01：租户管理员调本域端点是 `code: 0`，上游按租户过滤
	 * （同一时刻超级管理员 `total` 1893、租户管理员 1709，且行内 `accountId` 只落在本租户）。
	 * 早先测得的「一律 401 10201」源自过期令牌，不是权限事实 —— 所以页面不按身份拦请求。
	 */
	const scopeMessage = computed(() => {
		if (!loaded.value)
			return "";

		return isSuperAdmin.value
			? t("pages.system-log.scope.superAdmin")
			: t("pages.system-log.scope.tenantAdmin");
	});

	const displayRows = computed(() => rows.value);

	/**
	 * 记录选择契约（NMCPS-ARCH-006 §5.2 / NMCPS-ADR-0017 D2 / D6）：`?id` 是「当前选中哪条」的唯一事实源。
	 *
	 * `getId` 用 `logCode`（`AUD…`），它同时是详情端点路径段；`?id` **不进** 列表请求参数，
	 * 所以改选中 / 深链进入都不会重新拉列表。`autoSelect` 让两栏形态默认落第一行。
	 */
	const selection = useRecordSelection<AuditLog>({
		rows: displayRows,
		getId: (log) => log.logCode,
		getLabel: (log) => log.action,
		isLoading: loading,
		isOverlay: () => shape.value === "overlay",
		autoSelect: true,
		defaultRecord: (logList) => logList[0]
	});

	const { selectedId, selected, clear: clearSelection } = selection;

	const hasSelection = computed(() => !!selectedId.value);

	/**
	 * 工具栏内容跟随当前面板（NMCPS-ARCH-006 §4.4）：两栏 = 左区集合域 + 右区集合域动作同屏；
	 * 覆盖式列表态只给集合域动作，详情态左区换成唯一「返回」、右区不给动作（本域无单条记录动作）。
	 */
	const toolbarPane = computed<"list" | "detail">(() =>
		shape.value === "overlay" && hasSelection.value ? "detail" : "list");

	const recordLabel = computed(() => selection.label.value);
	const { clearRequests } = useRecordContext(recordLabel);

	watch(clearRequests, () => clearSelection());

	// ── 键盘：listbox 语义（§3.6 / D8）────────────────────────────────────────
	const rowElements = new Map<string, HTMLElement>();

	function setRowRef(code: string, element: unknown): void {
		if (element instanceof HTMLElement)
			rowElements.set(code, element);
		else
			rowElements.delete(code);
	}

	/** `↑/↓/Home/End` 移动焦点并同步选中（selection follows focus）；`Enter` / `Space` 由行自己处理 */
	function onListKeydown(event: KeyboardEvent): void {
		const codes = displayRows.value.map((log) => log.logCode);
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
		void nextTick(() => rowElements.get(code)?.focus());
	}

	// ── 筛选 ──────────────────────────────────────────────────────────────────
	// 输入态与生效态分开：文本类防抖 300ms 才落生效（D2），改筛选一律回到第一页。
	// 只放上游真正认的参数：`result` / `keyword` 会被静默忽略（UP-AUD-03），所以没有搜索框。
	const categoryFilter = ref<string>("");
	/** `0` = 不限：`accountId=0` 被上游当「未提供」，哨兵值不透传 */
	const accountIdFilter = ref<number>(0);
	const deviceCodeFilter = ref<string>("");
	const sessionIdFilter = ref<string>("");
	const traceIdFilter = ref<string>("");
	const startFilter = ref<string>("");
	const endFilter = ref<string>("");
	/**
	 * 当前时间窗口命中哪个快捷项：只影响按钮文案与浮层高亮，不参与取数（取数只用 `start` / `end`）。
	 * 手改 `datetime-local` 或点日历选日时降级为 `custom`。
	 */
	const rangePreset = ref<AuditRangeValue["preset"]>("all");

	/**
	 * 时间范围控件的值（`components/Audit/RangePicker.vue`）：三个字段都落到上面已有的 ref，
	 * 组件只负责「点快捷项 / 选日历日期 / 手填时间」，取数仍由下面的 `watch` 统一落地。
	 */
	const rangeModel = computed<AuditRangeValue>({
		get: () => ({ start: startFilter.value, end: endFilter.value, preset: rangePreset.value }),
		set: (next) => {
			startFilter.value = next.start;
			endFilter.value = next.end;
			rangePreset.value = next.preset;
		}
	});

	const applied = ref<{
		category: string
		accountId: number
		deviceCode: string
		sessionId: string
		traceId: string
		start: string
		end: string
	}>({ category: "", accountId: 0, deviceCode: "", sessionId: "", traceId: "", start: "", end: "" });

	const filtersActive = computed(() =>
		applied.value.category !== ""
		|| applied.value.accountId !== 0
		|| applied.value.deviceCode !== ""
		|| applied.value.sessionId !== ""
		|| applied.value.traceId !== ""
		|| applied.value.start !== ""
		|| applied.value.end !== "");

	/**
	 * 浮层图标的高亮只看**还留在浮层里**的筛选项：时间与类别已常驻左区、自己就带着值，
	 * 若继续按 `filtersActive` 高亮，会出现「浮层里什么都没设却一直亮着」的误导。
	 */
	const popoverFiltersActive = computed(() =>
		applied.value.accountId !== 0
		|| applied.value.deviceCode !== ""
		|| applied.value.sessionId !== ""
		|| applied.value.traceId !== "");

	/** 只提供实测存在的两个类别：随便给个字符串会被上游静默忽略并返回全量（UP-AUD-02） */
	const categoryItems = computed(() => [
		{ label: t("pages.system-log.filter.anyCategory"), value: "any" },
		{ label: t("pages.system-log.category.session"), value: AUDIT_CATEGORY.SESSION },
		{ label: t("pages.system-log.category.api"), value: AUDIT_CATEGORY.API }
	]);

	/** `USelect` 需要空态可选项：用 `any` 哨兵而不是空串，避免「选中了但看不出选的是什么」 */
	const categoryModel = computed({
		get: () => applied.value.category || "any",
		set: (value: string) => {
			categoryFilter.value = value === "any" ? "" : value;
		}
	});

	/** 时间范围快捷项由 `Audit/RangePicker.vue` 渲染（文案键与 `AUDIT_RANGE_PRESETS` 逐项对应） */
	/**
	 * 常驻按钮文案 = 当前窗口摘要（`NMCPS-DESIGN-005` §9.3 第 2 条：范围必须一眼可见）。
	 *
	 * 三态：无边界 → 「全部时间」；命中快捷项 → 该项名称；手改区间 → 压缩文本（去掉年份，
	 * `MM-DD HH:mm → MM-DD HH:mm`），够窄又能看出窗口。
	 */
	const rangeLabel = computed(() => {
		if (!startFilter.value && !endFilter.value)
			return t("pages.system-log.filter.range.all");

		if (rangePreset.value !== "custom")
			return t(`pages.system-log.filter.range.${rangePreset.value}`);

		const compact = (value: string) => (value ? value.slice(5).replace("T", " ") : "…");
		return `${compact(applied.value.start)} → ${compact(applied.value.end)}`;
	});

	function describeError(error: unknown): string {
		const key = auditErrorKey(error);
		if (key)
			return t(key);

		return error instanceof ApiError && error.message
			? error.message
			: t("pages.system-log.errors.failed");
	}

	// ── 列表取数 ──────────────────────────────────────────────────────────────
	async function load(): Promise<void> {
		if (loading.value)
			return;

		loading.value = true;
		errorMessage.value = undefined;

		try {
			const result = await listLogs({
				page: page.value,
				pageSize: pageSize.value,
				category: applied.value.category || undefined,
				accountId: applied.value.accountId || undefined,
				deviceCode: applied.value.deviceCode || undefined,
				sessionId: applied.value.sessionId || undefined,
				traceId: applied.value.traceId || undefined,
				startTime: toAuditTimeParam(applied.value.start),
				endTime: toAuditTimeParam(applied.value.end)
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
			category: categoryFilter.value,
			accountId: Number(accountIdFilter.value) || 0,
			deviceCode: deviceCodeFilter.value.trim(),
			sessionId: sessionIdFilter.value.trim(),
			traceId: traceIdFilter.value.trim(),
			start: startFilter.value,
			end: endFilter.value
		};

		if (page.value !== 1) {
			page.value = 1;
			return;
		}

		reload();
	}

	function resetFilters(): void {
		categoryFilter.value = "";
		accountIdFilter.value = 0;
		deviceCodeFilter.value = "";
		sessionIdFilter.value = "";
		traceIdFilter.value = "";
		startFilter.value = "";
		endFilter.value = "";
		rangePreset.value = "all";
		applyFilters();
	}

	// 三个文本标识是「粘贴一个 ID 来定位」，防抖 300ms（D2）；其余是离散选择，改完立刻生效
	watchDebounced(
		[deviceCodeFilter, sessionIdFilter, traceIdFilter],
		() => applyFilters(),
		{ debounce: 300 }
	);
	// 单页条数变化同样走 `applyFilters()`：换条数后 `page * pageSize` 的偏移必然错位，必须回第一页
	watch([categoryFilter, accountIdFilter, startFilter, endFilter, pageSize], () => applyFilters());

	watch(page, () => {
		void load();
	});

	// 身份就绪后才取数：`loaded` 之前 `useAuth` 还没回 `whoami`，早发一次就是白跑一趟
	watch(loaded, () => {
		if (loaded.value)
			reload();
	}, { immediate: true });

	// ── 详情取数 ──────────────────────────────────────────────────────────────
	// 列表项已含 12 个字段；详情多出 `sourceService` / 快照 / `prevHash`，单独拉一次。
	// 实测快照三项恒为空串（UP-AUD-09），所以右栏「有值才渲染」，不摆空盒子。
	const detail = ref<AuditLogDetail>();
	const detailLoading = ref(false);
	const detailError = ref<string>();

	watch(selected, async (log) => {
		detail.value = undefined;
		detailError.value = undefined;

		if (!log)
			return;

		const code = log.logCode;
		detailLoading.value = true;

		try {
			const result = await getLog(code);
			// 快速连点时用当前选中做闸门，避免慢响应覆盖新记录
			if (selectedId.value === code)
				detail.value = result;
		} catch (error) {
			if (selectedId.value === code)
				detailError.value = describeError(error);
		} finally {
			if (selectedId.value === code)
				detailLoading.value = false;
		}
	}, { immediate: true });

	/** 有值才渲染的快照项（`beforeSnapshot` / `afterSnapshot` / `detailJson`） */
	const snapshots = computed(() => {
		const source = detail.value;
		if (!source)
			return [];

		return [
			{ label: t("pages.system-log.detail.beforeSnapshot"), value: source.beforeSnapshot },
			{ label: t("pages.system-log.detail.afterSnapshot"), value: source.afterSnapshot },
			{ label: t("pages.system-log.detail.detailJson"), value: source.detailJson }
		].filter((item) => !!item.value);
	});

	function orDash(value: string | number | undefined): string {
		return value === undefined || value === "" ? "—" : String(value);
	}

	// ── 校验哈希链（写操作）───────────────────────────────────────────────────
	const verifying = ref(false);
	const verifyResult = ref<AuditVerifyResult>();
	/** 本次校验用的窗口文本（结果横幅里要说清「校验的是哪一段」） */
	const verifyWindow = ref("");

	/**
	 * `POST /api/audit/verify` 是**写操作**：调用本身会新增一条 `api` 类审计日志（UP-AUD-05）。
	 * 所以它是显式按钮而不是「进页面自动跑」，跑完顺手重拉列表，让新增的那条可见。
	 */
	async function runVerify(): Promise<void> {
		if (verifying.value)
			return;

		const startTime = toAuditTimeParam(applied.value.start);
		const endTime = toAuditTimeParam(applied.value.end);

		// 单端区间在校验语义上没有定义（上游文档只写了「可选起止」），页面要求成对给出
		if (!!startTime !== !!endTime) {
			toast.add({ title: t("pages.system-log.verify.needRange"), color: "warning" });
			return;
		}

		verifying.value = true;

		try {
			verifyResult.value = await verifyChain({ startTime, endTime });
			verifyWindow.value = startTime
				? auditRangeLabel(applied.value.start, applied.value.end)
				: t("pages.system-log.verify.fullChain");

			await load();
		} catch (error) {
			toast.add({
				title: t("pages.system-log.verify.failed"),
				description: describeError(error),
				color: "error"
			});
		} finally {
			verifying.value = false;
		}
	}

	/**
	 * 空窗口的「链完整」是空真：上游对 0 条的窗口仍回 `intact: true` / `checkedCount: 0`（UP-AUD-05），
	 * 直接套绿色成功会让用户以为整条链没问题 —— 这种结果按中性提示渲染，文案明说校验了 0 条。
	 */
	const verifyEmpty = computed(() => !!verifyResult.value?.intact && verifyResult.value.checkedCount === 0);

	/**
	 * `brokenAtLogId` 是**整链序号**而不是 `logCode`（UP-AUD-05），所以文案只说「第 N 条」，
	 * 不去指认具体记录 —— 指错比不指更糟。
	 */
	const verifySummary = computed(() => {
		const result = verifyResult.value;
		if (!result)
			return "";

		if (verifyEmpty.value)
			return t("pages.system-log.verify.empty", { window: verifyWindow.value });

		return result.intact
			? t("pages.system-log.verify.intact", { count: result.checkedCount, window: verifyWindow.value })
			: t("pages.system-log.verify.broken", {
				count: result.checkedCount,
				index: result.brokenAtLogId,
				window: verifyWindow.value
			});
	});

	// ── 导出 ──────────────────────────────────────────────────────────────────
	const exportOpen = ref(false);
</script>
