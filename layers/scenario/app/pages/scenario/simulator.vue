<template>
	<div class="flex min-h-0 flex-1 flex-col gap-3 p-3">
		<Teleport to="#app-toolbar-left">
			<div class="flex items-center gap-1">
				<!--
					菜单栏（复刻 1.0 版式的「文件 / 视图」，NMCPS-ADR-0022 W4 / W10）：
					`NetworkGraph.vue` 的顶栏从左到右就是「标题 + 文件 / 视图 / 运行 / 工具 / 帮助」，
					2.0 把工具栏左区交回给页面，菜单栏因此落在刷新 / 新增**之前**。

					「文件」= 导入拓扑 / 导出 JSON / 导出脚本，三项都有端点（W4 的
					`POST /api/lab/import_json` 与 `GET /api/lab/export/{json|script}`），不是占位的灰项；
					「工具」要 W5 的抓包端点（`lab:sniffer` 才渲染），「帮助」等文档锚点落地再补。

					一个动作一个入口：显示类开关从工具栏独立开关收进「视图」；启动 / 停止 / 重启 /
					重建从 W10 起常驻在**左侧设备栏顶部**（原来在「运行」菜单里，菜单已随之删除）；
					右栏只留运行态读数与探测结果（NMCPS-ARCH-006 §4）。
				-->
				<UDropdownMenu :items="fileMenuItems" :content="{ align: 'start' }">
					<UButton
						data-testid="mininet-file-menu"
						size="xs"
						color="neutral"
						variant="ghost"
						icon="carbon:document"
						:label="$t('pages.scenario-simulator.menu.file')"
						trailing-icon="carbon:chevron-down"
					/>
				</UDropdownMenu>
				<!--
					导入的选文件控件：`UDropdownMenu` 的项只能触发回调，不能承载 `<input type="file">`
					（点菜单项会收起菜单，input 一起被拆掉）。所以菜单项只负责点开这个隐藏 input。
				-->
				<input
					ref="importInput"
					data-testid="mininet-import-input"
					class="hidden"
					type="file"
					accept="application/json,.json"
					@change="onImportFile"
				>
				<UDropdownMenu :items="viewMenuItems" :content="{ align: 'start' }">
					<UButton
						data-testid="mininet-view-menu"
						size="xs"
						color="neutral"
						variant="ghost"
						icon="carbon:view"
						:label="$t('pages.scenario-simulator.menu.view')"
						trailing-icon="carbon:chevron-down"
					/>
				</UDropdownMenu>
				<!--
					「工具」菜单（NMCPS-ADR-0022 W5）：抓包启停 + pcap 下载。

					只有 `lab:sniffer` 才渲染整个菜单 —— 抓包权限不能由 `lab:read` / `lab:operate`
					推导（NMCPS-ADR-0021 D3），未授权时连入口都不出现，而不是点下去收 403。
					下载走导出通道 `GET /api/lab/export/pcap`：那条通道的权限位同样是 `lab:sniffer`，
					并且以 `arrayBuffer` 取原始字节，pcap 不会被当文本解码。
				-->
				<UDropdownMenu v-if="canSniff" :items="toolsMenuItems" :content="{ align: 'start' }">
					<UButton
						data-testid="mininet-tools-menu"
						size="xs"
						color="neutral"
						variant="ghost"
						icon="carbon:tools"
						:label="$t('pages.scenario-simulator.menu.tools')"
						trailing-icon="carbon:chevron-down"
					/>
				</UDropdownMenu>
				<UButton
					data-testid="mininet-refresh"
					size="xs"
					color="neutral"
					variant="subtle"
					icon="carbon:renew"
					:loading="loading"
					:label="$t('pages.scenario-simulator.toolbar.refresh')"
					@click="load()"
				/>
				<!--
					节点面板不在工具栏（NMCPS-ADR-0022 W7）：五个类型是画布**外面**左侧的纵向图标列
					（`SimulatorNodePaletteRail`）—— 图标常驻，点一下用默认落点、拖到画布上用
					放手位置。1.0 把这张面板放在侧栏里，2.0 若塞回工具栏的 `UPopover`，就要
					「先点开菜单再拖出来」，而菜单一收起拖源就没了。
				-->
			</div>
		</Teleport>

		<Teleport to="#app-toolbar-right">
			<div class="flex items-center gap-1">
				<LayoutToolbarBadge
					v-for="stat in statBadges"
					:key="stat.key"
					:data-testid="`mininet-stat-${stat.key}`"
					variant="subtle"
					color="neutral"
					:icon="stat.icon"
					:label="`${stat.label} ${stat.text}`"
				/>
			</div>
		</Teleport>

		<UAlert
			v-if="error"
			data-testid="mininet-error"
			color="error"
			variant="subtle"
			icon="carbon:warning-alt"
			:title="$t('pages.scenario-simulator.error.title')"
			:description="error"
		>
			<template #actions>
				<UButton
					size="sm"
					color="neutral"
					variant="subtle"
					:label="$t('pages.scenario-simulator.toolbar.refresh')"
					@click="load()"
				/>
			</template>
		</UAlert>

		<div v-else-if="loading && !positioned.length" class="flex min-h-0 flex-1 items-center justify-center">
			<USkeleton class="h-full min-h-96 w-full rounded-lg" />
		</div>

		<div
			v-else-if="!network"
			data-testid="mininet-empty"
			class="flex min-h-0 flex-1 items-center justify-center"
		>
			<div class="flex max-w-md flex-col items-center gap-3 text-center">
				<UIcon name="carbon:network-4" class="size-12 text-(--ui-text-muted)" />
				<h2 class="text-lg font-semibold">
					{{ $t("pages.scenario-simulator.empty.title") }}
				</h2>
				<p class="text-sm text-(--ui-text-muted)">
					{{ $t("pages.scenario-simulator.empty.body") }}
				</p>
			</div>
		</div>

		<div v-else class="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
			<!--
				画布区：设备栏是**画布外面**的独立一列（W10），右侧才是画布本体 —— 两列同高
				（flex 默认 `items-stretch`），设备栏内容从顶部开始，不再 `absolute` 叠在画布上。
			-->
			<div class="flex min-h-[420px] min-w-0 flex-1 gap-2">
				<!--
					设备栏（复刻 1.0 `Side.vue` 的 palette，NMCPS-ADR-0022 W7 / W9 / W10）：
					画布左侧纵向排列五个类型图标（1.0 的侧栏也在左）。点一下 = 用默认落点打开表单；
					拖到画布上 = 用放手位置。两条路都进同一张 `NodeFormModal`（校验与请求体只有一份）。

					栏顶 `#top` 插槽放运行控制与「生成拓扑」：1.0 的 `Side.vue` 里建网动作就排在
					palette 之上，现在它们固定在列顶、不随下面类型列表滚动。运行按钮认 `create` /
					`operate`，整列因此在两者任一为真时出现；没有 `create` 时类型列表为空。
				-->
				<SimulatorNodePaletteRail
					v-if="showPaletteRail"
					:kinds="canCreate ? LAB_NODE_KINDS : []"
					:icons="NODE_KIND_ICONS"
					:hint="$t('pages.scenario-simulator.palette.hint')"
					@pick="pickKind"
					@dragstart="onPaletteDragStart"
					@dragend="onPaletteDragEnd"
				>
					<template #top>
						<!--
							运行控制（原工具栏「运行」菜单，W10 移到栏顶常驻）：禁用条件与运行态同源，
							读不到运行态（`null`）时全部不给点 —— 不把「未知」当成「没启动」。
							重启只在运行中可点（第一步就是 `POST /stop`）。
							整列透明之后按钮只剩图标，说明改挂 `UTooltip`：所以这一组**只有一种变体**
							（`ghost` + `neutral`，尺寸只在「生成拓扑」上放大到与下面的类型图标对齐），
							破坏性也不靠颜色区分 —— 后果写在提示与确认弹窗里。
							提示的触发器是外面那层 `<span>`：按钮带原生 `disabled` 时自己收不到
							指针事件，挂在自己身上的提示会在「最需要解释为什么点不动」时失灵。
						-->
						<UTooltip v-if="canCreate" :text="$t('pages.scenario-simulator.run.startHint')">
							<span class="inline-flex">
								<UButton
									data-testid="mininet-run-start"
									size="sm"
									color="neutral"
									variant="ghost"
									class="size-9 justify-center"
									:ui="{ leadingIcon: 'size-5' }"
									icon="carbon:play"
									:loading="runAction === 'start'"
									:disabled="runState !== false || runBusy"
									:aria-label="$t('pages.scenario-simulator.run.start')"
									@click="startNetwork"
								/>
							</span>
						</UTooltip>
						<UTooltip v-if="canOperate" :text="$t('pages.scenario-simulator.run.stopHint')">
							<span class="inline-flex">
								<UButton
									data-testid="mininet-run-stop"
									size="sm"
									color="neutral"
									variant="ghost"
									class="size-9 justify-center"
									:ui="{ leadingIcon: 'size-5' }"
									icon="carbon:stop"
									:loading="runAction === 'stop'"
									:disabled="runState !== true || runBusy"
									:aria-label="$t('pages.scenario-simulator.run.stop')"
									@click="askStopNetwork"
								/>
							</span>
						</UTooltip>
						<UTooltip v-if="canCreate && canOperate" :text="$t('pages.scenario-simulator.run.restartHint')">
							<span class="inline-flex">
								<UButton
									data-testid="mininet-run-restart"
									size="sm"
									color="neutral"
									variant="ghost"
									class="size-9 justify-center"
									:ui="{ leadingIcon: 'size-5' }"
									icon="carbon:restart"
									:loading="runAction === 'restart'"
									:disabled="runState !== true || runBusy"
									:aria-label="$t('pages.scenario-simulator.run.restart')"
									@click="askRestartNetwork"
								/>
							</span>
						</UTooltip>
						<UTooltip v-if="canCreate && canDelete" :text="$t('pages.scenario-simulator.run.resetHint')">
							<span class="inline-flex">
								<UButton
									data-testid="mininet-reset-network"
									size="sm"
									color="neutral"
									variant="ghost"
									class="size-9 justify-center"
									:ui="{ leadingIcon: 'size-5' }"
									icon="carbon:reset"
									:loading="runAction === 'reset'"
									:disabled="runBusy"
									:aria-label="$t('pages.scenario-simulator.run.reset')"
									@click="askResetNetwork"
								/>
							</span>
						</UTooltip>
						<!-- 列内唯一一条分割线：运行控制 ↔ 「生成拓扑」 -->
						<span v-if="canCreate" class="my-0.5 h-px w-8 bg-(--ui-border)" aria-hidden="true" />
						<UTooltip v-if="canCreate" :text="$t('pages.scenario-simulator.generate.hint')">
							<span class="inline-flex">
								<UButton
									data-testid="mininet-generate-topology"
									size="md"
									color="neutral"
									variant="ghost"
									class="size-12 justify-center"
									:ui="{ leadingIcon: 'size-6' }"
									icon="carbon:chemistry"
									:aria-label="$t('pages.scenario-simulator.generate.open')"
									@click="openGenerate"
								/>
							</span>
						</UTooltip>
					</template>
				</SimulatorNodePaletteRail>
				<!--
					画布常驻（W11）：即使台账里一个节点都没有也要把 `TopologyCanvas` 挂上 ——
					「拖一个类型到画布上新增节点」是**从零建网**的第一步，而 `drop` 只画在这张
					svg 上。以前没节点时用一句占位文案把画布换掉，于是空网里拖拽毫无反应：
					拖源、提示都对，落点却不存在。现在空态改成叠在画布上的提示层
					（`pointer-events-none`），拖放照常命中下面的 svg。
				-->
				<!--
					右键菜单（NMCPS-ADR-0022 W12）：只有节点右键会弹两项；空白右键由画布
					`preventDefault()`，外层 `UContextMenu` 因此不开（Reka 在 nextTick 后才看
					`defaultPrevented`）。节点那一支不阻止，菜单才会在指针处打开。
				-->
				<UContextMenu :items="nodeMenuItems" :modal="false">
					<div class="relative min-h-[420px] flex-1 overflow-hidden rounded-lg border border-(--ui-border)">
						<GraphTopologyCanvas
							ref="canvasRef"
							class="h-full"
							:nodes="visibleNodes"
							:links="visibleLinks"
							:width="canvasWidth"
							:height="canvasHeight"
							:selected-id="selectedId"
							:selected-link-key="selectedLinkKey"
							:link-title="linkTitle"
							:show-labels="showLabels"
							:draggable="canOperate"
							:drop-enabled="canCreate && dragKind !== null"
							:drop-hint="dropHint"
							:context-menu="true"
							:activate-on-double-click="true"
							:label="$t('pages.scenario-simulator.canvasLabel')"
							@select="selectNode"
							@select-link="selectLink"
							@offset-change="onNodeMoved"
							@canvas-drop="onCanvasDrop"
							@context-menu="onCanvasContextMenu"
							@activate="onCanvasActivate"
						/>
						<div
							v-if="!visibleNodes.length"
							class="pointer-events-none absolute inset-0 flex items-center justify-center"
						>
							<p class="text-sm text-(--ui-text-muted)">
								{{ $t("pages.scenario-simulator.empty.topology") }}
							</p>
						</div>
					</div>
				</UContextMenu>
			</div>

			<!--
				右栏（复刻 1.0 版式的单块可折叠面板，NMCPS-ADR-0022 W7 / D6）：顶部一行标题 +
				折叠按钮，下面是一排标签页 —— 观测三块（Webshell / 日志 / 监控）与台账两块
				（网络 + 详情 / 连通性 + 吞吐）。标签定义只有这一份：观测三块的标签页由页面按
				能力位裁剪，内容交给 `SimulatorNetworkTools`（同一实例常驻，Webshell 会话不随切页断开）。
				折叠只收宽度，不动画布：收起后留一条窄条，点箭头即展开。
			-->
			<aside
				data-testid="mininet-detail"
				class="flex w-full shrink-0 flex-col"
				:class="panelOpen ? 'lg:w-96' : 'lg:w-10'"
			>
				<div class="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-(--ui-border)">
					<div
						class="flex items-center gap-2 border-b border-(--ui-border) px-2 py-2"
						:class="panelOpen ? 'justify-between' : 'justify-center'"
					>
						<h2 v-if="panelOpen" class="truncate text-[13px] font-semibold tracking-wide">
							{{ $t("pages.scenario-simulator.panel.title") }}
						</h2>
						<UButton
							data-testid="mininet-detail-toggle"
							size="xs"
							color="neutral"
							variant="ghost"
							class="size-7 justify-center"
							:icon="panelOpen ? 'carbon:chevron-right' : 'carbon:chevron-left'"
							:aria-label="panelOpen
								? $t('pages.scenario-simulator.panel.collapse')
								: $t('pages.scenario-simulator.panel.expand')"
							@click="panelOpen = !panelOpen"
						/>
					</div>
					<div v-show="panelOpen" class="flex min-h-0 flex-1 flex-col">
						<!--
							标签页按能力位裁剪：没有 `lab:terminal` 就没有 Webshell，没有 `lab:read` 就没有
							日志 / 监控；「网络」只读台账事实，永远在；「连通」要有 `lab:operate`（探测 / 测速）
							或 `lab:sniffer`（抓包读数）才有内容。默认停在「网络」：那是台账事实视图，
							不需要用户先有某个写能力位。
						-->
						<UTabs
							v-model="sideTab"
							data-testid="mininet-side-tabs"
							class="shrink-0 px-2 pt-2"
							size="xs"
							:items="sideTabItems"
							:content="false"
						/>
						<div class="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
							<!-- 网络 + 详情：台账事实与画布选中项 -->
							<template v-if="sideTab === 'network'">
								<div>
									<h2 class="mb-2 border-b border-(--ui-border) pb-1 text-[13px] font-semibold tracking-wide">
										{{ $t("pages.scenario-simulator.network.title") }}
									</h2>
									<dl class="grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
										<template v-for="row in networkRows" :key="row.key">
											<dt class="text-(--ui-text-muted)">
												{{ row.label }}
											</dt>
											<dd class="truncate">
												{{ row.value }}
											</dd>
										</template>
									</dl>
								</div>

								<div>
									<h2 class="mb-2 border-b border-(--ui-border) pb-1 text-[13px] font-semibold tracking-wide">
										{{ $t("pages.scenario-simulator.detail.title") }}
									</h2>

									<template v-if="selectedLink">
										<div class="flex items-center justify-between gap-2">
											<span class="truncate font-medium">{{ selectedLink.source }} ↔ {{ selectedLink.target }}</span>
											<UBadge size="sm" variant="subtle" color="success">
												{{ $t("pages.scenario-simulator.detail.link") }}
											</UBadge>
										</div>
										<dl class="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
											<dt class="text-(--ui-text-muted)">
												{{ $t("pages.scenario-simulator.detail.from") }}
											</dt>
											<dd class="truncate">
												{{ selectedLink.source }}
											</dd>
											<dt class="text-(--ui-text-muted)">
												{{ $t("pages.scenario-simulator.detail.to") }}
											</dt>
											<dd class="truncate">
												{{ selectedLink.target }}
											</dd>
										</dl>
										<UButton
											v-if="canOperate"
											data-testid="mininet-remove-link"
											class="mt-3 w-full justify-start"
											size="xs"
											color="error"
											variant="subtle"
											icon="carbon:unlink"
											:label="$t('pages.scenario-simulator.edit.removeLink')"
											@click="askRemoveLink"
										/>
									</template>

									<template v-else-if="selectedNode">
										<div class="flex items-center justify-between gap-2">
											<span class="truncate font-medium">{{ selectedNode.positioned.label }}</span>
											<UBadge size="sm" variant="subtle" color="neutral">
												{{ selectedNode.kind }}
											</UBadge>
										</div>
										<dl class="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
											<template v-for="row in nodeRows" :key="row.key">
												<dt class="text-(--ui-text-muted)">
													{{ row.label }}
												</dt>
												<dd class="truncate">
													{{ row.value }}
												</dd>
											</template>
										</dl>

										<!--
									交换机附加项（NMCPS-ADR-0022 W2 / W2b）：OpenFlow 版本与流表写入（`lab:operate`）。
									流表落库在交换机侧（`ovs-ofctl`），页面只呈现原文 —— 解析归后端；
									单条删除的行号按「含 actions= 的行」计，口径见 labFlowRowsOf()。
								-->
										<div v-if="selectedNode.kind === 'switch'" class="mt-3 space-y-2">
											<UFormField v-if="canOperate" :label="$t('pages.scenario-simulator.edit.openflow')">
												<USelect
													data-testid="mininet-openflow"
													size="xs"
													class="w-full"
													:items="openflowItems"
													:model-value="openflowValue"
													@update:model-value="applyOpenflow"
												/>
											</UFormField>
											<div>
												<div class="mb-1 flex items-center justify-between gap-2">
													<h3 class="text-xs font-medium">
														{{ $t("pages.scenario-simulator.flows.title") }}
													</h3>
													<div class="flex items-center gap-1">
														<!--
													清流（`lab:operate`）：批量 `DELETE /flows`，留空 = 清整表。
													按钮常驻但无流时禁用 —— 让「没有可删的」和「没权限」在视觉上分开。
												-->
														<UButton
															v-if="canOperate"
															data-testid="mininet-flow-clear"
															size="xs"
															color="error"
															variant="ghost"
															icon="carbon:delete"
															:disabled="!flowRows.length || acting"
															:aria-label="$t('pages.scenario-simulator.flows.clear')"
															@click="openClearFlows"
														/>
														<UButton
															v-if="canOperate"
															data-testid="mininet-flow-reload"
															size="xs"
															color="neutral"
															variant="ghost"
															icon="carbon:renew"
															:aria-label="$t('pages.scenario-simulator.flows.reload')"
															@click="reloadFlows"
														/>
													</div>
												</div>
												<p v-if="flowLoading" class="text-xs text-(--ui-text-muted)">
													{{ $t("pages.scenario-simulator.flows.loading") }}
												</p>
												<p v-else-if="flowError" data-testid="mininet-flow-error" class="text-xs text-(--ui-text-error)">
													{{ flowError }}
												</p>
												<template v-else>
													<div
														v-if="flowRows.length"
														data-testid="mininet-flows"
														class="max-h-40 space-y-1 overflow-auto rounded bg-(--ui-bg-elevated) p-2 text-[11px] leading-4"
													>
														<div
															v-for="(row, index) in flowRows"
															:key="`${row.id ?? 'note'}-${index}`"
															class="flex items-start gap-1"
														>
															<code class="min-w-0 flex-1 break-all">{{ row.text }}</code>
															<UButton
																v-if="canOperate && row.id"
																data-testid="mininet-flow-remove"
																:data-flow-id="row.id"
																size="xs"
																color="error"
																variant="ghost"
																icon="carbon:trash-can"
																:aria-label="$t('pages.scenario-simulator.flows.remove', { id: row.id })"
																@click="removeFlow(row.id)"
															/>
														</div>
													</div>
													<p v-else data-testid="mininet-flow-empty" class="text-xs text-(--ui-text-muted)">
														{{ $t("pages.scenario-simulator.flows.empty") }}
													</p>
												</template>
											</div>

											<!-- 写失败（加流 / 删流）原话照实显示：页面不吞上游 4xx，也不自造文案 -->
											<p v-if="actionError" data-testid="lab-flow-error" class="text-xs text-(--ui-text-error)">
												{{ actionError }}
											</p>

											<!-- 加流（lab:operate）：动作必填，其余留空走上游默认 -->
											<div v-if="canOperate" class="space-y-1.5 rounded border border-(--ui-border) p-2">
												<!-- 就地报错：三条校验各落到出错的那个字段，不再挤在优先级下面 -->
												<UFormField
													:label="$t('pages.scenario-simulator.flows.match')"
													:error="flowDraftError === 'matchInvalid' ? flowDraftErrorText : undefined"
												>
													<UInput
														v-model="flowDraft.match"
														data-testid="lab-flow-match"
														size="xs"
														class="w-full"
														:placeholder="$t('pages.scenario-simulator.flows.matchPlaceholder')"
													/>
												</UFormField>
												<UFormField
													:label="$t('pages.scenario-simulator.flows.actions')"
													:error="flowDraftError === 'actionsRequired' ? flowDraftErrorText : undefined"
												>
													<UInput
														v-model="flowDraft.actions"
														data-testid="lab-flow-actions"
														size="xs"
														class="w-full"
														:placeholder="$t('pages.scenario-simulator.flows.actionsPlaceholder')"
													/>
												</UFormField>
												<UFormField
													:label="$t('pages.scenario-simulator.flows.priority')"
													:error="flowDraftError === 'priorityInvalid' ? flowDraftErrorText : undefined"
												>
													<UInput
														v-model="flowDraft.priority"
														data-testid="lab-flow-priority"
														size="xs"
														class="w-full"
														type="number"
														min="0"
														:max="LAB_FLOW_PRIORITY_MAX"
														:placeholder="$t('pages.scenario-simulator.flows.priorityPlaceholder')"
													/>
												</UFormField>
												<UButton
													data-testid="lab-flow-submit"
													class="w-full justify-center"
													size="xs"
													color="primary"
													variant="subtle"
													icon="carbon:flow"
													:label="$t('pages.scenario-simulator.flows.submit')"
													:loading="acting"
													@click="addFlow"
												/>
											</div>
										</div>

										<!-- 连线（`lab:create`）：从选中节点连到另一台设备，单向一次请求 -->
										<div v-if="canCreate && linkTargetItems.length" class="mt-3 space-y-2">
											<UFormField :label="$t('pages.scenario-simulator.edit.linkTo')">
												<USelect
													v-model="linkTarget"
													data-testid="mininet-link-target"
													size="xs"
													class="w-full"
													:items="linkTargetItems"
													:placeholder="$t('pages.scenario-simulator.edit.linkPlaceholder')"
												/>
											</UFormField>
											<UButton
												data-testid="mininet-link-create"
												class="w-full justify-center"
												size="xs"
												color="primary"
												variant="subtle"
												icon="carbon:link"
												:label="$t('pages.scenario-simulator.edit.linkSubmit')"
												:disabled="!linkTarget"
												:loading="acting"
												@click="createLink"
											/>
										</div>

										<UButton
											v-if="canDelete"
											data-testid="mininet-remove-node"
											class="mt-3 w-full justify-start"
											size="xs"
											color="error"
											variant="subtle"
											icon="carbon:trash-can"
											:label="$t('pages.scenario-simulator.edit.removeNode')"
											@click="askRemoveNode"
										/>
									</template>

									<p v-else class="text-xs text-(--ui-text-muted)">
										{{ $t("pages.scenario-simulator.detail.hint") }}
									</p>
								</div>
							</template>
							<!--
								连通性 + 吞吐：运行态读数、连通性探测、吞吐测试与抓包观察窗。
								启动 / 停止 / 重启在工具栏「运行」菜单、抓包启停在「工具」菜单 —— 同一动作只有一个入口。
							-->
							<template v-else-if="sideTab === 'connectivity'">
								<!--
							运行控制（NMCPS-ADR-0022 W3）：`start` 要 `lab:create`，`stop` / `pingall` / `iperf` 要 `lab:operate`。

							状态读 `GET /api/lab/start`（上游 `app.net.is_started`）：读不到就写「未知」，**不假设
							「应该没启动」** —— 猜错会让启动按钮对着一个已在跑的网络发请求，再拿 400 当失败。
							按钮的禁用条件跟着运行态走：已启动不给启动、没启动不给停 / 不给跑测试，
							免得把「状态坏了」当成「操作失败」。
						-->
								<div data-testid="mininet-run">
									<div class="mb-2 flex items-center justify-between gap-2 border-b border-(--ui-border) pb-1">
										<h2 class="text-[13px] font-semibold tracking-wide">
											{{ $t("pages.scenario-simulator.run.title") }}
										</h2>
										<UBadge data-testid="mininet-run-state" size="sm" variant="subtle" :color="runStateColor">
											{{ runStateLabel }}
										</UBadge>
									</div>

									<div class="flex">
										<UButton
											v-if="canOperate"
											data-testid="mininet-run-ping"
											class="w-full justify-start"
											size="xs"
											color="neutral"
											variant="subtle"
											icon="carbon:connect"
											:label="$t('pages.scenario-simulator.run.ping')"
											:loading="runAction === 'pingall'"
											:disabled="runState !== true || runBusy"
											@click="runPingall"
										/>
									</div>

									<!--
								抓包读数（W5）：只在有 `lab:sniffer` 时显示，动作入口在「运行」旁边的「工具」菜单。
								这里只报状态 —— 同一动作全页只有一个入口（NMCPS-ARCH-006 §4）。
							-->
									<p
										v-if="canSniff"
										data-testid="mininet-sniffer-state"
										class="mt-2 text-[11px] text-(--ui-text-muted)"
									>
										{{ $t("pages.scenario-simulator.sniffer.title") }} · {{ snifferStateLabel }}
									</p>
									<p v-if="canSniff && snifferError" data-testid="mininet-sniffer-error" class="mt-1 text-xs text-(--ui-text-error)">
										{{ snifferError }}
									</p>

									<!--
								实时包列表（`/lab-ws/sniffer`，NMCPS-ADR-0022 D6）：抓包中自动连流，
								未抓包时只展示 `sniffer/history` 回填的历史。载荷只在本机渲染，不入审计。
							-->
									<div v-if="canSniff" data-testid="mininet-sniffer-panel" class="mt-2 rounded-lg border border-(--ui-border)">
										<div class="flex items-center justify-between gap-2 border-b border-(--ui-border) px-2 py-1">
											<h3 class="text-[11px] font-medium">
												{{ $t("pages.scenario-simulator.sniffer.streamTitle") }}
											</h3>
											<UBadge data-testid="mininet-sniffer-stream-state" size="sm" variant="subtle" :color="snifferStreamColor">
												{{ snifferStreamLabel }}
											</UBadge>
										</div>
										<p v-if="!snifferPackets.length" data-testid="mininet-sniffer-empty" class="px-2 py-2 text-[11px] text-(--ui-text-muted)">
											{{ $t("pages.scenario-simulator.sniffer.streamEmpty") }}
										</p>
										<ul v-else data-testid="mininet-sniffer-packets" class="max-h-44 divide-y divide-(--ui-border) overflow-auto text-[11px]">
											<li
												v-for="packet in snifferPackets"
												:key="packet.id"
												data-testid="mininet-sniffer-packet"
												class="flex items-center gap-2 px-2 py-1"
											>
												<span class="shrink-0 font-mono">{{ packet.proto }}</span>
												<span class="truncate font-mono">{{ packet.src || "—" }} → {{ packet.dst || "—" }}</span>
												<span class="ml-auto shrink-0 text-(--ui-text-muted)">{{ packet.len ?? "—" }}</span>
											</li>
										</ul>
										<p v-if="snifferStreamError" data-testid="mininet-sniffer-stream-error" class="border-t border-(--ui-border) px-2 py-1 text-[11px] text-(--ui-text-error)">
											{{ snifferStreamError }}
										</p>
									</div>

									<!-- 失败原话（上游 400 / 403 / 409 / 503）逐字显示：不吞 4xx，也不自造文案 -->
									<p v-if="runError" data-testid="mininet-run-error" class="mt-2 text-xs text-(--ui-text-error)">
										{{ runError }}
									</p>

									<template v-if="pingOutput">
										<h3 class="mt-2 text-xs font-medium">
											{{ $t("pages.scenario-simulator.run.pingOutput") }}
										</h3>
										<pre
											data-testid="mininet-run-ping-output"
											class="mt-1 max-h-32 overflow-auto rounded bg-(--ui-bg-elevated) p-2 text-[11px] leading-4 whitespace-pre-wrap"
										>{{ pingOutput }}</pre>
									</template>

									<!-- 吞吐测试（`lab:operate`）：两台 host 之间跑 `net.iperf()`，结果两侧原文照登 -->
									<div v-if="canOperate" class="mt-3 space-y-1.5 rounded border border-(--ui-border) p-2">
										<h3 class="text-xs font-medium">
											{{ $t("pages.scenario-simulator.run.iperfTitle") }}
										</h3>
										<div class="grid grid-cols-2 gap-1.5">
											<UFormField
												:label="$t('pages.scenario-simulator.run.iperfClient')"
												:error="iperfError === 'clientRequired' ? iperfErrorText : undefined"
											>
												<USelect
													v-model="iperfDraft.client"
													data-testid="mininet-iperf-client"
													size="xs"
													class="w-full"
													:items="hostItems"
													:placeholder="$t('pages.scenario-simulator.run.iperfHostPlaceholder')"
												/>
											</UFormField>
											<UFormField
												:label="$t('pages.scenario-simulator.run.iperfServer')"
												:error="iperfError === 'serverRequired' || iperfError === 'sameEndpoint' ? iperfErrorText : undefined"
											>
												<USelect
													v-model="iperfDraft.server"
													data-testid="mininet-iperf-server"
													size="xs"
													class="w-full"
													:items="hostItems"
													:placeholder="$t('pages.scenario-simulator.run.iperfHostPlaceholder')"
												/>
											</UFormField>
											<UFormField :label="$t('pages.scenario-simulator.run.iperfL4')">
												<USelect
													v-model="iperfDraft.l4Type"
													data-testid="mininet-iperf-l4"
													size="xs"
													class="w-full"
													:items="iperfL4Items"
												/>
											</UFormField>
											<UFormField
												:label="$t('pages.scenario-simulator.run.iperfSeconds')"
												:error="iperfError === 'secondsInvalid' ? iperfErrorText : undefined"
											>
												<UInput
													v-model="iperfDraft.seconds"
													data-testid="mininet-iperf-seconds"
													size="xs"
													class="w-full"
													type="number"
													min="1"
													:max="LAB_IPERF_SECONDS_MAX"
													:placeholder="$t('pages.scenario-simulator.run.iperfSecondsHint')"
												/>
											</UFormField>
										</div>
										<p class="text-[11px] text-(--ui-text-muted)">
											{{ $t("pages.scenario-simulator.run.iperfSecondsHint") }}
										</p>
										<UButton
											data-testid="mininet-iperf-submit"
											class="w-full justify-center"
											size="xs"
											color="primary"
											variant="subtle"
											icon="carbon:chart-line-smooth"
											:label="$t('pages.scenario-simulator.run.iperfSubmit')"
											:loading="runAction === 'iperf'"
											:disabled="runState !== true || runBusy"
											@click="runIperf"
										/>
										<template v-if="iperfResult">
											<p class="text-[11px] font-medium">
												{{ $t("pages.scenario-simulator.run.iperfClientResult") }}
											</p>
											<pre
												data-testid="mininet-iperf-client-output"
												class="max-h-32 overflow-auto rounded bg-(--ui-bg-elevated) p-2 text-[11px] leading-4 whitespace-pre-wrap"
											>{{ iperfResult.client || $t("pages.scenario-simulator.run.pingEmpty") }}</pre>
											<p class="text-[11px] font-medium">
												{{ $t("pages.scenario-simulator.run.iperfServerResult") }}
											</p>
											<pre
												data-testid="mininet-iperf-server-output"
												class="max-h-32 overflow-auto rounded bg-(--ui-bg-elevated) p-2 text-[11px] leading-4 whitespace-pre-wrap"
											>{{ iperfResult.server || $t("pages.scenario-simulator.run.pingEmpty") }}</pre>
										</template>
									</div>
								</div>
							</template>
							<!--
								观测三块（NMCPS-ADR-0022 D6）：三块内容各自换票建连。这里用 `v-show` 而不是
								`v-if` —— 切到「网络 / 连通」只换视图，Webshell 的多会话不被卸载；右栏收起才断流
								（`useLabWsChannel()` 的 `onScopeDispose` 兜底）。
							-->
							<SimulatorNetworkTools
								v-show="isToolTab"
								ref="networkToolsRef"
								:tab="sideTab"
								:panel-open="panelOpen"
								:nodes="networkToolNodes"
								:selected-id="selectedId"
							/>
						</div>
					</div>
				</div>
			</aside>
		</div>

		<!--
			新增 / 删除的确认层（NMCPS-ADR-0022 W2）：表单与确认都是 `UModal` 原生组件，
			请求由页面发（页面是唯一写入方），组件只负责校验与文案。
		-->
		<!--
			生成拓扑（复刻旧 `Side.vue`「生成拓扑」+ `TopologyForm.vue`）：表单只收参数，
			节点与链路由页面按 `labGeneratePlan()` 的计划串行写入，写完重读台账。
		-->
		<SimulatorGenerateTopologyModal
			v-if="canCreate"
			v-model:open="generateOpen"
			:controllers="controllerIds"
			:submitting="generateBusy"
			:error="generateError"
			@submit="generateTopology"
		/>
		<!-- 设置（复刻旧「文件 → 设置」里仍属本页的默认值，见 `labPreferences.ts`） -->
		<SimulatorSettingsModal
			v-model:open="settingsOpen"
			:preferences="preferences"
			@save="savePreferences"
		/>
		<SimulatorNodeFormModal
			v-if="createKind"
			v-model:open="createOpen"
			:kind="createKind"
			:existing="nodeIds"
			:origin="createOrigin"
			:sequence="nodes.length + 1"
			:submitting="acting"
			:error="actionError"
			@submit="createNode"
		/>
		<SimulatorDeleteTargetModal
			v-model:open="removeOpen"
			:target="removeTarget"
			:submitting="acting"
			:error="actionError"
			@confirm="confirmRemove"
		/>
		<SimulatorClearFlowsModal
			v-model:open="clearFlowsOpen"
			v-model:match="clearFlowsMatch"
			:switch-id="selectedNode?.positioned.id ?? null"
			:row-count="flowRowCount"
			:submitting="acting"
			:error="clearFlowsError"
			:match-error="clearFlowsMatchError"
			@confirm="submitClearFlows"
		/>
		<!-- 停网 / 重启确认（NMCPS-ADR-0022 W3）：`POST /stop` 会终止全部节点进程，按一次要确认 -->
		<SimulatorStopNetworkModal
			v-model:open="stopOpen"
			:mode="stopIntent"
			:submitting="runBusy"
			:error="stopError"
			@confirm="confirmStopIntent"
		/>
		<!-- 破坏性重建确认（NMCPS-ADR-0022 W5）：`POST /full_reset` 要逐字输入网络 id -->
		<SimulatorResetNetworkModal
			v-model:open="resetOpen"
			:network-id="network?.id ?? null"
			:submitting="runBusy"
			:error="resetError"
			@confirm="resetNetwork"
		/>
		<!-- 台账对账（NMCPS-ADR-0023）：也只改台账，同样要逐字输入网络 id -->
		<SimulatorReconcileNetworkModal
			v-model:open="reconcileOpen"
			:network-id="network?.id ?? null"
			:submitting="reconcileBusy"
			:error="reconcileError"
			@confirm="reconcileNetwork"
		/>
		<!-- 节点 / 链路详情（NMCPS-ADR-0022 W13）：双击打开，编辑要 `lab:operate` -->
		<SimulatorNodeDetailModal
			v-model:open="nodeDetailOpen"
			:node="nodeDetailNode"
			:operate="canOperate"
			:submitting="detailSubmitting"
			:error="detailError"
			@submit="saveNodeDetail"
		/>
		<SimulatorLinkDetailModal
			v-model:open="linkDetailOpen"
			:link="linkDetailLink"
			:operate="canOperate"
			:submitting="detailSubmitting"
			:error="detailError"
			@submit="saveLinkDetail"
		/>
	</div>
