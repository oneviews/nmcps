export type OSName = "windows" | "macos" | "linux" | "android" | "ios" | "unknown";

const OS_LABELS: Record<OSName, string> = {
	windows: "Windows",
	macos: "macOS",
	linux: "Linux",
	android: "Android",
	ios: "iOS",
	unknown: "未知系统"
};

/**
 * 根据浏览器 User-Agent 判断当前操作系统。
 * 项目为 SPA（ssr: false），navigator 在客户端始终可用。
 */
export const useOS = () => {
	const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";

	let os: OSName = "unknown";

	if (/iPhone|iPad|iPod/i.test(ua)) os = "ios";
	else if (/Android/i.test(ua)) os = "android";
	else if (/Windows/i.test(ua)) os = "windows";
	else if (/Macintosh|Mac OS X/i.test(ua)) os = "macos";
	else if (/Linux/i.test(ua)) os = "linux";

	return {
		os,
		label: OS_LABELS[os]
	};
};
