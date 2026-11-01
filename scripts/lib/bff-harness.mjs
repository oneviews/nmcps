// scripts/lib/bff-harness.mjs
// 自查脚本共用的本地脚手架：拉起 `.output/server/index.mjs`（BFF）与一个假上游。
// 前置：`pnpm build:server` —— 本模块只消费构建产物，不自行构建。
// 使用方：`scripts/check-bff.mjs`（纯 HTTP 契约）、`scripts/check-ui.mjs`（浏览器端到端）。
import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

export const SERVER_ENTRY = ".output/server/index.mjs";
export const HOST = "127.0.0.1";

const START_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 5_000;

/** 进程内申请一个空闲端口，避免与 dev server / 已部署实例冲突 */
export async function freePort() {
	const probe = createNetServer();
	await new Promise((resolve, reject) => {
		probe.once("error", reject);
		probe.listen(0, HOST, resolve);
	});
	const { port } = probe.address();
	await new Promise((resolve) => probe.close(resolve));
	return port;
}

/** 拉起构建产物（BFF），就绪判据为 `GET /health` */
export async function startBff(port, env) {
	let output = "";
	const child = spawn(process.execPath, [SERVER_ENTRY], {
		env: {
			...process.env,
			NODE_ENV: "production",
			HOST,
			PORT: String(port),
			NO_PROXY: `${HOST},localhost`,
			no_proxy: `${HOST},localhost`,
			...env
		},
		stdio: ["ignore", "pipe", "pipe"]
	});

	child.stdout.on("data", (chunk) => {
		output += chunk;
	});
	child.stderr.on("data", (chunk) => {
		output += chunk;
	});

	const deadline = Date.now() + START_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (child.exitCode !== null)
			throw new Error(`BFF 进程提前退出（code=${child.exitCode}）\n${output}`);
		try {
			const res = await fetch(`http://${HOST}:${port}/health`);
			if (res.ok)
				return child;
		} catch {
			// 端口尚未监听，继续等
		}
		await delay(200);
	}

	child.kill("SIGKILL");
	throw new Error(`BFF 未在 ${START_TIMEOUT_MS}ms 内就绪\n${output}`);
}

export async function stopBff(child) {
	if (!child || child.exitCode !== null)
		return;
	child.kill("SIGTERM");
	const deadline = Date.now() + STOP_TIMEOUT_MS;
	while (child.exitCode === null && Date.now() < deadline)
		await delay(50);
	if (child.exitCode === null)
		child.kill("SIGKILL");
}

/** 关闭假上游：先销毁 keep-alive 连接，避免探针用例留下挂起的 socket 拖住 close */
export async function closeUpstream(server) {
	server.closeAllConnections?.();
	await new Promise((resolve) => server.close(resolve));
}

/**
 * 假上游：覆盖裸 JSON、已是信封、业务错误、慢响应、Header 回显、健康探针与 SSE 流。
 * `/auth/*` 模拟新建 iam 服务（信封为 `{ code, msg, data }`）：登录签发 `at-N` / `rt-N`，
 * `whoami` 只认签发过的访问令牌 —— 浏览器自查靠它走完「登录 → 会话 → 自助安全设置」全流程。
 */
