<template>
	<div class="p-4 sm:p-6">
		<UPageHeader :title="t(`pages.content-${section}.title`)" :description="t(`pages.content-${section}.description`)" />

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

		<div v-if="!docsPending && !docs?.length" class="py-20 text-center text-(--ui-text-muted)">
			{{ t(`pages.content-${section}.empty`) }}
		</div>
	</div>
</template>

<script setup lang="ts">
	const props = defineProps<{ section: "architecture" | "records" | "documents" | "articles" }>();

	const { t } = useI18n();
	const collection = useContentCollection();

	const { data: docs, pending: docsPending } = useAsyncData(`section-list-${props.section}`, () =>
		queryCollection(collection.value)
			.where("path", "LIKE", `/${props.section}/%`)
			.where("path", "NOT LIKE", "%/.navigation")
			.select("path", "title", "description")
			.order("path", "ASC")
			.all(), { watch: [collection] });

	// 子目录标题：来自导航树（.navigation.md）
	const { data: nav } = useAsyncData("section-nav", () =>
		queryCollectionNavigation(collection.value), { watch: [collection] });

	// 按子目录分组（子目录名来自 .navigation.md；无子目录时整段归入分区自身）
	const groups = computed(() => {
		const list = docs.value ?? [];
		const root = nav.value?.find((n) => n.path === `/${props.section}`);
		const subTitles = new Map((root?.children ?? []).map((c) => [c.path, c.title]));
		const out: Array<{ key: string, label: string, items: typeof list }> = [];
		const seen = new Set<string>();
		for (const item of list) {
			const parts = item.path.split("/").filter(Boolean);
			const subPath = parts.length > 2 ? `/${parts.slice(0, 2).join("/")}` : `/${props.section}`;
			if (seen.has(subPath))
				continue;
			seen.add(subPath);
			out.push({
				key: subPath,
				label: subTitles.get(subPath) ?? t(`pages.content-${props.section}.title`),
				items: list.filter((i) => {
					const p = i.path.split("/").filter(Boolean);
					return (p.length > 2 ? `/${p.slice(0, 2).join("/")}` : `/${props.section}`) === subPath;
				})
			});
		}
		return out;
	});

	function detailPath(path: string): string {
		return `/content${path}`;
	}
</script>
