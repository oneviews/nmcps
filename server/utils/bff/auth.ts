import type { H3Event } from "h3";
import type { ApiResponse, ValidationError } from "~~/shared/types/api";
import type { AuthUser, IamTokens } from "~~/shared/types/auth";
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
 * 裁决见 NMCPS-ADR-0018（layers/content/collections/cn/records/adr/adr-0018.md）与
 * NMCPS-ADR-0011（…/adr-0011.md）：
 * - 刷新**不轮换**：新代 `POST /iam/refresh` 只回 `access_token` / `expires_in`，
 *   旧刷新令牌继续有效（D4 取代 ADR-0011 的轮换条款）；仍在 401 后单飞刷新；
 * - 身份不再有 `whoami`（D3）：登录时的 `user_info` 落 `nmcps_ui` cookie，会话由它派生；
 * - 登出上游幂等（实测重复调用仍 200），BFF 仍吞掉任何失败、恒返回 `{ ok: true }`；
 * - cookie 模式下非安全动词校验 `Origin`，防 CSRF。
 */

/** 桌面端标识头：命中时登录/刷新在响应体回传令牌（存储层由 `useAuthTokens()` 负责） */
export const DESKTOP_CLIENT_HEADER = "x-nmcps-client";
export const DESKTOP_CLIENT_VALUE = "desktop";

/** 刷新令牌 cookie 的作用域：只有 `/api/auth/*` 能看到它，业务请求不携带 */
const REFRESH_COOKIE_PATH = "/api/auth";

/** 访问令牌 cookie 作用域：全站（`proxy.ts` 读它并转成上游 Bearer） */
const ACCESS_COOKIE_PATH = "/";

/**
 * 身份 cookie（`user_info` 的 JSON）：只有 `/api/auth/*` 可见。
 *
 * 新代没有 `whoami`（NMCPS-ADR-0018 D3），会话只能由登录时落下的身份派生；
 * 单独放一个 cookie 而不塞进访问令牌，是为了让「身份」与「凭据」各自可清空。
 */
const USER_COOKIE_NAME = "nmcps_ui";
const USER_COOKIE_PATH = "/api/auth";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * 上游「会话失效 / 未认证」业务码（新代 iam）。
 *
 * - `40101`：未认证 / 登录态失效（实测 refresh_token 缺失）；
 * - `10007`：无效的认证令牌（实测 `POST /iam/refresh` 用坏令牌 → **HTTP 200 + 10007**，
 *   不是 401！漏掉它，BFF 就识别不出「刷新已失效」，旧 cookie 清不掉）；
 * - `401`：HTTP 语义兜底。
 */
const SESSION_INVALID_CODES = new Set([401, 40101, 10007]);

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

/**
 * 写入会话 cookie。
 *
 * - 访问令牌恒写（`expires_in` 秒优先，缺省用配置兜底）；
 * - 刷新令牌**只有上游真的给了**才写：新代刷新不轮换（D4），没给就沿用旧 cookie，
 *   别把「上游没回」写成「清空刷新令牌」；登录时上游必给，故登录总能落下；
 * - `user` 非空时同步落身份 cookie（会话的唯一来源，D3）。
 */
export function applySessionCookies(event: H3Event, tokens: IamTokens, user?: AuthUser): void {
	const config = getBffConfig(event);
	const secure = isSecureRequest(event);
	const accessTtl = Number.isFinite(tokens.expires_in) && tokens.expires_in > 0
		? tokens.expires_in * 1000
		: config.accessTtlMs;

	setCookie(event, config.tokenCookieName, tokens.access_token, {
		httpOnly: true,
		sameSite: "lax",
		secure,
		path: ACCESS_COOKIE_PATH,
		maxAge: toMaxAge(accessTtl)
	});

	if (tokens.refresh_token) {
		setCookie(event, config.refreshCookieName, tokens.refresh_token, {
			httpOnly: true,
			sameSite: "lax",
			secure,
			path: REFRESH_COOKIE_PATH,
			maxAge: toMaxAge(config.refreshTtlMs)
		});
	}

	if (user) {
		setCookie(event, USER_COOKIE_NAME, JSON.stringify(user), {
			httpOnly: true,
			sameSite: "lax",
			secure,
			path: USER_COOKIE_PATH,
			maxAge: toMaxAge(config.refreshTtlMs)
		});
	}
}

