<template>
	<!--
		Network Tools（NMCPS-ADR-0022 D6 剩余通道）：Webshell / 日志 / 监控三块观测面。

		一条纪律：**动作入口只有一个**。观察窗（抓包列表、运行读数）留在右栏，这里只放
		需要选中目标（节点 / 接口）的交互面板；没有对应能力位的标签页不渲染，而不是
		渲染出来再让人点出 403。
	-->
	<USlideover
		v-model:open="open"
		:title="$t('pages.scenario-simulator.networkTools.title')"
		:description="$t('pages.scenario-simulator.networkTools.description')"
		:ui="{ content: 'max-w-3xl' }"
	>
		<template #body>
			<div class="space-y-3">
				<UTabs
					v-model="tab"
					data-testid="mininet-network-tools-tabs"
					size="sm"
					:items="tabItems"
					:content="false"
				/>

				<!-- ── Webshell（`lab:terminal`，单独授权） ── -->
				<section v-if="tab === 'webshell'" data-testid="mininet-terminal-panel" class="space-y-2">
					<div class="flex flex-wrap items-end gap-2">
						<UFormField :label="$t('pages.scenario-simulator.networkTools.terminal.node')" class="min-w-40 flex-1">
							<USelect
								v-model="terminalNode"
								data-testid="mininet-terminal-node"
								size="xs"
								class="w-full"
								:items="nodeItems"
								:placeholder="$t('pages.scenario-simulator.networkTools.terminal.nodePlaceholder')"
							/>
						</UFormField>
						<UButton
							data-testid="mininet-terminal-connect"
							size="xs"
							color="primary"
							variant="subtle"
							:icon="terminalLive ? 'carbon:close' : 'carbon:terminal'"
							:label="terminalLive
								? $t('pages.scenario-simulator.networkTools.terminal.disconnect')
								: $t('pages.scenario-simulator.networkTools.terminal.connect')"
							:disabled="!terminalNode"
							@click="toggleTerminal"
						/>
						<UBadge data-testid="mininet-terminal-state" size="sm" variant="subtle" :color="channelColor(terminalStatus)">
							{{ channelLabel(terminalStatus) }}
						</UBadge>
					</div>

					<pre
						ref="terminalBody"
						data-testid="mininet-terminal-output"
						class="max-h-64 min-h-40 overflow-auto rounded bg-(--ui-bg-elevated) p-2 text-[11px] leading-4 whitespace-pre-wrap"
					>{{ terminalDisplay || $t("pages.scenario-simulator.networkTools.terminal.empty") }}</pre>

					<form class="flex items-center gap-2" @submit.prevent="submitCommand">
						<UInput
							v-model="command"
							data-testid="mininet-terminal-input"
							size="xs"
							class="flex-1"
							:disabled="!terminalLive"
							:placeholder="$t('pages.scenario-simulator.networkTools.terminal.commandPlaceholder')"
						/>
						<UButton
							type="submit"
							data-testid="mininet-terminal-send"
							size="xs"
							color="primary"
							icon="carbon:send"
							:disabled="!terminalLive || !command.trim()"
							:label="$t('pages.scenario-simulator.networkTools.terminal.send')"
						/>
						<UButton
							type="button"
							data-testid="mininet-terminal-interrupt"
							size="xs"
							color="warning"
							variant="subtle"
							icon="carbon:stop-filled"
							:disabled="!terminalLive"
							:label="$t('pages.scenario-simulator.networkTools.terminal.interrupt')"
							@click="interruptTerminal"
						/>
						<UButton
							type="button"
							data-testid="mininet-terminal-clear"
							size="xs"
							color="neutral"
							variant="subtle"
							icon="carbon:clean"
							:disabled="!terminalDisplay && !terminalText"
							:label="$t('pages.scenario-simulator.networkTools.terminal.clear')"
							@click="clearTerminalOutput"
						/>
					</form>

					<p v-if="terminalStatus === 'closed'" data-testid="mininet-terminal-closed" class="text-xs text-(--ui-text-muted)">
						{{ $t("pages.scenario-simulator.networkTools.terminal.closedHint") }}
					</p>

					<p v-if="terminalError" data-testid="mininet-terminal-error" class="text-xs text-(--ui-text-error)">
						{{ terminalError }}
					</p>
				</section>

				<!-- ── 上游日志（`lab:read`） ── -->
				<section v-else-if="tab === 'logs'" data-testid="mininet-logs-panel" class="space-y-2">
					<div class="flex items-center justify-between gap-2">
						<p class="text-[11px] text-(--ui-text-muted)">
							{{ $t("pages.scenario-simulator.networkTools.logs.hint") }}
						</p>
						<UBadge data-testid="mininet-logs-state" size="sm" variant="subtle" :color="channelColor(logsStatus)">
							{{ channelLabel(logsStatus) }}
						</UBadge>
					</div>
					<pre
						data-testid="mininet-logs-output"
						class="max-h-64 min-h-40 overflow-auto rounded bg-(--ui-bg-elevated) p-2 text-[11px] leading-4 whitespace-pre-wrap"
					>{{ logsText || $t("pages.scenario-simulator.networkTools.logs.empty") }}</pre>
					<p v-if="logsError" data-testid="mininet-logs-error" class="text-xs text-(--ui-text-error)">
						{{ logsError }}
					</p>
				</section>

				<!-- ── 单接口速率（`lab:read`） ── -->
				<section v-else-if="tab === 'monitor'" data-testid="mininet-monitor-panel" class="space-y-2">
					<div class="flex flex-wrap items-end gap-2">
						<UFormField :label="$t('pages.scenario-simulator.networkTools.monitor.node')" class="min-w-32 flex-1">
							<USelect
								v-model="monitorNode"
								data-testid="mininet-monitor-node"
								size="xs"
								class="w-full"
								:items="nodeItems"
								:placeholder="$t('pages.scenario-simulator.networkTools.monitor.nodePlaceholder')"
							/>
						</UFormField>
						<UFormField :label="$t('pages.scenario-simulator.networkTools.monitor.intf')" class="min-w-32 flex-1">
							<USelect
								v-model="monitorIntf"
								data-testid="mininet-monitor-intf"
								size="xs"
								class="w-full"
								:items="intfItems"
								:disabled="!intfItems.length"
								:placeholder="$t('pages.scenario-simulator.networkTools.monitor.intfPlaceholder')"
							/>
						</UFormField>
						<UButton
							data-testid="mininet-monitor-start"
							size="xs"
							color="primary"
							variant="subtle"
							:icon="monitorLive ? 'carbon:close' : 'carbon:chart-line'"
							:label="monitorLive
								? $t('pages.scenario-simulator.networkTools.monitor.stop')
								: $t('pages.scenario-simulator.networkTools.monitor.start')"
							:disabled="!monitorNode || !monitorIntf"
							@click="toggleMonitor"
						/>
						<UBadge data-testid="mininet-monitor-state" size="sm" variant="subtle" :color="channelColor(monitorStatus)">
							{{ channelLabel(monitorStatus) }}
						</UBadge>
					</div>

					<p v-if="!interfaces.length" data-testid="mininet-monitor-empty-interfaces" class="text-[11px] text-(--ui-text-muted)">
						{{ $t("pages.scenario-simulator.networkTools.monitor.noInterfaces") }}
					</p>

					<ul v-if="monitorSamples.length" data-testid="mininet-monitor-samples" class="max-h-56 divide-y divide-(--ui-border) overflow-auto rounded border border-(--ui-border) text-[11px]">
						<li
							v-for="(sample, index) in monitorSamples"
							:key="`${sample.ts}-${index}`"
							data-testid="mininet-monitor-sample"
							class="flex items-center gap-2 px-2 py-1"
						>
							<span class="shrink-0 font-mono">{{ sample.intf }}</span>
							<span class="shrink-0 text-(--ui-text-muted)">TX {{ formatRate(sample.txGbps) }}</span>
							<span class="shrink-0 text-(--ui-text-muted)">RX {{ formatRate(sample.rxGbps) }}</span>
							<span class="ml-auto shrink-0 text-(--ui-text-muted)">{{ sample.ts }}</span>
						</li>
					</ul>
					<p v-else data-testid="mininet-monitor-empty" class="text-[11px] text-(--ui-text-muted)">
						{{ $t("pages.scenario-simulator.networkTools.monitor.empty") }}
					</p>
					<p v-if="monitorError" data-testid="mininet-monitor-error" class="text-xs text-(--ui-text-error)">
						{{ monitorError }}
					</p>
				</section>
			</div>
		</template>
	</USlideover>