export async function startUpstream(port) {
	/**
	 * 认证相关状态：验证刷新轮换、登出不幂等（第二次返回 401 10201）。
	 *
	 * `refreshConcurrency` 是「并发窗口」开关，默认关闭＝严格单次消费（模拟串行复用）。
	 * 打开后同一 refresh 可被重复使用 —— 这是**真实上游当前的行为**（2026-10-31 实测：
	 * 同一 RT 三路并发全部 200，各自产出不同 sessionId，见 NMCPS-REC-001 UP-AUTH-01）。
	 * 假上游默认仍走严格单次消费，让串行用例保持确定性；并发用例显式打开开关，
	 * 等上游修成原子消费后，那条用例会变红，提示同步文档。
	 */
	const authLog = { login: 0, refresh: 0, logout: [], mfaBind: [], mfaConfirm: [], password: [], issuedAccess: new Set(), revokedAccess: new Set(), usedRefresh: new Set(), refreshConcurrency: false, seq: 0 };

	/**
	 * 账号口令是**可变**的：改密真的落库、重登真的校验（默认口令 `p@ssw0rd`）。
	 *
	 * 之前假上游把 `reset-user` 的 `mustResetPassword` 固定成 `true`、改密也不改库，
	 * 于是「改密后新口令能重登且不再被弹回」「旧口令被拒」这两条根本写不出来 ——
	 * 真实上游改密后会清标志并让旧口令失效（2026-10-31 评审发现）。
	 * 只有 `reset-user` 初始带强制改密标志，其余账号按普通账号处理。
	 */
	const DEFAULT_PASSWORD = "p@ssw0rd";
	const accounts = new Map();
	const accountOf = (name) => {
		if (!accounts.has(name))
			accounts.set(name, { password: DEFAULT_PASSWORD, mustResetPassword: name === "reset-user" });
		return accounts.get(name);
	};
	/** 令牌归属账号：`whoami` 与改密都按令牌判身份，不再一律回 `alice` */
	const tokenAccount = new Map();

	/**
	 * 账号域假数据（`GET /account`、`POST /account`、`PUT /account/{code}/status`）：给
	 * `/system/user` 两栏自查（NMCPS-ARCH-006 §3 / NMCPS-ADR-0017）用 —— 列表要对 `keyword` /
	 * `status` / `accountLevel` 真有筛选效果、`total` 要能分页，否则「深链选中 `?id`」与
	 * 「`?id` 不在当前结果内」两条用例都测不出真伪。
	 */
	const accountRecords = [
		{ accountId: 1, accountCode: "ACC-1001", accountName: "alice", displayName: "Alice", accountLevel: 1, status: 1, mfaEnabled: true, createdAt: "2026-10-01 09:00:00" },
		{ accountId: 2, accountCode: "ACC-1002", accountName: "bob", displayName: "Bob", accountLevel: 1, status: 2, mfaEnabled: false, createdAt: "2026-10-02 10:00:00" },
		{ accountId: 3, accountCode: "ACC-1003", accountName: "carol", displayName: "Carol", accountLevel: 1, status: 3, mfaEnabled: false, createdAt: "2026-10-03 11:00:00" }
	];

	/** 读并解析请求体（每个请求只能读一次：账号域与 `/auth/*` 各自在分支内调用） */
	async function readJsonBody(req) {
		let raw = "";
		for await (const chunk of req)
			raw += chunk;
		try {
			return raw ? JSON.parse(raw) : undefined;
		} catch {
			return undefined;
		}
	}

	/**
	 * 「运行中掉线」开关：`POST /__control/down` 后除控制端点外的请求一律直接销毁 socket，
	 * 让 BFF 侧表现为网络错误（502 `bff_upstream_unreachable`），而不是上游 5xx。
	 * 用于「已登录 → 上游掉线 → 操作给出修复指引」这类只能运行中构造的场景。
	 */
	const control = { down: false };

	const server = createHttpServer(async (req, res) => {
		const url = new URL(req.url ?? "/", `http://${HOST}:${port}`);
		const send = (status, payload) => {
			res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
			res.end(JSON.stringify(payload));
		};

		if (url.pathname === "/__control/down") {
			control.down = true;
			return send(200, { down: true });
		}
		if (url.pathname === "/__control/up") {
			control.down = false;
			return send(200, { down: false });
		}
		if (url.pathname === "/__control/state")
			return send(200, { down: control.down });
		if (url.pathname === "/__control/auth-concurrency") {
			authLog.refreshConcurrency = url.searchParams.get("allow") === "1";
			return send(200, { refreshConcurrency: authLog.refreshConcurrency });
		}

		if (control.down) {
			req.socket.destroy();
			return;
		}

		if (url.pathname === "/health")
			return send(200, { status: "ok" });
		if (url.pathname === "/unready/health")
			return send(503, { status: "starting" });
		if (url.pathname === "/hang-health") {
			// 就绪探针超时用例：永远拖到客户端超时
			await delay(5_000);
			return send(200, { status: "ok" });
		}

		// ── /account*：账号域（`/system/user` 两栏自查；BFF 网关透传路径可能带 `/api/v1` 前缀） ──
		const accountPath = url.pathname.match(/^\/(?:api\/v1\/)?account(\/.*)?$/);
		if (accountPath) {
			const rest = accountPath[1] ?? "";
			const statusMatch = rest.match(/^\/([^/]+)\/status$/);

			if (statusMatch && req.method === "PUT") {
				const body = await readJsonBody(req);
				const record = accountRecords.find((item) => item.accountCode === decodeURIComponent(statusMatch[1]));

				if (!record)
					return send(404, { code: 10404, msg: "account_not_found" });
				// 与真实上游一致：`0` / `5` 等非法值报 10101
				if (![1, 2, 3, 4].includes(body?.status))
					return send(400, { code: 10101, msg: "status_invalid" });

				record.status = body.status;
				return send(200, { code: 0, msg: "success", data: { ok: true } });
			}

			if (rest === "" && req.method === "GET") {
				const keyword = (url.searchParams.get("keyword") ?? "").trim().toLowerCase();
				const status = Number(url.searchParams.get("status") ?? 0);
				const level = url.searchParams.get("accountLevel");
				const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
				const pageSize = Math.max(1, Number(url.searchParams.get("pageSize") ?? 20));

				const filtered = accountRecords.filter((item) => {
					const matchedKeyword = !keyword
						|| item.accountName.toLowerCase().includes(keyword)
						|| item.displayName.toLowerCase().includes(keyword);

					// `status: 0` 与 `accountLevel: 0` 上游会当「未提供」（NMCPS-REC-002 UP-ACC-02）
					return matchedKeyword
						&& (!status || item.status === status)
						&& (level === null || item.accountLevel === Number(level));
				});

				const start = (page - 1) * pageSize;
				return send(200, {
					code: 0,
					msg: "success",
					data: { list: filtered.slice(start, start + pageSize), total: filtered.length, page, pageSize }
				});
			}

			if (rest === "" && req.method === "POST") {
				const body = await readJsonBody(req);

				// 与真实上游一致：缺必填字段直接 500 / 10509（UP-ACC-03）
				if (!body?.accountName || !body?.displayName || !body?.password || body?.accountLevel === undefined)
					return send(500, { code: 10509, msg: "invalid request" });
				if (accountRecords.some((item) => item.accountName === body.accountName))
					return send(400, { code: 10302, msg: "account_name_duplicated" });

				const record = {
					accountId: accountRecords.length + 1,
					accountCode: `ACC-${1001 + accountRecords.length}`,
					accountName: body.accountName,
					displayName: body.displayName,
					accountLevel: body.accountLevel,
					// 带 `mustResetPassword` 的建号落「待激活」，与上游一致
					status: body.mustResetPassword ? 4 : 1,
					mfaEnabled: !!body.mfaEnabled,
					createdAt: new Date().toISOString().slice(0, 19).replace("T", " ")
				};
				accountRecords.push(record);
				return send(200, { code: 0, msg: "success", data: record });
			}

			return send(404, { code: 10404, msg: "account_path_not_found" });
		}

		// ── /auth/*：模拟新建 iam 服务（信封为 `{ code, msg, data }`） ──
		if (url.pathname.startsWith("/auth/")) {
			let raw = "";
			for await (const chunk of req)
				raw += chunk;
			let body;
			try {
				body = raw ? JSON.parse(raw) : undefined;
			} catch {
				body = undefined;
			}

			const bearer = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
			const nextTokens = (accountName = "alice") => {
				authLog.seq += 1;
				const tokens = { accessToken: `at-${authLog.seq}`, refreshToken: `rt-${authLog.seq}`, expiresIn: 1800, sessionId: `s-${authLog.seq}` };
				authLog.issuedAccess.add(tokens.accessToken);
				tokenAccount.set(tokens.accessToken, accountName);
				tokenAccount.set(tokens.refreshToken, accountName);
				return tokens;
			};

			if (url.pathname === "/auth/login") {
				authLog.login += 1;
				// 与真实上游一致：空 body 直接 500 / 10509（BFF 必须挡在前面）
				if (!body?.accountName || !body?.password)
					return send(500, { code: 10509, msg: "invalid request" });
				if (body.accountName === "mfa-user") {
					// 真实上游：MFA 账号不带动态口令 → `401 20203`，带错码 → `401 20204`，带对 → 200
					if (body.mfaCode === "123456")
						return send(200, { code: 0, msg: "success", data: nextTokens("mfa-user") });
					return body.mfaCode
						? send(401, { code: 20204, msg: "动态验证码错误" })
						: send(401, { code: 20203, msg: "需要多因子验证码" });
				}
				// 真实上游：口令错 → `401 20201`（与「账号不存在」同码，不泄露账号是否存在）
				const account = accountOf(body.accountName);
				if (body.password !== account.password)
					return send(401, { code: 20201, msg: "账号或密码错误" });
				// `mustResetPassword: true` 的账号登录成功但带标志，接口不拦（强制改密是纯前端约定）；改密后置 false
				return send(200, { code: 0, msg: "success", data: { ...nextTokens(body.accountName), mustResetPassword: account.mustResetPassword } });
			}

			if (url.pathname === "/auth/token/refresh") {
				authLog.refresh += 1;
				const token = body?.refreshToken;
				// 未知令牌 → 10201；已用过的令牌 → 20205（真实上游串行复用的形态）
				if (!token)
					return send(401, { code: 10201, msg: "未认证或登录态已失效" });
				// 刷新即轮换：旧 refresh 失效；`refreshConcurrency` 打开时模拟真实上游的并发窗口
				if (authLog.usedRefresh.has(token) && !authLog.refreshConcurrency)
					return send(401, { code: 20205, msg: "会话已失效" });
				authLog.usedRefresh.add(token);
				// 刷新保持账号归属：`whoami` 之后仍要认出是哪个账号
				return send(200, { code: 0, msg: "success", data: nextTokens(tokenAccount.get(token) ?? "alice") });
			}

			if (url.pathname === "/auth/whoami") {
				// 只认签发过且未注销的访问令牌，模拟「会话失效 → 401 / 10201」
				if (!authLog.issuedAccess.has(bearer) || authLog.revokedAccess.has(bearer))
					return send(401, { code: 10201, msg: "session_expired" });
				return send(200, {
					code: 0,
					msg: "success",
					data: { accountCode: "acc-1", accountName: tokenAccount.get(bearer) ?? "alice", displayName: "Alice", tenantId: 7, accountLevel: 2, mfaEnabled: true, sessionId: "s-1" }
				});
			}

			if (url.pathname === "/auth/logout") {
				authLog.logout.push({ authorization: req.headers.authorization ?? null, contentType: req.headers["content-type"] ?? null, bodyLength: raw.length });
				// 登出不幂等：令牌已注销 → 401 / 10201
				if (!authLog.issuedAccess.has(bearer) || authLog.revokedAccess.has(bearer))
					return send(401, { code: 10201, msg: "session_expired" });
				authLog.revokedAccess.add(bearer);
				return send(200, { code: 0, msg: "success", data: null });
			}

			if (url.pathname === "/auth/mfa/bind") {
				authLog.mfaBind.push({ authorization: req.headers.authorization ?? null, mfaType: body?.mfaType ?? null });
				if (!authLog.issuedAccess.has(bearer) || authLog.revokedAccess.has(bearer))
					return send(401, { code: 10201, msg: "session_expired" });
				// mfaType=2（生物识别，预留）上游返回空 data：BFF 必须识别为契约违约
				if (body?.mfaType === 2)
					return send(200, { code: 0, msg: "success", data: {} });
				return send(200, { code: 0, msg: "success", data: { otpauthUrl: "otpauth://totp/NMCPS:alice?secret=JBSWY3DPEHPK3PXP&issuer=NMCPS" } });
			}

			if (url.pathname === "/auth/mfa/confirm") {
				authLog.mfaConfirm.push(body ?? null);
				if (!authLog.issuedAccess.has(bearer) || authLog.revokedAccess.has(bearer))
					return send(401, { code: 10201, msg: "session_expired" });
				if (body?.mfaCode !== "123456")
					return send(400, { code: 20204, msg: "mfa_code_invalid" });
				return send(200, { code: 0, msg: "success", data: null });
			}

			if (url.pathname === "/auth/password") {
				authLog.password.push(body ?? null);
				if (!authLog.issuedAccess.has(bearer) || authLog.revokedAccess.has(bearer))
					return send(401, { code: 10201, msg: "session_expired" });
				// 与真实上游一致：缺字段直接 500 / 10509（BFF 必须挡在前面）
				if (!body?.oldPassword || !body?.newPassword)
					return send(500, { code: 10509, msg: "invalid request" });
				// 按令牌判账号：改密只影响自己的口令，不串号
				const accountName = tokenAccount.get(bearer);
				const account = accountName ? accountOf(accountName) : null;
				if (!account || body.oldPassword !== account.password)
					return send(400, { code: 20201, msg: "old_password_invalid" });
				// 真实上游：改密真的落库 —— 新口令立刻可登录、旧口令失效，同时清掉强制改密标志
				account.password = body.newPassword;
				account.mustResetPassword = false;
				return send(200, { code: 0, msg: "success", data: null });
			}

			return send(404, { code: 10404, msg: "auth_path_not_found" });
		}

		if (url.pathname === "/device/ok")
			return send(200, { id: "dev-1", name: "ok" });
		if (url.pathname === "/device/envelope")
			return send(200, { code: 0, status: "success", message: "success", data: { ok: true } });
		if (url.pathname === "/device/error")
			return send(400, { message: "device_not_found" });
		if (url.pathname === "/device/slow") {
			await delay(3_000);
			return send(200, { id: "slow" });
		}
		if (url.pathname === "/device/echo") {
			return send(200, {
				authorization: req.headers.authorization ?? null,
				evil: req.headers["x-evil"] ?? null
			});
		}
		if (url.pathname === "/device/stream") {
			// 三个事件、间隔 150ms：用于验证网关是否边收边发（整体缓冲会只收到一块）
			res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" });
			for (let i = 0; i < 3; i++) {
				res.write(`data: tick-${i}\n\n`);
				await delay(150);
			}
			res.end();
			return;
		}

		return send(404, { message: "upstream_not_found" });
	});

	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, HOST, resolve);
	});

	server.authLog = authLog;
	server.control = control;

	return server;
}
