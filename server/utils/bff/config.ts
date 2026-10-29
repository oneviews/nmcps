import type { H3Event } from "h3";
import { useRuntimeConfig } from "nitropack/runtime";

/** BFF 运行时配置（全部来自 `runtimeConfig.bff`，可用 `NUXT_BFF_*` 环境变量覆盖） */
export interface BffConfig {
	/** 上游基址（server-only，例：`http://192.168.1.81:8888/api/v1`） */
	upstreamBase: string
	/** 单次上游请求超时（毫秒） */
	timeoutMs: number
	/** 允许携带凭据跨域访问的 Origin 白名单（`*` 表示放行全部，仅限本地开发） */
	allowedOrigins: string[]
	/** 会话令牌 cookie 名（本阶段仅读取、不写入） */
	tokenCookieName: string
}

const FALLBACK_ORIGINS = [
	"http://localhost:3000",
	"http://127.0.0.1:3000",
	"tauri://localhost",
	"http://tauri.localhost",
	"https://tauri.localhost"
];

function stripTrailingSlash(value: string): string {
	return value.replace(/\/+$/, "");
}

function toOrigins(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.map((item) => String(item).trim()).filter(Boolean);
	}

	if (typeof value === "string") {
		return value.split(",").map((item) => item.trim()).filter(Boolean);
	}

	return [];
}

export function getBffConfig(event: H3Event): BffConfig {
	const runtime = useRuntimeConfig(event);
	const bff = (runtime.bff ?? {}) as Record<string, unknown>;

	const upstreamBase = typeof bff.upstreamBase === "string"
		? stripTrailingSlash(bff.upstreamBase.trim())
		: "";

	const timeoutCandidate = Number(bff.timeoutMs);
	const timeoutMs = Number.isFinite(timeoutCandidate) && timeoutCandidate >= 1000
		? timeoutCandidate
		: 15_000;

	const origins = toOrigins(bff.allowedOrigins);
	const tokenCookieName = typeof bff.tokenCookieName === "string" && bff.tokenCookieName.trim()
		? bff.tokenCookieName.trim()
		: "nmcps_at";

	return {
		upstreamBase,
		timeoutMs,
		allowedOrigins: origins.length ? origins : FALLBACK_ORIGINS,
		tokenCookieName
	};
}

/** Origin 白名单判定；`*` 只应在本地联调时使用（与 credentials 并存时不安全） */
export function isOriginAllowed(origin: string, allowedOrigins: string[]): boolean {
	return allowedOrigins.includes("*") || allowedOrigins.includes(origin);
}
