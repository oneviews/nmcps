import type { ApiResponse } from "~~/shared/types/api";
import type { AuthRefreshResult } from "~~/shared/types/auth";
import { defineEventHandler } from "h3";
import {
	applySessionCookies,
	asAuthFailure,
	assertCookieCsrf,
	callAuthUpstream,
	clearSessionCookies,
	isAuthSuccess,
	isDesktopClient,
	readRefreshToken,
	respondAuth,
	toAuthTokens
} from "~~/server/utils/bff/auth";
import { authRefreshSchema, parseAuthBody } from "~~/server/utils/bff/authSchema";

/**
 * `POST /api/auth/refresh` → 上游 `POST /api/v1/auth/token/refresh`。
 *
 * 上游刷新即**轮换**：`sessionId` 变化、旧访问令牌立即 401，因此本端点只能由
 * `useApi` 在业务请求 401 后单飞调用（不预刷新，NMCPS-ADR-0011）。
 *
 * - Web：刷新令牌取自 cookie（`nmcps_rt`，`Path=/api/auth`），成功后轮换双 cookie；
 * - 桌面：请求体带 `refreshToken`，响应体回传新 `tokens`；
 * - 刷新失败：清空 cookie 并把上游错误原样回传（客户端据此退出登录，不再重试）。
 */
export default defineEventHandler(async (
	event
): Promise<ApiResponse<AuthRefreshResult> | ApiResponse<never>> => {
	const csrf = assertCookieCsrf(event);
	if (csrf) {
		return csrf;
	}

	const parsed = await parseAuthBody(event, authRefreshSchema);
	if (!parsed.ok) {
		return parsed.response;
	}

	const refreshToken = parsed.data.refreshToken ?? readRefreshToken(event);
	if (!refreshToken) {
		return respondAuth(event, 401, "bff_refresh_missing");
	}

	const upstream = await callAuthUpstream<Record<string, unknown>>(event, "auth/token/refresh", {
		method: "POST",
		json: { refreshToken },
		authorization: null
	});

	if (!isAuthSuccess(upstream)) {
		clearSessionCookies(event);
		return asAuthFailure(upstream);
	}

	const tokens = toAuthTokens(upstream.data);

	if (!tokens) {
		clearSessionCookies(event);
		return respondAuth(event, 502, "bff_upstream_contract_violation");
	}

	if (isDesktopClient(event)) {
		return respondAuth(event, 200, "success", {
			data: { expiresIn: tokens.expiresIn, tokens }
		});
	}

	applySessionCookies(event, tokens);

	return respondAuth(event, 200, "success", {
		data: { expiresIn: tokens.expiresIn }
	});
});
