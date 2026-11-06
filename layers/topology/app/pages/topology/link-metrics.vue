<template>
	<div class="flex min-h-0 flex-1 flex-col">
		<!--
			`/topology/link-metrics` 链路遥测指标（两栏，NMCPS-ADR-0017 D1）。
			左栏 = `/metric/link` 的链路台账（`NMCPS-CONTRACT-002` §九），右栏 = 链路当前值 + source 端设备的趋势。
			链路**没有 `mgmt_ip`**：折线用 source 端设备的指标（缺口登记在 NMCPS-DESIGN-001 §6.6，不伪造）。
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
			<UTooltip v-else :text="$t('pages.topology-link-metrics.refresh')">
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

				<div v-else-if="rows.length === 0" class="flex flex-col items-center gap-2 p-6 text-center">
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
					<li
						v-for="row in rows"
						:key="row.id"
						:ref="(element) => setRowRef(row.id, element)"
						role="option"
						:aria-selected="row.id === selectedId"
						:tabindex="row.id === selectedId || (!selectedId && row === rows[0]) ? 0 : -1"
						:title="`${row.id} · ${row.sourceLabel} → ${row.targetLabel}`"
						data-testid="metric-link-row"
						:data-link-id="row.id"
						class="cursor-pointer border-s-2 px-3 py-2 outline-none transition-colors hover:bg-elevated focus-visible:bg-elevated focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
						:class="row.id === selectedId ? 'border-primary bg-accented' : 'border-transparent'"
						@click="selection.select(row)"
						@keydown.enter.prevent="selection.select(row)"
						@keydown.space.prevent="selection.select(row)"
					>
						<div class="flex min-w-0 items-center justify-between gap-2">
							<p class="truncate text-sm font-medium">
								{{ row.sourceLabel || "—" }} → {{ row.targetLabel || "—" }}
							</p>
							<UBadge v-if="row.status" :color="statusColor(row.status)" variant="subtle" size="sm">
								{{ row.status }}
							</UBadge>
						</div>
						<p class="truncate font-mono text-xs text-(--ui-text-muted)">
							{{ row.id }}
						</p>
						<p class="truncate text-xs text-(--ui-text-muted)">
							{{ $t("pages.topology-link-metrics.rowMetrics", {
								usage: formatPercent(row.usagePercent),
								latency: formatMillis(row.latencyMs),
							}) }}
						</p>
					</li>
				</ul>
			</template>

			<template #list-footer>
				<LayoutListFooter v-model:page="page" v-model:page-size="pageSize" :total="total" :disabled="loading">
					{{ $t("pages.topology-link-metrics.total", { total }) }}
				</LayoutListFooter>
			</template>

			<template #detail>
				<div class="flex min-h-full flex-col">
					<div v-if="isMissing" class="p-4">
						<UAlert
							color="warning"
							variant="subtle"
							icon="carbon:unlink"
							:title="$t('pages.topology-link-metrics.selectionMissingTitle')"
							:description="$t('pages.topology-link-metrics.selectionMissing', { id: selectedId, size: pageSize })"
						>
							<template #actions>
								<UButton
									size="sm"
									color="neutral"
									variant="subtle"
									:label="$t('pages.topology-link-metrics.selectionClear')"
									@click="clearSelection()"
								/>
							</template>
						</UAlert>
					</div>

					<div v-else-if="selected" class="max-w-[720px] space-y-5 p-4">
						<div class="min-w-0">
							<h2 class="truncate text-base font-semibold">
								{{ selected.sourceLabel || "—" }} → {{ selected.targetLabel || "—" }}
							</h2>
							<p class="truncate font-mono text-xs text-(--ui-text-muted)">
								{{ selected.id }}
							</p>
						</div>

						<dl class="grid grid-cols-[minmax(5rem,auto)_1fr] items-baseline gap-x-4 gap-y-3 text-sm">
							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.topology-link-metrics.columns.linkId") }}
							</dt>
							<dd class="break-all font-mono text-xs">
								{{ selected.id }}
							</dd>

							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.topology-link-metrics.columns.endpoints") }}
							</dt>
							<dd class="break-all font-mono text-xs">
								{{ selected.sourceCode || "—" }} → {{ selected.targetCode || "—" }}
							</dd>

							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.topology-link-metrics.columns.medium") }}
							</dt>
							<dd class="break-all">
								{{ selected.medium || "—" }}
							</dd>

							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.topology-link-metrics.columns.status") }}
							</dt>
							<dd>
								<UBadge v-if="selected.status" :color="statusColor(selected.status)" variant="subtle">
									{{ selected.status }}
								</UBadge>
								<span v-else>—</span>
							</dd>

							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.topology-link-metrics.columns.usage") }}
							</dt>
							<dd>{{ formatPercent(selected.usagePercent) }}</dd>

							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.topology-link-metrics.columns.latency") }}
							</dt>
							<dd>{{ formatMillis(selected.latencyMs) }}</dd>

							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.topology-link-metrics.columns.loss") }}
							</dt>
							<dd>{{ formatPercent(selected.packetLossPercent) }}</dd>

							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.topology-link-metrics.columns.capacity") }}
							</dt>
							<dd>{{ formatMbps(selected.bandwidthMbps) }}</dd>
						</dl>

						<!-- 链路级时序缺口：如实说明「这条折线是谁的」，不把设备曲线说成链路曲线 -->
						<UAlert
							color="info"
							variant="subtle"
							icon="carbon:information"
							:title="$t('pages.topology-link-metrics.gapTitle')"
							:description="$t('pages.topology-link-metrics.gapBody', { source: selected.sourceCode || '—' })"
						/>

						<section class="space-y-2">
							<h3 class="text-sm font-semibold">
								{{ $t("pages.topology-link-metrics.trendTitle") }}
							</h3>
							<MetricTrendPanel
								:ip="sourceIp"
								:name="selected.sourceCode || selected.id"
								:missing-ip-text="$t('pages.topology-link-metrics.noIp')"
							/>
						</section>
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
	import type { MetricLinkRow } from "~~/app/utils/metric/metricLedger";
	import type { MetricDeviceFact, MetricLinkFact } from "~~/shared/types/metric";
	import { deviceIpIndex, normalizeMetricLinks } from "~~/app/utils/metric/metricLedger";
	import { DEFAULT_PAGE_SIZE } from "~~/shared/constants/paging";

	/**
	 * `/topology/link-metrics` 链路遥测指标（两栏台账 + 当前值 + source 端设备趋势）。
	 *
	 * 设计基准：NMCPS-ARCH-006 §3（layers/content/collections/cn/architecture/1.architecture/ui-architecture.md）
	 * 契约来源：NMCPS-CONTRACT-002 §六（`/metric/datapoint`）、§八（目录 join）、§九（`/metric/link` 台账）
	 * 领域口径：NMCPS-DESIGN-001 §6.6（layers/content/collections/cn/architecture/2.domain/topology.md）
	 *
	 * ── 链路级时序缺口（如实登记，不假装已补）────────────────────────────────
	 * `/metric/link` 的条目里**没有 `mgmt_ip`**，`/metric/datapoint` 只认设备管理 IP，所以链路自己没有
	 * 历史曲线。页面用 `identity.source.device_code` 经 `/metric/device` 反查 source 端设备的 IP，
	 * 画的是**那台设备**的指标：面板上方用一条 info 提示把这件事说清楚。反查不到 IP 就只展示当前值、
	 * 不出折线 —— 绝不猜一个地址去取数。上游补上链路级时序端点后，整段替换这里即可。
	 */
	definePageMeta({ sort: 3, icon: "carbon:link" });

	const shape = ref<"two" | "overlay">("two");

	const { facts, page, pageSize, total, loading, error, reload } = useMetricLedger<MetricLinkFact>("/api/metric/link", {
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

	/** 折线的入参：source 端设备的 `mgmt_ip`；查不到就是空串（面板据此说明原因，不发空请求） */
	const sourceIp = computed(() => {
		const code = selected.value?.sourceCode;
		return code ? ipIndex.value.get(code) ?? "" : "";
	});

	const toolbarPane = computed<"list" | "detail">(() =>
		shape.value === "overlay" && hasSelection.value ? "detail" : "list");

	const { clearRequests } = useRecordContext(selection.label);
	watch(clearRequests, () => clearSelection());

	/** 工具栏「刷新」= 台账 + 设备索引一起重取（否则换了 IP 的链路会一直画出旧设备的曲线） */
	function reloadAll(): void {
		void reload();
		void reloadDevices();
	}

	// ── 键盘：listbox 语义（§3.6）──────────────────────────────────────────────
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

	/** `null` = 不可判定（契约禁 0 伪造）：显示 `—`，不写成 0（§九） */
	function formatPercent(value: number | null): string {
		return value === null ? "—" : `${value.toFixed(1)}%`;
	}

	function formatMillis(value: number | null): string {
		return value === null ? "—" : `${value.toFixed(1)} ms`;
	}

	function formatMbps(value: number | null): string {
		return value === null ? "—" : `${value.toFixed(1)} Mbps`;
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
