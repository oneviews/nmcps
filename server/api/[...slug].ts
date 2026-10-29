import type { ApiResponse } from "~~/shared/types/api";
import { defineEventHandler, setResponseHeader, setResponseStatus } from "h3";
import { resolveGatewayTarget } from "~~/server/utils/bff/gateway";
import { proxyToUpstream } from "~~/server/utils/bff/proxy";

/**
 * 统一网关：`/api/**` → 上游 REST。
 *
 * 目标路径由 `resolveGatewayTarget` 依据资源/动词白名单解析（拒绝任意透传），
 * 实际出站只发生在 `server/utils/bff/proxy.ts`（超时、Header 白名单、信封归一化）。
 * 网关拒绝同样以 `ApiResponse` 信封返回，前端只需处理一种响应形态。
 */
export default defineEventHandler(async (event): Promise<ApiResponse<unknown>> => {
	const resolution = resolveGatewayTarget(event.context.params?.slug, event.method);

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

	const { target } = resolution;

	return await proxyToUpstream(event, {
		method: event.method,
		path: [target.resource, ...target.segments]
	});
});
