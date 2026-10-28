<template>
	<ContentSectionList v-if="isIndex" section="articles" />
	<NuxtPage v-else />
</template>

<script setup lang="ts">
	definePageMeta({ sort: 4, icon: "carbon:blog" });

	const route = useRoute();
	const isIndex = computed(() => route.path === "/content/articles");
</script>
