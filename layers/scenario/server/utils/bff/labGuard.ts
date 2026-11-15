import type { H3Event } from "h3";
import type { LabPermission, LabPrincipal } from "~~/shared/constants/labPermissions";
import type { ApiResponse } from "~~/shared/types/api";
import { readAccessToken, respondAuth } from "~~/server/utils/bff/auth";
import { resolveLabRoles } from "~~/server/utils/bff/iamRoles";
import { hashAccessToken, readLabSession } from "~~/server/utils/bff/session";
import { hasLabPermission } from "~~/shared/constants/labPermissions";

/**
 * `/api/lab/**` 的统一鉴权入口（NMCPS-ADR-0021 P1）。
 *
 * 判定顺序固定为：签名会话 → 访问令牌绑定 → IAM 角色 → 权限位。
 * 任何一步失败都不得继续出站；跨租户 / 无权限一律 403 `lab_permission_denied`
 * （当前没有资源台账，跨租户资源判定在 P2 由台账返回 404）。
 */

export type LabAuthorization
	= | { ok: true, principal: LabPrincipal }
		| { ok: false, response: ApiResponse<never> };

function reject(event: H3Event, status: 401 | 403 | 502 | 503, message: string): LabAuthorization {
	return { ok: false, response: respondAuth(event, status, message) };
}

export async function authorizeLab(
	event: H3Event,
	permission: LabPermission
): Promise<LabAuthorization> {
	const session = readLabSession(event);

	if (!session.ok) {
		if (session.reason === "not_configured") {
			return reject(event, 503, "bff_auth_not_configured");
		}
		return reject(event, 401, "bff_auth_required");
	}

	const accessToken = readAccessToken(event);
	if (!accessToken || hashAccessToken(accessToken) !== session.payload.ath) {
		// 会话与凭据必须同源：A 的 cookie + B 的 token 不能拼出请求
		return reject(event, 401, "bff_auth_required");
	}

	const roles = await resolveLabRoles(event, session.payload.sub, session.payload.tid, accessToken);
	if (!roles.ok) {
		return reject(event, roles.status, roles.message);
	}

	const principal: LabPrincipal = {
		subjectId: session.payload.sub,
		tenantId: session.payload.tid,
		roles: roles.roles
	};

	if (!hasLabPermission(principal, permission)) {
		return reject(event, 403, "lab_permission_denied");
	}

	return { ok: true, principal };
}
