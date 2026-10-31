import type { ApiResponse } from "~~/shared/types/api";
import type {
	AuthLoginPayload,
	AuthLoginResult,
	AuthMfaBindResult,
	AuthRefreshResult,
	AuthSessionState,
	AuthUser
} from "~~/shared/types/auth";
import { AUTH_ACCOUNT_LEVEL } from "~~/shared/types/auth";
import { isSuccessResponse } from "~~/shared/utils/apiGuard";

/**
 * 会话状态与认证动作（Web / 桌面共用）。
 *
 * 单一事实源：`/api/auth/session`（服务端把上游 401 归成 200 + `authenticated:false`），
 * 前端只读 `authenticated` 判定登录态，不解析令牌、不看 cookie。
 * 裁决见 NMCPS-ADR-0011（layers/content/collections/cn/records/adr/adr-0011.md）。
 */

const SESSION_STATE_KEY = "auth.session";
const SESSION_LOADED_KEY = "auth.loaded";

const ANONYMOUS: AuthSessionState = { authenticated: false, user: null };

/** 401 后的单飞刷新：并发请求共享同一次 refresh（上游刷新即轮换，重复调用会互相踢下线） */
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
		if (!tokens?.refreshToken) {
			resetSessionState();
			return false;
		}
		body = { refreshToken: tokens.refreshToken };
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
 * 只在业务请求收到 401 时调用：上游每次刷新都会换 `sessionId` 并作废旧 AT，
 * 预刷新（定时/提前续期）会让并发请求拿着旧令牌互相踢下线。
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
	const { isDesktop, read, write, clear } = useAuthTokens();
	const api = useApi();

	let inflight: Promise<AuthSessionState> | null = null;

	const user = computed<AuthUser | null>(() => session.value.user);
	const isAuthenticated = computed(() => session.value.authenticated);
	/** 展示名：`displayName` 可能为 `null`（登录不返回），回落登录名 */
	const displayName = computed(() => user.value?.displayName ?? user.value?.accountName ?? "");
	const isSuperAdmin = computed(() => user.value?.accountLevel === AUTH_ACCOUNT_LEVEL.SUPER_ADMIN);

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
				if (isDesktop && !(await read())) {
					return apply({ ...ANONYMOUS });
				}

				const state = await api.get<AuthSessionState>("/api/auth/session");

				if (state.authenticated)
					return apply(state);

				// 桌面端：访问令牌过期时先刷新一次再问（web 由 BFF cookie 兜底）
				if (isDesktop && await refreshAuthSession()) {
					const retried = await api.get<AuthSessionState>("/api/auth/session");
					if (retried.authenticated)
						return apply(retried);
				}

				return apply({ ...ANONYMOUS });
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

	/** 改密（成功后会话是否失效上游未确认，故不主动登出） */
	async function changePassword(newPassword: string, oldPassword?: string): Promise<void> {
		await api.post("/api/auth/password", { newPassword, oldPassword });
	}

	/**
	 * 申请一次性 MFA 绑定凭证（会重置已有 TOTP 密钥，调用前须二次确认）。
	 * `otpauthUrl` 只用于当场展示，禁止落库 / 入日志。
	 */
	async function bindMfa(mfaType = 1): Promise<AuthMfaBindResult> {
		return api.post<AuthMfaBindResult>("/api/auth/mfa/bind", { mfaType });
	}

	/** 用绑定凭证对应的一次性口令完成绑定；成功后强制刷新会话，让 `mfaEnabled` 立即反映 */
	async function confirmMfa(mfaCode: string): Promise<void> {
		await api.post("/api/auth/mfa/confirm", { mfaCode });
		await fetchSession(true);
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
		bindMfa,
		confirmMfa,
		/** 桌面端标识（Web 为 false） */
		isDesktop
	};
}

/** 判断上游/BFF 是否以「未认证」拒绝（`401` 或 iam 业务码 `10201` / `20205`） */
export function isUnauthorizedCode(code: number): boolean {
	return code === 401 || code === 10201 || code === 20205;
}
