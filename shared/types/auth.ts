// shared/types/auth.ts
// 认证契约（`/api/v1/auth` ↔ BFF `/api/auth/*`）：`app/` 与 `server/` 同构引用。
//
// 设计基准：
//   - NMCPS-ADR-0011（layers/content/collections/cn/records/adr/adr-0011.md）：接口 / 轮换 / 登出 / CSRF 裁决
//   - NMCPS-ARCH-003（layers/content/collections/cn/architecture/1.architecture/iam-architecture.md）：第七节对接契约
//   - NMCPS-CONTRACT-001（layers/content/collections/cn/architecture/3.contract/shared-types.md）：字段透传保真、缺失即 null
//
// 约定：字段名沿用上游 camelCase（`accountCode` / `accountLevel` / `sessionId`…），不做蛇形转换；
// BFF 只把错误信封的 `msg` 归一为 `message`，业务字段一律原样透传。

/** 上游登录返回的账号等级：0 = 超级管理员（tenantId 恒为 0），1 = 租户管理员 */
export const AUTH_ACCOUNT_LEVEL = {
	SUPER_ADMIN: 0,
	TENANT_ADMIN: 1
} as const;

/** 访问令牌 + 刷新令牌（上游 `login` / `token/refresh` 的 `data`） */
export interface AuthTokens {
	accessToken: string
	refreshToken: string
	/** 访问令牌有效期（秒，上游口径） */
	expiresIn: number
	sessionId: string
}

/** 全局身份（`whoami` 口径；登录返回缺 `displayName` / `mfaEnabled` 时补 `null` / `false`） */
export interface AuthUser {
	accountCode: string
	accountName: string
	/** 上游登录不返回显示名 —— 未知即 `null`，不拿 accountName 冒充 */
	displayName: string | null
	tenantId: number | null
	accountLevel: number | null
	/** 登录返回不含该字段 → `null`（未知，不等于「未启用」）；`whoami` 口径为布尔 */
	mfaEnabled: boolean | null
	sessionId: string
}

/** `POST /api/v1/auth/login` 入参 */
export interface AuthLoginPayload {
	accountName: string
	password: string
	/** 租户编码（多租户登录时使用；缺省由后端按账号解析） */
	tenantCode?: string
	/** 启用 MFA 的账号必填 */
	mfaCode?: string
}

/** `POST /api/v1/auth/token/refresh` 入参 */
export interface AuthRefreshPayload {
	refreshToken: string
}

/** `POST /api/v1/auth/password` 入参 */
export interface AuthPasswordPayload {
	newPassword: string
	oldPassword?: string
	/** 首次登录强制改密标记 */
	firstReset?: boolean
}

/** `POST /api/v1/auth/mfa/bind` 入参（1 = TOTP，2 = 生物识别，预留） */
export interface AuthMfaBindPayload {
	mfaType?: number
}

/** `POST /api/v1/auth/mfa/confirm` 入参 */
export interface AuthMfaConfirmPayload {
	mfaCode: string
}

/** `POST /api/v1/auth/mfa/bind` 返回（otpauth URI，一次性展示） */
export interface AuthMfaBindResult {
	otpauthUrl: string
}

/** `POST /api/auth/mfa/confirm` · `password` · `logout` 的返回 */
export interface AuthOkResult {
	ok: boolean
}

/** `POST /api/auth/login` 返回 */
export interface AuthLoginResult {
	user: AuthUser
	/** 访问令牌有效期（秒） */
	expiresIn: number
	mfaRequired: boolean
	mustResetPassword: boolean
	/** 仅桌面端（`x-nmcps-client: desktop`）返回；Web 走 HttpOnly cookie */
	tokens?: AuthTokens
}

/** `POST /api/auth/refresh` 返回 */
export interface AuthRefreshResult {
	expiresIn: number
	/** 仅桌面端返回；Web 由 BFF 轮换 cookie */
	tokens?: AuthTokens
}

/** `GET /api/auth/session` 返回（上游 401 也返回 HTTP 200 + `authenticated: false`） */
export interface AuthSessionState {
	authenticated: boolean
	user: AuthUser | null
}
