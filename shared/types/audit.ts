// shared/types/audit.ts
// 审计域契约（上游 `/api/v1/audit` ↔ BFF `/api/audit`）：`app/` 与 `server/` 同构引用。
//
// 设计基准：NMCPS-DESIGN-005 §九（layers/content/collections/cn/architecture/2.domain/system.md）
// 字段口径来自 2026-11-02 对上游的实测（超级管理员 / 租户管理员双身份穷举）+ swagger 比对；
// 与契约不符的 9 项缺口登记在 NMCPS-REC-004
// （layers/content/collections/cn/records/defects/audit-upstream-defects.md）。
//
// 约定：字段名沿用上游 camelCase，不做蛇形转换；BFF 只把错误信封的 `msg` 归一为 `message`。
// 需要时间的字段（`eventTime` / `createdAt`）原样透传，时区换算一律不做。

/**
 * 实测存在的两个 `category` 取值。
 *
 * 上游把它当自由字符串且**大小写敏感**：`session` / `api` 之外的值（含 `API`、`auth`、空串）
 * 会被静默忽略并返回全量（UP-AUD-02），所以页面只提供这两项，不摆「输入类别」的自由输入。
 */
export const AUDIT_CATEGORY = {
	/** 会话类：登录 / 登出 / 会话回收 */
	SESSION: "session",
	/** 接口调用类：`resource` 是请求路径，`action` 是 `METHOD path` */
	API: "api"
} as const;

/** 结果枚举（实测 `auth.login.success` = 1、`auth.login.failed` = 2） */
export const AUDIT_RESULT = {
	/** 成功 */
	SUCCESS: 1,
	/** 失败 */
	FAILURE: 2
} as const;

/** 列表 `pageSize` 的页面级上限：上游 `200` 仍返回 200 条、`500` 回落 20 条却回显 500（UP-AUD-03） */
export const AUDIT_MAX_PAGE_SIZE = 100;

/** 列表 / 详情共有的日志字段（列表项即详情的前 12 个字段） */
export interface AuditLog {
	/** 稳定标识（`AUD…`），也是 `GET /api/audit/{id}` 的路径段 */
	logCode: string
	/** @see AUDIT_CATEGORY；其余取值原样展示 */
	category: string
	/** 操作者账号；`0` 的语义未验证（页面不据此推断「系统动作」） */
	accountId: number
	/** 设备标识，多数日志为空串 */
	deviceCode: string
	/** 会话标识，登录前发生的日志为空串 */
	sessionId: string
	/** 链路追踪 ID，会话类日志为空串 */
	traceId: string
	/** `auth.login.success` / `POST /api/v1/alert/channel` 这类动作名 */
	action: string
	/** 会话类为 `auth`，接口类为请求路径 */
	resource: string
	/** @see AUDIT_RESULT */
	result: number
	clientIp: string
	/** RFC3339 带偏移（`2026-11-02T03:15:09+08:00`），页面原样展示 */
	eventTime: string
	/** 本条日志的链式哈希（`verify` 校验的对象） */
	logHash: string
}

/** 详情额外字段：列表不返回；实测除 `prevHash` 外全为空串（UP-AUD-09） */
export interface AuditLogDetail extends AuditLog {
	sourceService: string
	beforeSnapshot: string
	afterSnapshot: string
	detailJson: string
	/** 链上前一条的哈希：`verify` 报断点时用它定位具体条目 */
	prevHash: string
}

/**
 * `GET /api/audit` 查询参数：只有 swagger 列出的 8 个。
 *
 * `result` / `keyword` / 任意未知参数都会被上游静默忽略（实测 `result=1|2` 与 `keyword=x`
 * 都返回全量，UP-AUD-03），因此这里不登记它们；`accountId: 0` 亦被当「未提供」。
 */
export interface AuditListQuery {
	page: number
	pageSize: number
	accountId?: number
	deviceCode?: string
	sessionId?: string
	category?: string
	traceId?: string
	/** `YYYY-MM-DD HH:MM:SS` 或 RFC3339，两种格式实测等价（UP-AUD-04）；反向区间返回空集 */
	startTime?: string
	endTime?: string
}

/** `GET /api/audit` 的 `data` */
export interface AuditListResult {
	list: AuditLog[]
	total: number
	page: number
	pageSize: number
}

/** `POST /api/audit/verify` 入参：两个都可省，省了校验全量链 */
export interface AuditVerifyPayload {
	startTime?: string
	endTime?: string
}

/**
 * `POST /api/audit/verify` 的 `data`。
 *
 * `brokenAtLogId` 是**整链序号**（实测断点 `18`），不是 `logCode`，也不是当前结果集内的偏移；
 * 页面只能说「第 N 条」，不去猜是哪一条（UP-AUD-05）。
 */
export interface AuditVerifyResult {
	intact: boolean
	checkedCount: number
	/** `intact: true` 时为 `0` */
	brokenAtLogId: number
}

/** `POST /api/audit/export` 入参：前三个必填，缺一项上游回 `500 10509`（UP-AUD-06） */
export interface AuditExportPayload {
	exportName: string
	startTime: string
	endTime: string
	/** `0` 会被当「未提供」，页面不透传 `0` */
	accountId?: number
	category?: string
	deviceCode?: string
}

/** 导出任务（`GET|POST /api/audit/export`） */
export interface AuditExportJob {
	exportCode: string
	exportName: string
	/** 实测只见到 `1`，语义未文档化 → 页面原样展示数字，不猜「生成中 / 已完成」 */
	status: number
	/** 对象存储键，任务未产出时为空串 */
	objectKey: string
	/** 下载地址，任务未产出时为空串；**没有详情端点**可回读进度（UP-AUD-07） */
	downloadUrl: string
	/** 任务未跑完时为 `0` */
	totalRecords: number
	/** 列表比创建响应多 8 小时（同一记录，UP-AUD-08），页面原样展示 */
	createdAt: string
}

/** `GET /api/audit/export` 的 `data` */
export interface AuditExportListResult {
	list: AuditExportJob[]
	total: number
	page: number
	pageSize: number
}
