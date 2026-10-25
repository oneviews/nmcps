// layers/user/app/composables/useColorTheme.ts
// 系统配色主题：主色 / 中性色 / 外观模式。
// 主色与中性色经 Cookie（theme-primary / theme-neutral）持久化，
// 由 app/plugins/colorTheme 写入 appConfig.ui.colors，驱动 @nuxt/ui colors 插件。
import type { WritableComputedRef } from "vue";

import type { NeutralColor, PrimaryColor } from "./colorPalette";
import { isNeutralColor, isPrimaryColor } from "./colorPalette";

export interface ColorTheme {
	colorMode: ReturnType<typeof useColorMode>
	primary: WritableComputedRef<PrimaryColor>
	neutral: WritableComputedRef<NeutralColor>
}

export function useColorTheme(): ColorTheme {
	const colorMode = useColorMode();
	const appConfig = useAppConfig();

	const primary = usePersistedSetting<PrimaryColor>({
		key: "theme-primary",
		default: "sky",
		validate: isPrimaryColor,
		onSet: (value) => {
			appConfig.ui.colors.primary = value;
		}
	});

	const neutral = usePersistedSetting<NeutralColor>({
		key: "theme-neutral",
		default: "slate",
		validate: isNeutralColor,
		onSet: (value) => {
			appConfig.ui.colors.neutral = value;
		}
	});

	return {
		colorMode,
		primary,
		neutral
	};
}
