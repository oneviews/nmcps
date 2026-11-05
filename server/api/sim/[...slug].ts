import type { ApiResponse } from "~~/shared/types/api";
import { defineEventHandler, setResponseHeader, setResponseStatus } from "h3";
import { getSimulatorConfig } from "~~/server/utils/bff/simConfig";
import { proxyToSimulator } from "~~/server/utils/bff/simulator";
import { resolveSimulatorRoute } from "~~/shared/constants/simulatorRoutes";
import { SIMULATOR_MESSAGES } from "~~/shared/constants/upstreamReasons";

/**
 * 仿真平台通道：`/api/sim/**` → 第二上游（8001）。
 *
 * 与 `server/api/[...slug].ts`（主上游网关）并列、互不重叠：
 * - 路径先过 `SIMULATOR_ROUTES` 逐端点白名单（模板匹配，非前缀放行）→ 未命中 404、动词不符 405；
 * - 通道未启用（`baseUrl` 为空）→ 503 `simulator_not_configured`，与「未配主上游」同口径；
 * - 写端点（`write: true`）在 `allowWrite: false` 时直接 405 `simulator_write_disabled`，不触达上游。
 *
 * 依据 NMCPS-ARCH-002 §6（layers/content/collections/cn/architecture/1.architecture/datasource-architecture.md）、
 * 跨层裁决 NMCPS-ADR-0019 决策 B / D5，白名单本体见 `shared/constants/simulatorRoutes.ts`。
 */
export default defineEventHandler(async (event): Promise<ApiResponse<unknown>> => {
	const resolution = resolveSimulatorRoute(event.context.params?.slug, event.method);

	if ("rejection" in resolution) {
		const { status, message } = resolution.rejection;
		setResponseStatus(event, status);
		setResponseHeader(event, "content-type", "application/json; charset=utf-8");
		setResponseHeader(event, "cache-control", "no-store");

		return {
			code: status,
			status: status >= 500 ? "error" : "warning",
			message,
			timestamp: new Date().toISOString()
		};
	}

	const config = getSimulatorConfig(event);

	if (!config.baseUrl) {
		setResponseStatus(event, 503);
		setResponseHeader(event, "content-type", "application/json; charset=utf-8");
		setResponseHeader(event, "cache-control", "no-store");

		return {
			code: 503,
			status: "error",
			message: SIMULATOR_MESSAGES.notConfigured,
			timestamp: new Date().toISOString()
		};
	}

	if (resolution.route.write && !config.allowWrite) {
		setResponseStatus(event, 405);
		setResponseHeader(event, "content-type", "application/json; charset=utf-8");
		setResponseHeader(event, "cache-control", "no-store");

		return {
			code: 405,
			status: "warning",
			message: SIMULATOR_MESSAGES.writeDisabled,
			timestamp: new Date().toISOString()
		};
	}

	return await proxyToSimulator(event, {
		route: resolution.route,
		segments: resolution.segments
	});
});
