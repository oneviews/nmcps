import type { ApiResponse } from "~~/shared/types/api";
import type { AuthOkResult } from "~~/shared/types/auth";
import { defineEventHandler } from "h3";
import {
	asAuthFailure,
	assertCookieCsrf,
	callAuthUpstream,
	isAuthSuccess,
	readAccessToken,
	respondAuth
} from "~~/server/utils/bff/auth";
import { authMfaConfirmSchema, parseAuthBody } from "~~/server/utils/bff/authSchema";

/**
 * `POST /api/auth/mfa/confirm` → 上游 `POST /api/v1/auth/mfa/confirm`。
 *
 * 用 `bind` 拿到的一次性口令完成绑定；失败原样透传上游业务码（如口令错）。
 */
export default defineEventHandler(async (
	event
): Promise<ApiResponse<AuthOkResult> | ApiResponse<never>> => {
	const csrf = assertCookieCsrf(event);
	if (csrf) {
		return csrf;
	}

	const parsed = await parseAuthBody(event, authMfaConfirmSchema);
	if (!parsed.ok) {
		return parsed.response;
	}

	const token = readAccessToken(event);
	if (!token) {
		return respondAuth(event, 401, "bff_auth_required");
	}

	const upstream = await callAuthUpstream(event, "auth/mfa/confirm", {
		method: "POST",
		json: parsed.data,
		authorization: token
	});

	if (!isAuthSuccess(upstream)) {
		return asAuthFailure(upstream);
	}

	return respondAuth(event, 200, "success", { data: { ok: true } });
});
