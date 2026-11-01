// shared/types/account.ts
// 账号域契约（上游 `/api/v1/account` ↔ BFF `/api/account`）：`app/` 与 `server/` 同构引用。
//
// 设计基准：NMCPS-DESIGN-005 §六（layers/content/collections/cn/architecture/2.domain/system.md）
// 字段口径来自 2026-11-01 对上游的实测：与契约不符的 6 项缺口登记在
// NMCPS-REC-002（layers/content/collections/cn/records/defects/account-upstream-defects.md）。
//
// 约定：字段名沿用上游 camelCase，不做蛇形转换；BFF 只把错误信封的 `msg` 归一为 `message`。

/** 账号状态（上游 swagger 口径：`0` / `5` 写入会报 `10101`，故不登记） */
export const ACCOUNT_STATUS = {
	/** 启用 */
	ENABLED: 1,
	/** 禁用（「删号」的替代：上游没有 DELETE 端点） */
	DISABLED: 2,
	/** 锁定 */
	LOCKED: 3,
	/** 待激活（建号带 `mustResetPassword` 时的初始状态之一） */
	PENDING: 4
} as const;

/** 账号等级：只登记有语义的两档，`2`–`4` 上游接受但无语义定义 */
export const ACCOUNT_LEVEL = {
	/** 平台超级管理员（`tenantId` 恒为 0） */
	SUPER_ADMIN: 0,
	/** 租户管理员 */
	TENANT_ADMIN: 1
} as const;

/** 状态枚举取值 */
export type AccountStatus = (typeof ACCOUNT_STATUS)[keyof typeof ACCOUNT_STATUS];

/** 列表 / 详情返回的账号（上游不返回 `tenantId` / `email` / `phone`） */
export interface AccountSummary {
	accountId: number
	/** 路径段用的稳定标识（`ACC…`），不是 `accountId` */
	accountCode: string
	accountName: string
	displayName: string
	/** `0` 超级管理员 / `1` 租户管理员；其余等级语义未定义 */
	accountLevel: number
	/** @see ACCOUNT_STATUS */
	status: number
	mfaEnabled: boolean
	/** 上游 `GET` 返回本地时、`POST` 返回 UTC（UP-ACC-05），页面原样展示 */
	createdAt: string
}

/** `GET /api/account` 查询参数（`accountLevel=0` 会被上游当「未提供」，见 UP-ACC-02） */
export interface AccountListQuery {
	page: number
	pageSize: number
	keyword?: string
	accountLevel?: number
	status?: number
}

/** `GET /api/account` 的 `data` */
export interface AccountListResult {
	list: AccountSummary[]
	total: number
	page: number
	pageSize: number
}

/** `POST /api/account` 入参：前四个必填，缺任一项上游报 `500 10509`（UP-ACC-03） */
export interface AccountCreatePayload {
	accountName: string
	displayName: string
	password: string
	accountLevel: number
	mfaEnabled?: boolean
	mustResetPassword?: boolean
}

/** `PUT /api/account/{accountCode}/status` 入参 */
export interface AccountStatusPayload {
	status: AccountStatus
}

/** `PUT /api/account/{accountCode}/status` 的 `data` */
export interface AccountOkResult {
	ok: boolean
}
