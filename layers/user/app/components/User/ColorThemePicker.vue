<template>
	<div class="flex w-full flex-col gap-4">
		<!-- 外观模式 -->
		<UFormField :label="prefT.theme.appearance.label" size="sm">
			<UserPreferenceRadioGroup v-model="appearance" :items="appearanceItems" />
		</UFormField>

		<!-- 主题色 -->
		<UFormField :label="prefT.theme.primary.label">
			<div class="flex flex-wrap gap-2">
				<UTooltip v-for="option in primaryOptions" :key="option.key" :text="option.label">
					<UButton
						:aria-label="option.label"
						class="size-8"
						:ui="{ base: 'rounded-full!' }"
						:style="swatchStyle(option.key, primary === option.key)"
						@click="primary = option.key"
					>
						<UIcon v-if="primary === option.key" name="carbon:checkmark" size="24" class="text-white" />
					</UButton>
				</UTooltip>
			</div>
		</UFormField>

		<!-- 中性色 -->
		<UFormField :label="prefT.theme.neutral.label">
			<div class="flex flex-wrap gap-2">
				<UTooltip v-for="option in neutralOptions" :key="option.key" :text="option.label">
					<UButton
						:aria-label="option.label"
						class="size-8"
						:ui="{ base: 'rounded-full!' }"
						:style="swatchStyle(option.key, neutral === option.key)"
						@click="neutral = option.key"
					>
						<UIcon v-if="neutral === option.key" name="carbon:checkmark" class="text-white" />
					</UButton>
				</UTooltip>
			</div>
		</UFormField>

		<USeparator />

		<!-- 视觉样式：圆角 + 系统字体大小 -->
		<UFormField :label="prefT.theme.visual.radiusLabel" size="sm">
			<UserPreferenceRadioGroup v-model="radius" :items="radiusItems" :show-icon="false" />
		</UFormField>

		<UFormField :label="prefT.theme.visual.fontScaleLabel" size="sm">
			<UserPreferenceRadioGroup v-model="fontScale" :items="fontScaleItems" :show-icon="false" />
		</UFormField>
	</div>
</template>

<script setup lang="ts">
// 系统配色主题面板：外观模式 / 主题色 / 中性色 / 圆角 / 字体大小。
	import type { NeutralColor, PrimaryColor } from "../../composables/colorPalette";
	import type { PreferenceOption } from "../../composables/useUserPreferenceOptions";
	import type { RadiusPreset } from "../../composables/useVisualStyle";
	import { NEUTRAL_COLORS, PRIMARY_COLORS } from "../../composables/colorPalette";
	import { useUserPreferenceOptions } from "../../composables/useUserPreferenceOptions";
	import { RADIUS_PRESETS } from "../../composables/useVisualStyle";

	const { colorMode, primary, neutral } = useColorTheme();
	const { radius } = useVisualStyle();
	const { fontScaleItems } = useUserPreferenceOptions();
	const { fontScale } = useFontScale();

	const prefT = useUserPreferencesTranslation();

	// ─── 外观模式（Light / Dark / System） ──────────────────────────────
	type AppearanceMode = "light" | "dark" | "system";

	function isAppearanceMode(value: string): value is AppearanceMode {
		return value === "light" || value === "dark" || value === "system";
	}

	const appearance = computed<AppearanceMode>({
		get: () => (isAppearanceMode(colorMode.preference) ? colorMode.preference : "system"),
		set: (value) => {
			colorMode.preference = value;
		}
	});

	const appearanceItems = computed<PreferenceOption<AppearanceMode>[]>(() => [
		{ label: prefT.value.theme.appearance.light, value: "light", icon: "carbon:sun" },
		{ label: prefT.value.theme.appearance.dark, value: "dark", icon: "carbon:moon" },
		{ label: prefT.value.theme.appearance.system, value: "system", icon: "carbon:laptop" }
	]);

	// ─── 视觉样式（圆角） ──────────────────────────────────────────────
	const radiusItems = computed<PreferenceOption<RadiusPreset>[]>(() =>
		RADIUS_PRESETS.map((key) => ({
			value: key,
			label: prefT.value.theme.visual.radius[key]
		}))
	);

	// ─── 主题色 / 中性色调色板 ───────────────────────────────────────────
	interface ColorOption<T extends string> {
		key: T
		label: string
	}

	const primaryOptions = computed<ColorOption<PrimaryColor>[]>(() =>
		PRIMARY_COLORS.map((key) => ({
			key,
			label: prefT.value.theme.colors[key]
		}))
	);

	const neutralOptions = computed<ColorOption<NeutralColor>[]>(() =>
		NEUTRAL_COLORS.map((key) => ({
			key,
			label: prefT.value.theme.colors[key]
		}))
	);

	/** 色块样式：背景取注册色 500 档 CSS 变量，选中态叠加同色外圈 */
	function swatchStyle(key: string, selected: boolean): Record<string, string> {
		const style: Record<string, string> = {
			backgroundColor: `var(--ui-color-${key}-500)`
		};
		if (selected) {
			style.boxShadow = `0 0 0 2px var(--ui-bg), 0 0 0 4px var(--ui-color-${key}-500)`;
		}
		return style;
	}
</script>
