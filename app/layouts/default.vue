<template>
	<UDashboardGroup as="template">
		<UDashboardSearch :groups="searchGroups" :placeholder="$t('layout.searchPlaceholder')" />

		<div
			class="relative flex h-svh flex-col overflow-hidden"
			:data-layout-mode="mode"
			:style="{ '--layout-top': 'var(--ui-header-height)', '--content-sticky-top': contentStickyTop, '--content-max-h': contentMaxH }"
		>
			<DesignTopBlob />
			<DesignBottomBlob />

			<!-- 科技感背景（底雾 + 网格 + 扫描线 + 粒子网络，由偏好 appearance.* 开关驱动） -->
			<AppBackground />

			<AppHeader class="relative z-50 shrink-0" />

			<div class="relative flex min-h-0 flex-1">
				<!-- 桌面端侧边栏（sidebar / bigscreen 模式，Nuxt UI USidebar 自带展开/收起） -->
				<USidebar
					v-if="hasSidebar && !isMobile"
					v-model:open="sidebarOpen"
					:collapsible="preferences.layout.sidebar.collapsible"
					:variant="preferences.layout.sidebar.variant"
					data-layout-metrics="sidebar"
					:ui="{ inner: 'bg-default/50 backdrop-blur-sm', body: 'p-0 gap-0' }"
				>
					<template #default="{ state }">
						<AppSidebar :collapsed="state === 'collapsed'" />
					</template>
				</USidebar>

				<!-- 主内容区 -->
				<main
					class="relative min-w-0 flex-1"
					:class="isBigscreenMode ? '' : 'overflow-y-auto overflow-x-clip'"
				>
					<!-- 大屏模式：页面内容为固定边框盒（absolute 定位不随滚动，圆角 + 边框），滚动发生在内容页内部（滚动条在边框内，toolbar 在滚动容器内 sticky 使磨砂玻璃生效）；左侧 0，上/右/下 16px 间距一致；其余模式由 main 整体滚动 -->
					<div
						data-layout-metrics="content"
						:class="isBigscreenMode
							? 'absolute inset-y-4 left-0 right-4 flex flex-col overflow-hidden rounded-lg border border-(--ui-border)'
							: 'min-h-full'"
					>
						<AppToolbar v-if="!isBigscreenMode" />
						<div
							:class="[
								isBigscreenMode ? 'min-h-0 flex-1 overflow-y-auto overflow-x-clip' : '',
								isTopbarMode ? `${topbarMaxWidthClass} mx-auto` : '',
							]"
						>
							<AppToolbar v-if="isBigscreenMode" />
							<slot />
						</div>
					</div>
				</main>
			</div>

			<!-- 移动端侧边栏抽屉（所有模式） -->
			<USlideover v-if="isMobile" v-model:open="mobileSidebarOpen" side="left">
				<template #body>
					<AppSidebar v-if="hasSidebar" />
					<UNavigationMenu v-else :items="navigation" orientation="vertical" class="p-2" />
				</template>
			</USlideover>
		</div>
	</UDashboardGroup>
</template>

<script setup lang="ts">
	import type { CommandPaletteItem } from "@nuxt/ui";

	const { t } = useI18n();
	const { navigation } = useNavigation();
	const { mobileSidebarOpen, preferences } = useUserPreferences();
	const { mode, isBigscreenMode, isTopbarMode, hasSidebar, isMobile, topbarMaxWidthClass } = useLayoutMode();

	// 桌面端启动静默检查更新（浏览器预览由 useUpdater 内部 isTauri 守卫跳过）：
	// 仅发现新版本时提示一次，由用户点击「立即更新」触发下载安装，避免冷启动打扰。
	const { silentCheckForUpdates } = useUpdater();
	onMounted(() => {
		void silentCheckForUpdates();
	});

	// 文档内容区（左文件树 / 右目录）sticky 偏移：对齐 toolbar 下沿。
	// - bigscreen 模式：滚动容器顶部已在 toolbar 下沿 → 0；
	// - 其余模式（sidebar/topbar）：滚动容器顶部在 header 下沿、toolbar 在其中 sticky，
	//   需让位一个 toolbar 高度（@nuxt/ui DashboardToolbar min-h-[49px]）。
	const contentStickyTop = computed(() => (isBigscreenMode.value ? "0px" : "49px"));

	// 文档内容区（左文件树 / 右目录）sticky 最大高度：跟随各自滚动容器可见高度。
	// - bigscreen 模式：100svh - header(64) - toolbar(49) - 边框盒上下内缩(inset-y-4=2rem) - 边框(2px)；
	// - 其余模式：100svh - header(64) - toolbar(49)。
	const contentMaxH = computed(() =>
		isBigscreenMode.value
			? "calc(100svh - var(--ui-header-height) - 49px - 2rem - 2px)"
			: "calc(100svh - var(--ui-header-height) - 49px)");

	// 侧栏搜索：内容中心文档分组（keywords 并入 description 参与 fuse 分词检索；集合随 locale 切换）
	const collection = useContentCollection();
	const { data: contentDocs } = await useAsyncData("content-search", () =>
		queryCollection(collection.value)
			.where("path", "NOT LIKE", "%/.navigation")
			.select("path", "title", "description", "excerpt", "keywords")
			.all(), { watch: [collection] });

	const contentSearchItems = computed<CommandPaletteItem[]>(() =>
		(contentDocs.value ?? []).map((doc) => ({
			label: doc.title,
			description: [doc.excerpt ?? doc.description, ...(doc.keywords ?? [])].filter(Boolean).join(" · "),
			to: `/content/document/${doc.path.replace(/^\//, "")}`,
			icon: "carbon:document"
		}))
	);

	// 侧栏搜索：导航路由分组（Nuxt UI UDashboardSearch 命令面板）
	const searchGroups = computed(() => [
		{
			id: "navigation",
			label: t("layout.search"),
			items: navigation.value as CommandPaletteItem[]
		},
		{
			id: "content",
			label: t("layout.searchDocs"),
			items: contentSearchItems.value
		}
	]);

	// USidebar v-model:open 双向绑定（header 切换按钮经 toggleSidebar 写入，此处响应式回读）
	const sidebarOpen = computed({
		get: () => preferences.value.layout.sidebar.open,
		set: (value) => {
			preferences.value.layout.sidebar.open = value;
		}
	});
</script>
