// shared/types/department.ts
// 组织维度契约（上游 `/api/v1/iam/departments` ↔ BFF `/api/iam/departments`）。
//
// 设计基准：NMCPS-ADR-0018 §4.2 —— 新代把「账号归属」从租户直连改为「租户 → 部门 → 用户」，
// `POST /iam/users` 只收 `department_id`，因此部门是建号表单里**唯一**能表达归属的维度。
// 字段口径来自 2026-11-04 实测（`192.168.1.55:8888` 的 `GET /iam/departments`）：
// 部门自带 `tenant_id`，页面据此把候选按租户分组显示。

/** `GET /api/iam/departments` 的列表项 */
export interface IamDepartment {
	id: string
	/** 部门所属租户：用户建在该部门下就等于建在该租户下 */
	tenant_id?: string | null
	name: string
	/** 部门编码（租户内唯一） */
	code: string
	parent_id?: string | null
	sort_order?: number
	created_at?: string
	updated_at?: string
	deleted_at?: string | null
}

/** `GET /api/iam/departments` 查询参数（实测只有这三个） */
export interface IamDepartmentListQuery {
	page: number
	page_size: number
	keyword?: string
}

/** `GET /api/iam/departments` 的 `data`（`list` 空结果为 `null`，BFF 出口归一为 `[]`） */
export interface IamDepartmentListResult {
	list: IamDepartment[]
	total: number
	page: number
	page_size: number
}
