/**
 * 全局登录守卫（`NMCPS-ARCH-003` §7.6）：系统不提供匿名浏览。
 *
 * - 白名单只剩 `/auth/**`（登录页与改密页），其余页面未登录一律送回登录页；
 * - 根路径 `/` 没有页面（`NMCPS-ADR-0016`）：冷启动由 `routeRules` 302 到登录页，
 *   站内跳回 `/` 走到这里按登录态分流 —— 已登录回落地页，未登录去登录页；
 * - 判据唯一：只认 `GET /api/auth/session`（`fetchSession()` 自带缓存），不读 cookie、不解析令牌；
 * - 已登录仍访问登录页时直接回跳，避免二次登录；
 * - BFF 才是鉴权关口（`401 bff_auth_required`），这里只负责导航。
 */
const PUBLIC_PREFIXES = ["/auth/"];

const DEFAULT_LANDING = "/dashboard/overview";

function isPublicPath(path: string): boolean {
	return PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/** 只接受站内相对路径，防止 `?redirect=https://evil.example` 被用作开放跳转 */
function safeRedirect(value: unknown): string {
	return typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
		? value
		: DEFAULT_LANDING;
}

export default defineNuxtRouteMiddleware(async (to) => {
	const { fetchSession, isAuthenticated } = useAuth();

	// `/` 不是页面，只是入口：站内链接（404 页的「返回首页」、手输地址）按登录态分流，
	// 冷启动的 HTTP 302 由 `nuxt.config.ts` 的 routeRules 兜住（NMCPS-ADR-0016）
	if (to.path === "/") {
		await fetchSession();

		return navigateTo(
			isAuthenticated.value ? DEFAULT_LANDING : { path: "/auth/login" },
			{ replace: true }
		);
	}

	if (!isPublicPath(to.path)) {
		await fetchSession();

		if (!isAuthenticated.value) {
			return navigateTo({
				path: "/auth/login",
				query: { redirect: to.fullPath }
			});
		}

		return;
	}

	// 公开区里只有登录页需要反向检查：已登录就没必要再看登录表单
	if (to.path !== "/auth/login")
		return;

	await fetchSession();

	if (isAuthenticated.value)
		return navigateTo(safeRedirect(to.query.redirect));
});
