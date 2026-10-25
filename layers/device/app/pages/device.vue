<template>
	<NuxtPage />
</template>

<script setup lang="ts">
	definePageMeta({ sort: 3, icon: "carbon:data-connected" });

	const route = useRoute();
	onMounted(() => {
		if (route.path === "/device") {
			navigateTo("/device/type", { replace: true });
		}
	});
</script>
