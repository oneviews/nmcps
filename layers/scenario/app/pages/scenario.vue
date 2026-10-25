<template>
	<NuxtPage />
</template>

<script setup lang="ts">
	definePageMeta({ sort: 2, icon: "carbon:map" });

	const route = useRoute();
	onMounted(() => {
		if (route.path === "/scenario") {
			navigateTo("/scenario/task-planning", { replace: true });
		}
	});
</script>
