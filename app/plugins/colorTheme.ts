// app/plugins/colorTheme.ts
// 系统配色引导：将 Cookie 中持久化的主色/中性色写入 appConfig.ui.colors，
// 驱动 @nuxt/ui colors 插件生成 --ui-color-{key}-{shade} CSS 变量；
// 同时向 :root 注入全局圆角 --ui-radius 与系统字体缩放因子 --app-font-scale。
import { isNeutralColor, isPrimaryColor } from "~~/layers/user/app/composables/colorPalette";
import { FONT_SCALE_VALUES, isFontScalePreset } from "~~/layers/user/app/composables/useFontScale";
import { isRadiusPreset, RADIUS_CSS_VALUES } from "~~/layers/user/app/composables/useVisualStyle";

export default defineNuxtPlugin(() => {
	const appConfig = useAppConfig();

	const primary = useCookie<string>("theme-primary", { default: () => "sky" });
	const neutral = useCookie<string>("theme-neutral", { default: () => "slate" });
	const radius = useCookie<string>("theme-radius", { default: () => "md" });
	const fontScale = useCookie<string>("theme-font-scale", { default: () => "md" });

	// Cookie 值可能被篡改，非法时回退到默认色
	appConfig.ui.colors.primary = isPrimaryColor(primary.value) ? primary.value : "sky";
	appConfig.ui.colors.neutral = isNeutralColor(neutral.value) ? neutral.value : "slate";

	const radiusPreset = isRadiusPreset(radius.value) ? radius.value : "md";
	const fontScalePreset = isFontScalePreset(fontScale.value) ? fontScale.value : "md";

	useHead({
		style: [{
			innerHTML: `:root { --ui-radius: ${RADIUS_CSS_VALUES[radiusPreset]}; --app-font-scale: ${FONT_SCALE_VALUES[fontScalePreset]}; }`,
			tagPriority: "critical",
			id: "nuxt-ui-radius"
		}]
	});
});
