// shared/types/audit.ts
// 审计域契约（上游 `/api/v1/audit/*` ↔ BFF `/api/audit/*`）：`app/` 与 `server/` 同构引用。
//
// 设计基准：NMCPS-DESIGN-005 §九（layers/content/collections/cn/architecture/2.domain/system.md）
// 代际：2026-11-04 起对接新代 `audit` 命名空间（NMCPS-ADR-0018 D2）。旧代只有一个 `/api/audit`
// 端点、用 `category`（`session` / `api`）区分日志族；新代按日志族**拆成三个端点**，
// 主键从 `logCode` 变 `id`（UUID），并新增 `statistics` 与 `archive/*`。
//
// 字段口径来源（2026-11-04 对 `http://192.168.1.55:8888/api/v1` 的实测 + swagger 比对）：
//   - 查询参数与分页信封（`page` / `page_size` / `total` / `list`）实测可用；
//   - 归档记录（`/audit/archive/records`）**有真实数据**，字段集合已逐字核对；
//   - **操作日志 / 安全日志的条目字段集合无法实测**：该实例审计库为空（`list: null`，
//     且 IAM 写操作不产生审计行），swagger 只把响应描述成 `audit_BaseResp`（`code` + `message`）。
//     因此这两个条目类型只登记「由查询参数与表名反推、待有数据实例复核」的字段，
//     全部可选，并允许未登记字段原样出现（`[key: string]: unknown`）——
//     页面按「有值才渲染」处理，不把缺失当成上游缺陷，也不编造语义。
//
// 约定：字段名沿用上游 snake_case，不做驼峰转换；BFF 只把错误信封的 `msg` 归一为 `message`。
// 时间字段原样透传（RFC3339 带偏移），时区换算一律不做。

/**
 * 日志族：每一族一个端点（旧代用 `category` 区分，见 NMCPS-ADR-0018 §三）。
 *
 * 三族的**字段不同、筛选参数不同、时间参数不同**，所以页面把「族」做成工具栏常驻控件，
 * 而不是把三套字段并成一张表。
 */
export const AUDIT_LOG_KIND = {
	/** 操作日志：`GET /api/audit/operation-logs`（业务写操作的流水） */
	OPERATION: "operation",
	/** 安全日志：`GET /api/audit/security-logs`（认证 / 授权判定） */
	SECURITY: "security",
	/** 归档记录：`GET /api/audit/archive/records`（归档批次，不是日志本身） */
	ARCHIVE: "archive"
} as const;

export type AuditLogKind = typeof AUDIT_LOG_KIND[keyof typeof AUDIT_LOG_KIND];

/** 归档任务的两张来源表（`POST /audit/archive/run` 的 `table_name`，空 = 全部） */
export const AUDIT_ARCHIVE_TABLE = {
	/** 操作日志表 */
	OPERATION: "sys_operation_log",
	/** 安全日志表（审计日志） */
	SECURITY: "sys_audit_log"
} as const;

/**
 * 列表 `page_size` 的页面级上限。
 *
 * 旧代实测 `500` 回落 20 条却回显 500；新代未复测该行为（审计库为空），这条上限沿用旧口径：
 * 只是「别把明显不合理的值发出去」，不宣称上游会夹。
 */
export const AUDIT_MAX_PAGE_SIZE = 100;

/**
 * 三族共用的分页信封。
 *
 * **实测：空结果上游给 `list: null`**（`NMCPS-ADR-0018` D6）。BFF 出口已把它归一为 `[]`
 * （`server/utils/bff/proxy.ts`），但类型仍标成可能为 `null`：`useAuditLogs` 自己再兜一次。
 */
export interface AuditPaged<T> {
	list: T[] | null
	total: number
	page: number
	page_size: number
}

/**
 * 操作日志条目。
 *
 * `id`（UUID）已实测（详情端点用它当路径段，未知 id 回 `code: 40401`）；其余字段是
 * **按 openapi 的查询参数反推**（`user_id` / `username` / `module` / `operation` /
 * `target_type` / `target_id` / `status` / `ip_address` / `keyword` 同族 + 表名
 * `sys_operation_log`），未在真实数据上核对过（见文件头）。
 */
export interface AuditOperationLog {
	/** 主键（UUID）；详情端点 `GET /audit/operation-logs/{id}` 的路径段 */
	id: string
	/** 操作者账号 ID */
	user_id?: string
	/** 操作者账号名（列表里直接可读的那个） */
	username?: string
	/** 所属模块（`iam` / `asset` …） */
	module?: string
	/** 动作名（具体取值未实测） */
	operation?: string
	/** 目标对象类型 */
	target_type?: string
	/** 目标对象 ID */
	target_id?: string
	/** 结果（归档记录实测用 `success`；操作日志的取值未实测） */
	status?: string
	/** 来源 IP */
	ip_address?: string
	/** 链路追踪 ID（若有） */
	trace_id?: string
	/** 发生时间（RFC3339 带偏移，原样展示） */
	created_at?: string
	/** 未登记字段原样透传：实测样本出现前不宣称字段集合是封闭的 */
	[key: string]: unknown
}

