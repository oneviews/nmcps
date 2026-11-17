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
	/**
	 * 是否参与认证（默认 `true`）：
	 * - 桌面端注入 `Authorization: Bearer <访问令牌>`；
	 * - 收到 401 后单飞刷新一次并重试原请求。
	 *
	 * 登录、刷新、会话探测等端点应显式传 `false`，避免递归刷新（NMCPS-ADR-0011）。
	 */
	auth?: boolean
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
 * BFF 导出通道（NMCPS-ADR-0022 §五）的下载结果：`filename` 取 BFF 生成的
 * `content-disposition`，缺失时才回落到调用方的默认名。
 */
export interface ApiDownload {
	blob: Blob
	filename: string
}

/** `content-disposition: attachment; filename="lab-net_x-20261116T101500Z.json"` → 文件名 */
function filenameOf(disposition: string | null | undefined): string | undefined {
	const match = disposition?.match(/filename="?([^";]+)"?/i);
	return match?.[1]?.trim() || undefined;
}

/** 下载失败时响应体可能是 JSON 信封（`fail()` 的输出），也可能是 Blob —— 两种都要能解错 */
async function errorPayloadOf(raw: unknown): Promise<unknown> {
	const record = raw && typeof raw === "object" ? raw as { data?: unknown, response?: Response } : undefined;
	const data = record?.data;

	if (typeof data === "string") {
		return safeJsonParse(data);
	}
	if (data instanceof Blob) {
		return safeJsonParse(await data.text());
	}
	if (record?.response) {
		return safeJsonParse(await record.response.text().catch(() => ""));
	}

	return undefined;
}

function safeJsonParse(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return raw;
	}
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
	const { accessToken } = useAuthTokens();

	async function send<T>(path: string, options: ApiRequestOptions, withAuth: boolean): Promise<T> {
		const headers: Record<string, string> = { ...options.headers };

		if (isDesktop) {
			// 桌面端静态包没有同源 cookie：显式标识客户端并按需注入 Bearer
			headers["x-nmcps-client"] = "desktop";

			if (withAuth) {
				const token = await accessToken();
				if (token)
					headers.authorization = `Bearer ${token}`;
			}
		}

		const response = await $fetch<ApiResponse<T>>(path, {
			baseURL,
			method: options.method ?? "GET",
			query: options.query,
			body: options.body as Record<string, unknown> | undefined,
			headers,
			signal: options.signal,
			timeout: options.timeoutMs ?? 20_000,
			credentials: "include"
		});

		if (!isSuccessResponse(response)) {
			throw toApiError(response);
		}

		return response.data as T;
	}

	async function request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
		if (!isConfigured.value) {
			throw new ApiError("bff_not_configured", 0, "error");
		}

		const normalizedPath = path.startsWith("/") ? path : `/${path}`;
		const withAuth = options.auth !== false;

		try {
			return await send<T>(normalizedPath, options, withAuth);
		} catch (raw) {
			const error = normalizeFetchError(raw);

			// 401 → 单飞刷新一次并重试（上游刷新即轮换，不能并发刷新；认证端点自身不再递归）
			if (withAuth && isUnauthorizedCode(error.code) && await refreshAuthSession()) {
				try {
					return await send<T>(normalizedPath, options, withAuth);
				} catch (retryError) {
					throw normalizeFetchError(retryError);
				}
			}

			throw error;
		}
	}

	/**
	 * 文件下载（导出通道）：成功时交回 `{ blob, filename }`，失败仍抛 `ApiError`。
	 *
	 * 为什么不用 `send()`：那条路径把响应解成 `ApiResponse` 信封，而导出回的是**纯文本 / 二进制**
	 * （`export_json` 是 JSON 字符串、`export_script` 是 Python 源码、`sniffer/export` 是 pcap），
	 * 套信封会把内容二次编码，另存下来既不是 `.json`、`.py` 也不是可打开的 `.pcap`。
	 * `$fetch.raw` + `responseType: "blob"` 保留原始字节与响应头，`content-disposition` 里的
	 * 文件名是 BFF 生成的。
	 */
	async function download(
		path: string,
		options: { fallbackFilename: string, accept?: string }
	): Promise<ApiDownload> {
		if (!isConfigured.value) {
			throw new ApiError("bff_not_configured", 0, "error");
		}

		const headers: Record<string, string> = { accept: options.accept ?? "text/plain" };
		if (isDesktop) {
			headers["x-nmcps-client"] = "desktop";
			const token = await accessToken();
			if (token) {
				headers.authorization = `Bearer ${token}`;
			}
		}

		try {
			const response = await $fetch.raw<Blob>(path, {
				baseURL,
				method: "GET",
				headers,
				responseType: "blob",
				credentials: "include",
				timeout: 60_000
			});

			return {
				blob: response._data as Blob,
				filename: filenameOf(response.headers.get("content-disposition")) ?? options.fallbackFilename
			};
		} catch (raw) {
			const payload = await errorPayloadOf(raw);
			if (isApiEnvelope(payload)) {
				throw toApiError(payload as ApiResponse<unknown>);
			}

			const status = (raw as { response?: { status?: number } })?.response?.status ?? 0;
			throw new ApiError(
				typeof payload === "string" && payload.trim() ? payload.trim() : "api_request_failed",
				status,
				status >= 500 ? "error" : "warning"
			);
		}
	}

	return {
		isConfigured,
		/** 归一化后的 BFF 基址（web 为空串 ⇒ 同源；桌面为构建时注入的地址） */
		bffBase: baseURL,
		request,
		get: <T>(path: string, options: Omit<ApiRequestOptions, "method" | "body"> = {}) =>
			request<T>(path, { ...options, method: "GET" }),
		post: <T>(path: string, body?: unknown, options: Omit<ApiRequestOptions, "method" | "body"> = {}) =>
			request<T>(path, { ...options, method: "POST", body }),
		put: <T>(path: string, body?: unknown, options: Omit<ApiRequestOptions, "method" | "body"> = {}) =>
			request<T>(path, { ...options, method: "PUT", body }),
		patch: <T>(path: string, body?: unknown, options: Omit<ApiRequestOptions, "method" | "body"> = {}) =>
			request<T>(path, { ...options, method: "PATCH", body }),
		del: <T>(path: string, body?: unknown, options: Omit<ApiRequestOptions, "method" | "body"> = {}) =>
			// DELETE 也带请求体：上游 `DELETE /api/mininet/flows`（ADR-0022 W2b）用 `FlowRuleDelete`
			// 定位要删哪些流，路径里装不下。`$fetch` 与本层 `send()` 都原样转发。
			request<T>(path, { ...options, method: "DELETE", body }),
		download
	};
}
