// layers/scenario/scripts/check-lab-bff.mjs
// Mininet 只读 BFF 通道自查（NMCPS-ADR-0020）。
//
// 前置：`pnpm build:server` —— 只消费 `.output/server/index.mjs`，不自行构建。
// 假上游只实现白名单里那些端点的形状，并记录每次请求的 method / path / headers：
// “出站不带 authorization / cookie”“写请求根本没到达上游”必须由上游侧取证。
import { Buffer } from "node:buffer";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import process from "node:process";
import { closeUpstream, freePort, HOST, SERVER_ENTRY, startBff, stopBff } from "../../../scripts/lib/bff-harness.mjs";

const MININET_ROUTES_SOURCE = "layers/scenario/shared/constants/mininetRoutes.ts";
const MININET_SNAPSHOT_PATH = "packages/contracts/openapi/mininet.json";

/** 测试会话密钥（≥32 字节；生产必须来自 NUXT_BFF_SESSION_SECRET） */
const SESSION_SECRET = "lab-test-session-secret-0123456789abcdef";
const LAB_TENANT = "t_lab";

/**
 * 默认台账：P2 起 `/api/lab/**` 必须先命中台账才触达上游。
 * 这里不登记 `resources`，表示“以租户实例为边界”（Mininet 一实例一网）。
 */
const DEFAULT_LEDGER = [{
	id: "net_lab",
	tenant_id: LAB_TENANT,
	engine: "mininet",
	upstream_id: "mininet-t_lab",
	state: "running",
	created_by: "u_lab",
	created_at: "2026-11-15T00:00:00.000Z",
	updated_at: "2026-11-15T00:00:00.000Z"
}];

/** 带资源清单的台账：用于验证列表出口与路径参数的资源级过滤 */
const SCOPED_LEDGER = [{
	...DEFAULT_LEDGER[0],
	id: "net_scoped",
	resources: { nodes: ["h1", "sw1"], links: ["h1--sw1"] }
}, {
	id: "net_other",
	tenant_id: "t_other",
	engine: "mininet",
	upstream_id: "mininet-t_other",
	state: "running",
	created_by: "u_other",
	created_at: "2026-11-15T00:00:00.000Z",
	updated_at: "2026-11-15T00:00:00.000Z"
}];

/** 假主上游地址（启动后赋值；`labEnv()` 在 section 内才被调用） */
let iamBase = "";

if (!existsSync(SERVER_ENTRY)) {
	console.error(`❌ 缺少构建产物 ${SERVER_ENTRY}：先跑 \`pnpm build:server\`，再重试 \`pnpm check:lab-bff\`。`);
	process.exit(1);
}

const results = [];

function log(label, ok, detail) {
	results.push({ label, ok: !!ok });
	console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

function describe(value) {
	if (value === undefined)
		return "";
	if (typeof value === "string")
		return value;
	return JSON.stringify(value);
}

async function request(port, path, options = {}) {
	const { method = "GET", headers = {}, cookie, body } = options;
	const finalHeaders = { ...headers };
	if (cookie)
		finalHeaders.cookie = cookie;

	const res = await fetch(`http://${HOST}:${port}${path}`, {
		method,
		headers: finalHeaders,
		body,
		redirect: "manual"
	});
	const text = await res.text();

	let json;
	try {
		json = JSON.parse(text);
	} catch {
		json = undefined;
	}

	return { status: res.status, headers: res.headers, text, json };
}

async function withBff(env, fn) {
	const port = await freePort();
	const child = await startBff(port, env);
	try {
		return await fn(port);
	} finally {
		await stopBff(child);
	}
}

function setCookies(response) {
	if (typeof response.headers.getSetCookie === "function")
		return response.headers.getSetCookie();
	const raw = response.headers.get("set-cookie");
	return raw ? [raw] : [];
}

function cookieValue(cookies, name) {
	const raw = cookies.find((item) => item.startsWith(`${name}=`)) ?? "";
	return raw.split(";")[0].slice(name.length + 1);
}

/** 只读解码会话载荷，用于断言 `tid` 没有在刷新时被未签名 cookie 改写 */
function decodeSessionTid(token) {
	const body = token.split(".")[1];
	return body ? JSON.parse(Buffer.from(body, "base64url").toString("utf8")).tid : undefined;
}

/**
 * 真实走一次登录，拿 BFF 签发的 `nmcps_at` + `nmcps_sess`。
 * 会话 cookie 必须由 BFF 自己签发；测试脚本不复制签名算法。
 */
async function login(port, username = "alice") {
	const response = await request(port, "/api/auth/login", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ username, password: "p@ssw0rd" })
	});
	const cookies = setCookies(response);
	const accessToken = cookieValue(cookies, "nmcps_at");
	const session = cookieValue(cookies, "nmcps_sess");

	return {
		response,
		cookies,
		accessToken,
		session,
		refreshToken: cookieValue(cookies, "nmcps_rt"),
		uiCookie: cookieValue(cookies, "nmcps_ui"),
		cookie: `nmcps_at=${accessToken}; nmcps_sess=${session}`
	};
}

