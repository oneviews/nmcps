import type { ApiResponse } from "~~/shared/types/api";
import type { AuthMfaBindResult } from "~~/shared/types/auth";
import { defineEventHandler } from "h3";
import {
	asAuthFailure,
	assertCookieCsrf,
	callAuthUpstream,
	isAuthSuccess,
	readAccessToken,
	respondAuth
} from "~~/server/utils/bff/auth";
import { authMfaBindSchema, parseAuthBody } from "~~/server/utils/bff/authSchema";

/**
 * `POST /api/auth/mfa/bind` → 上游 `POST /api/v1/auth/mfa/bind`。
 *
 * 绑定是**破坏性**操作（会重置已有 TOTP 密钥），故要求 `x-nmcps-client` 之外的
 * 常规鉴权 + CSRF 校验；返回的 `otpauthUrl` 只应一次性展示（不入日志、不落库）。
 */
export default defineEventHandler(async (
	event
): Promise<ApiResponse<AuthMfaBindResult> | ApiResponse<never>> => {
	const csrf = assertCookieCsrf(event);
	if (csrf) {
		return csrf;
	}

	const parsed = await parseAuthBody(event, authMfaBindSchema);
	if (!parsed.ok) {
		return parsed.response;
	}

	const token = readAccessToken(event);
	if (!token) {
		return respondAuth(event, 401, "bff_auth_required");
	}

	const upstream = await callAuthUpstream<Record<string, unknown>>(event, "auth/mfa/bind", {
		method: "POST",
		json: parsed.data.mfaType === undefined ? {} : { mfaType: parsed.data.mfaType },
		authorization: token
	});

	if (!isAuthSuccess(upstream)) {
		return asAuthFailure(upstream);
	}

	const otpauthUrl = upstream.data?.otpauthUrl;

	if (typeof otpauthUrl !== "string" || !otpauthUrl.trim()) {
		return respondAuth(event, 502, "bff_upstream_contract_violation");
	}

	return respondAuth(event, 200, "success", { data: { otpauthUrl } });
});
