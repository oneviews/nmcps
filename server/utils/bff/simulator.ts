import type { H3Event } from "h3";
import type { SimulatorRoute } from "~~/shared/constants/simulatorRoutes";
import type { ApiResponse } from "~~/shared/types/api";
import { getHeader, getQuery, getRequestIP, readRawBody, setResponseHeader, setResponseStatus } from "h3";
import { SIMULATOR_MESSAGES } from "~~/shared/constants/upstreamReasons";
import { isApiEnvelope } from "~~/shared/utils/apiGuard";
import { getSimulatorConfig } from "./simConfig";

/**
 * 仿真平台（第二上游）的出站实现。
 *
 * 依据 NMCPS-ADR-0019 裁决 B 与 NMCPS-ARCH-002 §6.2 / §6.4：
 * 这里**故意不复用** `proxyToUpstream()` —— 后者会读 `nmcps_at` cookie 转成 `Bearer`，
 * 而仿真平台实测无需鉴权头，复用等于把访问令牌发给一个没有鉴权能力的上游；
 * 且两侧 401/403 语义不同，误触发单飞刷新会把一次局部失败升级成会话失效。
 *
 * 因此本文件的出站头只有 `accept` / `content-type` 一类：**没有** `authorization`，也不读任何 cookie。
 */

/** 允许透传给仿真平台的客户端请求头（白名单式，逐条对齐 ARCH-002 §6.4） */
const FORWARDED_REQUEST_HEADERS = ["accept", "content-type", "user-agent", "x-request-id"];

const BODY_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** 单次请求体上限：仿真控制都是小报文，超过 1MB 一定是调用错误 */
const MAX_BODY_BYTES = 1024 * 1024;

export interface SimulatorProxyOptions {
	/** 命中的白名单条目（动词来自这里，不信任调用方传入的 method） */
	route: SimulatorRoute
	/** 已解码的实际路径段（逐段 `encodeURIComponent` 后拼接） */
	segments: string[]
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

/** 仿真平台的错误体是 FastAPI 风格（`{ detail }`），个别端点回 `{ message }` / `{ msg }` */
function pickMessage(payload: unknown): string | undefined {
	const record = asRecord(payload);
	if (!record) {
		return typeof payload === "string" && payload.trim() ? payload.trim() : undefined;
	}

	const candidates = [record.message, record.msg, record.detail, record.error];
	return candidates.find((item): item is string => typeof item === "string" && item.trim().length > 0)?.trim();
}

function normalizeError(status: number, payload: unknown): ApiResponse<never> {
	return {
		code: status,
		status: status >= 500 ? "error" : "warning",
		message: pickMessage(payload) ?? (status >= 500 ? "simulator_error" : "simulator_rejected"),
		timestamp: now()
	};
}

/** 仿真平台回的是裸 JSON；万一某些端点已带 `{ code, msg, data }` 信封，也按主上游口径补齐 */
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
			: (typeof record.msg === "string" && record.msg.trim() ? record.msg : (code === 0 ? "success" : "simulator_rejected")),
		timestamp: typeof record.timestamp === "string" ? record.timestamp : now()
	} as ApiResponse<T>;
}

function respond<T>(event: H3Event, status: number, body: ApiResponse<T>): ApiResponse<T> {
	setResponseStatus(event, status);
	setResponseHeader(event, "content-type", "application/json; charset=utf-8");
	setResponseHeader(event, "cache-control", "no-store");
	return body;
}

