// layers/platform/app/composables/useExternalLink.ts
// 外链唯一出口：桌面 / 移动壳交给系统浏览器（`opener`），纯浏览器用新窗口。
// 设计基准：NMCPS-ARCH-005（layers/content/collections/cn/architecture/1.architecture/platform-architecture.md）§五
import { isTauri } from "@tauri-apps/api/core";

export function useExternalLink() {
	async function open(url: string): Promise<void> {
		if (isTauri()) {
			await useTauriOpenerOpenUrl(url);
			return;
		}

		window.open(url, "_blank", "noopener,noreferrer");
	}

	return { open };
}
