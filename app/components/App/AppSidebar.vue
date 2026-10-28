<template>
	<div class="flex h-full w-full flex-col overflow-hidden">
		<!-- 第一层：路由搜索（收起态：连同外边距总高 49px 对齐工具栏）+ 菜单展开/收起（仅展开态显示） -->
		<div class="flex items-center border-b border-(--ui-border)" :class="collapsed ? 'h-[49px] justify-center' : 'gap-2 p-2'">
			<UDashboardSearchButton
				:collapsed="collapsed"
				:tooltip="collapsed"
				:class="collapsed ? '' : 'min-w-0 flex-1'"
				size="sm"
				:label="$t('layout.search')"
			/>
			<UButton
				v-if="!collapsed"
				:icon="expandOverride === true ? 'carbon:collapse-all' : 'carbon:expand-all'"
				color="neutral"
				variant="ghost"
				:aria-label="$t('layout.toggleMenu')"
				@click="toggleMenu"
			/>
		</div>

		<!-- 路由菜单（收起态：纯图标 + tooltip/popover，对齐 Nuxt UI navigation-menu「with popover in items」） -->
		<nav class="flex-1 overflow-y-auto" :class="collapsed ? 'p-1' : 'p-2'">
			<UNavigationMenu
				:key="navKey"
				:items="navItems"
				:collapsed="collapsed"
				orientation="vertical"
				type="multiple"
				tooltip
				popover
				:highlight="false"
				:ui="collapsed ? { link: 'justify-center', linkLabel: 'hidden', linkTrailing: 'hidden' } : undefined"
			/>
		</nav>

		<!-- 底部：软件版本号等 tag 信息（收起态隐藏） -->
		<div v-if="!collapsed" class="flex flex-wrap items-center gap-1.5 border-t border-(--ui-border) p-3">
			<UBadge variant="subtle" color="neutral">
				{{ app.name.toUpperCase() }}
			</UBadge>
			<UBadge variant="subtle" color="success">
				v{{ app.version }}
			</UBadge>
		</div>
	</div>
</template>

<script setup lang="ts">
	import type { NavigationMenuItem } from "@nuxt/ui";

	withDefaults(defineProps<{
		/** 收起态（icon 模式）：隐藏搜索/版本，导航菜单变纯图标 + tooltip/popover */
		collapsed?: boolean
	}>(), {
		collapsed: false
	});

	const { navigation } = useNavigation();
	const { app } = useAppConfig();

	// 一键展开/折叠所有分组：改写 defaultOpen 并强制重挂载（UNavigationMenu 的 defaultOpen 仅首次 mount 读取）
	const expandOverride = ref<boolean | null>(null);
	const navKey = ref(0);

	const route = useRoute();

	// 分组根路由无 to（点击只负责展开/收起），故按子路由前缀判定当前页面所属分组
	const isActiveGroup = (item: NavigationMenuItem): boolean =>
		!!item.children?.some((child) =>
			typeof child.to === "string" && (route.path === child.to || route.path.startsWith(`${child.to}/`))
		);

	const navItems = computed(() =>
		navigation.value.map((item) => {
			if (item.children?.length) {
				// true = 全部展开；否则（含初始态）仅展开当前页面所属分组
				return { ...item, defaultOpen: expandOverride.value === true || isActiveGroup(item) };
			}
			return item;
		})
	);

	function toggleMenu(): void {
		expandOverride.value = expandOverride.value !== true;
		navKey.value++;
	}

	// 路由切换时强制重挂载导航菜单，让 defaultOpen 重新生效（UNavigationMenu 仅首次 mount 读取 defaultOpen）
	watch(() => route.path, () => {
		navKey.value++;
	});
</script>
