import type { H3Event } from "h3";
import { useRuntimeConfig } from "nitropack/runtime";

/**
 * Mininet 实验后端（第三上游）运行时配置：全部来自 `runtimeConfig.mininet`，
 * 可用 `NUXT_MININET_*` 覆盖。
 *
 * 依据 NMCPS-ADR-0020（layers/content/collections/cn/records/adr/adr-0020.md）。
 * 缺省值集中一处、`baseUrl` 去尾斜杠；租户注册表未命中即失败关闭。
 * 这里没有写开关：写能力由白名单每条的权限位决定，不由布尔位“关着”。
 */
export interface MininetConfig {
	/** 实验后端基址（server-only，例：`http://127.0.0.1:8000`）；空串＝通道未启用 */
	baseUrl: string
	/**
	 * 入口凭据（`NUXT_MININET_TOKEN` ↔ 后端 `LAB_API_TOKEN`），空串＝只走回环信任。
	 * 出站只以 `x-lab-token` 头带它；WebSocket 用它算签名，绝不出现在查询串里。
	 */
	token: string
	/** 单次出站超时（毫秒） */
	timeoutMs: number
	/** 长时端点（`pingall` / `start` / `stop` …）的出站超时（毫秒），见 `NMCPS-ADR-0026` D1 */
	longTimeoutMs: number
	/** 是否按租户查过实例；为 true 时空 baseUrl 表示该租户没有实例 */
	tenantScoped: boolean
}

interface MininetInstance {
	baseUrl: string
	token?: string
	timeoutMs?: number
	longTimeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 15_000;
const MIN_TIMEOUT_MS = 1000;
/** 一次 `pingall` 在 9 节点网络上实测 42.6 秒（`NMCPS-ADR-0026` §1），180 秒留足余量 */
const DEFAULT_LONG_TIMEOUT_MS = 180_000;
/**
 * 长时预算的下界与读预算同值（`NMCPS-ADR-0026` D1）：真正要保证的不变量是
 * `longTimeoutMs >= timeoutMs`，那由 `Math.max()` 兜住；这里再卡一个下界只会让自检
 * 无法用「短预算 1.2 秒 / 长预算 3 秒」验证分档（卡到 30 秒等于每条用例多等半分钟）。
 */
const MIN_LONG_TIMEOUT_MS = 1000;

function stripTrailingSlash(value: string): string {
	return value.replace(/\/+$/, "");
}

function toStringOrNull(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseInstance(value: unknown): MininetInstance | undefined {
	if (typeof value === "string") {
		const baseUrl = stripTrailingSlash(value.trim());
		return baseUrl ? { baseUrl } : undefined;
	}

	const record = value && typeof value === "object" ? value as Record<string, unknown> : undefined;
	if (!record) {
		return undefined;
	}

	const baseUrl = toStringOrNull(record.baseUrl);
	if (!baseUrl) {
		return undefined;
	}

	const timeout = Number(record.timeoutMs);
	const longTimeout = Number(record.longTimeoutMs);
	const token = toStringOrNull(record.token);
	return {
		baseUrl: stripTrailingSlash(baseUrl),
		...(token ? { token } : {}),
		...(Number.isFinite(timeout) && timeout >= MIN_TIMEOUT_MS ? { timeoutMs: timeout } : {}),
		...(Number.isFinite(longTimeout) && longTimeout >= MIN_LONG_TIMEOUT_MS ? { longTimeoutMs: longTimeout } : {})
	};
}

/**
 * 解析租户 → 实例注册表（`NUXT_MININET_INSTANCES`）。
 *
 * 接受 JSON 字符串（环境变量）或对象（部署层注入）：
 * `{"t_a":{"baseUrl":"http://127.0.0.1:8000","timeoutMs":15000}}`
 *
 * 解析失败一律返回空表 —— 配置坏了就必须失败关闭，不能掉回全局实例。
 */
function parseInstances(value: unknown): Map<string, MininetInstance> {
	const instances = new Map<string, MininetInstance>();
	let source: unknown = value;

	if (typeof value === "string") {
		if (!value.trim()) {
			return instances;
		}
		try {
			source = JSON.parse(value);
		} catch {
			return instances;
		}
	}

	const record = source && typeof source === "object" ? source as Record<string, unknown> : undefined;
	if (!record) {
		return instances;
	}

	for (const [tenantId, raw] of Object.entries(record)) {
		const instance = parseInstance(raw);
		if (tenantId.trim() && instance) {
			instances.set(tenantId.trim(), instance);
		}
	}

	return instances;
}

/**
 * 取当前请求应使用的 Mininet 实例。
 *
 * - 传 `tenantId`：只查租户注册表，未命中即返回空 baseUrl（绝不回退全局实例）；
 * - 不传：兼容只读能力探针等无租户场景，返回全局 `baseUrl`。
 *
 * `event` 允许为 `undefined`：`/mininet-ws/*` 的升级钩子只有 `Request`，拿不到 H3Event，
 * 这时读进程级运行时配置（`NUXT_MININET_*` 注入的就是它）。
 */
export function getMininetConfig(event: H3Event | undefined, tenantId?: string): MininetConfig {
	const runtime = useRuntimeConfig(event);
	const mininet = (runtime.mininet ?? {}) as Record<string, unknown>;

	const globalBaseUrl = typeof mininet.baseUrl === "string"
		? stripTrailingSlash(mininet.baseUrl.trim())
		: "";

	// 入口凭据：全局一份，租户实例可覆盖（同一台后端时一般只有全局）。
	const globalToken = typeof mininet.token === "string" ? mininet.token.trim() : "";

	const timeoutCandidate = Number(mininet.timeoutMs);
	const globalTimeoutMs = Number.isFinite(timeoutCandidate) && timeoutCandidate >= MIN_TIMEOUT_MS
		? timeoutCandidate
		: DEFAULT_TIMEOUT_MS;

	// 长时预算独立解析：它可以比读超时小只会让「长操作」退回读预算，那是配置错误而不是
	// 保守取值，所以下界单列一个 `MIN_LONG_TIMEOUT_MS`（`NMCPS-ADR-0026` D1）。
	const longCandidate = Number(mininet.longTimeoutMs);
	const globalLongTimeoutMs = Number.isFinite(longCandidate) && longCandidate >= MIN_LONG_TIMEOUT_MS
		? longCandidate
		: DEFAULT_LONG_TIMEOUT_MS;

	if (tenantId !== undefined) {
		const instance = parseInstances(mininet.instances).get(tenantId);
		return {
			baseUrl: instance?.baseUrl ?? "",
			token: instance?.token ?? globalToken,
			timeoutMs: instance?.timeoutMs ?? globalTimeoutMs,
			longTimeoutMs: Math.max(instance?.longTimeoutMs ?? globalLongTimeoutMs, globalTimeoutMs),
			tenantScoped: true
		};
	}

	return {
		baseUrl: globalBaseUrl,
		token: globalToken,
		timeoutMs: globalTimeoutMs,
		longTimeoutMs: Math.max(globalLongTimeoutMs, globalTimeoutMs),
		tenantScoped: false
	};
}