function labEnv(overrides = {}) {
	return {
		NUXT_BFF_UPSTREAM_BASE: iamBase,
		NUXT_BFF_SESSION_SECRET: SESSION_SECRET,
		NUXT_LAB_LEDGER_FILE: `.data/check-lab-bff-${process.pid}.json`,
		NUXT_LAB_LEDGER_SEED: JSON.stringify(DEFAULT_LEDGER),
		NUXT_LAB_AUDIT_FILE: `.data/check-lab-audit-${process.pid}/lab-audit.jsonl`,
		...overrides
	};
}

/** 从白名单源码抽取条目（纯 node ESM，不 import TS）；抽取为空即判红 */
function readMininetWhitelist() {
	const text = readFileSync(MININET_ROUTES_SOURCE, "utf8");
	const start = text.indexOf("export const MININET_ROUTES");
	if (start === -1)
		return [];
	const end = text.indexOf("] as const;", start);
	const body = end === -1 ? text.slice(start) : text.slice(start, end);

	return [...body.matchAll(/\{\s*method:\s*"([A-Z]+)",\s*template:\s*"([^"]+)",\s*upstream:\s*"([^"]+)",\s*permissions:\s*\[([^\]]*)\]\s*\}/g)]
		.map((match) => ({
			method: match[1],
			template: match[2],
			upstream: match[3],
			permissions: [...match[4].matchAll(/"([^"]+)"/g)].map((item) => item[1])
		}));
}

/** 汇总审计目录下所有分片（按天分片，文件名带日期） */
function readAuditEntries(filePath) {
	const dir = path.dirname(filePath);
	if (!existsSync(dir))
		return [];

	return readdirSync(dir)
		.filter((name) => name.endsWith(".jsonl"))
		.flatMap((name) => readFileSync(path.join(dir, name), "utf8")
			.split("\n")
			.filter((line) => line.trim().length > 0)
			.map((line) => JSON.parse(line)));
}

/** 假 Mininet 后端：返回体形状够页面用即可，重点是路径与出站头可取证 */
async function startMininet(port) {
	const log = [];

	const server = createServer(async (req, res) => {
		const url = new URL(req.url, `http://${HOST}:${port}`);
		const path = url.pathname;
		log.push({ method: req.method, path, search: url.search, headers: req.headers });

		const send = (status, payload) => {
			res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
			res.end(JSON.stringify(payload));
		};

		if (path === "/api/health" && req.method === "GET") {
			return send(200, { status: "ok", connected: true, network_started: true, timestamp: "2026-11-15T00:00:00Z" });
		}

		if (path === "/api/mininet/hosts" && req.method === "GET") {
			return send(200, [
				{ name: "h1", ip: "10.0.0.1", mac: "00:00:00:00:00:01", position: { x: 10, y: 20 } },
				{ name: "h2", ip: "10.0.0.2", mac: "00:00:00:00:00:02", position: { x: 30, y: 40 } }
			]);
		}

		if (path === "/api/mininet/start" && req.method === "GET") {
			return send(200, true);
		}

		if (path === "/api/mininet/sniffer/state" && req.method === "GET") {
			return send(200, { active: false });
		}

		const stats = path.match(/^\/api\/mininet\/stats\/([^/]+)$/);
		if (stats && req.method === "GET") {
			const nodeId = decodeURIComponent(stats[1]);
			if (nodeId === "missing")
				return send(404, { detail: "Node missing not found" });
			return send(200, { name: nodeId, type: "host", cpu: 0.5 });
		}

		const linkStats = path.match(/^\/api\/mininet\/links\/stats\/([^/]+)\/([^/]+)$/);
		if (linkStats && req.method === "GET") {
			return send(200, { from: linkStats[1], to: linkStats[2], intfs: [] });
		}

		// ── 写端点：记录请求体并回显，供断言「方法 / 路径 / 请求体原样到达」 ──
		if (req.method !== "GET") {
			let raw = "";
			for await (const chunk of req)
				raw += chunk;

			const entry = log.at(-1);
			if (entry)
				entry.body = raw;

			// 串行化断言用：`?__delay=<ms>` 让上游慢下来，制造并发窗口
			const delay = Number(url.searchParams.get("__delay") ?? 0);
			if (Number.isFinite(delay) && delay > 0) {
				await new Promise((resolve) => setTimeout(resolve, delay));
			}

			// 审计失败路径用：一个稳定失败的上游动作
			if (path === "/api/mininet/reset") {
				return send(500, { detail: "reset failed" });
			}

			return send(200, { ok: true, method: req.method, path, body: raw ? JSON.parse(raw) : null });
		}

		return send(404, { detail: "upstream_not_found" });
	});

	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, HOST, resolve);
	});

	server.log = log;
	return server;
}

/**
 * 假主上游：只实现登录 + 角色解析所需端点，供 `/api/lab/**` 的签名会话与 RBAC 取证。
 * `failRoles` 可在测试进程内切换，用来验证“角色查询失败不降级为 tenant_user”。
 */
