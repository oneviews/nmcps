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
 * 取值对齐后端 go-zero 的资源命名（含 v1 遗留的 `monitor` / `protocol`），
 * 新增资源须显式修改本表，而不是放开为通配。
 */
export const GATEWAY_RESOURCES = [
	"ai",
	"alarm",
	"alerts",
	"asset",
	"association",
	"dashboard",
	"device",
	"devices",
	"edge",
	"flow",
	"frequency",
	"group",
	"health",
	"iam",
	"menu",
	"metrics",
	"monitor",
	"ota",
	"permission",
	"product",
	"protocol",
	"role",
	"rule",
	"simulation",
	"targets",
	"telemetry",
	"template",
	"tenant",
	"thing-model",
	"topology",
	"user"
] as const;

export type GatewayResource = (typeof GATEWAY_RESOURCES)[number];

/** 网关解析结果：目标资源 + 透传给上游的路径段 */
export interface GatewayTarget {
	resource: GatewayResource
	/** 已逐段编码、可直接拼进上游 URL 的路径段（不含资源名） */
	segments: string[]
}
