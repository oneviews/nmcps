// layers/content/app/utils/contentIcons.ts
// 内容中心各分区默认图标：新建文档（含博客）须按分区分配 icon（frontmatter.icon）。
// 缺省时回退到本表的默认值，保证面包屑 / 文件树的 icon 永不为空。

/** 内容分区 → 默认图标（frontmatter 缺 icon 时的兜底） */
export const CONTENT_SECTION_ICONS: Record<string, string> = {
	architecture: "carbon:catalog",
	records: "carbon:decision-tree",
	documents: "carbon:book",
	releases: "carbon:launch",
	articles: "carbon:blog"
};

/** 未知分区的通用兜底图标 */
const DEFAULT_DOC_ICON = "carbon:document";

/**
 * 解析文档图标：优先 frontmatter.icon，缺省回退到分区默认图标。
 * @param path 内容路径（如 /architecture/…、/documents/…、/articles/…）
 * @param icon frontmatter.icon（可能为空 / 非字符串）
 */
export function contentDocIcon(path: string, icon?: unknown): string {
	if (typeof icon === "string" && icon !== "")
		return icon;
	const section = path.replace(/^\//, "").split("/")[0] ?? "";
	return CONTENT_SECTION_ICONS[section] ?? DEFAULT_DOC_ICON;
}
