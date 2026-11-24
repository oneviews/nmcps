// layers/scenario/shared/types/labWs.ts
// `/mininet-ws/*` 的**纯函数**：票响应归一 + 抓包事件归一（NMCPS-ADR-0022 D6 / W5）。
//
// 事实源：`services/mininet-api/mininet_gui_backend/sniffer.py` 的 `SnifferEvent`
// （`{ ts, proto, src, dst, len, info, node, intf, type }`，`len` 是别名）。
// 上游一个字段缺失都不该让页面崩：归一成显式默认值，`type` 非字符串就退成 `"packet"`，
// 页面据此渲染「未知协议」而不是白屏。

import type { LabWsKind } from "../constants/labWs";

/** `POST /api/mininet/ws-ticket` 的成功体 */
export interface LabWsTicket {
	/** 一次性短时票（HMAC，60 秒） */
	ticket: string
	/** 过期时刻（ISO 字符串，客户端不得续期） */
	expiresAt: string
	/** 同源升级地址：`/mininet-ws/<kind>?ticket=…` */
	url: string
	kind: LabWsKind
}

function nonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * 宽松的数字归一：上游同一字段既有 `0.25` 也有 `"0.25"`，两种都收。
 *
 * 只收「真数字」与「非空字符串数字」：`Number(null)` 是 `0`、`Number(true)` 是 `1`，
 * 若一并收下，缺失的速率会显示成 `0 Gbit/s` —— 把「读不到」说成「没有流量」，
 * 面板就成了假数据源。空串同理（`Number("")` 也是 0）。
 */
