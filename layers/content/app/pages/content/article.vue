<template>
	<div v-if="isIndex" class="p-4 sm:p-6">
		<UPageHeader :title="$t('pages.content-article.title')" :description="$t('pages.content-article.description')" />

		<div v-if="articles?.length" class="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
			<NuxtLink v-for="item in articles" :key="item.path" :to="detailPath(item.path)" class="block">
				<UCard class="h-full transition-colors hover:border-primary/50">
					<template #header>
						<h3 class="font-medium">
							{{ item.title }}
						</h3>
					</template>
					<p v-if="item.excerpt || item.description" class="text-sm text-(--ui-text-muted)">
						{{ item.excerpt ?? item.description }}
					</p>
				</UCard>
			</NuxtLink>
		</div>

		<div v-else class="py-20 text-center text-(--ui-text-muted)">
			{{ $t("pages.content-article.empty") }}
		</div>
	</div>

	<NuxtPage v-else />
</template>

<script setup lang="ts">
	definePageMeta({ sort: 2, icon: "carbon:document" });

	const route = useRoute();
	const isIndex = computed(() => route.path === "/content/article");

	const collection = useContentCollection();

	const { data: articles } = await useAsyncData("article-list", () =>
		queryCollection(collection.value)
			.where("path", "LIKE", "/articles/%")
			.where("path", "NOT LIKE", "%/.navigation")
			.select("path", "title", "description", "excerpt")
			.order("path", "ASC")
			.all(), { watch: [collection] });

	function detailPath(path: string): string {
		return `/content/article/${path.replace(/^\/articles\//, "")}`;
	}
</script>
