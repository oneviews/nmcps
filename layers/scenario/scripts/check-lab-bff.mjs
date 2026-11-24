// layers/scenario/scripts/check-lab-bff.mjs
// Mininet 只读 BFF 通道自查（NMCPS-ADR-0020）。
//
// 前置：`pnpm build:server` —— 只消费 `.output/server/index.mjs`，不自行构建。
// 假上游只实现白名单里那些端点的形状，并记录每次请求的 method / path / headers：
// “出站不带 authorization / cookie”“写请求根本没到达上游”必须由上游侧取证。
import { Buffer } from "node:buffer";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { attachSnifferSocket, closeUpstream, freePort, HOST, MININET_LOG_LINES, MININET_MONITOR_SAMPLE, MININET_SNIFFER_LIVE, MININET_TERMINAL_BANNER, MININET_TERMINAL_INTERRUPT_ECHO, SERVER_ENTRY, startBff, stopBff } from "../../../scripts/lib/bff-harness.mjs";

const MININET_ROUTES_SOURCE = "layers/scenario/shared/constants/mininetRoutes.ts";
const MININET_SNAPSHOT_PATH = "packages/contracts/openapi/mininet.json";

/** 测试会话密钥（≥32 字节；生产必须来自 NUXT_BFF_SESSION_SECRET） */
const SESSION_SECRET = "lab-test-session-secret-0123456789abcdef";
const LAB_TENANT = "t_lab";

