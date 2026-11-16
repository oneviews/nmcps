import type { H3Event } from "h3";
import type { ApiResponse } from "~~/shared/types/api";
import type { LabNetworkRecord } from "~~/shared/types/lab";
import type { MininetMatch } from "#layers/scenario/shared/constants/mininetRoutes";
import type { MininetConfig } from "./mininetConfig";
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
	network: LabNetworkRecord
): ApiResponse<T> | ApiResponse<never> {
	if (body.code !== 0 || body.data === undefined) {
		return body;
	}

	const { value, dropped } = filterLabPayload(body.data, { network });
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
	/** 已由调用方序列化的 JSON 请求体（仅写端点；不大于 `LAB_WRITE_BODY_LIMIT`） */
	body?: string
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
	const headers = buildMininetHeaders(event, method !== "GET" && options.body !== undefined);

	try {
		const response = await fetch(url, {
			method,
			headers,
			...(options.body !== undefined && method !== "GET" ? { body: options.body } : {}),
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
			const scoped = options.network ? scopeExit(event, body, options.network) : body;
			return respond(event, response.status, scoped);
		}

		const body: ApiResponse<T> = {
			code: 0,
			status: "success",
			message: "success",
			data: payload as T,
			timestamp: now()
		};
		const scoped = options.network ? scopeExit(event, body, options.network) : body;
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
