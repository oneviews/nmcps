<template>
	<div class="flex w-full flex-col gap-6">
		<UCard>
			<template #header>
				<div class="flex flex-col gap-1">
					<p class="text-base font-semibold">
						{{ prefT.layout.label }}
					</p>
				</div>
			</template>

			<UserLayoutModePicker />
		</UCard>

		<UCard>
			<template #header>
				<div class="flex flex-col gap-1">
					<p class="text-base font-semibold">
						{{ prefT.theme.label }}
					</p>
					<p class="text-sm text-muted">
						{{ prefT.theme.description }}
					</p>
				</div>
			</template>

			<UserColorThemePicker />
		</UCard>

		<!-- 背景与视觉（科技感背景三层：总开关 / 静态网格 / 粒子动效 / 强度） -->
		<UCard>
			<template #header>
				<div class="flex flex-col gap-1">
					<p class="text-base font-semibold">
						{{ prefT.appearance.title }}
					</p>
					<p class="text-sm text-muted">
						{{ prefT.appearance.description }}
					</p>
				</div>
			</template>

			<div class="flex flex-col gap-4">
				<!-- 总开关 -->
				<UFormField :label="prefT.appearance.enabled" orientation="horizontal" size="sm">
					<USwitch v-model="preferences.appearance.enabled" size="sm" />
				</UFormField>

				<!-- 子项：仅在总开关开启时可调 -->
				<template v-if="preferences.appearance.enabled">
					<USeparator />

					<UFormField
						:label="prefT.appearance.grid"
						:description="prefT.appearance.gridHint"
						orientation="horizontal"
						size="sm"
					>
						<USwitch v-model="preferences.appearance.grid" size="sm" />
					</UFormField>

					<UFormField
						:label="prefT.appearance.particles"
						:description="prefT.appearance.particlesHint"
						orientation="horizontal"
						size="sm"
					>
						<USwitch v-model="preferences.appearance.particles" size="sm" />
					</UFormField>

					<USeparator />

					<UFormField :label="prefT.appearance.intensity.label" size="sm">
						<UserPreferenceRadioGroup v-model="preferences.appearance.intensity" :items="intensityItems" />
					</UFormField>
				</template>
			</div>
		</UCard>
	</div>
</template>

<script setup lang="ts">
	import type { PreferenceOption } from "../../composables/useUserPreferenceOptions";
	import type { BackgroundIntensity } from "../../composables/useUserPreferences";

	const { preferences } = useUserPreferences();
	const prefT = useUserPreferencesTranslation();

	// 背景强度：subtle 克制（默认，避免干扰阅读）/ normal 标准
	const intensityItems = computed<PreferenceOption<BackgroundIntensity>[]>(() => [
		{ label: prefT.value.appearance.intensity.subtle, value: "subtle", icon: "carbon:view-off" },
		{ label: prefT.value.appearance.intensity.normal, value: "normal", icon: "carbon:view" }
	]);
</script>
