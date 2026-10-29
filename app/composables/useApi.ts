import type { ApiResponse, ApiStatus, ValidationError } from "~~/shared/types/api";
import { isTauri } from "@tauri-apps/api/core";
import { isApiEnvelope, isSuccessResponse } from "~~/shared/utils/apiGuard";

/** BFF 调用失败的结构化错误（`code` 保留 HTTP/业务语义，便于 UI 分类） */
export class ApiError extends Error {
	readonly code: number;
	readonly status: ApiStatus;
	readonly detail?: ValidationError[];

	constructor(message: string, code: number, status: ApiStatus, detail?: ValidationError[]) {
		super(message);
		this.name = "ApiError";
		this.code = code;
		this.status = status;
		this.detail = detail;
	}
}

export interface ApiRequestOptions {
	method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
	query?: Record<string, unknown>
	body?: unknown
	headers?: Record<string, string>
	signal?: AbortSignal
	timeoutMs?: number
}

function toApiError(res: ApiResponse<unknown>): ApiError {
	return new ApiError(res.message || "api_request_failed", res.code, res.status, res.error_detail);
}

function normalizeFetchError(error: unknown): ApiError {
	if (error instanceof ApiError) {
		return error;
	}

	const record = error && typeof error === "object" ? error as Record<string, unknown> : undefined;
	const payload = record?.data;

	if (isApiEnvelope(payload)) {
		return toApiError(payload as ApiResponse<unknown>);
	}

	const message = typeof record?.message === "string" && record.message.trim()
		? record.message
		: "api_network_error";

	return new ApiError(message, 0, "error");
}

/**
 * BFF API 客户端（web 与桌面共用）。
 *
 * - web：`public.bffBase` 留空 ⇒ 走同源 `/api/**`；
 * - 桌面：`public.bffBase` 必须在构建时指向已部署的 BFF；未配置时**显式报错**
 *   （`bff_not_configured`），不静默回落到 Tauri 自身 origin —— 静态包里没有 Nitro。
 * - 返回值恒为解包后的 `data`；失败抛 `ApiError`，由调用方决定 toast / 表单内联提示。
 */
export function useApi() {
	const config = useRuntimeConfig();
	const baseURL = String(config.public.bffBase ?? "").replace(/\/+$/, "");
	const isDesktop = isTauri();
	const isConfigured = computed(() => !isDesktop || baseURL.length > 0);

	async function request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
		if (!isConfigured.value) {
			throw new ApiError("bff_not_configured", 0, "error");
		}

		const normalizedPath = path.startsWith("/") ? path : `/${path}`;

		try {
			const response = await $fetch<ApiResponse<T>>(normalizedPath, {
				baseURL,
				method: options.method ?? "GET",
				query: options.query,
				body: options.body as Record<string, unknown> | undefined,
				headers: options.headers,
				signal: options.signal,
				timeout: options.timeoutMs ?? 20_000,
				credentials: "include"
			});

			if (!isSuccessResponse(response)) {
				throw toApiError(response);
			}

			return response.data as T;
		} catch (error) {
			throw normalizeFetchError(error);
		}
	}

	return {
		isConfigured,
		request,
		get: <T>(path: string, options: Omit<ApiRequestOptions, "method" | "body"> = {}) =>
			request<T>(path, { ...options, method: "GET" }),
		post: <T>(path: string, body?: unknown, options: Omit<ApiRequestOptions, "method" | "body"> = {}) =>
			request<T>(path, { ...options, method: "POST", body }),
		put: <T>(path: string, body?: unknown, options: Omit<ApiRequestOptions, "method" | "body"> = {}) =>
			request<T>(path, { ...options, method: "PUT", body }),
		patch: <T>(path: string, body?: unknown, options: Omit<ApiRequestOptions, "method" | "body"> = {}) =>
			request<T>(path, { ...options, method: "PATCH", body }),
		del: <T>(path: string, options: Omit<ApiRequestOptions, "method" | "body"> = {}) =>
			request<T>(path, { ...options, method: "DELETE" })
	};
}
