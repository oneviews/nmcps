// layers/user/app/composables/useUserPreferenceOptions.ts
// 偏好设置选项：偏好面板共享的 UI 选项定义，避免跨组件重复维护。
import type { FontScalePreset } from "./useFontScale";
import { FONT_SCALE_PRESETS } from "./useFontScale";

/** 偏好选项（URadioGroup items 统一结构） */
export interface PreferenceOption<T extends string = string> {
	label: string
	value: T
	icon?: string
}

export function useUserPreferenceOptions() {
	const prefT = useUserPreferencesTranslation();

	// 系统字体大小：档位标签为「相对表述」，严禁写绝对 px 值
	const fontScaleItems = computed<PreferenceOption<FontScalePreset>[]>(() =>
		FONT_SCALE_PRESETS.map((key) => ({
			value: key,
			label: prefT.value.theme.visual.fontScale[key]
		}))
	);

	return { fontScaleItems };
}
