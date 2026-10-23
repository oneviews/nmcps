export const usePages = () => {
	const router = useRouter();
	const { pageCategories } = useAppConfig();
	const { t } = useI18n();

	const routes = router.getRoutes().filter((route) => route.name !== "index" && route.name !== "all");

	// computed：语言切换后导航菜单文案随之重算
	const pages = computed(() => {
		const categorizedRoutes = routes.reduce((acc, route) => {
			const category = route.meta.category as string || "other";

			if (!acc[category]) {
				acc[category] = {
					label: t(pageCategories[category as keyof typeof pageCategories]?.label || "nav.categories.other"),
					icon: pageCategories[category as keyof typeof pageCategories]?.icon || "i-carbon-folder",
					to: route.path,
					children: []
				};
			}

			acc[category].children.push({
				label: route.meta.name ? t(route.meta.name) : route.name,
				description: route.meta.description ? t(route.meta.description as string) : undefined,
				icon: route.meta.icon || "i-carbon-document",
				to: route.path
			});

			return acc;
		}, {} as Record<string, any>);

		return Object.values(categorizedRoutes);
	});

	return {
		pages
	};
};
