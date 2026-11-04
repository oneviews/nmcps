import type { ApiResponse } from "~~/shared/types/api";
import type { AuthRefreshResult } from "~~/shared/types/auth";
import { defineEventHandler } from "h3";
import {
	applySessionCookies,
	assertCookieCsrf,
	authFailureResponse,
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
 * `POST /api/auth/refresh` → 上游 `POST /api/v1/iam/refresh`（传 `{ refresh_token }`）。
 *
 * 新代**不轮换**（NMCPS-ADR-0018 D4）：上游只回 `access_token` / `expires_in`，
 * 同一个刷新令牌可以反复使用（2026-11-04 实测：连用两次均 200）。因此：
 * - 刷新令牌缺省沿用请求里的旧值，cookie / 桌面令牌仓不会被清空；
 * - BFF 仍只在业务请求 401 后被动刷新（ADR-0011 的单飞策略不变）；
 * - 刷新令牌失效时上游回 **HTTP 200 + `code: 10007`**，这里还原为 401 并清会话 cookie。
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

	const refreshToken = parsed.data.refresh_token ?? readRefreshToken(event);
	if (!refreshToken) {
		return respondAuth(event, 401, "bff_refresh_missing");
	}

	const upstream = await callAuthUpstream<Record<string, unknown>>(event, "iam/refresh", {
		method: "POST",
		json: { refresh_token: refreshToken },
		authorization: null
	});

	if (!isAuthSuccess(upstream)) {
		clearSessionCookies(event);
		return authFailureResponse(event, upstream, 401);
	}

	const tokens = toAuthTokens(upstream.data, refreshToken);

	if (!tokens) {
		clearSessionCookies(event);
		return respondAuth(event, 502, "bff_upstream_contract_violation");
	}

	if (isDesktopClient(event)) {
		return respondAuth(event, 200, "success", {
			data: { expiresIn: tokens.expires_in, tokens }
		});
	}

	// 不传 `user`：身份 cookie 保持登录时的原样，刷新只延展凭据
	applySessionCookies(event, tokens);

	return respondAuth(event, 200, "success", {
		data: { expiresIn: tokens.expires_in }
	});
});
