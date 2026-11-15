import type { ApiResponse } from "~~/shared/types/api";
import type { LabNetworkSummary } from "~~/shared/types/lab";
import { defineEventHandler, setResponseHeader, setResponseStatus } from "h3";
import { LAB_PERMISSIONS } from "~~/shared/constants/labPermissions";
import { authorizeLab } from "#layers/scenario/server/utils/bff/labGuard";
import { listLabNetworks, toLabNetworkSummary } from "#layers/scenario/server/utils/bff/labLedger";

/**
 * 当前租户的仿真网络台账：`GET /api/lab/networks`。
 *
 * - 只回 BFF `id`、状态与资源计数；`upstream_id` / 租户 ID 不出现在出参；
 * - 静态路由优先于 `server/api/lab/[...slug].ts`，本身不触达 Mininet；
 * - 台账损坏或不存在 → 空列表（失败关闭，不猜测资源归属）。
 */
export default defineEventHandler(async (event): Promise<ApiResponse<LabNetworkSummary[]> | ApiResponse<never>> => {
	const authorization = await authorizeLab(event, LAB_PERMISSIONS.READ);
	if (!authorization.ok) {
		return authorization.response;
	}

	const records = await listLabNetworks(event, authorization.principal);

	setResponseStatus(event, 200);
	setResponseHeader(event, "content-type", "application/json; charset=utf-8");
	setResponseHeader(event, "cache-control", "no-store");

	return {
		code: 0,
		status: "success",
		message: "success",
		data: records.map((record) => toLabNetworkSummary(record)),
		timestamp: new Date().toISOString()
	};
});
