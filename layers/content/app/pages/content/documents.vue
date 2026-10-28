<template>
	<ContentSectionList v-if="isIndex" section="documents" />
	<NuxtPage v-else />
</template>

<script setup lang="ts">
	definePageMeta({ sort: 3, icon: "carbon:book" });

	const route = useRoute();
	const isIndex = computed(() => route.path === "/content/documents");
</script>
