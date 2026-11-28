import type { ApiResponse } from "~~/shared/types/api";
import type { MininetChannelInfo } from "#layers/scenario/shared/types/mininet";
import { defineEventHandler, setResponseHeader, setResponseStatus } from "h3";
import { LAB_PERMISSIONS, labPermissionsOf } from "~~/shared/constants/labPermissions";
import { authorizeLab } from "#layers/scenario/server/utils/bff/labGuard";
import { getActiveLabNetwork } from "#layers/scenario/server/utils/bff/labLedger";
import { getMininetConfig } from "#layers/scenario/server/utils/bff/mininetConfig";
import { MININET_ROUTES } from "#layers/scenario/shared/constants/mininetRoutes";

/**
 * Lab 通道能力探针：`GET /api/mininet/channel`。
 *
 * 三条约束（NMCPS-ADR-0020）：
 * 1. 只回能力位，**不回 baseUrl**：实验后端地址属服务端配置；
 * 2. 通道未启用时仍回 200 + `configured: false`：这是“没开”，不是错误；
 * 3. 静态路由优先于 `server/api/mininet/[...slug].ts`，本身不触达上游。
 *
 * `sessionId` 是唯一一条来自台账的字段（`NMCPS-ADR-0029` M1.2）：2.0 的更新类动作
 * （位置 / 主机与路由器属性 / 链路属性）要拼 `/sessions/{id}/...`，页面必须能读到它。
 * 台账是本机 JSON，读它不算触达上游，第 3 条仍然成立。
 */
export default defineEventHandler(async (event): Promise<ApiResponse<MininetChannelInfo> | ApiResponse<never>> => {
	const authorization = await authorizeLab(event, LAB_PERMISSIONS.READ);
	if (!authorization.ok) {
		return authorization.response;
	}

	const config = getMininetConfig(event, authorization.principal.tenantId ?? "");
	const network = await getActiveLabNetwork(event, authorization.principal, "mininet");
	const granted = labPermissionsOf(authorization.principal);
	const capabilities = {
		read: granted.has(LAB_PERMISSIONS.READ),
		create: granted.has(LAB_PERMISSIONS.CREATE),
		operate: granted.has(LAB_PERMISSIONS.OPERATE),
		delete: granted.has(LAB_PERMISSIONS.DELETE),
		terminal: granted.has(LAB_PERMISSIONS.TERMINAL),
		sniffer: granted.has(LAB_PERMISSIONS.SNIFFER),
		snmp: granted.has(LAB_PERMISSIONS.SNMP)
	};
	const writeEnabled = capabilities.create || capabilities.operate || capabilities.delete || capabilities.sniffer || capabilities.snmp;

	setResponseStatus(event, 200);
	setResponseHeader(event, "content-type", "application/json; charset=utf-8");
	setResponseHeader(event, "cache-control", "no-store");

	return {
		code: 0,
		status: "success",
		message: "success",
		data: {
			configured: config.baseUrl.length > 0,
			readOnly: !writeEnabled,
			writeEnabled,
			capabilities,
			endpointCount: MININET_ROUTES.length,
			timeoutMs: config.timeoutMs,
			readinessPath: "/api/health",
			sessionId: network?.session_id ?? null
		},
		timestamp: new Date().toISOString()
	};
});
