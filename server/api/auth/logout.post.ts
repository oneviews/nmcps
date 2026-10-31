import type { ApiResponse } from "~~/shared/types/api";
import type { AuthOkResult } from "~~/shared/types/auth";
import { defineEventHandler } from "h3";
import {
	assertCookieCsrf,
	callAuthUpstream,
	clearSessionCookies,
	readAccessToken,
	respondAuth
} from "~~/server/utils/bff/auth";

/**
 * `POST /api/auth/logout` → 上游 `POST /api/v1/auth/logout`。
 *
 * 上游登出**不幂等**（第二次调用 401 `10201`），且要求空 body +
 * `x-www-form-urlencoded`。BFF 因此：
 * - 吞掉上游任何结果（含 401 / 5xx / 不可达），只清本地会话；
 * - 恒返回 `{ ok: true }` —— 前端把「登出」当成幂等操作，重复点击不会报错。
 */
export default defineEventHandler(async (event): Promise<ApiResponse<AuthOkResult>> => {
	const csrf = assertCookieCsrf(event);
	if (csrf) {
		return csrf;
	}

	const token = readAccessToken(event);

	if (token) {
		await callAuthUpstream(event, "auth/logout", {
			method: "POST",
			rawBody: "",
			contentType: "application/x-www-form-urlencoded",
			authorization: token
		});
	}

	clearSessionCookies(event);

	return respondAuth(event, 200, "success", { data: { ok: true } });
});