/** 读取身份 cookie（无 `whoami` 时的会话来源）；解析失败一律当「无身份」 */
export function readSessionUser(event: H3Event): AuthUser | null {
	const raw = getCookie(event, USER_COOKIE_NAME);
	if (!raw) {
		return null;
	}

	try {
		const parsed: unknown = JSON.parse(raw);
		const record = asRecord(parsed);
		const username = toStringOrNull(record?.username);

		if (!record || !username) {
			return null;
		}

		return {
			id: toStringOrNull(record.id) ?? "",
			username,
			displayName: toStringOrNull(record.displayName),
			email: toStringOrNull(record.email),
			phone: toStringOrNull(record.phone),
			tenantId: toStringOrNull(record.tenantId)
		};
	} catch {
		return null;
	}
}

export function clearSessionCookies(event: H3Event): void {
	const config = getBffConfig(event);

	deleteCookie(event, config.tokenCookieName, { path: ACCESS_COOKIE_PATH });
	deleteCookie(event, config.refreshCookieName, { path: REFRESH_COOKIE_PATH });
	deleteCookie(event, USER_COOKIE_NAME, { path: USER_COOKIE_PATH });
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
/**
 * 上游失败 → 客户端可见的失败信封。
 *
 * 新代 iam 把业务错误塞进 **HTTP 200 + `code≠0`**（实测：口令错 `10003`、坏刷新令牌
 * `10007`），若原样回 200，客户端只能靠解析 `code` 才知道失败。BFF 在这里还原语义：
 * - 会话失效（`40101` / `10007` / `401`）→ 401；
 * - 其它业务错误 → 调用方指定的状态（登录 401、改密 400）；
 * - 纯 HTTP 错误（无业务码）→ 原样透传上游状态码。
 */
export function authFailureResponse(event: H3Event, res: ApiResponse<unknown>, businessStatus = 400): ApiResponse<never> {
	const isBusinessCode = res.code >= 10_000;

	if (!isBusinessCode) {
		return asAuthFailure(res);
	}

	const status = SESSION_INVALID_CODES.has(res.code) ? 401 : businessStatus;

	return respondAuth(event, status, res.message || "upstream_rejected", { code: res.code });
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
 * 上游登录载荷 → `AuthUser`。
 *
 * 身份在 `data.user_info` 里（2026-11-04 实测）；也接受已经摊平的 `user_info`，
 * 方便同一个函数处理「登录响应」与「cookie 里存过的 user」。
 * 字段保真、缺失即 `null`：`phone: ""` 归一为 `null`，绝不编造显示名。
 */
export function toAuthUser(payload: unknown): AuthUser | null {
	const info = asRecord(asRecord(payload)?.user_info) ?? asRecord(payload);
	const username = toStringOrNull(info?.username);

	if (!username) {
		return null;
	}

	return {
		id: toStringOrNull(info?.id) ?? "",
		username,
		displayName: toStringOrNull(info?.display_name),
		email: toStringOrNull(info?.email),
		phone: toStringOrNull(info?.phone),
		tenantId: toStringOrNull(info?.tenant_id)
	};
}

/**
 * 上游令牌载荷 → `IamTokens`（字段名原样，snake_case）。
 *
 * 刷新响应不带 `refresh_token`（不轮换，D4）：此时沿用调用方给的 `fallbackRefreshToken`，
 * 让上层能把同一个刷新令牌继续写回 cookie / 桌面令牌仓。访问令牌缺失返回 `null`
 * —— 宁可失败，也不下发半截令牌。
 */
export function toAuthTokens(payload: unknown, fallbackRefreshToken?: string): IamTokens | null {
	const record = asRecord(payload);
	const accessToken = toStringOrNull(record?.access_token);

	if (!accessToken) {
		return null;
	}

	const refreshToken = toStringOrNull(record?.refresh_token) ?? toStringOrNull(fallbackRefreshToken);

	return {
		access_token: accessToken,
		...(refreshToken ? { refresh_token: refreshToken } : {}),
		expires_in: toNumberOrNull(record?.expires_in) ?? 0
	};
}
