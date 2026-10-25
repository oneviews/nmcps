<template>
	<NuxtPage />
</template>

<script setup lang="ts">
	definePageMeta({ sort: 1, icon: "carbon:dashboard" });

	const route = useRoute();
	onMounted(() => {
		if (route.path === "/dashboard") {
			navigateTo("/dashboard/overview", { replace: true });
		}
	});
</script>
