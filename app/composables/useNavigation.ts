import type { BreadcrumbItem, NavigationMenuItem } from "@nuxt/ui";
import type { RouteRecordNormalized } from "vue-router";
import { isTauri } from "@tauri-apps/api/core";

/** 导航分组键：同一 `group` 的路由在侧栏聚合成一个无 `to` 的父项 */
type NavigationGroup = "platform";

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
		/** 导航分组键：不单独占顶层位，聚合到同名分组下（设计基准：`NMCPS-ARCH-005`） */
		group?: NavigationGroup
		/** 仅 Tauri 宿主（桌面 / 移动包）显示；浏览器下不进导航 */
		tauriOnly?: boolean
	}
}

/** 分组父项的图标与排序（分组本身不是路由，故不写在页面 meta 里） */
const GROUP_ICONS: Record<NavigationGroup, string> = { platform: "carbon:layers" };
const GROUP_SORTS: Record<NavigationGroup, number> = { platform: 90 };

export const useNavigation = () => {
	const router = useRouter();
	const route = useRoute();
	const { t } = useI18n();

	/** `isTauri()` 只代表宿主类型，取不到时按浏览器处理（预览 / 测试环境） */
	const isTauriHost = (): boolean => {
		try {
			return isTauri();
		} catch {
			return false;
		}
	};

	/** 判定某路由是否应进入导航（有 name、有 sort、未 hide，非 index/all 兜底页，且宿主可见） */
	const isNavItem = (r: RouteRecordNormalized): boolean =>
		!!r.name
		&& r.name !== "index"
		&& r.name !== "all"
		&& typeof r.meta.sort === "number"
		&& !r.meta.hide
		&& (!r.meta.tauriOnly || isTauriHost());

	const bySort = (a: RouteRecordNormalized, b: RouteRecordNormalized) =>
		(a.meta.sort ?? 999) - (b.meta.sort ?? 999);

	/**
	 * 页面标题：优先页面自声明的 i18n 键（`meta.name`，如 `pages.os.title`），
	 * 否则按路由名约定取 `pages.<routeName>.title`。
	 * 探针页用 `definePageMeta({ name })` 覆盖了路由名，故不能只按 route name 拼键。
	 */
	const titleOf = (r: RouteRecordNormalized): string =>
		typeof r.meta.name === "string" ? t(r.meta.name) : t(`pages.${String(r.name)}.title`);

	const toItem = (r: RouteRecordNormalized): NavigationMenuItem => ({
		label: titleOf(r),
		icon: r.meta.icon,
		to: r.path
	});

	/** 侧边栏导航树：由路由表自动生成（一级模块按 sort 排序，子路由递归挂载，分组聚合为虚拟父项） */
	const navigation = computed<NavigationMenuItem[]>(() => {
		const routes = router.getRoutes().filter(isNavItem);

		const topLevel = routes
			.filter((r) => !r.meta.group && /^\/[^/]+$/.test(r.path))
			.sort(bySort);

		const entries = topLevel.map((parent) => {
			const children = routes
				.filter((r) => !r.meta.group && r.path.startsWith(`${parent.path}/`))
				.sort(bySort);

			// 根路由（有子路由）：去掉 to，点击只负责展开/收起子菜单，不导航到根路由页面
			if (children.length > 0) {
				const item = toItem(parent);
				delete item.to;
				return { sort: parent.meta.sort ?? 999, item: { ...item, children: children.map(toItem) } };
			}

			return { sort: parent.meta.sort ?? 999, item: toItem(parent) };
		});

		// 分组：同一 group 的扁平路由聚合成一个虚拟父项（无 to），组内按 sort 排序
		const groups = new Map<NavigationGroup, RouteRecordNormalized[]>();

		for (const r of routes) {
			if (!r.meta.group)
				continue;

			const members = groups.get(r.meta.group) ?? [];
			members.push(r);
			groups.set(r.meta.group, members);
		}

		for (const [group, members] of groups) {
			entries.push({
				sort: GROUP_SORTS[group] ?? 900,
				item: {
					label: t(`pages.${group}.title`),
					icon: GROUP_ICONS[group],
					children: members.sort(bySort).map(toItem)
				}
			});
		}

		return entries.sort((a, b) => a.sort - b.sort).map(({ item }) => item);
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
			label: titleOf(m),
			icon: m.meta.icon,
			...(index < matched.length - 1 ? { to: defaultChildPath(m) ?? m.path } : {})
		}));
	});

	return {
		navigation,
		breadcrumb
	};
};
