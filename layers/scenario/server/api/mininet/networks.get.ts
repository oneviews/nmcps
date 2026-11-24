import type { ApiResponse } from "~~/shared/types/api";
import type { LabNetworkSummary } from "~~/shared/types/lab";
import { defineEventHandler, setResponseHeader, setResponseStatus } from "h3";
import { LAB_PERMISSIONS } from "~~/shared/constants/labPermissions";
import { authorizeLab } from "#layers/scenario/server/utils/bff/labGuard";
import { listLabNetworks, toLabNetworkSummary } from "#layers/scenario/server/utils/bff/labLedger";
import { reconcileLabNetworkStates } from "#layers/scenario/server/utils/bff/labNetworkStateReconcile";

/**
 * 当前租户的仿真网络台账：`GET /api/mininet/networks`。
 *
 * - 只回 BFF `id`、状态与资源计数；`upstream_id` / 租户 ID 不出现在出参；
 * - 静态路由优先于 `server/api/mininet/[...slug].ts`；
 * - 出口前把 `state` 与上游 `GET /api/mininet/start` 对账（`NMCPS-ADR-0026` D4）：
 *   这是本路由**唯一**触达上游的读取，只读一次裸布尔、只纠正 `running` ↔ `stopped`，
 *   读不到就保持原值 —— 台账 seed / 进程重启 / 外部 `mn -c` 都不会再留下
 *   「没启动却显示运行中」；
 * - 台账损坏或不存在 → 空列表（失败关闭，不猜测资源归属，也不读上游）。
 */
export default defineEventHandler(async (event): Promise<ApiResponse<LabNetworkSummary[]> | ApiResponse<never>> => {
	const authorization = await authorizeLab(event, LAB_PERMISSIONS.READ);
	if (!authorization.ok) {
		return authorization.response;
	}

	const records = await reconcileLabNetworkStates(
		event,
		await listLabNetworks(event, authorization.principal)
	);

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
