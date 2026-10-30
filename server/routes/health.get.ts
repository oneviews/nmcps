import { defineEventHandler } from "h3";

/**
 * 存活探针（k8s liveness）：只反映 BFF 进程可服务，不依赖上游可达性。
 *
 * 上游就绪探针是 `GET /ready`（503 + 失败原因），见 NMCPS-ADR-0010
 * （layers/content/collections/cn/records/adr/adr-0010.md）。
 */
export default defineEventHandler(() => ({
	status: "ok",
	service: "nmcps-bff",
	uptime: process.uptime(),
	timestamp: Date.now()
}));
