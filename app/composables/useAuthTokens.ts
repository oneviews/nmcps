import type { AuthTokens } from "~~/shared/types/auth";
import { isTauri } from "@tauri-apps/api/core";

/**
 * 桌面端令牌仓（`tauri-plugin-store`）。
 *
 * Web 端令牌只存在于 HttpOnly cookie，前端**拿不到**也不需要 —— 该组合式在
 * 浏览器中返回空实现，避免误用。桌面端没有 cookie 语义（静态包跨源），
 * 登录/刷新响应体里的 `tokens` 由这里落盘，再由 `useApi` 注入 `Authorization`。
 * 裁决见 NMCPS-ADR-0011（layers/content/collections/cn/records/adr/adr-0011.md）。
 */

const STORE_FILE = "auth.bin";
const TOKENS_KEY = "tokens";

interface AuthStore {
	get: <T>(key: string) => Promise<T | undefined>
	set: (key: string, value: unknown) => Promise<void>
	delete: (key: string) => Promise<boolean>
	save: () => Promise<void>
}

/** 进程内缓存：令牌是高频读取的，避免每次请求都落盘读 */
let cached: AuthTokens | null = null;
let loaded = false;
let storePromise: Promise<AuthStore | null> | null = null;

async function getStore(): Promise<AuthStore | null> {
	if (!isTauri())
		return null;

	storePromise ??= (async () => {
		const store = await useTauriStoreLoad(STORE_FILE, { defaults: {}, autoSave: true });
		return store as unknown as AuthStore;
	})();

	return storePromise;
}

export function useAuthTokens() {
	const isDesktop = isTauri();

	async function read(): Promise<AuthTokens | null> {
		if (!isDesktop)
			return null;

		if (loaded)
			return cached;

		const store = await getStore();
		cached = (await store?.get<AuthTokens>(TOKENS_KEY)) ?? null;
		loaded = true;

		return cached;
	}

	async function write(tokens: AuthTokens): Promise<void> {
		cached = tokens;
		loaded = true;

		if (!isDesktop)
			return;

		const store = await getStore();
		await store?.set(TOKENS_KEY, tokens);
		await store?.save();
	}

	async function clear(): Promise<void> {
		cached = null;
		loaded = true;

		if (!isDesktop)
			return;

		const store = await getStore();
		await store?.delete(TOKENS_KEY);
		await store?.save();
	}

	/** 当前访问令牌（桌面端；web 恒为 `null`，凭据走 cookie） */
	async function accessToken(): Promise<string | null> {
		return (await read())?.accessToken ?? null;
	}

	return {
		isDesktop,
		accessToken,
		read,
		write,
		clear
	};
}
