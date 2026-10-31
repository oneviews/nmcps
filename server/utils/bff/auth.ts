import type { H3Event } from "h3";
import type { ApiResponse, ValidationError } from "~~/shared/types/api";
import type { AuthTokens, AuthUser } from "~~/shared/types/auth";
import {
	deleteCookie,
	getCookie,
	getHeader,
	getRequestHost,
	getRequestProtocol,
	setCookie,
	setResponseHeader,
	setResponseStatus
} from "h3";
import { getBffConfig, isOriginAllowed } from "./config";
import { proxyToUpstream } from "./proxy";

/**
 * `/api/auth/*` 的会话实现：令牌落 HttpOnly cookie（web）/ 回传 body（桌面）。
 *
 * 裁决见 NMCPS-ADR-0011（layers/content/collections/cn/records/adr/adr-0011.md）：
 * - 刷新即轮换：上游每次 refresh 换 `sessionId` 并作废旧 AT，故只在 401 后单飞刷新；
 * - 登出不幂等：BFF 吞掉上游 401，恒返回 `{ ok: true }`；
 * - cookie 模式下非安全动词校验 `Origin`，防 CSRF。
 */

/** 桌面端标识头：命中时登录/刷新在响应体回传令牌（存储层由 `useAuthTokens()` 负责） */
export const DESKTOP_CLIENT_HEADER = "x-nmcps-client";
export const DESKTOP_CLIENT_VALUE = "desktop";

/** 刷新令牌 cookie 的作用域：只有 `/api/auth/*` 能看到它，业务请求不携带 */
const REFRESH_COOKIE_PATH = "/api/auth";

/** 访问令牌 cookie 作用域：全站（`proxy.ts` 读它并转成上游 Bearer） */
const ACCESS_COOKIE_PATH = "/";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** 上游「会话失效 / 未认证」业务码（refresh 时旧令牌被轮换、logout 重复调用） */
const SESSION_INVALID_CODES = new Set([401, 10201, 20205]);

export function authTimestamp(): string {
	return new Date().toISOString();
}

export interface AuthRespondOptions<T> {
	data?: T
	/** 覆盖 `code`（默认：4xx/5xx 用 HTTP 状态码，2xx 用 0） */
	code?: number
	details?: ValidationError[]
}

/** 直接写响应状态并返回 BFF 信封（与 `proxy.ts` 同构，前端统一走 `ApiError`） */
export function respondAuth<T>(
	event: H3Event,
	status: number,
	message: string,
	options: AuthRespondOptions<T> = {}
): ApiResponse<T> {
	setResponseStatus(event, status);
	setResponseHeader(event, "content-type", "application/json; charset=utf-8");
	setResponseHeader(event, "cache-control", "no-store");

	const body: ApiResponse<T> = {
		code: options.code ?? (status >= 400 ? status : 0),
		status: status >= 500 ? "error" : (status >= 400 ? "warning" : "success"),
		message,
		timestamp: authTimestamp()
	};

	if (options.data !== undefined) {
		body.data = options.data;
	}

	if (options.details?.length) {
		body.error_detail = options.details;
	}

	return body;
}

/** 上游是否因「会话/令牌无效」而拒绝 */
export function isSessionInvalid(res: ApiResponse<unknown>): boolean {
	return !isAuthSuccess(res) && SESSION_INVALID_CODES.has(res.code);
}

export function isAuthSuccess<T>(res: ApiResponse<T>): res is ApiResponse<T> & { data: T } {
	return res.status !== "warning" && res.status !== "error" && res.code === 0;
}

export function isDesktopClient(event: H3Event): boolean {
	return (getHeader(event, DESKTOP_CLIENT_HEADER) ?? "").trim().toLowerCase() === DESKTOP_CLIENT_VALUE;
}

/** 显式 `Authorization: Bearer …`（桌面）/ 会话 cookie（web）里取访问令牌 */
export function readAccessToken(event: H3Event): string | undefined {
	const config = getBffConfig(event);
	const header = (getHeader(event, "authorization") ?? "").trim();

	if (header.toLowerCase().startsWith("bearer ")) {
		const token = header.slice(7).trim();
		return token || undefined;
	}

	return getCookie(event, config.tokenCookieName) || undefined;
}

export function readRefreshToken(event: H3Event): string | undefined {
	const config = getBffConfig(event);
	return getCookie(event, config.refreshCookieName) || undefined;
}

function isSecureRequest(event: H3Event): boolean {
	// 反向代理（TLS 终止）场景下以 `x-forwarded-proto` 为准
	return getRequestProtocol(event, { xForwardedProto: true }) === "https";
}

function toMaxAge(ms: number): number {
	return Math.max(60, Math.floor(ms / 1000));
}

/** 写入双 cookie；`expiresIn`（秒，上游口径）优先于兜底配置 */
export function applySessionCookies(event: H3Event, tokens: AuthTokens): void {
	const config = getBffConfig(event);
	const secure = isSecureRequest(event);
	const accessTtl = Number.isFinite(tokens.expiresIn) && tokens.expiresIn > 0
		? tokens.expiresIn * 1000
		: config.accessTtlMs;

	setCookie(event, config.tokenCookieName, tokens.accessToken, {
		httpOnly: true,
		sameSite: "lax",
		secure,
		path: ACCESS_COOKIE_PATH,
		maxAge: toMaxAge(accessTtl)
	});

	setCookie(event, config.refreshCookieName, tokens.refreshToken, {
		httpOnly: true,
		sameSite: "lax",
		secure,
		path: REFRESH_COOKIE_PATH,
		maxAge: toMaxAge(config.refreshTtlMs)
	});
}

