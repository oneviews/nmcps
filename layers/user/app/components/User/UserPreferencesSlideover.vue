<template>
	<USlideover
		v-model:open="isPreferencesOpen"
		:title="$t('preferences.title')"
		:description="$t('preferences.description')"
		side="right"
	>
		<UserUserPreferencesPanel />
	</USlideover>
</template>

<script setup lang="ts">
	const { isPreferencesOpen } = useUserPreferences();
</script>
