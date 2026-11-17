// layers/scenario/app/composables/useLabWsChannel.ts
// `/lab-ws/*` 的通用页面侧通道（NMCPS-ADR-0022 D6）：Webshell / 日志 / 监控共用。
//
// 三条纪律（与 `useLabSnifferStream()` 相同，只是抓包另有历史回填与包归一）：
// 1. 组件不 `new WebSocket` —— 换票、建连、断流都在这里；组件只读 `lines` / `text` / `status`。
// 2. 先换票再建连：`POST /api/lab/ws-ticket` 判会话 + 权限位 + 台账并落审计。
//    票一次性、60 秒；浏览器拿不到上游地址（`url` 是同源 `/lab-ws/<kind>`）。
// 3. 文本帧原样保留：日志是逐行文本、终端是 PTY 输出（可能不含换行）、监控是 JSON 行，
//    归一交给各自的纯函数（`labMonitorFrameOf()`），这里不做「猜格式」。

import type { LabWsKind } from "#layers/scenario/shared/constants/labWs";
import { labWsTicketOf } from "#layers/scenario/shared/types/labWs";

/** 日志 / 监控保留的最近帧数：页面只做观测窗，更早的内容不在浏览器里堆着 */
export const LAB_WS_LINE_LIMIT = 500;

/** 终端转写上限（字符）：PTY 会持续输出，只留最近一段，避免长时间开着吃内存 */
export const LAB_WS_TEXT_LIMIT = 20_000;

export type LabWsChannelStatus = "idle" | "connecting" | "live" | "closed" | "error";

function messageOf(value: unknown): string {
	return value instanceof Error ? value.message : String(value);
}

export function useLabWsChannel(kind: LabWsKind) {
	const api = useApi();
	const lines = ref<string[]>([]);
	const text = ref("");
	const status = ref<LabWsChannelStatus>("idle");
	const error = ref<string>();

	let socket: WebSocket | null = null;
	/** 调用方想要连着 —— 关闭事件据此区分「正常收工」与「意外断开」 */
	let wanted = false;

	/** 票里的 `url` 是同源相对路径；桌面端要拼上 `public.bffBase`，再换 `ws(s)` */
	function socketUrl(path: string): string {
		const base = api.bffBase || (import.meta.client ? window.location.origin : "");
		const url = new URL(path, base);
		url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
		return url.toString();
	}

	function closeSocket(): void {
		const current = socket;
		socket = null;
		if (!current)
			return;
		try {
			current.close();
		} catch {
			// 已经断开：关闭再抛一次没有意义
		}
	}

	function append(raw: string): void {
		lines.value = [...lines.value, raw].slice(-LAB_WS_LINE_LIMIT);
		text.value = (text.value + raw).slice(-LAB_WS_TEXT_LIMIT);
	}

	/** 换票并建连；已有连接时先断旧连新（切换节点 / 接口就是换一条通道） */
	async function connect(target = ""): Promise<void> {
		closeSocket();
		lines.value = [];
		text.value = "";

		wanted = true;
		status.value = "connecting";
		error.value = undefined;

		let ticket: ReturnType<typeof labWsTicketOf>;
		try {
			ticket = labWsTicketOf(await api.post<unknown>("/api/lab/ws-ticket", target ? { kind, target } : { kind }));
		} catch (caught) {
			// 403 / 400 / 404 / 503 的原文照登：这是「为什么连不上」的唯一诊断
			status.value = "error";
			error.value = messageOf(caught);
			return;
		}

		if (!ticket) {
			status.value = "error";
			error.value = "lab_ws_ticket_invalid";
			return;
		}

		if (!import.meta.client)
			return;

		const next = new WebSocket(socketUrl(ticket.url));
		socket = next;

		next.addEventListener("open", () => {
			if (socket === next)
				status.value = "live";
		});

		next.addEventListener("message", (event) => {
			if (typeof event.data === "string")
				append(event.data);
		});

		next.addEventListener("close", () => {
			// 只有「还是当前这条」才改状态：换节点重连时旧连接的回调不能覆盖新连接
			if (socket !== next)
				return;
			socket = null;
			status.value = wanted ? "closed" : "idle";
		});

		next.addEventListener("error", () => {
			if (socket !== next)
				return;
			status.value = "error";
			error.value ??= "lab_ws_ticket_invalid";
		});
	}

	/** 主动断开（关闭面板 / 切换标签）：不再自动重连，已收到的内容保留 */
	function disconnect(): void {
		wanted = false;
		closeSocket();
		status.value = "idle";
	}

	/** 只清浏览器这一侧的转写（PTY 没有标准清屏序列，清远端屏幕得由用户敲 `clear`） */
	function clear(): void {
		lines.value = [];
		text.value = "";
	}

	/** 终端上行：只有 `clientToUpstream` 的通道会被 BFF 转发，其余通道发出去也无效 */
	function send(payload: string): boolean {
		if (!socket || socket.readyState !== WebSocket.OPEN)
			return false;
		socket.send(payload);
		return true;
	}

	// 页面卸载 / 组件销毁时断流：不留下没人收的 socket（自检也会因此卡在 unsettled await）
	onScopeDispose(disconnect);

	return {
		lines,
		text,
		status,
		error,
		connect,
		disconnect,
		clear,
		send
	};
}
