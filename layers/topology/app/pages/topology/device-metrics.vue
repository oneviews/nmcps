<template>
	<div class="flex min-h-0 flex-1 flex-col">
		<!--
			`/topology/device-metrics` 设备遥测指标（两栏，NMCPS-ADR-0017 D1）。
			左栏 = `/metric/device` 的设备台账（`NMCPS-CONTRACT-002` §九），右栏 = 选中设备的指标趋势。
			页面根显式取 `flex-1 min-h-0`（NMCPS-ARCH-006 §3.3）：definite height 链在这里落定。
		-->
		<!--
			内容页工具栏（NMCPS-ARCH-006 §4）：全页只有这一层。
			左区 = 集合域动作 + 记录标识；右区 = 记录域动作（页签 / 页签数 / 刷新）。
			1.0 版式里「名称 · 管理 IP · 状态」在详情栏第一行左区、页签在第二行 —— 两行都在右栏内自建 header，
			与 §4「栏内另起一条 header」相冲，且吃掉两行高度；本轮改成全部上工具栏（见 §4.5）。
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
			<!-- 无选中时刷新是集合域动作，留在左区；选中后刷新的作用对象变成这条设备，随页签进右区（同一动作全页只有一个入口） -->
			<UTooltip v-else-if="!selected" :text="$t('pages.topology-device-metrics.refresh')">
				<UButton
					size="sm"
					color="neutral"
					variant="ghost"
					icon="carbon:renew"
					:loading="loading"
					:aria-label="$t('pages.topology-device-metrics.refresh')"
					@click="reload()"
				/>
			</UTooltip>

			<!-- 记录标识（原详情栏第一行左区）：名称 · 管理 IP ＋ 状态；状态枚举未定稿，认识的给语义色、其余中性 -->
			<div
				v-if="selected"
				data-testid="device-detail-header"
				class="flex min-w-0 items-center gap-2"
			>
				<h2 data-testid="device-detail-name" class="truncate text-sm font-semibold">
					{{ selected.name }}
				</h2>
				<span class="truncate font-mono text-xs text-(--ui-text-muted)">
					{{ selected.mgmtIp || "—" }}
				</span>
				<LayoutToolbarBadge
					v-if="selected.status"
					data-testid="device-detail-status"
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
					v-model="deviceTab"
					data-testid="device-detail-tabs"
					:items="deviceTabs"
					class="min-w-0"
				/>
				<!-- 工具栏放不下时折叠（§4.4）：页签一项不少，当前页写在按钮上 -->
				<UDropdownMenu v-else :items="deviceTabMenuItems" :content="{ align: 'end' }">
					<UButton
						data-testid="device-detail-tabs-menu"
						size="sm"
						color="neutral"
						variant="ghost"
						:label="currentTabLabel"
						trailing-icon="carbon:chevron-down"
						:aria-label="$t('pages.telemetry.tabMenu')"
					/>
				</UDropdownMenu>
				<LayoutToolbarBadge
					data-testid="device-detail-tab-count"
					variant="outline"
					color="neutral"
				>
					{{ $t("pages.telemetry.tabCount", { count: deviceTabs.length }) }}
				</LayoutToolbarBadge>
				<UTooltip :text="$t('pages.topology-device-metrics.refresh')">
					<UButton
						data-testid="device-detail-refresh"
						size="sm"
						color="neutral"
						variant="ghost"
						icon="carbon:renew"
						:loading="loading"
						:aria-label="$t('pages.topology-device-metrics.refresh')"
						@click="reload()"
					/>
				</UTooltip>
			</template>
		</Teleport>

		<LayoutSplit id="device-metrics" :has-selection="hasSelection" @update:shape="shape = $event">
			<template #list>
				<!-- 栏内错误：右栏保持可用（§3.4）；已有行时不清空，只提示「可能不是最新」 -->
				<div v-if="error" class="p-3">
					<UAlert
						color="error"
						variant="subtle"
						icon="carbon:warning-alt"
						:title="$t('pages.topology-device-metrics.loadFailed')"
						:description="error.message"
					>
						<template #actions>
							<UButton
								size="sm"
								color="neutral"
								variant="subtle"
								:label="$t('pages.topology-device-metrics.retry')"
								@click="reload()"
							/>
						</template>
					</UAlert>
				</div>

				<div v-if="loading && rows.length === 0" class="space-y-2 p-3">
					<USkeleton v-for="index in 5" :key="index" class="h-10 w-full" />
				</div>

				<!-- 空态与错误互斥（`NMCPS-ARCH-006` §3.4）：加载失败时再说「当前租户下没有设备事实」等于把「没拿到」讲成「一台都没有」 -->
				<div v-else-if="rows.length === 0 && !error" class="flex flex-col items-center gap-2 p-6 text-center">
					<UIcon name="carbon:chip" class="size-7 text-(--ui-text-muted)" />
					<p class="text-sm">
						{{ $t("pages.topology-device-metrics.empty") }}
					</p>
				</div>

				<!-- 自建 listbox（§3.6）：行可聚焦、`Enter` / `Space` 选中、带 `aria-selected` -->
				<ul
					v-else
					role="listbox"
					:aria-label="$t('pages.topology-device-metrics.listTitle')"
					class="flex flex-col"
					@keydown="onListKeydown"
				>
					<LayoutListRow
						v-for="row in rows"
						:key="row.id"
						:ref="(element) => setRowRef(row.id, element)"
						:label="row.name"
						:selected="row.id === selectedId"
						:tabindex="row.id === selectedId || (!selectedId && row === rows[0]) ? 0 : -1"
						:title="`${row.name} · ${row.id}`"
						data-testid="metric-device-row"
						:data-device-id="row.id"
						@select="selection.select(row)"
					>
						<template #badge>
							<UBadge v-if="row.status" :color="statusColor(row.status)" variant="subtle" size="sm">
								{{ row.status }}
							</UBadge>
						</template>
						<!--
							次级信息只留一行（`NMCPS-ARCH-006` §3.6）：管理 IP · 邻居 · 端口。
							CPU / 内存 / 设备标识都在右栏概览里，列表栏不重复；`—` = 不可判定，不写 0。
						-->
						<template #subtitle>
							<span class="font-mono">{{ row.mgmtIp || "—" }}</span> · {{ $t("pages.topology-device-metrics.rowSummary", {
								neighbors: formatNeighbors(row),
								ports: formatPorts(row),
							}) }}
						</template>
					</LayoutListRow>
				</ul>
			</template>

			<template #list-footer>
				<!-- 计数同样不许冒充：失败时写「共 0 台设备」等于断言「一台都没有」（§3.4） -->
				<LayoutListFooter v-model:page="page" v-model:page-size="pageSize" :total="total" :disabled="loading || !!error">
					{{ error ? $t("pages.topology-device-metrics.totalUnknown") : $t("pages.topology-device-metrics.total", { total }) }}
				</LayoutListFooter>
			</template>

			<template #detail>
				<div class="flex min-h-full flex-col">
					<!-- `?id` 不在当前页结果集：零详情请求 + 一次提示，不清空 URL（D6）。
						但「没加载出来」不等于「不存在」（`NMCPS-ARCH-006` §3.4）：台账失败时只能说「无法确认」 -->
					<div v-if="isMissing" class="p-4">
						<UAlert
							color="warning"
							variant="subtle"
							icon="carbon:unlink"
							:title="error ? $t('pages.topology-device-metrics.selectionUnknownTitle') : $t('pages.topology-device-metrics.selectionMissingTitle')"
							:description="error
								? $t('pages.topology-device-metrics.selectionUnknown', { id: selectedId })
								: $t('pages.topology-device-metrics.selectionMissing', { id: selectedId, size: pageSize })"
						>
							<template #actions>
								<UButton
									size="sm"
									color="neutral"
									variant="subtle"
									:label="error ? $t('pages.topology-device-metrics.retry') : $t('pages.topology-device-metrics.selectionClear')"
									@click="error ? reload() : clearSelection()"
								/>
							</template>
						</UAlert>
					</div>

					<div v-else-if="selected" class="flex min-h-full flex-col">
						<!--
							栏内不再有 header / 页签条：记录标识在工具栏左区、页签与刷新在右区（§4.5）。
							右栏只负责这一条记录的卡片内容，`data-testid='device-detail-body'` 是断言锚点。
						-->
						<div class="p-4" data-testid="device-detail-body">
							<MetricDeviceOverview v-if="deviceTab === 'overview'" :device="selected" />

							<div v-else-if="deviceTab === 'charts'" class="space-y-2">
								<!-- 折线交给共享面板：选择器 / 速率开关 / 三种空态都在那里，页面不重复 -->
								<MetricTrendPanel
									:ip="selected.mgmtIp"
									:name="selected.name"
									:missing-ip-text="$t('pages.topology-device-metrics.noIp')"
								/>
							</div>

							<MetricDeviceInterfaces
								v-else-if="deviceTab === 'interfaces'"
								:ip="selected.mgmtIp"
								:lldp-ports="selected.lldpPorts"
								:missing-ip-text="$t('pages.topology-device-metrics.noIp')"
							/>

							<!--
								以下四页的数据都在 `/metric/device` 的同一条设备事实里（`protocol` / `radio` /
								`lldp` / `device_quality` + `quality`），所以照实出数；每页底部只把**真正**
								缺的那几条（OSPF/BGP 邻居表、第二条探针链路）写成缺口。
							-->
							<MetricDeviceProtocol v-else-if="deviceTab === 'protocol'" :device="selected" />
							<MetricDeviceRadio v-else-if="deviceTab === 'radio'" :device="selected" />
							<MetricDeviceLldp v-else-if="deviceTab === 'lldp'" :device="selected" />
							<MetricDeviceQuality v-else :device="selected" />
						</div>
					</div>

					<div v-else class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
						<UIcon name="carbon:chip" class="size-7 text-(--ui-text-muted)" />
						<p class="text-sm font-medium">
							{{ $t("pages.topology-device-metrics.detailEmpty") }}
						</p>
						<p class="max-w-xs text-xs text-(--ui-text-muted)">
							{{ $t("pages.topology-device-metrics.detailEmptyHint") }}
						</p>
					</div>
				</div>
			</template>
		</LayoutSplit>
	</div>
