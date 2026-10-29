import type { ApiResponse } from "~~/shared/types/api";
import { defineEventHandler, setResponseHeader, setResponseStatus } from "h3";

/**
 * `/api` 与 `/api/`：没有资源段，直接以 `ApiResponse` 信封返回 400（`bff_path_missing`）。
 *
 * 缺此路由时请求不会命中 `server/api/[...slug].ts`，会落到 SPA 渲染器并返回 HTML，
 * 客户端按信封解包会失败。网关的所有拒绝都必须保持同一种响应形态（见 NMCPS-ADR-0007）。
 */
export default defineEventHandler((event): ApiResponse<never> => {
	setResponseStatus(event, 400);
	setResponseHeader(event, "content-type", "application/json; charset=utf-8");
	setResponseHeader(event, "cache-control", "no-store");

	return {
		code: 400,
		status: "warning",
		message: "bff_path_missing",
		timestamp: new Date().toISOString()
	};
});