async function startIam(port) {
	const users = {
		alice: { id: "u_lab", username: "alice", tenantId: "t_lab", roleId: "r_admin" },
		bob: { id: "u_other", username: "bob", tenantId: "t_other", roleId: "r_other" },
		dave: { id: "u_dave", username: "dave", tenantId: "t_lab", roleId: "r_admin" },
		erin: { id: "u_reader", username: "erin", tenantId: "t_lab", roleId: "r_user" },
		frank: { id: "u_terminal", username: "frank", tenantId: "t_lab", roleId: "r_terminal" },
		platform: { id: "u_platform", username: "platform", tenantId: null, roleId: "r_platform" }
	};
	const roles = {
		r_admin: { code: "tenant_admin", tenantId: "t_lab" },
		r_other: { code: "tenant_admin", tenantId: "t_other" },
		r_user: { code: "tenant_user", tenantId: "t_lab" },
		r_terminal: { code: "lab_terminal", tenantId: "t_lab" },
		r_platform: { code: "platform_admin", tenantId: null }
	};
	const state = { failRoles: false, log: [] };

	const readBody = async (req) => {
		let raw = "";
		for await (const chunk of req)
			raw += chunk;
		try {
			return JSON.parse(raw);
		} catch {
			return {};
		}
	};

	const server = createServer(async (req, res) => {
		const url = new URL(req.url, `http://${HOST}:${port}`);
		const path = url.pathname;
		state.log.push({ method: req.method, path, search: url.search, headers: req.headers });

		const send = (status, payload) => {
			res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
			res.end(JSON.stringify(payload));
		};

		if (path === "/iam/login" && req.method === "POST") {
			const body = await readBody(req);
			const user = users[body.username];
			if (!user)
				return send(200, { code: 10003, message: "账号或密码错误" });

			return send(200, {
				code: 0,
				message: "success",
				data: {
					access_token: `at-${user.username}`,
					refresh_token: `rt-${user.username}`,
					expires_in: 3600,
					user_info: {
						id: user.id,
						username: user.username,
						display_name: user.username,
						tenant_id: user.tenantId
					}
				}
			});
		}

		if (path === "/iam/refresh" && req.method === "POST") {
			const body = await readBody(req);
			const username = String(body.refresh_token ?? "").replace(/^rt-/, "");
			const user = users[username];
			if (!user)
				return send(200, { code: 10007, message: "invalid refresh token" });

			return send(200, {
				code: 0,
				message: "success",
				data: {
					access_token: `at-${user.username}-refreshed`,
					expires_in: 3600
				}
			});
		}

		if (path === "/iam/subject-roles" && req.method === "GET") {
			if (state.failRoles)
				return send(500, { message: "iam role lookup failed" });

			const subjectId = url.searchParams.get("subject_id");
			const user = Object.values(users).find((item) => item.id === subjectId);
			if (!user)
				return send(404, { message: "subject not found" });

			return send(200, {
				code: 0,
				message: "success",
				data: {
					list: [{
						id: `sr-${user.id}`,
						subject_type: "user",
						subject_id: user.id,
						role_id: user.roleId
					}],
					total: 1
				}
			});
		}

		const rolePath = path.match(/^\/iam\/roles\/([^/]+)$/);
		if (rolePath && req.method === "GET") {
			const roleId = decodeURIComponent(rolePath[1]);
			const role = roles[roleId];
			if (!role)
				return send(404, { message: "role not found" });

			return send(200, {
				code: 0,
				message: "success",
				data: { id: roleId, code: role.code, tenant_id: role.tenantId }
			});
		}

		return send(404, { message: "not found" });
	});

	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, HOST, resolve);
	});

	server.state = state;
	return server;
}

// ⓪ 白名单 ⊆ 契约快照 + 写端点分档（NMCPS-ADR-0022）
{
	const whitelist = readMininetWhitelist();
	const snapshot = JSON.parse(readFileSync(MININET_SNAPSHOT_PATH, "utf8"));
	const paths = snapshot.paths ?? {};
	const missing = whitelist.filter((entry) => !paths[entry.upstream]?.[entry.method.toLowerCase()]);
	const reads = whitelist.filter((entry) => entry.method === "GET");
	const writes = whitelist.filter((entry) => entry.method !== "GET");
	const writeWithoutPermission = writes.filter((entry) => entry.permissions.length === 0 || entry.permissions.includes("lab:read"));
	const readWithWritePermission = reads.filter((entry) => entry.permissions.join(",") !== "lab:read");
	const dual = writes.filter((entry) => entry.permissions.length > 1);

	log("⓪ 白名单条目可从源码抽取（抽取为空即红）", whitelist.length > 0, `${whitelist.length} 条`);
	log("⓪ 查询端点 17 条且权限位都是 lab:read", reads.length === 17 && readWithWritePermission.length === 0, `reads=${reads.length} 异常=${readWithWritePermission.map((e) => `${e.method} ${e.template}`).join(", ") || "无"}`);
	log("⓪ 写端点 28 条且都带非读权限位", writes.length === 28 && writeWithoutPermission.length === 0, `writes=${writes.length} 异常=${writeWithoutPermission.map((e) => `${e.method} ${e.template}`).join(", ") || "无"}`);
	log("⓪ full_reset / import_json 为双权限（lab:delete + lab:create）", dual.length === 2 && dual.every((entry) => entry.permissions.includes("lab:delete") && entry.permissions.includes("lab:create")), dual.map((entry) => `${entry.template}[${entry.permissions.join("+")}]`).join(", ") || "无");
	log("⓪ 白名单 ⊆ Mininet OpenAPI 快照（路径 + 动词逐条命中）", whitelist.length > 0 && missing.length === 0, missing.map((entry) => `${entry.method} ${entry.upstream}`).join(", ") || `${whitelist.length}/${whitelist.length}`);
}

