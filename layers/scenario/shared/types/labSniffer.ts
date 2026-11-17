// layers/scenario/shared/types/labSniffer.ts
// 抓包状态的**纯函数**（NMCPS-ADR-0022 W5）：把 `GET /api/lab/sniffer/state` 的响应归一成三态。
//
// 事实源：`services/mininet-api/mininet_gui_backend/api.py` 的
// `sniffer_state / sniffer_start / sniffer_stop`（都回 `{ active: bool }`）。
//
// 为什么不是布尔：读不到（通道没配、上游不可用、会话没有 `lab:read`）时不能假设「没在抓」，
// 否则「开始抓包」会对着已经在录的上游再发一次 start —— 与运行态 `labRunStateOf()` 同一口径。

/** 抓包态：`true` 抓包中 / `false` 未抓包 / `null` 读不到（未知） */
export type LabSnifferActive = boolean | null;

/** `{ active: boolean }` → 三态；形状不符一律 `null`（未知） */
export function labSnifferActiveOf(payload: unknown): LabSnifferActive {
	if (!payload || typeof payload !== "object" || Array.isArray(payload))
		return null;
	const active = (payload as Record<string, unknown>).active;
	return typeof active === "boolean" ? active : null;
}

/** 下载 pcap 前 `content-disposition` 没给文件名时的回落名（BFF 正常会给 `lab-<net>-<ts>.pcap`） */
export const LAB_CAPTURE_FALLBACK_FILENAME = "lab-capture.pcap";
