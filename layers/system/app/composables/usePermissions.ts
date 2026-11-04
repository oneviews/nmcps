// layers/system/app/composables/usePermissions.ts
// 授权数据面（`/system/permission`）：新代 `iam/{roles,role-policies,subject-roles}`。
//
// 设计基准：NMCPS-DESIGN-005 §八（layers/content/collections/cn/architecture/2.domain/system.md）、
// NMCPS-ADR-0018 §4.3（旧代 `/role` + `/role/{code}/permission` → 新代 `iam/roles` + `role-policies`）。
// 上游缺陷：NMCPS-REC-005（layers/content/collections/cn/records/defects/iam-policy-upstream-defects.md）
//   - 列表只认 `keyword` / `code`，`enabled` / `tenant_id` 被静默忽略（UP-RBAC-06）；
//   - 建角色把新主键放在**信封顶层**（`{ code, message, id }`，没有 `data`），因此建完要按 `code` 回读；
//   - `PUT` 的 `enabled` 被忽略（UP-RBAC-03）→ 这里只写 `name` / `description`；
//   - 关系行不随主体 / 对象软删清理（UP-RBAC-10）→ 孤儿绑定由页面按存在性过滤，不在这里猜。
//
// 鉴权口径：新代没有业务级鉴权（UP-RBAC-01），BFF 只做白名单透传；
// 可见范围由**会话租户**决定，因此这里不做任何「客户端先拦一道」的假设。
import type {
	IamRole,
	IamRoleCreatePayload,
	IamRoleListQuery,
	IamRoleListResult,
	IamRolePolicyListQuery,
	IamRolePolicyListResult,
	IamRoleUpdatePayload,
	IamSubjectRoleListQuery,
	IamSubjectRoleListResult
} from "~~/shared/types/policy";

/** 上游 `page_size` 无显式上限（UP-RBAC-06），客户端仍夹一次，避免一次拉回整库 */
const MAX_PAGE_SIZE = 100;
/** 实测只有 `user` 一种主体类型：角色分配不开放其它主体 */
const SUBJECT_TYPE_USER = "user";

export function usePermissions() {
	const api = useApi();

	/** 角色列表：空串 / `undefined` 参数一律不发（上游对空串不过滤） */
	function listRoles(query: IamRoleListQuery): Promise<IamRoleListResult> {
		const page = Math.max(1, Math.trunc(query.page) || 1);
		const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(query.page_size) || 15));
		const keyword = query.keyword?.trim();

		return api.get<IamRoleListResult>("/api/iam/roles", {
			query: {
				page,
				page_size: pageSize,
				keyword: keyword || undefined
			}
		});
	}

	/** 角色详情：不存在时上游回 `400` + 纯文本 `记录不存在`（不是 envelope） */
	function getRole(id: string): Promise<IamRole> {
		return api.get<IamRole>(`/api/iam/roles/${encodeURIComponent(id)}`);
	}

	/**
	 * 建角色：上游把新主键放在信封顶层（`{ code, message, id }`），`useApi` 解包后拿不到 id，
	 * 因此用 `keyword` 精确回读刚建好的那一行（`code` 同租户唯一，命中即是它）。
	 *
	 * 回读不到（列表尚未反映）时返回 `undefined`，由页面回落到整表刷新。
	 */
	async function createRole(payload: IamRoleCreatePayload): Promise<IamRole | undefined> {
		const code = payload.code.trim();

		await api.post<unknown>("/api/iam/roles", {
			name: payload.name.trim(),
			code,
			description: payload.description?.trim() || undefined
		});

		const result = await listRoles({ page: 1, page_size: 5, keyword: code });
		return result.list.find((item) => item.code === code);
	}

	/** 改角色：只发实测生效的 `name` / `description`（`enabled` 被忽略，UP-RBAC-03） */
	function updateRole(payload: IamRoleUpdatePayload): Promise<void> {
		const { id, ...rest } = payload;

		return api.put<void>(`/api/iam/roles/${encodeURIComponent(id)}`, {
			id,
			name: rest.name?.trim(),
			description: rest.description?.trim()
		});
	}

	/** 删角色：系统角色同样可删（UP-RBAC-02），因此这里不做任何客户端的「保护」拦阻 */
	function deleteRole(id: string): Promise<void> {
		return api.del<void>(`/api/iam/roles/${encodeURIComponent(id)}`);
	}

	/**
	 * 角色已挂策略：只回关系行 `{ id, role_id, policy_id, created_at }`，不回策略本体，
	 * 页面按 `policy_id` 关联策略目录（`usePolicies().list()`）。
	 */
	function listRolePolicies(query: IamRolePolicyListQuery): Promise<IamRolePolicyListResult> {
		const page = Math.max(1, Math.trunc(query.page) || 1);
		const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(query.page_size) || MAX_PAGE_SIZE));

		return api.get<IamRolePolicyListResult>("/api/iam/role-policies", {
			query: {
				page,
				page_size: pageSize,
				role_id: query.role_id || undefined
			}
		});
	}

	/** 挂策略：重复挂载回 `400` + `SQLSTATE 23505`（与建对象同族失败通道，UP-RBAC-04） */
	function attachPolicy(roleId: string, policyId: string): Promise<void> {
		return api.post<void>("/api/iam/role-policies/AttachPolicy", {
			role_id: roleId,
			policy_id: policyId
		});
	}

	/** 摘策略：幂等（重复摘除仍 `200`） */
	function detachPolicy(roleId: string, policyId: string): Promise<void> {
		return api.post<void>("/api/iam/role-policies/DetachPolicy", {
			role_id: roleId,
			policy_id: policyId
		});
	}

	/**
	 * 主体已分配的角色。
	 *
	 * 上游只认 `subject_id`（按角色反查不在契约里），因此「某角色分配给了谁」由调用方
	 * 一次拉全量再按 `role_id` 过滤 —— 关系表总量很小（实测 24 条），不值得为它分页。
	 */
	function listSubjectRoles(query: IamSubjectRoleListQuery): Promise<IamSubjectRoleListResult> {
		const page = Math.max(1, Math.trunc(query.page) || 1);
		const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(query.page_size) || MAX_PAGE_SIZE));

		return api.get<IamSubjectRoleListResult>("/api/iam/subject-roles", {
			query: {
				page,
				page_size: pageSize,
				subject_id: query.subject_id || undefined
			}
		});
	}

	/** 分配角色：body 只有 `subject_type` / `subject_id` / `role_id` 三个字段 */
	function assignRole(subjectId: string, roleId: string): Promise<void> {
		return api.post<void>("/api/iam/subject-roles/AssignRole", {
			subject_type: SUBJECT_TYPE_USER,
			subject_id: subjectId,
			role_id: roleId
		});
	}

	/** 撤销角色：与分配同形（重复撤销幂等） */
	function revokeRole(subjectId: string, roleId: string): Promise<void> {
		return api.post<void>("/api/iam/subject-roles/RevokeRole", {
			subject_type: SUBJECT_TYPE_USER,
			subject_id: subjectId,
			role_id: roleId
		});
	}

	return {
		listRoles,
		getRole,
		createRole,
		updateRole,
		deleteRole,
		listRolePolicies,
		attachPolicy,
		detachPolicy,
		listSubjectRoles,
		assignRole,
		revokeRole
	};
}
