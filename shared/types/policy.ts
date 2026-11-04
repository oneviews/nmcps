// shared/types/policy.ts
// 策略与权限域契约（上游 `/api/v1/{permission,role,abac,access}` ↔ BFF `/api/*`）：`app/` 与 `server/` 同构引用。
//
// 设计基准：NMCPS-DESIGN-005 §七 / §八（layers/content/collections/cn/architecture/2.domain/system.md）
// 字段口径来自 2026-11-01 对上游的实测：与契约不符的缺口登记在
// NMCPS-REC-003（layers/content/collections/cn/records/defects/policy-upstream-defects.md）。
//
// 约定：字段名沿用上游 camelCase，不做蛇形转换；「上游返回空串」原样保留（`roleCode: ""` 表示全局规则），
// 不把空串伪造成 `null`（NMCPS-CONTRACT-001 §四 第 2 条：缺失即 `null`，上游明确给了空串就是空串）。

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

/** ABAC 规则（`GET /api/abac/rule` 列表项；上游没有详情端点，列表项即全量字段） */
export interface AbacRule {
	ruleId: number
	ruleCode: string
	ruleName: string
	/** 空串 = 全局规则；非空则只对该 `roleCode` 生效 */
	roleCode: string
	/** govaluate 表达式（上游**不做语法校验**，见 UP-POL-02） */
	conditionDsl: string
	/** 越小越先匹配 */
	priority: number
	/** @see POLICY_STATUS */
	status: number
}

/** `GET /api/abac/rule` 的 `data`（上游只支持 `page` / `pageSize`，没有 keyword 过滤） */
export interface AbacRuleListResult {
	list: AbacRule[]
	total: number
	page: number
	pageSize: number
}

/**
 * `POST /api/access/dryrun` 入参。
 *
 * 必填只有 `accountId` / `path` / `method`；其余四个字段上游**接受但实测不参与判定**
 * （UP-POL-06），因此页面不提供这几个输入。
 */
export interface AccessDryrunPayload {
	accountId: number
	/** 完整上游路径（`/api/v1/device/list`）：不带 `/api/v1` 前缀会按「未授权」判 */
	path: string
	method: string
	clientIp?: string
	deviceCode?: string
	resourceTags?: string[]
	accountLevel?: number
}

/** `POST /api/access/dryrun` 的 `data`：RBAC 与 ABAC 的合并判定结果 */
export interface AccessDryrunResult {
	allow: boolean
	/** 命中的 ABAC 规则编码；空串 = 未命中任何规则 */
	matchedRule: string
	/** 拒绝原因（`RBAC 未授权该资源与动作` / `账号未绑定任何角色`）；允许时为空串 */
	denyReason: string
	/** 字段级白名单；上游恒回 `null`（未见非空样本） */
	allowedFields: string[] | null
}

/** 角色 / 授权 / 删除类写操作的 `data`（上游统一 `{ ok: true }`） */
export interface PolicyOkResult {
	ok: boolean
}
