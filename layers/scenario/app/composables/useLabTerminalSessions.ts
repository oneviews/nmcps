// layers/scenario/app/composables/useLabTerminalSessions.ts
// 多会话 Webshell 的页面侧通道（NMCPS-ADR-0022 W8）。
//
// 与 `useLabWsChannel(kind)` 的差别只有一条：同一种通道要能**同时**开好几条。
// 1.0 的 Webshell 就是「每个节点一条标签」（`Webshell.vue` 的会话列表）；一个 ref 装一条
// socket 的写法会把「切标签」变成「先断旧的、再连新的」—— 换回来时远端 PTY 已经没了。
//
// 三条纪律与其它通道相同：
// 1. 组件不 `new WebSocket` —— 换票、建连、断流都在这里；
// 2. 先换票再建连（`POST /api/lab/ws-ticket` 判会话 + `lab:terminal` + 台账并落审计），
//    票一次性、60 秒，浏览器拿不到上游地址；
// 3. 文本帧原样保留（PTY 输出可能不带换行），渲染前交给 `labTerminalTextOf()` 清洗。

import type { LabWsChannelStatus } from "#layers/scenario/app/composables/useLabWsChannel";
import { LAB_WS_TEXT_LIMIT } from "#layers/scenario/app/composables/useLabWsChannel";
import { labWsTicketOf } from "#layers/scenario/shared/types/labWs";

/** 一条节点终端会话（数组顺序 = 打开顺序 = 标签顺序） */
export interface LabTerminalSession {
	/** 节点 id（票面的 `target`；同时是标签 key） */
	target: string
	status: LabWsChannelStatus
	/** 换票 / 建连失败的原文：这是「为什么进不去」的唯一诊断 */
	error?: string
	/** PTY 原文，渲染前过 `labTerminalTextOf()` */
	text: string
}

/** 握手期最多排队的上行帧数（与 BFF `labWsRelay` 的同名上限对齐） */
const MAX_PENDING_FRAMES = 32;

