<template>
	<div class="flex min-h-0 flex-1 flex-col">
		<!--
			`/topology/link-metrics` 链路遥测指标（两栏，NMCPS-ADR-0017 D1）。
			左栏 = `/metric/link` 的链路台账（`NMCPS-CONTRACT-002` §九），右栏 = 链路当前值 + source 端设备**该端口**的趋势。
			链路**没有 `mgmt_ip`**，也没有 `link_id` 取数：折线 = source 端设备 + `ifIndex = identity.source.if_index`
			的接口序列（`NMCPS-CONTRACT-002` §6.9，口径见 NMCPS-DESIGN-001 §6.6），端到端如实标注、不伪造。
			页面根显式取 `flex-1 min-h-0`（NMCPS-ARCH-006 §3.3）：definite height 链在这里落定。
		-->
		<!--
			内容页工具栏（NMCPS-ARCH-006 §4）：全页只有这一层。
			左区 = 集合域动作 + 记录标识；右区 = 记录域动作（页签 / 页签数 / 刷新）。
			链路标识沿用 1.0 的「两端 → 标识」：名称位是 `A → B`，等宽位是这条链路的 id。
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
			<!-- 无选中时刷新是集合域动作，留在左区；选中后刷新的作用对象是这条链路，随页签进右区 -->
			<UTooltip v-else-if="!selected" :text="$t('pages.topology-link-metrics.refresh')">
				<UButton
					size="sm"
					color="neutral"
					variant="ghost"
					icon="carbon:renew"
					:loading="loading"
					:aria-label="$t('pages.topology-link-metrics.refresh')"
					@click="reloadAll()"
				/>
			</UTooltip>

			<!-- 记录标识（原详情栏第一行左区）：两端 → 链路标识 ＋ 状态 -->
			<div
				v-if="selected"
				data-testid="link-detail-header"
				class="flex min-w-0 items-center gap-2"
			>
				<h2 data-testid="link-detail-name" class="truncate text-sm font-semibold">
					{{ selected.sourceLabel || "—" }} → {{ selected.targetLabel || "—" }}
				</h2>
				<span class="truncate font-mono text-xs text-(--ui-text-muted)">
					{{ selected.id }}
				</span>
				<!-- 上游状态枚举未定稿：认识的给语义色，其余中性（不猜语义） -->
				<LayoutToolbarBadge
					v-if="selected.status"
					data-testid="link-detail-status"
					:color="statusColor(selected.status)"
					variant="subtle"
				>
					{{ selected.status }}
				</LayoutToolbarBadge>
			</div>
		</Teleport>

		<!-- 右区（原详情栏第一行右区 + 第二行左区）：页签 → 页签数 → 刷新 -->
		<Teleport to="#app-toolbar-right">
			<template v-if="selected">
				<LayoutToolbarTabs
					v-if="!compactToolbar"
					v-model="linkTab"
					data-testid="link-detail-tabs"
					:items="linkTabs"
					class="min-w-0"
				/>
				<!-- 工具栏放不下时折叠（§4.4）：页签一项不少，当前页写在按钮上 -->
				<UDropdownMenu v-else :items="linkTabMenuItems" :content="{ align: 'end' }">
					<UButton
						data-testid="link-detail-tabs-menu"
						size="sm"
						color="neutral"
						variant="ghost"
						:label="currentTabLabel"
						trailing-icon="carbon:chevron-down"
						:aria-label="$t('pages.telemetry.tabMenu')"
					/>
				</UDropdownMenu>
				<LayoutToolbarBadge
					data-testid="link-detail-tab-count"
					variant="outline"
					color="neutral"
				>
					{{ $t("pages.telemetry.tabCount", { count: linkTabs.length }) }}
				</LayoutToolbarBadge>
				<UTooltip :text="$t('pages.topology-link-metrics.refresh')">
					<UButton
						data-testid="link-detail-refresh"
						size="sm"
						color="neutral"
						variant="ghost"
						icon="carbon:renew"
						:loading="loading"
						:aria-label="$t('pages.topology-link-metrics.refresh')"
						@click="reloadAll()"
					/>
				</UTooltip>
			</template>
		</Teleport>

		<LayoutSplit id="link-metrics" :has-selection="hasSelection" @update:shape="shape = $event">
			<template #list>
				<div v-if="error" class="p-3">
					<UAlert
						color="error"
						variant="subtle"
						icon="carbon:warning-alt"
						:title="$t('pages.topology-link-metrics.loadFailed')"
						:description="error.message"
					>
						<template #actions>
							<UButton
								size="sm"
								color="neutral"
								variant="subtle"
								:label="$t('pages.topology-link-metrics.retry')"
								@click="reload()"
							/>
						</template>
					</UAlert>
				</div>

				<div v-if="loading && rows.length === 0" class="space-y-2 p-3">
					<USkeleton v-for="index in 5" :key="index" class="h-10 w-full" />
				</div>

				<!-- 空态与错误互斥（`NMCPS-ARCH-006` §3.4）：加载失败时再说「没有链路事实」等于把「没拿到」讲成「一条都没有」 -->
				<div v-else-if="rows.length === 0 && !error" class="flex flex-col items-center gap-2 p-6 text-center">
					<UIcon name="carbon:link" class="size-7 text-(--ui-text-muted)" />
					<p class="text-sm">
						{{ $t("pages.topology-link-metrics.empty") }}
					</p>
				</div>

				<ul
					v-else
					role="listbox"
					:aria-label="$t('pages.topology-link-metrics.listTitle')"
					class="flex flex-col"
					@keydown="onListKeydown"
				>
					<LayoutListRow
						v-for="row in rows"
						:key="row.id"
						:ref="(element) => setRowRef(row.id, element)"
						:label="linkTitle(row)"
						:selected="row.id === selectedId"
						:tabindex="row.id === selectedId || (!selectedId && row === rows[0]) ? 0 : -1"
						:title="`${linkTitle(row)} · ${row.id}`"
						mono-subtitle
						data-testid="metric-link-row"
						:data-link-id="row.id"
						@select="selection.select(row)"
					>
						<template #badge>
							<UBadge v-if="row.status" :color="statusColor(row.status)" variant="subtle" size="sm">
								{{ row.status }}
							</UBadge>
						</template>
						<!--
							次级信息只留一行（`NMCPS-ARCH-006` §3.6）：两端 `接口名:管理 IP`。
							链路台账只有 `device_code` + `interface_name`，IP 靠 `/metric/device` 反查；
							任一缺失写 `—`，不拼半句、不猜一个地址。
						-->
						<template #subtitle>
							{{ linkEndpoints(row) }}
						</template>
					</LayoutListRow>
				</ul>
			</template>

			<template #list-footer>
				<!-- 计数同样不许冒充：失败时写「共 0 条链路」等于断言「一条都没有」（§3.4） -->
				<LayoutListFooter v-model:page="page" v-model:page-size="pageSize" :total="total" :disabled="loading || !!error">
					{{ error ? $t("pages.topology-link-metrics.totalUnknown") : $t("pages.topology-link-metrics.total", { total }) }}
				</LayoutListFooter>
			</template>

			<template #detail>
				<div class="flex min-h-full flex-col">
					<div v-if="isMissing" class="p-4">
						<!-- 「没加载出来」不等于「不存在」（`NMCPS-ARCH-006` §3.4）：台账失败时只能说「无法确认」 -->
						<UAlert
							color="warning"
							variant="subtle"
							icon="carbon:unlink"
							:title="error ? $t('pages.topology-link-metrics.selectionUnknownTitle') : $t('pages.topology-link-metrics.selectionMissingTitle')"
							:description="error
								? $t('pages.topology-link-metrics.selectionUnknown', { id: selectedId })
								: $t('pages.topology-link-metrics.selectionMissing', { id: selectedId, size: pageSize })"
						>
							<template #actions>
								<UButton
									size="sm"
									color="neutral"
									variant="subtle"
									:label="error ? $t('pages.topology-link-metrics.retry') : $t('pages.topology-link-metrics.selectionClear')"
									@click="error ? reload() : clearSelection()"
								/>
							</template>
						</UAlert>
					</div>

					<div v-else-if="selected" class="flex min-h-full flex-col">
						<!--
							栏内不再有 header / 页签条：两端标识在工具栏左区、页签与刷新在右区（§4.5）；
							`link-series-scope` 这类取数口径说明仍属内容，留在页内。
						-->
						<div class="p-4" data-testid="link-detail-body">
							<MetricLinkOverview v-if="linkTab === 'overview'" :link="selected" />

							<div v-else-if="linkTab === 'charts'" class="space-y-3">
								<!-- 链路级时序缺口：如实说明「这条折线是谁的」，不把设备曲线说成链路曲线 -->
								<UAlert
									color="info"
									variant="subtle"
									icon="carbon:information"
									data-testid="link-series-scope"
									:title="$t(portScope ? 'pages.topology-link-metrics.portTitle' : 'pages.topology-link-metrics.gapTitle')"
									:description="portScope
										? $t('pages.topology-link-metrics.portBody', { index: selected.sourceIfIndex })
										: $t('pages.topology-link-metrics.gapBody', { source: selected.sourceCode || '—' })"
								/>
								<MetricTrendPanel
									:ip="sourceIp"
									:name="selected.sourceCode || selected.id"
									:if-index="selected.sourceIfIndex"
									:missing-ip-text="$t('pages.topology-link-metrics.noIp')"
								/>
							</div>

							<MetricLinkTraffic v-else-if="linkTab === 'traffic'" :link="selected" />
							<MetricLinkErrors v-else-if="linkTab === 'errors'" :link="selected" />
							<MetricLinkEndpoints v-else-if="linkTab === 'endpoints'" :selected="selected" />
							<MetricLinkQuality v-else :link="selected" />
						</div>
					</div>

					<div v-else class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
						<UIcon name="carbon:link" class="size-7 text-(--ui-text-muted)" />
						<p class="text-sm font-medium">
							{{ $t("pages.topology-link-metrics.detailEmpty") }}
						</p>
						<p class="max-w-xs text-xs text-(--ui-text-muted)">
							{{ $t("pages.topology-link-metrics.detailEmptyHint") }}
						</p>
					</div>
				</div>
			</template>
		</LayoutSplit>
	</div>
