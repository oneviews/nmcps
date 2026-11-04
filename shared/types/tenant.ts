// shared/types/tenant.ts
// 租户域契约（上游 `/api/v1/iam/tenants` ↔ BFF `/api/iam/tenants`）。
//
// 设计基准：NMCPS-ADR-0018 §4.2（`GET /tenant` → `GET /iam/tenants`）。
// 字段口径来自 2026-11-04 实测（`192.168.1.55:8888` 的 `GET /iam/tenants`）：snake_case，主键从
// 数值 `tenantId` 变为字符串 `id`（`tnt_default` / `t_isp_a`）。
//
// 用途两处：`/system/user` 把用户行上的 `tenant_id` 翻成租户名，以及部门候选分组显示。
// 页面**不再**在建号时提交租户：新代 `POST /iam/users` 没有 `tenant_id`，归属由部门携带。

/** `GET /api/iam/tenants` 的列表项（实测字段；未赋值的联系人与配额字段可能整体缺省） */
export interface IamTenant {
	id: string
	name: string
	/** 租户编码（`platform` / `default` / `isp-a`），租户内唯一 */
	code: string
	/** `active` / `disabled`（自由字符串，页面原样展示） */
	status?: string
	description?: string
	contact_person?: string
	contact_phone?: string
	contact_email?: string
	address?: string
	device_quota?: number
	storage_quota?: number
	api_quota?: number
	created_at?: string
	updated_at?: string
	deleted_at?: string | null
}

/** `GET /api/iam/tenants` 的 `data`（`list` 空结果为 `null`，BFF 出口归一为 `[]`） */
export interface IamTenantListResult {
	list: IamTenant[]
	total: number
	page: number
	page_size: number
}
