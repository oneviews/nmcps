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
				<main class="relative flex min-w-0 flex-1 flex-col">
					<!-- 大屏模式：页面内容为固定边框盒（absolute 定位不随滚动，圆角 + 边框），滚动发生在内容页内部（滚动条在边框内）；左侧 0，上/右/下 16px 间距一致；其余模式同构（页面在框内滚动）——「确定高度链」见 NMCPS-ARCH-006 §3.3 -->
					<div
						data-layout-metrics="content"
						:class="isBigscreenMode
							? 'absolute inset-y-4 left-0 right-4 flex flex-col overflow-hidden rounded-lg border border-(--ui-border)'
							: 'flex min-h-0 flex-1 flex-col overflow-hidden'"
					>
						<!--
							内容页工具栏：**全模式单一渲染点，且在滚动容器之外**（NMCPS-ARCH-006 §3.3 / §4）。
							不要按模式分成两处渲染 —— 切换布局模式时旧的挂载点被销毁重建，页面 `<Teleport>` 会
							连着旧节点一起留在已脱离文档的子树里，表现为「工具栏还在、动作全丢」（侧栏模式实测）。
						-->
						<AppToolbar />
						<div
							data-layout-scroll
							class="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-clip"
							:class="isTopbarMode ? `${topbarMaxWidthClass} mx-auto w-full` : ''"
						>
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

	// 文档内容区（左文件树 / 右目录）sticky 偏移：滚动容器顶部已固定在 toolbar 下沿
	// （两种模式的 toolbar 都在滚动容器之外，见 NMCPS-ARCH-006 §3.3），故偏移恒为 0。
	const contentStickyTop = "0px";

	// 文档内容区（左文件树 / 右目录）sticky 最大高度：跟随各自滚动容器可见高度。
	// - bigscreen 模式：100svh - header - toolbar - 边框盒上下内缩(inset-y-4=2rem) - 边框(2px)；
	// - 其余模式：100svh - header - toolbar。
	// 工具栏高度一律读 `--app-toolbar-h`（单一来源，NMCPS-ADR-0017 D5），不得写死 49px。
	const contentMaxH = computed(() =>
		isBigscreenMode.value
			? "calc(100svh - var(--ui-header-height) - var(--app-toolbar-h) - 2rem - 2px)"
			: "calc(100svh - var(--ui-header-height) - var(--app-toolbar-h))");

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
