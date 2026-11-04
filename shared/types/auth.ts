// shared/types/auth.ts
// 认证契约（`/api/v1/iam` ↔ BFF `/api/auth/*`）：`app/` 与 `server/` 同构引用。
//
// 设计基准：
//   - NMCPS-ADR-0018（layers/content/collections/cn/records/adr/adr-0018.md）：新代 iam 契约 / 刷新不轮换 / 会话来源
//   - NMCPS-ADR-0011（layers/content/collections/cn/records/adr/adr-0011.md）：cookie 模型 / 401 单飞 / CSRF（轮换条款已作废）
//   - NMCPS-CONTRACT-001（layers/content/collections/cn/architecture/3.contract/shared-types.md）：字段透传保真、缺失即 null
//
// 约定：**上游载荷原样透传**（`IamTokens` / `IamUserInfo` 用 snake_case，不做转换）；
// 只有 BFF 自己组装、直接喂给页面的 `AuthUser` 是 camelCase。

/**
 * 上游 `POST /iam/login`、`POST /iam/refresh` 的 `data`（2026-11-04 实测）。
 *
 * 刷新响应**只回** `access_token` / `expires_in`：新代不轮换刷新令牌（NMCPS-ADR-0018 D4），
 * 故 `refresh_token` 为可选，BFF 在缺失时沿用旧值。
 */
export interface IamTokens {
	access_token: string
	refresh_token?: string
	/** 访问令牌有效期（秒）；实测固定 86400（24h） */
	expires_in: number
}

/** 上游 `data.user_info`（平台管理员的 `tenant_id` 为 `null`） */
export interface IamUserInfo {
	id: string
	username: string
	display_name?: string
	email?: string
	phone?: string
	tenant_id: string | null
}

/** 全局身份（BFF 归一后的口径；缺失即 `null`，绝不编造） */
export interface AuthUser {
	id: string
	username: string
	displayName: string | null
	email: string | null
	phone: string | null
	/** 租户标识：`string | null`（平台级账号为 `null`）—— 旧代是 `number` 且超管为 0 */
	tenantId: string | null
}

/** `POST /iam/login` 入参（旧代的 `accountName` / `tenantCode` / `mfaCode` 已不存在） */
export interface AuthLoginPayload {
	username: string
	password: string
}

/** `POST /iam/refresh` 入参（Web 端由 BFF 从 cookie 取） */
export interface AuthRefreshPayload {
	refresh_token?: string
}

/** `PUT /iam/password` 入参（实测只认 snake_case；camelCase 会被上游判 400） */
export interface AuthPasswordPayload {
	old_password?: string
	new_password: string
}

/** `POST /api/auth/password` · `logout` 的返回 */
export interface AuthOkResult {
	ok: boolean
}

/** `POST /api/auth/login` 返回（上游无 `mfaRequired` / `mustResetPassword`，见 NMCPS-ADR-0018 缺口 G2/G8） */
export interface AuthLoginResult {
	user: AuthUser
	/** 访问令牌有效期（秒） */
	expiresIn: number
	/** 仅桌面端（`x-nmcps-client: desktop`）返回；Web 走 HttpOnly cookie */
	tokens?: IamTokens
}

/** `POST /api/auth/refresh` 返回 */
export interface AuthRefreshResult {
	expiresIn: number
	/** 仅桌面端返回；Web 由 BFF 续写 cookie */
	tokens?: IamTokens
}

/** `GET /api/auth/session` 返回（无身份一律 200 + `authenticated: false`） */
export interface AuthSessionState {
	authenticated: boolean
	user: AuthUser | null
}
