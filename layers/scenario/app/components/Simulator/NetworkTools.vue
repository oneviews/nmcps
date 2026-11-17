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
							icon="carbon:terminal"
							:label="$t('pages.scenario-simulator.networkTools.terminal.open')"
							:disabled="!terminalNode"
							@click="openTerminal"
						/>
						<UBadge data-testid="mininet-terminal-state" size="sm" variant="subtle" :color="channelColor(terminalStatus)">
							{{ channelLabel(terminalStatus) }}
						</UBadge>
					</div>

					<!--
						会话标签（复刻 1.0 的「每节点一条终端」）：切换只换视图、不断流，
						标签上的 × 才断那一条 —— 换回来时远端 PTY 还在原处。
					-->
					<div v-if="terminalSessions.length" data-testid="mininet-terminal-sessions" class="flex flex-wrap items-center gap-1">
						<div
							v-for="session in terminalSessions"
							:key="session.target"
							class="flex items-center rounded border border-(--ui-border) pr-0.5"
							:class="session.target === terminalActive ? 'bg-(--ui-bg-muted)' : ''"
						>
							<UButton
								:data-testid="`mininet-terminal-session-${session.target}`"
								size="xs"
								color="neutral"
								variant="ghost"
								class="font-mono"
								:label="nodeLabel(session.target)"
								@click="terminalActive = session.target"
							/>
							<UButton
								:data-testid="`mininet-terminal-session-close-${session.target}`"
								size="xs"
								color="neutral"
								variant="ghost"
								icon="carbon:close"
								:aria-label="$t('pages.scenario-simulator.networkTools.terminal.closeSession', { node: nodeLabel(session.target) })"
								@click="closeTerminal(session.target)"
							/>
						</div>
					</div>

					<!--
						终端本体：可聚焦的观测窗 + 一枚透明的 textarea 收键盘。
						点一下就聚焦；之后逐键上行（回车 `\r`、退格 `0x7f`、方向键走 CSI），
						中文等 IME 输入不进 keydown，由 textarea 的 `input` 事件兜底。
					-->
					<div
						ref="terminalBody"
						data-testid="mininet-terminal-output"
						class="relative max-h-64 min-h-40 overflow-auto rounded bg-(--ui-bg-elevated) p-2 font-mono text-[11px] leading-4 focus:ring-1 focus:ring-(--ui-primary) focus:outline-none"
						tabindex="0"
						@click="focusTerminalKeys"
					>
						<pre class="pointer-events-none whitespace-pre-wrap">{{ terminalDisplay || terminalPlaceholder }}<span v-if="terminalLive" class="text-(--ui-primary)">▍</span></pre>
						<textarea
							ref="terminalKeys"
							data-testid="mininet-terminal-input"
							class="absolute top-0 left-0 h-px w-px resize-none border-0 p-0 opacity-0"
							autocapitalize="off"
							autocomplete="off"
							spellcheck="false"
							:aria-label="$t('pages.scenario-simulator.networkTools.terminal.keysHint')"
							@keydown="onTerminalKeydown"
							@input="onTerminalInput"
						/>
					</div>

					<div class="flex flex-wrap items-center gap-2">
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
							:disabled="!terminalDisplay"
							:label="$t('pages.scenario-simulator.networkTools.terminal.clear')"
							@click="clearTerminalOutput"
						/>
						<p class="text-[11px] text-(--ui-text-muted)">
							{{ $t("pages.scenario-simulator.networkTools.terminal.keysHint") }}
						</p>
					</div>

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
		sessions: terminalSessions,
		active: terminalActive,
		activeSession: terminalSession,
		open: openTerminalSession,
		close: closeTerminalSession,
		closeAll: closeTerminalSessions,
		clear: clearTerminal,
		send: sendTerminal
	} = useLabTerminalSessions();
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
	const terminalBody = ref<HTMLElement | null>(null);
	/** 收键盘的载体：不是输入框（终端里没有「一行输入」），只负责把按键交出去 */
	const terminalKeys = ref<HTMLTextAreaElement | null>(null);
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

	/** 当前标签会话的读数：没有会话就是 `idle`，不继承「上一条已连接」 */
	const terminalStatus = computed<LabWsChannelStatus>(() => terminalSession.value?.status ?? "idle");
	const terminalError = computed(() => terminalSession.value?.error);
	const terminalLive = computed(() => terminalStatus.value === "live");
	/** PTY 原文洗成可读文本：剥 ANSI 颜色码 / 退格 / 行内 `\r` 覆盖（`labTerminalTextOf()`） */
	const terminalDisplay = computed(() => labTerminalTextOf(terminalSession.value?.text ?? ""));
	/** 空窗的两档：还没开会话 vs 会话开着但远端还没吐字（别把「没打开」说成「没输出」） */
	const terminalPlaceholder = computed(() => terminalActive.value
		? t("pages.scenario-simulator.networkTools.terminal.idle")
		: t("pages.scenario-simulator.networkTools.terminal.empty"));
	const monitorLive = computed(() => monitorStatus.value === "live");
	const logsText = computed(() => logsLines.value.join("\n"));

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

	/** 会话标签上的节点名：台账 label 优先，缺了就写 id（不编一个名字） */
	function nodeLabel(id: string): string {
		return props.nodes.find((node) => node.id === id)?.label ?? id;
	}

	/** 工具栏那一个按钮：选中节点的会话没开就开，开着就切过去（不重连，远端 PTY 不丢） */
	function openTerminal(): void {
		if (!terminalNode.value)
			return;
		void openTerminalSession(terminalNode.value).then(() => nextTick(focusTerminalKeys));
	}

	function closeTerminal(target: string): void {
		closeTerminalSession(target);
	}

	/** 点终端 = 聚焦键盘载体：终端里没有「输入框」，按键直接进 PTY */
	function focusTerminalKeys(): void {
		terminalKeys.value?.focus();
	}

	/**
	 * 非可打印键 → PTY 字节。回车是 `\r` 而不是 `\n`（PTY 的行规程只认 `\r`），
	 * 退格是 `0x7f`（DEL），方向键 / Home / End / Delete 走 ANSI CSI。
	 */
	const TERMINAL_KEYS: Record<string, string> = {
		Enter: "\r",
		Backspace: "\u007F",
		Tab: "\t",
		Escape: "\u001B",
		ArrowUp: "\u001B[A",
		ArrowDown: "\u001B[B",
		ArrowRight: "\u001B[C",
		ArrowLeft: "\u001B[D",
		Home: "\u001B[H",
		End: "\u001B[F",
		Delete: "\u001B[3~",
		PageUp: "\u001B[5~",
		PageDown: "\u001B[6~"
	};

	/** 连打字符的攒帧缓冲：一帧一个字母会把一次输入拆成几十帧，PTY 侧没有必要 */
	let keyBuffer = "";
	let keyTarget = "";
	let keyTimer: ReturnType<typeof setTimeout> | undefined;

	function flushTerminalKeys(): void {
		if (keyTimer) {
			clearTimeout(keyTimer);
			keyTimer = undefined;
		}
		const target = keyTarget;
		const text = keyBuffer;
		keyBuffer = "";
		keyTarget = "";
		if (target && text)
			sendTerminal(target, text);
	}

	function queueTerminalKeys(target: string, text: string): void {
		if (keyTarget !== target)
			flushTerminalKeys();
		keyTarget = target;
		keyBuffer += text;
		keyTimer ??= setTimeout(flushTerminalKeys, 8);
	}

	/**
	 * 逐键上行（NMCPS-ADR-0022 W8）：
	 * - 可打印字符随打随发，回显交给 PTY（做本地回显会让一次输入出现两份）；
	 * - `Ctrl+字母` 发 `0x01–0x1A`（`Ctrl-C` 中断、`Ctrl-D` 退出、`Ctrl-L` 清屏），
	 *   不是发字面量 `^C`；`Ctrl-V` 留给浏览器（粘贴由 textarea 的 `input` 事件送出）；
	 * - 控制键与回车先把攒着的字符冲刷掉，按键顺序不会乱。
	 */
	function onTerminalKeydown(event: KeyboardEvent): void {
		const target = terminalActive.value;
		if (!target)
			return;

		if (event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1 && event.key.toLowerCase() !== "v") {
			const code = event.key.toUpperCase().charCodeAt(0);
			if (code >= 64 && code <= 95) {
				event.preventDefault();
				flushTerminalKeys();
				sendTerminal(target, String.fromCharCode(code - 64));
				return;
			}
		}

		if (event.altKey && event.key.length === 1) {
			event.preventDefault();
			flushTerminalKeys();
			sendTerminal(target, `\u001B${event.key}`);
			return;
		}

		// Shift+Tab 是反向补全（CSI Z），不是 `\t`
		const sequence = event.key === "Tab" && event.shiftKey ? "\u001B[Z" : TERMINAL_KEYS[event.key];
		if (sequence !== undefined) {
			event.preventDefault();
			flushTerminalKeys();
			sendTerminal(target, sequence);
			return;
		}

		if (event.key.length === 1 && !event.metaKey) {
			event.preventDefault();
			queueTerminalKeys(target, event.key);
		}
	}

	/** IME（中文等）不进 keydown：textarea 收下后整段发出，随即清空 —— 它只是键盘载体 */
	function onTerminalInput(): void {
		const element = terminalKeys.value;
		const target = terminalActive.value;
		if (!element)
			return;
		const text = element.value;
		element.value = "";
		if (!target || !text)
			return;
		flushTerminalKeys();
		sendTerminal(target, text);
	}

	/** `Ctrl-C`（0x03）是 PTY 的中断字节：跑着的命令靠它停，不是发字面量 `^C` */
	function interruptTerminal(): void {
		const target = terminalActive.value;
		if (!target)
			return;
		flushTerminalKeys();
		sendTerminal(target, "\u0003");
	}

	/** 清屏只清浏览器这一侧的转写：远端屏幕要清得自己敲 `clear` */
	function clearTerminalOutput(): void {
		if (terminalActive.value)
			clearTerminal(terminalActive.value);
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
	 * - WebShell 是**显式多会话**：切到日志 / 监控并不断流（那是用户自己开的会话，
	 *   标签上有 ×），回到标签时把键盘焦点还给终端；面板关闭才全断，不留没人收的 socket；
	 * - 监控只有一个目标：切走就停（留着会继续采样一个看不见的接口）。
	 */
	watch([open, tab], ([isOpen, current]) => {
		if (!isOpen) {
			disconnectLogs();
			closeTerminalSessions();
			disconnectMonitor();
			return;
		}

		if (current === "logs")
			void connectLogs();
		else
			disconnectLogs();

		if (current === "webshell")
			void nextTick(focusTerminalKeys);
		if (current !== "monitor")
			disconnectMonitor();
	});

	watch(open, (isOpen) => {
		if (isOpen)
			void loadInterfaces();
	}, { immediate: true });
</script>
