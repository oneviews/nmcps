import type { ApiResponse, ValidationError } from "../types/api";

/**
 * 判定载荷是否为 BFF 信封（存在 `code` 键即视为信封）。
 *
 * 背景：个别上游（如 `frequency/wifi/*`）成功时返回**裸 JSON**，BFF 会将其包裹为
 * `{ code: 0, data }`；但错误/直通场景仍可能出现裸载荷，故消费面必须二态判定，
 * 不能只按单一形态解包。
 */
export function isApiEnvelope(value: unknown): value is ApiResponse<unknown> {
	return !!value
		&& typeof value === "object"
		&& "code" in (value as Record<string, unknown>);
}

/** 业务成功：`code === 0`（BFF 统一口径）或旧包裹层 `status === "success"` */
export function isSuccessResponse<T>(res: ApiResponse<T> | undefined | null): res is ApiResponse<T> & { data: T } {
	return !!res
		&& res.status !== "warning"
		&& res.status !== "error"
		&& (res.status === "success" || res.code === 0);
}

/** 分页成功（`total` / `page` / `page_size` 平铺） */
export function isPagedResponse<T>(res: ApiResponse<T> | undefined | null): res is ApiResponse<T> & {
	data: T
	total: number
	page: number
	page_size: number
} {
	return isSuccessResponse(res)
		&& typeof res.total === "number"
		&& typeof res.page === "number"
		&& typeof res.page_size === "number";
}

/** 4xx 语义（`warning`）：参数/权限/未认证 */
export function isWarningResponse<T>(res: ApiResponse<T> | undefined | null): res is ApiResponse<T> & { status: "warning" } {
	return !!res && res.status === "warning";
}

/** 5xx 语义（`error`）：上游故障/网关兜底 */
export function isErrorResponse<T>(res: ApiResponse<T> | undefined | null): res is ApiResponse<T> & { status: "error" } {
	return !!res && res.status === "error";
}

/** 取首条字段级校验错误，用于表单内联提示 */
export function firstValidationError(res: ApiResponse<unknown> | undefined | null): ValidationError | undefined {
	return res?.error_detail?.find((item) => item.msg.trim().length > 0);
}
