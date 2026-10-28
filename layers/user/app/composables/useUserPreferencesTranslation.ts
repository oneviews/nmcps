// layers/user/app/composables/useUserPreferencesTranslation.ts
// 用户偏好翻译聚合：与 i18n/locales/*.json 的 preferences.* 结构同步。
// computed 聚合保证语言切换时整体重算一次，组件模板读取均为缓存对象属性访问。
export function useUserPreferencesTranslation() {
	const { t } = useI18n();

	return computed(() => ({
		appearance: {
			title: t("preferences.appearance.title"),
			description: t("preferences.appearance.description"),
			enabled: t("preferences.appearance.enabled"),
			grid: t("preferences.appearance.grid"),
			gridHint: t("preferences.appearance.gridHint"),
			particles: t("preferences.appearance.particles"),
			particlesHint: t("preferences.appearance.particlesHint"),
			intensity: {
				label: t("preferences.appearance.intensity.label"),
				subtle: t("preferences.appearance.intensity.subtle"),
				normal: t("preferences.appearance.intensity.normal")
			}
		},
		layout: {
			label: t("preferences.layout.label"),
			mode: {
				topbar: t("preferences.layout.mode.topbar"),
				sidebar: t("preferences.layout.mode.sidebar"),
				bigscreen: t("preferences.layout.mode.bigscreen"),
				mobile: t("preferences.layout.mode.mobile")
			},
			maxWidth: {
				label: t("preferences.layout.maxWidth.label"),
				narrow: t("preferences.layout.maxWidth.narrow"),
				wide: t("preferences.layout.maxWidth.wide"),
				full: t("preferences.layout.maxWidth.full")
			}
		},
		theme: {
			label: t("preferences.theme.label"),
			description: t("preferences.theme.description"),
			appearance: {
				label: t("preferences.theme.appearance.label"),
				light: t("preferences.theme.appearance.light"),
				dark: t("preferences.theme.appearance.dark"),
				system: t("preferences.theme.appearance.system")
			},
			primary: {
				label: t("preferences.theme.primary.label")
			},
			neutral: {
				label: t("preferences.theme.neutral.label")
			},
			visual: {
				radiusLabel: t("preferences.theme.visual.radiusLabel"),
				fontScaleLabel: t("preferences.theme.visual.fontScaleLabel"),
				fontScale: {
					sm: t("preferences.theme.visual.fontScale.sm"),
					md: t("preferences.theme.visual.fontScale.md"),
					lg: t("preferences.theme.visual.fontScale.lg"),
					xl: t("preferences.theme.visual.fontScale.xl")
				},
				radius: {
					none: t("preferences.theme.visual.radius.none"),
					sm: t("preferences.theme.visual.radius.sm"),
					md: t("preferences.theme.visual.radius.md"),
					lg: t("preferences.theme.visual.radius.lg"),
					xl: t("preferences.theme.visual.radius.xl")
				}
			},
			colors: {
				red: t("preferences.theme.colors.red"),
				orange: t("preferences.theme.colors.orange"),
				amber: t("preferences.theme.colors.amber"),
				yellow: t("preferences.theme.colors.yellow"),
				lime: t("preferences.theme.colors.lime"),
				green: t("preferences.theme.colors.green"),
				emerald: t("preferences.theme.colors.emerald"),
				teal: t("preferences.theme.colors.teal"),
				cyan: t("preferences.theme.colors.cyan"),
				sky: t("preferences.theme.colors.sky"),
				blue: t("preferences.theme.colors.blue"),
				indigo: t("preferences.theme.colors.indigo"),
				violet: t("preferences.theme.colors.violet"),
				purple: t("preferences.theme.colors.purple"),
				fuchsia: t("preferences.theme.colors.fuchsia"),
				pink: t("preferences.theme.colors.pink"),
				rose: t("preferences.theme.colors.rose"),
				slate: t("preferences.theme.colors.slate"),
				gray: t("preferences.theme.colors.gray"),
				zinc: t("preferences.theme.colors.zinc"),
				stone: t("preferences.theme.colors.stone"),
				mauve: t("preferences.theme.colors.mauve"),
				olive: t("preferences.theme.colors.olive"),
				mist: t("preferences.theme.colors.mist"),
				taupe: t("preferences.theme.colors.taupe")
			}
		}
	}));
}
