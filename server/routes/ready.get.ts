import type { ReadinessReport } from "~~/server/utils/bff/readiness";
import { defineEventHandler, setResponseHeader, setResponseStatus } from "h3";
import { probeUpstreamReadiness } from "~~/server/utils/bff/readiness";

/**
 * 就绪探针（k8s readiness）：在 `/health` 之上叠加对上游的短超时探测。
 *
 * - 上游可达且回 2xx → 200 `ready`；
 * - 上游未配置 / 不可达 / 超时 / 非 2xx → 503 `not_ready`（附 `upstream.reason`）；
 * - 响应体不含上游地址，探针结果禁止缓存。
 *
 * 判定规则与边界见 NMCPS-ADR-0010（layers/content/collections/cn/records/adr/adr-0010.md）。
 */
export default defineEventHandler(async (event): Promise<ReadinessReport> => {
	const report = await probeUpstreamReadiness(event);

	setResponseStatus(event, report.status === "ready" ? 200 : 503);
	setResponseHeader(event, "content-type", "application/json; charset=utf-8");
	setResponseHeader(event, "cache-control", "no-store");

	return report;
});
