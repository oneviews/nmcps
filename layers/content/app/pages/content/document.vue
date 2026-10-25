<template>
	<div v-if="isIndex" class="p-4 sm:p-6">
		<UPageHeader :title="$t('pages.content-document.title')" :description="$t('pages.content-document.description')" />

		<div v-for="group in groups" :key="group.key" class="mt-8 space-y-3">
			<h2 class="text-lg font-semibold">
				{{ group.label }}
			</h2>
			<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
				<NuxtLink v-for="item in group.items" :key="item.path" :to="detailPath(item.path)" class="block">
					<UCard class="h-full transition-colors hover:border-primary/50">
						<template #header>
							<h3 class="font-medium">
								{{ item.title }}
							</h3>
						</template>
						<p v-if="item.description" class="text-sm text-(--ui-text-muted)">
							{{ item.description }}
						</p>
					</UCard>
				</NuxtLink>
			</div>
		</div>

		<div v-if="!docs?.length" class="py-20 text-center text-(--ui-text-muted)">
			{{ $t("pages.content-document.empty") }}
		</div>
	</div>

	<NuxtPage v-else />
</template>

<script setup lang="ts">
	definePageMeta({ sort: 1, icon: "carbon:document" });

	const route = useRoute();
	const isIndex = computed(() => route.path === "/content/document");

	const { t } = useI18n();
	const collection = useContentCollection();

	const { data: docs } = await useAsyncData("document-list", () =>
		queryCollection(collection.value)
			.where("path", "NOT LIKE", "/articles/%")
			.where("path", "NOT LIKE", "/releases/%")
			.where("path", "NOT LIKE", "%/.navigation")
			.select("path", "title", "description")
			.order("path", "ASC")
			.all(), { watch: [collection] });

	const sectionLabels = computed<Record<string, string>>(() => ({
		architecture: t("pages.content-document.sectionArchitecture"),
		records: t("pages.content-document.sectionRecords"),
		documents: t("pages.content-document.sectionDocuments")
	}));

	const groups = computed(() => {
		const list = docs.value ?? [];
		const sections: Array<{ key: string, label: string, items: typeof list }> = [];
		const seen = new Set<string>();
		for (const item of list) {
			const section = item.path.split("/")[1] ?? "general";
			if (seen.has(section))
				continue;
			seen.add(section);
			sections.push({
				key: section,
				label: sectionLabels.value[section] ?? section,
				items: list.filter((i) => (i.path.split("/")[1] ?? "general") === section)
			});
		}
		return sections;
	});

	function detailPath(path: string): string {
		return `/content/document/${path.replace(/^\//, "")}`;
	}
</script>
