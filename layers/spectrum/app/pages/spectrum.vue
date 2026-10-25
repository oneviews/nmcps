<template>
	<NuxtPage />
</template>

<script setup lang="ts">
	definePageMeta({ sort: 4, icon: "carbon:waveform" });

	const route = useRoute();
	onMounted(() => {
		if (route.path === "/spectrum") {
			navigateTo("/spectrum/monitor", { replace: true });
		}
	});
</script>