</template>

<script setup lang="ts">
	import type { DropdownMenuItem } from "@nuxt/ui";
	import type { PositionedTopologyNode } from "~~/app/utils/graph/topologyLayout";
	import type { TopologyNodeRole } from "~~/app/utils/graph/topologyRoleStyle";
	import type { LabNetworkSummary, LabNetworkSyncResult } from "~~/shared/types/lab";
	import type { TopologyGraphLink, TopologyGraphNode } from "~~/shared/types/topology";
	import type { LabFlowDraftError } from "#layers/scenario/shared/types/labFlows";
	import type { LabGenerateDraft } from "#layers/scenario/shared/types/labGenerate";
	import type { LabNodeKind, LabNodeOrigin, LabRemoveTarget } from "#layers/scenario/shared/types/labNodes";
	import type { LabPreferences } from "#layers/scenario/shared/types/labPreferences";
	import type {
		LabIperfDraftError,
		LabIperfResult
	} from "#layers/scenario/shared/types/labRun";
	import type { LabSideTab } from "#layers/scenario/shared/types/labSideTabs";
	import type { MininetChannelCapabilities, MininetChannelInfo } from "#layers/scenario/shared/types/mininet";
	import { topologyLinkKey } from "~~/app/utils/graph/topologyNormalize";
	import { topologyPngBlobOf, topologyPngFilename } from "~~/app/utils/graph/topologyPngExport";
	import {
		LAB_FLOW_PRIORITY_MAX,
		labFlowClearError,
		labFlowClearMatchOf,
		labFlowClearPayloadOf,
		labFlowDraftError,
		labFlowDraftOf,
		labFlowPayloadOf,
		labFlowRowsOf
	} from "#layers/scenario/shared/types/labFlows";
	import { labGenerateLinkPayloadOf, labGeneratePlan } from "#layers/scenario/shared/types/labGenerate";
	import { parseLabImport } from "#layers/scenario/shared/types/labImport";
	import {
		LAB_NODE_COLLECTIONS,
		LAB_NODE_KINDS,
		LAB_OPENFLOW_VERSIONS
	} from "#layers/scenario/shared/types/labNodes";
	import {
		LAB_PREFERENCES_KEY,
		labPreferencesFrom,
		labPreferencesLinkOptions,
		labPreferencesOf,
		labPreferencesOpenflow
	} from "#layers/scenario/shared/types/labPreferences";
	import {
		LAB_IPERF_L4_TYPES,
		LAB_IPERF_SECONDS_MAX,
		labIperfDraftError,
		labIperfDraftOf,
		labIperfPayloadOf,
		labIperfResultOf,
		labRunOutputOf,
		labRunStateOf
	} from "#layers/scenario/shared/types/labRun";
	import { isLabObservationTab } from "#layers/scenario/shared/types/labSideTabs";

	import {
		LAB_CAPTURE_FALLBACK_FILENAME,
		labSnifferActiveOf
	} from "#layers/scenario/shared/types/labSniffer";

	definePageMeta({ sort: 1, icon: "carbon:flash" });

	interface RawMininetNode {
		id?: string
		name?: string
		label?: string
		type?: string
		x?: unknown
		y?: unknown
		ip?: string
		mac?: string
		controller?: string
		ports?: number
		switch_type?: string
		of_version?: string | null
	}

	type NodeKind = LabNodeKind;

	/** 节点类型 → 图标 / i18n 后缀（新增菜单与徽章共用一张表，不各写一份） */
	const NODE_KIND_ICONS: Record<NodeKind, string> = {
		host: "carbon:laptop",
		switch: "carbon:switch-layer-3",
		router: "carbon:router",
		nat: "carbon:network-4",
		controller: "carbon:control"
	};

	interface GraphNode {
		key: string
		kind: NodeKind
		raw: RawMininetNode
		positioned: PositionedTopologyNode
	}

	const api = useApi();
	const { t } = useI18n();
	const toast = useToast();

	const loading = ref(false);
	const error = ref<string | null>(null);
	const networks = ref<LabNetworkSummary[]>([]);
	const nodes = ref<GraphNode[]>([]);
	const graphLinks = ref<TopologyGraphLink[]>([]);
	const canvasWidth = ref(960);
	const canvasHeight = ref(640);
	const selectedId = ref<string | null>(null);
	const selectedLinkKey = ref<string | null>(null);

	/**
	 * 会话能力位（`GET /api/lab/channel`，NMCPS-ADR-0022 D3）：
	 * 写动作**先读能力位再渲染**，不靠「先渲染、点下去再收 403/405」。
	 * 读不到（通道未配置 / 主上游不可用）时保持只读 —— 失败关闭。
	 */
	const capabilities = ref<MininetChannelCapabilities | null>(null);
	const canCreate = computed(() => capabilities.value?.create === true);
	const canOperate = computed(() => capabilities.value?.operate === true);
	const canDelete = computed(() => capabilities.value?.delete === true);
	/** 抓包是独立授权位：`lab:read` / `lab:operate` 都不能推导出它（NMCPS-ADR-0021 D3） */
	const canSniff = computed(() => capabilities.value?.sniffer === true);
	/** 终端同样独立授权位（右键菜单的「打开 Webshell」按它裁剪，W12） */
	const canTerminal = computed(() => capabilities.value?.terminal === true);

	/**
	 * 左侧设备栏（NMCPS-ADR-0022 W10）：类型图标要 `create`，栏顶的运行按钮要 `create` /
	 * `operate`（启动归 `create`，停止 / 重启归 `operate`）。两者都没有时整列不出现 ——
	 * 只读会话不该多出一根空栏。
	 */
	const showPaletteRail = computed(() => canCreate.value || canOperate.value);

	/**
	 * 右栏标签页（NMCPS-ADR-0022 D6 / W7）：标签定义只有这一份 —— 观测三块按能力位裁剪
	 * （Webshell 要 `lab:terminal`，日志 / 监控只要 `lab:read`），台账两块常驻（「网络」是纯读，
	 * 「连通」要 `lab:operate` 或 `lab:sniffer` 才有内容）。
	 *
	 * 缺省停在「网络」：那是台账事实视图，不依赖任何写能力位；能力位装载后若当前页被裁掉，
	 * 回落到第一项，而不是把用户留在一个空标签里。
	 */
	const sideTab = ref<LabSideTab>("network");
	const sideTabItems = computed(() => [
		...(canTerminal.value
			? [{ label: t("pages.scenario-simulator.panel.tabs.webshell"), value: "webshell" as const }]
			: []),
		...(capabilities.value?.read === true
			? [
				{ label: t("pages.scenario-simulator.panel.tabs.logs"), value: "logs" as const },
				{ label: t("pages.scenario-simulator.panel.tabs.monitor"), value: "monitor" as const }
			]
			: []),
		{ label: t("pages.scenario-simulator.panel.tabs.network"), value: "network" as const },
		...(canOperate.value || canSniff.value
			? [{ label: t("pages.scenario-simulator.panel.tabs.connectivity"), value: "connectivity" as const }]
			: [])
	]);
	const isToolTab = computed(() => isLabObservationTab(sideTab.value));

	watch(sideTabItems, (items) => {
		if (!items.some((item) => item.value === sideTab.value))
			sideTab.value = items[0]?.value ?? "network";
	});

	/** 面板的目标选择用画布台账的全量节点（与默认落点同一份事实，不受「视图」显示开关影响） */
	const networkToolNodes = computed(() => nodes.value.map((node) => ({
		id: node.positioned.id,
		label: node.positioned.label || node.positioned.id
	})));

	/** 正在进行的写操作（按钮 loading / 弹窗不可关闭）与失败原话 */
	const acting = ref(false);
	const actionError = ref<string>();

	/** 新增节点弹窗：`createKind` 为空时不挂载组件，草稿因此不会跨类型串味 */
	const createOpen = ref(false);
	const createKind = ref<NodeKind | null>(null);

	/** 删除确认（节点 / 链路共用一个弹窗） */
	const removeOpen = ref(false);
	const removeTarget = ref<LabRemoveTarget | null>(null);

	/** 连线目标（从选中节点连出去） */
	const linkTarget = ref<string>();

	/** 交换机流表：原文 + 失败原话（上游原话逐字展示，不翻译） */
	const flowLoading = ref(false);
	const flowText = ref("");
	const flowError = ref<string>();

	/** 加流草稿（`lab:operate` 才渲染表单；切换交换机时重置） */
	const flowDraft = ref(labFlowDraftOf());
	const flowDraftError = ref<LabFlowDraftError>();

	/**
	 * 清流弹窗（`DELETE /flows`，`lab:operate`）：匹配域由页面持有，
	 * 切交换机 / 重新读表时一并重置，避免把上一台交换机的条件带过去。
	 */
	const clearFlowsOpen = ref(false);
	const clearFlowsMatch = ref("");
	const clearFlowsMatchError = ref<string>();
	const clearFlowsError = ref<string>();

	/**
	 * 运行控制（NMCPS-ADR-0022 W3）：`start` 要 `lab:create`，`stop` / `pingall` / `iperf` 要 `lab:operate`。
	 *
	 * `runState` 是三态：`true` 运行中 / `false` 已停止 / `null` **未知**（通道没配、上游不可用、
	 * 会话没有 `lab:read`）。三态而不是布尔，是因为「读不到」和「确实没启动」的按钮状态不同：
	 * 未知时启动 / 停止 / 测速全部禁用，只留刷新，别让人对着未知状态乱点。
	 */
	const runState = ref<boolean | null>(null);
	const runAction = ref<"start" | "stop" | "restart" | "reset" | "pingall" | "iperf" | null>(null);
	const runError = ref<string>();
	const pingOutput = ref("");
	const iperfDraft = ref(labIperfDraftOf());
	const iperfError = ref<LabIperfDraftError>();
	const iperfResult = ref<LabIperfResult | null>(null);

	/**
	 * 画布显隐开关（「视图」菜单）：只影响渲染，不改台账读数 —— `nodes` 仍是全量事实，
	 * 默认落点、拖拽锚点换算、节点数徽章都用全量，免得「藏起来的主机」把新节点放到空处。
	 */
	const showLabels = ref(true);
	const showHosts = ref(true);
	const showControllers = ref(true);
	const showHostIp = ref(false);

	/** 停网确认（`POST /stop` 会终止全部节点进程）与它自己的失败原话 */
	const stopOpen = ref(false);
	const stopError = ref<string>();
	/** 确认弹窗这次确认的是哪件事：停止 / 重启（= 停止 + 启动） */
	const stopIntent = ref<"stop" | "restart">("stop");

	/**
	 * 抓包（NMCPS-ADR-0022 W5，「工具」菜单）：三态读数 + 在途动作。
	 *
	 * `snifferActive` 的 `null` 是**未知**（`GET /api/lab/sniffer/state` 读不到），
	 * 与运行态同一口径：未知时两个动作都禁用 —— 把「读不到」当「没在抓」，
	 * 会让「开始抓包」对着已经在录的上游再发一次 start。
	 */
	const snifferActive = ref<boolean | null>(null);
	const snifferError = ref<string>();
	const snifferAction = ref<"start" | "stop" | "download" | null>(null);
	/** 抓包动作在途（启停 / 下载三者互斥：同一个上游抓包进程） */
	const snifferBusy = computed(() => snifferAction.value !== null);

	/**
	 * 实时包列表（`/lab-ws/sniffer`，NMCPS-ADR-0022 D6）。
	 *
	 * 只有**抓包中**才建连：读数 `null`（读不到）与 `false` 都不连 —— 未知不等于在抓包。
	 * 建连前先向 BFF 换一次性票（会话 + `lab:sniffer` + 台账都在 BFF 判），
	 * 页面拿不到上游地址，也不自己拼 `ws://…:8000`。
	 */
	const {
		packets: snifferPackets,
		status: snifferStreamStatus,
		error: snifferStreamError,
		loadHistory: loadSnifferHistory,
		connect: connectSnifferStream,
		disconnect: disconnectSnifferStream
	} = useLabSnifferStream();

	const snifferStreamLabel = computed(() => {
		switch (snifferStreamStatus.value) {
		case "live": return t("pages.scenario-simulator.sniffer.streamLive");
		case "connecting": return t("pages.scenario-simulator.sniffer.streamConnecting");
		case "closed": return t("pages.scenario-simulator.sniffer.streamClosed");
		case "error": return t("pages.scenario-simulator.sniffer.streamError");
		default: return t("pages.scenario-simulator.sniffer.streamIdle");
		}
	});

	const snifferStreamColor = computed<"success" | "error" | "neutral">(() => {
		if (snifferStreamStatus.value === "live")
			return "success";
		if (snifferStreamStatus.value === "error")
			return "error";
		return "neutral";
	});

	/** 抓包态从 `true` 变化时连流 / 断流；`null`（未知）按「不连」处理 */
	watch(snifferActive, (active) => {
		if (canSniff.value && active === true) {
			void connectSnifferStream();
			return;
		}
		disconnectSnifferStream();
	});

	/** 破坏性重建确认（`POST /full_reset`，W5）：网络 id 由弹窗逐字确认后回传 */
	const resetOpen = ref(false);
	const resetError = ref<string>();
	/** 台账对账（`POST /api/lab/networks/{id}/sync`，NMCPS-ADR-0023） */
	const reconcileOpen = ref(false);
	const reconcileBusy = ref(false);
	const reconcileError = ref<string>();

	/**
	 * 画布实例：导出 PNG 需要根 `<svg>`（`TopologyCanvas` 以 `svgElement` 暴露）。
	 * 只取元素本身，不碰它的交互状态。
	 */
	const canvasRef = ref<{ svgElement?: SVGSVGElement | null } | null>(null);

	/**
	 * 生成拓扑（复刻旧 `Side.vue`「生成拓扑」+ `TopologyForm.vue`）。
	 *
	 * 表单只收参数；节点与链路按 `labGeneratePlan()` **串行**写入 —— 上游是单个
	 * `app.net`，BFF 对同一网络只允许一个在途写操作（NMCPS-ADR-0022 D5），
	 * 并发会拿 409 并把「生成到一半」的拓扑留在后端。
	 */
	const generateOpen = ref(false);
	const generateBusy = ref(false);
	const generateError = ref<string>();

	/**
	 * 实验台偏好（「文件 → 设置」）：默认交换机类型 / 默认 OpenFlow / 默认链路属性。
	 * 落 `localStorage`（键见 `LAB_PREFERENCES_KEY`），刷新后仍生效；读不到就用缺省值。
	 */
	const settingsOpen = ref(false);
	const preferences = ref<LabPreferences>(labPreferencesOf());

	const network = computed(() => networks.value[0] ?? null);
	const positioned = computed(() => nodes.value.map((item) => item.positioned));
	const nodeIds = computed(() => nodes.value.map((item) => item.positioned.id));

	/** 控制器 id：「生成拓扑」的关联选项只列台账里真实存在的控制器（上游对未知 id 回 400） */
	const controllerIds = computed(() => nodes.value
		.filter((item) => item.kind === "controller")
		.map((item) => item.positioned.id));

	/** 生成计划的起始序号：现有同类节点数 + 1（计划生成器还会再让开重名） */
	const hostSequence = computed(() => nodes.value.filter((item) => item.kind === "host").length + 1);
	const switchSequence = computed(() => nodes.value.filter((item) => item.kind === "switch").length + 1);

	/** 被显隐开关关掉的类型：只在这一层过滤，台账与布局计划都不动 */
	const hiddenKinds = computed(() => {
		const hidden = new Set<NodeKind>();
		if (!showHosts.value)
			hidden.add("host");
		if (!showControllers.value)
			hidden.add("controller");
		return hidden;
	});

	/** 画布可见节点（标签按「显示主机 IP」补注） */
	const visibleNodes = computed<PositionedTopologyNode[]>(() => positioned.value
		.filter((item) => !hiddenKinds.value.has((item.node.type ?? "host") as NodeKind))
		.map((item) => ({ ...item, label: labelOf(item) })));

	/** 可见链路：两端都得在画布上，否则会画出一条连到空处的线 */
	const visibleLinks = computed(() => {
		const ids = new Set(visibleNodes.value.map((item) => item.id));
		return graphLinks.value.filter((link) => ids.has(link.source) && ids.has(link.target));
	});

	/**
	 * 标签补注（「视图」菜单的「显示主机 IP」）：IP 跟名称同一行、同一字号。
	 * 不截断也不换行 —— 画布的标签是单行文本，「名称 (IP)」是最不容易认错设备的写法。
	 */
	function labelOf(item: PositionedTopologyNode): string {
		if (showHostIp.value && item.node.type === "host" && item.node.ip)
			return `${item.label} · ${item.node.ip}`;
		return item.label;
	}

	const selectedNode = computed(() => nodes.value.find((item) => item.positioned.id === selectedId.value) ?? null);
	const selectedLink = computed(() => {
		const index = graphLinks.value.findIndex((link, position) => topologyLinkKey(link, position) === selectedLinkKey.value);
		return index >= 0 ? graphLinks.value[index] ?? null : null;
	});

	/* ── 右键菜单 + 双击详情（NMCPS-ADR-0022 W12 / W13）──────────────────────────
	 * 菜单只对节点弹两项（打开 Webshell / 查看节点详情），空白右键由画布挡掉；
	 * 双击交给两个详情弹窗：事实读台账，编辑按 `lab:operate` 才渲染，请求体在 `labDetails.ts`。
	 */

	/** 右键命中的节点 id（`null` = 空白 / 链路，菜单不弹） */
	const nodeMenuId = ref<string | null>(null);
	/** `GET /links` 的 `options`：链路详情的事实来源，`from|to` 两个方向都登记 */
	const labLinkOptions = ref<Record<string, Record<string, unknown>>>({});
	const networkToolsRef = ref<{ openTerminalFor?: (nodeId: string) => Promise<void> } | null>(null);

	const nodeMenuItems = computed<DropdownMenuItem[][]>(() => {
		const id = nodeMenuId.value;
		if (!id)
			return [];
		const items: DropdownMenuItem[] = [];
		if (canTerminal.value) {
			items.push({
				label: t("pages.scenario-simulator.contextMenu.webshell"),
				icon: "carbon:terminal",
				onSelect: () => openWebshellForNode(id)
			});
		}
		items.push({
			label: t("pages.scenario-simulator.contextMenu.details"),
			icon: "carbon:data-view",
			onSelect: () => openNodeDetail(id)
		});
		return [items];
	});

	const nodeDetailId = ref<string | null>(null);
	const nodeDetailOpen = ref(false);
	const nodeDetailNode = computed(() => {
		const node = nodes.value.find((item) => item.positioned.id === nodeDetailId.value);
		return node
			? { id: node.positioned.id, kind: node.kind as string, label: node.positioned.label, raw: { ...node.raw } }
			: null;
	});

	const linkDetailKey = ref<string | null>(null);
	const linkDetailOpen = ref(false);
	const linkDetailLink = computed(() => {
		const index = graphLinks.value.findIndex((link, position) => topologyLinkKey(link, position) === linkDetailKey.value);
		const link = index >= 0 ? graphLinks.value[index] : undefined;
		if (!link)
			return null;
		return {
			source: link.source,
			target: link.target,
			options: labLinkOptions.value[`${link.source}|${link.target}`] ?? {}
		};
	});

	const detailSubmitting = ref(false);
	const detailError = ref<string>();

	/**
	 * 流表按行渲染：上游回的是 `ovs-ofctl` 原文，页面不解析（解析归后端）。
	 * 行号只对含 `actions=` 的行给出，口径与上游 `delete_flow_by_id()` 一致。
	 */
	const flowRows = computed(() => labFlowRowsOf(flowText.value));
	/** 可删条数（只有含 `actions=` 的行才可删）：清流弹窗用它说明「要删掉多少」 */
	const flowRowCount = computed(() => flowRows.value.filter((row) => row.id).length);

	/** 加流表单的报错文案：键后缀 → 完整 i18n 键 */
	const flowDraftErrorText = computed(() => (flowDraftError.value
		? t(`pages.scenario-simulator.flows.errors.${flowDraftError.value}`)
		: undefined));

	/** 用户一动草稿就撤掉上一次的就地报错 —— 留着会指向已经改过的字段 */
	watch(flowDraft, () => {
		flowDraftError.value = undefined;
	}, { deep: true });

	/** 是否有运行控制请求在途（`start` / `stop` / `pingall` / `iperf` 互斥：单实例只有一个 Mininet） */
	const runBusy = computed(() => runAction.value !== null);

	/** 运行态徽章：三态各有自己的颜色，未知不是「已停止」 */
	const runStateLabel = computed(() => (runState.value === null
		? t("pages.scenario-simulator.run.stateUnknown")
		: t(runState.value
			? "pages.scenario-simulator.run.stateRunning"
			: "pages.scenario-simulator.run.stateStopped")));
	const runStateColor = computed(() => (runState.value === null
		? "warning"
		: runState.value ? "success" : "neutral"));

	/** iperf 表单的报错文案：键后缀 → 完整 i18n 键 */
	const iperfErrorText = computed(() => (iperfError.value
		? t(`pages.scenario-simulator.run.errors.${iperfError.value}`)
		: undefined));

	/* ── 菜单栏（复刻 1.0 版式的「文件 / 视图 / 运行」，NMCPS-ADR-0022 W2 修订 / W4）──────────
	 * checkbox 项的 `onSelect` 一律 `preventDefault()`：默认行为是选中即收起，
	 * 连切两个开关就得重新打开菜单（Nuxt UI 官方示例同口径）。
	 */

	/** 导入的选文件控件（隐藏 input；菜单项只负责点开它） */
	const importInput = ref<HTMLInputElement | null>(null);
	const importBusy = ref(false);

	/**
	 * 导入是**重建级**写操作：上游 `import_json` 会按文件内容 `create_*` 一整套拓扑，
	 * 白名单给它的权限位是 `lab:delete` + `lab:create`（NMCPS-ADR-0022 D2），
	 * 所以入口也按同一对能力位渲染 —— 缺任一就不给点。
	 */
	const canImport = computed(() => canCreate.value && canDelete.value);

	/**
	 * 台账对账（NMCPS-ADR-0023 D3）：与导入同档的双权限 —— 它把清单之外的节点纳入
	 * 租户边界，等价于一次接管；缺任一能力位时入口不渲染。
	 */
	const canReconcile = computed(() => canCreate.value && canDelete.value);

	/**
	 * 「文件」菜单：导入拓扑 / 导出 JSON / 导出脚本。
	 *
	 * 导出走 `GET /api/lab/export/{json|script}`（`lab:read`，任何人可见）：它只读上游，
	 * 不改变拓扑；导入需要双权限。三项都是真端点 —— 没有「先占位、后接线」的灰项。
	 */
	const fileMenuItems = computed<DropdownMenuItem[][]>(() => [[
		{
			label: t("pages.scenario-simulator.menu.importJson"),
			icon: "carbon:upload",
			disabled: !canImport.value || importBusy.value,
			onSelect: () => askImport()
		},
		{
			label: t("pages.scenario-simulator.menu.exportJson"),
			icon: "carbon:download",
			onSelect: () => void exportTopology("json")
		},
		{
			label: t("pages.scenario-simulator.menu.exportScript"),
			icon: "carbon:code",
			onSelect: () => void exportTopology("script")
		},
		{
			/*
				导出 PNG（复刻旧「文件 → 导出 PNG」）：纯前端，从画布 SVG 渲染，
				不访问上游、不需要写能力位 —— 只读用户也能把「他看到的图」带走。
			*/
			label: t("pages.scenario-simulator.menu.exportPng"),
			icon: "carbon:image",
			onSelect: () => void exportTopologyPng()
		},
		{
			/*
				导出地址规划（复刻旧「文件 → 导出地址规划」）：读 `GET /api/lab/addressing_plan`
				（`lab:read`）。旧版排成 PDF，2.0 不引入 PDF 依赖，改成同名 JSON 下载 ——
				内容仍是「每台节点的接口 / MAC / IPv4 / IPv6」。
			*/
			label: t("pages.scenario-simulator.menu.exportAddressing"),
			icon: "carbon:table",
			onSelect: () => void exportAddressingPlan()
		}
	], [
		{
			// 对账（NMCPS-ADR-0023）：只改台账清单，双权限 + 逐字确认
			label: t("pages.scenario-simulator.menu.reconcile"),
			icon: "carbon:data-check",
			disabled: !canReconcile.value || reconcileBusy.value,
			onSelect: () => askReconcile()
		},
		{
			// 设置（复刻旧「文件 → 设置」里仍属本页的两项默认值）
			label: t("pages.scenario-simulator.menu.settings"),
			icon: "carbon:settings",
			onSelect: () => {
				settingsOpen.value = true;
			}
		}
	]]);

	/** 点「导入拓扑」只做一件事：把隐藏 input 打开（选完文件由 `onImportFile` 接手） */
	function askImport(): void {
		importInput.value?.click();
	}

	/**
	 * 选完文件 → 本地判形状 → `POST /api/lab/import_json`。
	 *
	 * 形状判定放在请求之前（`parseLabImport()`）：空文件 / 不是 JSON / 既不是 `{nodes, edges}`
	 * 也不是台账形状，都在这里就地报错、零请求 —— 不让用户拿上游的 422 当提示。
	 * 上游只做**追加**，所以成功后重新读台账，新节点自然出现在画布上。
	 */
	async function onImportFile(event: Event): Promise<void> {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		// 清空取值：连续导入同一个文件也要能再触发一次 `change`
		input.value = "";

		if (!file || importBusy.value) {
			return;
		}

		const parsed = parseLabImport(await file.text());
		if (!parsed.ok) {
			toast.add({
				title: t("pages.scenario-simulator.import.failed"),
				description: t(`pages.scenario-simulator.import.errors.${parsed.error}`),
				color: "error"
			});
			return;
		}

		importBusy.value = true;
		try {
			await api.post("/api/lab/import_json", parsed.payload);
			toast.add({
				title: t("pages.scenario-simulator.import.ok"),
				description: t("pages.scenario-simulator.import.okHint", {
					nodes: parsed.topology.nodes.length,
					links: parsed.topology.links.length
				}),
				color: "success"
			});
			await load();
		} catch (caught) {
			toast.add({
				title: t("pages.scenario-simulator.import.failed"),
				description: messageOf(caught),
				color: "error"
			});
		} finally {
			importBusy.value = false;
		}
	}

	/**
	 * 把下载到的字节交给浏览器保存（导出 / 抓包共用）。
	 *
	 * 文件名一律用 BFF 生成的 `content-disposition`；`<a download>` 需要一个瞬时 URL，
	 * 点完立即回收，避免把 pcap 这类大对象一直挂在内存里。
	 */
	function saveBlob(blob: Blob, filename: string): void {
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = filename;
		document.body.append(anchor);
		anchor.click();
		anchor.remove();
		URL.revokeObjectURL(url);
	}

	/**
	 * 导出：`download()` 拿回 Blob 后走一次 `<a download>` 触发保存。
	 *
	 * 文件名用 BFF 生成的 `content-disposition`（`lab-<network_id>-<timestamp>.<ext>`），
	 * 不信任上游；导出的正文**不是** JSON 信封，所以不能走 `api.get()`。
	 */
	async function exportTopology(kind: "json" | "script"): Promise<void> {
		try {
			const { blob, filename } = await api.download(`/api/lab/export/${kind}`, {
				fallbackFilename: `lab-topology.${kind === "json" ? "json" : "py"}`
			});
			saveBlob(blob, filename);
		} catch (caught) {
			toast.add({
				title: t("pages.scenario-simulator.export.failed"),
				description: messageOf(caught),
				color: "error"
			});
		}
	}

	/**
	 * 下载抓包文件（`GET /api/lab/export/pcap`，`lab:sniffer`）。
	 *
	 * 与拓扑导出同一条下载通道，但 `accept` 声明二进制：pcap 不能被当文本解，
	 * BFF 侧同样以 `arrayBuffer` 取字节（`fetchMininetBinary`）。
	 */
	async function downloadCapture(): Promise<void> {
		if (!canSniff.value || snifferBusy.value)
			return;

		snifferAction.value = "download";
		snifferError.value = undefined;

		try {
			const { blob, filename } = await api.download("/api/lab/export/pcap", {
				fallbackFilename: LAB_CAPTURE_FALLBACK_FILENAME,
				accept: "application/vnd.tcpdump.pcap"
			});
			saveBlob(blob, filename);
			toast.add({ title: t("pages.scenario-simulator.sniffer.downloaded"), color: "success" });
		} catch (caught) {
			snifferError.value = messageOf(caught);
			toast.add({
				title: t("pages.scenario-simulator.sniffer.downloadFailed"),
				description: messageOf(caught),
				color: "error"
			});
		} finally {
			snifferAction.value = null;
		}
	}

	/**
	 * 开始抓包（`POST /api/lab/sniffer/start`）：上游对未启动的网络回 400，所以入口只在
	 * `runState === true && snifferActive === false` 时可点。响应体是 `{ active }`，
	 * 直接当新读数用 —— 不自己把状态改成 `true`，让上游说了算。
	 */
	async function startSniffer(): Promise<void> {
		if (!canSniff.value || snifferBusy.value)
			return;

		snifferAction.value = "start";
		snifferError.value = undefined;

		try {
			snifferActive.value = labSnifferActiveOf(await api.post<unknown>("/api/lab/sniffer/start"));
			toast.add({ title: t("pages.scenario-simulator.sniffer.started"), color: "success" });
		} catch (caught) {
			snifferError.value = messageOf(caught);
			toast.add({
				title: t("pages.scenario-simulator.sniffer.startFailed"),
				description: messageOf(caught),
				color: "error"
			});
		} finally {
			snifferAction.value = null;
		}
	}

	/** 停止抓包（`POST /api/lab/sniffer/stop`）：上游幂等，读数仍以响应为准 */
	async function stopSniffer(): Promise<void> {
		if (!canSniff.value || snifferBusy.value)
			return;

		snifferAction.value = "stop";
		snifferError.value = undefined;

		try {
			snifferActive.value = labSnifferActiveOf(await api.post<unknown>("/api/lab/sniffer/stop"));
			toast.add({ title: t("pages.scenario-simulator.sniffer.stopped"), color: "success" });
		} catch (caught) {
			snifferError.value = messageOf(caught);
			toast.add({
				title: t("pages.scenario-simulator.sniffer.stopFailed"),
				description: messageOf(caught),
				color: "error"
			});
		} finally {
			snifferAction.value = null;
		}
	}

	/** 「视图」菜单：全部是渲染层开关，点完不触发任何请求 */
	const viewMenuItems = computed<DropdownMenuItem[][]>(() => [[
		{
			type: "checkbox",
			label: t("pages.scenario-simulator.menu.labels"),
			icon: "carbon:text-font",
			checked: showLabels.value,
			onUpdateChecked: (checked: boolean) => {
				showLabels.value = checked;
			},
			onSelect: (event: Event) => event.preventDefault()
		},
		{
			type: "checkbox",
			label: t("pages.scenario-simulator.menu.hosts"),
			icon: "carbon:laptop",
			checked: showHosts.value,
			onUpdateChecked: (checked: boolean) => {
				showHosts.value = checked;
			},
			onSelect: (event: Event) => event.preventDefault()
		},
		{
			type: "checkbox",
			label: t("pages.scenario-simulator.menu.controllers"),
			icon: "carbon:control",
			checked: showControllers.value,
			onUpdateChecked: (checked: boolean) => {
				showControllers.value = checked;
			},
			onSelect: (event: Event) => event.preventDefault()
		},
		{
			type: "checkbox",
			label: t("pages.scenario-simulator.menu.hostIp"),
			icon: "carbon:network-4",
			checked: showHostIp.value,
			onUpdateChecked: (checked: boolean) => {
				showHostIp.value = checked;
			},
			onSelect: (event: Event) => event.preventDefault()
		}
	]]);

	/**
	 * 运行控制（启动 / 停止 / 重启 / 重建）自 W10 起常驻左侧设备栏顶部，模板里一条动作只有
	 * 一个入口：禁用条件与运行态同源（读不到 `null` 时全不给点），重建要 `create` + `delete`
	 * 双能力位且弹窗逐字输入网络 ID（BFF 侧同一值是硬闸门）。
	 */

	/** 抓包态徽章：三态各有文案，未知不是「未抓包」 */
	const snifferStateLabel = computed(() => (snifferActive.value === null
		? t("pages.scenario-simulator.sniffer.stateUnknown")
		: t(snifferActive.value
			? "pages.scenario-simulator.sniffer.stateOn"
			: "pages.scenario-simulator.sniffer.stateOff")));

	/**
	 * 「工具」菜单（NMCPS-ADR-0022 W5）：开始 / 停止 / 下载。
	 *
	 * 禁用条件与读数同源：抓包要网络在跑（上游 `sniffer_start` 对未启动回 400），
	 * 所以 `runState !== true` 时「开始」不给点；读数未知时启停都不给点，只留下载
	 * （已录到的文件与「现在是否在录」无关）。
	 */
	const toolsMenuItems = computed<DropdownMenuItem[][]>(() => [[
		{
			label: t("pages.scenario-simulator.menu.sniffStart"),
			icon: "carbon:play",
			disabled: snifferBusy.value || snifferActive.value !== false || runState.value !== true,
			onSelect: () => void startSniffer()
		},
		{
			label: t("pages.scenario-simulator.menu.sniffStop"),
			icon: "carbon:stop",
			disabled: snifferBusy.value || snifferActive.value !== true,
			onSelect: () => void stopSniffer()
		},
		{
			label: t("pages.scenario-simulator.menu.sniffDownload"),
			icon: "carbon:download",
			disabled: snifferBusy.value,
			onSelect: () => void downloadCapture()
		}
	]]);

	/** iperf 的两端只能是 host：上游对非 host 节点回 400，页面先不给选 */
	const hostItems = computed(() => nodes.value
		.filter((item) => item.kind === "host")
		.map((item) => ({ label: item.positioned.id, value: item.positioned.id })));
	const iperfL4Items = computed(() => LAB_IPERF_L4_TYPES.map((value) => ({ label: value, value })));

	/** 用户一动 iperf 草稿就撤掉上一次的就地报错 */
	watch(iperfDraft, () => {
		iperfError.value = undefined;
	}, { deep: true });

	/** 右栏面板折叠态（复刻 1.0 侧栏的收起，NMCPS-ADR-0022 W7）：收起只收宽度，不动画布 */
	const panelOpen = ref(true);
	/** 正在从右侧节点面板拖出来的类型（`null` = 没在拖）：画布的投放提示与 `drop` 都看它 */
	const dragKind = ref<NodeKind | null>(null);
	/** 投放落点（上游 `x` / `y`）：非空时新增表单用它代替默认落点 */
	const dropOrigin = ref<LabNodeOrigin | null>(null);

	/** 新节点的默认落点：按已有节点数错开，避免叠在原点（上游 `x` / `y` 口径） */
	const defaultOrigin = computed<LabNodeOrigin>(() => ({
		x: 120 + (nodes.value.length % 5) * 140,
		y: 120 + Math.floor(nodes.value.length / 5) * 130
	}));

	/** 表单实际用的落点：拖拽投放给的那一个优先，否则回落到默认落点 */
	const createOrigin = computed<LabNodeOrigin>(() => dropOrigin.value ?? defaultOrigin.value);

	/** 拖拽进行中的提示句（画布只显示，文案归页面） */
	const dropHint = computed(() => (dragKind.value
		? t("pages.scenario-simulator.canvasDropHint", {
			kind: t(`pages.scenario-simulator.kinds.${dragKind.value}`)
		})
		: ""));

	/** 连线目标：除自己以外的全部节点（同一对节点重复连线由上游 400 拦） */
	const linkTargetItems = computed(() => nodeIds.value
		.filter((id) => id !== selectedId.value)
		.map((id) => ({ label: id, value: id })));

	/** OpenFlow 下拉：`auto` = 跟随上游默认（上游把 `auto` 归一成 `null`） */
	const openflowItems = computed(() => [
		{ label: t("pages.scenario-simulator.edit.openflowAuto"), value: "auto" },
		...LAB_OPENFLOW_VERSIONS.map((value) => ({ label: value, value }))
	]);
	const openflowValue = computed(() => selectedNode.value?.raw.of_version || "auto");

	function messageOf(value: unknown): string {
		return value instanceof Error ? value.message : String(value);
	}

	function asRecord(value: unknown): Record<string, unknown> | undefined {
		return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
	}

	function rawNodesOf(payload: unknown, kind: NodeKind): RawMininetNode[] {
		const list: RawMininetNode[] = [];
		if (Array.isArray(payload)) {
			for (const item of payload) {
				const record = asRecord(item);
				if (record)
					list.push({ ...record as RawMininetNode, type: kind });
			}
			return list;
		}

		const record = asRecord(payload);
		if (!record)
			return list;
		for (const [key, item] of Object.entries(record)) {
			const value = asRecord(item);
			if (!value)
				continue;
			list.push({
				...value as RawMininetNode,
				name: typeof value.name === "string" ? value.name : key,
				type: kind
			});
		}
		return list;
	}

	function rawLinksOf(payload: unknown): TopologyGraphLink[] {
		if (!Array.isArray(payload))
			return [];
		return payload.flatMap((item) => {
			const record = asRecord(item);
			const source = typeof record?.from === "string" ? record.from : undefined;
			const target = typeof record?.to === "string" ? record.to : undefined;
			if (!source || !target)
				return [];
			return [{
				source,
				target,
				status: "online",
				linkType: "ethernet"
			} satisfies TopologyGraphLink];
		});
	}

	function roleOf(kind: NodeKind): TopologyNodeRole {
		if (kind === "switch")
			return "access";
		if (kind === "host")
			return "terminal";
		return "core";
	}

	function coordinate(value: unknown, fallback: number): number {
		return typeof value === "number" && Number.isFinite(value) ? value : fallback;
	}

	function buildGraph(rawNodes: RawMininetNode[], rawLinks: TopologyGraphLink[]): void {
		const seen = new Set<string>();
		const unique = rawNodes.filter((node) => {
			const key = node.name ?? node.id;
			if (!key || seen.has(key))
				return false;
			seen.add(key);
			return true;
		});

		const layoutNodes: GraphNode[] = [];
		const usedIds = new Set<string>();
		const columns = Math.max(1, Math.ceil(Math.sqrt(unique.length)));
		const xs = unique.map((node) => node.x).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
		const ys = unique.map((node) => node.y).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
		const hasSpread = xs.length > 0 && ys.length > 0
			&& (Math.max(...xs) - Math.min(...xs) > 1 || Math.max(...ys) - Math.min(...ys) > 1);
		const minX = hasSpread ? Math.min(...xs) : 0;
		const minY = hasSpread ? Math.min(...ys) : 0;

		for (const [index, raw] of unique.entries()) {
			const label = raw.label || raw.name || raw.id || `node-${index + 1}`;
			const kind = (raw.type ?? "host") as NodeKind;
			let id = raw.name || raw.id || label;
			if (usedIds.has(id))
				id = `${id}-${index}`;
			usedIds.add(id);

			const role = roleOf(kind);
			const graphNode: TopologyGraphNode = {
				id,
				name: label,
				label,
				ip: raw.ip,
				category: kind === "host" ? "client" : "network-device",
				type: kind,
				status: "online"
			};
			const x = hasSpread ? coordinate(raw.x, 0) - minX + 80 : 80 + (index % columns) * 160;
			const y = hasSpread ? coordinate(raw.y, 0) - minY + 80 : 80 + Math.floor(index / columns) * 140;

			layoutNodes.push({
				key: label,
				kind,
				raw,
				positioned: {
					node: graphNode,
					id,
					label,
					labelShift: 0,
					labelDirDx: 0,
					labelDirDy: 1,
					tier: role === "terminal" ? 4 : role === "core" ? 1 : 3,
					rank: role === "terminal" ? 2 : role === "core" ? 0 : 1,
					role,
					x,
					y
				}
			});
		}

		const ids = new Set(layoutNodes.map((item) => item.positioned.id));
		nodes.value = layoutNodes;
		graphLinks.value = rawLinks.filter((link) => ids.has(link.source) && ids.has(link.target));
		canvasWidth.value = Math.max(720, ...layoutNodes.map((item) => item.positioned.x + 120));
		canvasHeight.value = Math.max(480, ...layoutNodes.map((item) => item.positioned.y + 100));

		if (selectedId.value && !ids.has(selectedId.value))
			selectedId.value = null;
	}

	function resetGraph(): void {
		nodes.value = [];
		graphLinks.value = [];
		selectedId.value = null;
		selectedLinkKey.value = null;
	}

	async function load(): Promise<void> {
		loading.value = true;
		error.value = null;
		// 刷新成功就把上一次的运行控制失败撤掉：错误原文只在「刚失败」时有意义，
		// 留到刷新之后会指向一个已经不存在的结果
		runError.value = undefined;

		try {
			// 能力位、台账与运行态并行取：通道读不到（未配置 / 主上游故障）时降级为只读，不影响看拓扑
			const [networkResult, channelResult, runResult] = await Promise.allSettled([
				api.get<LabNetworkSummary[]>("/api/lab/networks"),
				api.get<MininetChannelInfo>("/api/lab/channel"),
				api.get<unknown>("/api/lab/start")
			]);

			capabilities.value = channelResult.status === "fulfilled" ? channelResult.value.capabilities : null;
			// 运行态读不到就是「未知」（null），不假设没启动 —— 见 runState 的注释
			runState.value = runResult.status === "fulfilled" ? labRunStateOf(runResult.value) : null;

			// 抓包态只在有 `lab:sniffer` 时读：没有权限时上游必回 403，白跑一趟还会在日志里留噪声。
			// 读失败保持 `null`（未知），不回落成 `false`
			snifferActive.value = canSniff.value
				? await api.get<unknown>("/api/lab/sniffer/state")
					.then((payload) => labSnifferActiveOf(payload))
					.catch(() => null)
				: null;

			// 实时包列表先回填历史（`GET /api/lab/sniffer/history`，`lab:read`）：
			// 读不到只让列表空着，不影响拓扑与运行态
			if (canSniff.value)
				await loadSnifferHistory();

			if (networkResult.status === "rejected")
				throw networkResult.reason;

			networks.value = networkResult.value;
			if (!networks.value.length) {
				resetGraph();
				return;
			}

			const requests: Array<{ kind: NodeKind, path: string }> = [
				{ kind: "host", path: "/api/lab/hosts" },
				{ kind: "switch", path: "/api/lab/switches" },
				{ kind: "router", path: "/api/lab/routers" },
				{ kind: "nat", path: "/api/lab/nats" },
				{ kind: "controller", path: "/api/lab/controllers" }
			];

			const [nodeResults, linkResult] = await Promise.all([
				Promise.allSettled(requests.map((item) => api.get<unknown>(item.path))),
				Promise.allSettled([api.get<unknown>("/api/lab/links")])
			]);

			const rawNodes: RawMininetNode[] = [];
			const failures: unknown[] = [];
			for (const [index, result] of nodeResults.entries()) {
				if (result.status === "fulfilled")
					rawNodes.push(...rawNodesOf(result.value, requests[index]!.kind));
				else
					failures.push(result.reason);
			}

			const linkOutcome = linkResult[0]!;
			if (linkOutcome.status === "rejected")
				failures.push(linkOutcome.reason);

			if (!rawNodes.length && failures.length)
				throw failures[0];

			// 链路属性（W13）：链路详情的事实来源，读不到就是空表（不编默认值）
			labLinkOptions.value = linkOutcome.status === "fulfilled" ? linkOptionsOf(linkOutcome.value) : {};

			buildGraph(
				rawNodes,
				linkOutcome.status === "fulfilled" ? rawLinksOf(linkOutcome.value) : []
			);
		} catch (caught) {
			resetGraph();
			error.value = messageOf(caught);
		} finally {
			loading.value = false;
		}
	}

	function selectNode(id: string): void {
		selectedId.value = id;
		selectedLinkKey.value = null;
		linkTarget.value = undefined;

		const node = nodes.value.find((item) => item.positioned.id === id);
		if (node?.kind === "switch")
			void loadFlows(id);
		else
			clearFlows();
	}

	function selectLink(key: string): void {
		selectedLinkKey.value = key;
		selectedId.value = null;
		linkTarget.value = undefined;
		clearFlows();
	}

	/* ── 右键菜单与双击详情（NMCPS-ADR-0022 W12 / W13）──────────────────────── */

	/** 画布上报的右键命中：节点 id 或 `null`（空白 / 链路） */
	function onCanvasContextMenu(target: { id: string | null }): void {
		nodeMenuId.value = target.id;
	}

	/** 双击节点 / 链路：直接开详情，连右栏的选中态一起切过去 */
	function onCanvasActivate(target: { kind: "node", id: string } | { kind: "link", key: string }): void {
		if (target.kind === "node") {
			openNodeDetail(target.id);
			return;
		}
		openLinkDetail(target.key);
	}

	function openNodeDetail(id: string): void {
		selectNode(id);
		detailError.value = undefined;
		nodeDetailId.value = id;
		nodeDetailOpen.value = true;
	}

	function openLinkDetail(key: string): void {
		selectLink(key);
		detailError.value = undefined;
		linkDetailKey.value = key;
		linkDetailOpen.value = true;
	}

	/**
	 * 右键「打开 Webshell」：切到右栏的 Webshell 标签，再让观测组件开一条会话。
	 * 不在这里直接建 socket —— 终端只有一份实现（`useLabTerminalSessions()`）。
	 */
	function openWebshellForNode(id: string): void {
		if (!canTerminal.value)
			return;
		panelOpen.value = true;
		sideTab.value = "webshell";
		void nextTick(() => networkToolsRef.value?.openTerminalFor?.(id));
	}

	/** 主机 / 路由器保存：成功后关弹窗并重读台账（不本地改一份「应该长什么样」） */
	async function saveNodeDetail(kind: "host" | "router", payload: Record<string, unknown>): Promise<void> {
		const id = nodeDetailId.value;
		if (!id || !canOperate.value)
			return;
		detailSubmitting.value = true;
		detailError.value = undefined;
		try {
			const collection = kind === "host" ? "hosts" : "routers";
			await api.patch<unknown>(`/api/lab/${collection}/${encodeURIComponent(id)}`, payload);
			nodeDetailOpen.value = false;
			toast.add({ title: t("pages.scenario-simulator.nodeDetail.saved"), color: "success" });
			await load();
		} catch (caught) {
			detailError.value = messageOf(caught);
		} finally {
			detailSubmitting.value = false;
		}
	}

	/** 链路保存：`PUT /links` 只带填过的属性（全空时组件根本不发） */
	async function saveLinkDetail(payload: { src: string, dst: string, options: Record<string, unknown> }): Promise<void> {
		if (!canOperate.value)
			return;
		detailSubmitting.value = true;
		detailError.value = undefined;
		try {
			await api.put<unknown>("/api/lab/links", payload);
			linkDetailOpen.value = false;
			toast.add({ title: t("pages.scenario-simulator.linkDetail.saved"), color: "success" });
			await load();
		} catch (caught) {
			detailError.value = messageOf(caught);
		} finally {
			detailSubmitting.value = false;
		}
	}

	/** `GET /links` 的 `options` 收成 `from|to` 索引（两个方向都登记，链路方向由台账决定） */
	function linkOptionsOf(payload: unknown): Record<string, Record<string, unknown>> {
		const map: Record<string, Record<string, unknown>> = {};
		if (!Array.isArray(payload))
			return map;
		for (const item of payload) {
			const record = asRecord(item);
			const from = typeof record?.from === "string" ? record.from : undefined;
			const to = typeof record?.to === "string" ? record.to : undefined;
			if (!from || !to)
				continue;
			const options = asRecord(record?.options) ?? {};
			map[`${from}|${to}`] = options;
			map[`${to}|${from}`] ??= options;
		}
		return map;
	}

	function linkTitle(link: TopologyGraphLink): string {
		return `${link.source} ↔ ${link.target}`;
	}

	/* ── 写操作（NMCPS-ADR-0022 W2）──────────────────────────────────────────
	 * 全部走 `/api/lab/**`：权限位、审计、串行化锁、台账归属都在 BFF，
	 * 页面只做「发什么 + 失败原话回显」。成功后统一 `load()`，让画布回到台账事实，
	 * 不在前端自己算一份「应该长什么样」。
	 */

	/**
	 * 打开新增表单。`origin` 只在**拖拽投放**时给：落点由用户在画布上选，
	 * 不给则用 `defaultOrigin`（按已有节点数错开）。
	 */
	function openCreate(kind: NodeKind, origin?: LabNodeOrigin): void {
		actionError.value = undefined;
		dropOrigin.value = origin ?? null;
		createKind.value = kind;
		createOpen.value = true;
	}

	/** 右侧面板里点一下类型：等同「新增这类节点」，落点回落到默认值 */
	function pickKind(kind: NodeKind): void {
		openCreate(kind);
	}

	/** 拖拽携带的类型标识：跨窗口 / 跨页面时才有人读，本页只信自己的 `dragKind` */
	const DRAG_KIND_MIME = "application/x-lab-node-kind";

	function onPaletteDragStart(event: DragEvent, kind: NodeKind): void {
		actionError.value = undefined;
		dragKind.value = kind;
		const data = event.dataTransfer;
		if (!data)
			return;
		data.effectAllowed = "copy";
		data.setData(DRAG_KIND_MIME, kind);
		data.setData("text/plain", kind);
		/*
		 * 拖影只带图标（W11）：默认快照是整个按钮 —— 悬停底色、按钮的圆角方块一起被复制，
		 * 拖动过程中手上就是一个灰方块。把画出来的那枚图标当拖影，指针落在图标中心；
		 * 取不到（异常渲染）时保持浏览器默认。
		 */
		const icon = (event.currentTarget as HTMLElement | null)?.querySelector(".iconify, svg");
		if (icon)
			data.setDragImage(icon as Element, 12, 12);
	}

	/** 拖拽结束（含用户中途放弃）：`drop` 之后也会补一次，重复置空无害 */
	function onPaletteDragEnd(): void {
		dragKind.value = null;
	}

	/**
	 * 画布落点（**图坐标**）→ 上游 `x` / `y`。
	 *
	 * 不能把图坐标直接当台账坐标：`buildGraph()` 对台账坐标做过平移 / 网格归一，两边差一个固定偏移。
	 * 台账里每个节点都带着真实坐标，所以拿**离落点最近的节点**当锚点解平移：
	 * `raw = anchor.raw + (落点 - anchor.display)`；全部节点共用同一仿射时这就是精确反解，
	 * 台账没有坐标（画布是合成网格）时也至少让新节点落在放手的位置旁边，而不是钉在原点。
	 */
	function labNodeOriginAt(point: { x: number, y: number }): LabNodeOrigin {
		let anchor: GraphNode | null = null;
		let nearest = Number.POSITIVE_INFINITY;
		for (const item of nodes.value) {
			const dx = item.positioned.x - point.x;
			const dy = item.positioned.y - point.y;
			const distance = dx * dx + dy * dy;
			if (distance < nearest) {
				nearest = distance;
				anchor = item;
			}
		}
		if (!anchor)
			return { ...defaultOrigin.value };
		return {
			x: Math.round(coordinate(anchor.raw.x, anchor.positioned.x) + point.x - anchor.positioned.x),
			y: Math.round(coordinate(anchor.raw.y, anchor.positioned.y) + point.y - anchor.positioned.y)
		};
	}

	/**
	 * 投放：只到「打开表单」这一步 —— 节点仍然由用户确认后 `POST /api/lab/<collection>`，
	 * 名称 / IP 校验与请求体组装仍走 `NodeFormModal` 那一条路径（不写第二份）。
	 */
	function onCanvasDrop(point: { x: number, y: number }): void {
		const kind = dragKind.value;
		dragKind.value = null;
		if (!kind || !canCreate.value)
			return;
		openCreate(kind, labNodeOriginAt(point));
	}

	async function createNode(payload: Record<string, unknown>): Promise<void> {
		const kind = createKind.value;
		if (!kind || acting.value)
			return;

		acting.value = true;
		actionError.value = undefined;

		try {
			await api.post(LAB_NODE_COLLECTIONS[kind], nodePayloadWithPreferences(kind, payload));
			toast.add({ title: t("pages.scenario-simulator.edit.created", { id: String(payload.name ?? payload.id) }), color: "success" });
			createOpen.value = false;
			createKind.value = null;
			dropOrigin.value = null;
			await load();
		} catch (caught) {
			actionError.value = messageOf(caught);
		} finally {
			acting.value = false;
		}
	}

	/**
	 * 把「设置」里的默认值并进节点请求体：交换机带上 `of_version`（`"auto"` → `null`，
	 * 上游按默认处理）。`switch_type` 仍以表单里的选择为准 —— 表单是「这一次」的决定，
	 * 设置只是默认值。其他类型原样返回。
	 */
	function nodePayloadWithPreferences(kind: NodeKind, payload: Record<string, unknown>): Record<string, unknown> {
		if (kind !== "switch")
			return payload;
		return { ...payload, of_version: labPreferencesOpenflow(preferences.value) };
	}

	/* ── 生成拓扑（复刻旧 `Side.vue`「生成拓扑」+ `TopologyForm.vue`，NMCPS-ADR-0022 §六）──
	 * 表单只收参数（形状 / 数量 / 控制器），计划由 `labGeneratePlan()` 纯函数给出；
	 * 这里负责**串行**发请求（上游单网络只允许一个在途写操作，D5）并重读台账。
	 * 不做回滚：上游没有事务，已建的节点就是既成事实 —— 把「建到哪一步」原话告诉用户，
	 * 再让画布回到台账事实，比偷偷删掉一半更可预期。
	 */

	function openGenerate(): void {
		generateError.value = undefined;
		generateOpen.value = true;
	}

	async function generateTopology(draft: LabGenerateDraft): Promise<void> {
		if (!canCreate.value || generateBusy.value)
			return;

		generateBusy.value = true;
		generateError.value = undefined;

		const linkOptions = labPreferencesLinkOptions(preferences.value);
		const plan = labGeneratePlan(draft, {
			existingIds: nodeIds.value,
			hostSequence: hostSequence.value,
			switchSequence: switchSequence.value,
			switchType: preferences.value.switchType,
			ofVersion: labPreferencesOpenflow(preferences.value),
			linkOptions
		});

		let createdNodes = 0;
		let createdLinks = 0;

		try {
			for (const node of plan.nodes) {
				await api.post(LAB_NODE_COLLECTIONS[node.kind], node.payload);
				createdNodes++;
			}
			for (const link of plan.links) {
				await api.post("/api/lab/links", labGenerateLinkPayloadOf(link, linkOptions));
				createdLinks++;
			}

			generateOpen.value = false;
			toast.add({
				title: t("pages.scenario-simulator.generate.done", { nodes: createdNodes, links: createdLinks }),
				color: "success"
			});
			await load();
		} catch (caught) {
			generateError.value = t("pages.scenario-simulator.generate.partial", {
				nodes: createdNodes,
				links: createdLinks,
				message: messageOf(caught)
			});
			await load();
		} finally {
			generateBusy.value = false;
		}
	}

	/* ── 实验台偏好（「文件 → 设置」）──────────────────────────────────────── */

	/**
	 * 保存偏好：内存 + `localStorage` 双写。
	 *
	 * 存储写失败（隐私模式 / 配额满）只影响「刷新后还记得」，不影响本次生效 ——
	 * 所以这里吞掉异常，不把用户的操作判成失败。
	 */
	function savePreferences(next: LabPreferences): void {
		preferences.value = labPreferencesFrom(next);
		if (!import.meta.client)
			return;
		try {
			localStorage.setItem(LAB_PREFERENCES_KEY, JSON.stringify(preferences.value));
		} catch {
			// 存储不可用：本次仍按新偏好执行，只是下次打开回到缺省值
		}
	}

	if (import.meta.client) {
		try {
			preferences.value = labPreferencesFrom(localStorage.getItem(LAB_PREFERENCES_KEY));
		} catch {
			// 读取失败（隐私模式）：保持缺省偏好
		}
	}

	/* ── 导出（复刻旧「文件」菜单的 PNG / 地址规划）──────────────────────── */

	/** 导出文件名的统一时间戳（`20261119T031500Z`），连续导出不会互相覆盖 */
	function exportStamp(now: Date = new Date()): string {
		return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
	}

	/**
	 * 导出拓扑 PNG（纯前端）：画布 SVG → 内联样式 → `<canvas>` → PNG。
	 *
	 * 不复用 BFF 的导出通道 —— 这条路径渲染的是**用户当前看到的图**（含视图开关的
	 * 过滤结果），与「上游导出的拓扑 JSON」是两件事。
	 */
	async function exportTopologyPng(): Promise<void> {
		const svg = canvasRef.value?.svgElement;
		if (!svg) {
			toast.add({
				title: t("pages.scenario-simulator.export.pngUnavailable"),
				color: "error"
			});
			return;
		}

		try {
			saveBlob(await topologyPngBlobOf(svg), topologyPngFilename());
		} catch (caught) {
			toast.add({
				title: t("pages.scenario-simulator.export.pngFailed"),
				description: messageOf(caught),
				color: "error"
			});
		}
	}

	/**
	 * 导出地址规划（`GET /api/lab/addressing_plan`，`lab:read`）。
	 *
	 * 旧版用 jsPDF + autoTable 排成 PDF；2.0 不引入新的前端依赖，落成同名 JSON，
	 * 字段仍是上游返回的原文（节点 / 接口 / MAC / IPv4 / IPv6），不在这里裁剪。
	 */
	async function exportAddressingPlan(): Promise<void> {
		try {
			const plan = await api.get<unknown>("/api/lab/addressing_plan");
			saveBlob(
				new Blob([`${JSON.stringify(plan, null, 2)}\n`], { type: "application/json" }),
				`lab-addressing-${exportStamp()}.json`
			);
		} catch (caught) {
			toast.add({
				title: t("pages.scenario-simulator.export.failed"),
				description: messageOf(caught),
				color: "error"
			});
		}
	}

	function askRemoveNode(): void {
		if (!selectedNode.value)
			return;
		actionError.value = undefined;
		removeTarget.value = { kind: "node", id: selectedNode.value.positioned.id };
		removeOpen.value = true;
	}

	function askRemoveLink(): void {
		if (!selectedLink.value)
			return;
		actionError.value = undefined;
		removeTarget.value = { kind: "link", source: selectedLink.value.source, target: selectedLink.value.target };
		removeOpen.value = true;
	}

	async function confirmRemove(): Promise<void> {
		const target = removeTarget.value;
		if (!target || acting.value)
			return;

		acting.value = true;
		actionError.value = undefined;

		try {
			if (target.kind === "link") {
				await api.del(`/api/lab/delete_link/${encodeURIComponent(target.source ?? "")}/${encodeURIComponent(target.target ?? "")}`);
			} else if (target.id) {
				await api.del(`/api/lab/delete_node/${encodeURIComponent(target.id)}`);
			}

			removeOpen.value = false;
			removeTarget.value = null;
			await load();
		} catch (caught) {
			actionError.value = messageOf(caught);
		} finally {
			acting.value = false;
		}
	}

	/** 连线：从选中节点连到 `linkTarget`（上游 `LinkCreate` 的 `{src, dst}` 形态） */
	async function createLink(): Promise<void> {
		const source = selectedId.value;
		const target = linkTarget.value;
		if (!source || !target || acting.value)
			return;

		acting.value = true;
		actionError.value = undefined;

		try {
			await api.post("/api/lab/links", labGenerateLinkPayloadOf(
				{ src: source, dst: target },
				labPreferencesLinkOptions(preferences.value)
			));
			toast.add({ title: t("pages.scenario-simulator.edit.linked", { source, target }), color: "success" });
			linkTarget.value = undefined;
			await load();
		} catch (caught) {
			actionError.value = messageOf(caught);
		} finally {
			acting.value = false;
		}
	}

	/**
	 * 拖动落点（`POST /api/lab/node_position`）。
	 *
	 * 画布给的是**相对几何坐标的累计增量**，上游存的是绝对值：把增量加回 `raw.x` / `raw.y`
	 * 即可。画布展示坐标做过「减去 minX + 80」的平移，那是常量偏移，对增量不产生影响。
	 */
	async function onNodeMoved(id: string, offset: { dx: number, dy: number }): Promise<void> {
		const node = nodes.value.find((item) => item.positioned.id === id);
		if (!node || !canOperate.value || acting.value)
			return;

		const x = Math.round(coordinate(node.raw.x, node.positioned.x) + offset.dx);
		const y = Math.round(coordinate(node.raw.y, node.positioned.y) + offset.dy);

		acting.value = true;
		actionError.value = undefined;

		try {
			await api.post("/api/lab/node_position", { node_id: id, position: [x, y] });
			await load();
		} catch (caught) {
			actionError.value = messageOf(caught);
		} finally {
			acting.value = false;
		}
	}

	/** OpenFlow 版本：`auto` 原样发给上游（上游归一成 `null`，即跟随默认） */
	async function applyOpenflow(value: unknown): Promise<void> {
		const id = selectedNode.value?.positioned.id;
		if (!id || !canOperate.value || acting.value)
			return;

		acting.value = true;
		actionError.value = undefined;

		try {
			await api.put(`/api/lab/switches/${encodeURIComponent(id)}/openflow`, { of_version: typeof value === "string" ? value : "auto" });
			await load();
		} catch (caught) {
			actionError.value = messageOf(caught);
		} finally {
			acting.value = false;
		}
	}

	function clearFlows(): void {
		flowText.value = "";
		flowError.value = undefined;
		flowLoading.value = false;
		flowDraft.value = labFlowDraftOf();
		flowDraftError.value = undefined;
		// 清流弹窗绑的是「当前选中的交换机」：换目标就关掉并丢弃条件，不给误点留窗口
		clearFlowsOpen.value = false;
		clearFlowsMatch.value = "";
		clearFlowsMatchError.value = undefined;
		clearFlowsError.value = undefined;
	}

	/**
	 * 流表读数（`GET /api/lab/flows/{switch}`）：上游回 `ovs-ofctl dump-flows` 原文。
	 * 未启动网络时上游回 400，原话照实显示 —— 「没启动」和「没有流」不是同一件事。
	 */
	async function loadFlows(id: string): Promise<void> {
		clearFlows();
		flowLoading.value = true;

		try {
			const result = await api.get<{ switch?: string, flows?: string }>(`/api/lab/flows/${encodeURIComponent(id)}`);
			flowText.value = typeof result?.flows === "string" ? result.flows : "";
		} catch (caught) {
			flowError.value = messageOf(caught);
		} finally {
			flowLoading.value = false;
		}
	}

	/** 手动重读（`lab:operate`）：流表会被 `pingall` / 控制器改写，页面不能假设它静止 */
	function reloadFlows(): void {
		const id = selectedNode.value?.positioned.id;
		if (id)
			void loadFlows(id);
	}

	/**
	 * 加流（`POST /api/lab/flows`，`lab:operate`）：校验在本地先拦一道，
	 * 真正的合法性交给上游 `ovs-ofctl add-flow`（失败回 400，原话照实显示）。
	 */
	async function addFlow(): Promise<void> {
		const id = selectedNode.value?.positioned.id;
		if (!id || !canOperate.value || acting.value)
			return;

		const invalid = labFlowDraftError(flowDraft.value);
		flowDraftError.value = invalid;
		if (invalid)
			return;

		acting.value = true;
		actionError.value = undefined;

		try {
			await api.post("/api/lab/flows", labFlowPayloadOf(id, flowDraft.value));
			toast.add({ title: t("pages.scenario-simulator.flows.created", { id }), color: "success" });
			await loadFlows(id);
		} catch (caught) {
			actionError.value = messageOf(caught);
		} finally {
			acting.value = false;
		}
	}

	/**
	 * 删单条流（`DELETE /api/lab/flows/{switch}/{flow_id}`，`lab:operate`）。
	 * `flow_id` 是上游按「含 `actions=` 的行」数的 1 基序号 —— 见 `labFlowRowsOf()`。
	 */
	async function removeFlow(flowId: number): Promise<void> {
		const id = selectedNode.value?.positioned.id;
		if (!id || !canOperate.value || acting.value)
			return;

		acting.value = true;
		actionError.value = undefined;

		try {
			await api.del(`/api/lab/flows/${encodeURIComponent(id)}/${flowId}`);
			toast.add({ title: t("pages.scenario-simulator.flows.removed", { id: flowId, switch: id }), color: "success" });
			await loadFlows(id);
		} catch (caught) {
			actionError.value = messageOf(caught);
		} finally {
			acting.value = false;
		}
	}

	/**
	 * 清流（`DELETE /api/lab/flows`，`lab:operate`）：匹配域留空 = 清整表，
	 * 填了只删命中项（上游 `del-flows` 语义）。本地只拦「夹带 `actions=`」一条，
	 * 其余判定交给上游 —— 失败原话照实显示在弹窗里。
	 */
	function openClearFlows(): void {
		clearFlowsMatch.value = "";
		clearFlowsMatchError.value = undefined;
		clearFlowsError.value = undefined;
		clearFlowsOpen.value = true;
	}

	/** 用户一动匹配域就撤掉上一次的就地报错（留着会指向改过的值） */
	watch(clearFlowsMatch, () => {
		clearFlowsMatchError.value = undefined;
	});

	async function submitClearFlows(): Promise<void> {
		const id = selectedNode.value?.positioned.id;
		if (!id || !canOperate.value || acting.value)
			return;

		const invalid = labFlowClearError(clearFlowsMatch.value);
		clearFlowsMatchError.value = invalid ? t(`pages.scenario-simulator.flows.errors.${invalid}`) : undefined;
		if (invalid)
			return;

		const match = labFlowClearMatchOf(clearFlowsMatch.value);

		acting.value = true;
		clearFlowsError.value = undefined;

		try {
			await api.del("/api/lab/flows", labFlowClearPayloadOf(id, match));
			clearFlowsOpen.value = false;
			toast.add({
				title: match
					? t("pages.scenario-simulator.flows.clearedMatch", { id, match })
					: t("pages.scenario-simulator.flows.cleared", { id }),
				color: "success"
			});
			await loadFlows(id);
		} catch (caught) {
			// 弹窗不关：失败原话要留在用户眼前，否则「点了没反应」和「删成功了」分不清
			clearFlowsError.value = messageOf(caught);
		} finally {
			acting.value = false;
		}
	}

	/* ── 运行控制（NMCPS-ADR-0022 W3）────────────────────────────────────────
	 * `start` 归 `lab:create`（它在建网），`stop` / `pingall` / `iperf` 归 `lab:operate`。
	 * 四个动作互斥：上游是**单实例** `app.net`，并发只会拿到 409。成功后统一 `load()`
	 * 重读台账与运行态 —— 运行态由上游说了算，页面不自己改 `runState`。
	 */

	/** 启动（`POST /api/lab/start`）：建网并启动全部节点；已在运行时上游回 400 */
	async function startNetwork(): Promise<void> {
		if (!canCreate.value || runBusy.value)
			return;

		runAction.value = "start";
		runError.value = undefined;

		try {
			await api.post("/api/lab/start");
			toast.add({ title: t("pages.scenario-simulator.run.started"), color: "success" });
			await load();
		} catch (caught) {
			runError.value = messageOf(caught);
		} finally {
			runAction.value = null;
		}
	}

	function askStopNetwork(): void {
		stopIntent.value = "stop";
		runError.value = undefined;
		stopError.value = undefined;
		stopOpen.value = true;
	}

	/** 重启也走同一个确认弹窗：它的第一步就是 `POST /stop`，后果与停止一模一样 */
	function askRestartNetwork(): void {
		stopIntent.value = "restart";
		runError.value = undefined;
		stopError.value = undefined;
		stopOpen.value = true;
	}

	/** 确认弹窗的落点：这次确认的是停止还是重启 */
	function confirmStopIntent(): void {
		if (stopIntent.value === "restart")
			void restartNetwork();
		else
			void stopNetwork();
	}

	/** 打开重建确认：先把上一次的失败原话清掉，否则新弹窗一开就顶着旧错误 */
	function askResetNetwork(): void {
		if (!canCreate.value || !canDelete.value || runBusy.value)
			return;

		resetError.value = undefined;
		resetOpen.value = true;
	}

	/**
	 * 破坏性重建（`POST /api/lab/full_reset`，W5）：清空全部节点 / 链路 / 流表。
	 *
	 * `confirm` 由弹窗逐字输入后回传，BFF 用它和台账 `network_id` 比对（不符即 400
	 * `lab_confirm_required`，不触达上游）。成功后重读台账 —— 画布必须回到「空网」这一
	 * 上游事实，而不是本地把节点数组清掉就算完（`GET /hosts` 才是事实源）。
	 */
	async function resetNetwork(confirm: string): Promise<void> {
		if (!canCreate.value || !canDelete.value || runBusy.value)
			return;

		runAction.value = "reset";
		runError.value = undefined;
		resetError.value = undefined;

		try {
			await api.post("/api/lab/full_reset", { confirm });
			resetOpen.value = false;
			pingOutput.value = "";
			iperfResult.value = null;
			toast.add({ title: t("pages.scenario-simulator.reset.done"), color: "success" });
			await load();
		} catch (caught) {
			resetError.value = messageOf(caught);
		} finally {
			runAction.value = null;
		}
	}

	/**
	 * 打开对账确认：与重建同一套前置（双能力位），但**不看运行态** ——
	 * 对账只读上游、只改台账，网络跑着也可以把清单对齐。
	 */
	function askReconcile(): void {
		if (!canReconcile.value || reconcileBusy.value)
			return;

		reconcileError.value = undefined;
		reconcileOpen.value = true;
	}

	/**
	 * 台账对账（`POST /api/lab/networks/{id}/sync`，NMCPS-ADR-0023）。
	 *
	 * BFF 读上游五类节点与链路后**整体重写**清单；成功后重读台账，画布随之显示上游事实
	 * （清单外节点不再被出口过滤掉）。`adopted` / `dropped` 是两个差集，用来说明这次
	 * 「多接管了什么、清掉了什么」。
	 */
	async function reconcileNetwork(confirm: string): Promise<void> {
		if (!network.value || !canReconcile.value || reconcileBusy.value)
			return;

		reconcileBusy.value = true;
		reconcileError.value = undefined;

		try {
			const result = await api.post<LabNetworkSyncResult>(
				`/api/lab/networks/${encodeURIComponent(network.value.id)}/sync`,
				{ confirm }
			);
			reconcileOpen.value = false;
			toast.add({
				title: t("pages.scenario-simulator.reconcile.done", {
					nodes: result.nodes.length,
					links: result.links.length
				}),
				description: t("pages.scenario-simulator.reconcile.doneHint", {
					adopted: result.adopted.nodes.length + result.adopted.links.length,
					dropped: result.dropped.nodes.length + result.dropped.links.length
				}),
				color: "success"
			});
			await load();
		} catch (caught) {
			reconcileError.value = messageOf(caught);
		} finally {
			reconcileBusy.value = false;
		}
	}

	/**
	 * 停止（`POST /api/lab/stop`）：上游会终止节点进程、`mn -c`，再按台账重建未启动的拓扑。
	 * 失败时弹窗不关：原话留在眼前，否则「点了没反应」和「停成功了」分不清。
	 */
	async function stopNetwork(): Promise<void> {
		if (!canOperate.value || runBusy.value)
			return;

		runAction.value = "stop";
		runError.value = undefined;
		stopError.value = undefined;

		try {
			await api.post("/api/lab/stop");
			stopOpen.value = false;
			pingOutput.value = "";
			iperfResult.value = null;
			toast.add({ title: t("pages.scenario-simulator.run.stopped"), color: "success" });
			await load();
		} catch (caught) {
			stopError.value = messageOf(caught);
		} finally {
			runAction.value = null;
		}
	}

	/**
	 * 重启 = 停止 + 启动（上游没有 `restart` 端点，1.0 版式也是这两步）。
	 *
	 * 弹窗只确认一次：用户点「重启」时已经看过「会终止全部节点进程」，启动不再二次确认。
	 * 两步都走 `/api/lab/**` 的既有写端点，闸门与串行化由 BFF 负责；停止成功而启动失败时
	 * 停在「已停止」，失败原话留在弹窗里（状态不自己猜，下次刷新以 `GET /start` 为准）。
	 */
	async function restartNetwork(): Promise<void> {
		if (!canCreate.value || !canOperate.value || runBusy.value)
			return;

		runAction.value = "restart";
		runError.value = undefined;
		stopError.value = undefined;

		try {
			await api.post("/api/lab/stop");
			await api.post("/api/lab/start");
			stopOpen.value = false;
			pingOutput.value = "";
			iperfResult.value = null;
			toast.add({ title: t("pages.scenario-simulator.run.restarted"), color: "success" });
			await load();
		} catch (caught) {
			stopError.value = messageOf(caught);
		} finally {
			runAction.value = null;
		}
	}

	/**
	 * 连通性（`POST /api/lab/pingall`）：上游回一整段文本，逐字显示。
	 * 探测会改写流表（控制器下发 / 学习），所以跑完顺手重读当前交换机的流表。
	 */
	async function runPingall(): Promise<void> {
		if (!canOperate.value || runBusy.value)
			return;

		runAction.value = "pingall";
		runError.value = undefined;
		pingOutput.value = "";

		try {
			pingOutput.value = labRunOutputOf(await api.post<unknown>("/api/lab/pingall"));
			toast.add({ title: t("pages.scenario-simulator.run.pinged"), color: "success" });
			if (selectedNode.value?.kind === "switch")
				await loadFlows(selectedNode.value.positioned.id);
		} catch (caught) {
			runError.value = messageOf(caught);
		} finally {
			runAction.value = null;
		}
	}

	/**
	 * 吞吐测试（`POST /api/lab/iperf`）：本地先拦「没选 host / 选成同一台 / 秒数越界」，
	 * 其余（host 不在运行网络里、在途互斥）交给上游，失败原话照实显示。
	 */
	async function runIperf(): Promise<void> {
		if (!canOperate.value || runBusy.value)
			return;

		const invalid = labIperfDraftError(iperfDraft.value);
		iperfError.value = invalid;
		if (invalid)
			return;

		runAction.value = "iperf";
		runError.value = undefined;
		iperfResult.value = null;

		try {
			iperfResult.value = labIperfResultOf(await api.post<unknown>("/api/lab/iperf", labIperfPayloadOf(iperfDraft.value)));
			toast.add({ title: t("pages.scenario-simulator.run.iperfDone"), color: "success" });
		} catch (caught) {
			runError.value = messageOf(caught);
		} finally {
			runAction.value = null;
		}
	}

	/**
	 * 台账 `state` 的显示文案。
	 *
	 * 这是我们**自己**的枚举（`LabNetworkState`，见 `~~/shared/types/lab`），不是上游原文：
	 * 上游只回一个裸布尔（`GET /api/mininet/start`），那个读数是「连通」页的运行态徽章。
	 * 两处都会显示，但真源不同 —— 台账由 BFF 在 `start` / `stop` / `full_reset` 成功后写回
	 * （`markLabNetworkState`），否则网停了、「网络」读数还停在 `running`。
	 */
	const networkStateLabel = computed(() => {
		switch (network.value?.state) {
		case "creating":
			return t("pages.scenario-simulator.network.stateCreating");
		case "running":
			return t("pages.scenario-simulator.network.stateRunning");
		case "stopped":
			return t("pages.scenario-simulator.network.stateStopped");
		case "error":
			return t("pages.scenario-simulator.network.stateError");
		default:
			return "—";
		}
	});

	const statBadges = computed(() => [
		{ key: "network", label: t("pages.scenario-simulator.stats.network"), text: networkStateLabel.value, icon: "carbon:flash" },
		{ key: "nodes", label: t("pages.scenario-simulator.stats.nodes"), text: String(nodes.value.length), icon: "carbon:bare-metal-server" },
		{ key: "links", label: t("pages.scenario-simulator.stats.links"), text: String(graphLinks.value.length), icon: "carbon:link" }
	]);

	const networkRows = computed(() => network.value
		? [
			{ key: "id", label: t("pages.scenario-simulator.network.id"), value: network.value.id },
			{ key: "engine", label: t("pages.scenario-simulator.network.engine"), value: network.value.engine },
			{ key: "state", label: t("pages.scenario-simulator.network.state"), value: networkStateLabel.value },
			{ key: "nodeCount", label: t("pages.scenario-simulator.network.nodeCount"), value: network.value.node_count === null ? "—" : String(network.value.node_count) }
		]
		: []);

	const nodeRows = computed(() => selectedNode.value
		? [
			{ key: "id", label: t("pages.scenario-simulator.detail.id"), value: selectedNode.value.positioned.id },
			{ key: "ip", label: t("pages.scenario-simulator.detail.ip"), value: selectedNode.value.raw.ip || "—" },
			{ key: "mac", label: t("pages.scenario-simulator.detail.mac"), value: selectedNode.value.raw.mac || "—" },
			{ key: "links", label: t("pages.scenario-simulator.detail.links"), value: String(graphLinks.value.filter((link) => link.source === selectedNode.value?.positioned.id || link.target === selectedNode.value?.positioned.id).length) }
		]
		: []);

	onMounted(load);
	// 离开页面必须断流：否则票用完后仍是一条挂着的上游连接（上游按订阅计资源）
	onBeforeUnmount(() => disconnectSnifferStream());
</script>
