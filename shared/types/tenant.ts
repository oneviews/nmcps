// shared/types/tenant.ts
// 租户域契约（上游 `/api/v1/tenant` ↔ BFF `/api/tenant`）。
//
// 用途只有一个：`/system/user` 建号时给超级管理员选 `tenantId` —— 上游 `POST /account`
// 对平台层身份要求显式 `tenantId`（缺省 → `10101 缺少必填参数 tenantId`，见 NMCPS-REC-002 UP-ACC-07），
// 而 `GET /account` 列表并不返回租户字段，因此这是唯一可用的取值来源。
//
// 设计基准：NMCPS-DESIGN-005 §6.1（layers/content/collections/cn/architecture/2.domain/system.md）。

/** `GET /api/tenant` 的列表项（上游 2026-11-03 实测字段） */
export interface TenantSummary {
	tenantId: number
	tenantCode: string
	tenantName: string
	description?: string
	status?: number
	isDefault?: boolean
	createdAt?: string
}

/** `GET /api/tenant` 的 `data`（与账号列表一致：`list` / `total` / `page` / `pageSize`） */
export interface TenantListResult {
	list: TenantSummary[]
	total: number
	page: number
	pageSize: number
}
