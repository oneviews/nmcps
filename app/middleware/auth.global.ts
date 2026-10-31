/**
 * 全局登录守卫（`NMCPS-ARCH-003` §7.6）：系统不提供匿名浏览。
 *
 * - 白名单只有落地页 `/`（下载页）与 `/auth/**`（登录页），其余页面未登录一律送回登录页；
 * - 判据唯一：只认 `GET /api/auth/session`（`fetchSession()` 自带缓存），不读 cookie、不解析令牌；
 * - 已登录仍访问登录页时直接回跳，避免二次登录；
 * - BFF 才是鉴权关口（`401 bff_auth_required`），这里只负责导航。
 */
const PUBLIC_PATHS = new Set(["/"]);
const PUBLIC_PREFIXES = ["/auth/"];

const DEFAULT_LANDING = "/dashboard/overview";

function isPublicPath(path: string): boolean {
	return PUBLIC_PATHS.has(path) || PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/** 只接受站内相对路径，防止 `?redirect=https://evil.example` 被用作开放跳转 */
function safeRedirect(value: unknown): string {
	return typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
		? value
		: DEFAULT_LANDING;
}

export default defineNuxtRouteMiddleware(async (to) => {
	const { fetchSession, isAuthenticated } = useAuth();

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
