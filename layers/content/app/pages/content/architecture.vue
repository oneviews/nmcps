<template>
	<ContentSectionList v-if="isIndex" section="architecture" />
	<NuxtPage v-else />
</template>

<script setup lang="ts">
	definePageMeta({ sort: 1, icon: "carbon:catalog" });

	const route = useRoute();
	const isIndex = computed(() => route.path === "/content/architecture");
</script>
