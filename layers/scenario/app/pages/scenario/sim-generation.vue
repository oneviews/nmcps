<template>
	<div />
</template>

<script setup lang="ts">
	// 旧入口（`/scenario/sim-generation`）保留为深链跳板；导航只显示 `/scenario/simulator`。
	definePageMeta({ hide: true });
	await navigateTo("/scenario/simulator", { replace: true });
</script>
