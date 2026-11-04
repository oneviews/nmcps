// shared/types/policy.ts
// 策略与授权域契约（上游 `iam/{policies,roles,role-policies,subject-roles}` ↔ BFF `/api/iam/*`）：
// `app/` 与 `server/` 同构引用。
//
// 设计基准：NMCPS-DESIGN-005 §七 / §八（layers/content/collections/cn/architecture/2.domain/system.md）
// 字段口径来自 2026-11-04 对 `192.168.1.55:8888` 的实测：与契约不符的缺口登记在
// NMCPS-REC-005（layers/content/collections/cn/records/defects/iam-policy-upstream-defects.md）。
//
// 约定：字段名沿用上游 snake_case，不做驼峰转换；「上游返回空串」原样保留，
// 不把空串伪造成 `null`（NMCPS-CONTRACT-001 §四 第 2 条：缺失即 `null`，上游明确给了空串就是空串）。
//
// C4c 已整体切到新代（`/system/policy` = C4c-1，`/system/permission` = C4c-2）：旧代
// `/permission`、`/role`、`/abac` 的类型随端点退役一并删除 —— 那三组端点在 8888 openapi 中 0 命中
// （缺口 G3 / G4 / G5，见 NMCPS-ADR-0018 §4.3），留着只会让人误以为还能调。
//
// 两代的三处结构性差异（新代口径）：
//   - 策略与角色的关系是独立资源 `role-policies`，策略对象上**没有** `role_count` 之类的聚合；
//   - `enabled` 恒 `true`：`PUT` 带上 `enabled: false` 回 200 但值不变（UP-RBAC-03）→ 页面不做开关；
//   - `is_system` 只是标签，删除系统对象上游照样成功（UP-RBAC-02）→ 页面只用它写确认文案。

/**
 * 策略（`GET /iam/policies` 列表项与 `GET /iam/policies/{id}` 同一形态）。
 *
 * `document` 是 **JSON 字符串**（不是对象），上游按 jsonb 落库：
 * 非法 JSON 会被 PG 拒绝（`400` + `SQLSTATE 22P02`，UP-RBAC-04），没有语义校验。
 */

export interface IamPolicy {
	/** 主键（uuid，种子为 `pol_*`）；所有路径段都用它 */
	id: string
	/** 归属租户；新建策略落**会话租户**，请求体不接受该字段（UP-RBAC-08） */
	tenant_id?: string | null
	name: string
	/** 同租户内唯一（`uk_sys_policy_tenant_code`），跨租户可重名 */
	code: string
	/** openapi 未约束枚举；实测 10 条种子全为 `system`。页面原样展示，不映射成「其他」 */
	policy_type: string
	/** JSON 字符串，形如 `[{"Action":["*"],"Effect":"Allow","Resource":["*"]}]` */
	document: string
	description?: string
	/** 列表与详情恒 `true`（写入被忽略，UP-RBAC-03）：只读展示 */
	enabled: boolean
	/** 种子策略为 `true`。**不是保护**：`DELETE` 对系统策略同样成功（UP-RBAC-02） */
	is_system: boolean
	/** RFC3339 带 `+08:00` 偏移：原样展示，不做时区换算 */
	created_at?: string
	updated_at?: string
	deleted_at?: string | null
}

/**
 * `GET /api/iam/policies` 查询参数。
 *
 * 只认这三个：`code` / `policy_type` / `enabled` 传了会被**静默忽略**（UP-RBAC-06），
 * 因此页面不提供这三类筛选 —— 摆出来只会变成「点了没反应的筛选项」。
 */
export interface IamPolicyListQuery {
	page: number
	page_size: number
	keyword?: string
}

/** `GET /api/iam/policies` 的 `data`（`list` 空结果为 `null`，BFF 出口归一为 `[]`） */
export interface IamPolicyListResult {
	list: IamPolicy[]
	total: number
	page: number
	page_size: number
}

/**
 * `POST /api/iam/policies` 入参。
 *
 * 实测请求体没有 `tenant_id`（落会话租户）、也没有 `enabled` / `is_system`（上游自己置）。
 * `document` 必须是**合法 JSON 的字符串**，否则 PG 报 `22P02`。
 */
export interface IamPolicyCreatePayload {
	name: string
	code: string
	policy_type: string
	document: string
	description?: string
}

/**
 * `PUT /api/iam/policies/{id}` 入参。
 *
 * 实测只有 `name` / `document` / `description` 生效（`enabled` 被忽略）。
 * `document` 由调用方带**当前值**原样回传：本页不提供文档编辑（NMCPS-DESIGN-005 §7.2）。
 */
export interface IamPolicyUpdatePayload {
	id: string
	name?: string
	document?: string
	description?: string
}

// ── 新代 `iam/roles`（NMCPS-DESIGN-005 §八 / NMCPS-ADR-0018 §4.3）─────────────────
//
// 字段口径同 §7（2026-11-04 实测 `GET|POST|PUT|DELETE /iam/roles`）：snake_case，主键 `id` 是 uuid
// （种子形如 `r_tenant_admin`，**不能按前缀判断来源**）。
//   - 旧代的 `roleLevel` / `isBuiltin` / `status` 三个字段随等级模型一并退役（缺口 G1）；
//   - `is_system` 接替「内置角色」的**语义标签**，**不构成保护**：删除系统角色照样 200（UP-RBAC-02）；
//   - `enabled` 恒 `true`：`PUT` 带上 `enabled: false` 回 200 但值不变（UP-RBAC-03）→ 页面不做开关。