/**
 * 默认台账：P2 起 `/api/mininet/**` 必须先命中台账才触达上游。
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

/** 字典响应的键（台账清单断言里比 `describe()` 更好读） */
function discoverKeys(value) {
	return value && typeof value === "object" ? `[${Object.keys(value).join(",")}]` : describe(value);
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

/**
 * 二进制下载取证（pcap 导出）：`request()` 走 `res.text()`，会把 `0xd4 0xc3` 解成 U+FFFD，
 * 断言就永远不成立 —— 但「字节原样穿过 BFF」正是要测的东西。
 */
async function requestBytes(port, path, options = {}) {
	const finalHeaders = { ...(options.headers ?? {}) };
	if (options.cookie)
		finalHeaders.cookie = options.cookie;

	const res = await fetch(`http://${HOST}:${port}${path}`, {
		method: options.method ?? "GET",
		headers: finalHeaders,
		redirect: "manual"
	});

	return { status: res.status, headers: res.headers, bytes: Buffer.from(await res.arrayBuffer()) };
}

/**
 * 裸升级请求：只读状态码 + 响应体。
 *
 * Node 自带的 `WebSocket` 客户端拿不到失败握手的 401 与信封内容，
 * 「票过期 / 重放 / 绑定不符一律 401 `lab_ws_ticket_invalid`」只能在握手侧取证。
 */
function upgradeAttempt(port, requestPath) {
	return new Promise((resolve) => {
		const req = httpRequest({
			host: HOST,
			port,
			path: requestPath,
			headers: {
				connection: "Upgrade",
				upgrade: "websocket",
				"sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
				"sec-websocket-version": "13"
			}
		});

		req.on("upgrade", (response, socket) => {
			socket.destroy();
			resolve({ status: response.statusCode ?? 0, body: "" });
		});
		req.on("response", (response) => {
			let body = "";
			response.setEncoding("utf8");
			response.on("data", (chunk) => {
				body += chunk;
			});
			response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
		});
		req.on("error", (error) => resolve({ status: 0, body: String(error?.message ?? error) }));
		req.end();
	});
}

/** 带票连真 WS：收满 `expected` 帧，或 5 秒后带着已收到的帧收工（超时也算取证结果） */
function readSocketMessages(url, expected, sendText) {
	return new Promise((resolve) => {
		const socket = new WebSocket(url);
		const messages = [];
		let settled = false;
		let timer;

		const finish = (extra = {}) => {
			if (settled)
				return;
			settled = true;
			clearTimeout(timer);
			try {
				socket.close();
			} catch {
				// 已断开：忽略
			}
			resolve({ messages, ...extra });
		};

		timer = setTimeout(finish, 5000, { timedOut: true });

		// 终端是唯一有上行的通道：连上后发一行命令，等上游回显（`echo:<行>`）
		if (sendText)
			socket.addEventListener("open", () => socket.send(sendText));

		socket.addEventListener("message", (event) => {
			if (typeof event.data === "string")
				messages.push(event.data);
			if (messages.length >= expected)
				finish();
		});
		socket.addEventListener("error", () => finish({ error: true }));
	});
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

	/**
	 * 可变拓扑：写端点必须让「新建的节点出现在后续列表里」，否则测不出台账清单的收敛。
	 * `POST /switches` 按真实后端回**交换机本体**（不是 `{ ok }` 信封）—— 正是这个形状
	 * 会被出口过滤当成单对象判可见性。
	 */
	const topology = {
		hosts: [
			{ name: "h1", ip: "10.0.0.1", mac: "00:00:00:00:00:01", position: { x: 10, y: 20 } },
			{ name: "h2", ip: "10.0.0.2", mac: "00:00:00:00:00:02", position: { x: 30, y: 40 } }
		],
		switches: { sw1: { id: "sw1", name: "sw1", type: "switch", ports: 4 } },
		// 台账对账（NMCPS-ADR-0023）要读的五类节点 + 链路；默认都为空，⑭ 自己铺事实
		routers: {},
		nats: {},
		controllers: {},
		links: [],
		/** 失败注入：`topology.fail.add("hosts")` 让对应读端点回 500（对账要原样回错且不写台账） */
		fail: new Set()
	};

	/**
	 * 抓包态（NMCPS-ADR-0022 W5）：启停改这个对象，`state` 端点回读。
	 * pcap 用真实 tcpdump 魔数开头 —— 断言的是「字节原样穿过 BFF」，
	 * 用一段 ASCII 假数据就测不出 `response.text()` 那种 UTF-8 解码破坏。
	 */
	const sniffer = {
		active: false,
		pcap: Buffer.from([0xD4, 0xC3, 0xB2, 0xA1, 0x02, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00])
	};

	/**
	 * iperf 应答（NMCPS-ADR-0026 §5）：默认回真后端的成功形状 `{ client, server }`；
	 * `reply` 可切成真后端会回的失败形状（504 客户端超时 / 409 已在跑），供 BFF 层取证
	 * 「状态码与上游原话原样透传」。
	 */
	const iperf = { reply: null };

	/**
	 * 运行态与延迟注入（NMCPS-ADR-0026 D1 / D4）。
	 *
	 * - `runState.started` 决定 `GET /api/mininet/start` 回的裸布尔；`runState.fail` 让同一个
	 *   读端点回 500 —— 台账对账用例要证明「读到 false 就改判、读不到就保持原值」；
	 * - `delays` 按上游路径注入响应延迟：长时预算的用例要的是一个「读端点必然超出短预算、
	 *   长时端点仍在预算内」的真实慢请求，而不是把 BFF 的超时改成 0。
	 */
	const runState = { started: true, fail: false };
	const delays = new Map();

	/**
	 * 入口凭据（M0 远程化）：`token` 非空时所有请求必须带同名 `x-lab-token`，
	 * 否则 401 —— 用例靠它证明「BFF 把服务端配置的 token 真的发出去了」，
	 * 而不是只看 BFF 自己的响应。
	 */
	const auth = { token: "" };
	/** 握手契约（`GET /api/version`）：可切成 `1.4` 验证主版本不一致 */
	const version = { contract: "2.0" };

	/**
	 * 2.0 会话表（NMCPS-DESIGN-008 M1）：`seq` 让 id 可预测（`sim_0001`），
	 * 用例据此断言「BFF 把新会话的 id 写回了台账」。
	 */
	const simulation = { seq: 0, sessions: new Map() };

	const server = createServer(async (req, res) => {
		const url = new URL(req.url, `http://${HOST}:${port}`);
		const path = url.pathname;
		log.push({ method: req.method, path, search: url.search, headers: req.headers });

		const pause = delays.get(path) ?? 0;
		if (pause > 0) {
			await new Promise((resolve) => setTimeout(resolve, pause));
			// 客户端（BFF）可能已经按短预算放弃了这次请求：此时 `req` 已销毁，再 `for await`
			// 读请求体会以 `Error: aborted` 拒绝，而 createServer 的回调不是被 await 的，
			// 未捕获拒绝会直接杀掉这个假上游进程 —— 后面所有用例跟着一起红。
			if (req.destroyed || res.destroyed)
				return;
		}

		const send = (status, payload) => {
			res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
			res.end(JSON.stringify(payload));
		};

		if (path === "/api/health" && req.method === "GET") {
			return send(200, { status: "ok", connected: true, network_started: true, timestamp: "2026-11-15T00:00:00Z" });
		}

		// 握手（M0 远程化）：形状与真实后端一致（`services/mininet-api` 的 `/api/version`）
		if (path === "/api/version" && req.method === "GET") {
			return send(200, { version: "0.3.0", mininet_version: "2.3.0", api_contract: version.contract });
		}

		if (auth.token && req.headers["x-lab-token"] !== auth.token) {
			return send(401, { detail: "lab_token_invalid" });
		}

		// ── 2.0 会话入口（`/api/simulation/**`，NMCPS-DESIGN-008 M1） ──
		// 形状与真实后端（`services/mininet-api` 的 `/api/simulation/**`）一致；`simulation.sessions`
		// 可变，用例靠它证明「BFF 把 session_id 写回了台账、并且只放行绑定的那一个」。
		if (path === "/api/simulation/sessions" || path.startsWith("/api/simulation/sessions/")) {
			let raw = "";
			if (req.method !== "GET") {
				for await (const chunk of req)
					raw += chunk;
				const entry = log.at(-1);
				if (entry)
					entry.body = raw;
			}

			const [, sessionId, resource, resourceId] = path.split("/").filter(Boolean).slice(2);
			const statusOf = (record) => ({
				...record,
				live: {
					engine: record.engine,
					started: record.state === "running",
					node_count: record.nodes.length,
					link_count: record.links.length
				}
			});

			if (!sessionId) {
				if (req.method === "GET") {
					const sessions = [...simulation.sessions.values()].map(statusOf);
					return send(200, { sessions, total: sessions.length });
				}
				if (req.method === "POST") {
					const body = raw ? JSON.parse(raw) : {};
					const id = `sim_${String(++simulation.seq).padStart(4, "0")}`;
					const record = {
						id,
						engine: body.engine ?? "wired",
						name: body.name ?? id,
						state: "created",
						metadata: body.metadata ?? {},
						nodes: [],
						links: []
					};
					simulation.sessions.set(id, record);
					return send(201, statusOf(record));
				}
				return send(405, { detail: "method not allowed" });
			}

			const record = simulation.sessions.get(sessionId);
			if (!record)
				return send(404, { detail: `session_not_found: unknown session '${sessionId}'` });

			if (!resource) {
				if (req.method === "GET")
					return send(200, statusOf(record));
				if (req.method === "DELETE") {
					simulation.sessions.delete(sessionId);
					return send(200, { status: "deleted", id: sessionId });
				}
				return send(405, { detail: "method not allowed" });
			}

			if (resource === "start" || resource === "stop") {
				record.state = resource === "start" ? "running" : "stopped";
				return send(200, statusOf(record));
			}

			if (resource === "nodes") {
				if (req.method === "GET")
					return send(200, record.nodes);
				if (req.method === "POST") {
					const body = JSON.parse(raw || "{}");
					const node = {
						id: body.id,
						type: body.type,
						name: body.name ?? body.id,
						x: body.x ?? 0,
						y: body.y ?? 0,
						attributes: body.attributes ?? {}
					};
					record.nodes.push(node);
					return send(201, node);
				}
				if (req.method === "DELETE" && resourceId) {
					const id = decodeURIComponent(resourceId);
					record.nodes = record.nodes.filter((item) => item.id !== id);
					record.links = record.links.filter((item) => item.src !== id && item.dst !== id);
					return send(200, { status: "deleted", id });
				}
			}

			if (resource === "links") {
				if (req.method === "GET")
					return send(200, record.links);
				if (req.method === "POST") {
					const body = JSON.parse(raw || "{}");
					const link = {
						id: body.id || [body.src, body.dst].sort().join("--"),
						src: body.src,
						dst: body.dst,
						options: body.options ?? {}
					};
					record.links.push(link);
					return send(201, link);
				}
				if (req.method === "DELETE" && resourceId) {
					const id = decodeURIComponent(resourceId);
					record.links = record.links.filter((item) => item.id !== id);
					return send(200, { status: "deleted", id });
				}
			}

			return send(404, { detail: "upstream_not_found" });
		}

		/**
		 * 上游路径与 BFF 前缀同形（NMCPS-ADR-0022 D11）：下面匹配的是**上游收到的**路径，
		 * 浏览器打的是同一个字符串但落在 Nitro 上。判「有没有触达上游」只认本函数记录，
		 * 不要用「浏览器路径 === 上游路径」反推。
		 */
		// 统一节点读（M1.1）：五类分表的投影，形状与真实后端 `GET /api/mininet/nodes` 一致
		// （`id/type/name/x/y` 在顶层，其余键进 `attributes`）。页面拓扑只打这一条。
		if (path === "/api/mininet/nodes" && req.method === "GET") {
			const unified = [];
			const buckets = [["hosts", "host"], ["switches", "switch"], ["routers", "router"], ["nats", "nat"], ["controllers", "controller"]];
			for (const [bucket, type] of buckets) {
				for (const [id, node] of Object.entries(topology[bucket] ?? {})) {
					const { name, x, y, ...attributes } = node;
					unified.push({ id, type, name: name ?? id, x: x ?? 0, y: y ?? 0, attributes });
				}
			}
			return send(200, unified);
		}

		if (path === "/api/mininet/hosts" && req.method === "GET") {
			if (topology.fail.has("hosts"))
				return send(500, { detail: "hosts exploded" });
			return send(200, topology.hosts);
		}

		if (path === "/api/mininet/switches" && req.method === "GET") {
			return send(200, topology.switches);
		}

		// 其余四类节点与链路：对账（NMCPS-ADR-0023）的读取面，形状与真实后端一致
		const nodeCollection = path.match(/^\/api\/mininet\/(routers|nats|controllers)$/);
		if (nodeCollection && req.method === "GET") {
			if (topology.fail.has(nodeCollection[1]))
				return send(500, { detail: `${nodeCollection[1]} exploded` });
			return send(200, topology[nodeCollection[1]]);
		}

		if (path === "/api/mininet/links" && req.method === "GET") {
			if (topology.fail.has("links"))
				return send(500, { detail: "links exploded" });
			return send(200, topology.links);
		}

		if (path === "/api/mininet/start" && req.method === "GET") {
			if (runState.fail)
				return send(500, { detail: "run state exploded" });
			return send(200, runState.started);
		}

		if (path === "/api/mininet/sniffer/state" && req.method === "GET") {
			return send(200, { active: sniffer.active });
		}

		// 抓包启停（W5）：形状与真实后端一致，都回 `{ active }`
		if (path === "/api/mininet/sniffer/start" && req.method === "POST") {
			sniffer.active = true;
			return send(200, { active: sniffer.active });
		}

		if (path === "/api/mininet/sniffer/stop" && req.method === "POST") {
			sniffer.active = false;
			return send(200, { active: sniffer.active });
		}

		// pcap 下载：真实后端回 `Response(content=…, media_type="application/vnd.tcpdump.pcap")`
		if (path === "/api/mininet/sniffer/export" && req.method === "GET") {
			res.writeHead(200, {
				"content-type": "application/vnd.tcpdump.pcap",
				"content-disposition": "attachment; filename=sniffer.pcap"
			});
			return res.end(sniffer.pcap);
		}

		// 整表重建（W5）：清空拓扑对象，后续列表自然为空
		if (path === "/api/mininet/full_reset" && req.method === "POST") {
			topology.hosts = [];
			topology.switches = {};
			sniffer.active = false;
			return send(200, { status: "ok" });
		}

		// 导出通道（NMCPS-ADR-0022 W4）：真实后端回 `PlainTextResponse`，不是 JSON
		if (path === "/api/mininet/export_json" && req.method === "GET") {
			res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
			return res.end(JSON.stringify({ hosts: topology.hosts, switches: topology.switches, links: [] }, null, 4));
		}

		if (path === "/api/mininet/export_script" && req.method === "GET") {
			res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
			return res.end("from mininet.topo import Topo\n\ntopo = Topo()\n");
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

			// 导入：真实后端收 multipart 的 `file` 字段（不是 JSON 包体），照 JSON 转发会 422
			if (path === "/api/mininet/import_json") {
				if (req.headers["content-type"]?.startsWith("multipart/form-data") !== true)
					return send(422, { detail: [{ msg: "field required", loc: ["body", "file"] }] });
				if (!raw.includes("name=\"file\""))
					return send(422, { detail: [{ msg: "field required", loc: ["body", "file"] }] });

				const fileText = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
				const incoming = JSON.parse(fileText);
				for (const host of incoming.hosts ?? [])
					topology.hosts.push({ name: host.name ?? host.id, ip: host.ip });
				for (const sw of incoming.switches ?? [])
					topology.switches[sw.id ?? sw.name] = { ...sw };
				return send(200, { message: "Topology successfully imported" });
			}

			const parsed = raw ? JSON.parse(raw) : undefined;

			// 链路通断（`NMCPS-ADR-0027` §4 R8）：真实后端回 `{ from, to, status, options, intfs }`。
			// 形状要真：`status` 是服务端算出来的目标值（`toggle` 也不由客户端决定）。
			const linkState = path.match(/^\/api\/mininet\/links\/([^/]+)\/([^/]+)\/state$/);
			if (linkState && req.method === "PATCH") {
				if (!["up", "down", "toggle"].includes(parsed?.state))
					return send(422, { detail: [{ msg: "invalid state", loc: ["body", "state"] }] });
				const from = decodeURIComponent(linkState[1]);
				const to = decodeURIComponent(linkState[2]);
				return send(200, {
					from,
					to,
					status: parsed.state === "down" ? "down" : "up",
					options: {},
					intfs: { from: `${from}-eth0`, to: `${to}-eth0` }
				});
			}

			// iperf（NMCPS-ADR-0026 §5）：成功形状 = 真后端的两段输出；失败形状由用例切换
			if (path === "/api/mininet/iperf" && req.method === "POST") {
				if (iperf.reply)
					return send(iperf.reply.status, { detail: iperf.reply.detail });
				return send(200, {
					client: `[  3] 0.00-${parsed?.seconds ?? 5}.00 sec  1.00 GBytes  2.00 Gbits/sec  sender`,
					server: "[  3] 0.00-5.00 sec  1.00 GBytes  2.00 Gbits/sec  receiver"
				});
			}

			// 建节点：真实后端回 `{ status: "ok" }`（switch 除外），节点进可变拓扑
			if (path === "/api/mininet/hosts" && req.method === "POST") {
				const name = parsed?.name ?? parsed?.id;
				topology.hosts.push({ name, ip: parsed?.ip, mac: parsed?.mac, position: { x: parsed?.x, y: parsed?.y } });
				return send(200, { status: "ok" });
			}

			if (path === "/api/mininet/switches" && req.method === "POST") {
				const name = parsed?.name ?? parsed?.id;
				const record = { id: parsed?.id ?? name, name, type: "switch", ports: parsed?.ports };
				topology.switches[name] = record;
				return send(200, record);
			}

			const deleteNode = path.match(/^\/api\/mininet\/delete_node\/([^/]+)$/);
			if (deleteNode && req.method === "DELETE") {
				const id = decodeURIComponent(deleteNode[1]);
				topology.hosts = topology.hosts.filter((item) => item.name !== id);
				delete topology.switches[id];
				return send(200, { status: "ok" });
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
	// 台账对账（⑭）要能直接铺上游事实 / 注入读失败，暴露可变拓扑
	server.topology = topology;
	server.sniffer = sniffer;
	// 运行态 / 延迟注入（NMCPS-ADR-0026 D1 / D4）：⑮ 要直接改上游事实
	server.runState = runState;
	server.delays = delays;
	// iperf 失败形状注入（⑮ 的 iperf 用例）：`mininet.iperf.reply = { status: 504, detail }`
	server.iperf = iperf;
	// 入口凭据与握手契约（M0 远程化）：用例直接改这两处上游事实
	server.auth = auth;
	server.version = version;
	// 2.0 会话表（M1）：⑯ 直接铺一个已绑定的会话
	server.simulation = simulation;
	// 抓包实时流（NMCPS-ADR-0022 D6）：升级记录留在 `snifferSocketLog`，用来证明 BFF 真向上游建了连
	server.snifferSocketLog = attachSnifferSocket(server, { events: MININET_SNIFFER_LIVE });
	return server;
}

/**
 * 假主上游：只实现登录 + 角色解析所需端点，供 `/api/mininet/**` 的签名会话与 RBAC 取证。
 * `failRoles` 可在测试进程内切换，用来验证“角色查询失败不降级为 tenant_user”。
 */
async function startIam(port) {
	const users = {
		alice: { id: "u_lab", username: "alice", tenantId: "t_lab", roleId: "r_admin" },
		bob: { id: "u_other", username: "bob", tenantId: "t_other", roleId: "r_other" },
		dave: { id: "u_dave", username: "dave", tenantId: "t_lab", roleId: "r_admin" },
		erin: { id: "u_reader", username: "erin", tenantId: "t_lab", roleId: "r_user" },
		frank: { id: "u_terminal", username: "frank", tenantId: "t_lab", roleId: "r_terminal" },
		grace: { id: "u_sniffer", username: "grace", tenantId: "t_lab", roleId: "r_sniffer" },
		platform: { id: "u_platform", username: "platform", tenantId: null, roleId: "r_platform" }
	};
	const roles = {
		r_admin: { code: "tenant_admin", tenantId: "t_lab" },
		r_other: { code: "tenant_admin", tenantId: "t_other" },
		r_user: { code: "tenant_user", tenantId: "t_lab" },
		r_terminal: { code: "lab_terminal", tenantId: "t_lab" },
		r_sniffer: { code: "lab_sniffer", tenantId: "t_lab" },
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
	log("⓪ 查询端点 22 条且权限位都是 lab:read", reads.length === 22 && readWithWritePermission.length === 0, `reads=${reads.length} 异常=${readWithWritePermission.map((e) => `${e.method} ${e.template}`).join(", ") || "无"}`);
	log("⓪ 写端点 37 条且都带非读权限位", writes.length === 37 && writeWithoutPermission.length === 0, `writes=${writes.length} 异常=${writeWithoutPermission.map((e) => `${e.method} ${e.template}`).join(", ") || "无"}`);
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

		const channel = await request(port, "/api/mininet/channel", { cookie: auth.cookie });
		log("① 未配租户实例的 channel 仍 200 且 configured=false", channel.status === 200 && channel.json?.data?.configured === false, `${channel.status} ${describe(channel.json?.data?.configured)}`);
		log("① channel 按会话算能力位（租户管理员 writeEnabled=true，终端/抓包仍 false）", channel.json?.data?.readOnly === false && channel.json?.data?.writeEnabled === true && channel.json?.data?.capabilities?.create === true && channel.json?.data?.capabilities?.operate === true && channel.json?.data?.capabilities?.delete === true && channel.json?.data?.capabilities?.terminal === false && channel.json?.data?.capabilities?.sniffer === false && channel.json?.data?.endpointCount === 59, describe(channel.json?.data));
		log("① channel 不回传 baseUrl", !JSON.stringify(channel.json ?? {}).includes(mininetBase), describe(channel.json?.data));

		const noPath = await request(port, "/api/mininet");
		log("① /api/mininet 无路径段 → 400 bff_path_missing", noPath.status === 400 && noPath.json?.message === "bff_path_missing", `${noPath.status} ${describe(noPath.json?.message)}`);

		const noPathSlash = await request(port, "/api/mininet/");
		log("① /api/mininet/ 同样 400（不回落到主网关 404）", noPathSlash.status === 400 && noPathSlash.json?.message === "bff_path_missing", `${noPathSlash.status} ${describe(noPathSlash.headers.get("content-type"))}`);

		const unconfigured = await request(port, "/api/mininet/hosts", { cookie: auth.cookie });
		log("① 租户无实例 → 503 tenant_runtime_unavailable（不是全局 mininet_not_configured）", unconfigured.status === 503 && unconfigured.json?.message === "tenant_runtime_unavailable", `${unconfigured.status} ${describe(unconfigured.json?.message)}`);
		log("① 租户无实例不触达 Mininet", mininet.log.length === hitsBefore, `hits=${mininet.log.length - hitsBefore}`);
	});
	// ①b 远程化（M0）：握手 + 入口凭据由服务端配置发出，客户端无法覆盖
	await withBff(labEnv({
		NUXT_MININET_INSTANCES: JSON.stringify({ [LAB_TENANT]: { baseUrl: mininetBase } }),
		NUXT_MININET_TOKEN: "lab-check-secret"
	}), async (port) => {
		const auth = await login(port);
		mininet.auth.token = "lab-check-secret";
		try {
			const handshake = await request(port, "/api/mininet/version", { cookie: auth.cookie });
			log(
				"①b 握手：GET /api/version 读上游并回契约判定（compatible=true）",
				handshake.status === 200
				&& handshake.json?.data?.apiContract === "2.0"
				&& handshake.json?.data?.compatible === true
				&& handshake.json?.data?.expectedContract === "2.0"
				&& handshake.json?.data?.version === "0.3.0",
				`${handshake.status} ${describe(handshake.json?.data)}`
			);
			log(
				"①b 握手：tokenConfigured=true 但正文不含 token 明文",
				handshake.json?.data?.tokenConfigured === true && !JSON.stringify(handshake.json ?? {}).includes("lab-check-secret"),
				describe(handshake.json?.data?.tokenConfigured)
			);

			const hosts = await request(port, "/api/mininet/hosts", { cookie: auth.cookie });
			const hit = mininet.log.at(-1);
			log(
				"①b 出站带 x-lab-token：上游开启校验后仍 200（凭据真的发出去了）",
				hosts.status === 200 && hit?.path === "/api/mininet/hosts" && hit?.headers?.["x-lab-token"] === "lab-check-secret",
				`${hosts.status} header=${describe(hit?.headers?.["x-lab-token"])}`
			);

			const spoofed = await request(port, "/api/mininet/hosts", {
				cookie: auth.cookie,
				headers: { "x-lab-token": "forged-by-client" }
			});
			const spoofHit = mininet.log.at(-1);
			log(
				"①b 客户端自带的 x-lab-token 不能覆盖服务端配置",
				spoofed.status === 200 && spoofHit?.headers?.["x-lab-token"] === "lab-check-secret",
				`${spoofed.status} header=${describe(spoofHit?.headers?.["x-lab-token"])}`
			);

			mininet.version.contract = "1.4";
			const mismatched = await request(port, "/api/mininet/version", { cookie: auth.cookie });
			log(
				"①b 契约主版本不一致 → compatible=false（不拦读，但当场可见）",
				mismatched.status === 200 && mismatched.json?.data?.compatible === false && mismatched.json?.data?.apiContract === "1.4",
				describe(mismatched.json?.data?.apiContract)
			);
		} finally {
			mininet.auth.token = "";
			mininet.version.contract = "2.0";
		}
	});

	// 未配 token：握手照常（tokenConfigured=false），出站不带该头
	await withBff(labEnv({
		NUXT_MININET_INSTANCES: JSON.stringify({ [LAB_TENANT]: { baseUrl: mininetBase } })
	}), async (port) => {
		const auth = await login(port);
		const handshake = await request(port, "/api/mininet/version", { cookie: auth.cookie });
		const hosts = await request(port, "/api/mininet/hosts", { cookie: auth.cookie });
		const hit = mininet.log.at(-1);
		log(
			"①b 未配 token：tokenConfigured=false 且出站不带 x-lab-token（回环信任）",
			handshake.status === 200
			&& handshake.json?.data?.tokenConfigured === false
			&& hosts.status === 200
			&& hit?.headers?.["x-lab-token"] === undefined,
			`tokenConfigured=${describe(handshake.json?.data?.tokenConfigured)} header=${describe(hit?.headers?.["x-lab-token"])}`
		);
	});

	// ② 白名单、查询参数与拒绝边界（全部带签名会话）
	await withBff(labEnv({
		NUXT_MININET_INSTANCES: JSON.stringify({ [LAB_TENANT]: { baseUrl: mininetBase } })
	}), async (port) => {
		const auth = await login(port);
		const channel = await request(port, "/api/mininet/channel", { cookie: auth.cookie });
		log("② 租户实例命中后 channel configured=true", channel.json?.data?.configured === true, describe(channel.json?.data?.configured));

		const hitsBefore = mininet.log.length;
		const hosts = await request(port, "/api/mininet/hosts?limit=2&tag=a&tag=b", { cookie: auth.cookie });
		const hostHit = mininet.log.slice(hitsBefore).at(-1);
		log("② 白名单内 GET 到达上游且裸 JSON 套信封", hosts.status === 200 && hosts.json?.code === 0 && hosts.json?.data?.length === 2, `${hosts.status} len=${describe(hosts.json?.data?.length)}`);
		log("② 查询参数原样转发（重复键保留）", hostHit?.path === "/api/mininet/hosts" && hostHit?.search === "?limit=2&tag=a&tag=b", describe(hostHit?.search));

		const unifiedBefore = mininet.log.length;
		const unified = await request(port, "/api/mininet/nodes", { cookie: auth.cookie });
		const unifiedHit = mininet.log.slice(unifiedBefore).at(-1);
		log(
			"② 统一节点读（M1.1）：GET /nodes 转发上游 /api/mininet/nodes，回统一投影（type 在顶层 + attributes）",
			unified.status === 200
			&& unifiedHit?.path === "/api/mininet/nodes"
			&& Array.isArray(unified.json?.data) && unified.json.data.length > 0
			&& unified.json.data.every((node) => typeof node.type === "string" && node.attributes && typeof node.attributes === "object"),
			`${unified.status} ${describe(unifiedHit?.path)} nodes=${describe(unified.json?.data?.length)}`
		);

		const health = await request(port, "/api/mininet/health", { cookie: auth.cookie });
		log("② 探针端点映射到上游 /api/health（不是 /api/mininet/health）", health.status === 200 && health.json?.data?.status === "ok" && mininet.log.at(-1)?.path === "/api/health", describe(mininet.log.at(-1)?.path));

		const stats = await request(port, "/api/mininet/stats/h1", { cookie: auth.cookie });
		log("② 参数化路径 /stats/{node_id} 正常", stats.status === 200 && stats.json?.data?.name === "h1" && mininet.log.at(-1)?.path === "/api/mininet/stats/h1", describe(mininet.log.at(-1)?.path));

		const linkStats = await request(port, "/api/mininet/links/stats/sw1/h1", { cookie: auth.cookie });
		log("② 多段参数 /links/stats/{src_id}/{dst_id} 正常", linkStats.status === 200 && linkStats.json?.data?.from === "sw1" && linkStats.json?.data?.to === "h1", describe(linkStats.json?.data));

		const unknown = await request(port, "/api/mininet/not-a-route", { cookie: auth.cookie });
		log("② 白名单外路径 → 404 bff_resource_not_allowed", unknown.status === 404 && unknown.json?.message === "bff_resource_not_allowed", `${unknown.status} ${describe(unknown.json?.message)}`);

		const excludedExport = await request(port, "/api/mininet/export_json", { cookie: auth.cookie });
		log("② 上游扁平导出名不进白名单（BFF 的导出走 /api/mininet/export/{json|script}，见 ⑩）→ 404", excludedExport.status === 404, `${excludedExport.status}`);

		const wrongVerb = await request(port, "/api/mininet/hosts", { method: "PUT", cookie: auth.cookie });
		log("② 已登记路径用未登记动词（PUT /hosts）→ 405 bff_method_not_allowed", wrongVerb.status === 405 && wrongVerb.json?.message === "bff_method_not_allowed", `${wrongVerb.status} ${describe(wrongVerb.json?.message)}`);

		const hitsBeforeWrite = mininet.log.length;
		const writePath = await request(port, "/api/mininet/terminal/h1", { method: "POST", cookie: auth.cookie });
		log("② 未登记写路径（终端走 /mininet-ws）→ 404 且不触达上游", writePath.status === 404 && writePath.json?.message === "bff_resource_not_allowed" && mininet.log.length === hitsBeforeWrite, `${writePath.status} hits=${mininet.log.length - hitsBeforeWrite}`);

		const traversal = await request(port, "/api/mininet/stats/%2e%2e%2fetc%2fpasswd", { cookie: auth.cookie });
		log("② 路径穿越（%2e%2e%2f）→ 400 bff_path_invalid", traversal.status === 400 && traversal.json?.message === "bff_path_invalid", `${traversal.status} ${describe(traversal.json?.message)}`);
	});

	// ③ 出站头：客户端自带凭据绝不出网；上游错误原话保真
	await withBff(labEnv({
		NUXT_MININET_INSTANCES: JSON.stringify({ [LAB_TENANT]: { baseUrl: mininetBase } })
	}), async (port) => {
		const auth = await login(port);
		const hitsBefore = mininet.log.length;
		const withCreds = await request(port, "/api/mininet/hosts", {
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

		const notFound = await request(port, "/api/mininet/stats/missing", { cookie: auth.cookie });
		log("③ 上游 404 保真 + detail 原话透出", notFound.status === 404 && notFound.json?.message === "Node missing not found", `${notFound.status} ${describe(notFound.json?.message)}`);
	});

	// ④ P1 鉴权组：无会话 401、凭据错配 401、平台账号 403、无实例 503、角色失败 503
	await withBff(labEnv({
		NUXT_MININET_INSTANCES: JSON.stringify({ [LAB_TENANT]: { baseUrl: mininetBase } })
	}), async (port) => {
		const auth = await login(port);

		const anonymous = await request(port, "/api/mininet/hosts");
		log("④ 无签名会话 → 401 bff_auth_required", anonymous.status === 401 && anonymous.json?.message === "bff_auth_required", `${anonymous.status} ${describe(anonymous.json?.message)}`);

		const anonymousChannel = await request(port, "/api/mininet/channel");
		log("④ channel 同样要求签名会话", anonymousChannel.status === 401 && anonymousChannel.json?.message === "bff_auth_required", `${anonymousChannel.status} ${describe(anonymousChannel.json?.message)}`);

		const tampered = await request(port, "/api/mininet/hosts", {
			cookie: `nmcps_at=${auth.accessToken}; nmcps_sess=v1.invalid.signature`
		});
		log("④ 篡改签名 → 401（不回退未签名 cookie）", tampered.status === 401 && tampered.json?.message === "bff_auth_required", `${tampered.status} ${describe(tampered.json?.message)}`);

		const mismatched = await request(port, "/api/mininet/hosts", {
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
		const platformLab = await request(port, "/api/mininet/hosts", { cookie: platform.cookie });
		log("④ 平台管理员无运行态权限 → 403 lab_permission_denied", platformLab.status === 403 && platformLab.json?.message === "lab_permission_denied", `${platformLab.status} ${describe(platformLab.json?.message)}`);

		const other = await login(port, "bob");
		const otherHits = mininet.log.length;
		const otherLab = await request(port, "/api/mininet/hosts", { cookie: other.cookie });
		log("④ 其他租户无实例 → 503 tenant_runtime_unavailable", otherLab.status === 503 && otherLab.json?.message === "tenant_runtime_unavailable", `${otherLab.status} ${describe(otherLab.json?.message)}`);
		log("④ 其他租户请求不触达本租户 Mininet 实例", mininet.log.length === otherHits, `hits=${mininet.log.length - otherHits}`);

		const spoofed = await request(port, "/api/mininet/hosts", {
			headers: { "x-tenant-id": "t_other" },
			cookie: auth.cookie
		});
		const spoofedHit = mininet.log.at(-1);
		log("④ 伪造 x-tenant-id 不改变实例选择（仍按会话 t_lab）", spoofed.status === 200 && spoofedHit?.headers["x-tenant-id"] === undefined, `${spoofed.status} ${describe(spoofedHit?.headers["x-tenant-id"])}`);

		const dave = await login(port, "dave");
		iam.state.failRoles = true;
		const roleFailure = await request(port, "/api/mininet/hosts", { cookie: dave.cookie });
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
		const noSecret = await request(port, "/api/mininet/hosts", { cookie: auth.cookie });
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

		const networks = await request(port, "/api/mininet/networks", { cookie: auth.cookie });
		const listed = networks.json?.data ?? [];
		log("⑥ 台账列表只回本租户网络", networks.status === 200 && listed.length === 1 && listed[0]?.id === "net_scoped", `${networks.status} ${describe(listed.map((item) => item.id))}`);
		log("⑥ 台账出参不含 upstream_id / tenant_id", !JSON.stringify(networks.json ?? {}).includes("upstream_id") && !JSON.stringify(networks.json ?? {}).includes("tenant_id"), describe(listed[0]));

		const bob = await login(port, "bob");
		const bobNetworks = await request(port, "/api/mininet/networks", { cookie: bob.cookie });
		const bobListed = bobNetworks.json?.data ?? [];
		log("⑥ 另一个租户只看到自己的台账", bobNetworks.status === 200 && bobListed.length === 1 && bobListed[0]?.id === "net_other", `${bobNetworks.status} ${describe(bobListed.map((item) => item.id))}`);

		const hitsBefore = mininet.log.length;
		const deniedNode = await request(port, "/api/mininet/stats/h2", { cookie: auth.cookie });
		log("⑥ 清单外节点 → 404 lab_resource_not_found", deniedNode.status === 404 && deniedNode.json?.message === "lab_resource_not_found", `${deniedNode.status} ${describe(deniedNode.json?.message)}`);
		log("⑥ 清单外节点不触达上游", mininet.log.length === hitsBefore, `hits=${mininet.log.length - hitsBefore}`);

		const deniedLink = await request(port, "/api/mininet/links/stats/sw1/h2", { cookie: auth.cookie });
		log("⑥ 清单外链路 → 404 且不触达上游", deniedLink.status === 404 && deniedLink.json?.message === "lab_resource_not_found" && mininet.log.length === hitsBefore, `${deniedLink.status} hits=${mininet.log.length - hitsBefore}`);

		const allowedNode = await request(port, "/api/mininet/stats/h1", { cookie: auth.cookie });
		log("⑥ 清单内节点仍可读", allowedNode.status === 200 && allowedNode.json?.data?.name === "h1", `${allowedNode.status}`);

		const hosts = await request(port, "/api/mininet/hosts", { cookie: auth.cookie });
		const hostNames = (hosts.json?.data ?? []).map((item) => item.name);
		log("⑥ 列表出口丢弃清单外节点", hosts.status === 200 && hostNames.length === 1 && hostNames[0] === "h1", `${hosts.status} ${describe(hostNames)}`);

		const linkStats = await request(port, "/api/mininet/links/stats/h1/sw1", { cookie: auth.cookie });
		log("⑥ 清单内链路仍可读", linkStats.status === 200, `${linkStats.status}`);

		/*
		 * 清单必须跟着写操作收敛（NMCPS-ADR-0021 P2 / NMCPS-ADR-0022 写路径）：
		 * 上游 `POST /switches` 回的是交换机本体，若出口过滤照旧套「写前那份清单」，
		 * 一次成功的建交换机会被判成 404 —— 页面显示“创建失败 lab_resource_not_found”。
		 * 建完的节点还必须出现在后续列表里，否则画布上永远看不到它。
		 */
		const switchBody = JSON.stringify({ id: "sw2", type: "switch", name: "sw2", label: "sw2", x: 400, y: 250, ports: 4, controller: null, switch_type: "ovskernel" });
		const createdSwitch = await request(port, "/api/mininet/switches", {
			method: "POST",
			headers: { "content-type": "application/json" },
			cookie: auth.cookie,
			body: switchBody
		});
		log("⑥ 建交换机（单对象写响应）→ 200，不被写前清单判成 404", createdSwitch.status === 200 && createdSwitch.json?.data?.name === "sw2", `${createdSwitch.status} ${describe(createdSwitch.json?.message ?? createdSwitch.json?.data?.name)}`);

		const switchesAfter = await request(port, "/api/mininet/switches", { cookie: auth.cookie });
		log("⑥ 新建交换机进入台账清单、列表可见", switchesAfter.status === 200 && !!switchesAfter.json?.data?.sw2 && !!switchesAfter.json?.data?.sw1, discoverKeys(switchesAfter.json?.data));

		const createdHost = await request(port, "/api/mininet/hosts", {
			method: "POST",
			headers: { "content-type": "application/json" },
			cookie: auth.cookie,
			body: JSON.stringify({ id: "h3", type: "host", name: "h3", label: "h3", x: 300, y: 200, ip: "10.0.0.3", mac: "00:00:00:00:00:03" })
		});
		const hostsAfter = await request(port, "/api/mininet/hosts", { cookie: auth.cookie });
		const hostsAfterNames = (hostsAfter.json?.data ?? []).map((item) => item.name);
		log("⑥ 新建主机进入台账清单、列表可见（不再被出口过滤丢掉）", createdHost.status === 200 && hostsAfterNames.includes("h3") && hostsAfterNames.includes("h1"), `${createdHost.status} ${describe(hostsAfterNames)}`);

		const removed = await request(port, "/api/mininet/delete_node/sw2", { method: "DELETE", cookie: auth.cookie });
		const switchesFinal = await request(port, "/api/mininet/switches", { cookie: auth.cookie });
		const deniedAfterRemove = await request(port, "/api/mininet/flows/sw2", { cookie: auth.cookie });
		log("⑥ 删节点后出清单：列表不见、路径参数重新 404", removed.status === 200 && !switchesFinal.json?.data?.sw2 && deniedAfterRemove.status === 404, `${removed.status} keys=${discoverKeys(switchesFinal.json?.data)} flows=${deniedAfterRemove.status}`);
	});

	// ⑦ 台账不存在：失败关闭，且不能触达上游
	await withBff(labEnv({
		NUXT_MININET_INSTANCES: JSON.stringify({ [LAB_TENANT]: { baseUrl: mininetBase } }),
		NUXT_LAB_LEDGER_FILE: `.data/check-lab-bff-empty-${process.pid}.json`,
		NUXT_LAB_LEDGER_SEED: ""
	}), async (port) => {
		const auth = await login(port);
		const hitsBefore = mininet.log.length;
		const noNetwork = await request(port, "/api/mininet/hosts", { cookie: auth.cookie });
		const networks = await request(port, "/api/mininet/networks", { cookie: auth.cookie });

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
		const stop = await request(port, "/api/mininet/stop", { method: "POST", cookie: auth.cookie });
		const stopHit = mininet.log.slice(hitsBefore).at(-1);
		log("⑧ 有 lab:operate 的写请求到达上游（POST /stop）", stop.status === 200 && stop.json?.data?.ok === true, `${stop.status}`);
		log("⑧ 出站方法 / 路径与白名单一致", stopHit?.method === "POST" && stopHit?.path === "/api/mininet/stop", `${stopHit?.method} ${stopHit?.path}`);

		const body = JSON.stringify({ hosts: ["h1", "h2"], count: 2 });
		const pingall = await request(port, "/api/mininet/pingall", { method: "POST", headers: { "content-type": "application/json" }, cookie: auth.cookie, body });
		const pingHit = mininet.log.at(-1);
		log("⑧ 写请求体原样转发", pingall.status === 200 && pingHit?.body === body, `${pingall.status} body=${describe(pingHit?.body)}`);
		log("⑧ 出站 content-type 为 application/json（不转发客户端原始头）", pingHit?.headers["content-type"] === "application/json", describe(pingHit?.headers["content-type"]));

		// 链路通断（`NMCPS-ADR-0027` §4 R8）：路径两段都编码、`state` 原样到达、返回值是上游的 `status`
		const stateBody = JSON.stringify({ state: "down" });
		const stateHitBefore = mininet.log.length;
		const linkDown = await request(port, "/api/mininet/links/h1/h2/state", { method: "PATCH", headers: { "content-type": "application/json" }, cookie: auth.cookie, body: stateBody });
		const stateHit = mininet.log.slice(stateHitBefore).at(-1);
		log("⑧ PATCH 链路通断到达上游且方法 / 路径一致", linkDown.status === 200 && stateHit?.method === "PATCH" && stateHit?.path === "/api/mininet/links/h1/h2/state", `${linkDown.status} ${stateHit?.method} ${stateHit?.path}`);
		log("⑧ 链路通断的 state 原样转发、回上游算出的 status", stateHit?.body === stateBody && linkDown.json?.data?.status === "down" && linkDown.json?.data?.from === "h1", `body=${describe(stateHit?.body)} status=${describe(linkDown.json?.data?.status)}`);

		const entries = readAuditEntries(auditFile);
		const stopEntries = entries.filter((entry) => entry.action === "post /stop");
		log("⑧ 审计先 allowed 后 succeeded", stopEntries.some((item) => item.result === "allowed") && stopEntries.some((item) => item.result === "succeeded"), describe(stopEntries.map((item) => item.result)));
		log("⑧ 审计记录租户 / 主体 / 网络 / request_id", stopEntries.length > 0 && stopEntries.every((item) => item.tenant_id === LAB_TENANT && item.actor_id === "u_lab" && item.network_id === "net_lab" && typeof item.request_id === "string"), describe(stopEntries[0]));

		const slow = (suffix) => request(port, `/api/mininet/pingall?__delay=250&k=${suffix}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			cookie: auth.cookie,
			body: "{}"
		});
		const [first, second] = await Promise.all([slow("a"), slow("b")]);
		const statuses = [first.status, second.status].sort();
		log("⑧ 同一网络并发写 → 一个 200、一个 409 lab_operation_in_progress", statuses[0] === 200 && statuses[1] === 409 && [first, second].some((item) => item.json?.message === "lab_operation_in_progress"), describe(statuses));

		const erin = await login(port, "erin");
		const erinChannel = await request(port, "/api/mininet/channel", { cookie: erin.cookie });
		log("⑧ tenant_user 的 channel 只读（writeEnabled=false / operate=false）", erinChannel.json?.data?.writeEnabled === false && erinChannel.json?.data?.capabilities?.operate === false, describe(erinChannel.json?.data?.capabilities));

		const erinHits = mininet.log.length;
		const erinStop = await request(port, "/api/mininet/stop", { method: "POST", cookie: erin.cookie });
		log("⑧ 无 lab:operate → 403 lab_permission_denied 且不触达上游", erinStop.status === 403 && erinStop.json?.message === "lab_permission_denied" && mininet.log.length === erinHits, `${erinStop.status} hits=${mininet.log.length - erinHits}`);

		const erinDelete = await request(port, "/api/mininet/delete_node/h1", { method: "DELETE", cookie: erin.cookie });
		log("⑧ 无 lab:delete → 403（删节点不是读权限兜底）", erinDelete.status === 403, `${erinDelete.status}`);

		const erinReset = await request(port, "/api/mininet/full_reset", { method: "POST", cookie: erin.cookie });
		log("⑧ full_reset 双权限：只有读权限 → 403", erinReset.status === 403, `${erinReset.status}`);

		const erinStateHits = mininet.log.length;
		const erinState = await request(port, "/api/mininet/links/h1/h2/state", { method: "PATCH", headers: { "content-type": "application/json" }, cookie: erin.cookie, body: JSON.stringify({ state: "down" }) });
		log("⑧ 无 lab:operate → 链路通断 403 且不触达上游", erinState.status === 403 && erinState.json?.message === "lab_permission_denied" && mininet.log.length === erinStateHits, `${erinState.status} hits=${mininet.log.length - erinStateHits}`);

		const frank = await login(port, "frank");
		const frankChannel = await request(port, "/api/mininet/channel", { cookie: frank.cookie });
		log("⑧ lab_terminal 只拿到 terminal 位（writeEnabled=false）", frankChannel.json?.data?.capabilities?.terminal === true && frankChannel.json?.data?.capabilities?.operate === false && frankChannel.json?.data?.writeEnabled === false, describe(frankChannel.json?.data?.capabilities));

		const frankSniffer = await request(port, "/api/mininet/sniffer/start", { method: "POST", cookie: frank.cookie });
		log("⑧ lab_terminal 不能启抓包（需 lab:sniffer）→ 403", frankSniffer.status === 403, `${frankSniffer.status}`);

		const failed = await request(port, "/api/mininet/reset", { method: "POST", cookie: auth.cookie });
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
		const denied = await request(port, "/api/mininet/stop", { method: "POST", cookie: auth.cookie });

		log("⑨ 审计写盘失败 → 503 audit_unavailable", denied.status === 503 && denied.json?.message === "audit_unavailable", `${denied.status} ${describe(denied.json?.message)}`);
		log("⑨ 审计失败时不触达上游", mininet.log.length === hits, `hits=${mininet.log.length - hits}`);
	});
	rmSync(blockedDir, { force: true });

	// ⑩ 导出 / 导入（NMCPS-ADR-0022 W4 / §五）：文本直出、导入按 multipart 出站、清单按并集收敛
	await withBff(labEnv({
		NUXT_MININET_INSTANCES: JSON.stringify({ [LAB_TENANT]: { baseUrl: mininetBase } }),
		NUXT_LAB_LEDGER_FILE: `.data/check-lab-bff-export-${process.pid}.json`,
		NUXT_LAB_LEDGER_SEED: JSON.stringify(SCOPED_LEDGER)
	}), async (port) => {
		const auth = await login(port);

		/*
		 * 导出为什么必须「直出」：`export_json` 的正文本身就是一份 JSON 文本，
		 * 一旦被 `ApiResponse` 包成 `data: "{\"hosts\":...}"`，浏览器另存的文件是
		 * 一个字符串而不是拓扑，`wget` 下来也不能再导入。
		 */
		const exported = await request(port, "/api/mininet/export/json", { cookie: auth.cookie });
		log("⑩ 导出 JSON 直出文本（不套 JSON 信封）", exported.status === 200 && exported.text.trimStart().startsWith("{") && exported.json?.hosts !== undefined, `${exported.status} ${describe(exported.text.slice(0, 24))}`);
		log("⑩ 导出 content-type 为 text/plain", (exported.headers.get("content-type") ?? "").startsWith("text/plain"), describe(exported.headers.get("content-type")));

		const disposition = exported.headers.get("content-disposition") ?? "";
		log("⑩ 文件名由 BFF 生成，不信任上游", /^attachment; filename="lab-net_scoped-\d{8}T\d{6}Z\.json"$/.test(disposition), describe(disposition));

		const script = await request(port, "/api/mininet/export/script", { cookie: auth.cookie });
		log("⑩ 导出脚本直出 Python 源码（扩展名 .py）", script.status === 200 && script.text.startsWith("from mininet.topo import Topo") && (script.headers.get("content-disposition") ?? "").endsWith(".py\""), `${script.status} ${describe(script.text.slice(0, 24))}`);

		const unknownExport = await request(port, "/api/mininet/export/xml", { cookie: auth.cookie });
		log("⑩ 未登记导出种类 → 400 bff_path_invalid", unknownExport.status === 400 && unknownExport.json?.message === "bff_path_invalid", `${unknownExport.status} ${describe(unknownExport.json?.message)}`);

		const importHitsBefore = mininet.log.length;
		// 导入的正文就是 `export_json` 的产物（台账形状），这样才能原样回灌
		const imported = await request(port, "/api/mininet/import_json", {
			method: "POST",
			headers: { "content-type": "application/json" },
			cookie: auth.cookie,
			body: JSON.stringify({
				hosts: [{ name: "h4", ip: "10.0.0.4" }],
				switches: [{ id: "sw9", name: "sw9" }],
				controllers: [{ id: "ctl1" }],
				links: [["h4", "sw9"], ["sw9", "ctl1"]]
			})
		});
		log("⑩ 导入 → 200（写响应不被写前资源清单判成 404）", imported.status === 200, `${imported.status} ${describe(imported.json?.message)}`);

		const importHit = mininet.log.slice(importHitsBefore).find((item) => item.path === "/api/mininet/import_json");
		const importType = String(importHit?.headers?.["content-type"] ?? "");
		log("⑩ 导入按 multipart 出站（上游只收 `file` 字段）", importType.startsWith("multipart/form-data; boundary="), describe(importType));
		log("⑩ 出站文件正文是原样拓扑 JSON", typeof importHit?.body === "string" && importHit.body.includes("name=\"file\"") && importHit.body.includes("\"h4\""), describe(typeof importHit?.body === "string" ? importHit.body.slice(0, 48) : importHit?.body));

		const hostsAfter = await request(port, "/api/mininet/hosts", { cookie: auth.cookie });
		const hostNamesAfter = (hostsAfter.json?.data ?? []).map((item) => item.name);
		log("⑩ 导入的节点进清单且既有节点不丢（并集收敛）", hostNamesAfter.includes("h4") && hostNamesAfter.includes("h1"), describe(hostNamesAfter));

		const switchesAfter = await request(port, "/api/mininet/switches", { cookie: auth.cookie });
		log("⑩ 导入的交换机也进清单", !!switchesAfter.json?.data?.sw9, discoverKeys(switchesAfter.json?.data));

		// 控制器与交换机的连线不是链路：它只让两端节点进清单，链路键不登记
		const importedLink = await request(port, "/api/mininet/links/stats/h4/sw9", { cookie: auth.cookie });
		const controllerEdge = await request(port, "/api/mininet/links/stats/sw9/ctl1", { cookie: auth.cookie });
		log("⑩ 导入的链路进清单、controller 关联线不算链路", importedLink.status === 200 && controllerEdge.status === 404 && controllerEdge.json?.message === "lab_resource_not_found", `link=${importedLink.status} ctlEdge=${controllerEdge.status}`);
	});

	// ⑪ 抓包（W5）：pcap 走 `lab:sniffer` 独立授权 + 二进制直出；full_reset 要网络 id 二次确认
	await withBff(labEnv({
		NUXT_MININET_INSTANCES: JSON.stringify({ [LAB_TENANT]: { baseUrl: mininetBase } }),
		NUXT_LAB_LEDGER_FILE: `.data/check-lab-bff-sniffer-${process.pid}.json`,
		NUXT_LAB_LEDGER_SEED: JSON.stringify(SCOPED_LEDGER)
	}), async (port) => {
		/*
		 * 抓包文件是全网流量原文：`lab:read` / `lab:operate` 都不能换 pcap
		 * （NMCPS-ADR-0021 D3）。租户管理员（alice）有全部写权限位，唯独没有 sniffer。
		 */
		const admin = await login(port);
		const adminHits = mininet.log.length;
		const adminPcap = await request(port, "/api/mininet/export/pcap", { cookie: admin.cookie });
		log("⑪ 无 lab:sniffer 导出 pcap → 403 且不触达上游", adminPcap.status === 403 && adminPcap.json?.message === "lab_permission_denied" && mininet.log.length === adminHits, `${adminPcap.status} hits=${mininet.log.length - adminHits}`);

		const grace = await login(port, "grace");
		const graceChannel = await request(port, "/api/mininet/channel", { cookie: grace.cookie });
		const graceCaps = graceChannel.json?.data?.capabilities;
		log("⑪ lab_sniffer 只拿 sniffer 位（operate=false / writeEnabled=true）", graceCaps?.sniffer === true && graceCaps?.operate === false && graceChannel.json?.data?.writeEnabled === true, describe(graceCaps));

		const state = await request(port, "/api/mininet/sniffer/state", { cookie: grace.cookie });
		log("⑪ 抓包态读数回 { active }（只读权限即可）", state.status === 200 && state.json?.data?.active === false, `${state.status} ${describe(state.json?.data)}`);

		const started = await request(port, "/api/mininet/sniffer/start", { method: "POST", cookie: grace.cookie });
		const startHit = mininet.log.at(-1);
		log("⑪ 开始抓包 → 200 { active: true } 且出站路径为 sniffer/start", started.status === 200 && started.json?.data?.active === true && startHit?.method === "POST" && startHit?.path === "/api/mininet/sniffer/start", `${started.status} ${startHit?.method} ${startHit?.path}`);

		const pcap = await requestBytes(port, "/api/mininet/export/pcap", { cookie: grace.cookie });
		const pcapDisposition = pcap.headers.get("content-disposition") ?? "";
		log("⑪ pcap 以二进制直出（魔数 d4c3b2a1 原样穿过）", pcap.status === 200 && pcap.bytes.subarray(0, 4).equals(Buffer.from([0xD4, 0xC3, 0xB2, 0xA1])), `${pcap.status} ${pcap.bytes.subarray(0, 4).toString("hex")}`);
		log("⑪ pcap 的 content-type 是 application/vnd.tcpdump.pcap", (pcap.headers.get("content-type") ?? "").startsWith("application/vnd.tcpdump.pcap"), describe(pcap.headers.get("content-type")));
		log("⑪ pcap 文件名由 BFF 生成（.pcap）", /^attachment; filename="lab-net_scoped-\d{8}T\d{6}Z\.pcap"$/.test(pcapDisposition), describe(pcapDisposition));

		const stopped = await request(port, "/api/mininet/sniffer/stop", { method: "POST", cookie: grace.cookie });
		log("⑪ 停止抓包 → 200 { active: false }", stopped.status === 200 && stopped.json?.data?.active === false, `${stopped.status} ${describe(stopped.json?.data)}`);

		/*
		 * full_reset 会清空整张网：确认值必须等于台账里的 network_id，否则 BFF 直接 400
		 * 且不触达上游 —— 意图不明确的删除不能「先做后报错」。
		 */
		const hitsBeforeReset = mininet.log.length;
		const unconfirmed = await request(port, "/api/mininet/full_reset", {
			method: "POST",
			headers: { "content-type": "application/json" },
			cookie: admin.cookie,
			body: "{}"
		});
		log("⑪ full_reset 缺 confirm → 400 lab_confirm_required 且不触达上游", unconfirmed.status === 400 && unconfirmed.json?.message === "lab_confirm_required" && mininet.log.length === hitsBeforeReset, `${unconfirmed.status} hits=${mininet.log.length - hitsBeforeReset}`);

		const wrongConfirm = await request(port, "/api/mininet/full_reset", {
			method: "POST",
			headers: { "content-type": "application/json" },
			cookie: admin.cookie,
			body: JSON.stringify({ confirm: "net_other" })
		});
		log("⑪ confirm 与台账 network_id 不符 → 400（不是「带什么值都行」）", wrongConfirm.status === 400 && wrongConfirm.json?.message === "lab_confirm_required", `${wrongConfirm.status}`);

		const reset = await request(port, "/api/mininet/full_reset", {
			method: "POST",
			headers: { "content-type": "application/json" },
			cookie: admin.cookie,
			body: JSON.stringify({ confirm: "net_scoped" })
		});
		log("⑪ 带正确 confirm → 200 且触达上游 full_reset", reset.status === 200 && mininet.log.at(-1)?.path === "/api/mininet/full_reset", `${reset.status} ${mininet.log.at(-1)?.path}`);

		// 清单整体清空：上游已无节点，且台账不再放行任何登记过的节点 id
		const hostsAfterReset = await request(port, "/api/mininet/hosts", { cookie: admin.cookie });
		const statsAfterReset = await request(port, "/api/mininet/stats/h1", { cookie: admin.cookie });
		log("⑪ 重建后清单清空（GET /hosts 为空、旧节点不再属于本网）", hostsAfterReset.status === 200 && Array.isArray(hostsAfterReset.json?.data) && hostsAfterReset.json.data.length === 0 && statsAfterReset.status === 404 && statsAfterReset.json?.message === "lab_resource_not_found", `hosts=${describe(hostsAfterReset.json?.data)} stats=${statsAfterReset.status}`);
	});

	// ⑫ WebSocket 票 + 抓包实时流（W5 剩余部分，NMCPS-ADR-0022 D6）
	await withBff(labEnv({
		NUXT_MININET_INSTANCES: JSON.stringify({ [LAB_TENANT]: { baseUrl: mininetBase } }),
		NUXT_LAB_LEDGER_FILE: `.data/check-lab-bff-ws-${process.pid}.json`,
		NUXT_LAB_LEDGER_SEED: JSON.stringify(SCOPED_LEDGER)
	}), async (port) => {
		const admin = await login(port);
		const adminHits = mininet.log.length;
		const adminTicket = await request(port, "/api/mininet/ws-ticket", {
			method: "POST",
			headers: { "content-type": "application/json" },
			cookie: admin.cookie,
			body: JSON.stringify({ kind: "sniffer" })
		});
		log("⑫ 无 lab:sniffer 签票 → 403 且不触达上游", adminTicket.status === 403 && adminTicket.json?.message === "lab_permission_denied" && mininet.log.length === adminHits, `${adminTicket.status} hits=${mininet.log.length - adminHits}`);

		const grace = await login(port, "grace");
		const ticketRequest = (body) => request(port, "/api/mininet/ws-ticket", {
			method: "POST",
			headers: { "content-type": "application/json" },
			cookie: grace.cookie,
			body: JSON.stringify(body)
		});

		const unknownKind = await ticketRequest({ kind: "shell" });
		log("⑫ 未登记种类 → 400 lab_ws_kind_invalid（票不能签给没实现的通道）", unknownKind.status === 400 && unknownKind.json?.message === "lab_ws_kind_invalid", `${unknownKind.status} ${describe(unknownKind.json?.message)}`);

		const foreignTarget = await ticketRequest({ kind: "sniffer", target: "net_other" });
		log("⑫ target 指向别的租户的网络 → 404 lab_resource_not_found", foreignTarget.status === 404 && foreignTarget.json?.message === "lab_resource_not_found", `${foreignTarget.status} ${describe(foreignTarget.json?.message)}`);

		const issued = await ticketRequest({ kind: "sniffer", target: "net_scoped" });
		const ticket = issued.json?.data;
		const expectedUrl = `/mininet-ws/sniffer?${new URLSearchParams({ ticket: String(ticket?.ticket ?? ""), target: "net_scoped" })}`;
		const ttlSeconds = (Date.parse(String(ticket?.expiresAt ?? "")) - Date.now()) / 1000;
		log("⑫ 签票成功：同源 url + 60 秒 TTL + 不含上游地址", issued.status === 200 && typeof ticket?.ticket === "string" && ticket.ticket.split(".").length === 2 && ticket?.kind === "sniffer" && ticket?.url === expectedUrl && ttlSeconds > 0 && ttlSeconds <= 60 && !JSON.stringify(ticket).includes(mininetBase), `${issued.status} ttl=${ttlSeconds.toFixed(1)}s`);

		const noTicket = await upgradeAttempt(port, "/mininet-ws/sniffer");
		log("⑫ 无票升级 → 401 lab_ws_ticket_invalid（不建连、不触达上游）", noTicket.status === 401 && noTicket.body.includes("lab_ws_ticket_invalid"), `${noTicket.status} ${describe(noTicket.body.slice(0, 48))}`);

		const tampered = await upgradeAttempt(port, `/mininet-ws/sniffer?${new URLSearchParams({ ticket: `${ticket?.ticket ?? ""}x`, target: "net_scoped" })}`);
		log("⑫ 签名不符 → 401（升级不靠查询串里的 sub / tid）", tampered.status === 401 && tampered.body.includes("lab_ws_ticket_invalid"), `${tampered.status}`);

		const socketsBefore = mininet.snifferSocketLog.length;
		const stream = await readSocketMessages(`ws://${HOST}:${port}${ticket?.url ?? ""}`, MININET_SNIFFER_LIVE.length);
		const packets = stream.messages.map((item) => {
			try {
				return JSON.parse(item);
			} catch {
				return {};
			}
		});
		const upstreamSocket = mininet.snifferSocketLog.at(-1);
		log("⑫ 有效票连上实时流：帧按上游原文透传（TCP → ICMP）", stream.messages.length === MININET_SNIFFER_LIVE.length && packets[0]?.proto === "TCP" && packets[0]?.src === "10.0.0.1" && packets[1]?.proto === "ICMP", `${stream.messages.length}${stream.timedOut ? " timedOut" : ""} ${describe(packets.map((item) => item.proto))}`);
		log("⑫ BFF 向上游建连 /api/mininet/sniffer 且出站不带 cookie / authorization", mininet.snifferSocketLog.length === socketsBefore + 1 && upstreamSocket?.path === "/api/mininet/sniffer" && !upstreamSocket?.headers.authorization && !upstreamSocket?.headers.cookie, `${upstreamSocket?.path} auth=${!!upstreamSocket?.headers.authorization} cookie=${!!upstreamSocket?.headers.cookie}`);

		const replay = await upgradeAttempt(port, ticket?.url ?? "/mininet-ws/sniffer");
		log("⑫ 同一张票重放 → 401（一次性）", replay.status === 401 && replay.body.includes("lab_ws_ticket_invalid"), `${replay.status}`);

		// 会话审计是异步写的（关闭后才落 `succeeded`），给一拍再读
		await delay(300);
		const audit = readAuditEntries(`.data/check-lab-audit-${process.pid}/lab-audit.jsonl`);
		const ticketAudit = audit.find((entry) => entry.action === "ws_ticket_sniffer");
		const streamAudit = audit.find((entry) => entry.action === "ws_sniffer" && entry.result === "allowed");
		const noPayload = !audit.some((entry) => JSON.stringify(entry).includes("52210"));
		log("⑫ 签票与建流各落一条审计，且审计里没有抓包载荷", !!ticketAudit && ticketAudit.result === "allowed" && ticketAudit.permission === "lab:sniffer" && !!streamAudit && noPayload, `ticket=${!!ticketAudit} stream=${!!streamAudit} noPayload=${noPayload}`);
	});

	/*
	 * ⑬ Network Tools 的三条剩余通道（NMCPS-ADR-0022 D6：terminal / logs / monitor）
	 *
	 * 与 ⑫ 共用同一套票，但 `target` 语义不同：终端是**节点**、监控是 `node:intf`、
	 * 日志必须为空。这里同时钉三件事 —— 权限位按通道登记（不由 tenant_admin 推导）、
	 * target 形状 / 存在性校验、以及 BFF 向上游拼出的真实地址。
	 */
	await withBff(labEnv({
		NUXT_MININET_INSTANCES: JSON.stringify({ [LAB_TENANT]: { baseUrl: mininetBase } }),
		NUXT_LAB_LEDGER_FILE: `.data/check-lab-bff-tools-${process.pid}.json`,
		NUXT_LAB_LEDGER_SEED: JSON.stringify(SCOPED_LEDGER)
	}), async (port) => {
		const admin = await login(port);
		const reader = await login(port, "erin");
		const frank = await login(port, "frank");
		const ticket = (cookie, body) => request(port, "/api/mininet/ws-ticket", {
			method: "POST",
			headers: { "content-type": "application/json" },
			cookie,
			body: JSON.stringify(body)
		});

		const deniedTerminal = await ticket(admin.cookie, { kind: "terminal", target: "h1" });
		log("⑬ 无 lab:terminal 签终端票 → 403（不由 tenant_admin 推导）", deniedTerminal.status === 403 && deniedTerminal.json?.message === "lab_permission_denied", `${deniedTerminal.status} ${describe(deniedTerminal.json?.message)}`);

		const missingNode = await ticket(frank.cookie, { kind: "terminal" });
		const badIntf = await ticket(reader.cookie, { kind: "monitor", target: "h1" });
		const logsTarget = await ticket(reader.cookie, { kind: "logs", target: "h1" });
		log("⑬ target 形状不对 → 400 bff_body_invalid（终端缺节点 / 监控缺接口 / 日志带目标）", missingNode.status === 400 && badIntf.status === 400 && logsTarget.status === 400 && [missingNode, badIntf, logsTarget].every((item) => item.json?.message === "bff_body_invalid"), `terminal=${missingNode.status} monitor=${badIntf.status} logs=${logsTarget.status}`);

		// 资源清单登记了 nodes，清单外的节点不能签票（与列表出口同一套收窄）
		const unlisted = await ticket(frank.cookie, { kind: "terminal", target: "h9" });
		log("⑬ 资源清单外的节点 → 404（不签一张注定连不上的票）", unlisted.status === 404 && unlisted.json?.message === "lab_resource_not_found", `${unlisted.status} ${describe(unlisted.json?.message)}`);

		// 终端：签票 → 连流 → 问候帧 + 上行命令回显。只有这条通道有浏览器 → 上游方向
		const terminalTicket = await ticket(frank.cookie, { kind: "terminal", target: "h1" });
		const terminalUrl = terminalTicket.json?.data?.url;
		const terminalExpectedUrl = `/mininet-ws/terminal?${new URLSearchParams({ ticket: String(terminalTicket.json?.data?.ticket ?? ""), target: "h1" })}`;
		const socketsBeforeTerminal = mininet.snifferSocketLog.length;
		// 假 PTY 的形状：问候帧 + 逐字节回显 + 换行 + `echo:<line>`（4 帧，见 `bff-harness`）
		const terminalStream = await readSocketMessages(`ws://${HOST}:${port}${terminalUrl ?? ""}`, 4, "ls\n");
		const terminalUpstream = mininet.snifferSocketLog.at(-1);
		log("⑬ 终端签票：同源 url 带 target=h1，不含上游地址", terminalTicket.status === 200 && terminalUrl === terminalExpectedUrl && !JSON.stringify(terminalTicket.json?.data).includes(mininetBase), `${terminalTicket.status} ${describe(terminalUrl)}`);
		log("⑬ 终端：问候帧与上行命令的回显都穿过 BFF", terminalStream.messages.includes(MININET_TERMINAL_BANNER) && terminalStream.messages.some((text) => text.includes("echo:ls")), describe(terminalStream.messages));
		log("⑬ 终端上游路径是 /api/mininet/terminal/h1，出站不带 cookie / authorization", mininet.snifferSocketLog.length === socketsBeforeTerminal + 1 && terminalUpstream?.path === "/api/mininet/terminal/h1" && !terminalUpstream?.headers.authorization && !terminalUpstream?.headers.cookie, `${terminalUpstream?.path} cookie=${!!terminalUpstream?.headers.cookie}`);

		// Ctrl-C：0x03 是控制字节，BFF 必须原样转（一旦被当文本处理/裁剪，跑着的命令就停不下来）
		const interruptTicket = await ticket(frank.cookie, { kind: "terminal", target: "h1" });
		const interruptStream = await readSocketMessages(`ws://${HOST}:${port}${interruptTicket.json?.data?.url ?? ""}`, 2, "\u0003");
		log("⑬ 终端 `Ctrl-C`（0x03）原样上行：上游回 `^C`，BFF 不吞控制字节", interruptStream.messages.includes(MININET_TERMINAL_INTERRUPT_ECHO) && !interruptStream.messages.some((text) => text.includes("echo:")), describe(interruptStream.messages));

		// 日志：`lab:read` 即够，票面必须没有目标
		const logsTicket = await ticket(reader.cookie, { kind: "logs" });
		const logsStream = await readSocketMessages(`ws://${HOST}:${port}${logsTicket.json?.data?.url ?? ""}`, MININET_LOG_LINES.length);
		const logsUpstream = mininet.snifferSocketLog.at(-1);
		log("⑬ 日志：逐行原文穿过 BFF，上游 /api/mininet/logs 且不带 cookie", logsStream.messages.length === MININET_LOG_LINES.length && logsStream.messages[0] === MININET_LOG_LINES[0] && logsStream.messages[1] === MININET_LOG_LINES[1] && logsUpstream?.path === "/api/mininet/logs" && !logsUpstream?.headers.cookie, `${describe(logsStream.messages)} ${logsUpstream?.path}`);

		// 监控：`node:intf` 拆成上游查询串，采样原样回传
		const monitorTicket = await ticket(reader.cookie, { kind: "monitor", target: "h1:h1-eth0" });
		const monitorStream = await readSocketMessages(`ws://${HOST}:${port}${monitorTicket.json?.data?.url ?? ""}`, 1);
		const monitorUpstream = mininet.snifferSocketLog.at(-1);
		const monitorParams = new URLSearchParams(monitorUpstream?.search ?? "");
		const monitorSample = JSON.parse(monitorStream.messages[0] ?? "{}");
		log("⑬ 监控：target `node:intf` 拼成上游查询串，采样原样回传", monitorSample.tx_gbps === MININET_MONITOR_SAMPLE.tx_gbps && monitorSample.rx_gbps === MININET_MONITOR_SAMPLE.rx_gbps && monitorParams.get("node") === "h1" && monitorParams.get("intf") === "h1-eth0", `${monitorUpstream?.path}${monitorUpstream?.search} ${describe(monitorSample)}`);

		// 会话审计是异步写的（关闭后才落 `succeeded`），给一拍再读
		await delay(300);
		const audit = readAuditEntries(`.data/check-lab-audit-${process.pid}/lab-audit.jsonl`);
		const actions = new Set(audit.map((entry) => entry.action));
		const permissionOf = (kind) => audit.find((entry) => entry.action === `ws_${kind}` && entry.result === "allowed")?.permission;
		const audited = ["ws_ticket_terminal", "ws_terminal", "ws_ticket_logs", "ws_logs", "ws_ticket_monitor", "ws_monitor"].every((action) => actions.has(action));
		const noPayload = !audit.some((entry) => JSON.stringify(entry).includes("echo:ls"));
		log("⑬ 三条通道签票 + 建流各落审计，权限位按通道登记且不含会话载荷", audited && permissionOf("terminal") === "lab:terminal" && permissionOf("logs") === "lab:read" && permissionOf("monitor") === "lab:read" && noPayload, `actions=${describe([...actions].filter((action) => action.startsWith("ws_")))} terminal=${permissionOf("terminal")} noPayload=${noPayload}`);
	});

	/*
	 * ⑭ 台账对账（NMCPS-ADR-0023）：`POST /api/mininet/networks/{id}/sync`
	 *
	 * 这条路由只改台账，不转发任何上游写 —— 它读上游五类节点与链路，把 `resources`
	 * **整体重写**成上游此刻的事实。断言钉四件事：
	 *   1. 权限闸门在最前（单读权限 → 403、跨租户 → 404、缺 / 错确认 → 400），全部零上游请求；
	 *   2. 成功路径只发 GET，清单整体等于上游事实（幽灵 id 被删掉，不是并集保留）；
	 *   3. 任一类读取失败 → 原样回错且**台账不落盘**（全有或全无）；
	 *   4. 审计按「先 allowed 后 succeeded / failed」落盘，且不复制资源载荷。
	 */
	const reconcileLedger = [{
		...DEFAULT_LEDGER[0],
		id: "net_reconcile",
		resources: { nodes: ["ghost", "h1"], links: ["h1--sw1"] }
	}, {
		id: "net_foreign",
		tenant_id: "t_other",
		engine: "mininet",
		upstream_id: "mininet-t_other",
		state: "running",
		created_by: "u_other",
		created_at: "2026-11-15T00:00:00.000Z",
		updated_at: "2026-11-15T00:00:00.000Z"
	}];

	// 上游事实：旧前端 / 运维直接在下游加出来的节点必须能被对账看见
	const factTopology = mininet.topology;
	factTopology.hosts = [{ name: "h1" }, { name: "h4" }];
	factTopology.switches = { sw9: { id: "sw9", name: "sw9", type: "switch", ports: 4 } };
	factTopology.routers = { r1: { id: "r1", name: "r1" } };
	factTopology.nats = { n1: { id: "n1", name: "n1" } };
	factTopology.controllers = { ctl1: { id: "ctl1", name: "ctl1" } };
	factTopology.links = [
		{ from: "h1", to: "sw9" },
		{ from: "sw9", to: "ctl1" },
		// 旧形状：升级期数据里的 `identity.source/target` 也必须认
		{ identity: { source: "h4", target: "sw9" } }
	];

	await withBff(labEnv({
		NUXT_MININET_INSTANCES: JSON.stringify({ [LAB_TENANT]: { baseUrl: mininetBase } }),
		NUXT_LAB_LEDGER_FILE: `.data/check-lab-bff-reconcile-${process.pid}.json`,
		NUXT_LAB_LEDGER_SEED: JSON.stringify(reconcileLedger)
	}), async (port) => {
		const admin = await login(port);
		const reader = await login(port, "erin");

		const sync = (cookie, id, body) => request(port, `/api/mininet/networks/${id}/sync`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			cookie,
			...(body === undefined ? {} : { body: JSON.stringify(body) })
		});

		const readCounts = async () => {
			const listed = await request(port, "/api/mininet/networks", { cookie: admin.cookie });
			const record = (listed.json?.data ?? []).find((item) => item.id === "net_reconcile");
			return { nodeCount: record?.node_count, linkCount: record?.link_count };
		};

		// ① 权限与确认闸门：任何一条都不能触达上游
		const gateHits = mininet.log.length;
		const readerDenied = await sync(reader.cookie, "net_reconcile", { confirm: "net_reconcile" });
		log("⑭ 只有 lab:read → 403 lab_permission_denied 且零上游请求", readerDenied.status === 403 && readerDenied.json?.message === "lab_permission_denied" && mininet.log.length === gateHits, `${readerDenied.status} hits=${mininet.log.length - gateHits}`);

		const foreign = await sync(admin.cookie, "net_foreign", { confirm: "net_foreign" });
		log("⑭ 跨租户网络 → 404 lab_resource_not_found（与不存在同语义）且零上游请求", foreign.status === 404 && foreign.json?.message === "lab_resource_not_found" && mininet.log.length === gateHits, `${foreign.status} hits=${mininet.log.length - gateHits}`);

		const missingConfirm = await sync(admin.cookie, "net_reconcile");
		const wrongConfirm = await sync(admin.cookie, "net_reconcile", { confirm: "net_wrong" });
		log("⑭ 缺 / 错 confirm → 400 lab_confirm_required 且零上游请求", missingConfirm.status === 400 && wrongConfirm.status === 400 && [missingConfirm, wrongConfirm].every((item) => item.json?.message === "lab_confirm_required") && mininet.log.length === gateHits, `missing=${missingConfirm.status} wrong=${wrongConfirm.status} hits=${mininet.log.length - gateHits}`);

		const beforeSync = await readCounts();
		log("⑭ 对账前台账还是旧清单（2 个节点 / 1 条链路）", beforeSync.nodeCount === 2 && beforeSync.linkCount === 1, `nodes=${beforeSync.nodeCount} links=${beforeSync.linkCount}`);

		// ② 成功路径：只读上游，清单整体重写
		const readHits = mininet.log.length;
		const synced = await sync(admin.cookie, "net_reconcile", { confirm: "net_reconcile" });
		const reads = mininet.log.slice(readHits);
		const readPaths = reads.map((item) => item.path);
		const expectedPaths = ["/api/mininet/hosts", "/api/mininet/switches", "/api/mininet/routers", "/api/mininet/nats", "/api/mininet/controllers", "/api/mininet/links"];
		log("⑭ 对账出站只读六类端点（五类节点 + 链路），且全部 GET", reads.length === 6 && reads.every((item) => item.method === "GET") && expectedPaths.every((item) => readPaths.includes(item)), describe(readPaths));

		const data = synced.json?.data;
		const expectedNodes = ["ctl1", "h1", "h4", "n1", "r1", "sw9"];
		const expectedLinks = ["ctl1--sw9", "h1--sw9", "h4--sw9"];
		log("⑭ 对账成功：清单整体等于上游事实（幽灵 id 被删、新节点被接管）", synced.status === 200 && describe(data?.nodes) === describe(expectedNodes) && describe(data?.links) === describe(expectedLinks), `${synced.status} nodes=${describe(data?.nodes)} links=${describe(data?.links)}`);

		log("⑭ 差集说清「接管了什么、清掉了什么」", describe(data?.adopted?.nodes) === describe(["ctl1", "h4", "n1", "r1", "sw9"]) && describe(data?.dropped?.nodes) === describe(["ghost"]) && describe(data?.dropped?.links) === describe(["h1--sw1"]), `adopted=${describe(data?.adopted?.nodes)} dropped=${describe(data?.dropped)}`);

		const afterSync = await readCounts();
		log("⑭ 新清单落盘（列表计数 = 上游事实）", afterSync.nodeCount === 6 && afterSync.linkCount === 3, `nodes=${afterSync.nodeCount} links=${afterSync.linkCount}`);

		// 出口过滤按新清单判可见性：清单外节点现在看得见，幽灵 id 不再出现在路径里
		const hostsAfter = await request(port, "/api/mininet/hosts", { cookie: admin.cookie });
		const hostNames = (hostsAfter.json?.data ?? []).map((item) => item.name);
		const ghostStats = await request(port, "/api/mininet/stats/ghost", { cookie: admin.cookie });
		log("⑭ 出口按重写后的清单收敛（清单外节点可见 / 幽灵 id → 404）", hostNames.includes("h4") && ghostStats.status === 404 && ghostStats.json?.message === "lab_resource_not_found", `hosts=${describe(hostNames)} ghost=${ghostStats.status}`);
		// ③ 上游读取失败：原样回错，台账一个字节都不动
		factTopology.fail.add("links");
		const failedHits = mininet.log.length;
		const upstreamFailed = await sync(admin.cookie, "net_reconcile", { confirm: "net_reconcile" });
		factTopology.fail.delete("links");
		const afterFailure = await readCounts();
		log("⑭ 任一类读取失败 → 原样回上游状态与原因（不包装成 500 兜底）", upstreamFailed.status === 500 && upstreamFailed.json?.message === "links exploded" && mininet.log.length > failedHits, `${upstreamFailed.status} ${describe(upstreamFailed.json?.message)}`);
		log("⑭ 读取失败时台账不落盘（仍是上一份成功清单）", afterFailure.nodeCount === 6 && afterFailure.linkCount === 3, `nodes=${afterFailure.nodeCount} links=${afterFailure.linkCount}`);

		// ④ 审计：先 allowed，再 succeeded / failed；不复制资源载荷
		const audit = readAuditEntries(`.data/check-lab-audit-${process.pid}/lab-audit.jsonl`)
			.filter((entry) => entry.action === "post /api/mininet/networks/{id}/sync");
		const allowed = audit.filter((entry) => entry.result === "allowed");
		const succeeded = audit.filter((entry) => entry.result === "succeeded");
		const failedEntry = audit.find((entry) => entry.result === "failed");
		log("⑭ 审计：allowed 先落，成功落 succeeded、读取失败落 failed（reason 为上游原文）", allowed.length >= 4 && succeeded.length === 1 && failedEntry?.reason === "links exploded", `allowed=${allowed.length} succeeded=${succeeded.length} failed=${describe(failedEntry?.reason)}`);
		log("⑭ 审计登记双权限位，且不复制节点 / 链路载荷", allowed.every((entry) => entry.permission === "lab:create,lab:delete") && !audit.some((entry) => JSON.stringify(entry).includes("ctl1--sw9")), `permission=${describe(allowed[0]?.permission)}`);

		// 这条路由只改台账，不能进上游白名单（否则会被 `[...slug]` 当成转发目标）
		const whitelisted = readMininetWhitelist().some((entry) => entry.template.includes("/sync"));
		log("⑭ `/networks/{id}/sync` 不在 MININET_ROUTES 白名单里（只改台账，不转发）", !whitelisted, `whitelisted=${whitelisted}`);
	});

	/*
	 * ⑮ 长时预算与台账运行态对账（NMCPS-ADR-0026 D1 / D2 / D4）
	 *
	 * 真后端 9 节点上一次 `pingall` 实测 42.6 秒（`NMCPS-ADR-0026` §1），而读端点的出站预算只有
	 * 15 秒 —— 请求其实还在正常跑，用户却先拿到 `504`。这里用「短预算 1.2 秒 / 长预算 3 秒 +
	 * 上游延迟 2 秒」给出可复现的分档取证，不靠调小真超时去凑：
	 *   1. 写端点（不在长时清单里）沿用短预算 → 504 `mininet_timeout`；
	 *   2. `/pingall` 走长时预算 → 200；
	 *   3. 台账 `running` + 上游 `false` → 列表回 `stopped` 且落盘改判；
	 *   4. 上游运行态读不到 → 保持原值、零写盘（「未知」不是「已停止」）。
	 */
	const SLOW_UPSTREAM_MS = 2000;
	const ledgerRecordOf = (file, id) => {
		if (!existsSync(file))
			return undefined;
		const body = JSON.parse(readFileSync(file, "utf8"));
		return (body?.networks ?? []).find((item) => item.id === id);
	};

	mininet.delays.set("/api/mininet/hosts", SLOW_UPSTREAM_MS);
	mininet.delays.set("/api/mininet/pingall", SLOW_UPSTREAM_MS);
	mininet.delays.set("/api/mininet/iperf", SLOW_UPSTREAM_MS);
	mininet.runState.started = false;
	const longLedgerFile = `.data/check-lab-bff-long-${process.pid}.json`;
	const unknownLedgerFile = `.data/check-lab-bff-unknown-${process.pid}.json`;
	rmSync(longLedgerFile, { force: true });
	rmSync(unknownLedgerFile, { force: true });

	try {
		await withBff(labEnv({
			NUXT_MININET_INSTANCES: JSON.stringify({ [LAB_TENANT]: { baseUrl: mininetBase } }),
			NUXT_MININET_TIMEOUT_MS: "1200",
			NUXT_MININET_LONG_TIMEOUT_MS: "3000",
			NUXT_LAB_LEDGER_FILE: longLedgerFile,
			NUXT_LAB_LEDGER_SEED: JSON.stringify([{ ...DEFAULT_LEDGER[0], id: "net_long", state: "running" }])
		}), async (port) => {
			const auth = await login(port);

			const slowWrite = await request(port, "/api/mininet/hosts", {
				method: "POST",
				headers: { "content-type": "application/json" },
				cookie: auth.cookie,
				body: JSON.stringify({ name: "h9", ip: "10.0.0.9" })
			});
			log("⑮ 非长时端点仍用短预算：上游慢 2 秒、预算 1.2 秒 → 504 mininet_timeout", slowWrite.status === 504 && slowWrite.json?.message === "mininet_timeout", `${slowWrite.status} ${describe(slowWrite.json?.message)}`);

			const pingall = await request(port, "/api/mininet/pingall", { method: "POST", cookie: auth.cookie });
			log("⑮ /pingall 走长时预算：同一份 2 秒延迟、预算 3 秒 → 200（不把「还在跑」判成超时）", pingall.status === 200, `${pingall.status} ${describe(pingall.json?.message)}`);

			// iperf 与 pingall 同属长时清单（NMCPS-ADR-0026 D1）：漏登记就会在真网里被 15 秒预算
			// 误杀成 504，而吞吐测试其实还在跑 —— 页面只看到假失败，用户再点一次就是 409。
			const iperfBody = { client: "h1", server: "h2", seconds: 1 };
			const postIperf = () => request(port, "/api/mininet/iperf", {
				method: "POST",
				headers: { "content-type": "application/json" },
				cookie: auth.cookie,
				body: JSON.stringify(iperfBody)
			});
			const iperfOk = await postIperf();
			log("⑮ /iperf 走长时预算：同一份 2 秒延迟、预算 3 秒 → 200（吞吐测试不被短预算误杀）", iperfOk.status === 200 && typeof iperfOk.json?.data?.client === "string" && typeof iperfOk.json?.data?.server === "string", `${iperfOk.status} ${describe(iperfOk.json?.message)}`);

			const iperfSent = mininet.log.filter((entry) => entry.method === "POST" && entry.path === "/api/mininet/iperf").at(-1);
			const iperfPayload = iperfSent?.body ? JSON.parse(iperfSent.body) : undefined;
			log("⑮ iperf 请求体原样到达上游（client / server / seconds 不被改写）", iperfPayload?.client === "h1" && iperfPayload?.server === "h2" && iperfPayload?.seconds === 1, `body=${describe(iperfSent?.body)}`);

			// 真后端 §5 的两种失败形状：客户端超时 504、已在跑 409。BFF 若把它们折成 500 / 502，
			// 页面就分不清「等久一点再试」和「上游坏了」。
			mininet.iperf.reply = { status: 504, detail: "iperf client did not finish within 8s" };
			const iperfTimeout = await postIperf();
			log("⑮ 上游 iperf 客户端超时（504）→ 504 + 上游原话透传（不折叠成 500）", iperfTimeout.status === 504 && String(iperfTimeout.json?.message ?? "").includes("did not finish"), `${iperfTimeout.status} ${describe(iperfTimeout.json?.message)}`);

			mininet.iperf.reply = { status: 409, detail: "iperf already running" };
			const iperfBusy = await postIperf();
			log("⑮ 上游 iperf 已在跑（409）→ 409 保留（页面提示稍后再试，而不是未知错误）", iperfBusy.status === 409 && String(iperfBusy.json?.message ?? "").includes("already running"), `${iperfBusy.status} ${describe(iperfBusy.json?.message)}`);
			mininet.iperf.reply = null;

			const before = mininet.log.filter((entry) => entry.method === "GET" && entry.path === "/api/mininet/start").length;
			const networks = await request(port, "/api/mininet/networks", { cookie: auth.cookie });
			const record = (networks.json?.data ?? [])[0];
			const after = mininet.log.filter((entry) => entry.method === "GET" && entry.path === "/api/mininet/start").length;
			log("⑮ 台账 running + 上游 false → 列表回 stopped（一次列表只读一次上游运行态）", networks.status === 200 && record?.state === "stopped" && after === before + 1, `state=${describe(record?.state)} reads=${after - before}`);

			const persisted = ledgerRecordOf(longLedgerFile, "net_long");
			log("⑮ 改判同步落盘（重启后不再是 seed 的 running）", persisted?.state === "stopped", `ledger=${describe(persisted?.state)}`);
		});

		// 运行态读不到：改成 500，台账里的 running 必须原样站着
		mininet.runState.fail = true;
		await withBff(labEnv({
			NUXT_MININET_INSTANCES: JSON.stringify({ [LAB_TENANT]: { baseUrl: mininetBase } }),
			NUXT_MININET_TIMEOUT_MS: "1200",
			NUXT_MININET_LONG_TIMEOUT_MS: "3000",
			NUXT_LAB_LEDGER_FILE: unknownLedgerFile,
			NUXT_LAB_LEDGER_SEED: JSON.stringify([{ ...DEFAULT_LEDGER[0], id: "net_unknown", state: "running" }])
		}), async (port) => {
			const auth = await login(port);
			const networks = await request(port, "/api/mininet/networks", { cookie: auth.cookie });
			const record = (networks.json?.data ?? [])[0];
			log("⑮ 上游运行态读不到 → 保持原值（「未知」不是「已停止」）", networks.status === 200 && record?.state === "running", `state=${describe(record?.state)}`);

			const persisted = ledgerRecordOf(unknownLedgerFile, "net_unknown");
			log("⑮ 读不到时零写盘：不猜也不改，台账文件根本没被创建", persisted === undefined, `ledger=${describe(persisted?.state ?? "absent")}`);
		});
	} finally {
		mininet.delays.clear();
		mininet.runState.started = true;
		mininet.runState.fail = false;
		mininet.iperf.reply = null;
	}

	// ⑯ 2.0 会话入口（NMCPS-DESIGN-008 M1）：白名单分档 / 台账绑定 / 归属 404
	//
	// 只测 BFF 自己的判定：假上游只回显会话形状，证明的是「BFF 把 session_id 写回台账、
	// 只放行绑定的那一个、写端点进审计」，不是「引擎能建网」（那在 `check:simulation`）。
	const sessionLedgerFile = `.data/check-lab-bff-m1-${process.pid}.json`;
	const sessionAuditFile = `.data/check-lab-audit-m1-${process.pid}/lab-audit.jsonl`;
	rmSync(sessionLedgerFile, { force: true });
	rmSync(path.dirname(sessionAuditFile), { recursive: true, force: true });

	const whitelist = readMininetWhitelist();
	const sessionRoutes = whitelist.filter((entry) => entry.template === "/sessions" || entry.template.startsWith("/sessions/"));
	const permissionOf = (method, template) => whitelist.find((entry) => entry.method === method && entry.template === template)?.permissions ?? [];
	log(
		"⑯ 12 条会话端点登记，权限位按写能力分档",
		sessionRoutes.length === 12
		&& permissionOf("POST", "/sessions").join() === "lab:create"
		&& permissionOf("POST", "/sessions/{session_id}/nodes").join() === "lab:create"
		&& permissionOf("DELETE", "/sessions/{session_id}/nodes/{node_id}").join() === "lab:delete"
		&& permissionOf("POST", "/sessions/{session_id}/stop").join() === "lab:operate"
		&& permissionOf("GET", "/sessions/{session_id}/links").join() === "lab:read",
		`count=${sessionRoutes.length}`
	);

	// 同一台实例上别人的会话：列表与路径都不得把它透出去
	mininet.simulation.sessions.set("sim_9999", {
		id: "sim_9999",
		engine: "wired",
		name: "other-network",
		state: "created",
		metadata: { network_id: "net_other" },
		nodes: [],
		links: []
	});

	await withBff(labEnv({
		NUXT_MININET_INSTANCES: JSON.stringify({ [LAB_TENANT]: { baseUrl: mininetBase } }),
		NUXT_LAB_LEDGER_FILE: sessionLedgerFile,
		NUXT_LAB_LEDGER_SEED: JSON.stringify([{ ...DEFAULT_LEDGER[0], id: "net_m1", resources: { nodes: [], links: [] } }]),
		NUXT_LAB_AUDIT_FILE: sessionAuditFile
	}), async (port) => {
		const auth = await login(port);
		const before = mininet.log.length;

		const created = await request(port, "/api/mininet/sessions", {
			cookie: auth.cookie,
			method: "POST",
			body: JSON.stringify({ engine: "wired", name: "m1" })
		});
		const createHit = mininet.log.slice(before).find((entry) => entry.method === "POST" && entry.path === "/api/simulation/sessions");
		const upstreamBody = createHit?.body ? JSON.parse(createHit.body) : undefined;
		log(
			"⑯ POST /sessions → 201，出站 /api/simulation/sessions",
			created.status === 201 && created.json?.data?.id === "sim_0001" && !!createHit,
			`${created.status} ${createHit?.path} id=${describe(created.json?.data?.id)}`
		);
		log(
			"⑯ 会话 metadata 由 BFF 写（network_id / tenant_id / actor_id），客户端伪造无效",
			upstreamBody?.metadata?.network_id === "net_m1"
			&& upstreamBody?.metadata?.tenant_id === LAB_TENANT
			&& upstreamBody?.metadata?.actor_id === "u_lab",
			describe(upstreamBody?.metadata)
		);

		const bound = ledgerRecordOf(sessionLedgerFile, "net_m1");
		log("⑯ 会话 id 写回台账（session_id）", bound?.session_id === "sim_0001", `session_id=${describe(bound?.session_id)}`);

		const again = await request(port, "/api/mininet/sessions", { cookie: auth.cookie, method: "POST", body: JSON.stringify({}) });
		const creates = mininet.log.slice(before).filter((entry) => entry.method === "POST" && entry.path === "/api/simulation/sessions").length;
		log(
			"⑯ 已绑定时再建会话 → 409 lab_session_exists 且零上游写",
			again.status === 409 && again.json?.message === "lab_session_exists" && creates === 1,
			`${again.status} posts=${creates}`
		);

		const node = await request(port, "/api/mininet/sessions/sim_0001/nodes", {
			cookie: auth.cookie,
			method: "POST",
			body: JSON.stringify({ id: "h9", type: "host", attributes: { ip: "10.0.0.9", mac: "00:00:00:00:00:09" } })
		});
		const nodeHit = mininet.log.slice(before).find((entry) => entry.method === "POST" && entry.path === "/api/simulation/sessions/sim_0001/nodes");
		const converged = ledgerRecordOf(sessionLedgerFile, "net_m1");
		log(
			"⑯ 建节点走会话端点，且台账清单收敛（新节点不再被判成清单外）",
			node.status === 201 && !!nodeHit && converged?.resources?.nodes?.includes("h9") === true,
			`${node.status} nodes=${describe(converged?.resources?.nodes)}`
		);

		const list = await request(port, "/api/mininet/sessions", { cookie: auth.cookie });
		const listed = (list.json?.data?.sessions ?? []).map((item) => item.id);
		log(
			"⑯ GET /sessions 只回绑定的那一条（同实例别人的会话不透出）",
			list.status === 200 && list.json?.data?.total === 1 && listed.join() === "sim_0001",
			describe(listed)
		);

		const foreignBefore = mininet.log.length;
		const foreign = await request(port, "/api/mininet/sessions/sim_9999/nodes", {
			cookie: auth.cookie,
			method: "POST",
			body: JSON.stringify({ id: "h8", type: "host", attributes: {} })
		});
		const touched = mininet.log.length - foreignBefore;
		log(
			"⑯ 未绑定的会话路径 → 404 lab_resource_not_found 且零上游请求",
			foreign.status === 404 && foreign.json?.message === "lab_resource_not_found" && touched === 0,
			`${foreign.status} upstream=${touched}`
		);

		const start = await request(port, "/api/mininet/sessions/sim_0001/start", { cookie: auth.cookie, method: "POST" });
		const running = ledgerRecordOf(sessionLedgerFile, "net_m1");
		log(
			"⑯ 会话 start → 上游 live.started=true 且台账 state=running",
			start.status === 200 && start.json?.data?.live?.started === true && running?.state === "running",
			`${start.status} state=${describe(running?.state)}`
		);

		const audit = readAuditEntries(sessionAuditFile).filter((entry) => entry.action === "post /sessions");
		log(
			"⑯ 会话写端点进审计（post /sessions 有 allowed + succeeded）",
			audit.some((entry) => entry.result === "allowed") && audit.some((entry) => entry.result === "succeeded"),
			`entries=${audit.length}`
		);
	});

	const passed = results.filter((item) => item.ok).length;
	console.log(`\n${passed}/${results.length} 项通过`);
	process.exitCode = passed === results.length ? 0 : 1;
} finally {
	await closeUpstream(mininet);
	await closeUpstream(iam);
}
