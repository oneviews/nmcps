import type { Update } from "@tauri-apps/plugin-updater";
import { isTauri } from "@tauri-apps/api/core";

export const useUpdater = () => {
	const toast = useToast();
	const { t } = useI18n();
	const checking = ref(false);

	/** 下载并安装指定更新（安装完成后由 updater 插件负责重启应用） */
	const installUpdate = async (update: Update): Promise<void> => {
		toast.add({
			title: t("updater.found"),
			description: t("updater.downloading", { version: update.version }),
			color: "info"
		});

		await update.downloadAndInstall();
	};

	const checkForUpdates = async () => {
		if (!isTauri()) {
			toast.add({
				title: t("updater.desktopOnly"),
				color: "warning"
			});
			return;
		}

		checking.value = true;

		try {
			const update = await useTauriUpdaterCheck();

			if (update) {
				await installUpdate(update);
			} else {
				toast.add({
					title: t("updater.upToDate"),
					color: "success"
				});
			}
		} catch (error) {
			toast.add({
				title: t("updater.failed"),
				description: String(error),
				color: "error"
			});
		} finally {
			checking.value = false;
		}
	};

	/**
	 * 启动静默检查：仅桌面端执行；无新版本或检查失败都不打扰用户。
	 * 发现新版本时提示一次（常驻），由用户点击「立即更新」再下载安装 —— 不静默自动下载。
	 */
	const silentCheckForUpdates = async (): Promise<void> => {
		if (!isTauri()) {
			return;
		}

		try {
			const update = await useTauriUpdaterCheck();

			if (!update) {
				return;
			}

			toast.add({
				title: t("updater.available.title", { version: update.version }),
				description: t("updater.available.description"),
				icon: "carbon:renew",
				color: "info",
				duration: 0,
				actions: [{ label: t("updater.available.action"), onClick: () => void installUpdate(update) }]
			});
		} catch {
			// 冷启动阶段网络/代理异常属常态，静默忽略：用户仍可手动「检查更新」看到明确错误
		}
	};

	return {
		checking,
		checkForUpdates,
		silentCheckForUpdates
	};
};
