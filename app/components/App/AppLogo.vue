<template>
	<NuxtLink to="/" class="flex min-w-0 items-center gap-2">
		<SvgoLogo :font-controlled="false" class="size-6 shrink-0" />
		<span class="truncate text-lg font-bold tracking-tight">{{ app.name.toUpperCase() }}</span>
	</NuxtLink>
</template>

<script setup lang="ts">
	const { app } = useAppConfig();
</script>
