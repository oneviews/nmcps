// layers/user/app/composables/useFontScale.ts
// 视觉样式：系统字体大小（全站文本缩放）。
// 档位经 Cookie（theme-font-scale）持久化，客户端切换时直接更新 CSS 变量。
import type { ComputedRef } from "vue";

/** 字号档位（相对表述）：sm 小 / md 标准（默认）/ lg 大 / xl 特大 */
export type FontScalePreset = "sm" | "md" | "lg" | "xl";

export const FONT_SCALE_PRESETS: readonly FontScalePreset[] = ["sm", "md", "lg", "xl"];

/** 各档位对应的缩放因子（取 Tailwind 既有 ratio，保证整数级尺度） */
export const FONT_SCALE_VALUES: Record<FontScalePreset, number> = {
	sm: 0.875,
	md: 1,
	lg: 1.125,
	xl: 1.25
};

export function isFontScalePreset(value: unknown): value is FontScalePreset {
	return typeof value === "string" && (FONT_SCALE_PRESETS as readonly string[]).includes(value);
}

export interface FontScale {
	fontScale: ComputedRef<FontScalePreset>
	setFontScale: (preset: FontScalePreset) => void
}

export function useFontScale(): FontScale {
	const fontScaleVar = useCssVar("--app-font-scale");

	const fontScale = usePersistedSetting<FontScalePreset>({
		key: "theme-font-scale",
		default: "md",
		validate: isFontScalePreset,
		onSet: (value) => {
			fontScaleVar.value = String(FONT_SCALE_VALUES[value]);
		}
	});

	function setFontScale(preset: FontScalePreset): void {
		fontScale.value = preset;
	}

	return { fontScale, setFontScale };
}
