// layers/user/app/composables/useUserPreferences.ts
// 用户偏好全局状态：布局模式 + 侧栏形态，偏好设置抽屉开关。
import type { Ref } from "vue";

/** 导航布局模式：topbar 顶栏 / sidebar 侧边栏 / bigscreen 大屏 / mobile 手机 */
export type LayoutMode = "topbar" | "sidebar" | "bigscreen" | "mobile";

/** 侧栏视觉变体：sidebar 常规贴边 / floating 浮动卡片 */
export type SidebarVariant = "sidebar" | "floating";

/** 侧栏折叠模式：offcanvas 抽屉收起 / icon 纯图标收起 */
export type SidebarCollapsible = "offcanvas" | "icon";

/** 顶栏模式内容最大宽度：narrow 窄（1280px）/ wide 宽（1440px）/ full 全宽 */
export type TopbarMaxWidth = "narrow" | "wide" | "full";

export const TOPBAR_MAX_WIDTHS: readonly TopbarMaxWidth[] = ["narrow", "wide", "full"];

export interface SidebarPreferences {
	/** 侧栏视觉变体 */
	variant: SidebarVariant
	/** 侧栏折叠模式（Nuxt UI USidebar collapsible） */
	collapsible: SidebarCollapsible
	/** 桌面端侧边栏展开状态（sidebar / bigscreen 模式有效） */
	open: boolean
}

export interface LayoutPreferences {
	/** 导航布局模式 */
	mode: LayoutMode
	/** 侧栏形态（切模式时由预设套用一次） */
	sidebar: SidebarPreferences
	/** 顶栏模式内容最大宽度 */
	maxWidth: TopbarMaxWidth
}

/** 背景强度：subtle 克制（默认，避免干扰阅读）/ normal 标准 */
export type BackgroundIntensity = "subtle" | "normal";

/** 外观偏好分区（科技感背景三层：总开关 / 静态网格 / 粒子动效 / 强度） */
export interface AppearancePreferences {
	/** 总开关（关闭则背景三层全部隐藏） */
	enabled: boolean
	/** L0 静态网格 + 扫描线（纯 CSS，零开销） */
	grid: boolean
	/** L2 粒子层（canvas 持续开销，默认开；可经偏好面板关闭） */
	particles: boolean
	/** 强度：控制粒子/网格的不透明度档位 */
	intensity: BackgroundIntensity
}

export interface UserPreferences {
	layout: LayoutPreferences
	appearance: AppearancePreferences
}

/**
 * 各布局模式的推荐侧栏形态（切模式时套用一次；之后用户手动改动保留至下次切模式）。
 * 设计基准对齐 v1 LAYOUT_MODE_PRESETS（layout-mode-plan §三·3.6）：
 * - sidebar / topbar / mobile：常规贴边 + 展开
 * - bigscreen：浮动卡片 + 展开
 */
export const LAYOUT_MODE_PRESETS: Record<LayoutMode, SidebarPreferences> = {
	sidebar: { variant: "sidebar", collapsible: "icon", open: true },
	topbar: { variant: "sidebar", collapsible: "offcanvas", open: true },
	bigscreen: { variant: "floating", collapsible: "icon", open: true },
	mobile: { variant: "sidebar", collapsible: "offcanvas", open: true }
};

export interface UserPreferencesState {
	preferences: Ref<UserPreferences>
	/** 偏好设置抽屉开关（Header 按钮与 Slideover 共享） */
	isPreferencesOpen: Ref<boolean>
	/** 桌面端侧边栏展开/收起 */
	toggleSidebar: () => void
	/** 移动端侧边栏抽屉开关 */
	mobileSidebarOpen: Ref<boolean>
	/** 移动端侧边栏抽屉开合 */
	toggleMobileSidebar: () => void
	/** 套用某布局模式的推荐侧栏形态（切模式时调用一次） */
	applyLayoutModePreset: (mode: LayoutMode) => void
}

export function useUserPreferences(): UserPreferencesState {
	const preferences = useState<UserPreferences>("user-preferences", () => ({
		layout: {
			// 默认大屏模式（对齐 v1 DEFAULT_LAYOUT_MODE = 'bigscreen'）
			mode: "bigscreen",
			// 侧栏形态由预设派生（单源，避免与 LAYOUT_MODE_PRESETS 漂移）
			sidebar: { ...LAYOUT_MODE_PRESETS.bigscreen },
			// 顶栏模式内容最大宽度（默认较宽）
			maxWidth: "wide"
		},
		// 科技感背景：网格与粒子均默认开（粒子已具备可视性门控 + 降密度，见 Background.vue）
		appearance: {
			enabled: true,
			grid: true,
			particles: true,
			intensity: "subtle"
		}
	}));

	const isPreferencesOpen = useState<boolean>("user-preferences-open", () => false);
	const mobileSidebarOpen = useState<boolean>("mobile-sidebar-open", () => false);

	function toggleSidebar(): void {
		preferences.value.layout.sidebar.open = !preferences.value.layout.sidebar.open;
	}

	function toggleMobileSidebar(): void {
		mobileSidebarOpen.value = !mobileSidebarOpen.value;
	}

	/**
	 * 套用布局模式的推荐侧栏形态（切模式时调用一次）。
	 * 只写 `layout.sidebar`；`layout.mode` 由调用方（偏好面板）写入，保持「模式写点唯一」。
	 */
	function applyLayoutModePreset(mode: LayoutMode): void {
		preferences.value.layout.sidebar = { ...LAYOUT_MODE_PRESETS[mode] };
	}

	return {
		preferences,
		isPreferencesOpen,
		toggleSidebar,
		mobileSidebarOpen,
		toggleMobileSidebar,
		applyLayoutModePreset
	};
}
