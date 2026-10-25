<template>
	<NuxtPage />
</template>

<script setup lang="ts">
	definePageMeta({ sort: 5, icon: "carbon:cloud-monitoring" });

	const route = useRoute();
	onMounted(() => {
		if (route.path === "/topology") {
			navigateTo("/topology/monitor", { replace: true });
		}
	});
</script>
