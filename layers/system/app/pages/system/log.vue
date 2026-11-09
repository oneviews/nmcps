<template>
	<div class="flex min-h-0 flex-1 flex-col">
		<!--
			页面根显式取 `flex-1 min-h-0`（NMCPS-ARCH-006 §3.3）：definite height 链在这里落定。
			可见范围说明放在详情栏顶部（NMCPS-DESIGN-005 §9.3），页面顶部只留工具栏与两栏骨架。
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
					左区常驻两个筛选控件（NMCPS-DESIGN-005 §9.3 第 2 条）：时间范围与日志族决定
					「我看的是不是全量」，藏进浮层最容易把过滤后的 `total` 当全量读；其余标识类筛选留在浮层。
					常驻控件 ≤2 个、总宽 ≤45% 内容盒，控件一律用 Nuxt UI v4 原生组件（NMCPS-ARCH-006 §4.1）。
					归档记录没有时间条件（`/audit/archive/records` 只认 table_name / status），所以按族隐藏。
				-->
				<AuditRangePicker v-if="kind !== AUDIT_LOG_KIND.ARCHIVE" v-model="rangeModel" :label="rangeLabel" />

				<USelect
					v-model="kindModel"
					:items="kindItems"
					size="sm"
					class="w-32"
					:aria-label="$t('pages.system-log.filter.kind')"
				/>

				<!-- 浮层：只放本族 openapi 真正列出的筛选参数（各族不同，见 FILTER_SPECS） -->
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
								v-for="spec in filterSpecs"
								:key="spec.key"
								v-model="filterValues[spec.key]"
								size="sm"
								class="w-full"
								autocomplete="off"
								:placeholder="$t(spec.label)"
								:aria-label="$t(spec.label)"
							/>

							<UButton
								v-if="popoverFiltersActive"
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

		<!--
			右区 = 集合域动作：归档取代了旧代的导出（新代没有导出端点，NMCPS-ADR-0018 G7）。
			归档是写操作，只对两张日志表有意义，查看归档记录本身时不给入口。
		-->
		<Teleport to="#app-toolbar-right">
			<template v-if="toolbarPane === 'list' && kind !== AUDIT_LOG_KIND.ARCHIVE">
				<UTooltip :text="$t('pages.system-log.archive.hint')">
					<UButton
						size="sm"
						variant="outline"
						icon="carbon:archive"
						:label="$t('pages.system-log.archive.open')"
						:disabled="!loaded"
						@click="archiveOpen = true"
					/>
				</UTooltip>
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
					<LayoutListRow
						v-for="(row, index) in displayRows"
						:key="row.id"
						:ref="(element) => setRowRef(row.id, element)"
						:label="row.title"
						:subtitle="row.subtitle || row.id"
						:selected="row.id === selectedId"
						:tabindex="row.id === selectedId || (!selectedId && index === 0) ? 0 : -1"
						:title="`${row.title} · ${row.id}`"
						@select="selection.select(row.record)"
					>
						<template #badge>
							<UBadge v-if="row.badge" :color="row.tone" variant="subtle" size="sm">
								{{ row.badge }}
							</UBadge>
						</template>
					</LayoutListRow>
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
						顶部固定块（滚动区之外）：可见范围 + 字段口径说明。
						本域的越权边界在上游（BFF 只白名单透传），所以「谁能看什么」必须在页面里讲清楚；
						操作 / 安全日志的条目字段集合未实测（见 shared/types/audit.ts 文件头），
						也要在用户看到空白字段之前先说明，避免被当成「系统没记」。
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
							v-if="shapeUnverified"
							color="warning"
							variant="subtle"
							icon="carbon:warning-alt"
							:title="$t('pages.system-log.scope.shapeTitle')"
							:description="$t('pages.system-log.scope.shape')"
						/>
					</div>

					<div v-if="selected" class="max-w-[720px] space-y-4 p-4">
						<div class="space-y-1">
							<div class="flex flex-wrap items-center gap-2">
								<UBadge color="neutral" variant="subtle" size="sm">
									{{ $t(`pages.system-log.kind.${kind}`) }}
								</UBadge>
								<UBadge v-if="selectedRow?.badge" :color="selectedRow.tone" variant="subtle" size="sm">
									{{ selectedRow.badge }}
								</UBadge>
								<span class="font-mono text-xs break-all text-(--ui-text-muted)">{{ selected.id }}</span>
							</div>
							<h2 class="text-base font-semibold break-all">
								{{ selectedRow?.title }}
							</h2>
							<p class="text-xs text-(--ui-text-muted)">
								{{ selectedRow?.subtitle }}
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

						<!-- 已登记字段：字段名沿用上游，空值统一显示 `—`（缺失 ≠ 上游缺陷） -->
						<dl v-else class="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
							<template v-for="field in detailFields" :key="field.key">
								<dt class="text-(--ui-text-muted)">
									{{ $t(`pages.system-log.${field.label}`) }}
								</dt>
								<dd class="break-all">
									{{ orDash(field.value) }}
								</dd>
							</template>
						</dl>

						<!--
							未登记字段原样展示：上游多给的字段不该被页面静默丢掉。
							这一段出现时，说明条目结构与 `AuditOperationLog` / `AuditSecurityLog` 的登记不一致
							（那两个类型的字段集合尚未实测），照实列出比猜它属于哪个字段更可靠。
						-->
						<div v-if="extraFields.length > 0" class="space-y-2">
							<p class="text-xs font-medium">
								{{ $t("pages.system-log.detail.extra") }}
							</p>
							<dl class="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 font-mono text-[11px]">
								<template v-for="field in extraFields" :key="field.key">
									<dt class="text-(--ui-text-muted)">
										{{ field.key }}
									</dt>
									<dd class="break-all">
										{{ orDash(field.value) }}
									</dd>
								</template>
							</dl>
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

		<!-- 归档确认（写操作，不可撤销）：先讲清后果再给主按钮，不用 toast 一闪而过 -->
		<UModal v-model:open="archiveOpen" :title="$t('pages.system-log.archive.title')">
			<template #body>
				<div class="space-y-3">
					<p class="text-sm">
						{{ $t("pages.system-log.archive.description") }}
					</p>
					<UAlert
						color="warning"
						variant="subtle"
						icon="carbon:warning-alt"
						:description="$t('pages.system-log.archive.warning')"
					/>
					<UAlert
						v-if="archiveResult"
						color="success"
						variant="subtle"
						icon="carbon:checkmark-filled"
						:description="archiveSummary"
					/>
				</div>
			</template>

			<template #footer>
				<div class="flex w-full justify-end gap-2">
					<UButton
						color="neutral"
						variant="ghost"
						:label="$t('pages.system-log.archive.close')"
						@click="archiveOpen = false"
					/>
					<UButton
						icon="carbon:archive"
						:label="$t('pages.system-log.archive.run')"
						:loading="archiving"
						@click="runArchive"
					/>
				</div>
			</template>
		</UModal>
	</div>
