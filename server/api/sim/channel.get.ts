import type { ApiResponse } from "~~/shared/types/api";
import type { SimulatorChannelInfo } from "~~/shared/types/simulator";
import { defineEventHandler, setResponseHeader, setResponseStatus } from "h3";
import { getSimulatorConfig } from "~~/server/utils/bff/simConfig";

/**
 * 仿真通道能力探针：`GET /api/sim/channel`。
 *
 * 页面据此决定写按钮可不可点 —— 前端**不猜**写权限，也就不必「点了再收 405」。
 *
 * 三条约束（NMCPS-ARCH-002 §6.1，layers/content/collections/cn/architecture/1.architecture/datasource-architecture.md）：
 * 1. 只回能力位，**不回 `baseUrl`**：上游地址属服务端配置，浏览器没有必要知道它；
 * 2. 通道未启用时仍回 200 + `configured: false`：这是「没开」，不是错误（与 503 的 `/api/sim/**` 语义分开）；
 * 3. 静态路由优先于 `server/api/sim/[...slug].ts`，本身不是白名单条目，也不会触达上游。
 */
export default defineEventHandler((event): ApiResponse<SimulatorChannelInfo> => {
	const config = getSimulatorConfig(event);

	setResponseStatus(event, 200);
	setResponseHeader(event, "content-type", "application/json; charset=utf-8");
	setResponseHeader(event, "cache-control", "no-store");

	return {
		code: 0,
		status: "success",
		message: "success",
		data: {
			configured: config.baseUrl.length > 0,
			writeEnabled: config.allowWrite,
			timeoutMs: config.timeoutMs,
			readinessPath: config.readinessPath
		},
		timestamp: new Date().toISOString()
	};
});
