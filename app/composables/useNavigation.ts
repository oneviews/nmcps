import type { NavigationMenuItem } from "@nuxt/ui";
import type { RouteRecordNormalized } from "vue-router";

declare module "vue-router" {
	interface RouteMeta {
		/** 导航排序（越小越靠前；缺省则不进导航） */
		sort?: number
		/** 导航 / 面包屑图标（carbon 图标名） */
		icon?: string
		/** 是否从导航中隐藏 */
		hide?: boolean
	}
}

export const useNavigation = () => {
	const router = useRouter();
	const route = useRoute();
	const { t } = useI18n();

	/** 判定某路由是否应进入导航（有 name、有 sort、未 hide，且非 index/all 兜底页） */
	const isNavItem = (r: RouteRecordNormalized): boolean =>
		!!r.name
		&& r.name !== "index"
		&& r.name !== "all"
		&& typeof r.meta.sort === "number"
		&& !r.meta.hide;

	const bySort = (a: RouteRecordNormalized, b: RouteRecordNormalized) =>
		(a.meta.sort ?? 999) - (b.meta.sort ?? 999);

	const toItem = (r: RouteRecordNormalized): NavigationMenuItem => ({
		label: t(`pages.${String(r.name)}.title`),
		icon: r.meta.icon,
		to: r.path
	});

	/** 侧边栏导航树：由路由表自动生成（一级模块按 sort 排序，子路由递归挂载） */
	const navigation = computed<NavigationMenuItem[]>(() => {
		const routes = router.getRoutes();

		const topLevel = routes
			.filter((r) => isNavItem(r) && /^\/[^/]+$/.test(r.path))
			.sort(bySort);

		return topLevel.map((parent) => {
			const children = routes
				.filter((r) => isNavItem(r) && r.path.startsWith(`${parent.path}/`))
				.sort(bySort);

			return {
				...toItem(parent),
				...(children.length > 0 ? { children: children.map(toItem) } : {})
			};
		});
	});

	/** 面包屑：由当前路由 matched 生成，末项（当前页）不设链接 */
	const breadcrumb = computed(() => {
		const matched = route.matched.filter((m) => m.name && m.name !== "index" && m.name !== "all");

		return matched.map((m, index) => ({
			label: t(`pages.${String(m.name)}.title`),
			icon: m.meta.icon,
			...(index < matched.length - 1 ? { to: m.path } : {})
		}));
	});

	return {
		navigation,
		breadcrumb
	};
};