export function useLabTerminalSessions() {
	const api = useApi();
	const sessions = ref<LabTerminalSession[]>([]);
	const active = ref<string>();

	/**
	 * socket 与待发帧都不进响应式：它们只用来发帧 / 断开，改动不需要触发渲染；
	 * 放进 `ref` 会让 Vue 深度代理整个 WebSocket 对象。
	 */
	const sockets = new Map<string, WebSocket>();
	const pending = new Map<string, string[]>();

	function sessionOf(target: string): LabTerminalSession | undefined {
		return sessions.value.find((session) => session.target === target);
	}

	function patch(target: string, next: Partial<LabTerminalSession>): void {
		sessions.value = sessions.value.map((session) => session.target === target ? { ...session, ...next } : session);
	}

	/** 票里的 `url` 是同源相对路径；桌面端要拼上 `public.bffBase`，再换 `ws(s)` */
	function socketUrl(path: string): string {
		const base = api.bffBase || (import.meta.client ? window.location.origin : "");
		const url = new URL(path, base);
		url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
		return url.toString();
	}

	function closeSocket(target: string): void {
		const current = sockets.get(target);
		sockets.delete(target);
		pending.delete(target);
		if (!current)
			return;
		try {
			current.close();
		} catch {
			// 已经断开：关闭再抛一次没有意义
		}
	}

	function append(target: string, raw: string): void {
		const session = sessionOf(target);
		if (!session)
			return;
		patch(target, { text: (session.text + raw).slice(-LAB_WS_TEXT_LIMIT) });
	}

	/**
	 * 打开某个节点的会话；已经开着就只切过去（不重连 —— 重连会把远端 PTY 一起丢掉）。
	 * 上一次以 `closed` / `error` 收尾的会话则整条重开：留着半死的 socket 没意义。
	 */
	async function open(target: string): Promise<void> {
		if (!target)
			return;

		const existing = sessionOf(target);
		if (existing && existing.status !== "closed" && existing.status !== "error") {
			active.value = target;
			return;
		}

		closeSocket(target);
		if (existing)
			patch(target, { status: "connecting", text: "", error: undefined });
		else
			sessions.value = [...sessions.value, { target, status: "connecting", text: "" }];
		active.value = target;

		let ticket: ReturnType<typeof labWsTicketOf>;
		try {
			ticket = labWsTicketOf(await api.post<unknown>("/api/lab/ws-ticket", { kind: "terminal", target }));
		} catch (caught) {
			// 403 / 404 / 503 的原文照登：不把「没权限」说成「网络断了」
			patch(target, { status: "error", error: messageOf(caught) });
			return;
		}

		if (!ticket) {
			patch(target, { status: "error", error: "lab_ws_ticket_invalid" });
			return;
		}

		if (!import.meta.client)
			return;

		const next = new WebSocket(socketUrl(ticket.url));
		sockets.set(target, next);

		next.addEventListener("open", () => {
			// 只有「还是当前这条」才改状态：重开后旧 socket 的回调不能覆盖新连接
			if (sockets.get(target) !== next)
				return;
			patch(target, { status: "live" });
			const queued = pending.get(target) ?? [];
			pending.delete(target);
			for (const text of queued)
				next.send(text);
		});

		next.addEventListener("message", (event) => {
			if (sockets.get(target) !== next)
				return;
			if (typeof event.data === "string")
				append(target, event.data);
		});

		next.addEventListener("close", () => {
			if (sockets.get(target) !== next)
				return;
			sockets.delete(target);
			pending.delete(target);
			patch(target, { status: "closed" });
		});

		next.addEventListener("error", () => {
			if (sockets.get(target) !== next)
				return;
			patch(target, { status: "error", error: sessionOf(target)?.error ?? "lab_ws_ticket_invalid" });
		});
	}

	/** 关闭一条会话（标签上的 ×）。关掉的是当前标签时，焦点落到相邻的一条 */
	function close(target: string): void {
		const index = sessions.value.findIndex((session) => session.target === target);
		closeSocket(target);
		sessions.value = sessions.value.filter((session) => session.target !== target);

		if (active.value !== target)
			return;
		active.value = sessions.value[Math.min(index, sessions.value.length - 1)]?.target;
	}

	/** 关面板 / 组件销毁：所有会话一起断，不留没人收的 socket */
	function closeAll(): void {
		for (const session of sessions.value)
			closeSocket(session.target);
		sessions.value = [];
		active.value = undefined;
	}

	/** 只清浏览器这一侧的转写（PTY 没有标准清屏序列，清远端屏幕得由用户敲 `clear`） */
	function clear(target: string): void {
		if (sessionOf(target))
			patch(target, { text: "" });
	}

	/**
	 * 上行：`true` 表示「已受理」—— 握手期先排队、`open` 后补发，
	 * 否则「连上就敲」的第一行会静默丢掉（BFF 那侧同样排一次队，这里是浏览器 socket 这一小段）。
	 */
	function send(target: string, data: string): boolean {
		if (!target || !data)
			return false;

		const socket = sockets.get(target);
		if (!socket)
			return false;

		if (socket.readyState === WebSocket.OPEN) {
			socket.send(data);
			return true;
		}

		if (socket.readyState === WebSocket.CONNECTING) {
			const queued = pending.get(target) ?? [];
			if (queued.length >= MAX_PENDING_FRAMES)
				return false;
			pending.set(target, [...queued, data]);
			return true;
		}

		return false;
	}

	const activeSession = computed(() => sessions.value.find((session) => session.target === active.value));

	// 页面卸载 / 组件销毁时断流：不留下没人收的 socket（自检也会因此卡在 unsettled await）
	onScopeDispose(closeAll);

	return {
		sessions,
		active,
		activeSession,
		open,
		close,
		closeAll,
		clear,
		send
	};
}

function messageOf(value: unknown): string {
	return value instanceof Error ? value.message : String(value);
}
