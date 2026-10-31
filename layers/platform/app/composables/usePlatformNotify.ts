// layers/platform/app/composables/usePlatformNotify.ts
// 原生通知探针（`notification` 插件）：权限链 `isPermissionGranted → requestPermission → send`。
// 设计基准：NMCPS-ARCH-005（layers/content/collections/cn/architecture/1.architecture/platform-architecture.md）§三
import { isTauri } from "@tauri-apps/api/core";

/** `unavailable` = 浏览器；`denied` = 用户拒绝或系统未授予 */
export type PlatformNotifyResult = "sent" | "denied" | "unavailable";

export function usePlatformNotify() {
	const isDesktop = isTauri();

	async function notify(title: string, body?: string): Promise<PlatformNotifyResult> {
		if (!isDesktop)
			return "unavailable";

		let granted = await useTauriNotificationIsPermissionGranted();

		if (!granted)
			granted = (await useTauriNotificationRequestPermission()) === "granted";

		if (!granted)
			return "denied";

		useTauriNotificationSendNotification({ title, body });

		return "sent";
	}

	return { isDesktop, notify };
}
