/**
 * BFF ↔ 前端共享的响应契约（同构：`app/` 与 `server/` 都引用本文件）。
 *
 * 约定：BFF 对外的响应**恒为** `ApiResponse<T>` 信封；上游裸 JSON 会被
 * `server/utils/bff/proxy.ts` 包裹成 `{ code: 0, status: "success", data }`。
 * `code` 语义：`0` = 业务成功；`100`–`599` = HTTP 状态码语义（4xx/5xx 失败）。
 */
export type ApiStatus = "success" | "info" | "warning" | "error";

/** 上游/后端字段级校验错误（FastAPI 风格 `loc` + `msg`） */
export interface ValidationError {
	loc: (string | number)[]
	msg: string
	type: string
}

export interface ApiResponse<T = unknown> {
	code: number
	status: ApiStatus
	message: string
	data?: T
	total?: number
	page?: number
	page_size?: number
	location?: string
	error_detail?: ValidationError[]
	timestamp?: string
}

/** 网关允许转发的 HTTP 动词（PATCH 仅对白名单资源开放） */
export const GATEWAY_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type GatewayMethod = (typeof GATEWAY_METHODS)[number];

/**
 * 网关允许转发的上游资源（第一段路径）。
 *
 * 该清单是 BFF 的**出站白名单**：不在表内的资源一律 404，绝不做任意路径透传。
 * 新增资源须显式修改本表，而不是放开为通配。
 *
 * 两组来源：
 * 1. **新代命名空间**（`NMCPS-ADR-0018` D2）：8888 统一网关的十二个服务命名空间 + `health` 探针；
 * 2. **旧代资源名**（go-zero 时代）：客户端数据层还没迁到 `iam` / `asset` / `audit`（C4），
 *    保留只为不中途断链。C4 迁完即整组删除，届时由 `check:bff` 的「旧名 404」断言接手。
 */
export const GATEWAY_RESOURCES = [
	// ── 新代十二命名空间（NMCPS-ADR-0018 D2）+ 就绪探针 ──
	"alarm",
	// 资产域：`GET /asset/device`（设备台账；`snmp_*_pass` 明文，BFF 出口掩码，D7）
	"asset",
	// 审计域：`GET /audit/{operation,security}-logs`、`/audit/archive/records`（D6 的空列表 `null` 源）
	"audit",
	"dashboard",
	"frequency",
	"health",
	// 身份域：`iam/login|refresh|logout|password|users|roles|policies|tenants|subject-roles`
	"iam",
	"metric",
	"protocol",
	"system",
	"task",
	"topology",
	"transmission",
	// ── 旧代资源名（待 C4 客户端迁移后整组删除） ──
	"abac",
	"access",
	"account",
	"ai",
	"alerts",
	"association",
	"device",
	"devices",
	"edge",
	"flow",
	"group",
	"menu",
	"metrics",
	"monitor",
	"ota",
	"permission",
	"product",
	"role",
	"rule",
	"simulation",
	"targets",
	"telemetry",
	"template",
	"tenant",
	"thing-model",
	"user"
] as const;

export type GatewayResource = (typeof GATEWAY_RESOURCES)[number];

/** 网关解析结果：目标资源 + 透传给上游的路径段 */
export interface GatewayTarget {
	resource: GatewayResource
	/** 已逐段编码、可直接拼进上游 URL 的路径段（不含资源名） */
	segments: string[]
}
