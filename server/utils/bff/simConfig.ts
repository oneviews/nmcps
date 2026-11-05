import type { H3Event } from "h3";
import { useRuntimeConfig } from "nitropack/runtime";

/**
 * 仿真平台（第二上游）运行时配置：全部来自 `runtimeConfig.simulator`，可用 `NUXT_SIMULATOR_*` 覆盖。
 *
 * 依据 NMCPS-ARCH-002 §6.1（layers/content/collections/cn/architecture/1.architecture/datasource-architecture.md）。
 * 与 `getBffConfig()` 同形：缺省值集中一处、`baseUrl` 去尾斜杠、`allowWrite` 严格布尔。
 */
export interface SimulatorConfig {
	/** 仿真平台基址（server-only，例：`http://192.168.1.55:8001`）；空串＝通道未启用，不是错误 */
	baseUrl: string
	/** 写开关：默认 `false`（写端点一律 405，不触达上游） */
	allowWrite: boolean
	/** 单次出站超时（毫秒） */
	timeoutMs: number
	/** 就绪探针路径（拼在 `baseUrl` 之后，以 `/` 开头；仅供页面/运维排查，不影响 `/ready`） */
	readinessPath: string
}

const DEFAULT_TIMEOUT_MS = 15_000;
const MIN_TIMEOUT_MS = 1000;

function stripTrailingSlash(value: string): string {
	return value.replace(/\/+$/, "");
}

/**
 * 环境变量覆盖到布尔位时拿到的是字符串（`NUXT_SIMULATOR_ALLOW_WRITE`），
 * 只有明确的真值才算开启 —— `"false"` / `"0"` / 空串 / 未配一律视为关闭（默认安全）。
 */
function toBoolean(value: unknown): boolean {
	if (typeof value === "boolean") {
		return value;
	}

	if (typeof value === "number") {
		return value === 1;
	}

	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
	}

	return false;
}

export function getSimulatorConfig(event: H3Event): SimulatorConfig {
	const runtime = useRuntimeConfig(event);
	const simulator = (runtime.simulator ?? {}) as Record<string, unknown>;

	const baseUrl = typeof simulator.baseUrl === "string"
		? stripTrailingSlash(simulator.baseUrl.trim())
		: "";

	const timeoutCandidate = Number(simulator.timeoutMs);
	const timeoutMs = Number.isFinite(timeoutCandidate) && timeoutCandidate >= MIN_TIMEOUT_MS
		? timeoutCandidate
		: DEFAULT_TIMEOUT_MS;

	const readinessRaw = typeof simulator.readinessPath === "string" ? simulator.readinessPath.trim() : "";
	const readinessPath = readinessRaw
		? (readinessRaw.startsWith("/") ? readinessRaw : `/${readinessRaw}`)
		: "/api/health";

	return {
		baseUrl,
		allowWrite: toBoolean(simulator.allowWrite),
		timeoutMs,
		readinessPath
	};
}
