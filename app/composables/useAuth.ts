import type { ApiResponse } from "~~/shared/types/api";
import type {
	AuthLoginPayload,
	AuthLoginResult,
	AuthRefreshResult,
	AuthSessionState,
	AuthUser
} from "~~/shared/types/auth";
import { isSuccessResponse } from "~~/shared/utils/apiGuard";

/**
 * 会话状态与认证动作（Web / 桌面共用）。
 *
 * 单一事实源：`/api/auth/session`（Web 由 `nmcps_ui` cookie 派生，桌面端由本地身份缓存派生；
 * 新代无 `whoami`，NMCPS-ADR-0018 D3）。前端只读 `authenticated` 判定登录态，
 * 不解析令牌、不看 cookie。cookie / 单飞 / CSRF 条款见 NMCPS-ADR-0011。
 */

const SESSION_STATE_KEY = "auth.session";
const SESSION_LOADED_KEY = "auth.loaded";

const ANONYMOUS: AuthSessionState = { authenticated: false, user: null };

/**
 * 401 后的单飞刷新：并发请求共享同一次 refresh。
 * 新代刷新不轮换（NMCPS-ADR-0018 D4），但单飞仍必要 —— 别让十个请求同时打上游。
 */
let refreshPromise: Promise<boolean> | null = null;

function bffBase(): string {
	const config = useRuntimeConfig();
	return String(config.public.bffBase ?? "").replace(/\/+$/, "");
}

function resetSessionState(): void {
	useState<AuthSessionState>(SESSION_STATE_KEY, () => ({ ...ANONYMOUS })).value = { ...ANONYMOUS };
}

async function performRefresh(): Promise<boolean> {
	const { isDesktop, read, write, clear } = useAuthTokens();

	let body: Record<string, unknown> | undefined;

	if (isDesktop) {
		const tokens = await read();
		if (!tokens?.refresh_token) {
			resetSessionState();
			return false;
		}
		// snake_case 直传：上游 `POST /iam/refresh` 只认这个字段名
		body = { refresh_token: tokens.refresh_token };
	}

	try {
		const res = await $fetch<ApiResponse<AuthRefreshResult>>("/api/auth/refresh", {
			baseURL: bffBase(),
			method: "POST",
			body,
			headers: { "x-nmcps-client": isDesktop ? "desktop" : "web" },
			credentials: "include"
		});

		if (!isSuccessResponse(res)) {
			if (isDesktop)
				await clear();
			resetSessionState();
			return false;
		}

		if (res.data?.tokens)
			await write(res.data.tokens);

		return true;
	} catch {
		// 刷新失败即为会话终结：清掉桌面端令牌并广播未登录，调用方不再重试
		if (isDesktop)
			await clear();
		resetSessionState();
		return false;
	}
}

/**
 * 刷新访问令牌（单飞）。返回 `true` 表示可重试原请求。
 *
 * 只在业务请求收到 401 时调用：上游不轮换刷新令牌（D4），但仍不做预刷新 ——
 * 定时续期会在会话已失效时反复触发上游错误，收益为零。
 */
export function refreshAuthSession(): Promise<boolean> {
	refreshPromise ??= performRefresh().finally(() => {
		refreshPromise = null;
	});

	return refreshPromise;
}

export function useAuth() {
	const session = useState<AuthSessionState>(SESSION_STATE_KEY, () => ({ ...ANONYMOUS }));
	const loaded = useState<boolean>(SESSION_LOADED_KEY, () => false);
	const loading = useState<boolean>("auth.loading", () => false);
	const { isDesktop, read, write, writeUser, readUser, clear } = useAuthTokens();
	const api = useApi();

	let inflight: Promise<AuthSessionState> | null = null;

	const user = computed<AuthUser | null>(() => session.value.user);
	const isAuthenticated = computed(() => session.value.authenticated);
	/** 展示名：上游给 `display_name`，缺失回落登录名 */
	const displayName = computed(() => user.value?.displayName ?? user.value?.username ?? "");
	/**
	 * 平台级身份（近似）：新代没有 `accountLevel`（NMCPS-ADR-0018 缺口 G1），
	 * 只剩 `user_info.tenant_id` —— `null` 即平台级账号。角色化判定留待 C4 随角色接口落地，
	 * 这里宁可给出一个可解释的近似，也不伪造等级。
	 */
	const isSuperAdmin = computed(() => user.value?.tenantId === null);

	function apply(state: AuthSessionState): AuthSessionState {
		session.value = state;
		loaded.value = true;
		return state;
	}

	/** 读取会话（带缓存；`force` 用于登录后/手动刷新） */
	async function fetchSession(force = false): Promise<AuthSessionState> {
		if (!force && loaded.value)
			return session.value;

		if (inflight)
			return inflight;

		loading.value = true;

		inflight = (async () => {
			try {
				if (isDesktop) {
					// 桌面端没有 cookie：身份来自登录时缓存的 `user_info`（无 whoami，D3）
					const [tokens, cached] = await Promise.all([read(), readUser()]);

					if (tokens && cached)
						return apply({ authenticated: true, user: cached });

					// 令牌过期时先刷新一次再读身份
					if (tokens && await refreshAuthSession()) {
						const refreshedUser = await readUser();
						if (refreshedUser)
							return apply({ authenticated: true, user: refreshedUser });
					}

					return apply({ ...ANONYMOUS });
				}

				const state = await api.get<AuthSessionState>("/api/auth/session");
				return apply(state.authenticated ? state : { ...ANONYMOUS });
			} catch {
				// 网络 / 上游故障不改变当前判定，避免误踢已登录用户
				return session.value;
			} finally {
				loading.value = false;
				inflight = null;
			}
		})();

		return inflight;
	}

	async function login(payload: AuthLoginPayload): Promise<AuthLoginResult> {
		const result = await api.post<AuthLoginResult>("/api/auth/login", payload, {
			headers: isDesktop ? { "x-nmcps-client": "desktop" } : undefined,
			auth: false
		});

		if (result.tokens)
			await write(result.tokens);

		if (isDesktop)
			await writeUser(result.user);

		apply({ authenticated: true, user: result.user });

		return result;
	}

	async function logout(): Promise<void> {
		try {
			await api.post("/api/auth/logout", undefined, { auth: true });
		} catch {
			// 登出以本地清理为准：BFF 恒返回 ok，网络故障也不阻塞退出
		}

		await clear();
		apply({ ...ANONYMOUS });
	}

	/** 改密（上游字段为 snake_case；成功后会话是否失效上游未确认，故不主动登出） */
	async function changePassword(newPassword: string, oldPassword?: string): Promise<void> {
		await api.post("/api/auth/password", { new_password: newPassword, old_password: oldPassword });
	}

	return {
		session,
		user,
		isAuthenticated,
		isSuperAdmin,
		displayName,
		loading,
		/** 会话是否已问过（页面可用于避免首屏闪「未登录」） */
		loaded,
		fetchSession,
		login,
		logout,
		changePassword,
		/** 桌面端标识（Web 为 false） */
		isDesktop
	};
}

/**
 * 判断上游/BFF 是否以「未认证」拒绝：`401`（HTTP 语义）、`40101`（未认证）或
 * `10007`（无效的认证令牌，实测 `POST /iam/refresh` 走 `HTTP 200 + 该码`）。
 * 旧代的 `10201` / `20205` 已随旧网关退役（NMCPS-ADR-0018 §4.1）。
 */
export function isUnauthorizedCode(code: number): boolean {
	return code === 401 || code === 40101 || code === 10007;
}
