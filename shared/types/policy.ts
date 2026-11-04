// shared/types/policy.ts
// 策略与权限域契约（上游 `/api/v1/{permission,role,abac,access}` ↔ BFF `/api/*`）：`app/` 与 `server/` 同构引用。
//
// 设计基准：NMCPS-DESIGN-005 §七 / §八（layers/content/collections/cn/architecture/2.domain/system.md）
// 字段口径来自 2026-11-01 对上游的实测：与契约不符的缺口登记在
// NMCPS-REC-003（layers/content/collections/cn/records/defects/policy-upstream-defects.md）。
//
// 约定：字段名沿用上游 camelCase，不做蛇形转换；「上游返回空串」原样保留（`roleCode: ""` 表示全局规则），
// 不把空串伪造成 `null`（NMCPS-CONTRACT-001 §四 第 2 条：缺失即 `null`，上游明确给了空串就是空串）。
//
// 两代并存（C4c 迁移中）：文件后半段是新代 `iam/policies`（snake_case，`/system/policy` 已切换），
// 前半段是旧代 `/permission` / `/role` / `/abac` 类型 —— 只有 `/system/permission` 还在用，
// 该页迁到 `iam/{roles,role-policies,subject-roles}` 时整段删除（C4c code cut 2）。

/** 权限点生效方式（`effect`）：`2` = 拒绝且拒绝优先 */
export const POLICY_EFFECT = {
	/** 允许 */
	ALLOW: 1,
	/** 拒绝（拒绝优先于允许） */
	DENY: 2
} as const;

/** 权限点 / 角色的通用状态位（实测 `1` 生效、`2` 停用） */
export const POLICY_STATUS = {
	ENABLED: 1,
	DISABLED: 2
} as const;

/**
 * 权限点的资源类型（上游 swagger：`1`租户 `2`设备分组 `3`单设备 `4`接口 `5`指标 `6`MIB `7`告警 `8`字段）。
 * 实测 24 个内置权限点只落在 `3`–`7`；`1` / `2` / `8` 上游接受但库里没有样本。
 */
export const PERMISSION_RESOURCE_TYPE = {
	TENANT: 1,
	DEVICE_GROUP: 2,
	DEVICE: 3,
	API: 4,
	METRIC: 5,
	MIB: 6,
	ALERT: 7,
	FIELD: 8
} as const;

export type PolicyEffect = (typeof POLICY_EFFECT)[keyof typeof POLICY_EFFECT];

/** 权限点（`GET /api/permission` 列表项；上游没有单条详情端点） */
export interface PermissionSummary {
	permissionId: number
	/** 命名空间式编码（`asset:device:read`），角色授权的唯一键 */
	permCode: string
	permName: string
	/** @see PERMISSION_RESOURCE_TYPE */
	resourceType: number
	/** 受控资源路径通配（`/api/v1/device/*`） */
	resourcePath: string
	/** `read` / `write`（上游自由字符串，不做枚举校验） */
	action: string
	/** 字段白名单，逗号分隔；空串 = 不限字段 */
	fieldScope: string
	/** @see POLICY_STATUS */
	status: number
}

/** `GET /api/permission` 查询参数（`resourceType=0` 会被上游当「未提供」，实测） */
export interface PermissionListQuery {
	page: number
	pageSize: number
	keyword?: string
	resourceType?: number
}

/** `GET /api/permission` 的 `data` */
export interface PermissionListResult {
	list: PermissionSummary[]
	total: number
	page: number
	pageSize: number
}

/**
 * 角色（上游 `roleId` 是整数，但**所有子资源路径都用 `roleCode`**：
 * `GET /role/{roleCode}`、`GET|POST|DELETE /role/{roleCode}/permission`、`DELETE /role/{roleCode}`）。
 */
export interface RoleSummary {
	roleId: number
	/** `0` = 平台内置共享模板（跨租户只读）；`≥1` = 该租户自建角色 */
	tenantId: number
	roleCode: string
	roleName: string
	/** 角色上限等级 `0`–`4`（上游拒绝 `>4`：`40308`） */
	roleLevel: number
	/** 内置角色：授权与删除均被上游拒绝（`40305` / `40303`） */
	isBuiltin: boolean
	/** @see POLICY_STATUS */
	status: number
	description: string
	/** 上游 `GET` 返回 UTC、`POST` 返回本地时（UP-POL-10），页面原样展示 */
	createdAt: string
}

/** `GET /api/role` 查询参数 */
export interface RoleListQuery {
	page: number
	pageSize: number
	keyword?: string
}

/** `GET /api/role` 的 `data` */
export interface RoleListResult {
	list: RoleSummary[]
	total: number
	page: number
	pageSize: number
}

/** `POST /api/role` 入参：前三个必填（缺任一项上游报 `500 10509`，UP-POL-04） */
export interface RoleCreatePayload {
	roleCode: string
	roleName: string
	roleLevel: number
	description?: string
}

/**
 * `POST` / `DELETE /api/role/{roleCode}/permission` 入参。
 *
 * `effect` 只在授权时有意义；**回读不返回 `effect`** —— `GET .../permission` 只回权限点本体，
 * 因此「拒绝」写进去就看不见了（UP-POL-03），页面只提供 `ALLOW` 语义。
 */
export interface RolePermissionPayload {
	permCode: string
	effect?: PolicyEffect
}

/**
 * `GET /api/role/{roleCode}/permission` 的 `data`：不含 `effect`
 */
export interface RolePermissionListResult {
	list: PermissionSummary[]
	total: number
	page: number
	pageSize: number
}

/** 角色 / 授权 / 删除类写操作的 `data`（上游统一 `{ ok: true }`） */
export interface PolicyOkResult {
	ok: boolean
}

// ── 新代 `iam/policies`（NMCPS-DESIGN-005 §七 / NMCPS-ADR-0018 §4.3）─────────────
//
// 字段口径来自 2026-11-04 对 `192.168.1.55:8888` 的实测（`GET|POST|PUT|DELETE /iam/policies`）：
// snake_case，主键 `id` 是 uuid（种子形如 `pol_platform_full`，**不能按前缀判断来源**）。
// 与旧代的三处结构性差异：
//   - 策略与角色的关系是独立资源 `role-policies`，策略对象上**没有** `role_count` 之类的聚合；
//   - `enabled` 恒 `true`：`PUT` 带上 `enabled: false` 回 200 但值不变（UP-RBAC-03）→ 页面不做开关；
//   - `is_system` 只是标签，删除系统策略上游照样成功（UP-RBAC-02）→ 页面只用它写确认文案。

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