</template>

<script setup lang="ts">
	import type { DropdownMenuItem } from "@nuxt/ui";
	import type { MetricDeviceRow } from "~~/app/utils/metric/metricLedger";
	import type { MetricDeviceFact } from "~~/shared/types/metric";
	import { DEVICE_DEEP_LINK_KEY, deviceIdByMgmtIp, resolveDeepLink } from "~~/app/utils/metric/metricDeepLink";
	import { normalizeMetricDevices } from "~~/app/utils/metric/metricLedger";
	import { DEFAULT_PAGE_SIZE } from "~~/shared/constants/paging";

	/**
	 * `/topology/device-metrics` 设备遥测指标（两栏台账 + 趋势）。
	 *
	 * 设计基准：NMCPS-ARCH-006 §3（layers/content/collections/cn/architecture/1.architecture/ui-architecture.md）
	 * 契约来源：NMCPS-CONTRACT-002 §七（`/metric/name`）、§八（目录 join）、§九（`/metric/device` 台账）
	 * 领域口径：NMCPS-DESIGN-001 §6.6（layers/content/collections/cn/architecture/2.domain/topology.md）
	 *
	 * 左栏只回答「有哪些设备、当前值多少」；折线一律交给 `MetricTrendPanel`（内部 `useMetricSeries`），
	 * 页面自己不拼 `/metric/datapoint` 参数 —— 两页共用同一个内核，参数口径才不会漂。
	 */
	definePageMeta({ sort: 2, icon: "carbon:chip" });

	/** 当前形态（由 `Layout/Split.vue` 判定并外抛）：决定 `?id` 写历史时用 `replace` 还是 `push` */
	const shape = ref<"two" | "overlay">("two");

	const { t } = useI18n();

	/** 每页条数与列表页同源（`shared/constants/paging`），不在页面里写死一个数字 */
	const { facts, page, pageSize, total, loading, error, reload, fetchPage } = useMetricLedger<MetricDeviceFact>("/api/metric/device", {
		pageSize: DEFAULT_PAGE_SIZE
	});

	const rows = computed<MetricDeviceRow[]>(() => normalizeMetricDevices(facts.value));

	/**
	 * 记录选择契约（NMCPS-ARCH-006 §5.2）：`?id` 是 `device_code`，不进台账请求键 ——
	 * 改选中 / 深链进入都不会重新拉左栏（`?id` 不在当前页时只出空态，不静默翻页去捞）。
	 */
	const selection = useRecordSelection<MetricDeviceRow>({
		rows,
		getId: (record) => record.id,
		getLabel: (record) => record.name,
		isLoading: loading,
		isOverlay: () => shape.value === "overlay",
		autoSelect: true
	});

	const { selectedId, selected, isMissing, clear: clearSelection } = selection;
	const hasSelection = computed(() => !!selectedId.value);

	// ── 拓扑深链（§6.15）：拓扑页的节点 id 是**管理 IP**，本页的 `?id` 是 `device_code` ─────────
	//
	// 两个域没有共同键，所以深链带的是拓扑侧真有的身份（`?mgmt_ip=`），这里用台账把它解析成
	// `device_code` 再写 `?id`（`useRecordSelection` 的唯一事实源不变）。
	// 目标是「跳过来就选中那台设备」，因此解析先看当前页、再**有限页扫描**（`resolveDeepLink()`，
	// 上限 `DEEP_LINK_MAX_PAGES` 页）：台账一页 15 条，现网 36 台设备里至少一半不在第一页。
	// 命中后先把左栏切到那一页再写 `?id` —— 选中的行一定看得见；扫不到就保持默认选中。
	// `?id` 本身仍然不参与请求键、也永不触发扫描（`NMCPS-ARCH-006` §5.2）。
	const route = useRoute();
	const linkedMgmtIp = computed(() => {
		const raw = route.query[DEVICE_DEEP_LINK_KEY];
		const value = Array.isArray(raw) ? raw[0] : raw;
		return typeof value === "string" ? value.trim() : "";
	});
	const deepLinkApplied = ref(false);

	async function applyDeviceDeepLink(): Promise<void> {
		if (deepLinkApplied.value || !linkedMgmtIp.value || loading.value || rows.value.length === 0)
			return;
		// 先占位：扫描要等好几个请求，期间 `rows` 会继续变，不占位就会重复扫
		deepLinkApplied.value = true;

		const hit = await resolveDeepLink(
			async (target) => {
				const list = await fetchPage(target);
				return list ? normalizeMetricDevices(list) : null;
			},
			(pageRows) => deviceIdByMgmtIp(pageRows, linkedMgmtIp.value),
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
		void applyDeviceDeepLink();
	});

	/**
	 * 详情 Tab（1.0 的 7 页版式）：`value` 是稳定 key，标签走 i18n。
	 * 缺数据的四页**不隐藏**——隐藏等于把「上游没这个字段」讲成「1.0 没有这一页」，
	 * 改为在该页显示缺口卡（`MetricTelemetryGap`）。
	 */
	const deviceTab = ref("overview");
	const deviceTabs = computed(() => [
		{ label: t("pages.telemetry.tabs.overview"), value: "overview", icon: "carbon:information" },
		{ label: t("pages.telemetry.tabs.charts"), value: "charts", icon: "carbon:chart-line" },
		{ label: t("pages.telemetry.tabs.interfaces"), value: "interfaces", icon: "carbon:network-4" },
		{ label: t("pages.telemetry.tabs.protocol"), value: "protocol", icon: "carbon:flow" },
		{ label: t("pages.telemetry.tabs.radio"), value: "radio", icon: "carbon:wifi" },
		{ label: t("pages.telemetry.tabs.lldp"), value: "lldp", icon: "carbon:network-3" },
		{ label: t("pages.telemetry.tabs.dataQuality"), value: "dataQuality", icon: "carbon:data-quality-definition" }
	]);

	/** 工具栏内容跟随当前面板（§4.4）：覆盖式详情态左区换成唯一「返回」 */
	const toolbarPane = computed<"list" | "detail">(() =>
		shape.value === "overlay" && hasSelection.value ? "detail" : "list");

	/**
	 * 工具栏窄屏折叠判据（`NMCPS-ARCH-006` §4.4）：7 个页签 + 记录标识 + 页签数 + 刷新挤不进
	 * 1280px 以下的一条 49px 工具栏，此时页签折叠成 `UDropdownMenu`（一项不少）。
	 * 断点与 `check:ui` 的折叠断言同源，改一处要一起改。
	 */
	const compactToolbar = useMediaQuery("(max-width: 1279px)");

	/** 折叠态按钮文案 = 当前页签标签（否则「我在哪一页」要靠打开菜单才知道） */
	const currentTabLabel = computed(() =>
		deviceTabs.value.find((tab) => tab.value === deviceTab.value)?.label ?? "");

	/** 折叠态菜单项：与 `deviceTabs` 同一份数据，当前页打勾 */
	const deviceTabMenuItems = computed<DropdownMenuItem[]>(() => deviceTabs.value.map((tab) => ({
		label: tab.label,
		icon: tab.icon,
		type: "checkbox" as const,
		checked: tab.value === deviceTab.value,
		onSelect: () => {
			deviceTab.value = tab.value;
		}
	})));

	/** 面包屑记录段（§5.1）：点击 = 清除选择，工具栏不直接写 URL */
	const { clearRequests } = useRecordContext(selection.label);
	watch(clearRequests, () => clearSelection());

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

	/** `null` = 不可判定（契约禁 0 伪造）：显示 `—`，不写成 0 个邻居（§九） */
	function formatNeighbors(row: MetricDeviceRow): string {
		return row.neighborTotal === null ? "—" : String(row.neighborTotal);
	}

	/** 端口汇总缺一项就整句 `—`：`0/0 在线` 会被读成「全断」 */
	function formatPorts(row: MetricDeviceRow): string {
		if (row.portsUp === null || row.portsTotal === null)
			return "—";

		return `${row.portsUp}/${row.portsTotal}`;
	}

	/** 上游状态枚举未定稿：认识的给语义色，其余一律中性（不猜语义） */
	function statusColor(status: string): "success" | "warning" | "error" | "neutral" {
		if (status === "online")
			return "success";
		if (status === "degraded")
			return "warning";
		if (status === "offline")
			return "error";

		return "neutral";
	}
</script>
