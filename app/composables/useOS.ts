export type OSName = "windows" | "macos" | "linux" | "android" | "ios" | "unknown";

/**
 * 按 User-Agent 判定当前操作系统。
 *
 * 顺序有讲究：iOS 必须早于 macOS（iPadOS 13+ 的桌面模式会伪装成 Macintosh），
 * Android 必须早于 Linux（Android UA 含 "Linux"）。
 */
function detectOS(ua: string): OSName {
	if (/iPhone|iPad|iPod/i.test(ua))
		return "ios";
	if (/Android/i.test(ua))
		return "android";
	if (/Windows/i.test(ua))
		return "windows";
	if (/Macintosh|Mac OS X/i.test(ua))
		return "macos";
	if (/Linux|X11/i.test(ua))
		return "linux";
	return "unknown";
}

/**
 * 浏览器平台探测，供下载页选择默认安装包。
 *
 * 应用为 SPA（`ssr: false`），`navigator` 在客户端始终可用；
 * 仍保留 `unknown` 兜底，避免非浏览器环境（预渲染、单测）直接抛错。
 */
export const useOS = () => {
	const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;

	return {
		os: detectOS(ua)
	};
};