</template>

<script setup lang="ts">
	import type { LabWsChannelStatus } from "#layers/scenario/app/composables/useLabWsChannel";
	import type { LabInterfaceNode } from "#layers/scenario/shared/types/labInterfaces";
	import type { LabMonitorSample } from "#layers/scenario/shared/types/labWs";
	import type { MininetChannelCapabilities } from "#layers/scenario/shared/types/mininet";
	import { labInterfaceNodesOf } from "#layers/scenario/shared/types/labInterfaces";
	import { labMonitorFrameOf, labTerminalTextOf } from "#layers/scenario/shared/types/labWs";

	/**
	 * 动作入口：工具栏「网络工具」按钮（页面唯一入口）。三个面板各自换票建连，
	 * 连接状态与内容都由 `useLabWsChannel()` 管理 —— 组件不碰 `new WebSocket`。
	 */
	const props = defineProps<{
		capabilities: MininetChannelCapabilities | null
		nodes: Array<{ id: string, label: string }>
		selectedId?: string | null
	}>();

	const open = defineModel<boolean>("open", { default: false });

	const api = useApi();
	const { t } = useI18n();

	const {
		text: terminalText,
		status: terminalStatus,
		error: terminalError,
		connect: connectTerminal,
		disconnect: disconnectTerminal,
		clear: clearTerminal,
		send: sendTerminal
	} = useLabWsChannel("terminal");
	const {
		lines: logsLines,
		status: logsStatus,
		error: logsError,
		connect: connectLogs,
		disconnect: disconnectLogs
	} = useLabWsChannel("logs");
	const {
		lines: monitorLines,
		status: monitorStatus,
		error: monitorError,
		connect: connectMonitor,
		disconnect: disconnectMonitor
	} = useLabWsChannel("monitor");

	type ToolTab = "webshell" | "logs" | "monitor";

	const tab = ref<ToolTab>("webshell");
	const command = ref("");
	const terminalBody = ref<HTMLElement | null>(null);
	const terminalNode = ref<string>();
	const monitorNode = ref<string>();
	const monitorIntf = ref<string>();
	const interfaces = ref<LabInterfaceNode[]>([]);
	const monitorSamples = ref<LabMonitorSample[]>([]);

	/** 标签页按能力位裁剪：没有 `lab:terminal` 就没有 Webshell，没有 `lab:read` 就没有日志 / 监控 */
	const tabItems = computed(() => [
		...(props.capabilities?.terminal ? [{ label: t("pages.scenario-simulator.networkTools.tabs.webshell"), value: "webshell" }] : []),
		...(props.capabilities?.read
			? [
				{ label: t("pages.scenario-simulator.networkTools.tabs.logs"), value: "logs" },
				{ label: t("pages.scenario-simulator.networkTools.tabs.monitor"), value: "monitor" }
			]
			: [])
	]);

	/**
	 * 能力位还没到（`null`）时保持「Webshell」这个**稳定缺省**：面板只在能力位加载后才能打开，
	 * 若把空列表回落成「日志」，一打开就会自动建日志流，用户看到的第一个标签取决于请求时序。
	 * 没有 `lab:terminal` 时落到第一项（日志），与标签顺序一致。
	 */
	watch(tabItems, (items) => {
		if (!items.some((item) => item.value === tab.value))
			tab.value = (items[0]?.value as ToolTab | undefined) ?? "webshell";
	}, { immediate: true });

	const nodeItems = computed(() => props.nodes.map((node) => ({ label: node.label, value: node.id })));
	const intfItems = computed(() => interfaces.value
		.find((node) => node.id === monitorNode.value)
		?.intfs
		.map((intf) => ({ label: intf, value: intf })) ?? []);

	const terminalLive = computed(() => terminalStatus.value === "live");
	const monitorLive = computed(() => monitorStatus.value === "live");
	const logsText = computed(() => logsLines.value.join("\n"));
	/** PTY 原文洗成可读文本：剥 ANSI 颜色码 / 退格 / 行内 `\r` 覆盖（`labTerminalTextOf()`） */
	const terminalDisplay = computed(() => labTerminalTextOf(terminalText.value));

	const CHANNEL_COLORS: Record<LabWsChannelStatus, "neutral" | "info" | "success" | "warning" | "error"> = {
		idle: "neutral",
		connecting: "info",
		live: "success",
		closed: "warning",
		error: "error"
	};

	function channelColor(status: LabWsChannelStatus) {
		return CHANNEL_COLORS[status];
	}

	function channelLabel(status: LabWsChannelStatus): string {
		return t(`pages.scenario-simulator.networkTools.state.${status}`);
	}

	function formatRate(value: number | null): string {
		return value === null ? "—" : `${value.toFixed(2)} Gbit/s`;
	}

	/**
	 * 接口清单（`GET /api/lab/interfaces`，`lab:read`）：监控的「节点 → 接口」两栏只从这里来。
	 * 读不到就保持空数组：宁可不给选项，也不让用户手打一个猜出来的接口名。
	 */
	async function loadInterfaces(): Promise<void> {
		try {
			interfaces.value = labInterfaceNodesOf(await api.get<unknown>("/api/lab/interfaces"));
		} catch {
			interfaces.value = [];
		}
	}

	function toggleTerminal(): void {
		if (terminalStatus.value === "live" || terminalStatus.value === "connecting") {
			disconnectTerminal();
			return;
		}
		if (terminalNode.value)
			void connectTerminal(terminalNode.value);
	}

	/** 终端上行按「一整行」发：上游 PTY 需要 `\n` 才会执行，逐键发会把命令卡在缓冲区里 */
	function submitCommand(): void {
		if (!command.value.trim())
			return;
		if (sendTerminal(`${command.value}\n`))
			command.value = "";
	}

	/** `Ctrl-C`（0x03）是 PTY 的中断字节：跑着的命令靠它停，不是发字面量 `^C` */
	function interruptTerminal(): void {
		sendTerminal("\u0003");
	}

	/** 清屏只清浏览器这一侧的转写（连同上一条错误行）：远端屏幕要清得自己敲 `clear` */
	function clearTerminalOutput(): void {
		clearTerminal();
		terminalError.value = undefined;
	}

	function toggleMonitor(): void {
		if (monitorStatus.value === "live" || monitorStatus.value === "connecting") {
			disconnectMonitor();
			return;
		}
		if (!monitorNode.value || !monitorIntf.value)
			return;

		monitorSamples.value = [];
		monitorError.value = undefined;
		void connectMonitor(`${monitorNode.value}:${monitorIntf.value}`);
	}

	/** 选中节点变化时同步到终端 / 监控：右栏选中的就是「要对它做点什么」的那个 */
	watch(() => props.selectedId, (id) => {
		if (id) {
			terminalNode.value = id;
			monitorNode.value = id;
		}
	});

	watch(() => props.nodes, (list) => {
		const first = list[0]?.id;
		if (!terminalNode.value && first)
			terminalNode.value = first;
		if (!monitorNode.value && first)
			monitorNode.value = first;
	}, { immediate: true });

	/** 节点换了就把接口重置到新节点的第一个：留着上一个节点的接口名会连到不存在的目标 */
	watch([monitorNode, intfItems], ([, items]) => {
		if (!items.some((item) => item.value === monitorIntf.value))
			monitorIntf.value = items[0]?.value;
	});

	/** 监控帧：合法采样进列表，上游 `Error: …` 文本进错误行（不把失败显示成「没数据」） */
	watch(monitorLines, (lines) => {
		const last = lines.at(-1);
		if (!last)
			return;
		const frame = labMonitorFrameOf(last);
		if (!frame)
			return;
		if ("error" in frame) {
			monitorError.value = frame.error;
			return;
		}
		monitorSamples.value = [...monitorSamples.value, frame.sample].slice(-30);
	});

	/** 新输出到达就滚到底：PTY 是追加流，不跟着滚就看不到刚敲的那条命令的回显 */
	watch(terminalDisplay, async () => {
		await nextTick();
		const element = terminalBody.value;
		if (element)
			element.scrollTop = element.scrollHeight;
	});

	/**
	 * 面板开合 / 标签切换的连线策略：
	 * - 日志是「打开就看」的观测面：进日志标签自动建连，离开就断；
	 * - 终端与监控有目标选择，必须显式点按钮，切换标签时断开（旧目标不该留在后台）；
	 * - 面板关闭时三条全断，不留没人收的 socket。
	 */
	watch([open, tab], ([isOpen, current]) => {
		if (!isOpen) {
			disconnectLogs();
			disconnectTerminal();
			disconnectMonitor();
			return;
		}

		if (current === "logs")
			void connectLogs();
		else
			disconnectLogs();

		if (current !== "webshell")
			disconnectTerminal();
		if (current !== "monitor")
			disconnectMonitor();
	});

	watch(open, (isOpen) => {
		if (isOpen)
			void loadInterfaces();
	}, { immediate: true });
</script>
