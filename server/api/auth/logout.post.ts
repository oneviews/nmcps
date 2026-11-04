import type { ApiResponse } from "~~/shared/types/api";
import type { AuthOkResult } from "~~/shared/types/auth";
import { defineEventHandler } from "h3";
import {
	assertCookieCsrf,
	callAuthUpstream,
	clearSessionCookies,
	readAccessToken,
	readSessionUser,
	respondAuth
} from "~~/server/utils/bff/auth";

/**
 * `POST /api/auth/logout` → 上游 `POST /api/v1/iam/logout`（Bearer + `{ user_id }`）。
 *
 * 新代登出**幂等**（2026-11-04 实测：重复调用仍 200 `code:0`），与旧代的「第二次 401」不同。
 * BFF 仍按老规矩兜底：吞掉上游任何结果（含 401 / 5xx / 不可达），只清本地会话，
 * 恒返回 `{ ok: true }` —— 前端把登出当成幂等操作，重复点击不该报错。
 */
export default defineEventHandler(async (event): Promise<ApiResponse<AuthOkResult>> => {
	const csrf = assertCookieCsrf(event);
	if (csrf) {
		return csrf;
	}

	const token = readAccessToken(event);
	const user = readSessionUser(event);

	if (token) {
		await callAuthUpstream(event, "iam/logout", {
			method: "POST",
			// `user_id` 取自会话身份：新代登出按用户注销，不再靠空 body 的表单语义
			json: user?.id ? { user_id: user.id } : {},
			authorization: token
		});
	}

	clearSessionCookies(event);

	return respondAuth(event, 200, "success", { data: { ok: true } });
});
