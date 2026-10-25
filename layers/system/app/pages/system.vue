<template>
	<NuxtPage />
</template>

<script setup lang="ts">
	definePageMeta({ sort: 7, icon: "carbon:settings" });

	const route = useRoute();
	onMounted(() => {
		if (route.path === "/system") {
			navigateTo("/system/user", { replace: true });
		}
	});
</script>
