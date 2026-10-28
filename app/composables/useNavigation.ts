import type { BreadcrumbItem, NavigationMenuItem } from "@nuxt/ui";
import type { RouteRecordNormalized } from "vue-router";

declare module "vue-router" {
	interface RouteMeta {
		/** 导航排序（越小越靠前；缺省则不进导航） */
		sort?: number
		/** 导航 / 面包屑图标（carbon 图标名） */
		icon?: string
		/** 是否从导航中隐藏 */
		hide?: boolean
		/** 文档详情页运行时注入的面包屑（含动态文档标题；存在时覆盖系统导航面包屑） */
		breadcrumb?: BreadcrumbItem[]
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

			// 根路由（有子路由）：去掉 to，点击只负责展开/收起子菜单，不导航到根路由页面
			if (children.length > 0) {
				const item = toItem(parent);
				delete item.to;
				return { ...item, children: children.map(toItem) };
			}

			return toItem(parent);
		});
	});

	/** 父级路由记录的「默认子页」路径：取首个 sort 最小且未 hide 的子路由（面包屑根路由点击跳转到默认子页） */
	function defaultChildPath(match: RouteRecordNormalized): string | undefined {
		const children = (match.children ?? []).filter((c) => c.meta && !c.meta.hide);
		if (children.length === 0)
			return undefined;
		const sorted = [...children].sort((a, b) => (Number(a.meta?.sort) ?? 999) - (Number(b.meta?.sort) ?? 999));
		const first = sorted[0];
		if (!first)
			return undefined;
		const childPath = first.path.startsWith("/") ? first.path : `${match.path}/${first.path}`;
		return childPath.replace(/\/+/g, "/");
	}

	/** 面包屑：由当前路由 matched 生成，末项（当前页）不设链接 */
	const breadcrumb = computed<BreadcrumbItem[]>(() => {
		// 文档详情页注入的面包屑（含动态文档标题）优先，覆盖系统导航面包屑
		if (route.meta.breadcrumb?.length)
			return route.meta.breadcrumb;

		// 只保留有 sort 的导航页，排除详情页（`[...slug]` 路由无 sort，且无对应 i18n 键）
		const matched = route.matched.filter((m) => m.name && m.name !== "index" && m.name !== "all" && typeof m.meta.sort === "number");

		return matched.map((m, index) => ({
			label: t(`pages.${String(m.name)}.title`),
			icon: m.meta.icon,
			...(index < matched.length - 1 ? { to: defaultChildPath(m) ?? m.path } : {})
		}));
	});

	return {
		navigation,
		breadcrumb
	};
};
