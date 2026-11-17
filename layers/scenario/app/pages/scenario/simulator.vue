<template>
	<div class="flex min-h-0 flex-1 flex-col gap-3 p-3">
		<Teleport to="#app-toolbar-left">
			<div class="flex items-center gap-1">
				<!--
					菜单栏（复刻 1.0 版式的「文件 / 视图 / 运行」三组，NMCPS-ADR-0022 W4）：
					`NetworkGraph.vue` 的顶栏从左到右就是「标题 + 文件 / 视图 / 运行 / 工具 / 帮助」，
					2.0 把工具栏左区交回给页面，菜单栏因此落在刷新 / 新增**之前**。

					「文件」= 导入拓扑 / 导出 JSON / 导出脚本，三项都有端点（W4 的
					`POST /api/lab/import_json` 与 `GET /api/lab/export/{json|script}`），不是占位的灰项；
					「工具 / 帮助」还要 W5（抓包下载）与文档锚点，等它们落地时再补。

					一个动作一个入口：显示类开关从工具栏独立开关收进「视图」，启动 / 停止 / 重启
					从右栏卡片收进「运行」；右栏只留运行态读数与探测结果（NMCPS-ARCH-006 §4）。
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
				<UDropdownMenu :items="runMenuItems" :content="{ align: 'start' }">
					<UButton
						data-testid="mininet-run-menu"
						size="xs"
						color="neutral"
						variant="ghost"
						icon="carbon:play"
						:label="$t('pages.scenario-simulator.menu.run')"
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
				<!--
					Network Tools（NMCPS-ADR-0022 D6）：Webshell / 上游日志 / 单接口速率。
					与「工具」菜单同一套能力位纪律：没有 `lab:terminal` 也没有 `lab:read` 时整块
					入口不渲染；面板内部的标签页再按能力位逐个裁剪（见 `SimulatorNetworkTools`）。
					抓包不在这里重复一份：启停在「工具」菜单、实时包在右栏运行卡片。
				-->
				<UButton
					v-if="canUseNetworkTools"
					data-testid="mininet-network-tools"
					size="xs"
					color="neutral"
					variant="ghost"
					icon="carbon:network-4"
					:label="$t('pages.scenario-simulator.menu.networkTools')"
					@click="networkToolsOpen = true"
				/>
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
					工具栏节点面板（NMCPS-ADR-0022 W2 补强）：五个类型都**可拖**，拖到画布上就落在
					放手的位置；点一下则用默认落点打开同一张表单（校验与请求体只有一份）。

					用 `UPopover` 而不是 `UDropdownMenu`：菜单项按 `menuitem` 语义会在按下时收起，
					原生 HTML5 拖放会把作为拖源的菜单一起拆掉 —— 拖到一半源没了就没有 `drop`。
				-->
				<UPopover v-if="canCreate" v-model:open="paletteOpen" :content="{ align: 'start' }">
					<UButton
						data-testid="mininet-add-menu"
						size="xs"
						color="neutral"
						variant="subtle"
						icon="carbon:add"
						trailing-icon="carbon:chevron-down"
						:label="$t('pages.scenario-simulator.toolbar.add')"
					/>
					<template #content>
						<div data-testid="mininet-add-palette" class="w-64 space-y-1.5 p-2">
							<p class="text-[11px] font-medium text-(--ui-text-highlighted)">
								{{ $t("pages.scenario-simulator.toolbar.addPalette") }}
							</p>
							<p class="text-[11px] leading-4 text-(--ui-text-muted)">
								{{ $t("pages.scenario-simulator.toolbar.addHint") }}
							</p>
							<div class="grid grid-cols-2 gap-1">
								<!--
									拖源是这层 div；按钮上也显式 `draggable` —— 按下的若是表单控件，
									Chrome 只在被按元素自己可拖时才启动拖放，只靠祖先会拖不动。
								-->
								<div
									v-for="kind in LAB_NODE_KINDS"
									:key="kind"
									:data-testid="`mininet-add-kind-${kind}`"
									:data-kind="kind"
									draggable="true"
									class="cursor-grab active:cursor-grabbing"
									@dragstart="onPaletteDragStart($event, kind)"
									@dragend="onPaletteDragEnd"
									@click="pickKind(kind)"
								>
									<UButton
										size="xs"
										color="neutral"
										variant="subtle"
										class="w-full justify-start"
										draggable="true"
										:icon="NODE_KIND_ICONS[kind]"
										:label="$t(`pages.scenario-simulator.kinds.${kind}`)"
									/>
								</div>
							</div>
						</div>
					</template>
				</UPopover>
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
			<div class="relative min-h-[420px] flex-1 overflow-hidden rounded-lg border border-(--ui-border)">
				<GraphTopologyCanvas
					v-if="visibleNodes.length"
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
					:label="$t('pages.scenario-simulator.canvasLabel')"
					@select="selectNode"
					@select-link="selectLink"
					@offset-change="onNodeMoved"
					@canvas-drop="onCanvasDrop"
				/>
				<div v-else class="flex h-full min-h-96 items-center justify-center">
					<p class="text-sm text-(--ui-text-muted)">
						{{ $t("pages.scenario-simulator.empty.topology") }}
					</p>
				</div>
			</div>

			<aside data-testid="mininet-detail" class="flex w-full shrink-0 flex-col gap-3 lg:w-72">
				<!--
					运行控制（NMCPS-ADR-0022 W3）：`start` 要 `lab:create`，`stop` / `pingall` / `iperf` 要 `lab:operate`。

					状态读 `GET /api/lab/start`（上游 `app.net.is_started`）：读不到就写「未知」，**不假设
					「应该没启动」** —— 猜错会让启动按钮对着一个已在跑的网络发请求，再拿 400 当失败。
					按钮的禁用条件跟着运行态走：已启动不给启动、没启动不给停 / 不给跑测试，
					免得把「状态坏了」当成「操作失败」。
				-->
				<div data-testid="mininet-run" class="rounded-lg border border-(--ui-border) p-3">
					<div class="mb-2 flex items-center justify-between gap-2">
						<h2 class="text-sm font-semibold">
							{{ $t("pages.scenario-simulator.run.title") }}
						</h2>
						<UBadge data-testid="mininet-run-state" size="sm" variant="subtle" :color="runStateColor">
							{{ runStateLabel }}
						</UBadge>
					</div>

					<div class="flex flex-wrap items-center gap-1.5">
						<UButton
							v-if="canOperate"
							data-testid="mininet-run-ping"
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

				<div class="rounded-lg border border-(--ui-border) p-3">
					<h2 class="mb-2 text-sm font-semibold">
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

				<div class="rounded-lg border border-(--ui-border) p-3">
					<h2 class="mb-2 text-sm font-semibold">
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
							class="mt-3 w-full justify-center"
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
							class="mt-3 w-full justify-center"
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
			</aside>
		</div>

		<!--
			Network Tools 面板（NMCPS-ADR-0022 D6）：三个观测面各自换票建连，
			关闭面板即断流（`useLabWsChannel()` 的 `onScopeDispose` 兜底）。
		-->
		<SimulatorNetworkTools
			v-model:open="networkToolsOpen"
			:capabilities="capabilities"
			:nodes="networkToolNodes"
			:selected-id="selectedId"
		/>

		<!--
			新增 / 删除的确认层（NMCPS-ADR-0022 W2）：表单与确认都是 `UModal` 原生组件，
			请求由页面发（页面是唯一写入方），组件只负责校验与文案。
		-->
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
	</div>
