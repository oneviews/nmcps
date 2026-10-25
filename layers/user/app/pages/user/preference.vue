<template>
	<UPage class="mx-auto w-full max-w-4xl">
		<UPageHeader :title="$t('preferences.title')" :description="$t('preferences.description')" />

		<UPageBody>
			<UserPreferencesPanel />
		</UPageBody>
	</UPage>
</template>

<script setup lang="ts">
	definePageMeta({
		sort: 2,
		icon: "carbon:favorite"
	});
</script>
