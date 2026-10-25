<template>
	<NuxtPage />
</template>

<script setup lang="ts">
	definePageMeta({ sort: 9, icon: "carbon:user", hide: true });

	const route = useRoute();
	onMounted(() => {
		if (route.path === "/user") {
			navigateTo("/user/profile", { replace: true });
		}
	});
</script>
