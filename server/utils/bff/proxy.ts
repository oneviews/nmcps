import type { H3Event } from "h3";
import type { ApiResponse, ValidationError } from "~~/shared/types/api";
import { getCookie, getHeader, getQuery, readRawBody, setResponseHeader, setResponseStatus } from "h3";
import { BFF_UPSTREAM_MESSAGES } from "~~/shared/constants/upstreamReasons";
import { isApiEnvelope } from "~~/shared/utils/apiGuard";
import { getBffConfig } from "./config";

/** 允许透传给上游的客户端请求头（其余一律丢弃，避免协议走私） */
const FORWARDED_REQUEST_HEADERS = [
	"accept",
	"accept-language",
	"content-type",
	"user-agent",
	"x-tenant-id",
	"x-request-id"
];

const BODY_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** 需要原样流式透传的响应类型（走 `Response` 分支，不做 JSON 信封） */
const STREAM_CONTENT_TYPE = "text/event-stream";

/** 单次请求体上限（BFF 对公网暴露时的基础防护；上传类端点需单独放宽） */
const MAX_BODY_BYTES = 10 * 1024 * 1024;

export interface BffProxyOptions {
	/** 上游路径段（已解码；由本函数逐段编码后拼接） */
	path: string | string[]
	method?: string
	/** 追加/覆盖的查询参数（客户端 query 会被合并） */
	query?: Record<string, unknown>
	/** 显式剔除的查询键（上游参数改名时使用） */
	stripQuery?: string[]
	/** 覆盖默认上游基址（独立服务例外） */
	baseURL?: string
	timeoutMs?: number
	headers?: Record<string, string | undefined>
	/**
	 * 覆盖发往上游的请求体（字符串 / 字节）。
	 *
	 * 认证类 BFF 路由需要先校验入参再转发（缺字段不直传上游），或把 cookie 里的
	 * 刷新令牌拼成上游报文 —— 这两种场景都无法直接透传客户端原始 body。
	 * 未提供时仍读取客户端原始 body。
	 */
	body?: string | Uint8Array
}

function now(): string {
	return new Date().toISOString();
}

