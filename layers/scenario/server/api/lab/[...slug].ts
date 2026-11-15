import type { ApiResponse } from "~~/shared/types/api";
import { defineEventHandler, setResponseHeader, setResponseStatus } from "h3";
import { respondAuth } from "~~/server/utils/bff/auth";
import { LAB_PERMISSIONS } from "~~/shared/constants/labPermissions";
import { MININET_MESSAGES } from "~~/shared/constants/upstreamReasons";
import { authorizeLab } from "#layers/scenario/server/utils/bff/labGuard";
import { getActiveLabNetwork, isLabResourceAllowed } from "#layers/scenario/server/utils/bff/labLedger";
import { proxyToMininet } from "#layers/scenario/server/utils/bff/mininet";
import { getMininetConfig } from "#layers/scenario/server/utils/bff/mininetConfig";
import { resolveMininetRoute } from "#layers/scenario/shared/constants/mininetRoutes";

/** 服务探针不属于租户网络：没有台账也必须能判断“实验床在不在” */
const NETWORK_FREE_ROUTES = new Set(["/health", "/version", "/ryu/apps"]);

/**
 * Mininet 实验通道：`/api/lab/**` → 第三上游（默认 `127.0.0.1:8000`）。
 *
 * 与 `server/api/[...slug].ts`（主网关）和 `server/api/sim/**`（仿真平台）并列、互不重叠：
 * - 路径先过 `MININET_ROUTES` 逐端点白名单（模板匹配，非前缀放行）→ 未命中 404、动词不符 405；
 * - 白名单只有 GET：写操作没有入口，不依赖运行时开关；
 * - 通道未启用（`baseUrl` 为空）→ 503 `mininet_not_configured`；
 * - 出站不携带 authorization / cookie（`proxyToMininet` 只做 GET）。
 *
 * 依据 NMCPS-ADR-0020（layers/content/collections/cn/records/adr/adr-0020.md）。
 */
export default defineEventHandler(async (event): Promise<ApiResponse<unknown>> => {
	const authorization = await authorizeLab(event, LAB_PERMISSIONS.READ);
	if (!authorization.ok) {
		return authorization.response;
	}

	const resolution = resolveMininetRoute(event.context.params?.slug, event.method);

	if ("rejection" in resolution) {
		const { status, message } = resolution.rejection;
		setResponseStatus(event, status);
		setResponseHeader(event, "content-type", "application/json; charset=utf-8");
		setResponseHeader(event, "cache-control", "no-store");

		return {
			code: status,
			status: "warning",
			message,
			timestamp: new Date().toISOString()
		};
	}

	// `tenantId` 在读权限判定中必为非空；`?? ""` 只是让类型收敛，且空串同样查不到实例（失败关闭）
	const tenantId = authorization.principal.tenantId ?? "";
	const config = getMininetConfig(event, tenantId);

	// 先判实例：未配置是 P1 的 503，优先级高于 P2 的“台账无记录”
	if (!config.baseUrl || NETWORK_FREE_ROUTES.has(resolution.route.template)) {
		return await proxyToMininet(event, resolution, config);
	}

	const network = await getActiveLabNetwork(event, authorization.principal, "mininet");
	if (!network) {
		return respondAuth<never>(event, 404, MININET_MESSAGES.resourceNotFound);
	}

	if (!isLabResourceAllowed(network, resolution.params)) {
		return respondAuth<never>(event, 404, MININET_MESSAGES.resourceNotFound);
	}

	return await proxyToMininet<unknown>(event, resolution, config, { network });
});
