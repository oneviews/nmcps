import type { H3Event } from "h3";
import { useRuntimeConfig } from "nitropack/runtime";

/**
 * Mininet 实验后端（第三上游）运行时配置：全部来自 `runtimeConfig.mininet`，
 * 可用 `NUXT_MININET_*` 覆盖。
 *
 * 依据 NMCPS-ADR-0020（layers/content/collections/cn/records/adr/adr-0020.md）。
 * 与 `getSimulatorConfig()` 同形：缺省值集中一处、`baseUrl` 去尾斜杠。
 * 这里没有写开关：白名单本身只有 GET，写权限不靠布尔位“关着”，而是根本没有入口。
 */
export interface MininetConfig {
	/** 实验后端基址（server-only，例：`http://127.0.0.1:8000`）；空串＝通道未启用 */
	baseUrl: string
	/** 单次出站超时（毫秒） */
	timeoutMs: number
	/** 是否按租户查过实例；为 true 时空 baseUrl 表示该租户没有实例 */
	tenantScoped: boolean
}

interface MininetInstance {
	baseUrl: string
	timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 15_000;
const MIN_TIMEOUT_MS = 1000;

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
	return {
		baseUrl: stripTrailingSlash(baseUrl),
		...(Number.isFinite(timeout) && timeout >= MIN_TIMEOUT_MS ? { timeoutMs: timeout } : {})
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
 */
export function getMininetConfig(event: H3Event, tenantId?: string): MininetConfig {
	const runtime = useRuntimeConfig(event);
	const mininet = (runtime.mininet ?? {}) as Record<string, unknown>;

	const globalBaseUrl = typeof mininet.baseUrl === "string"
		? stripTrailingSlash(mininet.baseUrl.trim())
		: "";

	const timeoutCandidate = Number(mininet.timeoutMs);
	const globalTimeoutMs = Number.isFinite(timeoutCandidate) && timeoutCandidate >= MIN_TIMEOUT_MS
		? timeoutCandidate
		: DEFAULT_TIMEOUT_MS;

	if (tenantId !== undefined) {
		const instance = parseInstances(mininet.instances).get(tenantId);
		return {
			baseUrl: instance?.baseUrl ?? "",
			timeoutMs: instance?.timeoutMs ?? globalTimeoutMs,
			tenantScoped: true
		};
	}

	return { baseUrl: globalBaseUrl, timeoutMs: globalTimeoutMs, tenantScoped: false };
}
