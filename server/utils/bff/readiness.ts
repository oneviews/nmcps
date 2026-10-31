import type { H3Event } from "h3";
import type { UpstreamReason } from "~~/shared/constants/upstreamReasons";
import { UPSTREAM_REASONS } from "~~/shared/constants/upstreamReasons";
import { getBffConfig } from "./config";

/**
 * 就绪探针（k8s readiness）的上游探测，依据 NMCPS-ADR-0010
 * （layers/content/collections/cn/records/adr/adr-0010.md）。
 *
 * 与 `/health` 的分工：`/health` 只证明进程可服务（liveness），
 * `/ready` 额外要求上游在 `readinessTimeoutMs` 内回 2xx（readiness）。
 * 探针只读状态码、不消费 body，也不回显上游地址（避免内网拓扑泄露）。
 */
export type ReadinessReason = UpstreamReason;

export interface UpstreamReadiness {
	/** 是否配置了上游基址 */
	configured: boolean
	/** 上游探针返回的 HTTP 状态码（未触达时缺省） */
	status?: number
	/** 探针耗时（毫秒，未触达时缺省） */
	latencyMs?: number
	/** 未就绪原因（`ready` 时缺省） */
	reason?: ReadinessReason
}

export interface ReadinessReport {
	status: "ready" | "not_ready"
	service: "nmcps-bff"
	upstream: UpstreamReadiness
	uptime: number
	timestamp: number
}

function isAbortError(error: unknown): boolean {
	if (!error || typeof error !== "object" || !("name" in error))
		return false;
	const { name } = error as { name?: string };
	return name === "AbortError" || name === "TimeoutError";
}

function report(upstream: UpstreamReadiness): ReadinessReport {
	return {
		status: upstream.reason ? "not_ready" : "ready",
		service: "nmcps-bff",
		upstream,
		uptime: process.uptime(),
		timestamp: Date.now()
	};
}

/** 探测上游就绪状态：四种失败原因见 `ReadinessReason` */
export async function probeUpstreamReadiness(event: H3Event): Promise<ReadinessReport> {
	const { upstreamBase, readinessPath, readinessTimeoutMs } = getBffConfig(event);

	if (!upstreamBase) {
		return report({ configured: false, reason: UPSTREAM_REASONS.missing });
	}

	const url = `${upstreamBase}${readinessPath}`;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), readinessTimeoutMs);
	const startedAt = Date.now();

	try {
		const response = await fetch(url, {
			method: "GET",
			headers: { accept: "application/json" },
			signal: controller.signal,
			redirect: "manual"
		});
		const latencyMs = Date.now() - startedAt;

		try {
			// 探针只关心状态码：立即释放连接，不把上游响应体读进内存
			await response.body?.cancel();
		} catch {
			// 取消失败不影响判定（连接由 GC / 上游超时回收）
		}

		if (!response.ok) {
			return report({ configured: true, status: response.status, latencyMs, reason: UPSTREAM_REASONS.unhealthy });
		}

		return report({ configured: true, status: response.status, latencyMs });
	} catch (error) {
		if (import.meta.dev) {
			console.error("[bff] readiness probe failed", url, error);
		}

		return report({
			configured: true,
			latencyMs: Date.now() - startedAt,
			reason: isAbortError(error) ? UPSTREAM_REASONS.timeout : UPSTREAM_REASONS.unreachable
		});
	} finally {
		clearTimeout(timer);
	}
}
