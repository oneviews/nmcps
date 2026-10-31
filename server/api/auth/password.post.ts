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
import { authPasswordSchema, parseAuthBody } from "~~/server/utils/bff/authSchema";

/**
 * `POST /api/auth/password` → 上游 `POST /api/v1/auth/password`。
 *
 * 改密是否连带作废当前会话上游**未确认**（NMCPS-ADR-0011 的遗留项），因此这里
 * 不主动清 cookie：若确实作废，下一次业务请求 401 → 刷新 401 → 前端登出，
 * 行为仍然自洽；若未作废，用户不必被迫重登。
 */
export default defineEventHandler(async (
	event
): Promise<ApiResponse<AuthOkResult> | ApiResponse<never>> => {
	const csrf = assertCookieCsrf(event);
	if (csrf) {
		return csrf;
	}

	const parsed = await parseAuthBody(event, authPasswordSchema);
	if (!parsed.ok) {
		return parsed.response;
	}

	const token = readAccessToken(event);
	if (!token) {
		return respondAuth(event, 401, "bff_auth_required");
	}

	const upstream = await callAuthUpstream(event, "auth/password", {
		method: "POST",
		json: parsed.data,
		authorization: token
	});

	if (!isAuthSuccess(upstream)) {
		return asAuthFailure(upstream);
	}

	return respondAuth(event, 200, "success", { data: { ok: true } });
});
