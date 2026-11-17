import type { H3Event } from "h3";
import type { ApiResponse } from "~~/shared/types/api";
import type { LabNetworkRecord } from "~~/shared/types/lab";
import type { MininetMatch } from "#layers/scenario/shared/constants/mininetRoutes";
import type { MininetConfig } from "./mininetConfig";
import { Buffer } from "node:buffer";
import { getHeader, getQuery, setResponseHeader, setResponseStatus } from "h3";
import { MININET_MESSAGES } from "~~/shared/constants/upstreamReasons";
import { buildMininetUpstreamPath } from "#layers/scenario/shared/constants/mininetRoutes";
import { filterLabPayload } from "./labEgress";
import { getMininetConfig } from "./mininetConfig";

/**
 * Mininet 实验后端（第三上游）的出站实现。
 *
 * 依据 NMCPS-ADR-0020：与主上游、仿真平台并列，但**不复用** `proxyToUpstream()`。
 * 后者会把 `nmcps_at` 转成 `Bearer` 并参与单飞刷新；Mininet 后端没有鉴权能力，
 * 复用等于把访问令牌发给一个不需要也不应该看到它的上游。
 *
 * 本文件出站头只有 `accept` / `user-agent` / `x-request-id`：没有 authorization，
 * 不读任何 cookie，也不转发客户端请求体（白名单只有 GET）。
 */

/** 允许透传给 Mininet 的客户端请求头（白名单式） */
const FORWARDED_REQUEST_HEADERS = ["accept", "user-agent", "x-request-id"];

function now(): string {
	return new Date().toISOString();
}

function envelope(code: number, status: ApiResponse["status"], message: string): ApiResponse<never> {
	return { code, status, message, timestamp: now() };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

/** FastAPI 错误体通常是 `{ detail }`；个别端点回 `{ message }` / `{ msg }` */
function pickMessage(payload: unknown): string | undefined {
	const record = asRecord(payload);
	if (!record) {
		return typeof payload === "string" && payload.trim() ? payload.trim() : undefined;
	}

	const detail = record.detail;
	if (Array.isArray(detail)) {
		const messages = detail
			.map((item) => asRecord(item)?.msg)
			.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
		if (messages.length) {
			return messages.join("; ");
		}
	}

	const candidates = [record.message, record.msg, record.detail, record.error];
	return candidates.find((item): item is string => typeof item === "string" && item.trim().length > 0)?.trim();
}

function normalizeError(status: number, payload: unknown): ApiResponse<never> {
	return {
		code: status,
		status: status >= 500 ? "error" : "warning",
		message: pickMessage(payload) ?? (status >= 500 ? "mininet_error" : "mininet_rejected"),
		timestamp: now()
	};
}

/** Mininet 回裸 JSON；若将来某些端点改为 `{ code, msg, data }`，也按主上游口径补齐 */
function normalizeEnvelope<T>(payload: unknown, status: number): ApiResponse<T> {
	const record = asRecord(payload)!;
	const code = Number(record.code);

	if (!Number.isFinite(code)) {
		return payload as ApiResponse<T>;
	}

	return {
		...record,
		code,
		status: code === 0 ? "success" : (status >= 500 ? "error" : "warning"),
		message: typeof record.message === "string" && record.message.trim()
			? record.message
			: (typeof record.msg === "string" && record.msg.trim() ? record.msg : (code === 0 ? "success" : "mininet_rejected")),
		timestamp: typeof record.timestamp === "string" ? record.timestamp : now()
	} as ApiResponse<T>;
}

function respond<T>(event: H3Event, status: number, body: ApiResponse<T>): ApiResponse<T> {
	setResponseStatus(event, status);
	setResponseHeader(event, "content-type", "application/json; charset=utf-8");
	setResponseHeader(event, "cache-control", "no-store");
	return body;
}

/** 出口过滤：只处理 `data`，失败信封不动；单对象不可见 → 404（不能伪装成空值） */
function scopeExit<T>(
	event: H3Event,
	body: ApiResponse<T>,
	network: LabNetworkRecord,
	ignoreResources = false
): ApiResponse<T> | ApiResponse<never> {
	if (body.code !== 0 || body.data === undefined) {
		return body;
	}

	const { value, dropped } = filterLabPayload(body.data, { network, ignoreResources });
	if (value === undefined) {
		return respond(event, 404, envelope(404, "warning", MININET_MESSAGES.resourceNotFound));
	}

	if (dropped > 0) {
		console.warn("[lab] egress filtered", network.id, dropped);
	}

	return { ...body, data: value };
}

function buildMininetUrl(event: H3Event, baseUrl: string, match: MininetMatch): string {
	const url = new URL(baseUrl);
	const upstreamPath = buildMininetUpstreamPath(match.route, match.params);
	url.pathname = `${url.pathname.replace(/\/+$/, "")}${upstreamPath.startsWith("/") ? upstreamPath : `/${upstreamPath}`}`;

	// 查询参数原样带给上游（过滤 / 分页都在 Mininet 侧）；不追加任何鉴权参数
	const query = getQuery(event);
	for (const [key, value] of Object.entries(query)) {
		if (value === undefined || value === null) {
			continue;
		}

		for (const item of Array.isArray(value) ? value : [value]) {
			url.searchParams.append(key, String(item));
		}
	}

	return url.toString();
}

function buildMininetHeaders(event: H3Event, hasBody = false): Headers {
	const headers = new Headers();

	for (const name of FORWARDED_REQUEST_HEADERS) {
		const value = getHeader(event, name);
		if (value) {
			headers.set(name, value);
		}
	}

	if (!headers.has("accept")) {
		headers.set("accept", "application/json");
	}

	// 只声明我们自己转发的 JSON；不转发客户端原始 content-type（避免把表单 / multipart 带出去）
	if (hasBody) {
		headers.set("content-type", "application/json");
	}

	return headers;
}

/** multipart 的 `file` 字段：boundary 由 fetch 自己算，不能手工声明 content-type */
function uploadFormDataOf(upload: { filename: string, content: string }): FormData {
	const form = new FormData();
	form.append("file", new Blob([upload.content], { type: "application/json" }), upload.filename);
	return form;
}

function isAbortError(error: unknown): boolean {
	return !!error && typeof error === "object" && "name" in error && (error as { name?: string }).name === "AbortError";
}

function safeJsonParse(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return raw;
	}
}

