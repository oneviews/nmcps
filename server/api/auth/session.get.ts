import type { ApiResponse } from "~~/shared/types/api";
import type { AuthSessionState } from "~~/shared/types/auth";
import { defineEventHandler } from "h3";
import {
	asAuthFailure,
	callAuthUpstream,
	clearSessionCookies,
	isAuthSuccess,
	isSessionInvalid,
	readAccessToken,
	respondAuth,
	toAuthUser
} from "~~/server/utils/bff/auth";

const ANONYMOUS: AuthSessionState = { authenticated: false, user: null };

/**
 * `GET /api/auth/session` → 上游 `GET /api/v1/auth/whoami`。
 *
 * 这是前端**唯一**的会话来源（路由守卫、页头菜单都读它）：
 * - 无令牌 → 200 `{ authenticated: false, user: null }`；
 * - 上游 401 / 业务码 `10201` / `20205` → 视为未登录，顺带清 cookie，**仍返回 200**
 *   （避免浏览器把「未登录」当网络错误，把判定权交给 `authenticated`）；
 * - 上游其它故障（5xx / 不可达）→ 原样透传，让 `/ready` 之外的故障可被观察。
 */
export default defineEventHandler(async (
	event
): Promise<ApiResponse<AuthSessionState> | ApiResponse<never>> => {
	const token = readAccessToken(event);

	if (!token) {
		return respondAuth(event, 200, "success", { data: ANONYMOUS });
	}

	const upstream = await callAuthUpstream<Record<string, unknown>>(event, "auth/whoami", {
		method: "GET",
		authorization: token
	});

	if (!isAuthSuccess(upstream)) {
		if (isSessionInvalid(upstream)) {
			clearSessionCookies(event);
			return respondAuth(event, 200, "success", { data: ANONYMOUS });
		}

		return asAuthFailure(upstream);
	}

	const user = toAuthUser(upstream.data);

	if (!user) {
		return respondAuth(event, 502, "bff_upstream_contract_violation");
	}

	return respondAuth(event, 200, "success", {
		data: { authenticated: true, user }
	});
});
