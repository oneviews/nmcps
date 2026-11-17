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
	/** 访问令牌 cookie 名（`nmcps_at`；BFF 写入，`proxy.ts` 读取转 Bearer） */
	tokenCookieName: string
	/** 刷新令牌 cookie 名（`nmcps_rt`；仅 `Path=/api/auth` 下可见） */
	refreshCookieName: string
	/** 访问令牌兜底有效期（毫秒；正常以上游 `expiresIn` 为准） */
	accessTtlMs: number
	/** 刷新令牌有效期（毫秒；上游不返回刷新 TTL，只能配置兜底） */
	refreshTtlMs: number
	/** 签名会话 cookie 名（`nmcps_sess`；NMCPS-ADR-0021） */
	sessionCookieName: string
	/** 签名会话当前密钥（至少 32 字节；空串＝未配置，实验通道失败关闭） */
	sessionSecret: string
	/** 上一把签名密钥：只用于验证，不用于签发（轮换窗口） */
	sessionSecretPrevious: string
	/** 签名会话有效期（毫秒；默认沿用刷新令牌 TTL） */
	sessionTtlMs: number
	/** 上游就绪探针路径（拼在 `upstreamBase` 之后，以 `/` 开头） */
	readinessPath: string
	/** 上游就绪探针超时（毫秒，独立于业务超时，默认 2000） */
	readinessTimeoutMs: number
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

/**
 * 取 BFF 配置。
 *
 * `event` 可省略：WebSocket 升级阶段（crossws 的 `upgrade` 钩子）只有 `Request`，没有 H3Event，
 * 此时只能读进程级运行时配置（无请求级覆盖），与 HTTP 路径的取值一致。
 */
export function getBffConfig(event?: H3Event): BffConfig {
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

	const refreshCookieName = typeof bff.refreshCookieName === "string" && bff.refreshCookieName.trim()
		? bff.refreshCookieName.trim()
		: "nmcps_rt";

	const accessTtlCandidate = Number(bff.accessTtlMs);
	const accessTtlMs = Number.isFinite(accessTtlCandidate) && accessTtlCandidate >= 60_000
		? accessTtlCandidate
		: 1_800_000;

	const refreshTtlCandidate = Number(bff.refreshTtlMs);
	const refreshTtlMs = Number.isFinite(refreshTtlCandidate) && refreshTtlCandidate >= 60_000
		? refreshTtlCandidate
		: 7 * 24 * 60 * 60 * 1000;

	const sessionCookieName = typeof bff.sessionCookieName === "string" && bff.sessionCookieName.trim()
		? bff.sessionCookieName.trim()
		: "nmcps_sess";

	const sessionSecret = typeof bff.sessionSecret === "string" ? bff.sessionSecret.trim() : "";
	const sessionSecretPrevious = typeof bff.sessionSecretPrevious === "string"
		? bff.sessionSecretPrevious.trim()
		: "";

	const sessionTtlCandidate = Number(bff.sessionTtlMs);
	const sessionTtlMs = Number.isFinite(sessionTtlCandidate) && sessionTtlCandidate >= 60_000
		? sessionTtlCandidate
		: refreshTtlMs;

	const readinessPathRaw = typeof bff.readinessPath === "string" ? bff.readinessPath.trim() : "";
	const readinessPath = readinessPathRaw
		? (readinessPathRaw.startsWith("/") ? readinessPathRaw : `/${readinessPathRaw}`)
		: "/health";

	const readinessTimeoutCandidate = Number(bff.readinessTimeoutMs);
	const readinessTimeoutMs = Number.isFinite(readinessTimeoutCandidate) && readinessTimeoutCandidate >= 200
		? readinessTimeoutCandidate
		: 2000;

	return {
		upstreamBase,
		timeoutMs,
		allowedOrigins: origins.length ? origins : FALLBACK_ORIGINS,
		tokenCookieName,
		refreshCookieName,
		accessTtlMs,
		refreshTtlMs,
		sessionCookieName,
		sessionSecret,
		sessionSecretPrevious,
		sessionTtlMs,
		readinessPath,
		readinessTimeoutMs
	};
}

/** Origin 白名单判定；`*` 只应在本地联调时使用（与 credentials 并存时不安全） */
export function isOriginAllowed(origin: string, allowedOrigins: string[]): boolean {
	return allowedOrigins.includes("*") || allowedOrigins.includes(origin);
}
