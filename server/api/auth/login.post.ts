import type { ApiResponse } from "~~/shared/types/api";
import type { AuthLoginResult } from "~~/shared/types/auth";
import { defineEventHandler } from "h3";
import {
	applySessionCookies,
	asAuthFailure,
	callAuthUpstream,
	isAuthSuccess,
	isDesktopClient,
	respondAuth,
	toAuthTokens,
	toAuthUser
} from "~~/server/utils/bff/auth";
import { authLoginSchema, parseAuthBody } from "~~/server/utils/bff/authSchema";

/**
 * `POST /api/auth/login` → 上游 `POST /api/v1/auth/login`。
 *
 * - 先 zod 校验：上游收到空 body 会返回 500 `10509`，BFF 必须挡在前面（NMCPS-ADR-0011）；
 * - Web：令牌写 HttpOnly cookie（`nmcps_at` / `nmcps_rt`），响应体**不含**令牌；
 * - 桌面（`x-nmcps-client: desktop`）：响应体回传 `tokens`，由 `useAuthTokens()` 存入
 *   `tauri-plugin-store`，BFF 侧不写 cookie。
 */
export default defineEventHandler(async (
	event
): Promise<ApiResponse<AuthLoginResult> | ApiResponse<never>> => {
	const parsed = await parseAuthBody(event, authLoginSchema);
	if (!parsed.ok) {
		return parsed.response;
	}

	const upstream = await callAuthUpstream<Record<string, unknown>>(event, "auth/login", {
		method: "POST",
		json: parsed.data,
		authorization: null
	});

	if (!isAuthSuccess(upstream)) {
		return asAuthFailure(upstream);
	}

	const payload = upstream.data ?? {};
	const tokens = toAuthTokens(payload);
	// 登录不返回 accountName / displayName：用登录名兜底，显示名保持 null
	const user = toAuthUser(payload, parsed.data.accountName);

	if (!tokens || !user) {
		return respondAuth(event, 502, "bff_upstream_contract_violation");
	}

	const result: AuthLoginResult = {
		user,
		expiresIn: tokens.expiresIn,
		// 上游会话标志位；缺失按 false（登录成功即无二次校验要求）
		mfaRequired: payload.mfaRequired === true,
		mustResetPassword: payload.mustResetPassword === true
	};

	if (isDesktopClient(event)) {
		result.tokens = tokens;
	} else {
		applySessionCookies(event, tokens);
	}

	return respondAuth(event, 200, "success", { data: result });
});