export interface MininetProxyOptions {
	/** 台账已解析的网络；提供时对成功响应做租户/资源清单出口过滤 */
	network?: LabNetworkRecord
	/**
	 * 写端点：出口过滤只核对租户 / 网络标识，不套资源清单。
	 *
	 * 写响应对应的是刚被改动的对象（上游 `POST /switches` 回的就是交换机本身），
	 * 新节点按定义还不在写前那份清单里 —— 照常判会把一次成功的建节点回成 404。
	 */
	ignoreResourceScope?: boolean
	/** 已由调用方序列化的 JSON 请求体（仅写端点；不大于 `LAB_WRITE_BODY_LIMIT`） */
	body?: string
	/**
	 * 以文件上传方式出站（仅 `POST /import_json`）。
	 *
	 * 上游 `import_json` 的签名是 `file: UploadFile = File(...)`，只收 multipart；
	 * 照常转发 JSON 包体会被 FastAPI 判成 422。BFF 因此在出站时把已鉴权、已审计的
	 * JSON 包体重新封装成一个 `file` 字段（文件名由 BFF 给，不信任客户端）。
	 */
	upload?: { filename: string, content: string }
}

/**
 * Mininet 通道的**唯一出站点**：转发白名单命中的请求，并把响应归一成 `ApiResponse<T>`。
 *
 * - 通道未启用（`baseUrl` 为空）→ 503 `mininet_not_configured`，不静默返回空数据；
 * - 不可达 → 502 `mininet_unreachable`；超时 → 504 `mininet_timeout`；
 * - 上游非 2xx → 保留真实状态码（FastAPI 的 400 / 404 是页面要展示的诊断信息）；
 * - 写请求的请求体由调用方（`[...slug].ts`）在完成鉴权、审计与加锁后传入，
 *   本函数不认识权限位，也不读客户端原始流，避免绕过守卫。
 */
