import { defineEventHandler } from "h3";

/**
 * 存活探针（k8s liveness）：只反映 BFF 进程可服务，不依赖上游可达性。
 *
 * 上游就绪探针（readiness）需先确定后端健康端点，见 NMCPS-ADR-0007「遗留」。
 */
export default defineEventHandler(() => ({
	status: "ok",
	service: "nmcps-bff",
	uptime: process.uptime(),
	timestamp: Date.now()
}));
