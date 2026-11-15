import type { H3Event } from "h3";
import type { LabRoleGrant } from "~~/shared/constants/labPermissions";
import { getHeader } from "h3";
import { getBffConfig } from "./config";
import { hashAccessToken } from "./session";

/**
 * IAM 角色解析（NMCPS-ADR-0021 §4.2）。
 *
 * 角色不从客户端读取，也不只看角色编码：
 *   1. `GET /iam/subject-roles?subject_id=<sub>` 取主体关系；
 *   2. 对每个 `role_id` 调 `GET /iam/roles/{id}` 取 `code` 与 `tenant_id`；
 *   3. 租户角色必须满足 `role.tenant_id === 会话 tid`（UP-RBAC-09 的 BFF 侧兜底）；
 *   4. 平台角色只在会话 `tid === null` 时保留，且不会获得运行态权限。
 *
 * 本模块直接访问主上游，**不复用** `proxyToUpstream()`：后者会合并客户端 query / body，
 * 可能让请求方污染角色查询的 `subject_id`。这里只发固定查询与 Bearer。
 */

const ROLE_CACHE_TTL_MS = 60_000;
const SUBJECT_ROLES_PAGE_SIZE = 200;

interface CachedRoles {
	roles: LabRoleGrant[]
	expiresAt: number
}

const roleCache = new Map<string, CachedRoles>();

/** 登出 / 改密后清空；角色变更最多等一个 TTL（≤60s） */
export function clearLabRoleCache(): void {
	roleCache.clear();
}

export interface LabRoleFailure {
	ok: false
	status: 401 | 502 | 503
	message: "bff_auth_required" | "upstream_auth_misconfigured" | "bff_role_resolution_failed"
}

export type LabRoleResult
	= | { ok: true, roles: LabRoleGrant[] }
		| LabRoleFailure;

type IamGetResult
	= | { ok: true, data: unknown }
		| { ok: false, status: 401 | 502 | 503, notFound?: boolean };

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function toStringOrNull(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function failure(status: 401 | 502 | 503): LabRoleFailure {
	if (status === 401) {
		return { ok: false, status, message: "bff_auth_required" };
	}
	if (status === 502) {
		return { ok: false, status, message: "upstream_auth_misconfigured" };
	}
	return { ok: false, status, message: "bff_role_resolution_failed" };
}

function isAbortError(error: unknown): boolean {
	return !!error && typeof error === "object" && "name" in error && (error as { name?: string }).name === "AbortError";
}

async function iamGet(event: H3Event, path: string, accessToken: string, query: Record<string, string>): Promise<IamGetResult> {
	const config = getBffConfig(event);
	if (!config.upstreamBase) {
		return { ok: false, status: 503 };
	}

	let url: URL;
	try {
		const segments = path.split("/").filter(Boolean).map((segment) => encodeURIComponent(segment));
		url = new URL(`${config.upstreamBase}/${segments.join("/")}`);
	} catch {
		return { ok: false, status: 503 };
	}

	for (const [key, value] of Object.entries(query)) {
		url.searchParams.set(key, value);
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), config.timeoutMs);

	try {
		const response = await fetch(url, {
			method: "GET",
			headers: {
				accept: "application/json",
				authorization: `Bearer ${accessToken}`,
				...(getHeader(event, "x-request-id") ? { "x-request-id": getHeader(event, "x-request-id")! } : {})
			},
			signal: controller.signal,
			redirect: "manual"
		});

		if (response.status === 401) {
			return { ok: false, status: 401 };
		}
		if (response.status === 403) {
			return { ok: false, status: 502 };
		}
		if (response.status === 404) {
			return { ok: false, status: 503, notFound: true };
		}
		if (!response.ok) {
			return { ok: false, status: 503 };
		}

		let payload: unknown;
		try {
			payload = await response.json();
		} catch {
			return { ok: false, status: 503 };
		}

		const record = asRecord(payload);
		const code = Number(record?.code);
		if (Number.isFinite(code) && code !== 0) {
			if (code === 401 || code === 40101 || code === 10007) {
				return { ok: false, status: 401 };
			}
			return { ok: false, status: 503 };
		}

		return { ok: true, data: record && "data" in record ? record.data : payload };
	} catch (error) {
		if (isAbortError(error) && import.meta.dev) {
			console.error("[lab] IAM role lookup timed out", path);
		}
		return { ok: false, status: 503 };
	} finally {
		clearTimeout(timer);
	}
}

