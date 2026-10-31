// layers/platform/app/composables/usePlatformInfo.ts
// 平台信息探针（`os` 插件）的唯一边界：页面不直接调用 `useTauriOs*`。
// 设计基准：NMCPS-ARCH-005（layers/content/collections/cn/architecture/1.architecture/platform-architecture.md）§五
import { isTauri } from "@tauri-apps/api/core";

export interface PlatformInfo {
	/** 是否运行在 Tauri 宿主（桌面 / 移动包） */
	isDesktop: boolean
	/** 系统名；浏览器下为 `null` */
	platform: string | null
	version: string | null
	arch: string | null
}

/** 同步读取系统信息（值在进程生命周期内不变，故不做响应式） */
export function usePlatformInfo(): PlatformInfo {
	const isDesktop = isTauri();

	return {
		isDesktop,
		platform: isDesktop ? useTauriOsPlatform() : null,
		version: isDesktop ? useTauriOsVersion() : null,
		arch: isDesktop ? useTauriOsArch() : null
	};
}

/** 系统区域（`os` 的 locale 是异步的）：浏览器下返回 `null` */
export async function usePlatformLocale(): Promise<string | null> {
	if (!isTauri())
		return null;

	return (await useTauriOsLocale()) || null;
}
