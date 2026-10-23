<template>
	<LayoutTile
		:title="$t('pages.os.title')"
		:description="$t('pages.os.description')"
	>
		<UAccordion :items="items" type="multiple" />
	</LayoutTile>
</template>

<script lang="ts" setup>
	import { isTauri } from "@tauri-apps/api/core";

	definePageMeta({
		name: "pages.os.title",
		icon: "carbon:information",
		category: "system",
		description: "pages.os.description"
	});

	const { t } = useI18n();
	const isTauriEnv = isTauri();

	// 异步 OS locale 提前在 setup 顶层 await，computed 内保持纯同步
	const osLocale = isTauriEnv ? (await useTauriOsLocale()) || null : null;

	const items = computed(() => [
		{
			label: t("pages.os.system"),
			icon: "carbon:screen",
			content: isTauriEnv ? `${useTauriOsPlatform()} ${useTauriOsVersion()}` : t("common.unavailableInBrowser")
		},
		{
			label: t("pages.os.arch"),
			icon: "carbon:chip",
			content: isTauriEnv ? useTauriOsArch() : t("common.unavailableInBrowser")
		},
		{
			label: t("pages.os.locale"),
			icon: "carbon:globe",
			content: isTauriEnv ? osLocale || t("pages.os.notDetectable") : t("common.unavailableInBrowser")
		}
	]);
</script>