/**
 * 角色（`GET /iam/roles` 列表项与 `GET /iam/roles/{id}` 同一形态）。
 *
 * `code` 同一租户内唯一（`uk_sys_role_tenant_code`），跨租户可重名（实测 `tenant_admin` 三租户各一条）。
 */
export interface IamRole {
	/** 主键（uuid，种子为 `r_*`）；所有路径段都用它 */
	id: string
	/** 归属租户；平台角色无该字段，租户角色带 */
	tenant_id?: string | null
	name: string
	/** 同租户内唯一（`uk_sys_role_tenant_code`） */
	code: string
	description?: string
	/** 恒 `true`（写入被忽略，UP-RBAC-03）：只读展示 */
	enabled: boolean
	/** 种子角色 `true`。**不是保护**：`DELETE` 对系统角色同样成功（UP-RBAC-02） */
	is_system: boolean
	/** RFC3339 带 `+08:00` 偏移：原样展示，不做时区换算 */
	created_at?: string
	updated_at?: string
	deleted_at?: string | null
}

/**
 * `GET /api/iam/roles` 查询参数。
 *
 * 只认 `keyword` / `code`：`enabled` / `tenant_id` 传了被**静默忽略**（UP-RBAC-06），
 * 页面因此不提供这两类筛选 —— 摆出来只会变成「点了没反应的筛选项」。
 */
export interface IamRoleListQuery {
	page: number
	page_size: number
	keyword?: string
}

/** `GET /api/iam/roles` 的 `data`（`list` 空结果为 `null`，BFF 出口归一为 `[]`） */
export interface IamRoleListResult {
	list: IamRole[]
	total: number
	page: number
	page_size: number
}

/**
 * `POST /api/iam/roles` 入参。
 *
 * 实测**三个字段都不是必填**：空 body 也回 `200`，落一条空角色（UP-RBAC-07）。
 * 请求体没有 `tenant_id`（落会话租户）、没有 `enabled` / `is_system`（上游自己置）。
 */
export interface IamRoleCreatePayload {
	name: string
	code: string
	description?: string
}

/** `PUT /api/iam/roles/{id}` 入参：实测只有 `name` / `description` 生效（`enabled` 被忽略） */
export interface IamRoleUpdatePayload {
	id: string
	name?: string
	description?: string
}

// ── 关系资源 `iam/role-policies`（策略 × 角色）─────────────────────────────────
//
// 授权**没有 effect 维度**：关系行存在即「已挂」，不存在即「未挂」（旧代 `UP-POL-03`
// 的「拒绝不可回读」问题随字段消失，页面不必再解释）。
// 列表**只回关系行、不回策略本体**（`policy_id` 需要前端关联策略目录）。

/** `GET /api/iam/role-policies` 列表项 */
export interface IamRolePolicy {
	/** 关系行主键（uuid，无语义）：页面只用它做 `key` */
	id: string
	role_id: string
	policy_id: string
	created_at?: string
}

/** `GET /api/iam/role-policies` 查询参数（`role_id` 是唯一有效过滤项） */
export interface IamRolePolicyListQuery {
	role_id?: string
	page: number
	page_size: number
}

/** `GET /api/iam/role-policies` 的 `data` */
export interface IamRolePolicyListResult {
	list: IamRolePolicy[]
	total: number
	page: number
	page_size: number
}

/** `POST /api/iam/role-policies/{AttachPolicy,DetachPolicy}` 入参 */
export interface IamRolePolicyPayload {
	role_id: string
	policy_id: string
}

// ── 关系资源 `iam/subject-roles`（主体 × 角色）────────────────────────────────
//
// 账号 ↔ 角色已读写对称（旧代 `UP-POL-07` 闭环）：读走列表，写走 `AssignRole` / `RevokeRole`。
// 上游唯一实测过的 `subject_type` 是 `user`，因此这里只声明这一个取值。

/** `GET /api/iam/subject-roles` 列表项 */
export interface IamSubjectRole {
	/** 关系行主键（uuid，无语义）：页面只用它做 `key` */
	id: string
	/** 实测只有 `user`；其它取值原样展示，不猜语义 */
	subject_type: string
	subject_id: string
	role_id: string
	created_at?: string
}

/** `GET /api/iam/subject-roles` 查询参数（`subject_id` 是唯一有效过滤项；按角色过滤在前端做） */
export interface IamSubjectRoleListQuery {
	subject_id?: string
	page: number
	page_size: number
}

/** `GET /api/iam/subject-roles` 的 `data` */
export interface IamSubjectRoleListResult {
	list: IamSubjectRole[]
	total: number
	page: number
	page_size: number
}

/** `POST /api/iam/subject-roles/{AssignRole,RevokeRole}` 入参 */
export interface IamSubjectRolePayload {
	subject_type: string
	subject_id: string
	role_id: string
}
