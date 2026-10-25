<template>
	<NuxtPage />
</template>

<script setup lang="ts">
	definePageMeta({ sort: 6, icon: "carbon:send-alt" });

	const route = useRoute();
	onMounted(() => {
		if (route.path === "/transmission") {
			navigateTo("/transmission/transmit", { replace: true });
		}
	});
</script>