function readSubjectRoleIds(data: unknown): string[] | undefined {
	const record = asRecord(data);
	const list = Array.isArray(data) ? data : record?.list;

	if (list === null) {
		return [];
	}
	if (!Array.isArray(list)) {
		return undefined;
	}

	return list
		.map((item) => toStringOrNull(asRecord(item)?.role_id))
		.filter((item): item is string => item !== null);
}

function readRoleGrant(data: unknown): LabRoleGrant | undefined {
	const record = asRecord(data);
	const code = toStringOrNull(record?.code);
	if (!code) {
		return undefined;
	}

	return {
		code,
		tenantId: record?.tenant_id === null || record?.tenant_id === undefined
			? null
			: toStringOrNull(record.tenant_id)
	};
}

/**
 * 解析主体角色；结果按 `subject_id + 访问令牌哈希` 缓存 ≤60s。
 *
 * 失败一律返回 401/502/503，**不降级为 tenant_user**（ADR-0021 D8）。
 */
export async function resolveLabRoles(
	event: H3Event,
	subjectId: string,
	tenantId: string | null,
	accessToken: string
): Promise<LabRoleResult> {
	const cacheKey = `${subjectId}:${tenantId ?? "platform"}:${hashAccessToken(accessToken)}`;
	const cached = roleCache.get(cacheKey);
	if (cached && cached.expiresAt > Date.now()) {
		return { ok: true, roles: cached.roles };
	}

	const relations = await iamGet(event, "iam/subject-roles", accessToken, {
		subject_id: subjectId,
		page: "1",
		page_size: String(SUBJECT_ROLES_PAGE_SIZE)
	});

	if (!relations.ok) {
		return failure(relations.status);
	}

	const roleIds = readSubjectRoleIds(relations.data);
	if (!roleIds) {
		return failure(503);
	}

	type RoleLookup
		= | { ok: true, grant: LabRoleGrant }
			| { ok: false, status: 401 | 502 | 503 }
			| null;

	const uniqueRoleIds = [...new Set(roleIds)];
	const grants: RoleLookup[] = await Promise.all(uniqueRoleIds.map(async (roleId): Promise<RoleLookup> => {
		const role = await iamGet(event, `iam/roles/${roleId}`, accessToken, {});
		if (!role.ok) {
			// 关系指向已删除角色：跳过，不让一条脏关系拖垮整个租户
			return role.notFound ? null : { ok: false, status: role.status };
		}
		const grant = readRoleGrant(role.data);
		return grant ? { ok: true, grant } : { ok: false, status: 503 };
	}));

	const failed = grants.find((item): item is { ok: false, status: 401 | 502 | 503 } => !!item && !item.ok);
	if (failed) {
		return failure(failed.status);
	}

	const roles: LabRoleGrant[] = [];
	for (const item of grants) {
		if (!item || !item.ok) {
			continue;
		}

		const grant = item.grant;
		// 平台角色只在平台会话里保留；租户角色必须与租户会话逐字匹配（UP-RBAC-09）
		if (tenantId === null ? grant.tenantId !== null : grant.tenantId !== tenantId) {
			continue;
		}
		roles.push(grant);
	}

	roleCache.set(cacheKey, {
		roles,
		expiresAt: Date.now() + ROLE_CACHE_TTL_MS
	});

	return { ok: true, roles };
}
