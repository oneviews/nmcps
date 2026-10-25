<template>
	<UFormField :label="prefT.layout.label">
		<UserPreferenceRadioGroup v-model="mode" :items="modeItems" />
	</UFormField>

	<!-- 顶栏模式：内容最大宽度（窄 / 宽 / 全宽） -->
	<UFormField v-if="mode === 'topbar'" :label="prefT.layout.maxWidth.label">
		<UserPreferenceRadioGroup v-model="maxWidth" :items="maxWidthItems" />
	</UFormField>
</template>

<script setup lang="ts">
	import type { PreferenceOption } from "../../composables/useUserPreferenceOptions";
	import type { LayoutMode, TopbarMaxWidth } from "../../composables/useUserPreferences";

	const { preferences, applyLayoutModePreset } = useUserPreferences();
	const prefT = useUserPreferencesTranslation();

	const mode = computed<LayoutMode>({
		get: () => preferences.value.layout.mode,
		set: (value) => {
			preferences.value.layout.mode = value;
			// 切模式时套用一次推荐侧栏形态
			applyLayoutModePreset(value);
		}
	});

	const modeItems = computed<PreferenceOption<LayoutMode>[]>(() => [
		{ value: "topbar", label: prefT.value.layout.mode.topbar, icon: "carbon:row" },
		{ value: "sidebar", label: prefT.value.layout.mode.sidebar, icon: "carbon:side-panel-open" },
		{ value: "bigscreen", label: prefT.value.layout.mode.bigscreen, icon: "carbon:screen" },
		{ value: "mobile", label: prefT.value.layout.mode.mobile, icon: "carbon:mobile" }
	]);

	const maxWidth = computed<TopbarMaxWidth>({
		get: () => preferences.value.layout.maxWidth,
		set: (value) => {
			preferences.value.layout.maxWidth = value;
		}
	});

	const maxWidthItems = computed<PreferenceOption<TopbarMaxWidth>[]>(() => [
		{ value: "narrow", label: prefT.value.layout.maxWidth.narrow },
		{ value: "wide", label: prefT.value.layout.maxWidth.wide },
		{ value: "full", label: prefT.value.layout.maxWidth.full }
	]);
</script>
