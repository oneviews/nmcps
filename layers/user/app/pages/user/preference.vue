<template>
	<UPage class="mx-auto w-full max-w-4xl">
		<UPageHeader :title="$t('preferences.title')" :description="$t('preferences.description')" />

		<UPageBody>
			<UserUserPreferencesPanel />
		</UPageBody>
	</UPage>
</template>

<script setup lang="ts">
	definePageMeta({
		name: "preferences.title",
		icon: "carbon:favorite",
		category: "other",
		description: "preferences.description"
	});
</script>
