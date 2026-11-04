// shared/types/account.ts
// 用户域契约（上游 `/api/v1/iam/users` ↔ BFF `/api/iam/users`）：`app/` 与 `server/` 同构引用。
//
// 设计基准：NMCPS-DESIGN-005 §六（layers/content/collections/cn/architecture/2.domain/system.md）、
// NMCPS-ADR-0018 §4.2（旧代 `/account` → 新代 `iam/users` 的逐字段映射）。
// 字段口径来自 2026-11-04 对 `192.168.1.55:8888` 的实测（`GET /iam/users` 真实返回）：
// snake_case，主键从 `accountCode`（`ACC…`）变为 `id`（`u_…`）。
//
// 与旧代契约的三处结构性差异（页面据此降级，不做字段猜测）：
//   - **没有 `accountLevel`**（缺口 G1）：等级模型被角色取代，页面不再展示 / 过滤等级；
//   - **没有 `POST` 侧的 `tenant_id`**（实测请求体只登记 `department_id`）：租户归属由部门携带，
//     部门对象自带 `tenant_id`（`shared/types/department.ts`）；
//   - **有 `DELETE /iam/users/{id}`**（软删 `deleted_at`）：旧代缺口 `UP-ACC-04`（无删号端点）闭环。
//
// 约定：字段名沿用上游 snake_case，不做驼峰转换；BFF 只把错误信封的 `msg` 归一为 `message`。

/**
 * 用户状态（上游 `chk_sys_user_status` 约束的字符串枚举，实测只有这三档）。
 *
 * 与旧代数值枚举（`1` 启用 / `2` 禁用 / `3` 锁定 / `4` 待激活）不同：这里没有「待激活」——
 * 新代没有 `mustResetPassword`（缺口 G2），也就不存在由它派生的初始状态。
 */
export const IAM_USER_STATUS = {
	ACTIVE: "active",
	DISABLED: "disabled",
	LOCKED: "locked"
} as const;

/** 状态取值 */
export type IamUserStatus = (typeof IAM_USER_STATUS)[keyof typeof IAM_USER_STATUS];

/** 列表 / 详情返回的用户（`GET /iam/users`、`GET /iam/users/{id}` 同一形态） */
export interface IamUser {
	/** 主键（`u_…`）；路径段与角色绑定都用它，旧代的 `accountCode` 不再存在 */
	id: string
	/** 归属租户；平台级用户为 `null`。列表自带该字段（旧代缺口 `UP-ACC-05` 闭环） */
	tenant_id?: string | null
	/** 归属部门；未指定为 `null`，而部门对象自带 `tenant_id` */
	department_id?: string | null
	username: string
	email?: string
	phone?: string
	display_name?: string
	/** @see IAM_USER_STATUS */
	status: string
	mfa_enabled: boolean
	last_login_at?: string | null
	created_at?: string
	updated_at?: string
	/** 软删时间；列表默认不含已删用户 */
	deleted_at?: string | null
}

/** `GET /api/iam/users` 查询参数（实测只有这五个） */
export interface IamUserListQuery {
	page: number
	page_size: number
	keyword?: string
	/** @see IAM_USER_STATUS */
	status?: string
	department_id?: string
}

/** `GET /api/iam/users` 的 `data`（`list` 空结果为 `null`，BFF 出口归一为 `[]`） */
export interface IamUserListResult {
	list: IamUser[]
	total: number
	page: number
	page_size: number
}

/**
 * `POST /api/iam/users` 入参。
 *
 * 实测请求体**没有 `tenant_id`**：租户归属由 `department_id` 携带（部门自带租户）。
 * `username` / `password` 是建号的最小必填集；`status` / `mfa_enabled` 不给，
 * 新号一律由上游置 `active` + 未绑定 MFA。
 */
export interface IamUserCreatePayload {
	username: string
	password: string
	email?: string
	display_name?: string
	department_id?: string
}

/** `PUT /api/iam/users/{id}` 入参（`id` 必填，其余按需；同时承接「改资料」与「改状态」） */
export interface IamUserUpdatePayload {
	id: string
	department_id?: string
	email?: string
	phone?: string
	display_name?: string
	status?: IamUserStatus
	mfa_enabled?: boolean
}

/** 写操作的 `data`：上游 `iam_IdResp` 把新主键放在**信封顶层**（`{ code, message, id }`，无 `data`） */
export interface IamCreatedId {
	id: string
}
