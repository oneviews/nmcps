<template>
	<ContentSectionList v-if="isIndex" section="records" />
	<NuxtPage v-else />
</template>

<script setup lang="ts">
	definePageMeta({ sort: 2, icon: "carbon:decision-tree" });

	const route = useRoute();
	const isIndex = computed(() => route.path === "/content/records");
</script>
