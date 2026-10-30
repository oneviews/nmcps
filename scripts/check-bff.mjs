// scripts/check-bff.mjs
// BFF 网关契约自查（依据 NMCPS-ADR-0007：layers/content/collections/cn/records/adr/adr-0007.md；
// 就绪探针与 SSE 透传依据 NMCPS-ADR-0010：layers/content/collections/cn/records/adr/adr-0010.md）。
//
// 前置：`pnpm build:server` —— 本脚本只消费 `.output/server/index.mjs`，不自行构建；
// 它会自己拉起构建产物与一个本地假上游，跑完即关，因此不需要预先占用端口。
//
// 断言分组：
//   ① 存活与信封形态：/health、/ready 未配上游、/api 与 /api/ 的拒绝、拒绝也用 ApiResponse 信封
//   ② 白名单边界：未知资源 404、动词 405、资源级 PATCH 例外、路径穿越 400、未配上游 503
//   ③ 凭据型 CORS：白名单 Origin 回显、非白名单不回显、预检 204 / 403
//   ④ 出站行为（对假上游）：裸 JSON 包裹、已是信封则原样、上游 4xx 透传、超时 504、
//      token cookie → Bearer、显式 Authorization 优先、非白名单请求头不转发
//   ⑤ 就绪探针：/ready 成功态 + 缺失 / 不可达 / 超时 / 非 2xx 四种 not_ready，且不回显上游地址
//   ⑥ SSE 流式透传：content-type 保留、增量到达（非整体缓冲）、事件完整、不套信封、禁止缓存
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const SERVER_ENTRY = ".output/server/index.mjs";
const HOST = "127.0.0.1";
const START_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 5_000;

const results = [];

function log(label, ok, detail) {
	results.push({ label, ok: !!ok });
	console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

function describe(value) {
	if (value === undefined) return "";
	if (typeof value === "string") return value;
	return JSON.stringify(value);
}

/** 进程内申请一个空闲端口，避免与 dev server / 已部署实例冲突 */
async function freePort() {
	const probe = createNetServer();
	await new Promise((resolve, reject) => {
		probe.once("error", reject);
		probe.listen(0, HOST, resolve);
	});
	const { port } = probe.address();
	await new Promise((resolve) => probe.close(resolve));
	return port;
}

async function startBff(port, env) {
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
			if (res.ok) return child;
		} catch {
			// 端口尚未监听，继续等
		}
		await delay(200);
	}

	child.kill("SIGKILL");
	throw new Error(`BFF 未在 ${START_TIMEOUT_MS}ms 内就绪\n${output}`);
}

async function stopBff(child) {
	if (!child || child.exitCode !== null) return;
	child.kill("SIGTERM");
	const deadline = Date.now() + STOP_TIMEOUT_MS;
	while (child.exitCode === null && Date.now() < deadline) await delay(50);
	if (child.exitCode === null) child.kill("SIGKILL");
}

