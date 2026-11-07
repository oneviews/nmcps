// scripts/lib/bff-harness.mjs
// 自查脚本共用的本地脚手架：拉起 `.output/server/index.mjs`（BFF）与一个假上游。
// 前置：`pnpm build:server` —— 本模块只消费构建产物，不自行构建。
// 使用方：`scripts/check-bff.mjs`（纯 HTTP 契约）、`scripts/check-ui.mjs`（浏览器端到端）。
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

export const SERVER_ENTRY = ".output/server/index.mjs";
export const HOST = "127.0.0.1";

/**
 * `__control/metric-error` 打开时 `/metric/datapoint` 回的失败原话（HTTP 200 + `code !== 0`）。
 * 刻意写成「一句带标点、带英文缩写」的上游口吻：页面对它必须**逐字**展示（`NMCPS-CONTRACT-002` §6.7
 * 的失败语义 —— 原文是数据，不翻译、不替换成 `api_request_failed`）。自查拿这个常量做字面比对。
 */
export const METRIC_UPSTREAM_FAILURE = "指标库查询超时（tsdb: query timeout after 30s）";

/**
 * `__control/catalog-error` 打开时 `/metric/definition` 回的失败原话（HTTP 200 + `code !== 0`）。
 * 目录失败**不是**取数失败（`NMCPS-CONTRACT-002` §8.4）：页面只该提示「只按名字判断类型」，
 * 既不降级成空态，也不把这句话当成取数失败展示 —— 自查同时比对「出现了什么」与「没出现什么」。
 */
