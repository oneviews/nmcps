<template>
	<div v-if="page" class="flex">
		<!-- 左：文件结构树导航（全量内容导航；sticky 定格在 toolbar 之下） -->
		<aside class="hidden w-64 shrink-0 lg:block">
			<div class="sticky top-(--content-sticky-top) max-h-(--content-max-h) overflow-y-auto p-4">
				<UTree
					v-if="nav"
					:key="path"
					:items="tree"
					:get-key="getKey"
					:model-value="currentItem"
					trailing-icon="carbon:chevron-right"
					expanded-icon="carbon:folders"
					collapsed-icon="carbon:folder"
					:ui="{ listWithChildren: 'ms-2 border-s-0', linkTrailingIcon: 'group-data-expanded:rotate-90', linkLabel: 'min-w-0 truncate' }"
				/>
			</div>
		</aside>

		<!-- 中：Markdown 内容渲染 -->
		<div class="min-w-0 flex-1 p-4 sm:p-6">
			<ContentRenderer :value="page" />
		</div>

		<!-- 右：本页目录（滚动跟随高亮 + 点击滚动） -->
		<aside class="hidden w-64 shrink-0 xl:block">
			<UContentToc
				:links="toc"
				:title="$t('pages.content-document.onThisPage')"
				highlight
				:ui="{ root: 'mx-0 sm:mx-0 px-3 sm:px-3 top-(--content-sticky-top) max-h-(--content-max-h)', container: 'pt-4 pb-1 lg:pt-4 lg:pb-1', linkText: 'min-w-0 truncate' }"
				@move="scrollToHeading"
			>
				<template #bottom>
					<ContentDocumentMetadata :page="page" />
				</template>
			</UContentToc>
		</aside>
	</div>

	<div v-else-if="!pagePending" class="flex flex-col items-center gap-4 py-24">
		<UIcon name="carbon:document" class="size-16 text-(--ui-text-muted)" />
		<p class="text-lg font-medium">
			{{ $t("pages.content-document.notFound") }}
		</p>
		<UButton :to="`/content/${section}`" :label="$t('pages.content-document.backToList')" icon="carbon:arrow-left" />
	</div>
</template>

<script setup lang="ts">
	import type { ContentNavigationItem, TocLink } from "@nuxt/content";
	import type { BreadcrumbItem, TreeItem } from "@nuxt/ui";

	const props = defineProps<{ section: "architecture" | "records" | "documents" | "articles" }>();

	const route = useRoute();
	const { t } = useI18n();

	const collection = useContentCollection();

	const slug = computed(() => {
		const s = (route.params as { slug?: string | string[] }).slug;
		return Array.isArray(s) ? s.join("/") : (s ?? "");
	});
	const path = computed(() => `/${props.section}/${slug.value}`);

	const { data: page, pending: pagePending } = useAsyncData(`doc-${props.section}-${slug.value}`, () =>
		queryCollection(collection.value).where("path", "=", path.value).first(), { watch: [collection, slug] });

	// 面包屑：内容中心 > {分区} > 文档标题（标题来自 markdown frontmatter.title；末项无链接）
	const docBreadcrumb = computed<BreadcrumbItem[]>(() => [
		{ label: t("pages.content.title"), to: "/content" },
		{ label: t(`pages.content-${props.section}.title`), to: `/content/${props.section}` },
		...(page.value ? [{ label: page.value.title, icon: contentDocIcon(path.value, page.value.icon) }] : [])
	]);

	// 注入 route.meta.breadcrumb（AppHeader 面包屑消费；RouteMeta 已强类型扩展）
	watch(docBreadcrumb, (value) => {
		route.meta.breadcrumb = value;
	}, { immediate: true });

	// hash 导航（点击本页目录 UContentToc 内部 router.push('#id')）会重算 route.meta，
	// 运行时注入随之丢失；每次路由变化后重新注入，避免面包屑回退为系统导航（显示裸 key）。
	watch(() => route.fullPath, () => {
		route.meta.breadcrumb = docBreadcrumb.value;
	});

	// 左栏文件结构树：全量内容导航（「icon」加入导航查询字段，叶子节点携带 frontmatter.icon）
	const { data: nav } = useAsyncData("doc-nav", () =>
		queryCollectionNavigation(collection.value, ["icon"]), { watch: [collection] });

	type NavTreeItem = TreeItem & { id: string, to?: string };

	function toTreeItem(item: ContentNavigationItem): NavTreeItem {
		const children = item.children?.map(toTreeItem);
		const isDir = !!children?.length;
		return {
			id: item.path,
			label: item.title,
			...(isDir
				? { children, defaultExpanded: path.value.startsWith(`${item.path}/`) }
				: { to: `/content${item.path}`, icon: contentDocIcon(item.path, item.icon), onSelect: () => navigateTo(`/content${item.path}`) })
		};
	}

	const tree = computed<NavTreeItem[]>(() => (nav.value ?? []).map(toTreeItem));

	function getKey(item: NavTreeItem): string {
		return item.id;
	}

	const currentTo = computed(() => `/content${path.value}`);

	function findLeaf(items: NavTreeItem[], to: string): NavTreeItem | undefined {
		for (const item of items) {
			if (item.to === to)
				return item;
			if (item.children?.length) {
				const found = findLeaf(item.children as NavTreeItem[], to);
				if (found)
					return found;
			}
		}
		return undefined;
	}

	const currentItem = computed(() => findLeaf(tree.value, currentTo.value));

	// 右栏本页目录：来自正文 body.toc.links（id/text/depth/children）
	const toc = computed<TocLink[]>(() => {
		const body = page.value?.body as { toc?: { links?: TocLink[] } } | undefined;
		return body?.toc?.links ?? [];
	});

	// 点击目录项 → 手动滚动到对应标题（router.push(#id) 在嵌套滚动容器下不触发滚动）
	function scrollToHeading(id: string): void {
		nextTick(() => {
			document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
		});
	}
</script>
