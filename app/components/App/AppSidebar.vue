<template>
	<div class="flex h-full w-full flex-col overflow-hidden">
		<!-- 第一层：路由搜索 + 菜单展开/收起（收起态隐藏） -->
		<div v-if="!collapsed" class="flex items-center gap-2 border-b border-(--ui-border) p-2">
			<UDashboardSearchButton
				class="min-w-0 flex-1"
				size="sm"
				:label="$t('layout.search')"
			/>
			<UButton
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
			<UBadge variant="subtle" color="neutral">
				v{{ app.version }}
			</UBadge>
		</div>
	</div>
</template>

<script setup lang="ts">
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

	// 当前页面根路由（一级导航组）的 to：折叠时保留该组展开
	const activeRootTo = computed(() => {
		const root = navigation.value.find((item) =>
			item.to && (route.path === item.to || route.path.startsWith(`${item.to}/`))
		);
		return root?.to ?? null;
	});

	const navItems = computed(() =>
		navigation.value.map((item) => {
			if (item.children?.length && expandOverride.value !== null) {
				// true = 全部展开；false = 折叠所有，但保留当前页面根路由展开
				const defaultOpen = expandOverride.value === true || item.to === activeRootTo.value;
				return { ...item, defaultOpen };
			}
			return item;
		})
	);

	function toggleMenu(): void {
		expandOverride.value = expandOverride.value !== true;
		navKey.value++;
	}
</script>