export function clearSessionCookies(event: H3Event): void {
	const config = getBffConfig(event);

	deleteCookie(event, config.tokenCookieName, { path: ACCESS_COOKIE_PATH });
	deleteCookie(event, config.refreshCookieName, { path: REFRESH_COOKIE_PATH });
}

/**
 * cookie 模式的 CSRF 防护：非安全动词必须来自同源，或命中 `allowedOrigins` 白名单。
 *
 * - 带 `Authorization` 的请求不受 CSRF 影响（浏览器不会自动附带），直接放行；
 * - 判定失败返回 403 `bff_csrf_rejected`，调用方原样返回即可。
 */
export function assertCookieCsrf(event: H3Event): ApiResponse<never> | undefined {
	if (SAFE_METHODS.has(event.method.toUpperCase())) {
		return undefined;
	}

	if ((getHeader(event, "authorization") ?? "").trim()) {
		return undefined;
	}

	const origin = (getHeader(event, "origin") ?? "").trim();
	if (!origin) {
		return respondAuth(event, 403, "bff_csrf_rejected");
	}

	try {
		const host = getRequestHost(event, { xForwardedHost: true });
		if (new URL(origin).host === host) {
			return undefined;
		}
	} catch {
		return respondAuth(event, 403, "bff_csrf_rejected");
	}

	const { allowedOrigins } = getBffConfig(event);
	if (!isOriginAllowed(origin, allowedOrigins)) {
		return respondAuth(event, 403, "bff_csrf_rejected");
	}

	return undefined;
}

/**
 * 调用上游 `/api/v1/auth/*`（全部经 `proxyToUpstream`，错误信封与业务路由一致）。
 *
 * `authorization` 显式传值：`null` 表示「不带凭据」并**丢弃**客户端自带凭据
 * （登录 / 刷新 / 登出场景），字符串则覆盖为 `Bearer <token>`；
 * `undefined` 交给代理按 cookie / Authorization 兜底。
 */
export interface AuthUpstreamOptions {
	method?: "GET" | "POST" | "PUT" | "DELETE"
	/** JSON 载荷（会被 `JSON.stringify`）；`undefined` 表示不发送 body */
	json?: unknown
	/** 原始 body（登出需要**空 body** + `x-www-form-urlencoded`） */
	rawBody?: string
	contentType?: string
	authorization?: string | null
}

export async function callAuthUpstream<T>(
	event: H3Event,
	path: string,
	options: AuthUpstreamOptions = {}
): Promise<ApiResponse<T>> {
	const method = options.method ?? "POST";
	const hasJson = options.json !== undefined;
	const headers: Record<string, string | undefined> = {};

	if (options.authorization !== undefined) {
		headers.authorization = options.authorization === null ? "" : `Bearer ${options.authorization}`;
	}

	const contentType = options.contentType ?? (hasJson ? "application/json" : undefined);
	if (contentType) {
		headers["content-type"] = contentType;
	}

	let body: string | undefined;
	if (hasJson) {
		body = JSON.stringify(options.json);
	} else if (options.rawBody !== undefined) {
		body = options.rawBody;
	} else if (method !== "GET") {
		body = "";
	}

	const result = await proxyToUpstream<T>(event, { path, method, headers, body });

	if (result instanceof Response) {
		// 认证端点不会返回流式响应；真出现就显式报错，不静默吞掉
		return respondAuth(event, 502, "bff_upstream_unexpected_response");
	}

	return result;
}

/** 上游失败 → 原样回给客户端（`proxy.ts` 已写好状态码与业务码），只做类型收窄 */
export function asAuthFailure<T>(res: ApiResponse<T>): ApiResponse<never> {
	const { data: _data, ...rest } = res;
	return rest;
}
function toNumberOrNull(value: unknown): number | null {
	const candidate = Number(value);
	return value === null || value === undefined || value === "" || !Number.isFinite(candidate)
		? null
		: candidate;
}

function toStringOrNull(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

/**
 * 上游登录/登录态载荷 → `AuthUser`。
 *
 * 字段保真、缺失即 `null`：登录不返回 `displayName` / `mfaEnabled`，
 * 这里绝不用 `accountCode` 冒充显示名，也不把「未知」写成 `false`。
 */
export function toAuthUser(payload: unknown, fallbackAccountName?: string): AuthUser | null {
	const record = asRecord(payload);
	if (!record) {
		return null;
	}

	const accountName = toStringOrNull(record.accountName)
		?? toStringOrNull(fallbackAccountName)
		?? toStringOrNull(record.accountCode);

	if (!accountName) {
		return null;
	}

	return {
		accountCode: toStringOrNull(record.accountCode) ?? accountName,
		accountName,
		displayName: toStringOrNull(record.displayName),
		tenantId: toNumberOrNull(record.tenantId),
		accountLevel: toNumberOrNull(record.accountLevel),
		mfaEnabled: typeof record.mfaEnabled === "boolean" ? record.mfaEnabled : null,
		sessionId: toStringOrNull(record.sessionId) ?? ""
	};
}

/** 上游令牌载荷 → `AuthTokens`；字段不全返回 `null`（宁可失败，也不下发半截令牌） */
export function toAuthTokens(payload: unknown): AuthTokens | null {
	const record = asRecord(payload);
	const accessToken = toStringOrNull(record?.accessToken);
	const refreshToken = toStringOrNull(record?.refreshToken);

	if (!accessToken || !refreshToken) {
		return null;
	}

	return {
		accessToken,
		refreshToken,
		expiresIn: toNumberOrNull(record?.expiresIn) ?? 0,
		sessionId: toStringOrNull(record?.sessionId) ?? ""
	};
}