/**
 * 安全日志条目。
 *
 * 同样**未在真实数据上核对过**：字段由 `security-logs` 的查询参数反推
 * （`subject_type` / `subject_id` / `subject_name` / `action` / `resource` /
 * `auth_decision` / `ip_address` / `trace_id`）+ 表名 `sys_audit_log`。
 */
export interface AuditSecurityLog {
	/** 主键（UUID）；详情端点 `GET /audit/security-logs/{id}` 的路径段 */
	id: string
	/** 主体类型（`user` / `service` …，取值未实测） */
	subject_type?: string
	/** 主体 ID */
	subject_id?: string
	/** 主体名 */
	subject_name?: string
	/** 动作名 */
	action?: string
	/** 资源（路径或资源标识） */
	resource?: string
	/** 授权判定（`allow` / `deny` 之类的取值未实测） */
	auth_decision?: string
	/** 来源 IP */
	ip_address?: string
	/** 链路追踪 ID */
	trace_id?: string
	/** 发生时间（RFC3339 带偏移，原样展示） */
	logged_at?: string
	/** 未登记字段原样透传 */
	[key: string]: unknown
}

/**
 * 归档记录 —— **字段集合已实测**（2026-11-04 真跑一次 `POST /audit/archive/run` 后回读）：
 *
 * ```json
 * { "id": "…", "table_name": "sys_operation_log", "archive_batch": "…", "rows_archived": 0,
 *   "cutoff_before": "2026-08-06T10:34:39.998235+08:00", "started_at": "…", "finished_at": "…",
 *   "status": "success", "created_at": "…" }
 * ```
 *
 * 详情与列表项同形（实测 `GET /audit/archive/records/{id}` 就是这一份对象）。
 */
export interface AuditArchiveRecord {
	id: string
	/** 来源表：`sys_operation_log` / `sys_audit_log` */
	table_name: string
	/** 批次号（实测与 `id` 同值，但不依赖这个巧合） */
	archive_batch: string
	/** 本批次搬迁的行数（空表 = 0） */
	rows_archived: number
	/** 截止时刻：早于它的数据被归档 */
	cutoff_before: string
	started_at: string
	finished_at: string
	/** 实测取值 `success`；其余取值未见过，页面原样展示 */
	status: string
	created_at: string
}

/** 三族共用的分页参数 */
export interface AuditPageQuery {
	page: number
	/** 上游字段名就是 snake_case（旧代是 `pageSize`） */
	page_size: number
}

/**
 * `GET /api/audit/operation-logs` 的查询参数（openapi 全列）。
 *
 * 时间边界是 **epoch 毫秒整数**：`/audit/statistics` 的 `time_from` / `time_to` 在 openapi 里
 * 明写「unix milli」，同服务族的 `created_from` / `created_to` 按同一口径处理。
 * 页面把 `datetime-local` 字面值（本地时）转成绝对毫秒再发，不再发字符串。
 */
export interface AuditOperationLogQuery extends AuditPageQuery {
	user_id?: string
	username?: string
	module?: string
	operation?: string
	target_type?: string
	target_id?: string
	status?: string
	ip_address?: string
	keyword?: string
	sort_by?: string
	sort_order?: string
	created_from?: number
	created_to?: number
}

/** `GET /api/audit/security-logs` 的查询参数（openapi 全列；时间边界同为 epoch 毫秒） */
export interface AuditSecurityLogQuery extends AuditPageQuery {
	subject_type?: string
	subject_id?: string
	subject_name?: string
	action?: string
	resource?: string
	auth_decision?: string
	ip_address?: string
	trace_id?: string
	logged_from?: number
	logged_to?: number
}

/** `GET /api/audit/archive/records` 的查询参数：**没有时间条件**，只有表名与状态 */
export interface AuditArchiveQuery extends AuditPageQuery {
	table_name?: string
	status?: string
}

/**
 * `POST /api/audit/archive/run` 入参：`table_name` 可省，省了归档两张表。
 * 实测返回 `data: { sys_operation_log: 0, sys_audit_log: 0 }`（按表名给行数），
 * 指定 `table_name` 时只回那一张表。
 */
export interface AuditRunArchivePayload {
	table_name?: typeof AUDIT_ARCHIVE_TABLE[keyof typeof AUDIT_ARCHIVE_TABLE]
}

/** `POST /api/audit/archive/run` 的 `data`：表名 → 本批次搬迁行数 */
export type AuditRunArchiveResult = Record<string, number>;

/**
 * `GET /api/audit/statistics` 的 `data`。
 *
 * 实测空库回 `{ groups: null, timeline: null, total: 0 }`：`groups` / `timeline` 的**元素结构
 * 无法实测**，所以这里登记成 `unknown`，页面当前不消费它（统计卡要先有真实样本才能定口径）。
 */
export interface AuditStatistics {
	groups: unknown
	timeline: unknown
	total: number
}
