import type { ApiResponse } from "~~/shared/types/api";
import type { AuthOkResult } from "~~/shared/types/auth";
import { defineEventHandler } from "h3";
import {
	assertCookieCsrf,
	authFailureResponse,
	callAuthUpstream,
	isAuthSuccess,
	readAccessToken,
	respondAuth
} from "~~/server/utils/bff/auth";
import { authPasswordSchema, parseAuthBody } from "~~/server/utils/bff/authSchema";

/**
 * `POST /api/auth/password` → 上游 `PUT /api/v1/iam/password`（`{ old_password, new_password }`）。
 *
 * 方法由 `POST` 变 `PUT`、字段改 snake_case（实测 camelCase 会被上游判 400
 * `field "old_password" is not set`）。旧口令错误时上游仍是 `HTTP 200 + code:10003`，
 * 这里还原为 400 + 业务码，让前端能照旧用 `error.code` 分类提示。
 *
 * 改密是否连带作废当前会话上游**未确认**，故不主动清 cookie：若真作废，下一次业务
 * 请求 401 → 刷新失败 → 前端登出，行为仍自洽。
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

	const upstream = await callAuthUpstream(event, "iam/password", {
		method: "PUT",
		json: parsed.data,
		authorization: token
	});

	if (!isAuthSuccess(upstream)) {
		return authFailureResponse(event, upstream, 400);
	}

	return respondAuth(event, 200, "success", { data: { ok: true } });
});