</template>

<script setup lang="ts">
	import type { DropdownMenuItem } from "@nuxt/ui";
	import type { PositionedTopologyNode } from "~~/app/utils/graph/topologyLayout";
	import type { TopologyNodeRole } from "~~/app/utils/graph/topologyRoleStyle";
	import type { LabNetworkSummary, LabNetworkSyncResult } from "~~/shared/types/lab";
	import type { TopologyGraphLink, TopologyGraphNode } from "~~/shared/types/topology";
	import type { LabFlowDraftError } from "#layers/scenario/shared/types/labFlows";
	import type { LabNodeKind, LabNodeOrigin, LabRemoveTarget } from "#layers/scenario/shared/types/labNodes";
	import type {
		LabIperfDraftError,
		LabIperfResult
	} from "#layers/scenario/shared/types/labRun";
	import type { MininetChannelCapabilities, MininetChannelInfo } from "#layers/scenario/shared/types/mininet";
	import { topologyLinkKey } from "~~/app/utils/graph/topologyNormalize";
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
	import { parseLabImport } from "#layers/scenario/shared/types/labImport";
	import {
		LAB_NODE_COLLECTIONS,
		LAB_NODE_KINDS,
		LAB_OPENFLOW_VERSIONS
	} from "#layers/scenario/shared/types/labNodes";
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

	/**
	 * Network Tools（NMCPS-ADR-0022 D6）：Webshell 要 `lab:terminal`，日志 / 监控只要 `lab:read`。
	 * 三个面板按能力位逐个裁剪，整块入口只在「至少有一块能看」时渲染 —— 未授权时连按钮都不出现。
	 */
	const networkToolsOpen = ref(false);
	const canUseNetworkTools = computed(() => capabilities.value?.terminal === true || capabilities.value?.read === true);
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

	const network = computed(() => networks.value[0] ?? null);
	const positioned = computed(() => nodes.value.map((item) => item.positioned));
	const nodeIds = computed(() => nodes.value.map((item) => item.positioned.id));

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
		}
	], [
		{
			// 对账（NMCPS-ADR-0023）：只改台账清单，双权限 + 逐字确认
			label: t("pages.scenario-simulator.menu.reconcile"),
			icon: "carbon:data-check",
			disabled: !canReconcile.value || reconcileBusy.value,
			onSelect: () => askReconcile()
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
	 * 「运行」菜单：启动 / 停止 / 重启。
	 *
	 * 禁用条件与运行态同源：读不到运行态（`null`）时三个都不给点 —— 不把「未知」
	 * 当成「没启动」（同 W3 的按钮口径）。重启只在**运行中**可点：它的第一步就是停止，
	 * 对一套已经停着的网调 `POST /stop` 只会拿到上游的 400。
	 */
	const runMenuItems = computed<DropdownMenuItem[][]>(() => [[
		{
			label: t("pages.scenario-simulator.run.start"),
			icon: "carbon:play",
			disabled: !canCreate.value || runState.value !== false || runBusy.value,
			onSelect: () => {
				void startNetwork();
			}
		},
		{
			label: t("pages.scenario-simulator.run.stop"),
			icon: "carbon:stop",
			disabled: !canOperate.value || runState.value !== true || runBusy.value,
			onSelect: () => askStopNetwork()
		},
		{
			label: t("pages.scenario-simulator.run.restart"),
			icon: "carbon:restart",
			disabled: !canCreate.value || !canOperate.value || runState.value !== true || runBusy.value,
			onSelect: () => askRestartNetwork()
		}
	], [
		{
			// 破坏性重建（W5）：清空全部节点 / 链路 / 流表，双权限 + 二次确认
			label: t("pages.scenario-simulator.run.reset"),
			icon: "carbon:reset",
			disabled: !canCreate.value || !canDelete.value || runBusy.value,
			onSelect: () => askResetNetwork()
		}
	]]);

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

	/** 节点面板（工具栏 `UPopover`）的开关：点类型即新增，拖类型则先收起再等投放 */
	const paletteOpen = ref(false);
	/** 正在从工具栏拖出来的类型（`null` = 没在拖）：画布的投放提示与 `drop` 都看它 */
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

	/** 面板里点一下类型：等同「新增这类节点」，落点回落到默认值 */
	function pickKind(kind: NodeKind): void {
		paletteOpen.value = false;
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
		paletteOpen.value = false;
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
			await api.post(LAB_NODE_COLLECTIONS[kind], payload);
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
			await api.post("/api/lab/links", { src: source, dst: target });
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

	const statBadges = computed(() => [
		{ key: "network", label: t("pages.scenario-simulator.stats.network"), text: network.value?.state ?? "—", icon: "carbon:flash" },
		{ key: "nodes", label: t("pages.scenario-simulator.stats.nodes"), text: String(nodes.value.length), icon: "carbon:bare-metal-server" },
		{ key: "links", label: t("pages.scenario-simulator.stats.links"), text: String(graphLinks.value.length), icon: "carbon:link" }
	]);

	const networkRows = computed(() => network.value
		? [
			{ key: "id", label: t("pages.scenario-simulator.network.id"), value: network.value.id },
			{ key: "engine", label: t("pages.scenario-simulator.network.engine"), value: network.value.engine },
			{ key: "state", label: t("pages.scenario-simulator.network.state"), value: network.value.state },
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
