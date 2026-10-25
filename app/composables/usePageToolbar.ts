// app/composables/usePageToolbar.ts
// 页面工具栏内容：模块级共享状态（页面在 onMounted 设置，布局 AppToolbar 读取渲染）。
import type { Component, Ref } from "vue";

const toolbarLeft = shallowRef<Component | null>(null);
const toolbarRight = shallowRef<Component | null>(null);

export interface PageToolbarState {
	toolbarLeft: Ref<Component | null>
	toolbarRight: Ref<Component | null>
}

export function usePageToolbar(): PageToolbarState {
	return {
		toolbarLeft,
		toolbarRight
	};
}
