<template>
	<div class="flex w-full flex-col gap-6">
		<UCard>
			<template #header>
				<div class="flex flex-col gap-1">
					<p class="font-medium">
						{{ prefT.layout.label }}
					</p>
				</div>
			</template>

			<UserLayoutModePicker />
		</UCard>

		<UCard>
			<template #header>
				<div class="flex flex-col gap-1">
					<p class="font-medium">
						{{ prefT.theme.label }}
					</p>
					<p class="text-sm text-muted">
						{{ prefT.theme.description }}
					</p>
				</div>
			</template>

			<UserColorThemePicker />
		</UCard>
	</div>
</template>

<script setup lang="ts">
	const prefT = useUserPreferencesTranslation();
</script>
