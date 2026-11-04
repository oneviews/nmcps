// layers/system/app/composables/usePermissions.ts
// 权限管理数据面（`/system/permission`）：只封装 2026-11-01 实测存在的权限域端点。
//
// 设计基准：NMCPS-DESIGN-005 §八（layers/content/collections/cn/architecture/2.domain/system.md）
// 上游缺陷：NMCPS-REC-003（layers/content/collections/cn/records/defects/policy-upstream-defects.md）
//   - 内置角色（`isBuiltin`）的授权与删除被上游拒绝（`40305` / `40303`，UP-POL-09），页面只读；
//   - `GET /role/{code}/permission` **不返回 `effect`**：拒绝（`effect=2`）写入后不可回读（UP-POL-03）；
//   - `POST /permission` 存在但**没有删除端点**：本页只读权限点目录（UP-POL-01）；
//   - `GET /account/role?accountId=` 不存在（`404`）：账号↔角色只能写不能读（UP-POL-07）。
//
// 鉴权口径：BFF 只做白名单透传，越权判定全在上游；超级管理员调本域任一端点回 `401 10201`（UP-POL-08），
// 页面据此展示「当前身份无策略域」提示，而不是把它当普通加载失败。
import type {
	PermissionListQuery,
	PermissionListResult,
	PermissionSummary,
	PolicyOkResult,
	RoleCreatePayload,
	RoleListQuery,
	RoleListResult,
	RolePermissionListResult,
	RoleSummary
} from "~~/shared/types/policy";
import { POLICY_EFFECT } from "~~/shared/types/policy";

/** 上游 `pageSize` 有上限，超出会被静默截断，客户端先夹一次再说 */
const MAX_PAGE_SIZE = 100;
/** 权限点目录很小（实测 24 条），全量拉取的页数上限用于兜底死循环 */
const MAX_CATALOG_PAGES = 10;

export function usePermissions() {
	const api = useApi();

	/** 权限点列表：空串 / `undefined` 参数一律不发 */
	function listPermissions(query: PermissionListQuery): Promise<PermissionListResult> {
		const page = Math.max(1, Math.trunc(query.page) || 1);
		const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(query.pageSize) || 20));
		const keyword = query.keyword?.trim();

		return api.get<PermissionListResult>("/api/permission", {
			query: {
				page,
				pageSize,
				keyword: keyword || undefined,
				// `0` 是「不限」哨兵：透传会被上游当「未提供」，但没必要多发一个参数
				resourceType: query.resourceType || undefined
			}
		});
	}

	/**
	 * 权限点全量目录：授权矩阵要按 `permCode` 判断「已授权 / 未授权」，
	 * 逐页累加到不足一页为止（上限 `MAX_CATALOG_PAGES` 页，防上游 `total` 异常时死循环）。
	 */
	async function listAllPermissions(): Promise<PermissionSummary[]> {
		const collected: PermissionSummary[] = [];

		for (let page = 1; page <= MAX_CATALOG_PAGES; page++) {
			const result = await listPermissions({ page, pageSize: MAX_PAGE_SIZE });
			const chunk = result.list ?? [];
			collected.push(...chunk);

			if (chunk.length < MAX_PAGE_SIZE || collected.length >= (result.total ?? 0))
				break;
		}

		return collected;
	}

	/** 角色列表（`keyword` 之外没有过滤项） */
	function listRoles(query: RoleListQuery): Promise<RoleListResult> {
		const page = Math.max(1, Math.trunc(query.page) || 1);
		const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(query.pageSize) || 20));
		const keyword = query.keyword?.trim();

		return api.get<RoleListResult>("/api/role", {
			query: { page, pageSize, keyword: keyword || undefined }
		});
	}

	/** 角色详情：路径段是 `roleCode`（不是 `roleId`） */
	function getRole(roleCode: string): Promise<RoleSummary> {
		return api.get<RoleSummary>(`/api/role/${encodeURIComponent(roleCode)}`);
	}

	/** 自建角色：`roleLevel` 只能低于自身（租户管理员可建 `2`–`4`，`0`/`1` 回 `20103`） */
	function createRole(payload: RoleCreatePayload): Promise<RoleSummary> {
		return api.post<RoleSummary>("/api/role", payload);
	}

	/** 删除自建角色：内置角色回 `40303` */
	function deleteRole(roleCode: string): Promise<PolicyOkResult> {
		return api.del<PolicyOkResult>(`/api/role/${encodeURIComponent(roleCode)}`);
	}

	/**
	 * 角色已授权的权限点。
	 *
	 * 上游只回权限点本体、**不回 `effect`**（UP-POL-03）：页面只能把「出现在这里」理解成
	 * 「有这条授权」，不能区分允许 / 拒绝，因此也不向用户展示「拒绝」开关。
	 */
	function listRolePermissions(roleCode: string, pageSize = MAX_PAGE_SIZE): Promise<RolePermissionListResult> {
		return api.get<RolePermissionListResult>(`/api/role/${encodeURIComponent(roleCode)}/permission`, {
			query: { page: 1, pageSize }
		});
	}

	/** 授权：只用 `ALLOW`（`effect=2` 不可回读，见 UP-POL-03） */
	function grantPermission(roleCode: string, permCode: string): Promise<PolicyOkResult> {
		return api.post<PolicyOkResult>(`/api/role/${encodeURIComponent(roleCode)}/permission`, {
			permCode,
			effect: POLICY_EFFECT.ALLOW
		});
	}

	/** 撤销授权：body 只带 `permCode`（`effect` 对删除无意义） */
	function revokePermission(roleCode: string, permCode: string): Promise<PolicyOkResult> {
		return api.request<PolicyOkResult>(`/api/role/${encodeURIComponent(roleCode)}/permission`, {
			method: "DELETE",
			body: { permCode }
		});
	}

	return {
		listPermissions,
		listAllPermissions,
		listRoles,
		getRole,
		createRole,
		deleteRole,
		listRolePermissions,
		grantPermission,
		revokePermission
	};
}
