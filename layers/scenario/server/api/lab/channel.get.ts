import type { ApiResponse } from "~~/shared/types/api";
import type { MininetChannelInfo } from "#layers/scenario/shared/types/mininet";
import { defineEventHandler, setResponseHeader, setResponseStatus } from "h3";
import { LAB_PERMISSIONS } from "~~/shared/constants/labPermissions";
import { authorizeLab } from "#layers/scenario/server/utils/bff/labGuard";
import { getMininetConfig } from "#layers/scenario/server/utils/bff/mininetConfig";
import { MININET_ROUTES } from "#layers/scenario/shared/constants/mininetRoutes";

/**
 * Lab 通道能力探针：`GET /api/lab/channel`。
 *
 * 三条约束（NMCPS-ADR-0020）：
 * 1. 只回能力位，**不回 baseUrl**：实验后端地址属服务端配置；
 * 2. 通道未启用时仍回 200 + `configured: false`：这是“没开”，不是错误；
 * 3. 静态路由优先于 `server/api/lab/[...slug].ts`，本身不触达上游。
 */
export default defineEventHandler(async (event): Promise<ApiResponse<MininetChannelInfo> | ApiResponse<never>> => {
	const authorization = await authorizeLab(event, LAB_PERMISSIONS.READ);
	if (!authorization.ok) {
		return authorization.response;
	}

	const config = getMininetConfig(event, authorization.principal.tenantId ?? "");

	setResponseStatus(event, 200);
	setResponseHeader(event, "content-type", "application/json; charset=utf-8");
	setResponseHeader(event, "cache-control", "no-store");

	return {
		code: 0,
		status: "success",
		message: "success",
		data: {
			configured: config.baseUrl.length > 0,
			readOnly: true,
			writeEnabled: false,
			endpointCount: MININET_ROUTES.length,
			timeoutMs: config.timeoutMs,
			readinessPath: "/api/health"
		},
		timestamp: new Date().toISOString()
	};
});
