<template>
	<LayoutTile
		title="OS Information"
		description="Read information about the operating system using the OS Information plugin."
	>
		<UAccordion :items="items" type="multiple" />
	</LayoutTile>
</template>

<script lang="ts" setup>
	import { isTauri } from "@tauri-apps/api/core";

	definePageMeta({
		name: "OS Informations",
		icon: "lucide:info",
		category: "system",
		description: "Read operating system informations."
	});

	const isTauriEnv = isTauri();

	const items = ref([
		{
			label: "System",
			icon: "lucide:monitor",
			content: isTauriEnv ? `${useTauriOsPlatform()} ${useTauriOsVersion()}` : "Unavailable in browser"
		},
		{
			label: "Arch",
			icon: "lucide:microchip",
			content: isTauriEnv ? useTauriOsArch() : "Unavailable in browser"
		},
		{
			label: "Locale",
			icon: "lucide:globe",
			content: isTauriEnv ? (await useTauriOsLocale()) || "Not detectable" : "Unavailable in browser"
		}
	]);
</script>
