<template>
	<div v-if="isIndex" class="p-4 sm:p-6">
		<UPageHeader :title="$t('pages.content-release.title')" :description="$t('pages.content-release.description')" />

		<div v-if="releases?.length" class="mt-8 space-y-4">
			<NuxtLink v-for="item in releases" :key="item.path" :to="detailPath(item.path)" class="block">
				<UCard class="transition-colors hover:border-primary/50">
					<template #header>
						<div class="flex items-center justify-between gap-4">
							<h3 class="font-medium">
								{{ item.title }}
							</h3>
							<span v-if="item.updatedAt" class="shrink-0 text-sm text-(--ui-text-muted)">
								{{ item.updatedAt }}
							</span>
						</div>
					</template>
					<p v-if="item.excerpt || item.description" class="text-sm text-(--ui-text-muted)">
						{{ item.excerpt ?? item.description }}
					</p>
				</UCard>
			</NuxtLink>
		</div>

		<div v-else class="py-20 text-center text-(--ui-text-muted)">
			{{ $t("pages.content-release.empty") }}
		</div>
	</div>

	<NuxtPage v-else />
</template>

<script setup lang="ts">
	definePageMeta({ sort: 3, icon: "carbon:launch" });

	const route = useRoute();
	const isIndex = computed(() => route.path === "/content/release");

	const collection = useContentCollection();

	const { data: releases } = await useAsyncData("release-list", () =>
		queryCollection(collection.value)
			.where("path", "LIKE", "/releases/%")
			.where("path", "NOT LIKE", "%/.navigation")
			.select("path", "title", "description", "excerpt", "updatedAt")
			.order("path", "DESC")
			.all(), { watch: [collection] });

	function detailPath(path: string): string {
		return `/content/release/${path.replace(/^\/releases\//, "")}`;
	}
</script>
