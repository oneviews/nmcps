import type { ApiResponse } from "~~/shared/types/api";
import type { AuthSessionState } from "~~/shared/types/auth";
import { defineEventHandler } from "h3";
import {
	clearSessionCookies,
	readAccessToken,
	readSessionUser,
	respondAuth
} from "~~/server/utils/bff/auth";

const ANONYMOUS: AuthSessionState = { authenticated: false, user: null };

/**
 * `GET /api/auth/session` —— 前端**唯一**的会话来源（路由守卫、页头菜单都读它）。
 *
 * 新代没有 `whoami`（NMCPS-ADR-0018 D3），身份由登录时落下的 `nmcps_ui` cookie 派生，
 * 因此本端点**不触达上游**：
 * - 无身份 → 200 `{ authenticated: false, user: null }`；
 * - 有访问令牌却没身份（旧 cookie / 手工注入）→ 视为半截会话，清干净后同样回 200；
 * - 既然不调上游，上游 5xx / 不可达与本端点无关。
 */
export default defineEventHandler(async (
	event
): Promise<ApiResponse<AuthSessionState>> => {
	const user = readSessionUser(event);

	if (!user) {
		if (readAccessToken(event)) {
			clearSessionCookies(event);
		}

		return respondAuth(event, 200, "success", { data: ANONYMOUS });
	}

	return respondAuth(event, 200, "success", {
		data: { authenticated: true, user }
	});
});
