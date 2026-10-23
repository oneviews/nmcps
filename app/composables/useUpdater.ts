import { isTauri } from "@tauri-apps/api/core";

export const useUpdater = () => {
	const toast = useToast();
	const checking = ref(false);

	const checkForUpdates = async () => {
		if (!isTauri()) {
			toast.add({
				title: "仅桌面应用支持自动更新",
				color: "warning"
			});
			return;
		}

		checking.value = true;

		try {
			const update = await useTauriUpdaterCheck();

			if (update) {
				toast.add({
					title: "发现新版本",
					description: `版本 ${update.version} 可用，正在下载...`,
					color: "info"
				});

				await update.downloadAndInstall();
			} else {
				toast.add({
					title: "已是最新版本",
					color: "success"
				});
			}
		} catch (error) {
			toast.add({
				title: "检查更新失败",
				description: String(error),
				color: "error"
			});
		} finally {
			checking.value = false;
		}
	};

	return {
		checking,
		checkForUpdates
	};
};