export async function proxyToMininet<T = unknown>(
	event: H3Event,
	match: MininetMatch,
	config: MininetConfig = getMininetConfig(event),
	options: MininetProxyOptions = {}
): Promise<ApiResponse<T>> {
	if (!config.baseUrl) {
		const message = config.tenantScoped
			? MININET_MESSAGES.tenantRuntimeUnavailable
			: MININET_MESSAGES.notConfigured;
		return respond(event, 503, envelope(503, "error", message));
	}

	const method = match.route.method;

	let url: string;
	try {
		url = buildMininetUrl(event, config.baseUrl, match);
	} catch {
		return respond(event, 500, envelope(500, "error", MININET_MESSAGES.baseInvalid));
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), config.timeoutMs);
	const jsonBody = options.body !== undefined && method !== "GET" && options.upload === undefined;
	const headers = buildMininetHeaders(event, jsonBody);
	const outgoing = options.upload
		? uploadFormDataOf(options.upload)
		: jsonBody ? options.body : undefined;

	try {
		const response = await fetch(url, {
			method,
			headers,
			...(outgoing === undefined ? {} : { body: outgoing }),
			signal: controller.signal,
			redirect: "manual"
		});

		const raw = await response.text();
		const payload = raw ? safeJsonParse(raw) : undefined;

		if (!response.ok) {
			return respond(event, response.status, normalizeError(response.status, payload));
		}

		if (!raw) {
			return respond(event, response.status, envelope(0, "success", "success"));
		}

		if (payload && typeof payload === "object" && "code" in payload && "status" in payload) {
			const body = normalizeEnvelope<T>(payload, response.status);
			const scoped = options.network ? scopeExit(event, body, options.network, options.ignoreResourceScope) : body;
			return respond(event, response.status, scoped);
		}

		const body: ApiResponse<T> = {
			code: 0,
			status: "success",
			message: "success",
			data: payload as T,
			timestamp: now()
		};
		const scoped = options.network ? scopeExit(event, body, options.network, options.ignoreResourceScope) : body;
		return respond(event, response.status, scoped);
	} catch (error) {
		if (isAbortError(error)) {
			return respond(event, 504, envelope(504, "error", MININET_MESSAGES.timeout));
		}

		if (import.meta.dev) {
			console.error("[lab] upstream request failed", "GET", match.route.upstream, error);
		}

		return respond(event, 502, envelope(502, "error", MININET_MESSAGES.unreachable));
	} finally {
		clearTimeout(timer);
	}
}

/** 二进制类上游读的结果：成功带原始字节（pcap 不能被当文本解码） */
export type MininetBinaryResult
	= | { ok: true, bytes: Buffer }
		| { ok: false, status: number, message: string };

/**
 * 拉一段**二进制**（抓包下载专用，NMCPS-ADR-0022 W5）。
 *
 * 与 `fetchMininetText()` 分开的理由：pcap 是 `application/vnd.tcpdump.pcap` 原始字节，
 * 走 `response.text()` 会按 UTF-8 解码，`0xd4 0xc3` 这类魔数在往返里被替换成 U+FFFD ——
 * 下载下来的文件打不开。失败体仍是 JSON（FastAPI 的 `{ detail }`），所以错误消息照旧解。
 */
export async function fetchMininetBinary(
	event: H3Event,
	config: MininetConfig,
	upstreamPath: string
): Promise<MininetBinaryResult> {
	if (!config.baseUrl) {
		return {
			ok: false,
			status: 503,
			message: config.tenantScoped ? MININET_MESSAGES.tenantRuntimeUnavailable : MININET_MESSAGES.notConfigured
		};
	}

	let url: string;
	try {
		const base = new URL(config.baseUrl);
		url = `${base.origin}${base.pathname.replace(/\/+$/, "")}${upstreamPath}`;
	} catch {
		return { ok: false, status: 500, message: MININET_MESSAGES.baseInvalid };
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), config.timeoutMs);

	try {
		const headers = buildMininetHeaders(event);
		headers.set("accept", "application/octet-stream");
		const response = await fetch(url, {
			method: "GET",
			headers,
			signal: controller.signal,
			redirect: "manual"
		});

		if (!response.ok) {
			const text = await response.text();
			return { ok: false, status: response.status, message: pickMessage(safeJsonParse(text)) ?? "mininet_rejected" };
		}

		return { ok: true, bytes: Buffer.from(await response.arrayBuffer()) };
	} catch (error) {
		if (isAbortError(error)) {
			return { ok: false, status: 504, message: MININET_MESSAGES.timeout };
		}

		if (import.meta.dev) {
			console.error("[lab] binary export request failed", upstreamPath, error);
		}

		return { ok: false, status: 502, message: MININET_MESSAGES.unreachable };
	} finally {
		clearTimeout(timer);
	}
}

/** 文本类上游读的结果：成功带原文，失败带状态码与给前端看的 message */
export type MininetTextResult
	= | { ok: true, text: string }
		| { ok: false, status: number, message: string };