</template>

<script setup lang="ts">
	import type { DropdownMenuItem } from "@nuxt/ui";
	import type { MetricLinkRow } from "~~/app/utils/metric/metricLedger";
	import type { MetricDeviceFact, MetricLinkFact } from "~~/shared/types/metric";
	import {
		LINK_SOURCE_DEEP_LINK_KEY,
		LINK_TARGET_DEEP_LINK_KEY,
		linkIdByEndpoints,
		resolveDeepLink
	} from "~~/app/utils/metric/metricDeepLink";
	import { deviceIpIndex, deviceNameIndex, normalizeMetricLinks } from "~~/app/utils/metric/metricLedger";
	import { DEFAULT_PAGE_SIZE } from "~~/shared/constants/paging";

	/**
	 * `/topology/link-metrics` 链路遥测指标（两栏台账 + 当前值 + source 端设备趋势）。
	 *
	 * 设计基准：NMCPS-ARCH-006 §3（layers/content/collections/cn/architecture/1.architecture/ui-architecture.md）
	 * 契约来源：NMCPS-CONTRACT-002 §六（`/metric/datapoint`）、§八（目录 join）、§九（`/metric/link` 台账）
	 * 领域口径：NMCPS-DESIGN-001 §6.6（layers/content/collections/cn/architecture/2.domain/topology.md）
	 *
	 * ── 折线的范围（如实登记，不假装是 link_id 时序）──────────────────────────
	 * `/metric/link` 的条目里**没有 `mgmt_ip`**，`/metric/datapoint` 也只认设备管理 IP + 指标名；但实测
	 * 序列带 `ifIndex` 标签（`NMCPS-CONTRACT-002` §6.9），所以折线 = `identity.source` 那台设备上
	 * **该端口**（`if_index`）的接口序列：跨 job 取均值、不与他端口混画。三种如实标注见 `portScope`
	 * 与面板内的设备级说明；`if_index` 缺失时只出当前值、不出折线。真正的 `link_id` 时序仍等上游。
	 */
	definePageMeta({ sort: 3, icon: "carbon:link" });

	const shape = ref<"two" | "overlay">("two");

	const { t } = useI18n();

	const { facts, page, pageSize, total, loading, error, reload, fetchPage } = useMetricLedger<MetricLinkFact>("/api/metric/link", {
		pageSize: DEFAULT_PAGE_SIZE
	});

	/**
	 * `device_code → mgmt_ip` 索引：一次取 200 条覆盖单租户设备表（与目录 `page_size` 同口径）。
	 * 索引失败只是「折线不出现」，台账与当前值照常可用，因此不把它的错误提到页面级。
	 */
	const { facts: deviceFacts, reload: reloadDevices } = useMetricLedger<MetricDeviceFact>("/api/metric/device", { pageSize: 200 });
	const ipIndex = computed(() => deviceIpIndex(deviceFacts.value));

	const rows = computed<MetricLinkRow[]>(() => normalizeMetricLinks(facts.value));

	const selection = useRecordSelection<MetricLinkRow>({
		rows,
		getId: (record) => record.id,
		getLabel: (record) => record.id,
		isLoading: loading,
		isOverlay: () => shape.value === "overlay",
		autoSelect: true
	});

	const { selectedId, selected, isMissing, clear: clearSelection } = selection;
	const hasSelection = computed(() => !!selectedId.value);

	// ── 拓扑深链（§6.15）：拓扑侧只有两端的管理 IP，本页的 `?id` 是 `link_id` ──────────────────
	//
	// 本页本来就要取一份 `/metric/device` 建 `device_code → mgmt_ip` 索引（上证 §6.6 折线口径），
	// 深链解析正好复用这张表：两端的 IP → 两端的 `device_code` → 命中台账里的 `link_id`。
	// 方向不敏感（台账的 source / target 是发现顺序）。解析先看当前页、再**有限页扫描**
	// （`resolveDeepLink()`，上限 `DEEP_LINK_MAX_PAGES` 页）—— 48 条链路铺在 4 页上，目标多半不在第一页；
	// 命中后左栏切到那一页再写 `?id`，扫不到就保持默认选中（`?id` 永不触发扫描，§5.2）。
	const route = useRoute();
	const linkedEndpoints = computed(() => ({
		source: queryText(route.query[LINK_SOURCE_DEEP_LINK_KEY]),
		target: queryText(route.query[LINK_TARGET_DEEP_LINK_KEY])
	}));
	const deepLinkApplied = ref(false);

	async function applyLinkDeepLink(): Promise<void> {
		const { source, target } = linkedEndpoints.value;
		if (deepLinkApplied.value || !source || !target || loading.value)
			return;
		// 索引与台账都得先到位：`device_code` 认不出来时 `linkIdByEndpoints()` 恒返回 null
		if (rows.value.length === 0 || ipIndex.value.size === 0)
			return;
		// 先占位：扫描要等好几个请求，期间 `rows` 会继续变，不占位就会重复扫
		deepLinkApplied.value = true;

		const hit = await resolveDeepLink(
			async (target_) => {
				const list = await fetchPage(target_);
				return list ? normalizeMetricLinks(list) : null;
			},
			(pageRows) => linkIdByEndpoints(pageRows, ipIndex.value, source, target),
			{ firstPage: rows.value }
		);
		if (!hit)
			return;

		// 页码先动（触发重取），再写 `?id`：两者都落定后左栏那一行才是高亮的那一行
		if (hit.page !== page.value)
			page.value = hit.page;
		selection.set(hit.id);
	}

	watchEffect(() => {
		void applyLinkDeepLink();
	});

	/** 查询参数单值化：数组 / 空串一律当「没传」（与 `useRecordSelection` 同口径） */
	function queryText(raw: unknown): string {
		const value = Array.isArray(raw) ? raw[0] : raw;
		return typeof value === "string" ? value.trim() : "";
	}

	/**
	 * 详情 Tab（1.0 链路详情的 6 页版式）：`value` 是稳定 key，标签走 i18n。
	 * 错误统计 / 链路质量两页的一半字段在 2.0 没有端点，页内用缺口卡说明，不隐藏页签。
	 */
	const linkTab = ref("overview");
	const linkTabs = computed(() => [
		{ label: t("pages.telemetry.tabs.overview"), value: "overview", icon: "carbon:information" },
		{ label: t("pages.telemetry.tabs.charts"), value: "charts", icon: "carbon:chart-line" },
		{ label: t("pages.telemetry.tabs.traffic"), value: "traffic", icon: "carbon:arrows-horizontal" },
		{ label: t("pages.telemetry.tabs.errors"), value: "errors", icon: "carbon:warning-alt" },
		{ label: t("pages.telemetry.tabs.endpoints"), value: "endpoints", icon: "carbon:network-4" },
		{ label: t("pages.telemetry.tabs.quality"), value: "quality", icon: "carbon:chart-line-smooth" }
	]);

	/** 折线的入参：source 端设备的 `mgmt_ip`；查不到就是空串（面板据此说明原因，不发空请求） */
	const sourceIp = computed(() => {
		const code = selected.value?.sourceCode;
		return code ? ipIndex.value.get(code) ?? "" : "";
	});

	/** source 端有 `if_index` ⇒ 折线是这个端口级的（`NMCPS-CONTRACT-002` §6.9）；缺了就是设备级，如实说明 */
	const portScope = computed(() => selected.value?.sourceIfIndex != null);

	const toolbarPane = computed<"list" | "detail">(() =>
		shape.value === "overlay" && hasSelection.value ? "detail" : "list");

	/**
	 * 工具栏窄屏折叠判据（`NMCPS-ARCH-006` §4.4）：6 个页签 + 两端标识 + 页签数 + 刷新挤不进
	 * 1280px 以下的一条 49px 工具栏，此时页签折叠成 `UDropdownMenu`（一项不少）。
	 * 断点与 `check:ui` 的折叠断言同源，改一处要一起改。
	 */
	const compactToolbar = useMediaQuery("(max-width: 1279px)");

	/** 折叠态按钮文案 = 当前页签标签 */
	const currentTabLabel = computed(() =>
		linkTabs.value.find((tab) => tab.value === linkTab.value)?.label ?? "");

	/** 折叠态菜单项：与 `linkTabs` 同一份数据，当前页打勾 */
	const linkTabMenuItems = computed<DropdownMenuItem[]>(() => linkTabs.value.map((tab) => ({
		label: tab.label,
		icon: tab.icon,
		type: "checkbox" as const,
		checked: tab.value === linkTab.value,
		onSelect: () => {
			linkTab.value = tab.value;
		}
	})));

	const { clearRequests } = useRecordContext(selection.label);
	watch(clearRequests, () => clearSelection());

	/** 工具栏「刷新」= 台账 + 设备索引一起重取（否则换了 IP 的链路会一直画出旧设备的曲线） */
	function reloadAll(): void {
		void reload();
		void reloadDevices();
	}

	// ── 键盘：listbox 语义（§3.6）──────────────────────────────────────────────
	/** 行实例（`LayoutListRow`，只暴露 `focus()`）：`↑/↓/Home/End` 把焦点搬到目标行 —— 行结构在组件里（§3.6） */
	const rowElements = new Map<string, { focus: () => void }>();

	function setRowRef(id: string, row: unknown): void {
		if (row && typeof (row as { focus?: unknown }).focus === "function")
			rowElements.set(id, row as { focus: () => void });
	}

	function focusRow(index: number): void {
		const row = rows.value[index];
		if (!row)
			return;

		selection.select(row);
		rowElements.get(row.id)?.focus();
	}

	function onListKeydown(event: KeyboardEvent): void {
		const index = rows.value.findIndex((row) => row.id === selection.selectedId.value);

		if (event.key === "ArrowDown") {
			event.preventDefault();
			focusRow(Math.min(rows.value.length - 1, index + 1));
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			focusRow(Math.max(0, index - 1));
		} else if (event.key === "Home") {
			event.preventDefault();
			focusRow(0);
		} else if (event.key === "End") {
			event.preventDefault();
			focusRow(rows.value.length - 1);
		}
	}

	/**
	 * `device_code → 展示名` 索引（`sys_name` 兜 `device_code`）：链路台账两端只有
	 * `device_code` + `interface_name`，而行标题要写人看得懂的两端设备名 —— 与 `ipIndex`
	 * 取自同一份 `/metric/device` 台账，两个索引一起建，不额外发请求。
	 */
	const nameIndex = computed(() => deviceNameIndex(deviceFacts.value));

	/** 设备展示名：台账里查不到就退回 `device_code`，不编名字 */
	function deviceName(code: string): string {
		return nameIndex.value.get(code) || code || "—";
	}

	/** 行标题 = 两端设备名（例：`Wi-Fi胖AP-11 → 接入交换机-1`） */
	function linkTitle(row: MetricLinkRow): string {
		return `${deviceName(row.sourceCode)} → ${deviceName(row.targetCode)}`;
	}

	/**
	 * 行次级信息 = 两端 `接口名:管理 IP`（例：`n20-eth2:10.0.0.245 → n7-eth3:10.0.0.11`）。
	 * 链路自己**没有** `mgmt_ip`（`NMCPS-CONTRACT-002` §九），冒号后面是 source / target 端
	 * 设备的管理 IP，按 `device_code` 反查；任一缺失写 `—`，不拼半句。
	 */
	function endpointText(code: string, label: string): string {
		return `${label || "—"}:${ipIndex.value.get(code) || "—"}`;
	}

	function linkEndpoints(row: MetricLinkRow): string {
		return `${endpointText(row.sourceCode, row.sourceLabel)} → ${endpointText(row.targetCode, row.targetLabel)}`;
	}

	/** 上游状态枚举未定稿：认识的给语义色，其余一律中性（不猜语义） */
	function statusColor(status: string): "success" | "warning" | "error" | "neutral" {
		if (status === "up" || status === "online")
			return "success";
		if (status === "degraded" || status === "warning")
			return "warning";
		if (status === "down" || status === "offline")
			return "error";

		return "neutral";
	}
</script>