const mininetPort = await freePort();
const mininet = await startMininet(mininetPort);
const mininetBase = `http://${HOST}:${mininetPort}`;

const iamPort = await freePort();
const iam = await startIam(iamPort);
iamBase = `http://${HOST}:${iamPort}`;

try {
	// ① 未配置实例：签名会话可用，但租户没有运行实例 → 503，且不触达任何 Mininet
	await withBff(labEnv(), async (port) => {
		const auth = await login(port);
		const hitsBefore = mininet.log.length;

		log("① 登录签发 nmcps_sess（HttpOnly + Path=/）", auth.response.status === 200 && auth.session.length > 0 && /HttpOnly/i.test(auth.cookies.find((raw) => raw.startsWith("nmcps_sess=")) ?? "") && /Path=\//i.test(auth.cookies.find((raw) => raw.startsWith("nmcps_sess=")) ?? ""), describe(auth.session.slice(0, 24)));

		const channel = await request(port, "/api/lab/channel", { cookie: auth.cookie });
		log("① 未配租户实例的 channel 仍 200 且 configured=false", channel.status === 200 && channel.json?.data?.configured === false, `${channel.status} ${describe(channel.json?.data?.configured)}`);
		log("① channel 按会话算能力位（租户管理员 writeEnabled=true，终端/抓包仍 false）", channel.json?.data?.readOnly === false && channel.json?.data?.writeEnabled === true && channel.json?.data?.capabilities?.create === true && channel.json?.data?.capabilities?.operate === true && channel.json?.data?.capabilities?.delete === true && channel.json?.data?.capabilities?.terminal === false && channel.json?.data?.capabilities?.sniffer === false && channel.json?.data?.endpointCount === 45, describe(channel.json?.data));
		log("① channel 不回传 baseUrl", !JSON.stringify(channel.json ?? {}).includes(mininetBase), describe(channel.json?.data));

		const noPath = await request(port, "/api/lab");
		log("① /api/lab 无路径段 → 400 bff_path_missing", noPath.status === 400 && noPath.json?.message === "bff_path_missing", `${noPath.status} ${describe(noPath.json?.message)}`);

		const noPathSlash = await request(port, "/api/lab/");
		log("① /api/lab/ 同样 400（不回落到主网关 404）", noPathSlash.status === 400 && noPathSlash.json?.message === "bff_path_missing", `${noPathSlash.status} ${describe(noPathSlash.headers.get("content-type"))}`);

		const unconfigured = await request(port, "/api/lab/hosts", { cookie: auth.cookie });
		log("① 租户无实例 → 503 tenant_runtime_unavailable（不是全局 mininet_not_configured）", unconfigured.status === 503 && unconfigured.json?.message === "tenant_runtime_unavailable", `${unconfigured.status} ${describe(unconfigured.json?.message)}`);
		log("① 租户无实例不触达 Mininet", mininet.log.length === hitsBefore, `hits=${mininet.log.length - hitsBefore}`);
	});

	// ② 白名单、查询参数与拒绝边界（全部带签名会话）
	await withBff(labEnv({
		NUXT_MININET_INSTANCES: JSON.stringify({ [LAB_TENANT]: { baseUrl: mininetBase } })
	}), async (port) => {
		const auth = await login(port);
		const channel = await request(port, "/api/lab/channel", { cookie: auth.cookie });
		log("② 租户实例命中后 channel configured=true", channel.json?.data?.configured === true, describe(channel.json?.data?.configured));

		const hitsBefore = mininet.log.length;
		const hosts = await request(port, "/api/lab/hosts?limit=2&tag=a&tag=b", { cookie: auth.cookie });
		const hostHit = mininet.log.slice(hitsBefore).at(-1);
		log("② 白名单内 GET 到达上游且裸 JSON 套信封", hosts.status === 200 && hosts.json?.code === 0 && hosts.json?.data?.length === 2, `${hosts.status} len=${describe(hosts.json?.data?.length)}`);
		log("② 查询参数原样转发（重复键保留）", hostHit?.path === "/api/mininet/hosts" && hostHit?.search === "?limit=2&tag=a&tag=b", describe(hostHit?.search));

		const health = await request(port, "/api/lab/health", { cookie: auth.cookie });
		log("② 探针端点映射到 /api/health（不是 /api/mininet/health）", health.status === 200 && health.json?.data?.status === "ok" && mininet.log.at(-1)?.path === "/api/health", describe(mininet.log.at(-1)?.path));

		const stats = await request(port, "/api/lab/stats/h1", { cookie: auth.cookie });
		log("② 参数化路径 /stats/{node_id} 正常", stats.status === 200 && stats.json?.data?.name === "h1" && mininet.log.at(-1)?.path === "/api/mininet/stats/h1", describe(mininet.log.at(-1)?.path));

		const linkStats = await request(port, "/api/lab/links/stats/sw1/h1", { cookie: auth.cookie });
		log("② 多段参数 /links/stats/{src_id}/{dst_id} 正常", linkStats.status === 200 && linkStats.json?.data?.from === "sw1" && linkStats.json?.data?.to === "h1", describe(linkStats.json?.data));

		const unknown = await request(port, "/api/lab/not-a-route", { cookie: auth.cookie });
		log("② 白名单外路径 → 404 bff_resource_not_allowed", unknown.status === 404 && unknown.json?.message === "bff_resource_not_allowed", `${unknown.status} ${describe(unknown.json?.message)}`);

		const excludedExport = await request(port, "/api/lab/export_json", { cookie: auth.cookie });
		log("② 文本 / pcap 导出未登记 → 404（留给下载通道）", excludedExport.status === 404, `${excludedExport.status}`);

		const wrongVerb = await request(port, "/api/lab/hosts", { method: "PUT", cookie: auth.cookie });
		log("② 已登记路径用未登记动词（PUT /hosts）→ 405 bff_method_not_allowed", wrongVerb.status === 405 && wrongVerb.json?.message === "bff_method_not_allowed", `${wrongVerb.status} ${describe(wrongVerb.json?.message)}`);

		const hitsBeforeWrite = mininet.log.length;
		const writePath = await request(port, "/api/lab/terminal/h1", { method: "POST", cookie: auth.cookie });
		log("② 未登记写路径（终端走 /lab-ws）→ 404 且不触达上游", writePath.status === 404 && writePath.json?.message === "bff_resource_not_allowed" && mininet.log.length === hitsBeforeWrite, `${writePath.status} hits=${mininet.log.length - hitsBeforeWrite}`);

		const traversal = await request(port, "/api/lab/stats/%2e%2e%2fetc%2fpasswd", { cookie: auth.cookie });
		log("② 路径穿越（%2e%2e%2f）→ 400 bff_path_invalid", traversal.status === 400 && traversal.json?.message === "bff_path_invalid", `${traversal.status} ${describe(traversal.json?.message)}`);
	});

	// ③ 出站头：客户端自带凭据绝不出网；上游错误原话保真
	await withBff(labEnv({
		NUXT_MININET_INSTANCES: JSON.stringify({ [LAB_TENANT]: { baseUrl: mininetBase } })
	}), async (port) => {
		const auth = await login(port);
		const hitsBefore = mininet.log.length;
		const withCreds = await request(port, "/api/lab/hosts", {
			headers: {
				authorization: `Bearer ${auth.accessToken}`,
				"x-request-id": "req-lab-1",
				"x-tenant-id": "t_other"
			},
			cookie: auth.cookie
		});
		const seen = mininet.log.slice(hitsBefore);

		log("③ 带凭据的只读请求仍到达上游（200）", withCreds.status === 200 && seen.length === 1, `${withCreds.status} hits=${seen.length}`);
		log("③ 出站头不含 authorization", seen.length > 0 && seen.every((item) => item.headers.authorization === undefined), describe(seen[0]?.headers.authorization));
		log("③ 出站头不含 cookie（不读 nmcps_at）", seen.length > 0 && seen.every((item) => item.headers.cookie === undefined), describe(seen[0]?.headers.cookie));
		log("③ 出站头不含 x-tenant-id（客户端伪造头不参与归属）", seen.length > 0 && seen.every((item) => item.headers["x-tenant-id"] === undefined), describe(seen[0]?.headers["x-tenant-id"]));
		log("③ x-request-id 按白名单透传", seen[0]?.headers["x-request-id"] === "req-lab-1", describe(seen[0]?.headers["x-request-id"]));

		const notFound = await request(port, "/api/lab/stats/missing", { cookie: auth.cookie });
		log("③ 上游 404 保真 + detail 原话透出", notFound.status === 404 && notFound.json?.message === "Node missing not found", `${notFound.status} ${describe(notFound.json?.message)}`);
	});

	// ④ P1 鉴权组：无会话 401、凭据错配 401、平台账号 403、无实例 503、角色失败 503
	await withBff(labEnv({
		NUXT_MININET_INSTANCES: JSON.stringify({ [LAB_TENANT]: { baseUrl: mininetBase } })
	}), async (port) => {
		const auth = await login(port);

		const anonymous = await request(port, "/api/lab/hosts");
		log("④ 无签名会话 → 401 bff_auth_required", anonymous.status === 401 && anonymous.json?.message === "bff_auth_required", `${anonymous.status} ${describe(anonymous.json?.message)}`);

		const anonymousChannel = await request(port, "/api/lab/channel");
		log("④ channel 同样要求签名会话", anonymousChannel.status === 401 && anonymousChannel.json?.message === "bff_auth_required", `${anonymousChannel.status} ${describe(anonymousChannel.json?.message)}`);

		const tampered = await request(port, "/api/lab/hosts", {
			cookie: `nmcps_at=${auth.accessToken}; nmcps_sess=v1.invalid.signature`
		});
		log("④ 篡改签名 → 401（不回退未签名 cookie）", tampered.status === 401 && tampered.json?.message === "bff_auth_required", `${tampered.status} ${describe(tampered.json?.message)}`);

		const mismatched = await request(port, "/api/lab/hosts", {
			cookie: `nmcps_at=at-bob; nmcps_sess=${auth.session}`
		});
		log("④ 会话与访问令牌错配 → 401（ath 绑定）", mismatched.status === 401 && mismatched.json?.message === "bff_auth_required", `${mismatched.status} ${describe(mismatched.json?.message)}`);

		const ui = JSON.parse(decodeURIComponent(auth.uiCookie));
		const tamperedUi = encodeURIComponent(JSON.stringify({ ...ui, tenantId: "t_other" }));
		const refresh = await request(port, "/api/auth/refresh", {
			method: "POST",
			headers: { "content-type": "application/json", origin: `http://${HOST}:${port}` },
			cookie: `nmcps_at=${auth.accessToken}; nmcps_sess=${auth.session}; nmcps_rt=${auth.refreshToken}; nmcps_ui=${tamperedUi}`,
			body: "{}"
		});
		const refreshedSession = cookieValue(setCookies(refresh), "nmcps_sess");
		log("④ 刷新不信任未签名 nmcps_ui → tid 仍从旧签名会话继承", refresh.status === 200 && decodeSessionTid(refreshedSession) === LAB_TENANT, `${refresh.status} tid=${describe(decodeSessionTid(refreshedSession))}`);

		const platform = await login(port, "platform");
		const platformLab = await request(port, "/api/lab/hosts", { cookie: platform.cookie });
		log("④ 平台管理员无运行态权限 → 403 lab_permission_denied", platformLab.status === 403 && platformLab.json?.message === "lab_permission_denied", `${platformLab.status} ${describe(platformLab.json?.message)}`);

		const other = await login(port, "bob");
		const otherHits = mininet.log.length;
		const otherLab = await request(port, "/api/lab/hosts", { cookie: other.cookie });
		log("④ 其他租户无实例 → 503 tenant_runtime_unavailable", otherLab.status === 503 && otherLab.json?.message === "tenant_runtime_unavailable", `${otherLab.status} ${describe(otherLab.json?.message)}`);
		log("④ 其他租户请求不触达本租户 Mininet 实例", mininet.log.length === otherHits, `hits=${mininet.log.length - otherHits}`);

		const spoofed = await request(port, "/api/lab/hosts", {
			headers: { "x-tenant-id": "t_other" },
			cookie: auth.cookie
		});
		const spoofedHit = mininet.log.at(-1);
		log("④ 伪造 x-tenant-id 不改变实例选择（仍按会话 t_lab）", spoofed.status === 200 && spoofedHit?.headers["x-tenant-id"] === undefined, `${spoofed.status} ${describe(spoofedHit?.headers["x-tenant-id"])}`);

		const dave = await login(port, "dave");
		iam.state.failRoles = true;
		const roleFailure = await request(port, "/api/lab/hosts", { cookie: dave.cookie });
		iam.state.failRoles = false;
		log("④ IAM 角色查询失败 → 503 bff_role_resolution_failed（不降级为 tenant_user）", roleFailure.status === 503 && roleFailure.json?.message === "bff_role_resolution_failed", `${roleFailure.status} ${describe(roleFailure.json?.message)}`);
	});

	// ⑤ 缺会话密钥：宁可 503，也不回退未签名会话
	await withBff({
		NUXT_BFF_UPSTREAM_BASE: iamBase,
		NUXT_BFF_SESSION_SECRET: "",
		NUXT_MININET_INSTANCES: JSON.stringify({ [LAB_TENANT]: { baseUrl: mininetBase } })
	}, async (port) => {
		const auth = await login(port);
		const noSecret = await request(port, "/api/lab/hosts", { cookie: auth.cookie });
		log("⑤ 缺 NUXT_BFF_SESSION_SECRET → 503 bff_auth_not_configured", noSecret.status === 503 && noSecret.json?.message === "bff_auth_not_configured", `${noSecret.status} ${describe(noSecret.json?.message)}`);
	});

	// ⑥ P2 台账：列表出口过滤、资源清单与跨租户不可见
	await withBff(labEnv({
		NUXT_MININET_INSTANCES: JSON.stringify({
			[LAB_TENANT]: { baseUrl: mininetBase },
			t_other: { baseUrl: mininetBase }
		}),
		NUXT_LAB_LEDGER_FILE: `.data/check-lab-bff-scoped-${process.pid}.json`,
		NUXT_LAB_LEDGER_SEED: JSON.stringify(SCOPED_LEDGER)
	}), async (port) => {
		const auth = await login(port);

		const networks = await request(port, "/api/lab/networks", { cookie: auth.cookie });
		const listed = networks.json?.data ?? [];
		log("⑥ 台账列表只回本租户网络", networks.status === 200 && listed.length === 1 && listed[0]?.id === "net_scoped", `${networks.status} ${describe(listed.map((item) => item.id))}`);
		log("⑥ 台账出参不含 upstream_id / tenant_id", !JSON.stringify(networks.json ?? {}).includes("upstream_id") && !JSON.stringify(networks.json ?? {}).includes("tenant_id"), describe(listed[0]));

		const bob = await login(port, "bob");
		const bobNetworks = await request(port, "/api/lab/networks", { cookie: bob.cookie });
		const bobListed = bobNetworks.json?.data ?? [];
		log("⑥ 另一个租户只看到自己的台账", bobNetworks.status === 200 && bobListed.length === 1 && bobListed[0]?.id === "net_other", `${bobNetworks.status} ${describe(bobListed.map((item) => item.id))}`);

		const hitsBefore = mininet.log.length;
		const deniedNode = await request(port, "/api/lab/stats/h2", { cookie: auth.cookie });
		log("⑥ 清单外节点 → 404 lab_resource_not_found", deniedNode.status === 404 && deniedNode.json?.message === "lab_resource_not_found", `${deniedNode.status} ${describe(deniedNode.json?.message)}`);
		log("⑥ 清单外节点不触达上游", mininet.log.length === hitsBefore, `hits=${mininet.log.length - hitsBefore}`);

		const deniedLink = await request(port, "/api/lab/links/stats/sw1/h2", { cookie: auth.cookie });
		log("⑥ 清单外链路 → 404 且不触达上游", deniedLink.status === 404 && deniedLink.json?.message === "lab_resource_not_found" && mininet.log.length === hitsBefore, `${deniedLink.status} hits=${mininet.log.length - hitsBefore}`);

		const allowedNode = await request(port, "/api/lab/stats/h1", { cookie: auth.cookie });
		log("⑥ 清单内节点仍可读", allowedNode.status === 200 && allowedNode.json?.data?.name === "h1", `${allowedNode.status}`);

		const hosts = await request(port, "/api/lab/hosts", { cookie: auth.cookie });
		const hostNames = (hosts.json?.data ?? []).map((item) => item.name);
		log("⑥ 列表出口丢弃清单外节点", hosts.status === 200 && hostNames.length === 1 && hostNames[0] === "h1", `${hosts.status} ${describe(hostNames)}`);

		const linkStats = await request(port, "/api/lab/links/stats/h1/sw1", { cookie: auth.cookie });
		log("⑥ 清单内链路仍可读", linkStats.status === 200, `${linkStats.status}`);
	});

	// ⑦ 台账不存在：失败关闭，且不能触达上游
	await withBff(labEnv({
		NUXT_MININET_INSTANCES: JSON.stringify({ [LAB_TENANT]: { baseUrl: mininetBase } }),
		NUXT_LAB_LEDGER_FILE: `.data/check-lab-bff-empty-${process.pid}.json`,
		NUXT_LAB_LEDGER_SEED: ""
	}), async (port) => {
		const auth = await login(port);
		const hitsBefore = mininet.log.length;
		const noNetwork = await request(port, "/api/lab/hosts", { cookie: auth.cookie });
		const networks = await request(port, "/api/lab/networks", { cookie: auth.cookie });

		log("⑦ 台账未命中 → 404 lab_resource_not_found", noNetwork.status === 404 && noNetwork.json?.message === "lab_resource_not_found", `${noNetwork.status} ${describe(noNetwork.json?.message)}`);
		log("⑦ 台账未命中不触达上游", mininet.log.length === hitsBefore, `hits=${mininet.log.length - hitsBefore}`);
		log("⑦ 无台账时列表为空而不是报错", networks.status === 200 && Array.isArray(networks.json?.data) && networks.json.data.length === 0, `${networks.status} len=${describe(networks.json?.data?.length)}`);
	});

	// ⑧ 写通道：方法 / 请求体原样到达、审计先写、串行化 409、权限位 403（NMCPS-ADR-0022 W1）
	await withBff(labEnv({
		NUXT_MININET_INSTANCES: JSON.stringify({ [LAB_TENANT]: { baseUrl: mininetBase } })
	}), async (port) => {
		const auth = await login(port);
		const auditFile = `.data/check-lab-audit-${process.pid}/lab-audit.jsonl`;

		const hitsBefore = mininet.log.length;
		const stop = await request(port, "/api/lab/stop", { method: "POST", cookie: auth.cookie });
		const stopHit = mininet.log.slice(hitsBefore).at(-1);
		log("⑧ 有 lab:operate 的写请求到达上游（POST /stop）", stop.status === 200 && stop.json?.data?.ok === true, `${stop.status}`);
		log("⑧ 出站方法 / 路径与白名单一致", stopHit?.method === "POST" && stopHit?.path === "/api/mininet/stop", `${stopHit?.method} ${stopHit?.path}`);

		const body = JSON.stringify({ hosts: ["h1", "h2"], count: 2 });
		const pingall = await request(port, "/api/lab/pingall", { method: "POST", headers: { "content-type": "application/json" }, cookie: auth.cookie, body });
		const pingHit = mininet.log.at(-1);
		log("⑧ 写请求体原样转发", pingall.status === 200 && pingHit?.body === body, `${pingall.status} body=${describe(pingHit?.body)}`);
		log("⑧ 出站 content-type 为 application/json（不转发客户端原始头）", pingHit?.headers["content-type"] === "application/json", describe(pingHit?.headers["content-type"]));

		const entries = readAuditEntries(auditFile);
		const stopEntries = entries.filter((entry) => entry.action === "post /stop");
		log("⑧ 审计先 allowed 后 succeeded", stopEntries.some((item) => item.result === "allowed") && stopEntries.some((item) => item.result === "succeeded"), describe(stopEntries.map((item) => item.result)));
		log("⑧ 审计记录租户 / 主体 / 网络 / request_id", stopEntries.length > 0 && stopEntries.every((item) => item.tenant_id === LAB_TENANT && item.actor_id === "u_lab" && item.network_id === "net_lab" && typeof item.request_id === "string"), describe(stopEntries[0]));

		const slow = (suffix) => request(port, `/api/lab/pingall?__delay=250&k=${suffix}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			cookie: auth.cookie,
			body: "{}"
		});
		const [first, second] = await Promise.all([slow("a"), slow("b")]);
		const statuses = [first.status, second.status].sort();
		log("⑧ 同一网络并发写 → 一个 200、一个 409 lab_operation_in_progress", statuses[0] === 200 && statuses[1] === 409 && [first, second].some((item) => item.json?.message === "lab_operation_in_progress"), describe(statuses));

		const erin = await login(port, "erin");
		const erinChannel = await request(port, "/api/lab/channel", { cookie: erin.cookie });
		log("⑧ tenant_user 的 channel 只读（writeEnabled=false / operate=false）", erinChannel.json?.data?.writeEnabled === false && erinChannel.json?.data?.capabilities?.operate === false, describe(erinChannel.json?.data?.capabilities));

		const erinHits = mininet.log.length;
		const erinStop = await request(port, "/api/lab/stop", { method: "POST", cookie: erin.cookie });
		log("⑧ 无 lab:operate → 403 lab_permission_denied 且不触达上游", erinStop.status === 403 && erinStop.json?.message === "lab_permission_denied" && mininet.log.length === erinHits, `${erinStop.status} hits=${mininet.log.length - erinHits}`);

		const erinDelete = await request(port, "/api/lab/delete_node/h1", { method: "DELETE", cookie: erin.cookie });
		log("⑧ 无 lab:delete → 403（删节点不是读权限兜底）", erinDelete.status === 403, `${erinDelete.status}`);

		const erinReset = await request(port, "/api/lab/full_reset", { method: "POST", cookie: erin.cookie });
		log("⑧ full_reset 双权限：只有读权限 → 403", erinReset.status === 403, `${erinReset.status}`);

		const frank = await login(port, "frank");
		const frankChannel = await request(port, "/api/lab/channel", { cookie: frank.cookie });
		log("⑧ lab_terminal 只拿到 terminal 位（writeEnabled=false）", frankChannel.json?.data?.capabilities?.terminal === true && frankChannel.json?.data?.capabilities?.operate === false && frankChannel.json?.data?.writeEnabled === false, describe(frankChannel.json?.data?.capabilities));

		const frankSniffer = await request(port, "/api/lab/sniffer/start", { method: "POST", cookie: frank.cookie });
		log("⑧ lab_terminal 不能启抓包（需 lab:sniffer）→ 403", frankSniffer.status === 403, `${frankSniffer.status}`);

		const failed = await request(port, "/api/lab/reset", { method: "POST", cookie: auth.cookie });
		const failedEntries = readAuditEntries(auditFile).filter((entry) => entry.action === "post /reset");
		log("⑧ 上游失败仍留 failed 审计", failed.status === 500 && failedEntries.some((entry) => entry.result === "failed"), `${failed.status} ${describe(failedEntries.map((item) => item.result))}`);
	});

	// ⑨ 审计失败关闭：写盘失败即 503，绝不「先做后补」
	// 失败注入：把审计目标目录换成一个**普通文件**，mkdir 立即 EEXIST、append 立即 ENOTDIR。
	// 不用 /proc 等特殊路径：procfs 上 mkdir 会挂住（实测 300s 无返回），会让守卫变成假超时。
	const blockedDir = `.data/check-lab-blocked-${process.pid}`;
	writeFileSync(blockedDir, "blocked", "utf8");
	await withBff(labEnv({
		NUXT_MININET_INSTANCES: JSON.stringify({ [LAB_TENANT]: { baseUrl: mininetBase } }),
		NUXT_LAB_AUDIT_FILE: `${blockedDir}/lab-audit.jsonl`
	}), async (port) => {
		const auth = await login(port);
		const hits = mininet.log.length;
		const denied = await request(port, "/api/lab/stop", { method: "POST", cookie: auth.cookie });

		log("⑨ 审计写盘失败 → 503 audit_unavailable", denied.status === 503 && denied.json?.message === "audit_unavailable", `${denied.status} ${describe(denied.json?.message)}`);
		log("⑨ 审计失败时不触达上游", mininet.log.length === hits, `hits=${mininet.log.length - hits}`);
	});
	rmSync(blockedDir, { force: true });

	const passed = results.filter((item) => item.ok).length;
	console.log(`\n${passed}/${results.length} 项通过`);
	process.exitCode = passed === results.length ? 0 : 1;
} finally {
	await closeUpstream(mininet);
	await closeUpstream(iam);
}