async function request(port, path, options = {}) {
	const { method = "GET", headers = {}, cookie } = options;
	const finalHeaders = { ...headers };
	if (cookie) finalHeaders.cookie = cookie;

	const res = await fetch(`http://${HOST}:${port}${path}`, {
		method,
		headers: finalHeaders,
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

/** 拉起一个临时 BFF 实例跑一段断言，结束后必关（探针用例每个原因都要换配置） */
async function withBff(env, fn) {
	const port = await freePort();
	const child = await startBff(port, env);
	try {
		return await fn(port);
	} finally {
		await stopBff(child);
	}
}

/** 关闭假上游：先销毁 keep-alive 连接，避免探针用例留下挂起的 socket 拖住 close */
async function closeUpstream(server) {
	server.closeAllConnections?.();
	await new Promise((resolve) => server.close(resolve));
}

/**
 * 读取一个流式响应，记录每块到达时刻。
 * `chunks.length >= 2` 且首块明显早于结束，说明网关是边收边发而不是攒完整包。
 */
async function readStream(port, path) {
	const res = await fetch(`http://${HOST}:${port}${path}`);
	const startedAt = Date.now();
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	const chunks = [];
	let text = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done)
			break;
		const chunk = decoder.decode(value, { stream: true });
		chunks.push({ at: Date.now() - startedAt, length: chunk.length });
		text += chunk;
	}

	return {
		status: res.status,
		headers: res.headers,
		chunks,
		text,
		totalMs: Date.now() - startedAt
	};
}

/** 假上游：覆盖裸 JSON、已是信封、业务错误、慢响应、Header 回显、健康探针与 SSE 流 */
async function startUpstream(port) {
	const server = createHttpServer(async (req, res) => {
		const url = new URL(req.url ?? "/", `http://${HOST}:${port}`);
		const send = (status, payload) => {
			res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
			res.end(JSON.stringify(payload));
		};

		if (url.pathname === "/health")
			return send(200, { status: "ok" });
		if (url.pathname === "/unready/health")
			return send(503, { status: "starting" });
		if (url.pathname === "/hang-health") {
			// 就绪探针超时用例：永远拖到客户端超时
			await delay(5_000);
			return send(200, { status: "ok" });
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

	return server;
}

if (!existsSync(SERVER_ENTRY)) {
	console.error(`❌ 未找到 ${SERVER_ENTRY}：请先运行 \`pnpm build:server\``);
	process.exit(1);
}

// ── ① ~ ③ 未配置上游时的网关行为（不触达任何出站） ──────────
const guardPort = await freePort();
const guardBff = await startBff(guardPort, { NUXT_BFF_UPSTREAM_BASE: "" });

try {
	const health = await request(guardPort, "/health");
	log("存活探针 /health 返回 200", health.status === 200, String(health.status));
	log("存活探针声明服务名 nmcps-bff", health.json?.service === "nmcps-bff", describe(health.json?.service));

	const readyNoUpstream = await request(guardPort, "/ready");
	log("未配上游 → /ready 503 not_ready（reason=upstream_missing）", readyNoUpstream.status === 503 && readyNoUpstream.json?.status === "not_ready" && readyNoUpstream.json?.upstream?.reason === "upstream_missing", `${readyNoUpstream.status} ${describe(readyNoUpstream.json?.upstream)}`);
	log("就绪探针禁止缓存（cache-control: no-store）", readyNoUpstream.headers.get("cache-control") === "no-store", describe(readyNoUpstream.headers.get("cache-control")));

	const apiBare = await request(guardPort, "/api");
	log("/api 无资源段 → 400 bff_path_missing", apiBare.status === 400 && apiBare.json?.message === "bff_path_missing", `${apiBare.status} ${describe(apiBare.json?.message)}`);

	const apiSlash = await request(guardPort, "/api/");
	log("/api/ 无资源段 → 400 bff_path_missing（不回落到 SPA HTML）", apiSlash.status === 400 && apiSlash.json?.message === "bff_path_missing", `${apiSlash.status} ${apiSlash.headers.get("content-type")}`);

	log("网关拒绝同样使用 ApiResponse 信封", ["code", "status", "message", "timestamp"].every((key) => key in (apiSlash.json ?? {})), describe(apiSlash.json));

	const unknown = await request(guardPort, "/api/notaresource");
	log("非白名单资源 → 404 bff_resource_not_allowed", unknown.status === 404 && unknown.json?.message === "bff_resource_not_allowed", `${unknown.status} ${describe(unknown.json?.message)}`);

	const traversal = await request(guardPort, "/api/device/..%2f..%2fetc");
	log("路径穿越 → 400 bff_path_invalid", traversal.status === 400 && traversal.json?.message === "bff_path_invalid", `${traversal.status} ${describe(traversal.json?.message)}`);

	const patchDevice = await request(guardPort, "/api/device/1", { method: "PATCH" });
	log("PATCH device → 405 bff_method_not_allowed", patchDevice.status === 405 && patchDevice.json?.message === "bff_method_not_allowed", `${patchDevice.status} ${describe(patchDevice.json?.message)}`);

	const patchFrequency = await request(guardPort, "/api/frequency/1", { method: "PATCH" });
	log("PATCH frequency 属资源级放行（非 405）", patchFrequency.status === 503 && patchFrequency.json?.message === "bff_upstream_missing", `${patchFrequency.status} ${describe(patchFrequency.json?.message)}`);

	const noUpstream = await request(guardPort, "/api/device/abc");
	log("未配置上游 → 503 bff_upstream_missing", noUpstream.status === 503 && noUpstream.json?.message === "bff_upstream_missing", `${noUpstream.status} ${describe(noUpstream.json?.message)}`);
	log("5xx 信封语义为 error", noUpstream.json?.status === "error", describe(noUpstream.json?.status));

	const evilOrigin = await request(guardPort, "/api/device", { headers: { origin: "https://evil.example" } });
	log("非白名单 Origin 不回显 ACAO", !evilOrigin.headers.get("access-control-allow-origin"), evilOrigin.headers.get("access-control-allow-origin") ?? "无");

	const allowedOrigin = await request(guardPort, "/api/device", { headers: { origin: "tauri://localhost" } });
	log("白名单 Origin 回显 ACAO", allowedOrigin.headers.get("access-control-allow-origin") === "tauri://localhost", describe(allowedOrigin.headers.get("access-control-allow-origin")));
	log("白名单 Origin 允许 credentials", allowedOrigin.headers.get("access-control-allow-credentials") === "true", describe(allowedOrigin.headers.get("access-control-allow-credentials")));

	const preflight = await request(guardPort, "/api/device", {
		method: "OPTIONS",
		headers: { origin: "http://localhost:3000", "access-control-request-method": "POST" }
	});
	log("白名单 Origin 预检 → 204", preflight.status === 204, String(preflight.status));

	const evilPreflight = await request(guardPort, "/api/device", {
		method: "OPTIONS",
		headers: { origin: "https://evil.example", "access-control-request-method": "POST" }
	});
	log("非白名单 Origin 预检 → 403", evilPreflight.status === 403, String(evilPreflight.status));
} finally {
	await stopBff(guardBff);
}

// ── ④ 配置假上游后的出站行为 ──────────────────────────────
const upstreamPort = await freePort();
const upstream = await startUpstream(upstreamPort);
const proxyPort = await freePort();
const proxyBff = await startBff(proxyPort, {
	NUXT_BFF_UPSTREAM_BASE: `http://${HOST}:${upstreamPort}`,
	NUXT_BFF_TIMEOUT_MS: "1000"
});

try {
	const wrapped = await request(proxyPort, "/api/device/ok");
	log("上游裸 JSON → 包裹为 code=0 信封", wrapped.status === 200 && wrapped.json?.code === 0 && wrapped.json?.data?.id === "dev-1", describe(wrapped.json));

	const passthrough = await request(proxyPort, "/api/device/envelope");
	log("上游已是信封 → 原样返回", passthrough.status === 200 && passthrough.json?.code === 0 && passthrough.json?.data?.ok === true, describe(passthrough.json));

	const upstreamError = await request(proxyPort, "/api/device/error");
	log("上游 4xx → 保留状态码 + warning 语义", upstreamError.status === 400 && upstreamError.json?.status === "warning", `${upstreamError.status} ${describe(upstreamError.json?.status)}`);
	log("上游 4xx → 保留原始 message", upstreamError.json?.message === "device_not_found", describe(upstreamError.json?.message));

	const timeout = await request(proxyPort, "/api/device/slow");
	log("上游超时 → 504 bff_upstream_timeout", timeout.status === 504 && timeout.json?.message === "bff_upstream_timeout", `${timeout.status} ${describe(timeout.json?.message)}`);

	const cookieAuth = await request(proxyPort, "/api/device/echo", { cookie: "nmcps_at=token-123" });
	log("token cookie → 转为 Bearer 发往上游", cookieAuth.json?.data?.authorization === "Bearer token-123", describe(cookieAuth.json?.data?.authorization));

	const explicitAuth = await request(proxyPort, "/api/device/echo", { headers: { authorization: "Bearer explicit" } });
	log("显式 Authorization 优先于 cookie", explicitAuth.json?.data?.authorization === "Bearer explicit", describe(explicitAuth.json?.data?.authorization));

	const headerAllowlist = await request(proxyPort, "/api/device/echo", { headers: { "x-evil": "1" } });
	log("非白名单请求头不转发给上游", headerAllowlist.json?.data?.evil === null, describe(headerAllowlist.json?.data?.evil));

	const noStore = await request(proxyPort, "/api/device/ok");
	log("网关响应禁止缓存（cache-control: no-store）", noStore.headers.get("cache-control") === "no-store", describe(noStore.headers.get("cache-control")));
} finally {
	await stopBff(proxyBff);
}

// ── ⑤ 就绪探针：成功态 + 三种失败原因（假上游仍存活） ──────────
const upstreamBase = `http://${HOST}:${upstreamPort}`;

try {
	await withBff({ NUXT_BFF_UPSTREAM_BASE: upstreamBase, NUXT_BFF_READINESS_TIMEOUT_MS: "1000" }, async (probePort) => {
		const ready = await request(probePort, "/ready");
		log("上游可达 → /ready 200 ready", ready.status === 200 && ready.json?.status === "ready" && ready.json?.upstream?.configured === true, `${ready.status} ${describe(ready.json?.upstream)}`);
		log("/ready 回显上游状态码与探针耗时", ready.json?.upstream?.status === 200 && typeof ready.json?.upstream?.latencyMs === "number", describe(ready.json?.upstream));
		log("/ready 不回显上游地址（不泄露内网拓扑）", !ready.text.includes(`${HOST}:${upstreamPort}`), ready.text.slice(0, 160));
	});

	await withBff({ NUXT_BFF_UPSTREAM_BASE: `${upstreamBase}/unready` }, async (probePort) => {
		const unhealthy = await request(probePort, "/ready");
		log("上游 5xx → /ready 503 upstream_unhealthy", unhealthy.status === 503 && unhealthy.json?.upstream?.reason === "upstream_unhealthy", `${unhealthy.status} ${describe(unhealthy.json?.upstream)}`);
	});

	const closedPort = await freePort();
	await withBff({ NUXT_BFF_UPSTREAM_BASE: `http://${HOST}:${closedPort}` }, async (probePort) => {
		const unreachable = await request(probePort, "/ready");
		log("上游不可达 → /ready 503 upstream_unreachable", unreachable.status === 503 && unreachable.json?.upstream?.reason === "upstream_unreachable", `${unreachable.status} ${describe(unreachable.json?.upstream)}`);
	});

	await withBff({ NUXT_BFF_UPSTREAM_BASE: upstreamBase, NUXT_BFF_READINESS_PATH: "/hang-health", NUXT_BFF_READINESS_TIMEOUT_MS: "300" }, async (probePort) => {
		const timedOut = await request(probePort, "/ready");
		log("探针超时 → /ready 503 upstream_timeout", timedOut.status === 503 && timedOut.json?.upstream?.reason === "upstream_timeout", `${timedOut.status} ${describe(timedOut.json?.upstream)}`);
	});

	// ── ⑥ SSE 流式透传：增量到达、不被信封包裹 ────────────────
	await withBff({ NUXT_BFF_UPSTREAM_BASE: upstreamBase, NUXT_BFF_TIMEOUT_MS: "1000" }, async (streamPort) => {
		const stream = await readStream(streamPort, "/api/device/stream");
		log("SSE 保留上游 content-type = text/event-stream", stream.status === 200 && (stream.headers.get("content-type") ?? "").startsWith("text/event-stream"), `${stream.status} ${describe(stream.headers.get("content-type"))}`);
		log("SSE 首块早于流结束（未整体缓冲）", stream.chunks.length >= 2 && stream.chunks[0].at + 80 < stream.totalMs, `chunks=${stream.chunks.length} first=${stream.chunks[0]?.at}ms total=${stream.totalMs}ms`);
		log("SSE 三个事件完整透传", (stream.text.match(/^data: tick-\d$/gm) ?? []).length === 3, describe(stream.text.slice(0, 120)));
		log("SSE 不被 ApiResponse 信封包裹", !stream.text.includes("\"code\":0"), stream.text.includes("\"code\":0") ? "含信封字段" : "裸事件流");
		log("SSE 禁止缓存并关闭代理缓冲", stream.headers.get("cache-control") === "no-store" && stream.headers.get("x-accel-buffering") === "no", `${describe(stream.headers.get("cache-control"))} / ${describe(stream.headers.get("x-accel-buffering"))}`);
	});
} finally {
	await closeUpstream(upstream);
}

const passed = results.filter((item) => item.ok).length;
console.log(`\n${passed}/${results.length} 项通过`);
process.exit(passed === results.length ? 0 : 1);
