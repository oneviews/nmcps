<template>
	<UDashboardToolbar
		class="app-toolbar sticky z-10"
		:class="toolbarStickyTop"
		:ui="{ root: 'bg-default/50 backdrop-blur-sm px-0' }"
	>
		<!-- 顶栏模式：条全宽（背景/边框占满），内部容器限宽与 header 对齐 -->
		<div
			class="flex w-full items-center justify-between gap-1.5 px-4 sm:px-6 lg:px-8"
			:class="isTopbarMode ? `${topbarMaxWidthClass} mx-auto` : ''"
		>
			<div class="flex min-w-0 items-center gap-1.5">
				<!-- 顶栏模式：面包屑置于 toolbar 左侧 -->
				<UBreadcrumb v-if="isTopbarMode" :items="breadcrumb" class="min-w-0" />
				<component :is="toolbarLeft" v-if="toolbarLeft" />
			</div>
			<div class="flex items-center gap-1.5">
				<component :is="toolbarRight" v-if="toolbarRight" />
			</div>
		</div>
	</UDashboardToolbar>
</template>

<script setup lang="ts">
	const { toolbarLeft, toolbarRight } = usePageToolbar();
	const { toolbarStickyTop, isTopbarMode, topbarMaxWidthClass } = useLayoutMode();
	const { breadcrumb } = useNavigation();

	// 路由切换时清空上一页的工具栏内容（新页面在 onMounted 里再设置）
	const route = useRoute();
	watch(() => route.fullPath, () => {
		toolbarLeft.value = null;
		toolbarRight.value = null;
	});
</script>
