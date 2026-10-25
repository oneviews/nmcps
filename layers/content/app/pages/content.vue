<template>
	<NuxtPage />
</template>

<script setup lang="ts">
	definePageMeta({ sort: 8, icon: "carbon:document" });

	const route = useRoute();
	onMounted(() => {
		if (route.path === "/content") {
			navigateTo("/content/document", { replace: true });
		}
	});
</script>
