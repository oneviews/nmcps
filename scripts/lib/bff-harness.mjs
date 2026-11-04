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
	 * 认证相关状态（新代 iam 口径，2026-11-04 实测）：
	 * - 登录签发 `at-N` + `rt-N`，`user_info` 随登录返回；
	 * - 刷新**不轮换**：同一刷新令牌可反复使用，且响应只给新访问令牌；
	 * - 登出**幂等**：重复调用仍 200 `code:0`。
	 *
	 * `reusedRefresh` 记录「刷新令牌被重复使用」的次数 —— 旧代的串行复用即失效语义
	 * （NMCPS-REC-001 UP-AUTH-01 / ADR-0011 轮换条款）已由 NMCPS-ADR-0018 D4 作废。
	 */
	const authLog = { login: 0, refresh: 0, reusedRefresh: 0, logout: [], password: [], issuedAccess: new Set(), revokedAccess: new Set(), seq: 0 };

	/**
	 * 账号口令是**可变**的：改密真的落库、重登真的校验（默认口令 `p@ssw0rd`）。
	 *
	 * 新代没有 `mfaRequired` / `mustResetPassword`（NMCPS-ADR-0018 缺口 G2/G8），
	 * 假上游也不再伪造这两个标志 —— 页面侧若还依赖它们，自检会红。
	 */
	const DEFAULT_PASSWORD = "p@ssw0rd";
	const accounts = new Map();
	const accountOf = (name) => {
		if (!accounts.has(name))
			accounts.set(name, { password: DEFAULT_PASSWORD });
		return accounts.get(name);
	};
	/** 访问令牌归属账号：改密按令牌判身份，不再一律回 `alice` */
	const tokenAccount = new Map();
	/** 刷新令牌归属账号：刷新后签发的访问令牌要继承同一身份 */
	const tokenUser = new Map();

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

	/**
	 * 会话身份等级：`admin` 是平台超级管理员（0），其余账号按租户管理员（1）处理 ——
	 * 照真实种子账号（`admin` / `tenantadmin`，见 `shared/constants/demoAccounts.ts`）。
	 *
	 * 这个字段决定 `/system/user` 建号表单的等级候选与是否出现「所属租户」，
	 * 写死成一个值（此前是 `2`）会让自查看不见两种身份的分支差异。
	 */
	const accountLevelOf = (accountName) => (accountName === "admin" ? 0 : 1);

	/** 租户域假数据（`GET /tenant`）：超级管理员建号时必须选 `tenantId`（NMCPS-REC-002 UP-ACC-07） */
	const tenantRecords = [
		{ tenantId: 1, tenantCode: "default", tenantName: "默认租户", description: "平台内置默认租户", status: 1, isDefault: true, createdAt: "2026-10-29 17:27:21" }
	];

	/**
	 * 审计域假数据（`GET /audit`、`GET /audit/{logCode}`）：给 `/system/log` 工具栏自查
	 * （`NMCPS-DESIGN-005` §9.3 第 2 条）用 —— `category` 要与真实上游一样**精确匹配**、
	 * 时间窗要按字面字符串比较，否则「切类别 / 选快捷区间后请求参数真的变了」这条用例测不出真伪。
	 *
	 * `eventTime` 保留上游的 RFC3339 形态（带偏移），比较前由 `auditEventKey()` 裁成
	 * `YYYY-MM-DD HH:MM:SS` —— 页面发出的正是这个格式（`toAuditTimeParam()`）。
	 */
	const auditRecords = [
		{ logCode: "AUD-0001", category: "session", accountId: 1, deviceCode: "", sessionId: "sess-1", traceId: "trace-1", action: "auth.login.success", resource: "auth", result: 1, clientIp: "10.0.0.1", eventTime: "2026-11-02T03:15:09+08:00", logHash: "hash-1" },
		{ logCode: "AUD-0002", category: "api", accountId: 1, deviceCode: "DEV-1001", sessionId: "sess-1", traceId: "trace-2", action: "GET /api/v1/device", resource: "/api/v1/device", result: 1, clientIp: "10.0.0.1", eventTime: "2026-11-02T03:20:00+08:00", logHash: "hash-2" },
		{ logCode: "AUD-0003", category: "api", accountId: 1, deviceCode: "DEV-1001", sessionId: "sess-2", traceId: "trace-3", action: "POST /api/v1/account", resource: "/api/v1/account", result: 2, clientIp: "10.0.0.1", eventTime: "2026-11-01T22:05:00+08:00", logHash: "hash-3" }
	];

	/** `2026-11-02T03:15:09+08:00` → `2026-11-02 03:15:09`（与页面发出的时间参数同格式） */
	const auditEventKey = (value) => value.replace("T", " ").slice(0, 19);

	/**
	 * 策略域假数据（`GET /role`、`GET /role/{roleCode}/permission`、`GET /permission`、
	 * `GET /abac/rule`）：给 `/system/permission`、`/system/policy` 的列表栏自查
	 * （`NMCPS-ARCH-006` §3.8 列表尾部落到四个列表页）用。
	 *
	 * 只提供「列表 + 授权矩阵」这一条读路径：页面能进列表态并渲染出尾部，
	 * 就不会因为资源未实现而 404 —— 否则「控制台零错误」断言会把假上游的缺口
	 * 误报成前端缺陷。
	 */
	const policyRoles = [
		{ roleId: 1, tenantId: 1, roleCode: "ROLE-ADMIN", roleName: "租户管理员", roleLevel: 1, isBuiltin: true, status: 1, description: "内置角色", createdAt: "2026-10-01 09:00:00" },
		{ roleId: 2, tenantId: 1, roleCode: "ROLE-OPS", roleName: "运维", roleLevel: 2, isBuiltin: false, status: 1, description: "自建角色", createdAt: "2026-10-02 10:00:00" }
	];

	const policyPermissions = [
		{ permissionId: 1, permCode: "asset:device:read", permName: "设备只读", resourceType: 1, resourcePath: "/api/v1/device/*", action: "read", fieldScope: "", status: 1 },
		{ permissionId: 2, permCode: "asset:device:write", permName: "设备写入", resourceType: 1, resourcePath: "/api/v1/device/*", action: "write", fieldScope: "", status: 1 },
		{ permissionId: 3, permCode: "system:account:read", permName: "账号只读", resourceType: 2, resourcePath: "/api/v1/account/*", action: "read", fieldScope: "", status: 1 }
	];

	const abacRules = [
		{ ruleId: 1, ruleCode: "RULE-IP", ruleName: "内网放行", roleCode: "", conditionDsl: "clientIp in ('10.0.0.0/8')", priority: 10, status: 1 },
		{ ruleId: 2, ruleCode: "RULE-HOUR", ruleName: "运维时段", roleCode: "ROLE-OPS", conditionDsl: "hour >= 9 && hour <= 18", priority: 20, status: 1 }
	];

	/** 分页信封：与审计域一致（`page` / `pageSize` 按请求原样回显） */
	const paged = (records, url) => {
		const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
		const pageSize = Math.max(1, Number(url.searchParams.get("pageSize") ?? 20));
		const start = (page - 1) * pageSize;
		return { list: records.slice(start, start + pageSize), total: records.length, page, pageSize };
	};

	/** 最近一次列表请求的查询串（自查看「控件真的改了请求」时可直接读） */
	const auditLog = { lastQuery: null };

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
				const creator = tokenAccount.get((req.headers.authorization ?? "").replace(/^Bearer\s+/i, "")) ?? "alice";
				const creatorLevel = accountLevelOf(creator);

				// 与真实上游一致：缺必填字段直接 500 / 10509（UP-ACC-03）
				if (!body?.accountName || !body?.displayName || !body?.password || body?.accountLevel === undefined)
					return send(500, { code: 10509, msg: "invalid request" });

				// UP-ACC-07：平台层身份必须显式带 tenantId（`0` 视同缺省）
				if (creatorLevel === 0 && !body.tenantId)
					return send(400, { code: 10101, msg: "缺少必填参数 tenantId" });

				// UP-ACC-01（已闭环）：只能向下管控 —— 同级或更高一律拒绝
				if (body.accountLevel <= creatorLevel)
					return send(403, { code: 20103, msg: "只能向下管控：不可操作与自身同级或更高权限的账号/角色" });

				// UP-ACC-08：`4` 是服务账号（系统开通），`> 4` 越界
				if (body.accountLevel === 4)
					return send(400, { code: 20102, msg: "账号等级与归属层不匹配：服务账号由系统自动开通" });
				if (body.accountLevel > 4)
					return send(400, { code: 10101, msg: "参数 accountLevel 取值应为 0-4" });

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

		// ── /tenant*：租户域（超级管理员建号时选归属租户；BFF 网关透传路径可能带 `/api/v1` 前缀） ──
		const tenantPath = url.pathname.match(/^\/(?:api\/v1\/)?tenant$/);
		if (tenantPath && req.method === "GET")
			return send(200, { code: 0, msg: "success", data: paged(tenantRecords, url) });

		// ── /iam/*：模拟新代 iam 服务（信封为 `{ code, message, data }`；2026-11-04 实测口径） ──
		if (url.pathname.startsWith("/iam/")) {
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
			/** 身份载荷：`user_info`（平台管理员 `tenant_id: null`，其余挂默认租户） */
			const userInfoOf = (username) => ({
				id: `u_${username}`,
				username,
				display_name: username === "admin" ? "平台管理员" : "Alice",
				email: `${username}@nms.local`,
				phone: "",
				tenant_id: username === "admin" ? null : "t_default"
			});
			/** 新的访问令牌；`refresh_token` 只在登录时签发（刷新不轮换，D4） */
			const issueAccess = (username = "alice") => {
				authLog.seq += 1;
				const tokens = { access_token: `at-${authLog.seq}`, expires_in: 86400 };
				authLog.issuedAccess.add(tokens.access_token);
				tokenAccount.set(tokens.access_token, username);
				return tokens;
			};

			if (url.pathname === "/iam/login") {
				authLog.login += 1;
				// 与真实上游一致：空 body 直接 500 / 10509（BFF 必须挡在前面）
				if (!body?.username || !body?.password)
					return send(500, { code: 10509, message: "invalid request" });
				// 新代 iam：业务错误走 `HTTP 200 + code≠0`（实测口令错 = 200 / 10003），
				// 留给「BFF 必须还原成 401 且不写 cookie」这条断言
				if (body.username === "biz-error-user")
					return send(200, { code: 10003, message: "账号或密码错误" });
				const account = accountOf(body.username);
				// 口令错与「账号不存在」同码，不泄露账号是否存在
				if (body.password !== account.password)
					return send(200, { code: 10003, message: "账号或密码错误" });
				const tokens = issueAccess(body.username);
				const refreshToken = `rt-${authLog.seq}`;
				tokenUser.set(refreshToken, body.username);
				return send(200, {
					code: 0,
					message: "success",
					data: { ...tokens, refresh_token: refreshToken, user_info: userInfoOf(body.username) }
				});
			}

			if (url.pathname === "/iam/refresh") {
				authLog.refresh += 1;
				const token = body?.refresh_token;
				if (!token)
					return send(401, { code: 40101, message: "未认证或登录态已失效" });
				// 实测：坏令牌走 **HTTP 200 + code 10007**（不是 401），BFF 必须识别成会话失效
				if (!tokenUser.has(token))
					return send(200, { code: 10007, message: "无效的认证令牌" });
				// 不轮换：同一个刷新令牌可反复使用（实测连用两次均 200）
				authLog.reusedRefresh += 1;
				// 有效刷新令牌签发新访问令牌；**不返回 refresh_token**
				return send(200, { code: 0, message: "success", data: issueAccess(tokenUser.get(token) ?? "alice") });
			}

			if (url.pathname === "/iam/logout") {
				authLog.logout.push({ authorization: req.headers.authorization ?? null, contentType: req.headers["content-type"] ?? null, body: body ?? null });
				// 幂等：重复登出仍 200 code 0（实测）
				authLog.revokedAccess.add(bearer);
				return send(200, { code: 0, message: "success", data: null });
			}

			if (url.pathname === "/iam/password" && req.method === "PUT") {
				authLog.passwordMethod = req.method;
				authLog.password.push(body ?? null);
				if (!authLog.issuedAccess.has(bearer) || authLog.revokedAccess.has(bearer))
					return send(401, { code: 40101, message: "会话已失效" });
				// 与真实上游一致：缺字段直接 500 / 10509（BFF 必须挡在前面）
				if (!body?.old_password || !body?.new_password)
					return send(500, { code: 10509, message: "invalid request" });
				// 按令牌判账号：改密只影响自己的口令，不串号
				const username = tokenAccount.get(bearer);
				const account = username ? accountOf(username) : null;
				// 旧口令错误：真实上游回 **HTTP 200 + code 10003**（BFF 必须还原为 400）
				if (!account || body.old_password !== account.password)
					return send(200, { code: 10003, message: "用户名或密码错误" });
				// 改密真的落库：新口令立刻可登录、旧口令失效
				account.password = body.new_password;
				return send(200, { code: 0, message: "success", data: null });
			}

			return send(404, { code: 10404, message: "iam_path_not_found" });
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

		// ── /audit*：审计域（`/system/log` 工具栏自查；网关透传路径可能带 `/api/v1` 前缀） ──
		const auditPath = url.pathname.match(/^\/(?:api\/v1\/)?audit(\/.*)?$/);
		if (auditPath) {
			const rest = auditPath[1] ?? "";

			if (rest === "" && req.method === "GET") {
				const category = (url.searchParams.get("category") ?? "").trim();
				const startTime = (url.searchParams.get("startTime") ?? "").trim();
				const endTime = (url.searchParams.get("endTime") ?? "").trim();
				const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
				const pageSize = Math.max(1, Number(url.searchParams.get("pageSize") ?? 20));

				// 与真实上游一致：`category` 精确匹配、时间窗按字面值比较（非法值这里不模拟）
				const filtered = auditRecords.filter((item) => {
					const key = auditEventKey(item.eventTime);
					return (!category || item.category === category)
						&& (!startTime || key >= startTime)
						&& (!endTime || key <= endTime);
				});

				auditLog.lastQuery = { category, startTime, endTime, page, pageSize };

				const start = (page - 1) * pageSize;
				return send(200, {
					code: 0,
					msg: "success",
					data: { list: filtered.slice(start, start + pageSize), total: filtered.length, page, pageSize }
				});
			}

			const auditDetail = rest.match(/^\/([^/]+)$/);
			if (auditDetail && req.method === "GET") {
				const record = auditRecords.find((item) => item.logCode === decodeURIComponent(auditDetail[1]));
				// 与真实上游一致：未知 `logCode` → `404 10301`（NMCPS-DESIGN-005 §9.4）
				if (!record)
					return send(404, { code: 10301, msg: "log_not_found" });
				return send(200, { code: 0, msg: "success", data: { ...record, sourceService: "", beforeSnapshot: "", afterSnapshot: "", detailJson: "", prevHash: "" } });
			}

			return send(404, { code: 10404, msg: "audit_path_not_found" });
		}

		// ── /role、/permission、/abac/rule：策略域最小只读数据（`/system/permission`、
		//    `/system/policy` 的列表栏自查要真实渲染列表态，见 NMCPS-ARCH-006 §3.8） ──
		if (url.pathname === "/role" && req.method === "GET") {
			const keyword = (url.searchParams.get("keyword") ?? "").trim();
			const matched = keyword
				? policyRoles.filter((item) => item.roleName.includes(keyword) || item.roleCode.includes(keyword))
				: policyRoles;
			return send(200, { code: 0, msg: "success", data: paged(matched, url) });
		}

		const rolePermissionPath = url.pathname.match(/^\/role\/([^/]+)\/permission$/);
		if (rolePermissionPath && req.method === "GET") {
			const roleCode = decodeURIComponent(rolePermissionPath[1]);
			if (!policyRoles.some((item) => item.roleCode === roleCode))
				return send(404, { code: 40301, msg: "role_not_found" });
			return send(200, { code: 0, msg: "success", data: paged(policyPermissions, url) });
		}

		const roleDetailPath = url.pathname.match(/^\/role\/([^/]+)$/);
		if (roleDetailPath && req.method === "GET") {
			const role = policyRoles.find((item) => item.roleCode === decodeURIComponent(roleDetailPath[1]));
			if (!role)
				return send(404, { code: 40301, msg: "role_not_found" });
			return send(200, { code: 0, msg: "success", data: role });
		}

		if (url.pathname === "/permission" && req.method === "GET") {
			const keyword = (url.searchParams.get("keyword") ?? "").trim();
			const resourceType = Number(url.searchParams.get("resourceType") ?? 0);
			const matched = policyPermissions.filter((item) => (!keyword || item.permCode.includes(keyword))
				&& (!resourceType || item.resourceType === resourceType));
			return send(200, { code: 0, msg: "success", data: paged(matched, url) });
		}

		if (url.pathname === "/abac/rule" && req.method === "GET")
			return send(200, { code: 0, msg: "success", data: paged(abacRules, url) });

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
