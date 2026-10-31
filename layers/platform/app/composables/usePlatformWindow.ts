// layers/platform/app/composables/usePlatformWindow.ts
// 多窗口探针（`core:webview:allow-create-webview-window`）：桌面可开独立窗口，
// 移动端需要系统级分屏（Activity Embedding / UIScene），统一按「不支持」处理。
// 设计基准：NMCPS-ARCH-005（layers/content/collections/cn/architecture/1.architecture/platform-architecture.md）§三
import { isTauri } from "@tauri-apps/api/core";

/** `unsupported` = 浏览器或移动端；`error` = 宿主创建失败（权限 / 窗口 id 冲突） */
export type PlatformWindowResult = "created" | "unsupported" | "error";

export function usePlatformWindow() {
	const isDesktop = isTauri();
	const platform = isDesktop ? useTauriOsPlatform() : null;
	const canOpenWindow = !!platform && !["android", "ios"].includes(platform);

	async function openWindow(id: string, url: string, title = "nmcps webview"): Promise<PlatformWindowResult> {
		if (!canOpenWindow)
			return "unsupported";

		return new Promise((resolve) => {
			const webview = new useTauriWebviewWindowWebviewWindow(id, {
				title,
				url,
				width: 1280,
				height: 720
			});

			webview.once("tauri://created", () => resolve("created"));
			webview.once("tauri://error", () => resolve("error"));
		});
	}

	return { canOpenWindow, openWindow };
}
