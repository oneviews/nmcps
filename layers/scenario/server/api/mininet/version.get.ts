import type { ApiResponse } from "~~/shared/types/api";
import type { MininetVersionInfo } from "#layers/scenario/shared/types/mininet";
import { defineEventHandler, setResponseHeader, setResponseStatus } from "h3";
import { LAB_PERMISSIONS } from "~~/shared/constants/labPermissions";
import { MININET_MESSAGES } from "~~/shared/constants/upstreamReasons";
import { authorizeLab } from "#layers/scenario/server/utils/bff/labGuard";
import { fetchMininetJson } from "#layers/scenario/server/utils/bff/mininet";
import { getMininetConfig } from "#layers/scenario/server/utils/bff/mininetConfig";
import { isLabApiCompatible, LAB_API_CONTRACT } from "#layers/scenario/shared/constants/mininetApi";

/**
 * 与实验后端的握手：`GET /api/mininet/version`（M0 远程化）。
 *
 * 与 `/api/mininet/channel` 的分工：channel 只回能力位、**不触达上游**（NMCPS-ADR-0020），
 * 这里只回「上游是谁 / 能不能对上契约」，需要一次真实读。远程部署（BFF 不在实验主机上）
 * 要靠它把「地址写错」「契约主版本不一致」「忘了配 token」三种情况分开 ——
 * 否则前端只看到后续请求 401/404，分不清是没权限还是版本不对。
 *
 * 只读、无审计：没有副作用，也不回传 token 本身。
 */
export default defineEventHandler(async (event): Promise<ApiResponse<MininetVersionInfo> | ApiResponse<never>> => {
	const authorization = await authorizeLab(event, LAB_PERMISSIONS.READ);
	if (!authorization.ok) {
		return authorization.response;
	}

	const respond = <T>(status: number, body: ApiResponse<T>): ApiResponse<T> => {
		setResponseStatus(event, status);
		setResponseHeader(event, "content-type", "application/json; charset=utf-8");
		setResponseHeader(event, "cache-control", "no-store");
		return body;
	};

	const config = getMininetConfig(event, authorization.principal.tenantId ?? "");
	const timestamp = () => new Date().toISOString();

	if (!config.baseUrl) {
		const message = config.tenantScoped
			? MININET_MESSAGES.tenantRuntimeUnavailable
			: MININET_MESSAGES.notConfigured;
		return respond(503, { code: 503, status: "error", message, timestamp: timestamp() });
	}

	const result = await fetchMininetJson(event, config, "/api/version");
	if (!result.ok) {
		return respond(result.status, {
			code: result.status,
			status: result.status >= 500 ? "error" : "warning",
			message: result.message,
			timestamp: timestamp()
		});
	}

	const record = result.data && typeof result.data === "object"
		? result.data as Record<string, unknown>
		: {};
	const text = (value: unknown): string | null =>
		typeof value === "string" && value.trim() ? value.trim() : null;
	const apiContract = text(record.api_contract);

	return respond(200, {
		code: 0,
		status: "success",
		message: "success",
		data: {
			reachable: true,
			version: text(record.version),
			mininetVersion: text(record.mininet_version),
			apiContract,
			compatible: isLabApiCompatible(apiContract),
			expectedContract: LAB_API_CONTRACT,
			tokenConfigured: config.token.length > 0
		},
		timestamp: timestamp()
	});
});
