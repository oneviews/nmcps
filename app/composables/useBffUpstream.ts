// app/composables/useBffUpstream.ts
// BFF 上游可用性探针：登录页等入口在挂载时判断「上游是否配置」，
// 避免用户填完表单才收到 503 `bff_upstream_missing`（NMCPS-ARCH-003 §7.7）。
import type { Ref } from "vue";
import { isTauri } from "@tauri-apps/api/core";

/** sessionStorage 键：同一会话内多个入口共享探测结论 */
const PROBE_CACHE_KEY = "bff.upstreamProbe";
/** 「已配置」结论较稳定，缓存 30s */
const CONFIGURED_TTL_MS = 30_000;
/** 「未配置」是待修状态：TTL 短，配好 `.env` 重启 BFF 后能尽快自愈 */
const MISSING_TTL_MS = 5_000;

interface UpstreamProbeCache {
	configured: boolean
	at: number
}

export interface BffUpstreamState {
	/** 上游确定未配置；探针失败（网络中断 / 桌面端无同源 Nitro）时保持 false，不误报 */
	upstreamMissing: Ref<boolean>
	/** 探测进行中（「重新检测」按钮 loading） */
	probing: Ref<boolean>
	/** 按缓存探测（挂载时调用，避免反复进出页面重复打 BFF） */
	probe: () => Promise<void>
	/** 忽略缓存立即重探（用户点「重新检测」后调用） */
	recheck: () => Promise<void>
}

function readCache(): UpstreamProbeCache | undefined {
	try {
		const raw = sessionStorage.getItem(PROBE_CACHE_KEY);
		if (!raw)
			return undefined;

		const cached = JSON.parse(raw) as UpstreamProbeCache;
		if (typeof cached?.configured !== "boolean" || typeof cached.at !== "number")
			return undefined;

		const ttl = cached.configured ? CONFIGURED_TTL_MS : MISSING_TTL_MS;
		return Date.now() - cached.at < ttl ? cached : undefined;
	} catch {
		// 隐私模式 / 存储被禁用：当作无缓存，退化成每次探测
		return undefined;
	}
}

function writeCache(configured: boolean): void {
	try {
		sessionStorage.setItem(PROBE_CACHE_KEY, JSON.stringify({ configured, at: Date.now() } satisfies UpstreamProbeCache));
	} catch {
		// 写不进去不影响本次判定
	}
}

function clearCache(): void {
	try {
		sessionStorage.removeItem(PROBE_CACHE_KEY);
	} catch {
		// 同上：清不掉只是多打一次探针
	}
}

/**
 * 读取 `/ready` 的判定：无上游时 BFF 返回 503 + `upstream.configured:false`。
 * 只信 BFF 明确给出的布尔值，其余异常留给登录动作报错（不猜）。
 */
async function fetchUpstreamConfigured(baseURL: string): Promise<boolean | undefined> {
	try {
		// `503` 在 ofetch 默认重试列表内，探针必须关掉重试，否则无上游时一次进页打两次
		await $fetch("/ready", { baseURL, credentials: "include", retry: false });
		return true;
	} catch (error) {
		const configured = (error as { data?: { upstream?: { configured?: boolean } } }).data?.upstream?.configured;
		return typeof configured === "boolean" ? configured : undefined;
	}
}

export function useBffUpstream(): BffUpstreamState {
	const { bffBase } = useApi();
	const upstreamMissing = ref(false);
	const probing = ref(false);

	async function run(force: boolean): Promise<void> {
		// 桌面静态包没有同源 Nitro：探针无从发起，交给登录动作报错
		if (isTauri())
			return;

		if (!force) {
			const cached = readCache();
			if (cached) {
				upstreamMissing.value = !cached.configured;
				return;
			}
		}

		probing.value = true;
		try {
			const configured = await fetchUpstreamConfigured(bffBase);
			if (configured === undefined)
				return;

			upstreamMissing.value = !configured;
			writeCache(configured);
		} finally {
			probing.value = false;
		}
	}

	return {
		upstreamMissing,
		probing,
		probe: () => run(false),
		recheck: async () => {
			clearCache();
			await run(true);
		}
	};
}