function envelope(code: number, status: ApiResponse["status"], message: string): ApiResponse<never> {
	return { code, status, message, timestamp: now() };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function pickMessage(payload: unknown): string | undefined {
	const record = asRecord(payload);
	if (!record) {
		return typeof payload === "string" && payload.trim() ? payload.trim() : undefined;
	}

	const nested = asRecord(record.error);
	const candidates = [record.message, record.msg, record.error_msg, record.detail, nested?.message, record.error];
	return candidates.find((item): item is string => typeof item === "string" && item.trim().length > 0)?.trim();
}

function pickDetails(payload: unknown): ValidationError[] | undefined {
	const record = asRecord(payload);
	const nested = asRecord(record?.error);
	const candidate = record?.error_detail ?? record?.details ?? nested?.details ?? nested?.error_detail;
	if (!Array.isArray(candidate)) {
		return undefined;
	}

	const details = candidate.filter((item): item is ValidationError => {
		const entry = asRecord(item);
		return !!entry && typeof entry.msg === "string";
	});

	return details.length ? details : undefined;
}

function normalizeUpstreamError(status: number, payload: unknown, raw: string): ApiResponse<never> {
	const message = pickMessage(payload) ?? (status >= 500 ? "upstream_error" : "upstream_rejected");
	const details = pickDetails(payload)
		?? (import.meta.dev && raw ? [{ loc: [], msg: raw.slice(0, 2000), type: "upstream_body" }] : undefined);

	// 上游业务码（如 iam 的 20201 / 20205）与 HTTP 状态码天然不撞：> 599 时保留，
	// 让前端能区分「口令错」「会话失效」「未认证」；HTTP 语义码仍以 status 为准。
	const candidate = Number(asRecord(payload)?.code);
	const code = Number.isFinite(candidate) && candidate > 599 ? candidate : status;

	return {
		code,
		status: status >= 500 ? "error" : "warning",
		message,
		error_detail: details,
		timestamp: now()
	};
}

/**
 * 归一化上游「已是信封」的 2xx 载荷。
 *
 * 新后端（gateway/iam）用 `{ code, msg, data }`，缺 `status` 与 `message`；
 * 这里补齐成 BFF 契约（`msg` → `message`，`code === 0` → `success`），
 * 业务字段一字不动。
 */
function normalizeUpstreamEnvelope<T>(payload: unknown, status: number): ApiResponse<T> {
	const record = asRecord(payload)!;
	const code = Number(record.code);
	if (!Number.isFinite(code)) {
		return payload as ApiResponse<T>;
	}

	const rawStatus = record.status;
	const envelopeStatus: ApiResponse["status"] = rawStatus === "success" || rawStatus === "info" || rawStatus === "warning" || rawStatus === "error"
		? rawStatus
		: (code === 0 ? "success" : (status >= 500 ? "error" : "warning"));

	return {
		...record,
		code,
		status: envelopeStatus,
		message: typeof record.message === "string" && record.message.trim()
			? record.message
			: (typeof record.msg === "string" && record.msg.trim() ? record.msg : (code === 0 ? "success" : "upstream_rejected")),
		timestamp: typeof record.timestamp === "string" ? record.timestamp : now()
	} as ApiResponse<T>;
}

function respond<T>(event: H3Event, status: number, body: ApiResponse<T>): ApiResponse<T> {
	setResponseStatus(event, status);
	setResponseHeader(event, "content-type", "application/json; charset=utf-8");
	setResponseHeader(event, "cache-control", "no-store");
	return body;
}

/**
 * SSE 透传：把上游流原样包成 `Response` 交给 h3（`sendWebResponse` → `sendStream`），
 * 客户端拿到的是一段段增量事件，而不是 `response.text()` 读完后的整包。
 *
 * - 只接管 `2xx` + `text/event-stream`，其余响应仍走统一信封；
 * - 显式 `cache-control: no-store` + `x-accel-buffering: no`，避免反向代理攒包；
 * - 客户端断开时中止上游请求，不让长连接在上游侧空转。
 */
function streamResponse(event: H3Event, response: Response, controller: AbortController): Response {
	event.node.res.once("close", () => controller.abort());

	return new Response(response.body, {
		status: response.status,
		headers: {
			"content-type": response.headers.get("content-type") ?? `${STREAM_CONTENT_TYPE}; charset=utf-8`,
			"cache-control": "no-store",
			"x-accel-buffering": "no"
		}
	});
}

function buildUpstreamUrl(event: H3Event, base: string, options: BffProxyOptions): string {
	const url = new URL(`${base.replace(/\/+$/, "")}/`);
	const segments = (Array.isArray(options.path) ? options.path : options.path.split("/"))
		.map((segment) => segment.trim())
		.filter(Boolean)
		.map((segment) => encodeURIComponent(segment));

	url.pathname = `${url.pathname.replace(/\/+$/, "")}/${segments.join("/")}`;

	const query = { ...getQuery(event), ...options.query };
	for (const key of options.stripQuery ?? []) {
		delete query[key];
	}

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

function buildUpstreamHeaders(event: H3Event, tokenCookieName: string, overrides?: Record<string, string | undefined>): Headers {
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

	// 鉴权只做透传：优先客户端 Authorization，其次预留的会话 cookie（本阶段不写入 cookie）
	const authorization = getHeader(event, "authorization");
	if (authorization) {
		headers.set("authorization", authorization);
	} else {
		const token = getCookie(event, tokenCookieName);
		if (token) {
			headers.set("authorization", `Bearer ${token}`);
		}
	}

	for (const [key, value] of Object.entries(overrides ?? {})) {
		if (value) {
			headers.set(key, value);
		} else {
			headers.delete(key);
		}
	}

	return headers;
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

/**
 * BFF 的唯一出站点：转发请求到上游，并把响应统一成 `ApiResponse<T>` 信封。
 *
 * - 上游不可达 → 502 `bff_upstream_unreachable`；超时 → 504 `bff_upstream_timeout`；
 * - 未配置上游 → 503 `bff_upstream_missing`（不静默返回空数据）；
 * - 上游非 2xx → 保留真实 HTTP 状态码 + `warning`（4xx）/`error`（5xx）语义；
 * - 上游非 2xx 且带业务码（`code > 599`，如 iam 的 20201）→ 保留业务码，便于 UI 分类；
 * - 上游裸 JSON → 包裹为 `{ code: 0, status: "success", data }`；已是信封则归一化后返回（`msg` → `message`）；
 * - 上游 `2xx` + `text/event-stream` → 原样流式透传（不套信封，见 `streamResponse`）；
 * - 原始上游报文只在 dev 下进入 `error_detail`，生产不泄露内网细节。
 */
export async function proxyToUpstream<T = unknown>(event: H3Event, options: BffProxyOptions): Promise<ApiResponse<T> | Response> {
	const config = getBffConfig(event);
	const base = (options.baseURL || config.upstreamBase).trim();

	if (!base) {
		return respond(event, 503, envelope(503, "error", BFF_UPSTREAM_MESSAGES.missing));
	}

	const method = (options.method ?? event.method).toUpperCase();
	const contentLength = Number(getHeader(event, "content-length") ?? 0);

	if (contentLength > MAX_BODY_BYTES) {
		return respond(event, 413, envelope(413, "warning", "bff_body_too_large"));
	}

	const body = options.body ?? (BODY_METHODS.has(method) ? await readRawBody(event, false) : undefined);
	const timeoutMs = options.timeoutMs ?? config.timeoutMs;

	let url: string;
	try {
		url = buildUpstreamUrl(event, base, options);
	} catch {
		return respond(event, 500, envelope(500, "error", BFF_UPSTREAM_MESSAGES.baseInvalid));
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const response = await fetch(url, {
			method,
			headers: buildUpstreamHeaders(event, config.tokenCookieName, options.headers),
			body: body && body.length ? body as unknown as BodyInit : undefined,
			signal: controller.signal,
			redirect: "manual"
		});

		const contentType = (response.headers.get("content-type") ?? "").toLowerCase();

		// SSE / 流式响应：不能 `response.text()`（会攒到流结束才回客户端）
		if (response.ok && contentType.startsWith(STREAM_CONTENT_TYPE)) {
			return streamResponse(event, response, controller);
		}

		const raw = await response.text();
		const payload = raw ? safeJsonParse(raw) : undefined;

		if (!response.ok) {
			return respond(event, response.status, normalizeUpstreamError(response.status, payload, raw));
		}

		if (!raw) {
			return respond(event, response.status, envelope(0, "success", "success"));
		}

		if (isApiEnvelope(payload)) {
			return respond(event, response.status, normalizeUpstreamEnvelope<T>(payload, response.status));
		}

		return respond(event, response.status, {
			code: 0,
			status: "success",
			message: "success",
			data: payload as T,
			timestamp: now()
		});
	} catch (error) {
		if (isAbortError(error)) {
			return respond(event, 504, envelope(504, "error", BFF_UPSTREAM_MESSAGES.timeout));
		}

		if (import.meta.dev) {
			console.error("[bff] upstream request failed", method, url, error);
		}

		return respond(event, 502, envelope(502, "error", BFF_UPSTREAM_MESSAGES.unreachable));
	} finally {
		clearTimeout(timer);
	}
}
