// layers/user/app/composables/colorPalette.ts
// 调色板单一事实源：主色 / 中性色候选与类型守卫。
// app.config.ts（ui.colors 注册）与 useColorTheme.ts（主题选择器）共同引用，避免双份维护。

/** 主题色：Nuxt UI v4 支持的全部彩色调色板 */
export type PrimaryColor = "red" | "orange" | "amber" | "yellow" | "lime" | "green" | "emerald" | "teal" | "cyan" | "sky" | "blue" | "indigo" | "violet" | "purple" | "fuchsia" | "pink" | "rose";

/** 中性色：Nuxt UI v4 支持的全部中性灰调色板 */
export type NeutralColor = "slate" | "gray" | "zinc" | "stone" | "mauve" | "olive" | "mist" | "taupe";

export const PRIMARY_COLORS: readonly PrimaryColor[] = ["red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal", "cyan", "sky", "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose"];

export const NEUTRAL_COLORS: readonly NeutralColor[] = ["slate", "gray", "zinc", "stone", "mauve", "olive", "mist", "taupe"];

export function isPrimaryColor(value: unknown): value is PrimaryColor {
	return typeof value === "string" && (PRIMARY_COLORS as readonly string[]).includes(value);
}

export function isNeutralColor(value: unknown): value is NeutralColor {
	return typeof value === "string" && (NEUTRAL_COLORS as readonly string[]).includes(value);
}
