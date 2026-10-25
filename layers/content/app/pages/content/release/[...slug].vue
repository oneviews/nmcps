<template>
	<div v-if="page" class="flex">
		<!-- 中：Markdown 内容渲染 -->
		<div class="min-w-0 flex-1 p-4 sm:p-6">
			<UProse>
				<ContentRenderer :value="page" />
			</UProse>
		</div>

		<!-- 右：本页目录（滚动跟随高亮 + 点击滚动） -->
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
		<UIcon name="carbon:launch" class="size-16 text-(--ui-text-muted)" />
		<p class="text-lg font-medium">
			{{ $t("pages.content-document.notFound") }}
		</p>
		<UButton to="/content/release" :label="$t('pages.content-document.backToList')" icon="carbon:arrow-left" />
	</div>
</template>

<script setup lang="ts">
	import type { TocLink } from "@nuxt/content";

	const route = useRoute();
	const collection = useContentCollection();

	const slug = computed(() => {
		const s = route.params.slug;
		return Array.isArray(s) ? s.join("/") : (s ?? "");
	});
	const path = computed(() => `/releases/${slug.value}`);

	const { data: page } = await useAsyncData(`release-${slug.value}`, () =>
		queryCollection(collection.value).where("path", "=", path.value).first(), { watch: [collection] });

	// 右栏本页目录：来自正文 body.toc.links（id/text/depth/children）
	const toc = computed<TocLink[]>(() => {
		const body = page.value?.body as { toc?: { links?: TocLink[] } } | undefined;
		return body?.toc?.links ?? [];
	});

	function scrollToHeading(id: string): void {
		nextTick(() => {
			document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
		});
	}
</script>
