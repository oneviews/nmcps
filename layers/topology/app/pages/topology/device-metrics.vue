<template>
	<div class="flex min-h-0 flex-1 flex-col">
		<!--
			`/topology/device-metrics` 设备遥测指标（两栏，NMCPS-ADR-0017 D1）。
			左栏 = `/metric/device` 的设备台账（`NMCPS-CONTRACT-002` §九），右栏 = 选中设备的指标趋势。
			页面根显式取 `flex-1 min-h-0`（NMCPS-ARCH-006 §3.3）：definite height 链在这里落定。
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
			<UTooltip v-else :text="$t('pages.topology-device-metrics.refresh')">
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

				<div v-else-if="rows.length === 0" class="flex flex-col items-center gap-2 p-6 text-center">
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
					<li
						v-for="row in rows"
						:key="row.id"
						:ref="(element) => setRowRef(row.id, element)"
						role="option"
						:aria-selected="row.id === selectedId"
						:tabindex="row.id === selectedId || (!selectedId && row === rows[0]) ? 0 : -1"
						:title="`${row.name} · ${row.id}`"
						data-testid="metric-device-row"
						:data-device-id="row.id"
						class="cursor-pointer border-s-2 px-3 py-2 outline-none transition-colors hover:bg-elevated focus-visible:bg-elevated focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
						:class="row.id === selectedId ? 'border-primary bg-accented' : 'border-transparent'"
						@click="selection.select(row)"
						@keydown.enter.prevent="selection.select(row)"
						@keydown.space.prevent="selection.select(row)"
					>
						<div class="flex min-w-0 items-center justify-between gap-2">
							<p class="truncate text-sm font-medium">
								{{ row.name }}
							</p>
							<UBadge v-if="row.status" :color="statusColor(row.status)" variant="subtle" size="sm">
								{{ row.status }}
							</UBadge>
						</div>
						<p class="truncate font-mono text-xs text-(--ui-text-muted)">
							{{ row.mgmtIp || "—" }} · {{ row.id }}
						</p>
						<p class="truncate text-xs text-(--ui-text-muted)">
							{{ $t("pages.topology-device-metrics.rowHealth", {
								cpu: formatPercent(row.cpu),
								mem: formatPercent(row.mem),
								ports: formatPorts(row),
							}) }}
						</p>
					</li>
				</ul>
			</template>

			<template #list-footer>
				<LayoutListFooter v-model:page="page" v-model:page-size="pageSize" :total="total" :disabled="loading">
					{{ $t("pages.topology-device-metrics.total", { total }) }}
				</LayoutListFooter>
			</template>

			<template #detail>
				<div class="flex min-h-full flex-col">
					<!-- `?id` 不在当前页结果集：零详情请求 + 一次提示，不清空 URL（D6） -->
					<div v-if="isMissing" class="p-4">
						<UAlert
							color="warning"
							variant="subtle"
							icon="carbon:unlink"
							:title="$t('pages.topology-device-metrics.selectionMissingTitle')"
							:description="$t('pages.topology-device-metrics.selectionMissing', { id: selectedId, size: pageSize })"
						>
							<template #actions>
								<UButton
									size="sm"
									color="neutral"
									variant="subtle"
									:label="$t('pages.topology-device-metrics.selectionClear')"
									@click="clearSelection()"
								/>
							</template>
						</UAlert>
					</div>

					<div v-else-if="selected" class="max-w-[720px] space-y-5 p-4">
						<div class="min-w-0">
							<h2 class="truncate text-base font-semibold">
								{{ selected.name }}
							</h2>
							<p class="truncate font-mono text-xs text-(--ui-text-muted)">
								{{ selected.id }}
							</p>
						</div>

						<dl class="grid grid-cols-[minmax(5rem,auto)_1fr] items-baseline gap-x-4 gap-y-3 text-sm">
							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.topology-device-metrics.columns.mgmtIp") }}
							</dt>
							<dd class="break-all font-mono text-xs">
								{{ selected.mgmtIp || "—" }}
							</dd>

							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.topology-device-metrics.columns.role") }}
							</dt>
							<dd class="break-all">
								{{ selected.role || "—" }}
							</dd>

							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.topology-device-metrics.columns.vendor") }}
							</dt>
							<dd class="break-all">
								{{ selected.vendor || "—" }}
							</dd>

							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.topology-device-metrics.columns.status") }}
							</dt>
							<!-- 上游状态枚举未定稿：原样展示，未知取值不映射成「其他」（ARCH-006 §7.2） -->
							<dd>
								<UBadge v-if="selected.status" :color="statusColor(selected.status)" variant="subtle">
									{{ selected.status }}
								</UBadge>
								<span v-else>—</span>
							</dd>

							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.topology-device-metrics.columns.cpu") }}
							</dt>
							<dd>{{ formatPercent(selected.cpu) }}</dd>

							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.topology-device-metrics.columns.mem") }}
							</dt>
							<dd>{{ formatPercent(selected.mem) }}</dd>

							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.topology-device-metrics.columns.ports") }}
							</dt>
							<dd>{{ formatPorts(selected) }}</dd>
						</dl>

						<section class="space-y-2">
							<h3 class="text-sm font-semibold">
								{{ $t("pages.topology-device-metrics.trendTitle") }}
							</h3>
							<!-- 折线交给共享面板：选择器 / 速率开关 / 三种空态都在那里，页面不重复 -->
							<MetricTrendPanel
								:ip="selected.mgmtIp"
								:name="selected.name"
								:missing-ip-text="$t('pages.topology-device-metrics.noIp')"
							/>
						</section>
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
	import type { MetricDeviceRow } from "~~/app/utils/metric/metricLedger";
	import type { MetricDeviceFact } from "~~/shared/types/metric";
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

	/** 每页条数与列表页同源（`shared/constants/paging`），不在页面里写死一个数字 */
	const { facts, page, pageSize, total, loading, error, reload } = useMetricLedger<MetricDeviceFact>("/api/metric/device", {
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

	/** 工具栏内容跟随当前面板（§4.4）：覆盖式详情态左区换成唯一「返回」 */
	const toolbarPane = computed<"list" | "detail">(() =>
		shape.value === "overlay" && hasSelection.value ? "detail" : "list");

	/** 面包屑记录段（§5.1）：点击 = 清除选择，工具栏不直接写 URL */
	const { clearRequests } = useRecordContext(selection.label);
	watch(clearRequests, () => clearSelection());

	// ── 键盘：listbox 语义（§3.6）──────────────────────────────────────────────
	/** 行元素（`li[role=option]`）：`↑/↓/Home/End` 把焦点搬到目标行 */
	const rowElements = new Map<string, HTMLElement>();

	function setRowRef(id: string, element: unknown): void {
		if (element instanceof HTMLElement)
			rowElements.set(id, element);
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

	/** `null` = 不可判定（契约禁 0 伪造）：显示 `—`，不写成 0%（§九） */
	function formatPercent(value: number | null): string {
		return value === null ? "—" : `${value.toFixed(1)}%`;
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
