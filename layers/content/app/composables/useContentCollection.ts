// layers/content/app/composables/useContentCollection.ts
// 内容中心集合选择：按当前 locale 返回 cn/en 集合名（双语镜像）。
// cn 为权威语言，en 为镜像（docId 一致、路径对齐）。

/** 当前语言对应的内容集合名（"content_cn" / "content_en"） */
export function useContentCollection() {
	const { locale } = useI18n();
	return computed(() => (locale.value === "en" ? "content_en" : "content_cn"));
}
