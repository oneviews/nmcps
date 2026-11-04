import type { ApiResponse } from "~~/shared/types/api";
import type { AuthLoginResult } from "~~/shared/types/auth";
import { defineEventHandler } from "h3";
import {
	applySessionCookies,
	authFailureResponse,
	callAuthUpstream,
	isAuthSuccess,
	isDesktopClient,
	respondAuth,
	toAuthTokens,
	toAuthUser
} from "~~/server/utils/bff/auth";
import { authLoginSchema, parseAuthBody } from "~~/server/utils/bff/authSchema";

/**
 * `POST /api/auth/login` → 上游 `POST /api/v1/iam/login`（传 `{ username, password }`）。
 *
 * - 先 zod 校验：缺字段时上游回 `500 10509`，BFF 必须挡在前面；
 * - 上游业务失败走 `HTTP 200 + code≠0`（实测口令错 = `10003`），这里还原为 **401**；
 * - 身份取 `data.user_info`（新代直接给 `display_name`，且没有 `whoami`，NMCPS-ADR-0018 D3）；
 * - Web：令牌落 HttpOnly cookie、身份落 `nmcps_ui`，响应体**不含**令牌；
 * - 桌面（`x-nmcps-client: desktop`）：响应体回传 `tokens`（snake_case），BFF 不写 cookie。
 */
export default defineEventHandler(async (
	event
): Promise<ApiResponse<AuthLoginResult> | ApiResponse<never>> => {
	const parsed = await parseAuthBody(event, authLoginSchema);
	if (!parsed.ok) {
		return parsed.response;
	}

	const upstream = await callAuthUpstream<Record<string, unknown>>(event, "iam/login", {
		method: "POST",
		json: parsed.data,
		authorization: null
	});

	if (!isAuthSuccess(upstream)) {
		// 登录失败一律 401：口径「没换到令牌就是没登录上」，业务码（10003）原样带回前端
		return authFailureResponse(event, upstream, 401);
	}

	const payload = upstream.data ?? {};
	const tokens = toAuthTokens(payload);
	const user = toAuthUser(payload);

	if (!tokens || !user) {
		return respondAuth(event, 502, "bff_upstream_contract_violation");
	}

	const result: AuthLoginResult = {
		user,
		expiresIn: tokens.expires_in
	};

	if (isDesktopClient(event)) {
		result.tokens = tokens;
	} else {
		applySessionCookies(event, tokens, user);
	}

	return respondAuth(event, 200, "success", { data: result });
});
