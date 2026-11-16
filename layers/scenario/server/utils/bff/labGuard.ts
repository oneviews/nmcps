import type { H3Event } from "h3";
import type { LabPermission, LabPrincipal } from "~~/shared/constants/labPermissions";
import type { ApiResponse } from "~~/shared/types/api";
import { readAccessToken, respondAuth } from "~~/server/utils/bff/auth";
import { resolveLabRoles } from "~~/server/utils/bff/iamRoles";
import { hashAccessToken, readLabSession } from "~~/server/utils/bff/session";
import { hasLabPermission, hasLabPermissions } from "~~/shared/constants/labPermissions";

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
	const session = await authorizeLabSession(event);
	if (!session.ok) {
		return session;
	}

	if (!hasLabPermission(session.principal, permission)) {
		return reject(event, 403, "lab_permission_denied");
	}

	return session;
}

/** 多权限位：全部满足才放行（`full_reset` / `import_json` 的双权限）；判定在纯函数里 */
export async function authorizeLabAll(
	event: H3Event,
	permissions: readonly LabPermission[]
): Promise<LabAuthorization> {
	const session = await authorizeLabSession(event);
	if (!session.ok) {
		return session;
	}

	if (!hasLabPermissions(session.principal, permissions)) {
		return reject(event, 403, "lab_permission_denied");
	}

	return session;
}

/**
 * 只校验「会话 + 凭据同源 + 角色解析」，不判权限位。
 *
 * 顺序要求：先认证（401 / 503）→ 再解析路径（400 / 404 / 405）→ 再判权限（403）。
 * 若先解析路径，未登录者就能用 404 / 405 探测白名单形状。
 */
export async function authorizeLabSession(event: H3Event): Promise<LabAuthorization> {
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

	return {
		ok: true,
		principal: {
			subjectId: session.payload.sub,
			tenantId: session.payload.tid,
			roles: roles.roles
		}
	};
}