/**
 * 拉一段**纯文本**（导出通道专用，NMCPS-ADR-0022 §五）。
 *
 * 与 `proxyToMininet()` 分开的理由只有一条：导出不能套 JSON 信封 —— `export_json` 的正文
 * 是 JSON 字符串、`export_script` 是 Python 源码，包成 `{ code, data: "..." }` 之后浏览器
 * 另存下来的文件既不是 `.json` 也不是 `.py`。出站头与超时口径保持一致，仍然没有凭据。
 */
export async function fetchMininetText(
	event: H3Event,
	config: MininetConfig,
	upstreamPath: string
): Promise<MininetTextResult> {
	if (!config.baseUrl) {
		return {
			ok: false,
			status: 503,
			message: config.tenantScoped ? MININET_MESSAGES.tenantRuntimeUnavailable : MININET_MESSAGES.notConfigured
		};
	}

	let url: string;
	try {
		const base = new URL(config.baseUrl);
		url = `${base.origin}${base.pathname.replace(/\/+$/, "")}${upstreamPath}`;
	} catch {
		return { ok: false, status: 500, message: MININET_MESSAGES.baseInvalid };
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), config.timeoutMs);

	try {
		const headers = buildMininetHeaders(event);
		headers.set("accept", "text/plain");
		const response = await fetch(url, {
			method: "GET",
			headers,
			signal: controller.signal,
			redirect: "manual"
		});
		const text = await response.text();

		if (!response.ok) {
			return { ok: false, status: response.status, message: pickMessage(safeJsonParse(text)) ?? "mininet_rejected" };
		}

		return { ok: true, text };
	} catch (error) {
		if (isAbortError(error)) {
			return { ok: false, status: 504, message: MININET_MESSAGES.timeout };
		}

		if (import.meta.dev) {
			console.error("[lab] export request failed", upstreamPath, error);
		}

		return { ok: false, status: 502, message: MININET_MESSAGES.unreachable };
	} finally {
		clearTimeout(timer);
	}
}

/** JSON 类上游读的结果：成功带解析后的正文，失败带状态码与给前端看的 message */
export type MininetJsonResult
	= | { ok: true, data: unknown }
		| { ok: false, status: number, message: string };

/**
 * 读一份**上游 JSON**并解析（对账专用，NMCPS-ADR-0023）。
 *
 * `proxyToMininet()` 只认白名单里的 `(method, template)`，而且要过租户台账过滤；
 * 对账需要的是「上游此刻的事实」，因此单开一条只读通道：仍然没有凭据、
 * 仍然受 `config.timeoutMs` 约束，但**不**经过 `filterLabPayload()` ——
 * 台账正是要被重写的那一侧，用旧清单过滤读回来的节点只会把漂移原样吞掉。
 */
export async function fetchMininetJson(
	event: H3Event,
	config: MininetConfig,
	upstreamPath: string
): Promise<MininetJsonResult> {
	if (!config.baseUrl) {
		return {
			ok: false,
			status: 503,
			message: config.tenantScoped ? MININET_MESSAGES.tenantRuntimeUnavailable : MININET_MESSAGES.notConfigured
		};
	}

	let url: string;
	try {
		const base = new URL(config.baseUrl);
		url = `${base.origin}${base.pathname.replace(/\/+$/, "")}${upstreamPath}`;
	} catch {
		return { ok: false, status: 500, message: MININET_MESSAGES.baseInvalid };
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), config.timeoutMs);

	try {
		const headers = buildMininetHeaders(event);
		headers.set("accept", "application/json");
		const response = await fetch(url, {
			method: "GET",
			headers,
			signal: controller.signal,
			redirect: "manual"
		});
		const text = await response.text();

		if (!response.ok) {
			return { ok: false, status: response.status, message: pickMessage(safeJsonParse(text)) ?? "mininet_rejected" };
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			return { ok: false, status: 502, message: MININET_MESSAGES.invalidPayload };
		}

		return { ok: true, data: parsed };
	} catch (error) {
		if (isAbortError(error)) {
			return { ok: false, status: 504, message: MININET_MESSAGES.timeout };
		}

		if (import.meta.dev) {
			console.error("[lab] reconcile read failed", upstreamPath, error);
		}

		return { ok: false, status: 502, message: MININET_MESSAGES.unreachable };
	} finally {
		clearTimeout(timer);
	}
}