function finiteNumber(value: unknown): number | undefined {
	if (typeof value === "number")
		return Number.isFinite(value) ? value : undefined;
	if (typeof value !== "string" || !value.trim())
		return undefined;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

/** 票响应形状校验：缺 `ticket` / `url` 一律判无效（不猜、不拼） */
export function labWsTicketOf(payload: unknown): LabWsTicket | undefined {
	if (!payload || typeof payload !== "object" || Array.isArray(payload))
		return undefined;

	const record = payload as Record<string, unknown>;
	const ticket = nonEmptyString(record.ticket);
	const url = nonEmptyString(record.url);
	const kind = nonEmptyString(record.kind);

	if (!ticket || !url || !kind)
		return undefined;

	return {
		ticket,
		url,
		kind: kind as LabWsKind,
		expiresAt: nonEmptyString(record.expiresAt) ?? ""
	};
}

/** 一条抓包事件（页面渲染用；`id` 由调用方注入，保证列表 key 稳定） */
export interface LabSnifferPacket {
	id: string
	/** 纳秒时间戳（上游 `ts`），缺失时 `null` */
	ts: number | null
	proto: string
	src: string
	dst: string
	/** 帧长（上游 `len`），缺失时 `null` */
	len: number | null
	info: string
	node: string
	intf: string
	type: string
}

/** 未归一的原始事件（`id` 由列表侧生成） */
export type LabSnifferEvent = Omit<LabSnifferPacket, "id">;

/** 单条事件归一：形状不符返回 `undefined`（调用方丢弃，不造假包） */
export function labSnifferEventOf(payload: unknown): LabSnifferEvent | undefined {
	if (!payload || typeof payload !== "object" || Array.isArray(payload))
		return undefined;

	const record = payload as Record<string, unknown>;
	const proto = nonEmptyString(record.proto) ?? "UNKNOWN";
	const ts = finiteNumber(record.ts);

	return {
		ts: ts ?? null,
		proto,
		src: nonEmptyString(record.src) ?? "",
		dst: nonEmptyString(record.dst) ?? "",
		len: finiteNumber(record.len) ?? null,
		info: nonEmptyString(record.info) ?? "",
		node: nonEmptyString(record.node) ?? "",
		intf: nonEmptyString(record.intf) ?? "",
		type: nonEmptyString(record.type) ?? "packet"
	};
}

/**
 * `GET /api/mininet/sniffer/history` 的响应归一：上游回 `{ events: [...] }`。
 * 形状不符一律空数组 —— 历史读不到时页面显示空态，不继承上一次的包。
 */
export function labSnifferHistoryOf(payload: unknown): LabSnifferEvent[] {
	if (!payload || typeof payload !== "object" || Array.isArray(payload))
		return [];

	const events = (payload as Record<string, unknown>).events;
	if (!Array.isArray(events))
		return [];

	return events
		.map((item) => labSnifferEventOf(item))
		.filter((item): item is LabSnifferEvent => item !== undefined);
}

/**
 * 单接口速率采样（`/mininet-ws/monitor`）：上游 `websocket_interface_monitor` 每次回
 * `{ node, intf, ts, tx_gbps, rx_gbps }`，`ts` 是 ISO 字符串，速率单位 Gbit/s。
 */
export interface LabMonitorSample {
	node: string
	intf: string
	ts: string
	/** 发送速率（Gbit/s），上游字段缺失时为 `null` */
	txGbps: number | null
	/** 接收速率（Gbit/s），上游字段缺失时为 `null` */
	rxGbps: number | null
}

/** 单条采样的归一：缺 `node` / `intf` 或两个速率都读不到就判无效（页面丢弃，不造零值） */
export function labMonitorSampleOf(payload: unknown): LabMonitorSample | undefined {
	if (!payload || typeof payload !== "object" || Array.isArray(payload))
		return undefined;

	const record = payload as Record<string, unknown>;
	const node = nonEmptyString(record.node);
	const intf = nonEmptyString(record.intf);
	const txGbps = finiteNumber(record.tx_gbps);
	const rxGbps = finiteNumber(record.rx_gbps);

	if (!node || !intf || (txGbps === undefined && rxGbps === undefined))
		return undefined;

	return {
		node,
		intf,
		ts: nonEmptyString(record.ts) ?? "",
		txGbps: txGbps ?? null,
		rxGbps: rxGbps ?? null
	};
}

/**
 * PTY 原始输出 → 面板可读文本（NMCPS-ADR-0022 W5 的「Webshell 观感」段）。
 *
 * 上游 `websocket_terminal` 直接把 `mininet.node.Node.popen()` 的字节原样推到通道里：
 * 真实 PTY 的输出带 ANSI 颜色码（`ESC[1;32m`）、进度条的 `\r` 覆盖、行内退格。
 * 不洗一遍就渲染，用户会看到 `^[[1;32mroot@h1:/#` 这种乱码 —— 冒号后的 `[1;32m`
 * 还会被当成命令输出的一部分。
 *
 * 三步：剥转义序列 → 吃掉退格 → 按 `\r` 取行内最后一段。刻意**不**做换行重排 /
 * 光标定位（那需要终端模拟器，超出「观测窗」的职责，也不该加依赖）。
 *
 * 用字符扫描而不是正则：`ESC` 是 0x1B 控制字符，控制字符正则既过不了 lint
 * （`no-control-regex`），也容易在转义序列中途断行时多吃掉一个字。
 */
export function labTerminalTextOf(raw: string): string {
	if (!raw)
		return "";

	// 先归 CRLF：PTY 用 `\r\n` 结束一行，`\r` 覆盖语义只对**行内**回车成立
	const text = applyBackspaces(stripTerminalEscapes(raw.split("\r\n").join("\n")));
	return collapseCarriageReturns(text);
}

const TERMINAL_ESC = 27;
const TERMINAL_BEL = 7;

/** 剥 ANSI 转义序列（CSI / OSC / 其余两字符转义），其余字符原样保留 */
function stripTerminalEscapes(raw: string): string {
	let out = "";

	for (let index = 0; index < raw.length; index++) {
		if (raw.charCodeAt(index) !== TERMINAL_ESC) {
			out += raw[index];
			continue;
		}

		const next = raw[index + 1];

		if (next === "[") {
			// CSI：参数字节 0x30–0x3F、中间字节 0x20–0x2F，终止字节 0x40–0x7E
			let end = index + 2;
			while (end < raw.length) {
				const code = raw.charCodeAt(end);
				end++;
				if (code >= 0x40 && code <= 0x7E)
					break;
			}
			index = end - 1;
			continue;
		}

		if (next === "]") {
			// OSC：`标题 \x07` 或 `标题 ESC \` 两种终止
			let end = index + 2;
			while (end < raw.length) {
				if (raw.charCodeAt(end) === TERMINAL_BEL) {
					end++;
					break;
				}
				if (raw.charCodeAt(end) === TERMINAL_ESC && raw[end + 1] === "\\") {
					end += 2;
					break;
				}
				end++;
			}
			index = end - 1;
			continue;
		}

		// 其余转义（含孤立的 ESC）：连同后一个字符一起丢掉
		index++;
	}

	return out;
}

/** 退格：删掉同一行里前一个字符；行首退格直接丢掉（没有可删的） */
function applyBackspaces(raw: string): string {
	if (!raw.includes("\b"))
		return raw;

	const kept: string[] = [];
	for (const char of raw) {
		if (char !== "\b") {
			kept.push(char);
			continue;
		}
		if (kept.length && kept.at(-1) !== "\n")
			kept.pop();
	}
	return kept.join("");
}

/** 行内 `\r`：后写的内容覆盖前面的，取最后一段非空（进度条 `10%\r50%\rdone` ⇒ `done`） */
function collapseCarriageReturns(raw: string): string {
	if (!raw.includes("\r"))
		return raw;

	return raw.split("\n").map((line) => {
		if (!line.includes("\r"))
			return line;
		const segments = line.split("\r").filter((segment) => segment.length > 0);
		return segments.at(-1) ?? "";
	}).join("\n");
}

/**
 * 监控 / 日志通道的**一帧**语义：上游在通道内部用 `Error: …` 文本表达失败
 * （未启动、接口不存在、计数器读不到），随后自己断开。
 *
 * 页面不能把这种帧当采样丢掉 —— 那会让「监控失败」看起来像「一直没数据」。
 * 返回 `{ error }` 时页面显示原文，返回 `{ sample }` 时进曲线。
 */
export function labMonitorFrameOf(raw: string): { sample: LabMonitorSample } | { error: string } | undefined {
	const text = raw.trim();
	if (!text)
		return undefined;

	if (text.startsWith("Error:"))
		return { error: text };

	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return { error: text };
	}

	const sample = labMonitorSampleOf(parsed);
	return sample ? { sample } : { error: text };
}