export const CATALOG_UPSTREAM_FAILURE = "指标目录服务不可用（catalog: upstream 503 after 3 retries）";

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
	 * 新代 iam 假数据（`GET /iam/users|tenants|departments`，2026-11-04 实测字段）：给
	 * `/system/user` 两栏自查用。三条硬要求，否则用例测不出真伪：
	 *   - 列表对 `keyword` / `status` / `department_id` 真有筛选效果；
	 *   - 分页字段是 `page_size`（旧代 `pageSize`），`total` 要能分页；
	 *   - 空结果回 `list: null`（实测口径），顺带验证 BFF 出口归一成 `[]`。
	 */
	const iamTenants = [
		{ id: "tnt_default", name: "默认租户", code: "default", status: "active", description: "示例租户", device_quota: 500, storage_quota: 0, api_quota: 0, deleted_at: null, created_at: "2026-11-03T18:59:06+08:00" },
		{ id: "t_isp_a", name: "ISP-A Network Solutions", code: "isp-a", status: "active", description: "互联网服务提供商", device_quota: 200, storage_quota: 0, api_quota: 0, deleted_at: null, created_at: "2026-11-03T18:59:06+08:00" }
	];

	const iamDepartments = [
		{ id: "dept_default_tech", tenant_id: "tnt_default", name: "技术部", code: "tech", sort_order: 1, deleted_at: null },
		{ id: "dept_default_ops", tenant_id: "tnt_default", name: "运维部", code: "ops", sort_order: 2, deleted_at: null },
		{ id: "dept_isp_hq", tenant_id: "t_isp_a", name: "总部", code: "hq", sort_order: 1, deleted_at: null }
	];

	const iamUsers = [
		{ id: "u_alice", tenant_id: "tnt_default", department_id: "dept_default_tech", username: "alice", email: "alice@nms.local", display_name: "Alice", status: "active", mfa_enabled: true, last_login_at: null, created_at: "2026-11-01T09:00:00+08:00", deleted_at: null },
		{ id: "u_bob", tenant_id: "tnt_default", department_id: "dept_default_tech", username: "bob", email: "bob@nms.local", display_name: "Bob", status: "disabled", mfa_enabled: false, last_login_at: null, created_at: "2026-11-02T10:00:00+08:00", deleted_at: null },
		{ id: "u_carol", tenant_id: "t_isp_a", department_id: "dept_isp_hq", username: "carol", email: "carol@isp-a.example", display_name: "Carol", status: "locked", mfa_enabled: false, last_login_at: null, created_at: "2026-11-03T11:00:00+08:00", deleted_at: null }
	];

	/** 新代分页信封：`page_size`（不是 `pageSize`），`list` 空时给 `null`（真实上游口径） */
	const iamPaged = (records, url) => {
		const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
		const pageSize = Math.max(1, Number(url.searchParams.get("page_size") ?? 20));
		const start = (page - 1) * pageSize;
		const slice = records.slice(start, start + pageSize);
		return { list: slice.length ? slice : null, total: records.length, page, page_size: pageSize };
	};

	/**
	 * 审计域假数据（新代 `audit/*` 三族端点，NMCPS-ADR-0018 §三）：给 `/system/log` 的
	 * 工具栏 / 详情 / 归档自查用。
	 *
	 * 三族各有自己的端点与字段（旧代是单端点 + `category`）：
	 *   - 操作日志 `GET /audit/operation-logs`，时间参数 `created_from` / `created_to`（epoch 毫秒）；
	 *   - 安全日志 `GET /audit/security-logs`，时间参数 `logged_from` / `logged_to`（epoch 毫秒）；
	 *   - 归档记录 `GET /audit/archive/records`，**没有时间条件**。
	 *
	 * 与真实上游一致的两条口径（都实测过）：
	 *   1. **空结果给 `list: null`**（NMCPS-ADR-0018 D6），BFF 出口才归一成 `[]`；
	 *   2. 详情不存在回 **HTTP 200 + `code: 40401`**（不是 404），三个族共用这个码。
	 */
	const auditOperationLogs = [
		{ id: "op-0001", user_id: "u_alice", username: "alice", module: "iam", operation: "POST /api/v1/iam/users", target_type: "user", target_id: "u_bob", status: "success", ip_address: "10.0.0.1", trace_id: "trace-1", created_at: "2026-11-02T03:15:09+08:00" },
		{ id: "op-0002", user_id: "u_alice", username: "alice", module: "asset", operation: "PUT /api/v1/asset/device/dev-1001", target_type: "device", target_id: "dev-1001", status: "failed", ip_address: "10.0.0.2", trace_id: "trace-2", created_at: "2026-11-02T03:20:00+08:00" },
		{ id: "op-0003", user_id: "u_bob", username: "bob", module: "iam", operation: "DELETE /api/v1/iam/users/u_carol", target_type: "user", target_id: "u_carol", status: "success", ip_address: "10.0.0.3", trace_id: "trace-3", created_at: "2026-11-01T22:05:00+08:00" }
	];

	const auditSecurityLogs = [
		{ id: "sec-0001", subject_type: "user", subject_id: "u_alice", subject_name: "alice", action: "auth.login", resource: "/api/v1/iam/auth/login", auth_decision: "allow", ip_address: "10.0.0.1", trace_id: "trace-1", logged_at: "2026-11-02T03:15:09+08:00" },
		{ id: "sec-0002", subject_type: "user", subject_id: "u_alice", subject_name: "alice", action: "iam.user.delete", resource: "/api/v1/iam/users/u_carol", auth_decision: "deny", ip_address: "10.0.0.1", trace_id: "trace-4", logged_at: "2026-11-02T03:30:00+08:00" }
	];

	/** 归档记录：字段集合与真实上游逐字一致（实测 `POST /audit/archive/run` 后回读） */
	const auditArchiveRecords = [
		{ id: "arc-0001", table_name: "sys_operation_log", archive_batch: "arc-0001", rows_archived: 3, cutoff_before: "2026-08-06T10:34:39.998235+08:00", started_at: "2026-11-04T10:34:40+08:00", finished_at: "2026-11-04T10:34:40+08:00", status: "success", created_at: "2026-11-04T10:34:40+08:00" },
		{ id: "arc-0002", table_name: "sys_audit_log", archive_batch: "arc-0002", rows_archived: 0, cutoff_before: "2026-08-06T10:34:40.120011+08:00", started_at: "2026-11-04T10:34:41+08:00", finished_at: "2026-11-04T10:34:41+08:00", status: "success", created_at: "2026-11-04T10:34:41+08:00" }
	];

	/** 时间边界是 epoch 毫秒整数：空串 = 不设边界，非数字按「不设边界」处理（不自作主张报错） */
	const inEpochWindow = (value, from, to) => {
		const stamp = Date.parse(value);
		if (Number.isNaN(stamp))
			return false;
		if (from !== "" && Number.isFinite(Number(from)) && stamp < Number(from))
			return false;
		if (to !== "" && Number.isFinite(Number(to)) && stamp > Number(to))
			return false;
		return true;
	};

	/** 精确匹配的字符串筛选（空串 = 不筛）：上游对枚举参数是精确匹配，这里照样板做 */
	const matchesText = (value, expected) => expected === "" || String(value ?? "") === expected;

	/**
	 * 新代角色假数据（`GET /iam/roles`，2026-11-04 实测字段）：给 `/system/permission` 两栏自查用。
	 * 三条硬要求，否则用例测不出真伪：
	 *   - `keyword` 真的命中 name / code（`enabled` / `tenant_id` 传了被静默忽略，UP-RBAC-06）；
	 *   - 分页字段是 `page_size`，`total` 要能分页；
	 *   - 留一条「删除回 `200 {code:400}`」的样本（`r_tenant_viewer_isp_a`），把 UP-RBAC-05 的
	 *     失败通道固定进假上游，否则「删除失败」分支永远测不到。
	 */
	const iamRoles = [
		{ id: "r_platform_admin", tenant_id: null, name: "平台管理员", code: "platform.admin", description: "平台内置角色", enabled: true, is_system: true, created_at: "2026-11-03T18:59:06+08:00", updated_at: "2026-11-03T18:59:06+08:00", deleted_at: null },
		{ id: "r_tenant_admin", tenant_id: "tnt_default", name: "租户管理员", code: "tenant.admin", description: "租户内置角色", enabled: true, is_system: true, created_at: "2026-11-03T19:00:00+08:00", updated_at: "2026-11-03T19:00:00+08:00", deleted_at: null },
		{ id: "r_tenant_viewer_isp_a", tenant_id: "t_isp_a", name: "ISP-A 只读", code: "tenant.viewer", description: "删除会被上游拒绝（UP-RBAC-05）", enabled: true, is_system: false, created_at: "2026-11-04T09:20:00+08:00", updated_at: "2026-11-04T09:20:00+08:00", deleted_at: null }
	];

	/**
	 * 关系假数据（`GET /iam/role-policies`、`GET /iam/subject-roles`）：
	 *   - `rp-orphan` 指向不存在的策略、`sr-orphan` 指向已删用户 —— 两页都要按存在性过滤（UP-RBAC-10）；
	 *   - 重复挂载回 `SQLSTATE 23505`、摘除幂等，与实测一致。
	 */
	const iamRolePolicies = [
		{ id: "rp-platform", role_id: "r_platform_admin", policy_id: "pol_platform_full", created_at: "2026-11-03T18:59:06+08:00" },
		{ id: "rp-tenant-reader", role_id: "r_tenant_admin", policy_id: "pol_tenant_reader", created_at: "2026-11-04T09:00:00+08:00" },
		{ id: "rp-orphan", role_id: "r_tenant_admin", policy_id: "pol_deleted_elsewhere", created_at: "2026-11-04T09:05:00+08:00" }
	];

	const iamSubjectRoles = [
		{ id: "sr-alice", subject_type: "user", subject_id: "u_alice", role_id: "r_tenant_admin", created_at: "2026-11-04T09:00:00+08:00" },
		{ id: "sr-bob", subject_type: "user", subject_id: "u_bob", role_id: "r_tenant_admin", created_at: "2026-11-04T09:01:00+08:00" },
		{ id: "sr-orphan", subject_type: "user", subject_id: "u_ghost", role_id: "r_tenant_admin", created_at: "2026-11-04T09:02:00+08:00" }
	];

	/**
	 * 新代策略假数据（`GET /iam/policies`，2026-11-04 实测字段）：给 `/system/policy` 两栏自查用。
	 * 三条硬要求，否则用例测不出真伪：
	 *   - `keyword` 真的命中 name / code（`code` / `policy_type` / `enabled` 传了被静默忽略，UP-RBAC-06）；
	 *   - 分页字段是 `page_size`（不是 `pageSize`），`total` 要能分页；
	 *   - 留一条「删除回 `200 {code:400}`」的样本（`pol_role_reader_isp_a`），把 UP-RBAC-05 的
	 *     失败通道固定进假上游，否则「删除失败」分支永远测不到。
	 */
	const iamPolicies = [
		{ id: "pol_platform_full", tenant_id: "tnt_default", name: "平台全权限", code: "platform.full_access", policy_type: "system", document: "[{\"Action\":[\"*\"],\"Effect\":\"Allow\",\"Resource\":[\"*\"]}]", description: "平台内置全权限策略", enabled: true, is_system: true, created_at: "2026-11-03T18:59:06+08:00", updated_at: "2026-11-03T18:59:06+08:00", deleted_at: null },
		{ id: "pol_tenant_reader", tenant_id: "tnt_default", name: "租户只读", code: "tenant.readonly", policy_type: "custom", document: "[{\"Action\":[\"read\"],\"Effect\":\"Allow\",\"Resource\":[\"*\"]}]", description: "自查用自建策略", enabled: true, is_system: false, created_at: "2026-11-04T09:00:00+08:00", updated_at: "2026-11-04T09:00:00+08:00", deleted_at: null },
		{ id: "pol_role_reader_isp_a", tenant_id: "t_isp_a", name: "ISP-A 角色只读", code: "isp.role.readonly", policy_type: "custom", document: "[]", description: "删除会被上游拒绝（UP-RBAC-05）", enabled: true, is_system: false, created_at: "2026-11-04T09:10:00+08:00", updated_at: "2026-11-04T09:10:00+08:00", deleted_at: null }
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
	const control = { down: false, topologyEmpty: false, topologyNested: false, metricError: false, catalogError: false };

	const server = createHttpServer(async (req, res) => {
		const url = new URL(req.url ?? "/", `http://${HOST}:${port}`);
		const send = (status, payload) => {
			res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
			res.end(JSON.stringify(payload));
		};

		/**
		 * 纯文本响应：真实上游的失败不总是信封 ——
		 * `GET /iam/policies/{id}` 不存在时回 `400` + `记录不存在`，
		 * 唯一键 / jsonb 失败回 `400` + 原始 `ERROR: … (SQLSTATE 23505)`。
		 * BFF 与页面都必须按「非信封」处理，假上游不能把它包装成 JSON。
		 */
		const sendText = (status, text) => {
			res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
			res.end(text);
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
			return send(200, { down: control.down, topologyEmpty: control.topologyEmpty, topologyNested: control.topologyNested, metricError: control.metricError, catalogError: control.catalogError });
		/**
		 * 指标取数失败开关：`/metric/datapoint` 回 HTTP 200 + `code !== 0` + 一句上游原话。
		 * 这不是网络错误（`__control/down` 是），而是「上游回了信封但业务失败」——
		 * 页面必须逐字展示原话并给重试，且**不能**把它渲染成「该时间窗内无采集数据」（§6.7 / A13）。
		 */
		if (url.pathname === "/__control/metric-error") {
			control.metricError = true;
			return send(200, { metricError: true });
		}
		if (url.pathname === "/__control/metric-ok") {
			control.metricError = false;
			return send(200, { metricError: false });
		}
		/**
		 * 目录失败开关：`/metric/definition` 回 HTTP 200 + `code !== 0`。
		 * 与 `metric-error` 的区别是**失败在哪一步**：目录只是「类型判定的依据」，
		 * 而名字清单与序列都还好 —— 页面必须照常出图，只多一句「只按名字判断类型」（§8.4 / A17）。
		 */
		if (url.pathname === "/__control/catalog-error") {
			control.catalogError = true;
			return send(200, { catalogError: true });
		}
		if (url.pathname === "/__control/catalog-ok") {
			control.catalogError = false;
			return send(200, { catalogError: false });
		}
		if (url.pathname === "/__control/topology-empty") {
			control.topologyEmpty = true;
			return send(200, { topologyEmpty: true });
		}
		if (url.pathname === "/__control/topology-full") {
			control.topologyEmpty = false;
			return send(200, { topologyEmpty: false });
		}
		/**
		 * 两层形状开关：真实上游（8888 `/api/v1/topology/graph`，2026-11-07 复测）的节点 / 链路是
		 * **G6 元素形态** `{ id, data: { deviceName, tier, status, cpu… }, style, combo }`，
		 * 事实字段全在 `data` 里。`topology-nested` 就是按这个形状回的样本 ——
		 * 用来钉住「线格式 → 读模型」的拍平（`NMCPS-DESIGN-001` §6.10 / A27）：
		 * 少了这一步，`data.tier` 读不到 ⇒ 全部节点落到同一个兜底档 ⇒ 分层布局排成一条水平线。
		 */
		if (url.pathname === "/__control/topology-nested") {
			control.topologyNested = true;
			return send(200, { topologyNested: true });
		}
		if (url.pathname === "/__control/topology-flat") {
			control.topologyNested = false;
			return send(200, { topologyNested: false });
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

		// ── /topology*：拓扑图（`/topology/monitor`；网关透传路径带 `/api/v1` 前缀） ──
		// 形状对齐 `shared/types/topology.ts`（2026-10-14 只读实测：`id` 是管理 IP、`status` 数值口径
		// 1=在线 / 2=告警 / 0=离线、链路 `bandwidth` 实测全为 0）。`__control/topology-empty`
		// 用于「空拓扑渲染空态而不是空白画布」的断言（NMCPS-DESIGN-001 A4）。
		if (/^\/(?:api\/v1\/)?topology\/graph$/.test(url.pathname) && req.method === "GET") {
			// 两层形状样本（真实上游形状，§6.10 / A27）：四层各一台，事实全在 `data` 里。
			// 注意 `bandwidth` 是字符串 `"100 Mbps"`（实测口径），链路的 `linkType` / `status`
			// 同样在 `data` 里 —— 拍平后 A27 才能读到 tier 与 `deviceName`。
			if (control.topologyNested && !control.topologyEmpty) {
				return send(200, {
					code: 0,
					msg: "success",
					data: {
						nodes: [
							{
								id: "10.9.0.1",
								data: { deviceName: "嵌套核心-1", label: "嵌套核心-1", type: "core", tier: 1, status: "online", cpu: 33.3, memory: 41.5, interfaces: 8, uptime: 3600 },
								style: { x: 120, y: 120 },
								combo: "combo-nested"
							},
							{
								id: "10.9.0.2",
								data: { deviceName: "嵌套汇聚-1", label: "嵌套汇聚-1", type: "distribution", tier: 2, status: "warning", cpu: 66.6, memory: 52 },
								style: { x: 340, y: 320 },
								combo: "combo-nested"
							},
							{
								id: "10.9.0.3",
								data: { deviceName: "嵌套接入-1", label: "嵌套接入-1", type: "access", tier: 3, status: "online", interfaces: 0 },
								style: { x: 560, y: 520 },
								combo: "combo-nested"
							},
							{
								id: "10.9.0.4",
								data: { deviceName: "嵌套终端-1", label: "嵌套终端-1", type: "endnode", tier: 4, status: "offline" },
								style: { x: 780, y: 720 },
								combo: "combo-nested"
							}
						],
						edges: [
							{ id: "e-10.9.0.1-10.9.0.2", source: "10.9.0.1", target: "10.9.0.2", data: { linkType: "fiber", bandwidth: "100 Mbps", status: "online", bandwidth_util_pct: 0 } },
							{ id: "e-10.9.0.2-10.9.0.3", source: "10.9.0.2", target: "10.9.0.3", data: { linkType: "fiber", bandwidth: "100 Mbps", status: "online", bandwidth_util_pct: 0 } },
							{ id: "e-10.9.0.3-10.9.0.4", source: "10.9.0.3", target: "10.9.0.4", data: { linkType: "radio", bandwidth: "100 Mbps", status: "up", bandwidth_util_pct: 0 } }
						],
						combos: [{ id: "combo-nested", label: "嵌套区" }]
					}
				});
			}

			const graph = control.topologyEmpty
				? { nodes: [], edges: [], combos: [] }
				: {
					// 指标事实（`cpu` / `memory` / `interfaces` / `traffic*`）刻意留四种形态，详情栏
					// 必须把后两种显示成「—」、绝不许把未知当 0（NMCPS-CONTRACT-002 §6.3）：
					//   ① 全都给（10.0.0.1）—— 21.5% / 48% / 24 接口 / 12.5 Mbps；
					//   ② 只给 `traffic_in|out`（10.0.0.2）—— 总流量由前端求和（3 + 2 = 5 Mbps）；
					//   ③ 1.0 的 `-1` 哨兵 + 真实 `0` 接口 + 旧 Kbps 字段（10.0.0.3）—— 1500 Kbps → 1.5 Mbps；
					//   ④ 一个都不给（10.0.0.4 ~ 10.0.0.6）—— 全部未知。
					nodes: [
						{
							id: "10.0.0.1",
							name: "核心路由器-1",
							category: "network-device",
							type: "core",
							tier: 1,
							status: 1,
							cpu: 21.5,
							memory: 48,
							interfaces: 24,
							traffic: 12.5,
							traffic_in: 5,
							traffic_out: 7.5,
							uptime: 86400
						},
						{
							id: "10.0.0.2",
							name: "汇聚交换机-1",
							category: "network-device",
							type: "distribution",
							tier: 2,
							status: 1,
							cpu: 63.2,
							memory: 71.4,
							interfaces: 12,
							traffic_in: 3,
							traffic_out: 2
						},
						{
							id: "10.0.0.3",
							name: "接入交换机-1",
							category: "network-device",
							type: "access",
							tier: 2,
							status: 2,
							cpu: -1,
							memory: -1,
							interfaces: 0,
							trafficTotalKbps: 1500
						},
						{ id: "10.0.0.4", name: "无线AP-1", category: "ap", type: "access", tier: 3, status: 1 },
						{ id: "10.0.0.5", name: "单链路终端-1", category: "client", type: "endnode", tier: 4, status: 1 },
						{ id: "10.0.0.6", name: "单链路终端-2", category: "client", type: "endnode", tier: 4, status: 0 }
					],
					edges: [
						{ source: "10.0.0.1", target: "10.0.0.2", bandwidth: 0, linkType: "fiber", status: "up" },
						{ source: "10.0.0.1", target: "10.0.0.3", bandwidth: 0, linkType: "fiber", status: "up" },
						{ source: "10.0.0.2", target: "10.0.0.4", bandwidth: 0, linkType: "fiber", status: "up" },
						{ source: "10.0.0.3", target: "10.0.0.4", bandwidth: 0, linkType: "fiber", status: "down" },
						{ source: "10.0.0.4", target: "10.0.0.5", bandwidth: 0, linkType: "wireless", status: "up" },
						{ source: "10.0.0.4", target: "10.0.0.6", bandwidth: 0, linkType: "wireless", status: "down" }
					],
					combos: [{ id: "combo-access", label: "接入区" }]
				};

			return send(200, { code: 0, msg: "success", data: graph });
		}
		// ── /metric/*：节点指标（`/topology/monitor` 详情栏趋势，NMCPS-DESIGN-001 A3） ──
		// `/metric/name` 回该设备可用指标名清单：新路径是字符串数组、旧路径是对象数组（双形态，缺口
		// `API-G12`），两家都要吃得下。这里**首项刻意放采集器自监控名**（`up` / `scrape_*`）——
		// 断言「挑编码时跳过 collector 命名空间」而不是抓到什么画什么（NMCPS-CONTRACT-002 §三）。
		if (/^\/(?:api\/v1\/)?metric\/name$/.test(url.pathname) && req.method === "GET") {
			const ip = url.searchParams.get("mgmt_ip");
			return send(200, {
				code: 0,
				msg: "success",
				data: {
					mgmt_ip: ip ?? null,
					// `sys_name` 排在最后且被目录标成 `string`：它必须**不**进指标选择器
					// （NMCPS-CONTRACT-002 §八 三分类），否则「文本指标画成折线」的缺口就被掩盖了。
					metrics: ["up", "scrape_duration_seconds", "if_in_octets", "cpu_util_pct", "sys_name"]
				}
			});
		}

		// `/metric/definition`：指标目录（§八 的 join 依据）。`up` / `scrape_*` 即使登记也不可选（名字判据优先），
		// `sys_name` 标 `string` + `has_series: false` —— 两条文本判据各留一条样本。
		if (/^\/(?:api\/v1\/)?metric\/definition$/.test(url.pathname) && req.method === "GET") {
			// 目录不可用的样本（§8.4 / `__control/catalog-error`）：信封失败，但名字清单与序列照常 ——
			// 用来证明「目录失败不阻塞出图，也不冒充取数失败」。
			if (control.catalogError)
				return send(200, { code: 10503, msg: CATALOG_UPSTREAM_FAILURE, data: null });

			return send(200, {
				code: 0,
				msg: "success",
				data: {
					list: [
						{ code: "up", metric_type: "gauge", unit: "", en_name: "Up" },
						{ code: "scrape_duration_seconds", metric_type: "gauge", unit: "s", en_name: "Scrape duration" },
						{ code: "if_in_octets", metric_type: "counter", unit: "bytes", en_name: "Interface in octets" },
						{ code: "cpu_util_pct", metric_type: "gauge", unit: "%", en_name: "CPU utilization" },
						{ code: "sys_name", metric_type: "string", has_series: false, en_name: "System name" }
					],
					page: 1,
					page_size: 200,
					total: 5
				}
			});
		}

		// `/metric/device`：设备台账（指标页左栏，`NMCPS-DESIGN-001` §6.6 / A10）。
		// 三行刻意各有缺口：② 的 `cpu` / `ports` 缺一项（展示 `—`，不补 0）、③ 没有 `mgmt_ip`
		// （趋势面板只能说明原因，不许发明请求）。
		if (/^\/(?:api\/v1\/)?metric\/device$/.test(url.pathname) && req.method === "GET") {
			const devices = [
				{
					device_code: "DEV-CORE-1",
					mgmt_ip: "10.0.0.2",
					sys_name: "核心路由器-1",
					role: "core",
					vendor: "huawei",
					status: "online",
					health: { cpu_percent: 21.5, mem_percent: 48 },
					interface_summary: { total: 24, up: 22, down: 2 }
				},
				{
					device_code: "DEV-ACC-1",
					mgmt_ip: "10.0.0.3",
					sys_name: "接入交换机-1",
					role: "access",
					vendor: "h3c",
					status: "degraded",
					health: { cpu_percent: 63.25, mem_percent: null },
					interface_summary: { total: 48, up: null, down: null }
				},
				{
					device_code: "DEV-AP-1",
					mgmt_ip: null,
					sys_name: "无线AP-1",
					role: "ap",
					vendor: "ruijie",
					status: "online",
					health: {},
					interface_summary: { total: 1, up: 1, down: 0 }
				}
			];

			return send(200, { code: 0, msg: "success", data: iamPaged(devices, url) });
		}

		// `/metric/link`：链路台账（A12）。链路**没有 `mgmt_ip`**，页面靠 source 端 `device_code`
		// 反查设备 IP，并用 source 端 `if_index` 过滤端口序列（CONTRACT-002 §6.9）；第二条刻意从
		// 「没有 IP」的 `DEV-AP-1` 出发，把「取不到折线」这条分支固定进自查。
		if (/^\/(?:api\/v1\/)?metric\/link$/.test(url.pathname) && req.method === "GET") {
			const links = [
				{
					identity: {
						link_id: "LNK-0001",
						source: { device_code: "DEV-CORE-1", device_role: "core", interface_id: "GE0/0/1", if_index: 101, interface_name: "GE0/0/1", medium: "fiber" },
						target: { device_code: "DEV-ACC-1", device_role: "access", interface_id: "GE1/0/1", if_index: 201, interface_name: "GE1/0/1", medium: "fiber" },
						discovery: "lldp"
					},
					metrics: {
						status: "up",
						medium: "fiber",
						bandwidth_mbps: 10000,
						bandwidth_usage_percent: 32.5,
						latency_ms: 1.2,
						packet_loss_percent: 0
					}
				},
				{
					identity: {
						link_id: "LNK-0002",
						source: { device_code: "DEV-AP-1", device_role: "ap", interface_id: "WLAN-0", interface_name: "WLAN-0", medium: "wireless" },
						target: { device_code: "DEV-CORE-1", device_role: "core", interface_id: "GE0/0/9", interface_name: "GE0/0/9", medium: "wireless" },
						discovery: "lldp"
					},
					metrics: {
						status: "down",
						medium: "wireless",
						bandwidth_mbps: 300,
						bandwidth_usage_percent: null,
						latency_ms: null,
						packet_loss_percent: null
					}
				}
			];

			return send(200, { code: 0, msg: "success", data: iamPaged(links, url) });
		}

		// `/metric/datapoint` 回 VM 风格 matrix：点对恒为 `[unix秒, 字符串值]`。序列里**故意夹三个
		// 非法点**（空串 / `NaN` / 缺值）—— 展示层必须丢弃并计数、绝不补 0（CONTRACT-002 §6.3 ②）。
		// 多条 `results` 是常态（§6.9）：接口级指标按 `ifIndex` 分组、同一接口被两个 job 重复采集；
		// 这里给 `if_in_octets` 造 2 个端口 × 2 个 job（同组的第二个 job 只回合法点，于是「丢弃计数」
		// 仍是 3，不会被双 job 翻倍），另一端口的值刻意不同 —— 混画就一定能看出来。
		if (/^\/(?:api\/v1\/)?metric\/datapoint$/.test(url.pathname) && req.method === "GET") {
			// 业务失败（不是网络失败）：信封 `code !== 0`，BFF 归一到 `status: "error"` + 原话 `message`
			if (control.metricError)
				return send(200, { code: 10500, msg: METRIC_UPSTREAM_FAILURE });

			const now = Math.floor(Date.now() / 1000);
			const values = [
				[now - 600, "12.5"],
				[now - 480, "18.25"],
				[now - 420, ""],
				[now - 360, "21"],
				[now - 240, "NaN"],
				[now - 180, "19.75"],
				[now - 120, "23.5"],
				[now - 60, "20.25"],
				[now, "22"]
			];
			const validOnly = values.filter(([, raw]) => raw !== "" && raw !== "NaN");
			const otherPort = validOnly.map(([ts]) => [ts, "41.5"]);

			const code = url.searchParams.get("metric_code") ?? "";
			const ip = url.searchParams.get("mgmt_ip") ?? "";
			const withRate = url.searchParams.get("rate") === "true";
			/** `rate=true` 时 VM 的输出不带 `__name__`（§五 实测），这里照抄，免得内核偷偷依赖它 */
			const nameLabel = withRate ? {} : { __name__: code };

			const results = code === "if_in_octets"
				? [
					{ metric: { ...nameLabel, ip, job: "snmp_devices", ifIndex: "101" }, values },
					{ metric: { ...nameLabel, ip, job: "wireless_devices", ifIndex: "101" }, values: validOnly },
					{ metric: { ...nameLabel, ip, job: "snmp_devices", ifIndex: "102" }, values: otherPort }
				]
				// 设备级指标（`sysUpTime` / `cpu_util_pct` 这类）没有 `ifIndex` 标签
				: [{ metric: { ...nameLabel, ip, job: "snmp_devices" }, values }];

			return send(200, {
				code: 0,
				msg: "success",
				data: {
					mode: url.searchParams.get("mode") ?? "range",
					mgmt_ip: url.searchParams.get("mgmt_ip") ?? null,
					metric_code: url.searchParams.get("metric_code") ?? null,
					rate: withRate,
					results
				}
			});
		}

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

			// ── 新代用户 / 租户 / 部门（`/system/user` 自查用；2026-11-04 实测口径）─────────
			// `GET /iam/users`：`keyword` 命中 username / display_name / email，`status` 精确匹配，
			// `department_id` 精确匹配；空结果 `list: null`（BFF 出口归一为 `[]`）
			if (url.pathname === "/iam/users" && req.method === "GET") {
				const keyword = (url.searchParams.get("keyword") ?? "").trim().toLowerCase();
				const status = (url.searchParams.get("status") ?? "").trim();
				const departmentId = (url.searchParams.get("department_id") ?? "").trim();

				const filtered = iamUsers.filter((item) => {
					const matchedKeyword = !keyword
						|| item.username.toLowerCase().includes(keyword)
						|| (item.display_name ?? "").toLowerCase().includes(keyword)
						|| (item.email ?? "").toLowerCase().includes(keyword);

					return matchedKeyword
						&& (!status || item.status === status)
						&& (!departmentId || item.department_id === departmentId);
				});

				return send(200, { code: 0, message: "success", data: iamPaged(filtered, url) });
			}

			// `POST /iam/users`：重复用户名 200 / 10002、缺字段 200 / 40001（实测口径）；
			// 成功回 `{ code, message, id }` —— **没有 `data`**，页面靠 keyword 回读
			if (url.pathname === "/iam/users" && req.method === "POST") {
				if (!body?.username || !body?.password)
					return send(200, { code: 40001, message: body?.username ? "密码不能为空" : "用户名不能为空", id: "" });
				if (iamUsers.some((item) => item.username === body.username))
					return send(200, { code: 10002, message: "用户已存在", id: "" });

				const created = {
					id: `u_${body.username}`,
					tenant_id: iamDepartments.find((item) => item.id === body.department_id)?.tenant_id ?? null,
					department_id: body.department_id ?? null,
					username: body.username,
					email: body.email ?? "",
					display_name: body.display_name ?? "",
					status: "active",
					mfa_enabled: false,
					last_login_at: null,
					created_at: "2026-11-04T09:00:00+08:00",
					deleted_at: null
				};
				iamUsers.push(created);
				return send(200, { code: 0, message: "success", id: created.id });
			}

			const iamUserPath = url.pathname.match(/^\/iam\/users\/([^/]+)$/);
			if (iamUserPath) {
				const id = decodeURIComponent(iamUserPath[1]);
				const record = iamUsers.find((item) => item.id === id);

				if (!record)
					// 实测：目标不存在时上游回 **HTTP 400 + 纯文本「记录不存在」**（非信封）
					return send(400, { code: 400, message: "记录不存在" });

				if (req.method === "PUT") {
					if (body?.status && !["active", "disabled", "locked"].includes(body.status))
						return send(200, { code: 40001, message: "status 取值不合法", id: "" });
					for (const key of ["department_id", "email", "phone", "display_name", "status", "mfa_enabled"]) {
						if (body?.[key] !== undefined)
							record[key] = body[key];
					}
					// 改部门会连带改租户归属（部门自带租户），与真实上游一致
					if (body?.department_id)
						record.tenant_id = iamDepartments.find((item) => item.id === body.department_id)?.tenant_id ?? record.tenant_id;
					return send(200, { code: 0, message: "success" });
				}

				if (req.method === "DELETE") {
					// 软删：从列表移除（`deleted_at` 有值，列表默认过滤已删记录）
					record.deleted_at = "2026-11-04T09:30:00+08:00";
					iamUsers.splice(iamUsers.indexOf(record), 1);
					return send(200, { code: 0, message: "success" });
				}

				return send(404, { code: 10404, message: "iam_path_not_found" });
			}

			// ── `iam/policies`（NMCPS-DESIGN-005 §7）：/system/policy 的唯一数据源 ──
			// `GET /iam/policies`：`keyword` 命中 name / code；`code` / `policy_type` / `enabled`
			// 传了被静默忽略（UP-RBAC-06）—— 假上游也不实现它们，页面才测得出「筛选没生效」。
			if (url.pathname === "/iam/policies" && req.method === "GET") {
				const keyword = (url.searchParams.get("keyword") ?? "").trim().toLowerCase();
				const filtered = iamPolicies.filter((item) => !keyword
					|| item.name.toLowerCase().includes(keyword)
					|| item.code.toLowerCase().includes(keyword));

				return send(200, { code: 0, message: "success", data: iamPaged(filtered, url) });
			}

			// `POST /iam/policies`：成功把新主键放在**信封顶层**（`{ code, message, id }`，没有 data）；
			// 非法 document / 重复 code 回 `400` + 原始 SQL 文本（UP-RBAC-04），页面必须换成文案。
			if (url.pathname === "/iam/policies" && req.method === "POST") {
				let parsed = false;
				try {
					JSON.parse(body?.document ?? "");
					parsed = true;
				} catch {
					parsed = false;
				}
				if (!parsed)
					return sendText(400, "ERROR: invalid input syntax for type json (SQLSTATE 22P02)");
				if (iamPolicies.some((item) => item.code === body?.code))
					return sendText(400, "ERROR: duplicate key value violates unique constraint \"uk_sys_policy_tenant_code\" (SQLSTATE 23505)");

				const created = {
					id: `pol_${body.code}`,
					tenant_id: "tnt_default",
					name: body.name ?? "",
					code: body.code,
					policy_type: body.policy_type ?? "custom",
					document: body.document,
					description: body.description ?? "",
					enabled: true,
					is_system: false,
					created_at: "2026-11-04T10:00:00+08:00",
					updated_at: "2026-11-04T10:00:00+08:00",
					deleted_at: null
				};
				iamPolicies.push(created);
				return send(200, { code: 0, message: "success", id: created.id });
			}

			const iamPolicyPath = url.pathname.match(/^\/iam\/policies\/([^/]+)$/);
			if (iamPolicyPath) {
				const id = decodeURIComponent(iamPolicyPath[1]);
				const record = iamPolicies.find((item) => item.id === id);

				// 实测：目标不存在回 **HTTP 400 + 纯文本「记录不存在」**（非信封）
				if (!record)
					return sendText(400, "记录不存在");

				if (req.method === "GET")
					return send(200, { code: 0, message: "success", data: record });

				if (req.method === "PUT") {
					// `enabled` 写入被忽略（UP-RBAC-03）：只有 name / document / description 生效
					for (const key of ["name", "document", "description"]) {
						if (body?.[key] !== undefined)
							record[key] = body[key];
					}
					record.updated_at = "2026-11-04T10:30:00+08:00";
					return send(200, { code: 0, message: "success" });
				}

				if (req.method === "DELETE") {
					// `pol_role_reader_isp_a` 固定走 UP-RBAC-05 的失败通道：transport 仍是 200，业务码 400
					if (record.id === "pol_role_reader_isp_a")
						return send(200, { code: 400, message: "资源不存在或无权访问" });

					iamPolicies.splice(iamPolicies.indexOf(record), 1);
					return send(200, { code: 0, message: "success" });
				}

				return send(404, { code: 10404, message: "iam_path_not_found" });
			}

			// ── `iam/roles`（NMCPS-DESIGN-005 §8）：/system/permission 的角色数据源 ──
			// `GET /iam/roles`：`keyword` 命中 name / code；`enabled` / `tenant_id` 传了被静默忽略（UP-RBAC-06）
			if (url.pathname === "/iam/roles" && req.method === "GET") {
				const keyword = (url.searchParams.get("keyword") ?? "").trim().toLowerCase();
				const filtered = iamRoles.filter((item) => !keyword
					|| item.name.toLowerCase().includes(keyword)
					|| item.code.toLowerCase().includes(keyword));

				return send(200, { code: 0, message: "success", data: iamPaged(filtered, url) });
			}

			// `POST /iam/roles`：成功把新主键放在**信封顶层**（`{ code, message, id }`，没有 data）；
			// 重复 `code` 回 `400` + 原始 SQL 文本（UP-RBAC-04），页面必须换成文案
			if (url.pathname === "/iam/roles" && req.method === "POST") {
				if (!body?.code || !body?.name)
					return sendText(400, "ERROR: null value in column \"code\" violates not-null constraint (SQLSTATE 23502)");
				if (iamRoles.some((item) => item.code === body.code))
					return sendText(400, "ERROR: duplicate key value violates unique constraint \"uk_sys_role_tenant_code\" (SQLSTATE 23505)");

				const created = {
					id: `r_${body.code}`,
					tenant_id: "tnt_default",
					name: body.name,
					code: body.code,
					description: body.description ?? "",
					enabled: true,
					is_system: false,
					created_at: "2026-11-04T10:00:00+08:00",
					updated_at: "2026-11-04T10:00:00+08:00",
					deleted_at: null
				};
				iamRoles.push(created);
				return send(200, { code: 0, message: "success", id: created.id });
			}

			const iamRolePath = url.pathname.match(/^\/iam\/roles\/([^/]+)$/);
			if (iamRolePath) {
				const id = decodeURIComponent(iamRolePath[1]);
				const record = iamRoles.find((item) => item.id === id);

				// 实测：目标不存在回 **HTTP 400 + 纯文本「记录不存在」**（非信封）
				if (!record)
					return sendText(400, "记录不存在");

				if (req.method === "GET")
					return send(200, { code: 0, message: "success", data: record });

				if (req.method === "PUT") {
					// `enabled` 写入被忽略（UP-RBAC-03）：只有 name / description 生效
					for (const key of ["name", "description"]) {
						if (body?.[key] !== undefined)
							record[key] = body[key];
					}
					record.updated_at = "2026-11-04T10:30:00+08:00";
					return send(200, { code: 0, message: "success" });
				}

				if (req.method === "DELETE") {
					// `r_tenant_viewer_isp_a` 固定走 UP-RBAC-05 的失败通道：transport 仍是 200，业务码 400
					if (record.id === "r_tenant_viewer_isp_a")
						return send(200, { code: 400, message: "资源不存在或无权访问" });

					iamRoles.splice(iamRoles.indexOf(record), 1);
					return send(200, { code: 0, message: "success" });
				}

				return send(404, { code: 10404, message: "iam_path_not_found" });
			}

			// ── `iam/role-policies`（策略 × 角色）：只回关系行，不回策略本体 ──
			if (url.pathname === "/iam/role-policies" && req.method === "GET") {
				const roleId = (url.searchParams.get("role_id") ?? "").trim();
				const filtered = iamRolePolicies.filter((item) => !roleId || item.role_id === roleId);
				return send(200, { code: 0, message: "success", data: iamPaged(filtered, url) });
			}

			if (url.pathname === "/iam/role-policies/AttachPolicy" && req.method === "POST") {
				if (!body?.role_id || !body?.policy_id)
					return sendText(400, "ERROR: null value in column \"role_id\" violates not-null constraint (SQLSTATE 23502)");
				if (iamRolePolicies.some((item) => item.role_id === body.role_id && item.policy_id === body.policy_id))
					return sendText(400, "ERROR: duplicate key value violates unique constraint \"uk_sys_role_policy\" (SQLSTATE 23505)");

				iamRolePolicies.push({
					id: `rp-${iamRolePolicies.length + 1}`,
					role_id: body.role_id,
					policy_id: body.policy_id,
					created_at: "2026-11-04T10:40:00+08:00"
				});
				return send(200, { code: 0, message: "success" });
			}

			// 摘除幂等：没有命中的关系行也回 200（实测）
			if (url.pathname === "/iam/role-policies/DetachPolicy" && req.method === "POST") {
				const index = iamRolePolicies.findIndex((item) => item.role_id === body?.role_id && item.policy_id === body?.policy_id);
				if (index >= 0)
					iamRolePolicies.splice(index, 1);
				return send(200, { code: 0, message: "success" });
			}

			// ── `iam/subject-roles`（主体 × 角色）：只认 `subject_id`，按角色反查由前端做 ──
			if (url.pathname === "/iam/subject-roles" && req.method === "GET") {
				const subjectId = (url.searchParams.get("subject_id") ?? "").trim();
				const filtered = iamSubjectRoles.filter((item) => !subjectId || item.subject_id === subjectId);
				return send(200, { code: 0, message: "success", data: iamPaged(filtered, url) });
			}

			if (url.pathname === "/iam/subject-roles/AssignRole" && req.method === "POST") {
				if (!body?.subject_id || !body?.role_id)
					return sendText(400, "ERROR: null value in column \"subject_id\" violates not-null constraint (SQLSTATE 23502)");
				if (iamSubjectRoles.some((item) => item.subject_id === body.subject_id && item.role_id === body.role_id))
					return sendText(400, "ERROR: duplicate key value violates unique constraint \"uk_sys_subject_role\" (SQLSTATE 23505)");

				iamSubjectRoles.push({
					id: `sr-${iamSubjectRoles.length + 1}`,
					subject_type: body.subject_type ?? "user",
					subject_id: body.subject_id,
					role_id: body.role_id,
					created_at: "2026-11-04T10:50:00+08:00"
				});
				return send(200, { code: 0, message: "success" });
			}

			// 撤销幂等：没有命中的关系行也回 200（实测）
			if (url.pathname === "/iam/subject-roles/RevokeRole" && req.method === "POST") {
				const index = iamSubjectRoles.findIndex((item) => item.subject_id === body?.subject_id && item.role_id === body?.role_id);
				if (index >= 0)
					iamSubjectRoles.splice(index, 1);
				return send(200, { code: 0, message: "success" });
			}

			if (url.pathname === "/iam/tenants" && req.method === "GET")
				return send(200, { code: 0, message: "success", data: iamPaged(iamTenants, url) });

			if (url.pathname === "/iam/departments" && req.method === "GET")
				return send(200, { code: 0, message: "success", data: iamPaged(iamDepartments, url) });

			return send(404, { code: 10404, message: "iam_path_not_found" });
		}

		// ── /asset/device：新代资产域（snake_case；`snmp_*_pass` 是明文，NMCPS-ADR-0018 D7
		//    要求 BFF 出口掩码，故这里故意给真值，让 check:bff 断言「掩码后仍是 ***」） ──
		const assetDevicePath = url.pathname.match(/^\/(?:api\/v1\/)?asset\/device$/);
		if (assetDevicePath && req.method === "GET") {
			return send(200, {
				code: 0,
				message: "success",
				data: {
					list: [{ id: "dev-1001", name: "核心交换机", status: "online", snmp_auth_pass: "auth-secret-1", snmp_priv_pass: "priv-secret-1" }],
					page: 1,
					page_size: 10,
					total: 1
				}
			});
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

		// ── /audit*：审计域三族（`/system/log`；网关透传路径可能带 `/api/v1` 前缀） ──
		const auditPath = url.pathname.match(/^\/(?:api\/v1\/)?audit(\/.*)?$/);
		if (auditPath) {
			const rest = auditPath[1] ?? "";
			const query = (key) => (url.searchParams.get(key) ?? "").trim();

			// 操作日志：字符串筛选 + epoch 毫秒时间窗
			if (rest === "/operation-logs" && req.method === "GET") {
				const filtered = auditOperationLogs.filter((item) =>
					matchesText(item.username, query("username"))
					&& matchesText(item.module, query("module"))
					&& matchesText(item.status, query("status"))
					&& (!query("keyword") || item.operation.includes(query("keyword")) || item.username.includes(query("keyword")))
					&& inEpochWindow(item.created_at, query("created_from"), query("created_to")));
				auditLog.lastQuery = { kind: "operation", query: Object.fromEntries(url.searchParams) };
				return send(200, { code: 0, message: "success", data: iamPaged(filtered, url) });
			}

			// 安全日志：参数与操作日志不同源（`subject_*` / `auth_decision` / `logged_*`）
			if (rest === "/security-logs" && req.method === "GET") {
				const filtered = auditSecurityLogs.filter((item) =>
					matchesText(item.subject_name, query("subject_name"))
					&& matchesText(item.action, query("action"))
					&& matchesText(item.auth_decision, query("auth_decision"))
					&& matchesText(item.ip_address, query("ip_address"))
					&& inEpochWindow(item.logged_at, query("logged_from"), query("logged_to")));
				auditLog.lastQuery = { kind: "security", query: Object.fromEntries(url.searchParams) };
				return send(200, { code: 0, message: "success", data: iamPaged(filtered, url) });
			}

			// 归档记录：**没有时间条件**，只认 `table_name` / `status`
			if (rest === "/archive/records" && req.method === "GET") {
				const filtered = auditArchiveRecords.filter((item) =>
					matchesText(item.table_name, query("table_name"))
					&& matchesText(item.status, query("status")));
				auditLog.lastQuery = { kind: "archive", query: Object.fromEntries(url.searchParams) };
				return send(200, { code: 0, message: "success", data: iamPaged(filtered, url) });
			}

			// 归档（写操作）：实测回「表名 → 本批次行数」，并留下批次记录
			if (rest === "/archive/run" && req.method === "POST") {
				const body = await readJsonBody(req);
				const tableName = typeof body?.table_name === "string" ? body.table_name : "";
				const stamp = new Date().toISOString();
				const tables = tableName ? [tableName] : ["sys_operation_log", "sys_audit_log"];
				const result = {};

				for (const table of tables) {
					result[table] = 0;
					auditArchiveRecords.unshift({
						id: `arc-run-${auditArchiveRecords.length + 1}`,
						table_name: table,
						archive_batch: `arc-run-${auditArchiveRecords.length + 1}`,
						rows_archived: 0,
						cutoff_before: stamp,
						started_at: stamp,
						finished_at: stamp,
						status: "success",
						created_at: stamp
					});
				}

				return send(200, { code: 0, message: "success", data: result });
			}

			// 三族详情：不存在时与真实上游一致 —— **HTTP 200 + `code: 40401`**
			const detail = rest.match(/^\/(operation-logs|security-logs|archive\/records)\/([^/]+)$/);
			if (detail && req.method === "GET") {
				const [collection, rawId] = [detail[1], detail[2]];
				const id = decodeURIComponent(rawId);
				const source = collection === "operation-logs"
					? auditOperationLogs
					: collection === "security-logs" ? auditSecurityLogs : auditArchiveRecords;
				const record = source.find((item) => item.id === id);

				if (!record)
					return send(200, { code: 40401, message: "记录不存在" });

				return send(200, { code: 0, message: "success", data: record });
			}

			return send(404, { code: 10404, msg: "audit_path_not_found" });
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

/**
 * 假仿真平台（第二上游，NMCPS-ADR-0019 裁决 B）：只实现 BFF 白名单里那些端点的形状。
 *
 * 记录每次请求的 `{ method, path, headers }`（`server.log`）——「出站不带 authorization、
 * 不把 nmcps_at 转 Bearer」这类断言只能靠上游侧的客观记录来取证，不能问 BFF 自己。
 *
 * 返回体形状对齐 NMCPS-CONTRACT-001 §六 的实测形状（`nodes_by_type` 用动态键、
 * 链路的 `status` 是 up/down 字符串）；这里只求形状够用，数值不必等于真实仿真。
 */
export async function startSimulator(port) {
	const log = [];

	/** 写端点的请求体（只用于回显，解析失败按 undefined） */
	async function readBody(req) {
		const chunks = [];
		for await (const chunk of req) {
			chunks.push(chunk);
		}
		const raw = Buffer.concat(chunks).toString("utf8");
		if (!raw)
			return undefined;
		try {
			return JSON.parse(raw);
		} catch {
			return raw;
		}
	}

	const server = createHttpServer(async (req, res) => {
		const url = new URL(req.url, `http://${HOST}:${port}`);
		const path = url.pathname;
		log.push({ method: req.method, path, headers: req.headers });

		const send = (status, payload) => {
			const body = JSON.stringify(payload);
			res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
			res.end(body);
		};

		// ── 只读 ──
		if (path === "/api/network/runtime-inventory" && req.method === "GET") {
			// 形状对齐 `shared/types/simulator.ts`（NMCPS-CONTRACT-001 §6.3）：IP 在 `ip_address`，
			// 与 8888 图节点（`id` = 管理 IP）对齐靠它 —— 页面用它叠「仿真中」标记。
			const node = (id, name, type, ip) => ({
				id,
				name,
				type,
				status: "online",
				x: null,
				y: null,
				interfaces: [],
				ip_address: ip,
				mac_address: null,
				device_type: type,
				role: null,
				ports: [],
				weaknet_config: null,
				protocol_config: null,
				radio: null
			});

			return send(200, {
				running: true,
				scenario: "drill-a",
				overrides: { exists: false, updated_at: null, node_count: 0, link_count: 0, topology_count: 0 },
				nodes: [
					node("n1", "核心路由器-1", "router", "10.0.0.1"),
					node("n2", "汇聚交换机-1", "switch", "10.0.0.2")
				],
				links: [
					{
						id: "l1",
						source: "n1",
						target: "n2",
						source_interface: "Gi0/1",
						target_interface: "Gi0/2",
						type: "wired",
						status: "up",
						bandwidth: "1Gbps",
						delay: "2ms",
						loss: "0%",
						real_stats: null,
						weaknet_config: null,
						protocol_config: null,
						tc: null
					}
				]
			});
		}

		if (path === "/api/network/stats" && req.method === "GET") {
			return send(200, {
				node_count: 36,
				link_count: 48,
				nodes_by_type: { router: 3, switch: 6, ap: 18, station: 9 },
				links_by_type: { wired: 40, wireless: 8 },
				nodes_online: 36,
				links_up: 48
			});
		}

		if (path === "/api/lldp/summary" && req.method === "GET") {
			return send(200, { neighbor_count: 12, switches: ["S1", "S2"] });
		}

		const neighbor = path.match(/^\/api\/lldp\/neighbors\/([^/]+)$/);
		if (neighbor && req.method === "GET") {
			return send(200, {
				node_id: decodeURIComponent(neighbor[1]),
				neighbors: [{ id: "n2", name: "S1", local_port: "Gi0/1", remote_port: "Gi0/2", ttl: 120, mib_oids: {} }]
			});
		}

		if (path === "/api/network/runtime/preview" && req.method === "GET") {
			return send(200, { nodes: [], links: [], warnings: [] });
		}

		// ── 写（`allowWrite: true` 才会到这里） ──
		const write = req.method !== "GET" && /^\/api\/network\/(?:links|nodes|runtime)\//.test(path);
		if (write) {
			return send(200, { ok: true, method: req.method, path, received_body: await readBody(req) });
		}

		return send(404, { detail: "simulator_path_not_found", path, method: req.method });
	});

	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, HOST, resolve);
	});

	server.log = log;

	return server;
}