</template>

<script setup lang="ts">
	import type { AuditRangePreset, AuditRangeValue } from "~~/layers/system/app/utils/auditDisplay";
	import type {
		AuditArchiveRecord,
		AuditLogKind,
		AuditOperationLog,
		AuditRunArchiveResult,
		AuditSecurityLog
	} from "~~/shared/types/audit";
	import { DEFAULT_PAGE_SIZE } from "~~/shared/constants/paging";
	import { AUDIT_LOG_KIND } from "~~/shared/types/audit";

	/**
	 * `/system/log` 审计日志（两栏落码，NMCPS-ADR-0017 迁移步骤 6；代际 C4b）。
	 *
	 * 设计基准：NMCPS-DESIGN-005 §九（`layers/content/collections/cn/architecture/2.domain/system.md`）
	 * 界面骨架：NMCPS-ARCH-006（`layers/content/collections/cn/architecture/1.architecture/ui-architecture.md`）
	 * 代际口径：NMCPS-ADR-0018 §三 / D2（审计域从单端点 `category` 拆成三族端点）
	 *
	 * ── 三族一页（2026-11-04 实测）──────────────────────────────────────────────
	 * | 族 | 列表端点 | 时间参数 | 详情主键 | 结果字段 |
	 * | :--- | :--- | :--- | :--- | :--- |
	 * | 操作日志 | `GET /audit/operation-logs` | `created_from` / `created_to`（epoch 毫秒） | `id`（UUID） | `status` |
	 * | 安全日志 | `GET /audit/security-logs` | `logged_from` / `logged_to`（epoch 毫秒） | `id`（UUID） | `auth_decision` |
	 * | 归档记录 | `GET /audit/archive/records` | **无时间条件** | `id`（UUID） | `status` |
	 *
	 * ── 旧代能力去哪儿了（缺口 G6 / G7，NMCPS-ADR-0018 §五）──────────────────────
	 * - 哈希链校验（`POST /audit/verify`）：新代**无对应端点** → 入口退役；
	 * - 导出任务（`GET|POST /audit/export`）：新代**无对应端点** → 换成归档
	 *   （`POST /audit/archive/run` + 归档记录列表），也是右区唯一动作的来源。
	 *
	 * ── 字段口径的诚实边界 ─────────────────────────────────────────────────────
	 * 操作 / 安全日志的**条目字段集合无法实测**：该实例审计库为空（`list: null`），IAM 写操作也不
	 * 产生审计行，swagger 只把响应描述成 `audit_BaseResp`。所以这两族的详情按「已登记字段清单 +
	 * 未登记字段原样段」渲染，缺失一律显示 `—`，页面顶部同时挂一条口径说明（§9.3）。
	 * 归档记录的字段集合已实测（真跑一次归档后回读），因此不带那条说明。
	 */
	definePageMeta({ sort: 4, icon: "carbon:list" });

	const { t } = useI18n();
	const toast = useToast();
	const { isSuperAdmin, loaded } = useAuth();
	const { listOperationLogs, getOperationLog, listSecurityLogs, getSecurityLog } = useAuditLogs();
	const { listRecords, getRecord, run: runArchiveJob } = useAuditArchive();

	/** 三族记录的联合类型：列表按族取，行渲染走 `auditRowOf()` 的族分支 */
	type AuditRow = AuditOperationLog | AuditSecurityLog | AuditArchiveRecord;

	/** 当前形态（由 `Layout/Split.vue` 判定并外抛）：决定 `?id` 写历史时用 `replace` 还是 `push` */
	const shape = ref<"two" | "overlay">("two");

	const kind = ref<AuditLogKind>(AUDIT_LOG_KIND.OPERATION);

	const rows = ref<AuditRow[]>([]);
	const total = ref(0);
	const page = ref(1);
	const pageSize = ref(DEFAULT_PAGE_SIZE);
	const loading = ref(false);
	const errorMessage = ref<string>();

	/** 各族日志的族名（常驻下拉的候选项）：只有这三项，不提供自由输入 */
	const kindItems = computed(() => [
		{ label: t("pages.system-log.kind.operation"), value: AUDIT_LOG_KIND.OPERATION },
		{ label: t("pages.system-log.kind.security"), value: AUDIT_LOG_KIND.SECURITY },
		{ label: t("pages.system-log.kind.archive"), value: AUDIT_LOG_KIND.ARCHIVE }
	]);

	/** 每族真正可用的筛选参数（顺序即浮层里的顺序，openapi 逐项核对过） */
	const FILTER_SPECS: Record<AuditLogKind, { key: string, label: string }[]> = {
		[AUDIT_LOG_KIND.OPERATION]: [
			{ key: "keyword", label: "pages.system-log.filter.keyword" },
			{ key: "username", label: "pages.system-log.filter.username" },
			{ key: "module", label: "pages.system-log.filter.module" },
			{ key: "status", label: "pages.system-log.filter.status" }
		],
		[AUDIT_LOG_KIND.SECURITY]: [
			{ key: "subject_name", label: "pages.system-log.filter.subjectName" },
			{ key: "action", label: "pages.system-log.filter.action" },
			{ key: "auth_decision", label: "pages.system-log.filter.authDecision" },
			{ key: "ip_address", label: "pages.system-log.filter.ip" }
		],
		[AUDIT_LOG_KIND.ARCHIVE]: [
			{ key: "table_name", label: "pages.system-log.filter.tableName" },
			{ key: "status", label: "pages.system-log.filter.status" }
		]
	};

	const filterSpecs = computed(() => FILTER_SPECS[kind.value]);

	/** 浮层输入框的输入态（防抖 300ms 才落生效，D2） */
	const filterValues = reactive<Record<string, string>>({
		keyword: "",
		username: "",
		module: "",
		status: "",
		subject_name: "",
		action: "",
		auth_decision: "",
		ip_address: "",
		table_name: ""
	});

	/** 生效态：只保留当前族用得到的键（切族时不把别族的残留值发出去） */
	const appliedFilters = ref<Record<string, string>>({});

	const startFilter = ref<string>("");
	const endFilter = ref<string>("");
	/** 当前窗口命中哪个快捷项：只影响按钮文案与浮层高亮，不参与取数（取数只用 start / end） */
	const rangePreset = ref<AuditRangePreset | "custom">("all");
	const appliedStart = ref<string>("");
	const appliedEnd = ref<string>("");

	const filtersActive = computed(() =>
		Object.keys(appliedFilters.value).length > 0
		|| (kind.value !== AUDIT_LOG_KIND.ARCHIVE && (appliedStart.value !== "" || appliedEnd.value !== "")));

	/**
	 * 浮层图标的高亮只看**还留在浮层里**的筛选项：时间与族名已常驻左区、自己就带着值，
	 * 若继续按 `filtersActive` 高亮，会出现「浮层里什么都没设却一直亮着」的误导。
	 */
	const popoverFiltersActive = computed(() => Object.keys(appliedFilters.value).length > 0);

	/** 时间范围控件（`components/Audit/RangePicker.vue`）的值：三个字段都落到上面已有的 ref */
	const rangeModel = computed<AuditRangeValue>({
		get: () => ({ start: startFilter.value, end: endFilter.value, preset: rangePreset.value }),
		set: (next) => {
			startFilter.value = next.start;
			endFilter.value = next.end;
			rangePreset.value = next.preset;
		}
	});

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
		return `${compact(appliedStart.value)} → ${compact(appliedEnd.value)}`;
	});

	/** 三族记录共同的展示名：列表行主标题（面包屑记录段也用它） */
	function labelOf(record: AuditRow): string {
		return auditRowOf(kind.value, record).title;
	}

	const kindModel = computed({
		get: () => kind.value,
		set: (value: AuditLogKind) => {
			kind.value = value;
		}
	});

	function describeError(error: unknown): string {
		const key = auditErrorKey(error);
		if (key)
			return t(key);

		return error instanceof ApiError && error.message
			? error.message
			: t("pages.system-log.errors.failed");
	}

	/** 生效态里取某个筛选值（空串视作「没设」，不发给上游） */
	function filterValue(key: string): string | undefined {
		const value = appliedFilters.value[key];
		return value || undefined;
	}

	// ── 列表取数 ──────────────────────────────────────────────────────────────
	async function load(): Promise<void> {
		if (loading.value)
			return;

		loading.value = true;
		errorMessage.value = undefined;

		try {
			// 三族的端点、筛选参数、时间参数各不相同，这里按族分支，不做「一套参数打三处」的假设
			let result: { list: AuditRow[] | null, total: number };

			if (kind.value === AUDIT_LOG_KIND.ARCHIVE) {
				result = await listRecords({
					page: page.value,
					page_size: pageSize.value,
					table_name: filterValue("table_name"),
					status: filterValue("status")
				});
			} else if (kind.value === AUDIT_LOG_KIND.SECURITY) {
				result = await listSecurityLogs({
					page: page.value,
					page_size: pageSize.value,
					subject_name: filterValue("subject_name"),
					action: filterValue("action"),
					auth_decision: filterValue("auth_decision"),
					ip_address: filterValue("ip_address"),
					logged_from: auditEpochMs(appliedStart.value),
					logged_to: auditEpochMs(appliedEnd.value)
				});
			} else {
				result = await listOperationLogs({
					page: page.value,
					page_size: pageSize.value,
					keyword: filterValue("keyword"),
					username: filterValue("username"),
					module: filterValue("module"),
					status: filterValue("status"),
					created_from: auditEpochMs(appliedStart.value),
					created_to: auditEpochMs(appliedEnd.value)
				});
			}

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
		const next: Record<string, string> = {};
		for (const spec of FILTER_SPECS[kind.value]) {
			const value = (filterValues[spec.key] ?? "").trim();
			if (value)
				next[spec.key] = value;
		}

		appliedFilters.value = next;
		appliedStart.value = kind.value === AUDIT_LOG_KIND.ARCHIVE ? "" : startFilter.value;
		appliedEnd.value = kind.value === AUDIT_LOG_KIND.ARCHIVE ? "" : endFilter.value;

		if (page.value !== 1) {
			page.value = 1;
			return;
		}

		reload();
	}

	function resetFilters(): void {
		for (const key of Object.keys(filterValues))
			filterValues[key] = "";
		startFilter.value = "";
		endFilter.value = "";
		rangePreset.value = "all";
		applyFilters();
	}

	// 文本类筛选是「粘一个值过来定位」，防抖 300ms（D2）；时间与每页条数是离散选择，改完立刻生效
	watchDebounced(filterValues, () => applyFilters(), { debounce: 300, deep: true });
	watch([startFilter, endFilter, pageSize], () => applyFilters());

	watch(page, () => {
		void load();
	});

	// 身份就绪后才取数：`loaded` 之前 `useAuth` 还没回 `whoami`，早发一次就是白跑一趟
	watch(loaded, () => {
		if (loaded.value)
			reload();
	}, { immediate: true });

	// ── 列表行与选择 ──────────────────────────────────────────────────────────
	/** 行视图：族 → 摘要（模板里不写三套分支，见 `auditRowOf()`） */
	const displayRows = computed(() => rows.value.map((record) => ({
		record,
		...auditRowOf(kind.value, record)
	})));

	/**
	 * 记录选择契约（NMCPS-ARCH-006 §5.2 / NMCPS-ADR-0017 D2 / D6）：`?id` 是「当前选中哪条」的唯一事实源。
	 *
	 * `getId` 用记录主键 `id`（UUID），它同时是详情端点路径段；`?id` **不进**列表请求参数，
	 * 所以改选中 / 深链进入都不会重新拉列表。`autoSelect` 让两栏形态默认落第一行。
	 */
	const selection = useRecordSelection<AuditRow>({
		rows,
		getId: (record) => record.id,
		getLabel: labelOf,
		isLoading: loading,
		isOverlay: () => shape.value === "overlay",
		autoSelect: true,
		defaultRecord: (list) => list[0]
	});

	const { selectedId, selected, clear: clearSelection } = selection;

	/** 切族 = 换端点 + 换字段：回第一页、清掉选中（旧记录在新族里不存在），再取数 */
	watch(kind, () => {
		page.value = 1;
		clearSelection();
		applyFilters();
	});

	const hasSelection = computed(() => !!selectedId.value);

	/** 选中行的摘要（详情标题与徽标复用，避免模板里再算一次） */
	const selectedRow = computed(() => (selected.value ? auditRowOf(kind.value, selected.value) : undefined));

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
	/** 行实例（`LayoutListRow`，只暴露 `focus()`）：`↑/↓/Home/End` 要能把焦点搬到目标行 —— 行结构在组件里（§3.6） */
	const rowElements = new Map<string, { focus: () => void }>();

	function setRowRef(id: string, row: unknown): void {
		if (row && typeof (row as { focus?: unknown }).focus === "function")
			rowElements.set(id, row as { focus: () => void });
		else
			rowElements.delete(id);
	}

	/** `↑/↓/Home/End` 移动焦点并同步选中（selection follows focus）；`Enter` / `Space` 由行自己处理 */
	function onListKeydown(event: KeyboardEvent): void {
		const ids = displayRows.value.map((row) => row.id);
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

	// ── 详情取数 ──────────────────────────────────────────────────────────────
	// 三族各有一个详情端点（旧代是一个 `GET /audit/{logCode}`）。列表项已含主要字段，
	// 详情仍单独拉一次：上游在详情里可能给列表没有的字段，页面按「有值才渲染」处理。
	const detail = ref<AuditRow>();
	const detailLoading = ref(false);
	const detailError = ref<string>();

	/** 族 → 详情端点：切换族或快速连点时靠 `kind` + `id` 双闸门避免慢响应覆盖新记录 */
	async function fetchDetail(id: string): Promise<AuditRow> {
		if (kind.value === AUDIT_LOG_KIND.ARCHIVE)
			return getRecord(id);
		if (kind.value === AUDIT_LOG_KIND.SECURITY)
			return getSecurityLog(id);

		return getOperationLog(id);
	}

	watch(selected, async (record) => {
		detail.value = undefined;
		detailError.value = undefined;

		if (!record)
			return;

		const id = record.id;
		const requestedKind = kind.value;
		detailLoading.value = true;

		try {
			const result = await fetchDetail(id);
			// 快速连点 / 切族时用当前选中与当前族做闸门
			if (selectedId.value === id && kind.value === requestedKind)
				detail.value = result;
		} catch (error) {
			if (selectedId.value === id && kind.value === requestedKind)
				detailError.value = describeError(error);
		} finally {
			if (selectedId.value === id && kind.value === requestedKind)
				detailLoading.value = false;
		}
	}, { immediate: true });

	/** 详情展示用的记录：有详情用详情，详情还没回来就用列表项（不闪空） */
	const detailRecord = computed<Record<string, unknown>>(() =>
		(detail.value ?? selected.value ?? {}) as unknown as Record<string, unknown>);

	/** `*_at` / `*_before` 这类字段按本地时字面值裁剪展示，其余原样 */
	function isTimeField(key: string): boolean {
		return /(?:_at|_before)$/.test(key);
	}

	/** 已登记字段的取值（顺序由 `AUDIT_DETAIL_FIELDS` 决定，缺字段显示 `—`） */
	const detailFields = computed(() => AUDIT_DETAIL_FIELDS[kind.value].map((field) => {
		const raw = auditField(detailRecord.value, field.key);
		return {
			key: field.key,
			label: field.label,
			value: isTimeField(field.key) ? auditTimeOf(raw) : raw
		};
	}));

	/** 未登记字段：原样列出（操作 / 安全日志的条目结构尚未实测，见页面头注释） */
	const extraFields = computed(() => auditExtraFields(kind.value, detailRecord.value));

	/**
	 * 字段口径说明只在「字段集合未实测」的两族出现（`NMCPS-REC-004`）：
	 * 归档记录的字段已实测，摆这条说明反而会让用户以为归档数据也不可信。
	 */
	const shapeUnverified = computed(() => kind.value !== AUDIT_LOG_KIND.ARCHIVE);

	function orDash(value: string | number | undefined): string {
		return value === undefined || value === "" ? "—" : String(value);
	}

	/**
	 * 读权限：两种身份都能读，差别只在**数据范围**（由上游按租户过滤）。
	 *
	 * 本域没有「我是谁就能看什么」的客户端判定：BFF 只白名单透传，越权判定在上游；
	 * 这里只是把「你看到的范围是谁的范围」讲清楚，不据身份拦请求。
	 */
	const scopeMessage = computed(() => {
		if (!loaded.value)
			return "";

		return isSuperAdmin.value
			? t("pages.system-log.scope.superAdmin")
			: t("pages.system-log.scope.tenantAdmin");
	});

	// ── 归档（取代旧代导出，缺口 G7）──────────────────────────────────────────
	const archiveOpen = ref(false);
	const archiving = ref(false);
	const archiveResult = ref<AuditRunArchiveResult>();

	/** 归档结果按「表名: 行数」原样回显：0 行不是失败（空库实测就是 0） */
	const archiveSummary = computed(() => {
		const entries = Object.entries(archiveResult.value ?? {});
		return entries.length > 0
			? `${t("pages.system-log.archive.result")} ${entries.map(([table, count]) => `${table}: ${count}`).join(" · ")}`
			: "";
	});

	/**
	 * 跑一次归档：**写操作**，按上游保留期把过期日志搬到归档表。
	 *
	 * 不加 `table_name` = 两张表都归（实测返回两个表的行数）。跑完顺手重拉当前列表：
	 * 归档会改变表的行数，不重拉就会看到过期数据。
	 */
	async function runArchive(): Promise<void> {
		if (archiving.value)
			return;

		archiving.value = true;

		try {
			archiveResult.value = await runArchiveJob();
			await load();
		} catch (error) {
			toast.add({
				title: t("pages.system-log.archive.failed"),
				description: describeError(error),
				color: "error"
			});
		} finally {
			archiving.value = false;
		}
	}
</script>
