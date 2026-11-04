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

/**
 * 建号可选等级的**上限**。
 *
 * 上游把等级按归属层划分（2026-11-03 实测文案：「平台层仅可建 L0，租户层为 L1-L3，
 * 服务账号由系统自动开通」），因此 `4` 不是手工可建等级：提交 `accountLevel: 4` 回 `20102`。
 * 见 NMCPS-DESIGN-005 §6.2 / NMCPS-REC-002 UP-ACC-08。
 */
export const ACCOUNT_CREATABLE_MAX_LEVEL = 3;

/**
 * 建号可选等级：**严格低于自己**（数字更大）且 `≤ ACCOUNT_CREATABLE_MAX_LEVEL`。
 *
 * 上游「只能向下管控」（`20103`）——同级与更高等级一律拒绝，所以下拉里放自身等级
 * 只会让人提交必然失败的值（2026-11-03 前的缺陷：租户管理员只看到 `1`，建号必失败）。
 * 超级管理员（`0`）→ `1/2/3`，租户管理员（`1`）→ `2/3`，未知等级按同一条规则递推且可能为空。
 */
export function creatableAccountLevels(selfLevel: number): number[] {
	const start = Math.max(ACCOUNT_LEVEL.SUPER_ADMIN, Math.trunc(selfLevel)) + 1;
	return Array.from({ length: Math.max(0, ACCOUNT_CREATABLE_MAX_LEVEL - start + 1) }, (_, index) => start + index);
}

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

/**
 * `POST /api/account` 入参。
 *
 * `accountName` / `displayName` / `password` / `accountLevel` 必填（缺任一项上游报 `10509`，UP-ACC-03）；
 * `tenantId` 是**超级管理员**必填（`0` 或缺失 → `10101 缺少必填参数 tenantId`，UP-ACC-07），
 * 租户管理员不能传（上游从令牌推断租户）。
 */
export interface AccountCreatePayload {
	accountName: string
	displayName: string
	password: string
	accountLevel: number
	/** 超级管理员建号时必须指定归属租户（来源 `GET /api/tenant`） */
	tenantId?: number
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
