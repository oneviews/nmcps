<template>
	<LayoutTile
		:title="$t('pages.os.title')"
		:description="$t('pages.os.description')"
	>
		<div class="space-y-4">
			<UAlert
				v-if="!isDesktop"
				color="neutral"
				variant="subtle"
				icon="carbon:warning-alt"
				:title="$t('common.unavailableInBrowser')"
			/>
			<UAccordion :items="items" type="multiple" />
		</div>
	</LayoutTile>
</template>

<script lang="ts" setup>
	definePageMeta({
		name: "pages.os.title",
		icon: "carbon:information",
		category: "system",
		description: "pages.os.description",
		sort: 1,
		group: "platform",
		tauriOnly: true
	});

	const { t } = useI18n();
	const { isDesktop, platform, version, arch } = usePlatformInfo();
	const locale = await usePlatformLocale();

	const items = computed(() => [
		{
			label: t("pages.os.system"),
			icon: "carbon:screen",
			content: isDesktop ? [platform, version].filter(Boolean).join(" ") : t("common.unavailableInBrowser")
		},
		{
			label: t("pages.os.arch"),
			icon: "carbon:chip",
			content: isDesktop ? arch || t("pages.os.notDetectable") : t("common.unavailableInBrowser")
		},
		{
			label: t("pages.os.locale"),
			icon: "carbon:globe",
			content: isDesktop ? locale || t("pages.os.notDetectable") : t("common.unavailableInBrowser")
		}
	]);
</script>
