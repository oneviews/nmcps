// layers/user/app/composables/useVisualStyle.ts
// 视觉样式：全局圆角（Nuxt UI --ui-radius）。
// 圆角经 Cookie（theme-radius）持久化，客户端切换时直接更新 CSS 变量。
import type { ComputedRef } from "vue";

/** 全局圆角预设（映射 Nuxt UI 的 --ui-radius CSS 变量，默认 md = 0.25rem） */
export type RadiusPreset = "none" | "sm" | "md" | "lg" | "xl";

export const RADIUS_PRESETS: readonly RadiusPreset[] = ["none", "sm", "md", "lg", "xl"];

/** 各预设对应的 --ui-radius 值（与 Nuxt UI 半径刻度一致） */
export const RADIUS_CSS_VALUES: Record<RadiusPreset, string> = {
	none: "0",
	sm: "0.125rem",
	md: "0.25rem",
	lg: "0.5rem",
	xl: "0.75rem"
};

export function isRadiusPreset(value: string): value is RadiusPreset {
	return (RADIUS_PRESETS as readonly string[]).includes(value);
}

export interface VisualStyle {
	radius: ComputedRef<RadiusPreset>
}

export function useVisualStyle(): VisualStyle {
	const radiusCookie = useCookie<RadiusPreset>("theme-radius", {
		default: () => "md",
		maxAge: 60 * 60 * 24 * 365,
		sameSite: "lax"
	});

	const radius = computed<RadiusPreset>({
		get: () => (isRadiusPreset(radiusCookie.value) ? radiusCookie.value : "md"),
		set: (value) => {
			radiusCookie.value = value;
			if (import.meta.client) {
				document.documentElement.style.setProperty("--ui-radius", RADIUS_CSS_VALUES[value]);
			}
		}
	});

	return { radius };
}
