// app/composables/useLayoutMode.ts
// 导航布局模式语义谓词（只读）：顶栏 / 侧边栏 / 大屏 / 手机 四种模式。
import type { ComputedRef } from "vue";
import type { LayoutMode, TopbarMaxWidth } from "~~/layers/user/app/composables/useUserPreferences";

/**
 * 工具条 sticky 偏移类名（Tailwind 静态类**字面量**）。
 * 字面量必须留在源码中，供 Tailwind 扫描器提取实际 CSS。
 */
export type ToolbarStickyTopClass = "top-0";

/** 顶栏模式内容最大宽度 → Tailwind max-w 类（字面量供 Tailwind 扫描） */
export const TOPBAR_MAX_WIDTH_CLASSES: Record<TopbarMaxWidth, string> = {
	narrow: "max-w-(--ui-container)",
	wide: "max-w-[1440px]",
	full: "max-w-none"
};

export interface LayoutModeFlags {
	mode: ComputedRef<LayoutMode>
	/** 顶栏模式：logo 居左、路由居中、控制按钮居右（无侧边栏） */
	isTopbarMode: ComputedRef<boolean>
	/** 侧边栏模式：全宽 header + 下方侧边栏 */
	isSidebarMode: ComputedRef<boolean>
	/** 大屏模式：侧边栏模式的变体（浮动侧栏） */
	isBigscreenMode: ComputedRef<boolean>
	/** 手机模式：强制移动端布局（调试安卓等） */
	isMobileMode: ComputedRef<boolean>
	/** 是否渲染侧边栏内容（sidebar / bigscreen / mobile） */
	hasSidebar: ComputedRef<boolean>
	/** 是否按移动端布局渲染（窄屏 或 手机模式） */
	isMobile: ComputedRef<boolean>
	/**
	 * 工具条**宽度**唯一判据：非侧边栏模式即全宽（topbar + bigscreen + mobile）。
	 * ⚠️ 与「sticky 偏移」**必须解耦**（见 `toolbarStickyTop`），两者不可用同一布尔值。
	 */
	isFullWidthToolbar: ComputedRef<boolean>
	/** 工具条 **sticky 偏移**：统一 top-0（大屏模式内容页内部滚动、toolbar 固定于边框盒顶部；其余模式 header 在滚动容器之外） */
	toolbarStickyTop: ComputedRef<ToolbarStickyTopClass>
	/** 顶栏模式内容最大宽度类（header / toolbar / 内容页统一应用） */
	topbarMaxWidthClass: ComputedRef<string>
}

export function useLayoutMode(): LayoutModeFlags {
	const { preferences } = useUserPreferences();

	const mode = computed<LayoutMode>(() => preferences.value.layout.mode);
	const isTopbarMode = computed(() => mode.value === "topbar");
	const isSidebarMode = computed(() => mode.value === "sidebar");
	const isBigscreenMode = computed(() => mode.value === "bigscreen");
	const isMobileMode = computed(() => mode.value === "mobile");
	const hasSidebar = computed(() => mode.value !== "topbar");

	// 工具条二维解耦（对齐 v1 useLayoutMode）：
	// - 宽度：非侧边栏模式（topbar / bigscreen / mobile）即全宽；sidebar 受面板列宽约束
	// - 偏移：统一 top-0
	const isFullWidthToolbar = computed(() => mode.value !== "sidebar");
	const toolbarStickyTop = computed<ToolbarStickyTopClass>(() => "top-0");
	const topbarMaxWidthClass = computed(() => TOPBAR_MAX_WIDTH_CLASSES[preferences.value.layout.maxWidth]);

	const isNarrow = useMediaQuery("(max-width: 1023px)");
	const isMobile = computed(() => isMobileMode.value || isNarrow.value);

	return {
		mode,
		isTopbarMode,
		isSidebarMode,
		isBigscreenMode,
		isMobileMode,
		hasSidebar,
		isMobile,
		isFullWidthToolbar,
		toolbarStickyTop,
		topbarMaxWidthClass
	};
}
