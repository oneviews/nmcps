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
//   ⑦ 认证会话（NMCPS-ADR-0011 的 cookie / 单飞 / CSRF 条款 + NMCPS-ADR-0018 的新代接口事实）：
//      web HttpOnly 三 cookie（at / rt / ui）/ desktop body 令牌、会话由 user_info 派生（无 whoami）、
//      刷新**不轮换**、业务错误 `200 + code≠0` 还原为 4xx、CSRF 403、登出幂等恒 ok
//   ⑧ 出口归一与脱敏（NMCPS-ADR-0018 D6 / D7）：新命名空间放行、`data.list: null` → `[]`、
//      `snmp_auth_pass` / `snmp_priv_pass` 掩码 `***` 且明文不出网
import { existsSync } from "node:fs";
import { closeUpstream, freePort, HOST, SERVER_ENTRY, startBff, startUpstream, stopBff } from "./lib/bff-harness.mjs";

// ── 前置自检：先说自己缺什么，而不是让第一条断言替我们报错 ──────────────
if (!existsSync(SERVER_ENTRY)) {
	console.error(`❌ 缺少构建产物 ${SERVER_ENTRY}：先跑 \`pnpm build:server\`，再重试 \`pnpm check:bff\`。`);
	process.exit(1);
}

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

async function request(port, path, options = {}) {
	const { method = "GET", headers = {}, cookie, body } = options;
	const finalHeaders = { ...headers };
	if (cookie) finalHeaders.cookie = cookie;

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

/** 全部 `Set-Cookie`（Node 18.16+ 提供 `getSetCookie`，否则退回单值） */
function setCookies(res) {
	if (typeof res.headers.getSetCookie === "function") return res.headers.getSetCookie();
	const single = res.headers.get("set-cookie");
	return single ? [single] : [];
}

/** 按名字取出 `name=value`（用于拼后续请求的 Cookie 头） */
function findCookie(list, name) {
	const prefix = `${name}=`;
	return list.find((raw) => raw.toLowerCase().startsWith(prefix.toLowerCase()))?.split(";")[0];
}

function cookieHeader(list, name) {
	const pair = findCookie(list, name);
	return pair || "";
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

// 假上游与 BFF 进程管理见 scripts/lib/bff-harness.mjs（与 check-ui 共用）

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

	// 登录页据此文案给出可执行指引（NMCPS-ARCH-003 §7.7）：网关先在鉴权之前回 503，
	// 别让前端把「运维没配上游」读成「账号或密码错误」。
	const loginNoUpstream = await request(guardPort, "/api/auth/login", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ username: "admin", password: "irrelevant" })
	});
	log("未配置上游 → POST /api/auth/login 403 之前先回 503 bff_upstream_missing", loginNoUpstream.status === 503 && loginNoUpstream.json?.message === "bff_upstream_missing", `${loginNoUpstream.status} ${describe(loginNoUpstream.json?.message)}`);
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

	// ── ⑦ 认证会话：cookie / desktop 双通道、刷新不轮换、CSRF、业务码还原 ──
	// 依据 NMCPS-ADR-0011（…/adr-0011.md，轮换条款已被 ADR-0018 D4 取代）与
	// NMCPS-ADR-0018（…/adr-0018.md）：路径 `iam/*`、字段 snake_case、身份取 `user_info`、
	// 上游业务错误走 `HTTP 200 + code≠0` 而 BFF 必须还原 4xx 语义。
	await withBff({ NUXT_BFF_UPSTREAM_BASE: upstreamBase }, async (authPort) => {
		const jsonHeaders = { "content-type": "application/json" };
		const loginBody = (extra = {}) => JSON.stringify({ username: "alice", password: "p@ssw0rd", ...extra });

		// 1) 空 body：BFF 先用 zod 挡住，绝不把空报文送上游（上游会 500 / 10509）
		const emptyLogin = await request(authPort, "/api/auth/login", { method: "POST" });
		log("空 body 登录 → 400 bff_invalid_body，且未触达上游", emptyLogin.status === 400 && emptyLogin.json?.message === "bff_invalid_body" && upstream.authLog.login === 0, `${emptyLogin.status} ${describe(emptyLogin.json?.message)} upstreamHits=${upstream.authLog.login}`);
		log("校验失败回带字段级 error_detail（username）", Array.isArray(emptyLogin.json?.error_detail) && emptyLogin.json.error_detail.some((item) => (item.loc ?? []).includes("username")), describe(emptyLogin.json?.error_detail?.[0]));

		// 1b) 非 JSON 报文：上游不校验 Content-Type（form-urlencoded 会 500 / 10509），BFF 必须同样挡在门外
		const formLogin = await request(authPort, "/api/auth/login", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: "username=alice&password=p%40ssw0rd"
		});
		log("form-urlencoded 登录 → 400 bff_invalid_body，且未触达上游", formLogin.status === 400 && formLogin.json?.message === "bff_invalid_body" && upstream.authLog.login === 0, `${formLogin.status} ${describe(formLogin.json?.message)} upstreamHits=${upstream.authLog.login}`);

		// 1c) 旧代字段名退场：`accountName` / `tenantCode` 不再被接受（NMCPS-ADR-0018 §4.1）
		const legacyLogin = await request(authPort, "/api/auth/login", {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ accountName: "alice", password: "p@ssw0rd", tenantCode: "t1" })
		});
		log("旧代 accountName / tenantCode 登录 → 400 bff_invalid_body（字段名不复古）", legacyLogin.status === 400 && legacyLogin.json?.message === "bff_invalid_body" && upstream.authLog.login === 0, `${legacyLogin.status} upstreamHits=${upstream.authLog.login}`);

		// 2) 新代业务错误形态：上游 HTTP 200 + `code: 10003`（口令错）—— BFF 必须
		//    还原为 401 + 业务码，绝不能因为「HTTP 200」就当成登录成功（NMCPS-ADR-0018 D5）
		const bizError = await request(authPort, "/api/auth/login", {
			method: "POST",
			headers: jsonHeaders,
			body: loginBody({ username: "biz-error-user" })
		});
		log("上游 200 + code 10003 → BFF 401 且业务码保真（不判成功）", bizError.status === 401 && bizError.json?.code === 10003 && bizError.json?.status === "warning", `${bizError.status} ${describe(bizError.json?.status)} ${describe(bizError.json?.code)}`);
		log("200 + 10003 不写会话 cookie，msg 归一为 message", !setCookies(bizError).some((raw) => raw.startsWith("nmcps_at=")) && bizError.json?.message === "账号或密码错误", describe(bizError.json?.message));

		// 2b) Web 登录：令牌只进 HttpOnly cookie，身份落 nmcps_ui，响应体不含令牌
		const webLogin = await request(authPort, "/api/auth/login", { method: "POST", headers: jsonHeaders, body: loginBody() });
		const webCookies = setCookies(webLogin);
		const accessCookie = webCookies.find((raw) => raw.startsWith("nmcps_at=")) ?? "";
		const refreshCookie = webCookies.find((raw) => raw.startsWith("nmcps_rt=")) ?? "";
		const userCookie = webCookies.find((raw) => raw.startsWith("nmcps_ui=")) ?? "";
		log("Web 登录 200 且响应体不含令牌（expiresIn 取上游 86400）", webLogin.status === 200 && webLogin.json?.data?.tokens === undefined && webLogin.json?.data?.expiresIn === 86400, `${webLogin.status} ${describe(webLogin.json?.data && Object.keys(webLogin.json.data))}`);
		log("访问令牌 cookie 为 HttpOnly + Path=/", /HttpOnly/i.test(accessCookie) && /Path=\//i.test(accessCookie), accessCookie);
		log("刷新令牌 cookie 为 HttpOnly + Path=/api/auth", /HttpOnly/i.test(refreshCookie) && /Path=\/api\/auth/i.test(refreshCookie), refreshCookie);
		log("身份 cookie 为 HttpOnly + Path=/api/auth", /HttpOnly/i.test(userCookie) && /Path=\/api\/auth/i.test(userCookie), userCookie.split(";")[0]);
		log("user_info 归一为 AuthUser（display_name → displayName，空 phone → null）", webLogin.json?.data?.user?.username === "alice" && webLogin.json?.data?.user?.displayName === "Alice" && webLogin.json?.data?.user?.phone === null && webLogin.json?.data?.user?.tenantId === "t_default", describe(webLogin.json?.data?.user));
		log("认证响应禁止缓存", webLogin.headers.get("cache-control") === "no-store", describe(webLogin.headers.get("cache-control")));

		// 3) 桌面登录：响应体回传 snake_case tokens，且不写 cookie
		const desktopLogin = await request(authPort, "/api/auth/login", {
			method: "POST",
			headers: { ...jsonHeaders, "x-nmcps-client": "desktop" },
			body: loginBody()
		});
		const desktopTokens = desktopLogin.json?.data?.tokens;
		log("桌面登录 200 且响应体带 snake_case tokens", desktopLogin.status === 200 && desktopTokens?.access_token === "at-2" && desktopTokens?.refresh_token === "rt-2", describe(desktopTokens));
		log("桌面登录不写会话 cookie", !setCookies(desktopLogin).some((raw) => raw.startsWith("nmcps_at=")), `${setCookies(desktopLogin).length} 个 Set-Cookie`);
	});
	// ── ⑦-2 会话 / 刷新 / 改密 / 登出：不轮换、不触达上游、业务码还原 ──
	await withBff({ NUXT_BFF_UPSTREAM_BASE: upstreamBase }, async (authPort) => {
		const sameOrigin = `http://${HOST}:${authPort}`;
		const jsonHeaders = { "content-type": "application/json" };
		const login = await request(authPort, "/api/auth/login", {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ username: "alice", password: "p@ssw0rd" })
		});
		const cookies = setCookies(login);
		const atPair = cookieHeader(cookies, "nmcps_at");
		const rtPair = cookieHeader(cookies, "nmcps_rt");
		const uiPair = cookieHeader(cookies, "nmcps_ui");

		// 4) 会话由身份 cookie 派生，且**不触达上游**（新代无 whoami，NMCPS-ADR-0018 D3）
		const sessionHit = await request(authPort, "/api/auth/session", { cookie: `${atPair}; ${uiPair}` });
		log("会话由身份 cookie 派生 → 200 authenticated:true 且带 user", sessionHit.status === 200 && sessionHit.json?.data?.authenticated === true && sessionHit.json?.data?.user?.username === "alice", `${sessionHit.status} ${describe(sessionHit.json?.data?.user)}`);

		const blind = await request(authPort, "/api/auth/session", { cookie: `nmcps_at=bogus-token; ${uiPair}` });
		log("会话不依赖上游（坏访问令牌 + 合法身份仍为已登录）", blind.status === 200 && blind.json?.data?.authenticated === true, `${blind.status} ${describe(blind.json?.data?.authenticated)}`);

		const sessionAnon = await request(authPort, "/api/auth/session");
		log("无令牌会话 → 200 authenticated:false（不返回 401）", sessionAnon.status === 200 && sessionAnon.json?.data?.authenticated === false && sessionAnon.json?.data?.user === null, `${sessionAnon.status} ${describe(sessionAnon.json?.data)}`);

		const half = await request(authPort, "/api/auth/session", { cookie: atPair });
		log("半截会话（有令牌无身份）→ 200 未登录并清 cookie", half.status === 200 && half.json?.data?.authenticated === false && setCookies(half).some((raw) => raw.startsWith("nmcps_at=;")), `${half.status} ${describe(setCookies(half).length)}`);

		// 5) 刷新**不轮换**（NMCPS-ADR-0018 D4）：同一刷新令牌连用两次都成功，cookie 值不变
		const firstRefresh = await request(authPort, "/api/auth/refresh", {
			method: "POST",
			headers: { origin: sameOrigin },
			cookie: rtPair
		});
		const refreshed = setCookies(firstRefresh);
		const newAccess = refreshed.find((raw) => raw.startsWith("nmcps_at=")) ?? "";
		const rtAfter = (refreshed.find((raw) => raw.startsWith("nmcps_rt=")) ?? rtPair).split(";")[0];
		log("Web 刷新 200 且换发访问令牌（响应体不含令牌）", firstRefresh.status === 200 && firstRefresh.json?.data?.tokens === undefined && newAccess.startsWith("nmcps_at=at-") && newAccess !== atPair, `${firstRefresh.status} ${newAccess}`);
		log("刷新后刷新令牌原值保留（不轮换）", rtAfter === rtPair, `${rtPair} → ${rtAfter}`);

		const secondRefresh = await request(authPort, "/api/auth/refresh", {
			method: "POST",
			headers: { origin: sameOrigin },
			cookie: rtPair
		});
		log("同一 refresh 连续复用仍 200（新代不轮换）", secondRefresh.status === 200 && secondRefresh.json?.code === 0, `${secondRefresh.status} ${describe(secondRefresh.json?.code)}`);

		// 5b) 坏刷新令牌：上游 **HTTP 200 + code 10007**（实测）→ BFF 必须还原为 401 并清 cookie
		const badRefresh = await request(authPort, "/api/auth/refresh", {
			method: "POST",
			headers: { origin: sameOrigin },
			cookie: "nmcps_rt=bogus-rt"
		});
		log("坏刷新令牌 → BFF 401 且业务码 10007（上游 200+10007 被还原）", badRefresh.status === 401 && badRefresh.json?.code === 10007, `${badRefresh.status} ${describe(badRefresh.json?.code)}`);
		log("刷新失败清除会话 cookie", ["nmcps_at", "nmcps_rt", "nmcps_ui"].every((name) => setCookies(badRefresh).some((raw) => raw.startsWith(`${name}=;`))), describe(setCookies(badRefresh).length));

		// 6) 桌面刷新：`refresh_token` 走 body，回传新访问令牌并沿用原刷新令牌
		const desktopRefresh = await request(authPort, "/api/auth/refresh", {
			method: "POST",
			headers: { ...jsonHeaders, origin: "tauri://localhost", "x-nmcps-client": "desktop" },
			body: JSON.stringify({ refresh_token: rtPair.split("=")[1] })
		});
		const desktopTokens = desktopRefresh.json?.data?.tokens;
		log("桌面刷新 200 且回传新访问令牌 + 原刷新令牌", desktopRefresh.status === 200 && typeof desktopTokens?.access_token === "string" && desktopTokens.access_token !== atPair.split("=")[1] && desktopTokens.refresh_token === rtPair.split("=")[1], describe(desktopTokens));
	});
	// ── ⑦-3 改密与登出：路径 / 方法 / 字段换代、CSRF、幂等 ──
	await withBff({ NUXT_BFF_UPSTREAM_BASE: upstreamBase }, async (authPort) => {
		const sameOrigin = `http://${HOST}:${authPort}`;
		const jsonHeaders = { "content-type": "application/json" };
		const login = await request(authPort, "/api/auth/login", {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ username: "alice", password: "p@ssw0rd" })
		});
		const cookies = setCookies(login);
		const atPair = cookieHeader(cookies, "nmcps_at");
		const uiPair = cookieHeader(cookies, "nmcps_ui");
		const hitsBefore = upstream.authLog.password.length;

		// 7) 改密：空 body 挡在门外；camelCase 不再被接受；旧口令错（上游 200+10003）→ 400 + 业务码
		const emptyPassword = await request(authPort, "/api/auth/password", {
			method: "POST",
			headers: { ...jsonHeaders, origin: sameOrigin },
			cookie: atPair,
			body: "{}"
		});
		log("空 body 改密 → 400 bff_invalid_body 且未触达上游", emptyPassword.status === 400 && emptyPassword.json?.message === "bff_invalid_body" && upstream.authLog.password.length === hitsBefore, `${emptyPassword.status} upstreamHits=${upstream.authLog.password.length - hitsBefore}`);

		const camelPassword = await request(authPort, "/api/auth/password", {
			method: "POST",
			headers: { ...jsonHeaders, origin: sameOrigin },
			cookie: atPair,
			body: JSON.stringify({ newPassword: "newp@ss123", oldPassword: "p@ssw0rd" })
		});
		log("camelCase 改密字段 → 400 bff_invalid_body（上游只认 snake_case）", camelPassword.status === 400 && camelPassword.json?.message === "bff_invalid_body", `${camelPassword.status} ${describe(camelPassword.json?.message)}`);

		const wrongOld = await request(authPort, "/api/auth/password", {
			method: "POST",
			headers: { ...jsonHeaders, origin: sameOrigin },
			cookie: atPair,
			body: JSON.stringify({ old_password: "wrong", new_password: "newp@ss123" })
		});
		log("旧口令错误（上游 200 + 10003）→ BFF 400 且业务码保真", wrongOld.status === 400 && wrongOld.json?.code === 10003, `${wrongOld.status} ${describe(wrongOld.json?.code)}`);

		// 8) CSRF：无 Origin 的 cookie 改密 → 403；桌面 Bearer（无 cookie）放行且仍走业务码
		const noOrigin = await request(authPort, "/api/auth/password", {
			method: "POST",
			headers: jsonHeaders,
			cookie: atPair,
			body: JSON.stringify({ old_password: "wrong", new_password: "newp@ss123" })
		});
		log("无 Origin 的 cookie 改密 → 403 bff_csrf_rejected", noOrigin.status === 403 && noOrigin.json?.message === "bff_csrf_rejected", `${noOrigin.status} ${describe(noOrigin.json?.message)}`);

		const desktopPassword = await request(authPort, "/api/auth/password", {
			method: "POST",
			headers: { ...jsonHeaders, origin: "tauri://localhost", authorization: `Bearer ${atPair.split("=")[1]}` },
			body: JSON.stringify({ old_password: "wrong", new_password: "newp@ss123" })
		});
		log("桌面 Bearer 改密绕过 CSRF，业务码照旧保真", desktopPassword.status === 400 && desktopPassword.json?.code === 10003, `${desktopPassword.status} ${describe(desktopPassword.json?.code)}`);

		// 8b) 真正改密成功：上游收到 PUT + snake_case，BFF 回 { ok:true }
		const changeOk = await request(authPort, "/api/auth/password", {
			method: "POST",
			headers: { ...jsonHeaders, origin: sameOrigin },
			cookie: atPair,
			body: JSON.stringify({ old_password: "p@ssw0rd", new_password: "newp@ss123" })
		});
		const upstreamPw = upstream.authLog.password.at(-1);
		log("改密 200 { ok:true } 且上游收到 snake_case 字段", changeOk.status === 200 && changeOk.json?.data?.ok === true && upstreamPw?.new_password === "newp@ss123" && upstreamPw?.old_password === "p@ssw0rd", `${changeOk.status} ${describe(upstreamPw)}`);
		log("改密转发方法为 PUT（旧代是 POST）", upstream.authLog.passwordMethod === "PUT", describe(upstream.authLog.passwordMethod));

		// 9) 登出：无 Origin → 403；登出 200 且清三种 cookie；上游收到 Bearer + user_id；重复登出仍 200（幂等）
		const logoutNoOrigin = await request(authPort, "/api/auth/logout", {
			method: "POST",
			cookie: `${atPair}; ${uiPair}`
		});
		log("无 Origin 的 cookie 登出 → 403 bff_csrf_rejected", logoutNoOrigin.status === 403 && logoutNoOrigin.json?.message === "bff_csrf_rejected", `${logoutNoOrigin.status} ${describe(logoutNoOrigin.json?.message)}`);

		const logout = await request(authPort, "/api/auth/logout", {
			method: "POST",
			headers: { origin: sameOrigin },
			cookie: `${atPair}; ${uiPair}`
		});
		const upstreamLogout = upstream.authLog.logout.at(-1);
		log("登出 200 { ok:true } 并清三种 cookie", logout.status === 200 && logout.json?.data?.ok === true && ["nmcps_at", "nmcps_rt", "nmcps_ui"].every((name) => setCookies(logout).some((raw) => raw.startsWith(`${name}=;`))), `${logout.status} ${describe(setCookies(logout).length)}`);
		log("登出携带 Bearer + { user_id }（取自会话身份）", (upstreamLogout?.authorization ?? "").startsWith("Bearer at-") && upstreamLogout?.body?.user_id === "u_alice", describe(upstreamLogout));

		const logoutAgain = await request(authPort, "/api/auth/logout", {
			method: "POST",
			headers: { origin: sameOrigin },
			cookie: `${atPair}; ${uiPair}`
		});
		log("重复登出仍 200 { ok:true }（上游幂等，BFF 兜底）", logoutAgain.status === 200 && logoutAgain.json?.data?.ok === true, `${logoutAgain.status} ${describe(logoutAgain.json?.data)}`);
	});

	// ── ⑧ 出口归一与脱敏（NMCPS-ADR-0018 D6 / D7） ───────────────
	// 上游空结果是 `list: null`、资产设备明文吐 SNMP 凭据：两者都必须在 BFF 出口一次做完，
	// 否则消费面 `.map` 崩、明文凭据已经过网。
	await withBff({ NUXT_BFF_UPSTREAM_BASE: upstreamBase }, async (exitPort) => {
		const asset = await request(exitPort, "/api/asset/device?page=1&page_size=10");
		const device = asset.json?.data?.list?.[0];
		log("新命名空间 asset 放行并透传（白名单 = 十二命名空间）", asset.status === 200 && asset.json?.code === 0 && device?.id === "dev-1001", `${asset.status} ${describe(device?.id)}`);
		log("snmp_auth_pass 出口掩码为 ***（上游明文不过网）", device?.snmp_auth_pass === "***", describe(device?.snmp_auth_pass));
		log("snmp_priv_pass 出口掩码为 ***", device?.snmp_priv_pass === "***", describe(device?.snmp_priv_pass));
		log("掩码不影响其它字段（name / status 原样）", device?.name === "核心交换机" && device?.status === "online", describe(device));
		log("响应体不出现明文凭据", !asset.text.includes("auth-secret-1") && !asset.text.includes("priv-secret-1"), asset.text.slice(0, 200));

		const logs = await request(exitPort, "/api/audit/operation-logs?page=1&page_size=1");
		log("上游 data.list:null → 出口归一为 []", logs.status === 200 && Array.isArray(logs.json?.data?.list) && logs.json.data.list.length === 0, describe(logs.json?.data?.list));
		log("归一不影响 data 内分页字段（page / page_size / total）", logs.json?.data?.page === 1 && logs.json?.data?.page_size === 1 && logs.json?.data?.total === 0, describe(logs.json?.data));

		const systemNamespace = await request(exitPort, "/api/system/overview");
		const transmissionNamespace = await request(exitPort, "/api/transmission/sites");
		log("system / transmission 命名空间在白名单内（非 resource_not_allowed）", [systemNamespace, transmissionNamespace].every((res) => res.status !== 404 || res.json?.message !== "bff_resource_not_allowed"), `${describe(systemNamespace.json?.message)} / ${describe(transmissionNamespace.json?.message)}`);
	});
} finally {
	await closeUpstream(upstream);
}

const passed = results.filter((item) => item.ok).length;
console.log(`\n${passed}/${results.length} 项通过`);
process.exit(passed === results.length ? 0 : 1);