function buildSimulatorUrl(event: H3Event, baseUrl: string, segments: string[]): string {
	const url = new URL(`${baseUrl}/`);
	url.pathname = `${url.pathname.replace(/\/+$/, "")}/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`;

	// 查询参数原样带给上游（仿真平台的过滤、分页都在上游做）；不追加任何鉴权参数
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

/** 出站头白名单：逐条取自客户端请求头，**永不注入** `authorization` 或任何 cookie */
function buildSimulatorHeaders(event: H3Event): Headers {
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
 * 写调用审计行（NMCPS-ARCH-002 §6.4）：**单行 JSON**，日志管道可直接解析。
 *
 * 取舍：
 * - 落「方法 + 模板 + 实际路径 + 结果 + 耗时 + `x-request-id` + 客户端 IP」，**不落请求体**
 *   （可能是拓扑改动细节，也可能是将来某个 PATCH 的凭据类字段）；
 * - 不落操作者身份：身份 cookie（`nmcps_ui`）的作用域是 `/api/auth`，本通道读不到它。
 *   「谁点的」按 `requestId` 与网关访问日志对齐，而不是在 BFF 里另存一份身份副本；
 * - 失败也记（504 / 502）：审计要覆盖「尝试过」而不只是「成功了」。
 */
function auditWrite(event: H3Event, options: SimulatorProxyOptions, status: number, startedAt: number): void {
	console.info(JSON.stringify({
		event: "simulator.write",
		method: options.route.method,
		template: options.route.template,
		path: `/${options.segments.join("/")}`,
		status,
		durationMs: Date.now() - startedAt,
		requestId: getHeader(event, "x-request-id") ?? null,
		clientIp: getRequestIP(event, { xForwardedFor: true }) ?? null
	}));
}

/**
 * 仿真平台的**唯一出站点**：转发到白名单命中的端点，并把响应归一成 `ApiResponse<T>`。
 *
 * - 通道未启用（`baseUrl` 为空）→ 503 `simulator_not_configured`，不静默返回空数据；
 * - 不可达 → 502 `simulator_unreachable`；超时 → 504 `simulator_timeout`；
 * - 上游非 2xx → 保留真实状态码（仿真平台的 405/422 是页面要展示的诊断信息）；
 * - 写调用记一行结构化审计日志（`{"event":"simulator.write",…}`，**不含请求体**，见 `auditWrite()`）；
 * - 不做 `list: null` 归一与凭据掩码：那是主上游的 D6/D7 口径，仿真平台没有这两类字段。
 */
export async function proxyToSimulator<T = unknown>(event: H3Event, options: SimulatorProxyOptions): Promise<ApiResponse<T>> {
	const config = getSimulatorConfig(event);

	if (!config.baseUrl) {
		return respond(event, 503, envelope(503, "error", SIMULATOR_MESSAGES.notConfigured));
	}

	const method = options.route.method;
	const contentLength = Number(getHeader(event, "content-length") ?? 0);

	if (contentLength > MAX_BODY_BYTES) {
		return respond(event, 413, envelope(413, "warning", "bff_body_too_large"));
	}

	const body = BODY_METHODS.has(method) ? await readRawBody(event, false) : undefined;

	let url: string;
	try {
		url = buildSimulatorUrl(event, config.baseUrl, options.segments);
	} catch {
		return respond(event, 500, envelope(500, "error", SIMULATOR_MESSAGES.baseInvalid));
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), config.timeoutMs);
	const startedAt = Date.now();

	try {
		const response = await fetch(url, {
			method,
			headers: buildSimulatorHeaders(event),
			body: body && body.length ? body as unknown as BodyInit : undefined,
			signal: controller.signal,
			redirect: "manual"
		});

		const raw = await response.text();
		const payload = raw ? safeJsonParse(raw) : undefined;

		if (options.route.write) {
			auditWrite(event, options, response.status, startedAt);
		}

		if (!response.ok) {
			return respond(event, response.status, normalizeError(response.status, payload));
		}

		if (!raw) {
			return respond(event, response.status, envelope(0, "success", "success"));
		}

		if (isApiEnvelope(payload)) {
			return respond(event, response.status, normalizeEnvelope<T>(payload, response.status));
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
			if (options.route.write)
				auditWrite(event, options, 504, startedAt);

			return respond(event, 504, envelope(504, "error", SIMULATOR_MESSAGES.timeout));
		}

		if (import.meta.dev) {
			console.error("[sim] upstream request failed", method, options.route.template, error);
		}

		if (options.route.write)
			auditWrite(event, options, 502, startedAt);

		return respond(event, 502, envelope(502, "error", SIMULATOR_MESSAGES.unreachable));
	} finally {
		clearTimeout(timer);
	}
}
