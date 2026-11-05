import type { ApiResponse } from "~~/shared/types/api";
import { defineEventHandler, setResponseHeader, setResponseStatus } from "h3";

/**
 * `/api/sim` 本身没有路径段：与主网关 `/api` 同口径回 400 `bff_path_missing`。
 *
 * 没有这个文件时，无路径段的请求会落到 `server/api/[...slug].ts` 的网关，
 * 得到 404 `bff_resource_not_allowed` —— 把「少写了路径」误报成「路径不允许」，
 * 排查时会把两条通道搅在一起（NMCPS-ARCH-002 §6.3）。
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
