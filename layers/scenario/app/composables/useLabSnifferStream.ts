// layers/scenario/app/composables/useLabSnifferStream.ts
// 抓包实时流（NMCPS-ADR-0022 D6 / W5）：页面侧的**唯一** WebSocket 入口。
//
// 三条纪律：
// 1. 组件不 `new WebSocket` —— 建连、换票、断线都在这里；组件只读 `packets` / `status`。
// 2. 先换票再建连：`POST /api/mininet/ws-ticket` 由 BFF 判会话 + 权限位 + 台账并落审计，
//    票一次性、60 秒。浏览器永远拿不到上游地址（票里的 `url` 是同源 `/mininet-ws/*`）。
// 3. 历史与实时是两条通道：历史走 `GET /api/mininet/sniffer/history`（`lab:read`），
//    实时走 WS；列表上限固定，长时间抓包不会把页面内存吃光。

import type { LabSnifferEvent, LabSnifferPacket, LabWsTicket } from "#layers/scenario/shared/types/labWs";
import { labSnifferEventOf, labSnifferHistoryOf, labWsTicketOf } from "#layers/scenario/shared/types/labWs";

/** 列表上限：抓包是持续流，页面只留最近这么多条（更早的看 pcap） */
export const LAB_SNIFFER_PACKET_LIMIT = 200;

export type LabSnifferStreamStatus = "idle" | "connecting" | "live" | "closed" | "error";

function messageOf(value: unknown): string {
	return value instanceof Error ? value.message : String(value);
}

function safeJsonParse(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}

export function useLabSnifferStream() {
	const api = useApi();
	const packets = ref<LabSnifferPacket[]>([]);
	const status = ref<LabSnifferStreamStatus>("idle");
	const error = ref<string>();

	let socket: WebSocket | null = null;
	/** 调用方想要连着（页面判定「抓包中」）——关闭事件据此决定是「正常收工」还是「意外断开」 */
	let wanted = false;
	let sequence = 0;

	function toPacket(event: LabSnifferEvent): LabSnifferPacket {
		sequence += 1;
		return { ...event, id: `pkt-${sequence}` };
	}

	function append(events: LabSnifferEvent[]): void {
		if (!events.length)
			return;
		packets.value = [...packets.value, ...events.map((event) => toPacket(event))].slice(-LAB_SNIFFER_PACKET_LIMIT);
	}

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

	/**
	 * 回填历史（`GET /api/mininet/sniffer/history`）。
	 *
	 * 成功时以历史为准（它是上游的完整账本，刷新后列表不与上游漂移）；
	 * 失败只记 `error`，不清空已有列表：历史读不到时实时流仍然可用。
	 */
	async function loadHistory(): Promise<void> {
		try {
			const payload = await api.get<unknown>("/api/mininet/sniffer/history");
			packets.value = labSnifferHistoryOf(payload).map((event) => toPacket(event)).slice(-LAB_SNIFFER_PACKET_LIMIT);
		} catch (caught) {
			error.value = messageOf(caught);
		}
	}

	/** 换票并建连；已有连接时直接返回（重复点「开始抓包」不叠第二条流） */
	async function connect(): Promise<void> {
		if (socket)
			return;

		wanted = true;
		status.value = "connecting";
		error.value = undefined;

		let ticket: LabWsTicket | undefined;
		try {
			ticket = labWsTicketOf(await api.post<unknown>("/api/mininet/ws-ticket", { kind: "sniffer" }));
		} catch (caught) {
			// 403 / 409 / 503 的原文照登：这是「为什么连不上」的唯一诊断
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
			if (typeof event.data !== "string")
				return;
			const parsed = labSnifferEventOf(safeJsonParse(event.data));
			if (parsed)
				append([parsed]);
		});

		next.addEventListener("close", () => {
			// 只有「还是当前这条」才改状态：换票重连时旧连接的回调不能覆盖新连接
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

	/** 主动断开（停止抓包 / 离开页面）：不再自动重连，列表保留到下一次回填 */
	function disconnect(): void {
		wanted = false;
		closeSocket();
		status.value = "idle";
	}

	return {
		packets,
		status,
		error,
		loadHistory,
		connect,
		disconnect
	};
}
