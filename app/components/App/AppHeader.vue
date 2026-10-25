<template>
	<UHeader :ui="headerUi">
		<!-- 左侧：移动端汉堡 → logo（顶栏/侧边栏）→ 切换按钮 + 面包屑（侧边栏/大屏） -->
		<template #left>
			<UButton
				v-if="isMobile"
				icon="carbon:menu"
				color="neutral"
				variant="ghost"
				:aria-label="$t('layout.toggleSidebar')"
				@click="toggleMobileSidebar"
			/>
			<!-- 侧边栏模式（桌面端）：logo 占满侧栏宽度（16rem - header lg padding 2rem = 14rem），使切换按钮 + 面包屑右移对齐侧栏右缘 -->
			<AppLogo
				v-if="!isBigscreenMode"
				:class="isSidebarMode && !isMobile ? 'w-56 shrink-0' : ''"
			/>
			<UButton
				v-if="hasSidebar && !isMobile"
				:icon="sidebarOpen ? 'carbon:side-panel-close' : 'carbon:side-panel-open'"
				color="neutral"
				variant="ghost"
				:aria-label="$t('layout.toggleSidebar')"
				@click="toggleSidebar"
			/>
			<UBreadcrumb v-if="hasSidebar" :items="breadcrumb" class="hidden min-w-0 md:flex" />
		</template>

		<!-- 中间：顶栏 → 路由导航（绝对定位居中，不受左右宽度不对称影响）；大屏 → 中列 Logo 居中 -->
		<div
			v-if="isTopbarMode"
			class="pointer-events-none absolute inset-0 hidden items-center justify-center lg:flex"
		>
			<UNavigationMenu
				:items="navigation"
				variant="link"
				class="pointer-events-auto"
			/>
		</div>
		<div
			v-else-if="isBigscreenMode"
			class="pointer-events-none absolute inset-0 flex items-center justify-center"
		>
			<AppLogo class="pointer-events-auto" />
		</div>

		<!-- 右侧：控制按钮 -->
		<template #right>
			<SiteColorModeButton />
			<UButton
				icon="carbon:favorite"
				color="neutral"
				variant="ghost"
				class="rounded-full"
				:aria-label="$t('preferences.title')"
				@click="isPreferencesOpen = true"
			/>
			<UDropdownMenu :items="settingsMenuItems" :content="{ align: 'end' }" :ui="{ content: 'w-56' }">
				<UButton
					icon="carbon:settings"
					color="neutral"
					variant="ghost"
					class="rounded-full"
					:aria-label="$t('common.settings')"
				/>
			</UDropdownMenu>
			<span class="h-6 w-px bg-(--ui-border)" aria-hidden="true" />
			<UDropdownMenu :items="userMenuItems" :content="{ align: 'end' }" :ui="{ content: 'w-56' }">
				<UButton
					icon="carbon:user"
					color="primary"
					variant="outline"
					size="sm"
					class="rounded-full"
					:aria-label="$t('common.userMenu')"
				/>
			</UDropdownMenu>
		</template>
	</UHeader>
</template>

<script setup lang="ts">
	import type { DropdownMenuItem } from "@nuxt/ui";

	const { navigation, breadcrumb } = useNavigation();
	const { preferences, isPreferencesOpen, toggleSidebar, toggleMobileSidebar } = useUserPreferences();
	const { isTopbarMode, isBigscreenMode, isSidebarMode, hasSidebar, isMobile, topbarMaxWidthClass } = useLayoutMode();

	const sidebarOpen = computed(() => preferences.value.layout.sidebar.open);

	const { t, locale, setLocale } = useI18n();
	const router = useRouter();
	const { fontScale, setFontScale } = useFontScale();

	// 语言选择持久化（与 app.vue 的 localeCookie 恢复逻辑单一事实源同步）
	const localeCookie = useCookie<string>("locale", {
		default: () => "cn",
		maxAge: 60 * 60 * 24 * 365,
		sameSite: "lax"
	});

	function switchLocale(l: "cn" | "en"): void {
		setLocale(l);
		localeCookie.value = l;
	}

	/** 设置菜单：语言 + 分割线 + 字体大小（前导图标 / 当前态 primary 强调 / 右侧对号） */
	const settingsMenuItems = computed<DropdownMenuItem[]>(() => [
		{ label: t("language.cn"), icon: "carbon:translate", type: "checkbox", checked: locale.value === "cn", color: locale.value === "cn" ? "primary" : undefined, onSelect: () => switchLocale("cn") },
		{ label: t("language.en"), icon: "carbon:translate", type: "checkbox", checked: locale.value === "en", color: locale.value === "en" ? "primary" : undefined, onSelect: () => switchLocale("en") },
		{ type: "separator" },
		{ label: t("preferences.theme.visual.fontScale.sm"), icon: "carbon:text-scale", type: "checkbox", checked: fontScale.value === "sm", color: fontScale.value === "sm" ? "primary" : undefined, onSelect: () => setFontScale("sm") },
		{ label: t("preferences.theme.visual.fontScale.md"), icon: "carbon:text-scale", type: "checkbox", checked: fontScale.value === "md", color: fontScale.value === "md" ? "primary" : undefined, onSelect: () => setFontScale("md") },
		{ label: t("preferences.theme.visual.fontScale.lg"), icon: "carbon:text-scale", type: "checkbox", checked: fontScale.value === "lg", color: fontScale.value === "lg" ? "primary" : undefined, onSelect: () => setFontScale("lg") },
		{ label: t("preferences.theme.visual.fontScale.xl"), icon: "carbon:text-scale", type: "checkbox", checked: fontScale.value === "xl", color: fontScale.value === "xl" ? "primary" : undefined, onSelect: () => setFontScale("xl") }
	]);

	/** 用户中心菜单：子路由 + 分割线 + 切换账号/退出登录（预留） */
	const userMenuItems = computed<DropdownMenuItem[]>(() => {
		const subRoutes = router.getRoutes()
			.filter((r) => r.path.startsWith("/user/") && typeof r.meta.sort === "number" && !r.meta.hide)
			.sort((a, b) => (a.meta.sort ?? 999) - (b.meta.sort ?? 999));

		return [
			...subRoutes.map((r) => ({
				label: t(`pages.${String(r.name)}.title`),
				icon: r.meta.icon,
				to: r.path
			})),
			{ type: "separator" },
			{ label: t("common.switchAccount"), icon: "carbon:user-multiple", onSelect: () => {
				// TODO: 切换账号
			} },
			{ label: t("common.logout"), icon: "carbon:logout", onSelect: () => {
				// TODO: 退出登录
			} }
		];
	});

	// header 根类：磨砂玻璃（所有模式，bg-default/50 半透明 + backdrop-blur-sm）；大屏额外加阴影（悬浮海拔）
	const headerUi = computed(() => ({
		root: `bg-default/50 backdrop-blur-sm ${isBigscreenMode.value ? "shadow-lg" : ""}`,
		// 顶栏模式：内容最大宽度跟随偏好；其余模式全宽
		container: isTopbarMode.value ? topbarMaxWidthClass.value : "max-w-none"
	}));
</script>
