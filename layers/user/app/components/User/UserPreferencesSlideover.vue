<template>
	<USlideover
		v-model:open="isPreferencesOpen"
		:title="$t('preferences.title')"
		:description="$t('preferences.description')"
		side="right"
		:ui="{ content: 'max-w-xl' }"
	>
		<template #body>
			<UserPreferencesPanel />
		</template>
	</USlideover>
</template>

<script setup lang="ts">
	const { isPreferencesOpen } = useUserPreferences();
</script>
