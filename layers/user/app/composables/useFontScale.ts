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

export function isFontScalePreset(value: string): value is FontScalePreset {
	return (FONT_SCALE_PRESETS as readonly string[]).includes(value);
}

export interface FontScale {
	fontScale: ComputedRef<FontScalePreset>
	setFontScale: (preset: FontScalePreset) => void
}

export function useFontScale(): FontScale {
	const fontScaleCookie = useCookie<FontScalePreset>("theme-font-scale", {
		default: () => "md",
		maxAge: 60 * 60 * 24 * 365,
		sameSite: "lax"
	});

	const fontScale = computed<FontScalePreset>({
		get: () => (isFontScalePreset(fontScaleCookie.value) ? fontScaleCookie.value : "md"),
		set: (value) => {
			fontScaleCookie.value = value;
			if (import.meta.client) {
				document.documentElement.style.setProperty("--app-font-scale", String(FONT_SCALE_VALUES[value]));
			}
		}
	});

	function setFontScale(preset: FontScalePreset): void {
		fontScale.value = preset;
	}

	return { fontScale, setFontScale };
}
