// layers/platform/app/composables/usePlatformStore.ts
// 探针专用键值仓（`store` 插件）。
// 设计基准：NMCPS-ARCH-005（layers/content/collections/cn/architecture/1.architecture/platform-architecture.md）§五
import type { Store } from "@tauri-apps/plugin-store";
import { isTauri } from "@tauri-apps/api/core";

/**
 * 独立文件名：与 `useAuthTokens` 的 `auth.bin` 隔离。
 * 两个 `autoSave: true` 的 Store 指向同一文件会互相覆盖写入。
 */
export const PLATFORM_PROBE_STORE = "platform-probe.bin";

let cached: Promise<Store> | null = null;

export function usePlatformStore() {
	const isDesktop = isTauri();

	/** 浏览器下返回 `null`；`autoSave` 与生产用法（`useAuthTokens`）保持一致 */
	async function store(): Promise<Store | null> {
		if (!isDesktop)
			return null;

		cached ??= useTauriStoreLoad(PLATFORM_PROBE_STORE, { defaults: {}, autoSave: true });

		return cached;
	}

	return { isDesktop, store };
}
