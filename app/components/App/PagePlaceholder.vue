<template>
	<div class="flex h-full min-h-64 items-center justify-center p-8">
		<div class="flex flex-col items-center gap-3 text-center">
			<UIcon :name="icon" class="size-12 text-(--ui-text-muted)" />
			<h1 class="text-2xl font-bold">
				{{ title }}
			</h1>
			<UBadge variant="subtle" color="neutral">
				{{ $t("common.underConstruction") }}
			</UBadge>
		</div>
	</div>
</template>

<script setup lang="ts">
	const route = useRoute();
	const { t } = useI18n();

	const name = computed(() => String(route.name ?? "error"));
	const title = computed(() => t(`pages.${name.value}.title`));
	const icon = computed(() => route.meta.icon ?? "carbon:folder");
</script>
