<template>
	<div class="flex min-h-0 flex-1 flex-col gap-3 p-3">
		<!--
			工具栏（NMCPS-ARCH-006 §4）：左区集合域动作 + 这张图的呈现控件，右区页头读数。
			2026-11-09 用户调整：左区顺序 = 布局下拉 → 旋转 → 缩放 → 显示名称 → 恢复默认配置 → 更新；
			旋转「复位」与缩放「复位」两枚小按钮下线 —— 同一个动作在「恢复默认配置」里已经三合一，
			一排放三个同款 `carbon:reset` 只会让人不确定该点哪一个。
		-->
		<Teleport to="#app-toolbar-left">
			<!-- 2D 布局切换（§6.8）：词表只有两档（径向扇 / 层级树），图标与词表同源（`TOPOLOGY_LAYOUT_ICONS`） -->
			<UDropdownMenu :items="layoutItems" :content="{ align: 'start' }">
				<UButton
					data-testid="topology-layout-switcher"
					:data-layout="layoutMode"
					size="sm"
					color="neutral"
					variant="ghost"
					:icon="layoutIcon"
					trailing-icon="carbon:chevron-down"
					:label="$t(`pages.topology-monitor.layouts.${layoutMode}`)"
				/>
			</UDropdownMenu>
			<!--
				画布控件排（§6.15 / 2026-11-09 用户调整）：旋转 / 缩放**搬进工具栏左区**，
				与布局下拉同一行 —— 它们读的都是「这张图怎么呈现」（几何 + 视口），与左区的集合域动作
				同属「对这张图做什么」；原先压在画布右上角会盖住最上层的节点与连线（A48）。
			-->
			<div
				data-testid="topology-controls"
				class="flex flex-wrap items-center gap-1"
			>
				<!-- 径向扇旋转控件（§6.8，1.0 v0.28 同款）：只在 `radial` 布局出现 ——
					其它布局不读这个角度，摆一个置灰的滑块等于暗示「拖了会有区别」 -->
				<div v-if="canRotate" data-testid="topology-rotate" class="flex items-center gap-1">
					<USlider
						:model-value="rotationDeg"
						:min="TOPOLOGY_ROTATE_MIN"
						:max="TOPOLOGY_ROTATE_MAX"
						:step="1"
						size="sm"
						class="w-24"
						:aria-label="$t('pages.topology-monitor.rotate.label')"
						@update:model-value="onRotate"
					/>
					<UBadge size="sm" variant="outline" color="neutral" class="min-w-10 justify-center tabular-nums">
						{{ rotationDeg }}°
					</UBadge>
					<UFieldGroup size="sm">
						<UButton
							data-testid="topology-rotate-ccw"
							size="xs"
							color="neutral"
							variant="subtle"
							icon="carbon:rotate-counterclockwise"
							:aria-label="$t('pages.topology-monitor.rotate.ccw')"
							@click="nudgeRotation(TOPOLOGY_ROTATE_STEP)"
						/>
						<UButton
							data-testid="topology-rotate-cw"
							size="xs"
							color="neutral"
							variant="subtle"
							icon="carbon:rotate-clockwise"
							:aria-label="$t('pages.topology-monitor.rotate.cw')"
							@click="nudgeRotation(-TOPOLOGY_ROTATE_STEP)"
						/>
					</UFieldGroup>
				</div>

				<!-- 视口缩放（键盘与无滚轮设备可达）：读数同时也是一处「现在是几倍」。
					缩放「复位」已下线（2026-11-09）：复位视口是「恢复默认配置」的第三步，单摆一枚
					同款 `carbon:reset` 只会让人不确定两个 reset 差在哪 -->
				<UButton
					data-testid="topology-zoom-out"
					size="xs"
					color="neutral"
					variant="subtle"
					icon="carbon:subtract"
					:aria-label="$t('pages.topology-monitor.zoomOut')"
					@click="canvasRef?.zoomOut()"
				/>
				<UBadge data-testid="topology-zoom" size="sm" variant="subtle" color="neutral" class="tabular-nums">
					{{ zoomPercent }}%
				</UBadge>
				<UButton
					data-testid="topology-zoom-in"
					size="xs"
					color="neutral"
					variant="subtle"
					icon="carbon:add"
					:aria-label="$t('pages.topology-monitor.zoomIn')"
					@click="canvasRef?.zoomIn()"
				/>

				<!-- 显示名称（§七）：关掉后只剩节点与状态圆点 —— 塔型最宽层有 20+ 台设备时，
					名称仍会盖住相邻节点，看层级的人可以一键清空文字（不是隐藏数据，只是不画标签） -->
				<UTooltip :text="$t('pages.topology-monitor.labels.toggleHint')">
					<UButton
						data-testid="topology-labels-toggle"
						:data-labels="showLabels"
						:aria-pressed="showLabels"
						size="xs"
						color="neutral"
						:variant="showLabels ? 'subtle' : 'ghost'"
						:icon="showLabels ? 'carbon:view' : 'carbon:view-off'"
						:label="$t('pages.topology-monitor.labels.toggle')"
						@click="showLabels = !showLabels"
					/>
				</UTooltip>

				<!-- 恢复默认配置（§6.9，1.0 v0.36 同款三合一）：清位移 → 旋转角回默认 → 视口复位 -->
				<UTooltip
					:text="canResetView
						? $t('pages.topology-monitor.resetView.label')
						: $t('pages.topology-monitor.resetView.hint')"
				>
					<UButton
						data-testid="topology-reset-view"
						:data-offsets="nodeOffsetCount"
						size="xs"
						color="neutral"
						variant="subtle"
						icon="carbon:reset"
						:label="$t('pages.topology-monitor.resetView.label')"
						:disabled="!canResetView"
						@click="resetViewConfig()"
					/>
				</UTooltip>

				<!--
					更新（原工具栏左区第一枚「刷新拓扑」，2026-11-09 用户调整）：补上文字并挪到左区最后 ——
					最常用的一枚动作放在排尾（紧贴右侧读数），前面几枚都是「这张图怎么画」的设置。
				-->
				<UTooltip :text="$t('pages.topology-monitor.refresh')">
					<UButton
						data-testid="topology-refresh"
						size="xs"
						color="neutral"
						variant="subtle"
						icon="carbon:renew"
						:loading="refreshing"
						:label="$t('pages.topology-monitor.refreshLabel')"
						:aria-label="$t('pages.topology-monitor.refresh')"
						@click="refresh()"
					/>
				</UTooltip>
			</div>
		</Teleport>

		<Teleport to="#app-toolbar-right">
			<!--
				页头读数（1.0 顶栏版式，§七）：节点 / 链路 / 组合 / 告警四档**全在工具栏右区**，
				不再占一行卡片（那一行 100px 高只为装几个数字，把画布往下推）。
				口径不变：全部来自已取到的数据，缺数据写「—」而不是 0（告警通道没起来时 0 条是误读）。
			-->
			<div data-testid="topology-stats" class="flex items-center gap-1">
				<LayoutToolbarBadge
					v-for="stat in statBadges"
					:key="stat.key"
					:data-testid="`topology-stat-${stat.key}`"
					:data-stat-value="stat.text"
					variant="subtle"
					:color="stat.color"
					:icon="stat.icon"
					:label="`${stat.label} ${stat.text}`"
				/>
			</div>
		</Teleport>

		<!--
			仿真通道降级（§八 硬性要求）：只保留「不可达」这一条 —— 它说的是「本可以工作但现在坏了、可重试」。
			「未配置」不再挂告警条：那是**部署形态**而不是故障，链路动作按钮已整体置灰、tooltip 写明原因
			（`linkActionHint` 的 `simulator_not_configured` 分支），页头再压一条 100px 高的常驻告警
			等于把「没装仿真平台」当成缺陷报给用户（1.0 的顶栏也没有这条）。
		-->
		<UAlert
			v-if="simState === 'unreachable'"
			data-testid="sim-degraded"
			color="warning"
			variant="subtle"
			icon="carbon:warning-alt"
			:title="$t('pages.topology-monitor.degraded.unreachableTitle')"
			:description="$t('pages.topology-monitor.degraded.unreachableBody', { reason: simReason })"
		/>

		<!-- 主上游失败：页面级错误 + 重试，不白屏（A5） -->
		<div v-if="graphError" data-testid="topology-error" class="p-3">
			<UAlert
				color="error"
				variant="subtle"
				icon="carbon:warning-alt"
				:title="$t('pages.topology-monitor.error.title')"
				:description="graphError.message"
			>
				<template #actions>
					<UButton
						size="sm"
						color="neutral"
						variant="subtle"
						:label="$t('pages.topology-monitor.error.retry')"
						@click="refresh()"
					/>
				</template>
			</UAlert>
		</div>

		<!-- 首屏骨架：只在第一次取数时出现，轮询不闪 -->
		<div v-else-if="loading" class="flex min-h-0 flex-1 items-center justify-center">
			<USkeleton class="h-full w-full rounded-lg" />
		</div>

		<!-- 空拓扑：空态而不是空白画布（A4） -->
		<div
			v-else-if="nodeCount === 0"
			data-testid="topology-empty"
			class="flex min-h-0 flex-1 items-center justify-center"
		>
			<div class="flex max-w-sm flex-col items-center gap-3 text-center">
				<UIcon name="carbon:network-4" class="size-12 text-(--ui-text-muted)" />
				<h2 class="text-lg font-semibold">
					{{ $t("pages.topology-monitor.empty.title") }}
				</h2>
				<p class="text-sm text-(--ui-text-muted)">
					{{ $t("pages.topology-monitor.empty.body") }}
				</p>
				<UButton
					size="sm"
					color="neutral"
					variant="subtle"
					icon="carbon:renew"
					:label="$t('pages.topology-monitor.error.retry')"
					@click="refresh()"
				/>
			</div>
		</div>
		<div v-else class="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
			<!-- 画布：布局由纯函数注入，交互收敛在 `useGraphInteraction()`。
				背景**透明**（2026-11-09 用户裁决）：画布不再自带一块 `--ui-bg` 底色，直接透出页面底色，
				节点与连线因此浮在同一层「纸」上；边框与圆角保留 —— 那说明的是「这张图的边界在哪」。 -->
			<div class="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-(--ui-border)">
				<GraphTopologyCanvas
					ref="canvasRef"
					:nodes="layout.nodes"
					:links="layout.links"
					:width="layout.width"
					:height="layout.height"
					:selected-id="canvasSelectedId"
					:selected-link-key="selectedLinkKey"
					:highlight-link-keys="highlight.linkKeys"
					:highlight-node-ids="highlight.neighborIds"
					:collapsed-ids="collapsedNodes"
					:child-counts="collapseChildCounts"
					:link-title="linkTitle"
					:markers="markers"
					:alarms="alarmIndex"
					:offsets="nodeOffsets"
					:show-labels="showLabels"
					:label="$t('pages.topology-monitor.canvasLabel')"

					@select="pickNode"
					@select-link="selectLink"
					@toggle-collapse="toggleCollapse"
					@offset-change="moveNode"
					@viewport-change="(dirty: boolean) => (viewportDirty = dirty)"
					@zoom-change="(percent: number) => (zoomPercent = percent)"
				/>

				<!-- 角标列：裁剪（§八）与被收起的区域分组（§6.11）都只说明「眼前这张图少了什么」 -->
				<div class="pointer-events-none absolute top-2 left-2 flex flex-col items-start gap-1">
					<UBadge
						v-if="layout.croppedNodes > 0 || layout.croppedLinks > 0"
						data-testid="topology-cropped"
						size="sm"
						color="warning"
						variant="subtle"
					>
						{{ $t("pages.topology-monitor.cropped", { nodes: layout.croppedNodes, links: layout.croppedLinks }) }}
					</UBadge>
					<UBadge
						v-if="collapsedNodeCount > 0"
						data-testid="topology-collapsed"
						size="sm"
						color="neutral"
						variant="subtle"
					>
						{{ $t("pages.topology-monitor.groups.collapsedBadge", { count: collapsedNodeCount, groups: collapsedCombos.length }) }}
					</UBadge>
					<!--
						区域分组（§6.11）：折叠 / 聚焦 / 组计数收进画布左上角的一枚浮层。
						它决定的是「这张图包括谁」，属于**画布的读法**；侧栏只留选中对象的事实卡
						（一个分组列表不会因为点了某台设备而改变，摆在事实卡堆里只会挡路）。
					-->
					<UPopover v-if="comboGroups.length" :content="{ align: 'start' }">
						<UButton
							data-testid="topology-groups-toggle"
							size="xs"
							color="neutral"
							variant="subtle"
							icon="carbon:group-objects"
							class="pointer-events-auto"
							:label="$t('pages.topology-monitor.groups.title')"
							:aria-label="$t('pages.topology-monitor.groups.title')"
						/>
						<template #content>
							<div data-testid="topology-groups" class="w-72 p-3">
								<div class="mb-2 flex items-baseline justify-between gap-2">
									<h2 class="text-sm font-semibold">
										{{ $t("pages.topology-monitor.groups.title") }}
									</h2>
									<UButton
										v-if="collapsedCombos.length"
										data-testid="topology-groups-expand"
										size="xs"
										color="neutral"
										variant="ghost"
										:label="$t('pages.topology-monitor.groups.expandAll')"
										@click="expandAllCombos()"
									/>
								</div>
								<!-- `counts` 是上游自报，`visible` 是画布真实成员：折叠只摘画布，不改计数 -->
								<ul class="flex flex-col gap-1 text-xs">
									<li v-for="group in comboGroups" :key="group.id" class="flex items-start justify-between gap-2">
										<div class="min-w-0 flex-1">
											<div class="flex items-center gap-1">
												<span class="truncate font-medium">{{ group.label }}</span>
												<UBadge v-if="group.collapsed" size="sm" variant="subtle" color="neutral">
													{{ $t("pages.topology-monitor.groups.collapsed") }}
												</UBadge>
												<UBadge v-if="focusedCombo === group.id" size="sm" variant="subtle" color="primary">
													{{ $t("pages.topology-monitor.groups.focused") }}
												</UBadge>
											</div>
											<p
												:data-testid="`topology-group-counts-${group.id}`"
												class="text-(--ui-text-muted)"
											>
												{{ countsText(group.counts) }}
											</p>
											<p class="text-(--ui-text-muted)">
												{{ $t("pages.topology-monitor.groups.members", { visible: group.visible, declared: group.declared ?? group.visible }) }}
											</p>
										</div>
										<UTooltip :text="group.collapsed ? $t('pages.topology-monitor.groups.expand') : $t('pages.topology-monitor.groups.collapse')">
											<UButton
												data-testid="topology-combo-toggle"
												:data-combo-id="group.id"
												:data-collapsed="group.collapsed"
												size="xs"
												color="neutral"
												variant="ghost"
												:icon="group.collapsed ? 'carbon:view' : 'carbon:view-off'"
												:aria-label="group.collapsed ? $t('pages.topology-monitor.groups.expand') : $t('pages.topology-monitor.groups.collapse')"
												@click="toggleCombo(group.id)"
											/>
										</UTooltip>
										<!-- 「只看该组」：折叠是「摘掉」，聚焦是「只留」，两个方向都要有入口 -->
										<UTooltip :text="$t('pages.topology-monitor.groups.focus')">
											<UButton
												data-testid="topology-combo-focus"
												:data-combo-id="group.id"
												:data-focused="focusedCombo === group.id"
												size="xs"
												color="neutral"
												variant="ghost"
												icon="carbon:center-circle"
												:aria-label="$t('pages.topology-monitor.groups.focus')"
												@click="focusCombo(group.id)"
											/>
										</UTooltip>
									</li>
								</ul>
								<p class="mt-2 text-xs text-(--ui-text-muted)">
									{{ $t("pages.topology-monitor.groups.hint") }}
								</p>
							</div>
						</template>
					</UPopover>
					<!-- 收起下级（§6.15）：「已收起 N 台」读数 + 一键全部展开（与分组折叠的徽标分开写，两件事） -->
					<div v-if="collapsedHiddenCount > 0" class="pointer-events-auto flex items-center gap-1">
						<UBadge
							data-testid="topology-node-collapsed-badge"
							:data-hidden-count="collapsedHiddenCount"
							size="sm"
							color="neutral"
							variant="subtle"
						>
							{{ $t("pages.topology-monitor.collapse.hiddenBadge", { count: collapsedHiddenCount }) }}
						</UBadge>
						<UButton
							v-if="hasCollapsedNodes"
							data-testid="topology-expand-all"
							size="xs"
							color="neutral"
							variant="subtle"
							:label="$t('pages.topology-monitor.collapse.expandAll')"
							@click="expandAllCollapsed()"
						/>
					</div>
					<!-- 告警叠加读数（§6.1）：条数 + 设备数，两个数不可互换，所以并排写出来 -->
					<UBadge
						v-if="hasAlarms"
						data-testid="topology-alarm-badge"
						:data-alarm-events="alarmFiringCount"
						:data-alarm-nodes="alarmNodeCount"
						size="sm"
						:color="alarmBadgeColor"
						variant="subtle"
					>
						{{ $t("pages.topology-monitor.alarms.badge", { events: alarmFiringCount, nodes: alarmNodeCount }) }}
					</UBadge>
					<!-- 只看某个分组（§6.11）：画布上标明「这不是全部」，并给一键回到全部 -->
					<UBadge v-if="focusedComboLabel" data-testid="topology-focus-badge" size="sm" color="primary" variant="subtle">
						{{ $t("pages.topology-monitor.groups.focusBadge", { label: focusedComboLabel }) }}
					</UBadge>
					<!-- 「回到全部」跟着徽标走（left 列）：右侧 top-2 已被旋转控件占着，不抢位置 -->
					<UButton
						v-if="focusedCombo"
						data-testid="topology-focus-clear"
						size="xs"
						color="neutral"
						variant="subtle"
						icon="carbon:close"
						:label="$t('pages.topology-monitor.groups.focusClear')"
						class="pointer-events-auto"
						@click="clearComboFocus()"
					/>
				</div>

				<!--
					图例（§七 / §6.15 要求 5，2026-11-08 用户裁决「右下角图例去掉多余说明」）：
					只留**这张图实际出现**的层色一行（`presentRoles()`：没有选举出根就不列「边界层」）。
					原先的三段（层色标题 / 状态圆点组 / 「虚线 = 仿真」提示）已删：状态由每台节点中心的
					圆点直接读出、仿真节点自带标记，图例只需要回答「外圈这几种颜色分别是哪一层」。
				-->
				<div
					data-testid="topology-legend"
					class="pointer-events-none absolute right-2 bottom-2 rounded-md border border-(--ui-border) bg-(--ui-bg)/90 px-2 py-1 text-[11px]"
				>
					<ul data-testid="topology-legend-roles" class="flex flex-wrap items-center gap-x-2 gap-y-1">
						<li v-for="role in legendRoles" :key="role" class="flex items-center gap-1">
							<span
								class="size-2.5 rounded-full border-2 bg-(--ui-bg-elevated)"
								:class="[roleDotClass(role)]"
								:data-role="role"
								:data-role-color="roleColor(role)"
							/>
							{{ $t(roleI18nKey(role)) }}
						</li>
					</ul>
				</div>
			</div>

			<!--
				详情栏：选中节点 / 链路 → 现网口径 + 仿真标记；未选中给一句指引（图例在画布右下角）。
				**二选一**（§6.15 要求 2）：选中链路时右栏整块切到链路详情，节点的无线 / 告警 / LLDP
				卡片全部让位 —— 两套事实上下堆在一起，用户分不清「这条告警是链路的还是设备的」。
			-->
			<aside class="flex w-full shrink-0 flex-col gap-3 lg:w-72">
				<div v-if="!selectedLink" class="rounded-lg border border-(--ui-border) p-3">
					<h2 class="mb-2 text-sm font-semibold">
						{{ $t("pages.topology-monitor.detail.title") }}
					</h2>

					<template v-if="selected">
						<div class="flex items-center justify-between gap-2">
							<span class="truncate font-medium">{{ selected.label }}</span>
							<UBadge size="sm" variant="subtle" :color="nodeStatusColor(selected.status)">
								{{ $t(statusI18nKey(selected.status)) }}
							</UBadge>
						</div>

						<dl class="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.topology-monitor.detail.ip") }}
							</dt>
							<dd class="truncate">
								{{ selected.ip || "—" }}
							</dd>
							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.topology-monitor.detail.tier") }}
							</dt>
							<dd>{{ selected.tier }}</dd>
							<dt class="text-(--ui-text-muted)">
								{{ $t("pages.topology-monitor.detail.category") }}
							</dt>
							<dd class="truncate">
								{{ selected.category || "—" }}
							</dd>
						</dl>

						<!-- 节点事实（NMCPS-DESIGN-001 §6.5）：CPU / 内存进度条 + 接口·邻居·流量 KPI。
						未知（上游没给 / 1.0 的 `-1` 哨兵）一律写「—」且不画空进度条 —— 空条读成 0%。 -->
						<div class="mt-3 flex flex-col gap-2 border-t border-(--ui-border) pt-2 text-xs">
							<div v-for="meter in percentMeters" :key="meter.key">
								<div class="mb-1 flex items-baseline justify-between gap-2">
									<span class="text-(--ui-text-muted)">{{ $t(meter.label) }}</span>
									<span
										:data-testid="`topology-fact-${meter.key}`"
										class="font-medium tabular-nums"
										:class="meter.value === null ? 'text-(--ui-text-muted)' : 'text-(--ui-text)'"
									>{{ formatPercent(meter.value) }}</span>
								</div>
								<UProgress
									v-if="meter.value !== null"
									data-testid="topology-meter"
									:model-value="meter.value"
									:color="percentColor(meter.value)"
									size="xs"
								/>
							</div>

							<dl class="grid grid-cols-3 gap-1.5 pt-1 text-center">
								<div v-for="card in factCards" :key="card.key" class="rounded-md bg-(--ui-bg-elevated) py-1">
									<dt class="text-[11px] text-(--ui-text-muted)">
										{{ card.label }}
									</dt>
									<dd :data-testid="`topology-fact-${card.key}`" class="text-sm font-semibold tabular-nums">
										{{ card.text }}<span v-if="card.unit" class="ml-0.5 text-[10px] font-normal text-(--ui-text-muted)">{{ card.unit }}</span>
									</dd>
								</div>
							</dl>
						</div>

						<!-- 邻居列表（1.0 的「邻居情况」）：只列**当前画布**上真实存在的链路，点一条跳过去 -->
						<div class="mt-3 border-t border-(--ui-border) pt-2 text-xs">
							<h3 class="mb-1 flex items-baseline justify-between gap-2 font-medium">
								<span>{{ $t("pages.topology-monitor.detail.neighborsTitle") }}</span>
								<span class="text-(--ui-text-muted)">{{ selectedNeighbors.length }}</span>
							</h3>
							<ul v-if="selectedNeighbors.length" class="flex flex-col gap-0.5">
								<li v-for="(neighbor, index) in selectedNeighbors" :key="`${neighbor.id}-${index}`">
									<UButton
										data-testid="topology-neighbor"
										:data-node-id="neighbor.id"
										size="xs"
										color="neutral"
										variant="ghost"
										block
										class="justify-start gap-1.5"
										@click="selectNode(neighbor.id)"
									>
										<span class="size-2 shrink-0 rounded-full" :class="nodeFillClass(neighbor.status)" />
										<span class="truncate">{{ neighbor.label }}</span>
										<UBadge size="sm" variant="subtle" :color="linkStatusColor(neighbor.linkStatus)" class="ml-auto">
											{{ $t(statusI18nKey(neighbor.linkStatus)) }}
										</UBadge>
									</UButton>
								</li>
							</ul>
							<p v-else class="text-(--ui-text-muted)">
								{{ $t("pages.topology-monitor.detail.neighborsEmpty") }}
							</p>
						</div>

						<div class="mt-3 border-t border-(--ui-border) pt-2 text-xs">
							<template v-if="selected.marker">
								<div class="flex items-center gap-1 font-medium">
									<UIcon name="carbon:simulation" class="size-3.5 text-(--ui-info)" />
									{{ $t("pages.topology-monitor.detail.simulated") }}
								</div>
								<dl class="mt-1 grid grid-cols-2 gap-x-2 gap-y-1">
									<dt class="text-(--ui-text-muted)">
										{{ $t("pages.topology-monitor.detail.simName") }}
									</dt>
									<dd class="truncate">
										{{ selected.marker.name }}
									</dd>
									<dt class="text-(--ui-text-muted)">
										{{ $t("pages.topology-monitor.detail.simStatus") }}
									</dt>
									<dd>{{ selected.marker.status }}</dd>
								</dl>
							</template>
							<p v-else class="text-(--ui-text-muted)">
								{{ simState === "ok" ? $t("pages.topology-monitor.detail.notSimulated") : $t("pages.topology-monitor.detail.simUnavailable") }}
							</p>
						</div>

						<!--
							跳到设备遥测指标页（§6.15）：深链带的是**管理 IP**（拓扑侧真有的身份），
							指标页用自己已取到的台账把它解析成 `device_code` 再写 `?id`。
							没有管理 IP 的节点不发一枚「点了会到空页」的按钮：禁用并在 tooltip 说明原因。

							位置在卡片**最底部**、`primary` 实心（2026-11-09 用户裁决）：这是离开本页的动作，
							压在事实之后当「下一步」，不再插在标题下面把事实挤走。
						-->
						<UTooltip
							:text="selected.ip
								? $t('pages.topology-monitor.detail.openMetricsHint')
								: $t('pages.topology-monitor.detail.openMetricsNoIp')"
						>
							<span class="mt-3 block">
								<UButton
									data-testid="topology-node-metrics"
									:data-mgmt-ip="selected.ip"
									size="xs"
									color="primary"
									variant="soft"
									icon="carbon:chart-line"
									block
									class="justify-center"
									:label="$t('pages.topology-monitor.detail.openMetrics')"
									:disabled="!selected.ip"
									@click="openDeviceMetrics()"
								/>
							</span>
						</UTooltip>
					</template>

					<p v-else class="text-xs text-(--ui-text-muted)">
						{{ $t("pages.topology-monitor.detail.empty") }}
					</p>
				</div>

				<!--
					链路事实（§6.11，click 画布上的一条链路）：基础事实来自 `data`（48/48 齐全），
					利用率 / 丢包 / 误码四项在现网恒为 0（＝没算），因此**整块写「未计算」**而不是列 4 行 0%。
				-->
				<div v-if="selectedLink && linkFacts" data-testid="topology-link-card" class="rounded-lg border border-(--ui-border) p-3">
					<!--
						标题没有关闭按钮（2026-11-09 用户裁决）：链路是「当前项」，退出靠**再点一次这条线**
						或点一台设备。一枚叉把「关掉卡片」和「取消选中」混成两件事，还让人以为卡片是个弹窗。
					-->
					<h2 class="mb-1 text-sm font-semibold">
						{{ $t("pages.topology-monitor.link.title") }}
					</h2>
					<p class="mb-2 truncate text-xs text-(--ui-text-muted)" :title="linkEndpoints">
						{{ linkEndpoints }}
					</p>

					<dl class="grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
						<template v-for="row in linkRows" :key="row.key">
							<dt class="truncate text-(--ui-text-muted)">
								{{ row.label }}
							</dt>
							<dd :data-testid="`topology-link-fact-${row.key}`" class="truncate" :class="row.unknown ? 'text-(--ui-text-muted)' : ''">
								{{ row.text }}
							</dd>
						</template>
					</dl>
					<p v-if="!linkHasUtilization(linkFacts)" class="mt-2 text-xs text-(--ui-text-muted)">
						{{ $t("pages.topology-monitor.link.utilNotComputedBody") }}
					</p>
					<!--
						链路动作（§6.2）：三个按钮改的是「这条线通不通」，都要二次确认。
						不在仿真里的链路整组置灰并给原因（`linkActionHint`），不假装能点。
					-->
					<div class="mt-3 border-t border-(--ui-border) pt-2">
						<div class="mb-1 flex items-center gap-1 text-xs font-medium">
							<UIcon name="carbon:simulation" class="size-3.5 text-(--ui-info)" />
							{{ $t("pages.topology-monitor.simControls.linkActions") }}
						</div>
						<UTooltip :text="linkActionHint">
							<span class="flex flex-wrap gap-1">
								<UButton
									v-for="action in SIMULATOR_LINK_ACTIONS"
									:key="action"
									data-testid="topology-link-action"
									:data-action="action"
									size="xs"
									color="neutral"
									variant="outline"
									:icon="linkActionIcon(action)"
									:label="$t(ACTION_LABEL_KEY[action])"
									:disabled="!canOperateLink"
									:loading="acting === action"
									@click="askLinkAction(action)"
								/>
							</span>
						</UTooltip>
						<p class="mt-1 text-[11px] text-(--ui-text-muted)">
							{{ linkActionHint }}
						</p>
					</div>

					<!--
						跳到链路遥测指标页（§6.15）：深链带两端的管理 IP，链路页用它反查 `link_id`。
						与设备卡片同一口径：压在最底部、`primary`（2026-11-09 用户裁决「指标按钮挪到最下面、
						用主色」）—— 读完全部事实再决定往下走。
					-->
					<UTooltip :text="$t('pages.topology-monitor.link.openMetricsHint')">
						<span class="mt-3 block">
							<UButton
								data-testid="topology-link-metrics"
								size="xs"
								color="primary"
								variant="soft"
								icon="carbon:chart-line"
								block
								class="justify-center"
								:label="$t('pages.topology-monitor.link.openMetrics')"
								@click="openLinkMetrics()"
							/>
						</span>
					</UTooltip>
				</div>

				<!-- 无线事实（AP，§6.11）：字段一个都没有就不画这块（否则等于宣称「这台 AP 的 SSID 取不到」） -->
				<div v-if="wifiFacts && !selectedLink" data-testid="topology-wifi-card" class="rounded-lg border border-(--ui-border) p-3">
					<h2 class="mb-2 text-sm font-semibold">
						{{ $t("pages.topology-monitor.wifi.title") }}
					</h2>
					<dl class="grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
						<template v-for="row in wifiRows" :key="row.key">
							<dt class="truncate text-(--ui-text-muted)">
								{{ row.label }}
							</dt>
							<dd :data-testid="`topology-wifi-${row.key}`" class="truncate">
								{{ row.text }}
							</dd>
						</template>
					</dl>
				</div>

				<!--
					当前告警（§6.1）：只列**能 join 到这台设备**的 firing 事件。
					告警通道不可用时写原因（`alarmReason` 是上游原话），不写「无告警」—— 那是结论，不是缺省。
				-->
				<div v-if="selected && !selectedLink" data-testid="topology-alarm-card" class="rounded-lg border border-(--ui-border) p-3">
					<div class="mb-2 flex items-center justify-between gap-2">
						<h2 class="text-sm font-semibold">
							{{ $t("pages.topology-monitor.alarms.cardTitle") }}
						</h2>
						<UBadge
							v-if="selectedAlarm"
							data-testid="topology-alarm-severity"
							size="sm"
							variant="subtle"
							:color="alarmSeverityColor(selectedAlarm.severity)"
						>
							{{ $t(`pages.topology-monitor.alarms.severity.${selectedAlarm.severity}`) }}
						</UBadge>
					</div>

					<p v-if="alarmState === 'error'" data-testid="topology-alarm-unavailable" class="text-xs text-(--ui-text-muted)">
						{{ $t("pages.topology-monitor.alarms.unavailable", { reason: alarmReason }) }}
					</p>

					<template v-else-if="selectedAlarm">
						<ul class="flex flex-col gap-2">
							<li
								v-for="event in selectedAlarmEvents"
								:key="event.id"
								data-testid="topology-alarm-event"
								:data-severity="event.severity"
								class="flex flex-col gap-0.5"
							>
								<div class="flex items-start gap-1.5">
									<span class="mt-1 size-1.5 shrink-0 rounded-full" :class="alarmBadgeFillClass(event.severity)" />
									<!-- 上游原话，逐字展示：告警描述是数据，不翻译也不改写 -->
									<span class="text-xs">{{ event.message }}</span>
								</div>
								<p class="pl-3 text-[11px] text-(--ui-text-muted)">
									<span v-if="event.eventType">{{ event.eventType }}</span>
									<span v-if="event.eventType"> · </span>{{ alarmTimeText(event.lastTriggeredAt) }}
									<span v-if="event.triggerCount !== null">
										· {{ $t("pages.topology-monitor.alarms.eventCount", { count: event.triggerCount }) }}
									</span>
								</p>
							</li>
						</ul>
						<p v-if="hiddenAlarmCount > 0" class="mt-2 text-xs text-(--ui-text-muted)">
							{{ $t("pages.topology-monitor.alarms.more", { count: hiddenAlarmCount }) }}
						</p>
					</template>

					<p v-else class="text-xs text-(--ui-text-muted)">
						{{ $t("pages.topology-monitor.alarms.empty") }}
					</p>
				</div>

				<!--
					LLDP 邻接（§6.13 取证 / §6.14 落地）：上游逐节点的邻接台账，与上面「邻居」不是同一件事 ——
					那一块是**本图画布**上的边，这一块是设备自报（可能指向画布外设备）。
					四种状态分开写，因为它们不是同一个结论：`idle`（不在仿真里，读不到台账）/ `loading` /
					`ok` 且空数组（上游明确说没有邻居）/ `error`（只给原因，不写「没有邻居」）。
				-->
				<div
					v-if="selected && !selectedLink"
					data-testid="topology-lldp-card"
					:data-lldp-state="neighborState"
					:data-lldp-count="neighborRows.length"
					:data-lldp-on-canvas="neighborCanvasNodeCount"
					class="rounded-lg border border-(--ui-border) p-3"
				>
					<div class="mb-2 flex items-baseline justify-between gap-2">
						<h2 class="text-sm font-semibold">
							{{ $t("pages.topology-monitor.lldp.title") }}
						</h2>
						<span v-if="neighborState === 'ok'" class="text-xs text-(--ui-text-muted)">
							{{ $t("pages.topology-monitor.lldp.counts", { total: neighborRows.length, onCanvas: neighborCanvasNodeCount }) }}
						</span>
					</div>

					<p v-if="neighborState === 'idle'" data-testid="topology-lldp-idle" class="text-xs text-(--ui-text-muted)">
						{{ simState === "ok" ? $t("pages.topology-monitor.lldp.notSimulated") : $t("pages.topology-monitor.lldp.unavailable") }}
					</p>
					<p v-else-if="neighborState === 'loading'" data-testid="topology-lldp-loading" class="text-xs text-(--ui-text-muted)">
						{{ $t("pages.topology-monitor.lldp.loading") }}
					</p>
					<p v-else-if="neighborState === 'error'" data-testid="topology-lldp-error" class="text-xs text-(--ui-text-muted)">
						{{ $t("pages.topology-monitor.lldp.error", { reason: neighborReason }) }}
					</p>
					<ul v-else-if="neighborRows.length" class="flex flex-col gap-2 text-xs">
						<li
							v-for="(row, index) in neighborRows"
							:key="`${row.simId}-${index}`"
							data-testid="topology-lldp-neighbor"
							:data-neighbor-id="row.simId"
							:data-on-canvas="row.canvasId !== null"
							class="flex flex-col gap-0.5"
						>
							<div class="flex items-center gap-1.5">
								<!-- 两套身份并列：台账名（`N2`）与 MIB 自报名（`汇聚交换机-1`），谁也不顶替谁 -->
								<span class="truncate font-medium">{{ row.name }}</span>
								<span v-if="row.sysName && row.sysName !== row.name" class="truncate text-(--ui-text-muted)">
									{{ row.sysName }}
								</span>
								<UBadge size="sm" variant="subtle" :color="row.linkStatus === 'up' ? 'success' : 'neutral'" class="ml-auto">
									{{ row.linkStatus || "—" }}
								</UBadge>
							</div>
							<p class="text-[11px] text-(--ui-text-muted)">
								{{ row.localInterface || "—" }} → {{ row.remoteInterface || "—" }}
								<span v-if="row.type"> · {{ row.type }}</span>
								<span v-if="row.ttl !== null"> · TTL {{ row.ttl }}s</span>
							</p>
							<p class="text-[11px] text-(--ui-text-muted)">
								<span v-if="row.canvasId">{{ $t("pages.topology-monitor.lldp.onCanvas", { id: row.canvasId }) }}</span>
								<span v-else>{{ $t("pages.topology-monitor.lldp.offCanvas") }}</span>
								<!-- 上游本地时间字符串不带时区：原样展示，不做时区换算 -->
								· {{ row.discoveredAt || "—" }}
							</p>
						</li>
					</ul>
					<p v-else data-testid="topology-lldp-empty" class="text-xs text-(--ui-text-muted)">
						{{ $t("pages.topology-monitor.lldp.empty") }}
					</p>
				</div>

				<!--
					图例已搬到画布右下角（§6.15）：它读的是「画布上这些颜色代表什么」，
					放在侧栏里等于让人先移开视线再对色号；侧栏留给「选中对象的事实」。
				-->
			</aside>
		</div>

		<!-- 二次确认（NMCPS-DESIGN-001 §6.2 / A9）：动作直接作用在正在跑的仿真上，不可撤销 -->
		<UModal
			v-model:open="confirmOpen"
			:title="$t('pages.topology-monitor.simControls.confirmTitle')"
			:description="confirmDescription"
			:dismissible="!acting"
			:ui="{ footer: 'justify-end' }"
		>
			<template #body>
				<div class="space-y-3">
					<UAlert
						color="warning"
						variant="subtle"
						icon="carbon:warning-alt"
						:title="$t('pages.topology-monitor.simControls.irreversibleTitle')"
						:description="$t('pages.topology-monitor.simControls.irreversibleBody')"
					/>
					<UAlert
						v-if="actionError"
						data-testid="sim-action-error"
						color="error"
						variant="subtle"
						icon="carbon:warning-alt"
						:title="$t('pages.topology-monitor.simControls.actionFailed')"
						:description="actionError"
					/>
				</div>
			</template>

			<template #footer>
				<UButton
					color="neutral"
					variant="ghost"
					:label="$t('pages.topology-monitor.simControls.cancel')"
					:disabled="!!acting"
					@click="confirmOpen = false"
				/>
				<UButton
					data-testid="sim-confirm"
					color="error"
					:label="$t('pages.topology-monitor.simControls.confirmSubmit')"
					:loading="!!acting"
					@click="submitAction()"
				/>
			</template>
		</UModal>
	</div>
