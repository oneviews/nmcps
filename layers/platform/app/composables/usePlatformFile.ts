// layers/platform/app/composables/usePlatformFile.ts
// 文件写入探针（`fs` 插件）。
// 设计基准：NMCPS-ARCH-005（layers/content/collections/cn/architecture/1.architecture/platform-architecture.md）§三
import { isTauri } from "@tauri-apps/api/core";

/** 文件写入结果：`unavailable` = 浏览器，`exists` = 同名文件已存在 */
export type PlatformFileResult = "created" | "exists" | "unavailable";

/** `Document` 的实际落点：桌面是用户文档目录，移动端是应用私有目录 */
export type PlatformFileScope = "desktop-documents" | "app-private" | "browser";

export function usePlatformFile() {
	const isDesktop = isTauri();

	const scope: PlatformFileScope = !isDesktop
		? "browser"
		: ["android", "ios"].includes(useTauriOsPlatform())
			? "app-private"
			: "desktop-documents";

	async function createTextFile(fileName: string, content: string): Promise<PlatformFileResult> {
		if (!isDesktop)
			return "unavailable";

		const options = { baseDir: useTauriFsBaseDirectory.Document };

		if (await useTauriFsExists(fileName, options))
			return "exists";

		await useTauriFsWriteTextFile(fileName, content, options);

		return "created";
	}

	return { isDesktop, scope, createTextFile };
}
