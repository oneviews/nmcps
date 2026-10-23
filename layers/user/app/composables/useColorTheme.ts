// layers/user/app/composables/useColorTheme.ts
// 系统配色主题：主色 / 中性色 / 外观模式。
// 主色与中性色经 Cookie（theme-primary / theme-neutral）持久化，
// 由 app/plugins/colorTheme 写入 appConfig.ui.colors，驱动 @nuxt/ui colors 插件。
import type { WritableComputedRef } from "vue";

/** 主题色：Nuxt UI v4 支持的全部彩色调色板 */
export type PrimaryColor = "red" | "orange" | "amber" | "yellow" | "lime" | "green" | "emerald" | "teal" | "cyan" | "sky" | "blue" | "indigo" | "violet" | "purple" | "fuchsia" | "pink" | "rose";

/** 中性色：Nuxt UI v4 支持的全部中性灰调色板 */
export type NeutralColor = "slate" | "gray" | "zinc" | "stone" | "mauve" | "olive" | "mist" | "taupe";

export const PRIMARY_COLORS: readonly PrimaryColor[] = ["red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal", "cyan", "sky", "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose"];
export const NEUTRAL_COLORS: readonly NeutralColor[] = ["slate", "gray", "zinc", "stone", "mauve", "olive", "mist", "taupe"];

export function isPrimaryColor(value: string): value is PrimaryColor {
	return (PRIMARY_COLORS as readonly string[]).includes(value);
}

export function isNeutralColor(value: string): value is NeutralColor {
	return (NEUTRAL_COLORS as readonly string[]).includes(value);
}

export interface ColorTheme {
	colorMode: ReturnType<typeof useColorMode>
	primary: WritableComputedRef<PrimaryColor>
	neutral: WritableComputedRef<NeutralColor>
}

export function useColorTheme(): ColorTheme {
	const colorMode = useColorMode();
	const appConfig = useAppConfig();

	const primaryCookie = useCookie<PrimaryColor>("theme-primary", {
		default: () => "sky",
		maxAge: 60 * 60 * 24 * 365,
		sameSite: "lax"
	});
	const neutralCookie = useCookie<NeutralColor>("theme-neutral", {
		default: () => "slate",
		maxAge: 60 * 60 * 24 * 365,
		sameSite: "lax"
	});

	const primary = computed<PrimaryColor>({
		get: () => (isPrimaryColor(primaryCookie.value) ? primaryCookie.value : "sky"),
		set: (value) => {
			primaryCookie.value = value;
			appConfig.ui.colors.primary = value;
		}
	});

	const neutral = computed<NeutralColor>({
		get: () => (isNeutralColor(neutralCookie.value) ? neutralCookie.value : "slate"),
		set: (value) => {
			neutralCookie.value = value;
			appConfig.ui.colors.neutral = value;
		}
	});

	return {
		colorMode,
		primary,
		neutral
	};
}