</template>

<script setup lang="ts">
	// `/topology/monitor` 网络拓扑总览（NMCPS-DESIGN-001 §二 / §七 / §八）。
	// 主数据源 8888 `/api/topology/graph`，第二数据源 8001 `runtime-inventory`（只读叠加）。
	// 仿真通道未配置 / 不可达时页面照常只读：拓扑与统计继续渲染，仿真区块单独降级。
	import type { TopologyLayoutMode } from "~~/app/utils/graph/topologyLayout";
	import type { StatusColor } from "~~/app/utils/graph/topologyStatusStyle";
	import type {
		SimulatorActionResult,
		SimulatorChannelState,
		SimulatorLinkAction
	} from "~~/layers/topology/app/composables/useTopologyMonitor";
	import type { TopologyCombo, TopologyGraphLink } from "~~/shared/types/topology";
	import { alarmBadgeFillClass, alarmEventsShown, alarmSeverityColor, alarmsOfNode, alarmTimeText } from "~~/app/utils/graph/topologyAlarms";
	import { highlightOf } from "~~/app/utils/graph/topologyHighlight";
	import {
		RADIAL_ROTATE_DEG,
		TOPOLOGY_LAYOUT_ICONS,
		TOPOLOGY_LAYOUT_MODES,
		TOPOLOGY_ROTATE_MAX,
		TOPOLOGY_ROTATE_MIN,
		TOPOLOGY_ROTATE_STEP
	} from "~~/app/utils/graph/topologyLayout";
	import { linkFactsOf, linkHasUtilization } from "~~/app/utils/graph/topologyLinkFacts";
	import { nodeFactsOf, topologyNeighborsOf, wifiFactsOf } from "~~/app/utils/graph/topologyNodeFacts";
	import { topologyLinkKey } from "~~/app/utils/graph/topologyNormalize";
	import { presentRoles, roleColor, roleDotClass, roleI18nKey } from "~~/app/utils/graph/topologyRoleStyle";
	import { linkStatusColor, nodeFillClass, nodeStatusColor, statusI18nKey } from "~~/app/utils/graph/topologyStatusStyle";

	import { deviceMetricsDeepLink, linkMetricsDeepLink } from "~~/app/utils/metric/metricDeepLink";
	import { SIMULATOR_MESSAGES } from "~~/shared/constants/upstreamReasons";

	definePageMeta({ sort: 1, icon: "carbon:network-3" });

	const { t, te } = useI18n();
	const toast = useToast();

	const {
		graph,
		layout,
		loading,
		refreshing,
		graphError,
		simState,
		simReason,
		markers,
		selectedId,
		selected,
		selectNode,
		refresh,
		writeEnabled,
		canWrite,
		acting,
		nodeCount,
		linkCount,
		comboCount,
		layoutMode,
		setLayoutMode,
		rotationDeg,
		canRotate,
		rotateTo,
		nudgeRotation,
		resetRotation,
		nodeOffsets,
		moveNode,
		resetNodeOffsets,
		nodeOffsetCount,
		comboGroups,
		collapsedCombos,
		collapsedNodeCount,
		toggleCombo,
		expandAllCombos,
		collapsedNodes,
		collapseChildCounts,
		collapsedHiddenCount,
		hasCollapsedNodes,
		toggleCollapse,
		expandAllCollapsed,
		focusedCombo,
		focusCombo,
		clearComboFocus,
		alarmIndex,
		alarmState,
		alarmReason,
		alarmNodeCount,
		alarmFiringCount,
		hasAlarms,
		neighborRows,
		neighborState,
		neighborReason,
		neighborCanvasNodeCount,
		simulatorLinkFor,
		performLinkAction,
		SIMULATOR_LINK_ACTIONS
	} = useTopologyMonitor();

	/** 画布组件实例：只为「恢复默认配置」的视口复位与缩放按钮（`resetViewport()` / `zoomIn()` / `zoomOut()`）暴露 */
	const canvasRef = ref<{ resetViewport: () => void, zoomIn: () => void, zoomOut: () => void } | null>(null);
	/** 视口是否已被缩放 / 平移（画布 `viewportChange` 上报）：复位按钮的禁用态要诚实反映它 */
	const viewportDirty = ref(false);
	/** 当前缩放百分比（画布 `zoomChange` 上报）：缩放控件在画布右上那一排，读数是页面渲染的（§6.15） */
	const zoomPercent = ref(100);

	// ── 链路事实（§6.11）：点中画布上的一条链路 → 详情栏给基础事实 + 两个方向的流量 ──────────────
	// 利用率 / 丢包 / 误码四项现网恒为 0（`traffic_out: 16.18` 而 `out_util_pct: 0`）＝没算，
	// 因此这四格既不出 `0%` 也不出 `—`，统一写「未计算」（口径在 `topologyLinkFacts.ts` 文件头）。
	/** 选中链路的 key：用 `topologyLinkKey()` 记，跨轮询按 key 认人，上游换序不会认错 */
	const selectedLinkKey = ref<string | null>(null);

	/** 选中链路本身：从**当前布局**的链路里按 key 解析（刷新后不残留上一轮的对象） */
	const selectedLink = computed<TopologyGraphLink | null>(() => {
		if (!selectedLinkKey.value)
			return null;
		return layout.value.links.find((link, index) => topologyLinkKey(link, index) === selectedLinkKey.value) ?? null;
	});

	/**
	 * 画布看到的「当前节点」：**链路选中时为空**（右栏与画布都只认一个当前项）。
	 *
	 * 节点选中本身不丢（`selectedId` 仍是那台设备）：链路是叠在设备之上的临时读法，
	 * 再点一次那条线 / 点一台设备就回到设备视图 —— 不需要「关闭」这种中间态（2026-11-09 用户裁决）。
	 */
	const canvasSelectedId = computed<string | null>(() => (selectedLink.value ? null : selectedId.value));

	/**
	 * 选中节点的关联高亮（§6.15）：画布只按 key 上样式，判定在纯函数 `highlightOf()` 里。
	 * 与「点选链路」共用同一把 key（`topologyLinkKey()`）—— 同一根线在两处被认成两个东西就是 bug 温床。
	 *
	 * 读的是 `canvasSelectedId` 而不是 `selectedId`：点中一条链路时，画布上的「当前项」就是那条线，
	 * 节点侧的关联环必须让位（否则一条主色线 + 一片层色环同时在说「当前」，用户分不清谁被选中）。
	 */
	const highlight = computed(() => highlightOf(layout.value.links, canvasSelectedId.value));

	/** 跳到设备遥测指标页：深链带该节点的管理 IP（拓扑节点 id 本身就是管理 IP） */
	function openDeviceMetrics(): void {
		void navigateTo(deviceMetricsDeepLink(selected.value?.ip));
	}

	/**
	 * 是否画节点名称（画布左下角「显示名称」开关，§七）。
	 * 只影响**渲染**，不影响布局 / 几何 / 位移表 —— 关掉再打开，塔型和用户拖过的位移都必须原样还在。
	 */
	const showLabels = ref(true);

	/** 是否还有可复位的用户改动（位移 / 旋转角偏离默认 / 视口被动过）—— 三者在同一处判定 */
	const canResetView = computed(() =>
		nodeOffsetCount.value > 0 || rotationDeg.value !== RADIAL_ROTATE_DEG || viewportDirty.value
	);

	/**
	 * 「恢复默认配置」（1.0 v0.36 同款三合一）：清位移 → 旋转角回默认 → 视口复位。
	 * 三步都只是**清增量**，几何基准不动；顺序无关，但一起做完用户才看得到「真的回去了」。
	 */
	function resetViewConfig(): void {
		resetNodeOffsets();
		resetRotation();
		canvasRef.value?.resetViewport();
	}

	/**
	 * 布局下拉项（§6.8）：一项一个 `checked`，当前布局打勾 —— 下拉本身就是「当前在哪一档」的读数。
	 * 词表来自 `TOPOLOGY_LAYOUT_MODES`、图标来自 `TOPOLOGY_LAYOUT_ICONS`（页面不自己列），
	 * 未复刻的 force / grid / circular 不出现在这里。
	 */
	const layoutItems = computed(() => [
		TOPOLOGY_LAYOUT_MODES.map((mode: TopologyLayoutMode) => ({
			label: t(`pages.topology-monitor.layouts.${mode}`),
			icon: TOPOLOGY_LAYOUT_ICONS[mode],
			type: "checkbox" as const,
			checked: layoutMode.value === mode,
			onSelect: () => setLayoutMode(mode)
		}))
	]);

	/** 当前布局的图标：与下拉项同源（径向扇 = 关系图，层级树 = 分类阶层） */
	const layoutIcon = computed(() => TOPOLOGY_LAYOUT_ICONS[layoutMode.value]);

	/** 滑块回调（`USlider` 的 modelValue 可能是 `undefined` ⇒ 忽略，别把角度写成 NaN） */
	function onRotate(value: number | number[] | undefined): void {
		if (typeof value !== "number")
			return;
		rotateTo(value);
	}

	/**
	 * 图例只画层色（§6.15 要求 5）：状态不再进图例，改由每台节点中心的圆点直接读出。
	 * 原先的状态档位表（`legendStatuses`）随之删除 —— 留一个没人读的常量等于给下一个人留坑。
	 */

	/** 图例的层级档位：只列**这张图实际出现**的角色（没有选举出根就不该列出「根节点」），由高到低 */
	const legendRoles = computed(() => presentRoles(layout.value.nodes.map((node) => node.role)));

	// ── 页头读数（工具栏右区徽标，§七）：四档全部来自已取到的数据。────────────────────────
	// 「仿真中节点」这一档已按 2026-11-09 用户裁决删除：仿真节点在画布上自带标记、详情栏也逐台
	// 写「仿真中」，一个跨页头常驻的计数既重复又要依赖 `/api/sim/channel` 的可用性（通道不通时
	// 写「—」，读者会以为拓扑里没有仿真节点）。
	//
	// 缺数据一律 `—`：拓扑没加载出来时写 0、告警通道没起来时写 0 条，都是把「不知道」说成「没有」。
	const statBadges = computed<{ key: string, label: string, icon: string, text: string, color: StatusColor }[]>(() => [
		{
			key: "nodes",
			label: t("pages.topology-monitor.stats.nodes"),
			icon: "carbon:network-4",
			text: graph.value ? String(nodeCount.value) : "—",
			color: "neutral"
		},
		{
			key: "links",
			label: t("pages.topology-monitor.stats.links"),
			icon: "carbon:connect",
			text: graph.value ? String(linkCount.value) : "—",
			color: "neutral"
		},
		{
			key: "combos",
			label: t("pages.topology-monitor.stats.combos"),
			icon: "carbon:group-objects",
			text: graph.value ? String(comboCount.value) : "—",
			color: "neutral"
		},
		{
			key: "alarms",
			label: t("pages.topology-monitor.stats.alarms"),
			icon: "carbon:warning-alt",
			text: alarmState.value === "ok" ? String(alarmFiringCount.value) : "—",
			color: alarmFiringCount.value > 0 ? "error" : "neutral"
		}
	]);

	// ── 节点事实（NMCPS-DESIGN-001 §6.5，复刻 1.0 的详情栏口径）─────────────────────────────
	// 1.0 把 `cpu / memory / interfaces / traffic` 直接铺在节点 `data` 上、用 `-1` 表示取不到，
	// 详情栏据此画进度条与三张 KPI 卡。2.0 把读表收进 `nodeFactsOf()`：**未知一律 `null`**，
	// 展示成「—」而不是 `0%`（CONTRACT-002 §6.3 不补 0）。
	//
	// 本页**不再自绘折线**（§6.5）：序列只在指标页画，详情栏给一枚深链按钮（`topology-node-metrics`）
	// 把人带到 `/topology/device-metrics`。同一张图里既画拓扑又画一段时间序列，两边都读不准，
	// 而且监控页一旦挂上取数，失败语义就得在原地图表里再实现一遍（三个入口三份口径）。
	const selectedFacts = computed(() => nodeFactsOf(selected.value?.node));

	/** 邻居从**当前画布**的链路推导（与 1.0 的「邻居数」同源），不是上游自报的 `neighbors` */
	const selectedNeighbors = computed(() => (selected.value
		? topologyNeighborsOf(layout.value, selected.value.id)
		: []));

	// ── 告警叠加（§6.1）：画布角标与详情栏读同一张表（`alarmIndex`）────────────────────────
	/** 选中节点的告警读数；`null` = 这台设备没有进行中的告警 */
	const selectedAlarm = computed(() => alarmsOfNode(alarmIndex.value, selected.value?.id));

	/** 详情栏列前 3 条，其余归到「另有 N 条」（不把卡片撑成一页日志） */
	const selectedAlarmEvents = computed(() => alarmEventsShown(selectedAlarm.value).shown);
	const hiddenAlarmCount = computed(() => alarmEventsShown(selectedAlarm.value).hidden);

	/** 画布角标徽标色：取全图最高档（`critical` 一旦出现就是红，不因多数是 warning 而变橙） */
	const alarmBadgeColor = computed(() => {
		const severities = Object.values(alarmIndex.value).map((item) => item.severity);
		if (severities.includes("critical"))
			return "error";
		return severities.includes("warning") ? "warning" : "neutral";
	});

	/** 聚焦分组的标签（`null` = 看全部）：徽标文案用上游自报的名字，不自己造 */
	const focusedComboLabel = computed(() => {
		const id = focusedCombo.value;
		if (!id)
			return null;
		return comboGroups.value.find((group) => group.id === id)?.label ?? id;
	});

	// ── 链路事实（§6.11）与节点高亮共用的当前项：`selectedLinkKey` / `selectedLink` 在 `highlight` 之前定义 ──

	/** 选中链路时右栏与画布都让位给那条线，这里只在详情栏渲染事实 */
	const linkFacts = computed(() => (selectedLink.value ? linkFactsOf(selectedLink.value) : null));

	/** 两端名称：图上叫得出来的名字优先，退回管理 IP（`id` 本身就是管理 IP，见 §6.10） */
	const linkEndpoints = computed(() => {
		const link = selectedLink.value;
		if (!link)
			return "";
		const labels = new Map(layout.value.nodes.map((item) => [item.id, item.label]));
		return `${labels.get(link.source) ?? link.source} ↔ ${labels.get(link.target) ?? link.target}`;
	});

	/**
	 * 点链路：再点同一条即回到设备视图（链路上没有关闭按钮，2026-11-09 用户裁决
	 * 「链路卡片不要右上角叉」—— 回头路是「再点一次这条线」或「点一台设备」）。
	 *
	 * 选中链路时**不动节点选中**：右栏是二选一（`selectedLink` 为真则节点卡片让位），
	 * 画布侧由 `canvasSelectedId` 让位；退出链路视图时那台设备原样还在，不会掉回空态。
	 */
	function selectLink(key: string): void {
		selectedLinkKey.value = selectedLinkKey.value === key ? null : key;
	}

	/**
	 * 点节点：先摘掉链路选中（右栏要切回设备事实），再走 composable 的「恒有一台选中」语义。
	 */
	function pickNode(id: string | null): void {
		selectedLinkKey.value = null;
		selectNode(id);
	}

	/** 跳到链路遥测指标页：深链带两端的管理 IP（画布节点 id = 管理 IP） */
	function openLinkMetrics(): void {
		const link = selectedLink.value;
		if (!link)
			return;
		void navigateTo(linkMetricsDeepLink(link.source, link.target));
	}

	/** 未知 → 「—」；「未计算」单独一档，两者在同一个格子里绝不混着写 */
	function linkValue(value: string | number | null, suffix = ""): string {
		return value === null ? "—" : `${value}${suffix}`;
	}

	function linkPercent(value: number | null): string {
		return value === null
			? t("pages.topology-monitor.link.notComputed")
			: `${Math.round(value * 10) / 10}%`;
	}

	/** 链路事实行（顺序 = 卡片上的阅读顺序：先「这条链路是什么」，再「跑了多少」） */
	const linkRows = computed(() => {
		const facts = linkFacts.value;
		if (!facts)
			return [];
		return [
			{ key: "type", label: t("pages.topology-monitor.link.type"), text: linkValue(facts.linkType), unknown: facts.linkType === null },
			{ key: "medium", label: t("pages.topology-monitor.link.medium"), text: linkValue(facts.medium), unknown: facts.medium === null },
			{ key: "relation", label: t("pages.topology-monitor.link.relation"), text: linkValue(facts.relation), unknown: facts.relation === null },
			{ key: "admin", label: t("pages.topology-monitor.link.adminStatus"), text: linkValue(facts.adminStatus), unknown: facts.adminStatus === null },
			{ key: "bandwidth", label: t("pages.topology-monitor.link.bandwidth"), text: linkValue(facts.bandwidth), unknown: facts.bandwidth === null },
			{ key: "traffic-in", label: t("pages.topology-monitor.link.trafficIn"), text: linkValue(facts.trafficIn, " Mbps"), unknown: facts.trafficIn === null },
			{ key: "traffic-out", label: t("pages.topology-monitor.link.trafficOut"), text: linkValue(facts.trafficOut, " Mbps"), unknown: facts.trafficOut === null },
			{ key: "util-in", label: t("pages.topology-monitor.link.utilIn"), text: linkPercent(facts.utilIn), unknown: facts.utilIn === null },
			{ key: "util-out", label: t("pages.topology-monitor.link.utilOut"), text: linkPercent(facts.utilOut), unknown: facts.utilOut === null },
			{ key: "packet-loss", label: t("pages.topology-monitor.link.packetLoss"), text: linkPercent(facts.packetLoss), unknown: facts.packetLoss === null },
			{ key: "error-rate", label: t("pages.topology-monitor.link.errorRate"), text: linkPercent(facts.errorRate), unknown: facts.errorRate === null }
		];
	});

	/** 画布 `<title>` 文本（原生悬停提示）：基础事实 + 两个方向的流量，利用率只在真有值时出现 */
	function linkTitle(link: TopologyGraphLink): string {
		const facts = linkFactsOf(link);
		const parts = [facts.linkType, facts.medium, facts.relation, facts.bandwidth]
			.filter((item): item is string => !!item);

		if (facts.trafficIn !== null || facts.trafficOut !== null) {
			parts.push(t("pages.topology-monitor.link.trafficLine", {
				in: formatTraffic(facts.trafficIn),
				out: formatTraffic(facts.trafficOut)
			}));
		}

		if (!linkHasUtilization(facts))
			parts.push(t("pages.topology-monitor.link.utilNotComputed"));
		else if (facts.utilIn !== null || facts.utilOut !== null)
			parts.push(t("pages.topology-monitor.link.utilLine", { in: linkPercent(facts.utilIn), out: linkPercent(facts.utilOut) }));

		return parts.join(" · ");
	}

	// ── 无线事实（§6.11）：只有带 Wi-Fi 字段的节点才出这块，一个字段都没有就不画 ────────────────
	const wifiFacts = computed(() => wifiFactsOf(selected.value?.node));

	const wifiRows = computed(() => {
		const facts = wifiFacts.value;
		if (!facts)
			return [];
		return [
			{ key: "ssid", label: t("pages.topology-monitor.wifi.ssid"), text: linkValue(facts.ssid) },
			{ key: "band", label: t("pages.topology-monitor.wifi.band"), text: linkValue(facts.band) },
			{ key: "channel", label: t("pages.topology-monitor.wifi.channel"), text: linkValue(facts.channel) },
			{ key: "dbm", label: t("pages.topology-monitor.wifi.dbm"), text: linkValue(facts.dbm, " dBm") },
			{ key: "clients", label: t("pages.topology-monitor.wifi.clients"), text: linkValue(facts.clients) },
			{ key: "util", label: t("pages.topology-monitor.wifi.util"), text: linkValue(facts.util, "%") },
			{ key: "tx-power", label: t("pages.topology-monitor.wifi.txPower"), text: linkValue(facts.txPower, " dBm") }
		];
	});

	// ── 区域分组（§6.11）：`counts` 是上游自报的分层计数，`visible` 是画布上的真实成员 ─────────────
	/** 计数键是上游口径（`distro` / `access` / `terminal`）：词表里有就翻，没有就原样给（数据，不翻译） */
	function countKeyLabel(key: string): string {
		const path = `pages.topology-monitor.groups.counts.${key}`;
		return te(path) ? t(path) : key;
	}

	function countsText(counts: TopologyCombo["counts"]): string {
		const entries = Object.entries(counts ?? {}).filter(([, value]) => typeof value === "number");
		if (entries.length === 0)
			return t("pages.topology-monitor.groups.countsUnknown");
		return entries.map(([key, value]) => `${countKeyLabel(key)} ${value}`).join(" · ");
	}

	/** CPU / 内存两条进度条：`value === null` 时只留「—」，不画空进度条（空条会读成 0%） */
	const percentMeters = computed(() => [
		{ key: "cpu", label: "pages.topology-monitor.detail.cpu", value: selectedFacts.value.cpu },
		{ key: "memory", label: "pages.topology-monitor.detail.memory", value: selectedFacts.value.memory }
	]);

	/** 三张 KPI 卡：接口数 / 邻居数 / 流量（流量单位 Mbps，与 1.0 同口径） */
	const factCards = computed(() => [
		{
			key: "interfaces",
			label: t("pages.topology-monitor.detail.interfaces"),
			text: formatCount(selectedFacts.value.interfaces),
			unit: ""
		},
		{
			key: "neighbors",
			label: t("pages.topology-monitor.detail.neighbors"),
			text: `${selectedNeighbors.value.length}`,
			unit: ""
		},
		{
			key: "traffic",
			label: t("pages.topology-monitor.detail.traffic"),
			text: formatTraffic(selectedFacts.value.traffic),
			// 未知时不带单位：`— Mbps` 会被读成「0 Mbps 只是没写小数点」
			unit: selectedFacts.value.traffic === null ? "" : t("pages.topology-monitor.detail.trafficUnit")
		}
	]);

	/** 百分比：未知写「—」，已知保留一位小数 */
	function formatPercent(value: number | null): string {
		return value === null ? "—" : `${Math.round(value * 10) / 10}%`;
	}

	/** 计数：未知写「—」；`0` 是真实值，照写 */
	function formatCount(value: number | null): string {
		return value === null ? "—" : `${value}`;
	}

	/** 流量（Mbps）：1.0 口径保留两位小数；未知写「—」 */
	function formatTraffic(value: number | null): string {
		return value === null ? "—" : `${Math.round(value * 100) / 100}`;
	}

	/** 百分比阈值色：>80 错误、>60 警告、其余主色；未知不画进度条，颜色无意义 */
	function percentColor(value: number | null): "primary" | "warning" | "error" {
		if (value === null)
			return "primary";
		return value > 80 ? "error" : value > 60 ? "warning" : "primary";
	}

	// ── 写入口（§6.2）：只保留链路动作这一条流程（选中 → 二次确认 → 下发）─────────────────────
	// 节点级的「停止节点 / 重启节点」两枚按钮已按 2026-11-09 用户裁决从工具栏删除：它们的可用性
	// 建立在「工具栏上选中了哪台设备」之上，而工具栏与选中对象隔着一整张画布 —— 最高危的动作
	// 挂在最不显眼的位置，停掉一台设备后也没有任何画布内的位置能把它拉回来。写能力本身仍由
	// `/api/sim/channel` 的 `writeEnabled` 决定，链路动作（断开 / 恢复 / 来回切）留在链路事实卡里。
	/** 动作文案（键表放在一处：模板、提示、弹窗标题都从这里取，避免同一动作三种叫法） */
	const ACTION_LABEL_KEY: Record<SimulatorLinkAction, string> = {
		down: "pages.topology-monitor.simControls.linkDown",
		up: "pages.topology-monitor.simControls.linkUp",
		toggle: "pages.topology-monitor.simControls.linkToggle"
	};

	/** 下发成功的结果提示 */
	const ACTION_DONE_KEY: Record<SimulatorLinkAction, string> = {
		down: "pages.topology-monitor.simControls.linkDownDone",
		up: "pages.topology-monitor.simControls.linkUpDone",
		toggle: "pages.topology-monitor.simControls.linkToggleDone"
	};

	/** 链路动作目标：选中链路在仿真侧的那一条（`undefined` = 这条线不在仿真里） */
	const linkTarget = computed(() => simulatorLinkFor(selectedLink.value));

	const pendingAction = ref<SimulatorLinkAction | null>(null);
	const confirmOpen = ref(false);
	const actionError = ref("");

	/** 两个条件缺一不可：通道 + 写开关（`canWrite`），以及一个可下发的目标 */
	const canOperateLink = computed(() => canWrite.value && !!linkTarget.value && !acting.value);

	const pendingLabel = computed(() => (pendingAction.value ? t(ACTION_LABEL_KEY[pendingAction.value]) : ""));

	/** 确认弹窗的正文：目标（两端 + 仿真 id）+ 动作，缺一样都别让人按下去 */
	const confirmDescription = computed(() => {
		const action = pendingAction.value;
		const target = linkTarget.value;
		if (!action || !target)
			return "";
		return t("pages.topology-monitor.simControls.linkConfirmDescription", {
			action: pendingLabel.value,
			name: linkEndpoints.value,
			id: target.simId
		});
	});

	/** 链路动作图标：`up` / `down` 是方向，`toggle` 是来回（图标只画语义，不画结果） */
	function linkActionIcon(action: SimulatorLinkAction): string {
		if (action === "down")
			return "carbon:arrow-down";
		return action === "up" ? "carbon:arrow-up" : "carbon:arrows-horizontal";
	}

	/**
	 * 链路按钮的禁用原因：按「通道 → 写开关 → 选中 → 是否在仿真里」的顺序各说一句话。
	 * 顺序即优先级 —— 只说缺的那一层，用户才知道该找运维开开关，还是先去点一条链路。
	 */
	const linkActionHint = computed(() => {
		const state: SimulatorChannelState = simState.value;
		if (state === "loading")
			return t("pages.topology-monitor.simControls.loading");
		if (state === "disabled")
			return t("pages.topology-monitor.simControls.disabled");
		if (state === "unreachable")
			return t("pages.topology-monitor.simControls.unreachable");
		if (!writeEnabled.value)
			return t("pages.topology-monitor.simControls.writeDisabled");
		if (!selectedLink.value)
			return t("pages.topology-monitor.simControls.selectLink");
		if (!linkTarget.value)
			return t("pages.topology-monitor.simControls.linkNotSimulated");
		return t("pages.topology-monitor.simControls.linkReady", { name: linkEndpoints.value });
	});

	/** 失败原因：本方词汇（未开写 / 不可达 / 超时）翻成文案，其余是上游原话，照原样展示 */
	function describeActionError(message: string): string {
		if (message === SIMULATOR_MESSAGES.writeDisabled)
			return t("pages.topology-monitor.simControls.writeDisabled");
		if (message === SIMULATOR_MESSAGES.unreachable)
			return t("pages.topology-monitor.simControls.unreachable");
		if (message === SIMULATOR_MESSAGES.timeout)
			return t("pages.topology-monitor.simControls.timeout");
		return message;
	}

	/** 链路动作先弹二次确认：动作直接作用在正在跑的仿真上（§6.2 / A35） */
	function askLinkAction(action: SimulatorLinkAction): void {
		if (!canOperateLink.value)
			return;

		actionError.value = "";
		pendingAction.value = action;
		confirmOpen.value = true;
	}

	async function submitAction(): Promise<void> {
		const action = pendingAction.value;
		const target = linkTarget.value;
		if (!action || !target || acting.value)
			return;

		const result: SimulatorActionResult = await performLinkAction(action, target.simId);

		if (!result.ok) {
			actionError.value = describeActionError(result.message);
			return;
		}

		toast.add({
			title: t(ACTION_DONE_KEY[action]),
			description: linkEndpoints.value,
			color: "success"
		});
		confirmOpen.value = false;
		pendingAction.value = null;
	}
</script>
