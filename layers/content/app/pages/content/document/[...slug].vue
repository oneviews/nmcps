<template>
	<div v-if="page" class="flex">
		<!-- 左：文件结构树导航（UTree，边框占满纵向高度；sticky 定格在 toolbar 之下，偏移随模式由 --content-sticky-top 注入） -->
		<aside class="hidden w-64 shrink-0 border-r border-(--ui-border) lg:block">
			<div class="sticky top-(--content-sticky-top) max-h-(--content-max-h) overflow-y-auto p-4">
				<UTree
					:items="tree"
					:get-key="getKey"
					:model-value="currentItem"
					trailing-icon="carbon:chevron-right"
					:ui="{ listWithChildren: 'ms-2 border-s-0', linkTrailingIcon: 'group-data-expanded:rotate-90', linkLabel: 'min-w-0 truncate' }"
				/>
			</div>
		</aside>

		<!-- 中：Markdown 内容渲染 -->
		<div class="min-w-0 flex-1 p-4 sm:p-6">
			<UProse>
				<ContentRenderer :value="page" />
			</UProse>
		</div>

		<!-- 右：本页目录（滚动跟随高亮 + 点击滚动，边框占满纵向高度） -->
		<aside class="hidden w-64 shrink-0 border-l border-(--ui-border) xl:block">
			<UContentToc
				:links="toc"
				:title="$t('pages.content-document.onThisPage')"
				highlight
				:ui="{ root: 'mx-0 sm:mx-0 px-3 sm:px-3 top-(--content-sticky-top) max-h-(--content-max-h)', container: 'pt-1 pb-1 lg:py-1', linkText: 'min-w-0 truncate' }"
				@move="scrollToHeading"
			/>
		</aside>
	</div>

	<div v-else class="flex flex-col items-center gap-4 py-24">
		<UIcon name="carbon:document" class="size-16 text-(--ui-text-muted)" />
		<p class="text-lg font-medium">
			{{ $t("pages.content-document.notFound") }}
		</p>
		<UButton to="/content/document" :label="$t('pages.content-document.backToList')" icon="carbon:arrow-left" />
	</div>
</template>

<script setup lang="ts">
	import type { ContentNavigationItem, TocLink } from "@nuxt/content";
	import type { TreeItem } from "@nuxt/ui";

	const route = useRoute();

	const collection = useContentCollection();

	const slug = computed(() => {
		const s = route.params.slug;
		return Array.isArray(s) ? s.join("/") : (s ?? "");
	});
	const path = computed(() => `/${slug.value}`);

	const { data: page } = await useAsyncData(`document-${slug.value}`, () =>
		queryCollection(collection.value).where("path", "=", path.value).first(), { watch: [collection] });

	// 左栏文件结构树：全量内容导航（内容路径 → 路由路径 /content/document/...）
	const { data: nav } = await useAsyncData("document-nav", () =>
		queryCollectionNavigation(collection.value), { watch: [collection] });

	type NavTreeItem = TreeItem & { id: string, to?: string };

	function toTreeItem(item: ContentNavigationItem): NavTreeItem {
		const children = item.children?.map(toTreeItem);
		const isDir = !!children?.length;
		const to = `/content/document${item.path}`;
		return {
			id: item.path,
			label: item.title,
			...(isDir
				? { children, defaultExpanded: true }
				: { to, icon: "carbon:document", onSelect: () => navigateTo(to) })
		};
	}

	const tree = computed<NavTreeItem[]>(() => (nav.value ?? []).map(toTreeItem));

	function getKey(item: NavTreeItem): string {
		return item.id;
	}

	const currentTo = computed(() => `/content/document${path.value}`);

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
