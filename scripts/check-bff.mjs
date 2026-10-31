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
//   ⑦ 认证会话（NMCPS-ADR-0011）：web HttpOnly 双 cookie / desktop body 令牌、会话单一事实源、
//      刷新即轮换、CSRF 403、登出恒 ok、上游业务码（10201 / 20205）保真
import { existsSync } from "node:fs";
import { closeUpstream, freePort, HOST, SERVER_ENTRY, startBff, startUpstream, stopBff } from "./lib/bff-harness.mjs";

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
		body: JSON.stringify({ accountName: "admin", password: "irrelevant" })
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

	// ── ⑦ 认证会话：cookie / desktop 双通道、刷新轮换、CSRF、业务码保真 ──
	// 依据 NMCPS-ADR-0011（layers/content/collections/cn/records/adr/adr-0011.md）
	await withBff({ NUXT_BFF_UPSTREAM_BASE: upstreamBase }, async (authPort) => {
		const sameOrigin = `http://${HOST}:${authPort}`;
		const jsonHeaders = { "content-type": "application/json" };
		const loginBody = (extra = {}) => JSON.stringify({ accountName: "alice", password: "p@ssw0rd", tenantCode: "t1", ...extra });

		// 1) 空 body：BFF 先用 zod 挡住，绝不把空报文送上游（上游会 500 / 10509）
		const emptyLogin = await request(authPort, "/api/auth/login", { method: "POST" });
		log("空 body 登录 → 400 bff_invalid_body，且未触达上游", emptyLogin.status === 400 && emptyLogin.json?.message === "bff_invalid_body" && upstream.authLog.login === 0, `${emptyLogin.status} ${describe(emptyLogin.json?.message)} upstreamHits=${upstream.authLog.login}`);
		log("校验失败回带字段级 error_detail", Array.isArray(emptyLogin.json?.error_detail) && emptyLogin.json.error_detail.some((item) => (item.loc ?? []).includes("accountName")), describe(emptyLogin.json?.error_detail?.[0]));

		// 2) Web 登录：令牌只进 HttpOnly cookie，响应体不含令牌
		const webLogin = await request(authPort, "/api/auth/login", { method: "POST", headers: jsonHeaders, body: loginBody() });
		const webCookies = setCookies(webLogin);
		const accessCookie = webCookies.find((raw) => raw.startsWith("nmcps_at=")) ?? "";
		const refreshCookie = webCookies.find((raw) => raw.startsWith("nmcps_rt=")) ?? "";
		log("Web 登录 200 且响应体不含令牌", webLogin.status === 200 && webLogin.json?.data?.tokens === undefined && webLogin.json?.data?.expiresIn === 1800, `${webLogin.status} ${describe(webLogin.json?.data && Object.keys(webLogin.json.data))}`);
		log("访问令牌 cookie 为 HttpOnly + Path=/", /HttpOnly/i.test(accessCookie) && /Path=\//i.test(accessCookie), accessCookie);
		log("刷新令牌 cookie 为 HttpOnly + Path=/api/auth", /HttpOnly/i.test(refreshCookie) && /Path=\/api\/auth/i.test(refreshCookie), refreshCookie);
		log("登录展示名缺失即 null（不用 accountCode 冒充）", webLogin.json?.data?.user?.displayName === null && webLogin.json?.data?.user?.accountName === "alice", describe(webLogin.json?.data?.user));
		log("认证响应禁止缓存", webLogin.headers.get("cache-control") === "no-store", describe(webLogin.headers.get("cache-control")));

		// 3) 桌面登录：响应体回传 tokens，且不写 cookie
		const desktopLogin = await request(authPort, "/api/auth/login", {
			method: "POST",
			headers: { ...jsonHeaders, "x-nmcps-client": "desktop" },
			body: loginBody()
		});
		const desktopTokens = desktopLogin.json?.data?.tokens;
		log("桌面登录 200 且响应体带 tokens", desktopLogin.status === 200 && desktopTokens?.accessToken === "at-2" && desktopTokens?.refreshToken === "rt-2", describe(desktopTokens));
		log("桌面登录不写会话 cookie", !setCookies(desktopLogin).some((raw) => raw.startsWith("nmcps_at=")), `${setCookies(desktopLogin).length} 个 Set-Cookie`);

		// 4) 会话：cookie 命中上游 bearer 后返回用户；无令牌/失效令牌一律 200 + authenticated:false
		const sessionAuthed = await request(authPort, "/api/auth/session", { cookie: cookieHeader(webCookies, "nmcps_at") });
		log("会话 cookie → 200 authenticated:true 且回传用户", sessionAuthed.status === 200 && sessionAuthed.json?.data?.authenticated === true && sessionAuthed.json?.data?.user?.displayName === "Alice" && sessionAuthed.json?.data?.user?.tenantId === 7, `${sessionAuthed.status} ${describe(sessionAuthed.json?.data?.user)}`);

		const sessionAnon = await request(authPort, "/api/auth/session");
		log("无令牌会话 → 200 authenticated:false（不返回 401）", sessionAnon.status === 200 && sessionAnon.json?.data?.authenticated === false && sessionAnon.json?.data?.user === null, `${sessionAnon.status} ${describe(sessionAnon.json?.data)}`);

		const sessionExpired = await request(authPort, "/api/auth/session", { cookie: "nmcps_at=revoked" });
		log("上游 10201 → 200 未登录并清除 cookie", sessionExpired.status === 200 && sessionExpired.json?.data?.authenticated === false && setCookies(sessionExpired).some((raw) => raw.startsWith("nmcps_at=;")), `${sessionExpired.status} ${describe(setCookies(sessionExpired))}`);

		// 5) 刷新即轮换：旧 refresh 只能成功一次，且 web 不回传令牌
		const refreshed = await request(authPort, "/api/auth/refresh", {
			method: "POST",
			headers: { origin: sameOrigin },
			cookie: cookieHeader(webCookies, "nmcps_rt")
		});
		const rotatedCookies = setCookies(refreshed);
		const rotatedAccess = rotatedCookies.find((raw) => raw.startsWith("nmcps_at=")) ?? "";
		log("Web 刷新 200 并轮换双 cookie（响应体不含令牌）", refreshed.status === 200 && refreshed.json?.data?.tokens === undefined && rotatedAccess.length > 0 && rotatedAccess !== accessCookie, `${refreshed.status} ${rotatedAccess}`);
		log("刷新后访问令牌被替换（非 at-1）", !rotatedAccess.startsWith("nmcps_at=at-1;"), rotatedAccess);

		const reused = await request(authPort, "/api/auth/refresh", {
			method: "POST",
			headers: { origin: sameOrigin },
			cookie: cookieHeader(webCookies, "nmcps_rt")
		});
		log("重复使用旧 refresh → 401 且业务码保留 10201", reused.status === 401 && reused.json?.code === 10201, `${reused.status} ${describe(reused.json?.code)}`);
		log("刷新失败清除会话 cookie", setCookies(reused).some((raw) => raw.startsWith("nmcps_at=;")), describe(setCookies(reused)));

		// 6) 桌面刷新：refreshToken 走 body，新 tokens 回传；Origin 为 tauri 白名单
		const desktopRefresh = await request(authPort, "/api/auth/refresh", {
			method: "POST",
			headers: { ...jsonHeaders, origin: "tauri://localhost", "x-nmcps-client": "desktop" },
			body: JSON.stringify({ refreshToken: desktopTokens?.refreshToken })
		});
		log("桌面刷新 200 并回传新 tokens", desktopRefresh.status === 200 && typeof desktopRefresh.json?.data?.tokens?.accessToken === "string" && desktopRefresh.json.data.tokens.accessToken !== desktopTokens?.accessToken, `${desktopRefresh.status} ${describe(desktopRefresh.json?.data?.tokens)}`);

		const revokedRefresh = await request(authPort, "/api/auth/refresh", {
			method: "POST",
			headers: { ...jsonHeaders, origin: "tauri://localhost", "x-nmcps-client": "desktop" },
			body: JSON.stringify({ refreshToken: desktopTokens?.refreshToken })
		});
		log("桌面重复刷新 → 401 且业务码 10201", revokedRefresh.status === 401 && revokedRefresh.json?.code === 10201, `${revokedRefresh.status} ${describe(revokedRefresh.json?.code)}`);

		// 6.5) 自助安全设置：MFA 绑定 / 确认（cookie 模式，Origin 同源）
		const rotatedAt = cookieHeader(rotatedCookies, "nmcps_at");
		const bind = await request(authPort, "/api/auth/mfa/bind", {
			method: "POST",
			headers: { ...jsonHeaders, origin: sameOrigin },
			cookie: rotatedAt
		});
		log("MFA 绑定 200 且 otpauthUrl 原样透传", bind.status === 200 && (bind.json?.data?.otpauthUrl ?? "").startsWith("otpauth://totp/"), `${bind.status} ${describe(bind.json?.data)}`);
		log("MFA 绑定上游携带 Bearer", (upstream.authLog.mfaBind.at(-1)?.authorization ?? "").startsWith("Bearer at-"), describe(upstream.authLog.mfaBind.at(-1)?.authorization));
		log("mfaType 缺省时上游收到空对象（不伪造 mfaType）", upstream.authLog.mfaBind.at(-1)?.mfaType === null, describe(upstream.authLog.mfaBind.at(-1)?.mfaType));

		const bindBroken = await request(authPort, "/api/auth/mfa/bind", {
			method: "POST",
			headers: { ...jsonHeaders, origin: sameOrigin },
			cookie: rotatedAt,
			body: JSON.stringify({ mfaType: 2 })
		});
		log("上游缺 otpauthUrl → 502 bff_upstream_contract_violation", bindBroken.status === 502 && bindBroken.json?.message === "bff_upstream_contract_violation", `${bindBroken.status} ${describe(bindBroken.json?.message)}`);

		const confirmBad = await request(authPort, "/api/auth/mfa/confirm", {
			method: "POST",
			headers: { ...jsonHeaders, origin: sameOrigin },
			cookie: rotatedAt,
			body: JSON.stringify({ mfaCode: "000000" })
		});
		log("MFA 确认 20204 业务码原样透传", confirmBad.status === 400 && confirmBad.json?.code === 20204, `${confirmBad.status} ${describe(confirmBad.json?.code)}`);

		const confirmOk = await request(authPort, "/api/auth/mfa/confirm", {
			method: "POST",
			headers: { ...jsonHeaders, origin: sameOrigin },
			cookie: rotatedAt,
			body: JSON.stringify({ mfaCode: "123456" })
		});
		log("MFA 确认 200 { ok:true }", confirmOk.status === 200 && confirmOk.json?.data?.ok === true, `${confirmOk.status} ${describe(confirmOk.json?.data)}`);

		// 6.6) 改密：空 body 先被 zod 挡住；桌面 Bearer 通道无 cookie 也能改
		const passwordEmpty = await request(authPort, "/api/auth/password", {
			method: "POST",
			headers: { ...jsonHeaders, origin: sameOrigin },
			cookie: rotatedAt
		});
		log("空 body 改密 → 400 bff_invalid_body 且未触达上游", passwordEmpty.status === 400 && passwordEmpty.json?.message === "bff_invalid_body" && upstream.authLog.password.length === 0, `${passwordEmpty.status} ${describe(passwordEmpty.json?.message)} upstreamHits=${upstream.authLog.password.length}`);

		const passwordBad = await request(authPort, "/api/auth/password", {
			method: "POST",
			headers: { ...jsonHeaders, origin: sameOrigin },
			cookie: rotatedAt,
			body: JSON.stringify({ oldPassword: "wrong", newPassword: "newp@ss123" })
		});
		log("旧口令错误 20201 原样透传", passwordBad.status === 400 && passwordBad.json?.code === 20201, `${passwordBad.status} ${describe(passwordBad.json?.code)}`);

		const passwordOk = await request(authPort, "/api/auth/password", {
			method: "POST",
			headers: { ...jsonHeaders, origin: sameOrigin },
			cookie: rotatedAt,
			body: JSON.stringify({ oldPassword: "p@ssw0rd", newPassword: "newp@ss123" })
		});
		log("改密 200 { ok:true } 且上游收到新口令", passwordOk.status === 200 && passwordOk.json?.data?.ok === true && upstream.authLog.password.at(-1)?.newPassword === "newp@ss123", `${passwordOk.status} ${describe(upstream.authLog.password.at(-1))}`);

		const passwordCsrf = await request(authPort, "/api/auth/password", {
			method: "POST",
			headers: jsonHeaders,
			cookie: rotatedAt,
			body: JSON.stringify({ oldPassword: "p@ssw0rd", newPassword: "newp@ss123" })
		});
		log("无 Origin 的 cookie 改密 → 403 bff_csrf_rejected", passwordCsrf.status === 403 && passwordCsrf.json?.message === "bff_csrf_rejected", `${passwordCsrf.status} ${describe(passwordCsrf.json?.message)}`);

		const desktopPassword = await request(authPort, "/api/auth/password", {
			method: "POST",
			headers: {
				...jsonHeaders,
				origin: "tauri://localhost",
				"x-nmcps-client": "desktop",
				authorization: `Bearer ${desktopRefresh.json?.data?.tokens?.accessToken}`
			},
			body: JSON.stringify({ oldPassword: "p@ssw0rd", newPassword: "newp@ss123" })
		});
		log("桌面令牌（无 cookie）改密 200", desktopPassword.status === 200 && desktopPassword.json?.data?.ok === true, `${desktopPassword.status} ${describe(desktopPassword.json?.data)}`);

		// 7) CSRF：cookie 模式非安全动词必须带合法的 Origin
		const noOrigin = await request(authPort, "/api/auth/logout", {
			method: "POST",
			cookie: cookieHeader(rotatedCookies, "nmcps_at")
		});
		log("无 Origin 的 cookie 登出 → 403 bff_csrf_rejected", noOrigin.status === 403 && noOrigin.json?.message === "bff_csrf_rejected", `${noOrigin.status} ${describe(noOrigin.json?.message)}`);

		const evilOrigin = await request(authPort, "/api/auth/logout", {
			method: "POST",
			headers: { origin: "https://evil.example" },
			cookie: cookieHeader(rotatedCookies, "nmcps_at")
		});
		log("非白名单 Origin 的登出 → 403 bff_csrf_rejected", evilOrigin.status === 403, `${evilOrigin.status} ${describe(evilOrigin.json?.message)}`);

		// 8) 登出：空 body + x-www-form-urlencoded 转发，且吞掉上游失败（不幂等）
		const logout = await request(authPort, "/api/auth/logout", {
			method: "POST",
			headers: { origin: sameOrigin },
			cookie: cookieHeader(rotatedCookies, "nmcps_at")
		});
		const upstreamLogout = upstream.authLog.logout.at(-1);
		log("登出 200 { ok:true } 并清 cookie", logout.status === 200 && logout.json?.data?.ok === true && setCookies(logout).some((raw) => raw.startsWith("nmcps_at=;")), `${logout.status} ${describe(logout.json?.data)}`);
		log("登出向上游发空 body + x-www-form-urlencoded", upstreamLogout?.contentType === "application/x-www-form-urlencoded" && upstreamLogout?.bodyLength === 0, describe(upstreamLogout));
		log("登出携带上游 Bearer", (upstreamLogout?.authorization ?? "").startsWith("Bearer at-"), describe(upstreamLogout?.authorization));

		const logoutAgain = await request(authPort, "/api/auth/logout", {
			method: "POST",
			headers: { origin: sameOrigin },
			cookie: cookieHeader(rotatedCookies, "nmcps_at")
		});
		log("上游已 401（不幂等）仍返回 200 { ok:true }", logoutAgain.status === 200 && logoutAgain.json?.data?.ok === true, `${logoutAgain.status} ${describe(logoutAgain.json?.data)}`);

		// 9) 业务码保真：上游 20205 + `msg` → BFF `code` 原样、`message` 补齐
		const mfaLogin = await request(authPort, "/api/auth/login", { method: "POST", headers: jsonHeaders, body: loginBody({ accountName: "mfa-user" }) });
		log("上游 20205 业务码原样透传（不被压成 400）", mfaLogin.status === 400 && mfaLogin.json?.code === 20205, `${mfaLogin.status} ${describe(mfaLogin.json?.code)}`);
		log("上游 msg 归一为 message 且不写 cookie", mfaLogin.json?.message === "mfa_required" && !setCookies(mfaLogin).some((raw) => raw.startsWith("nmcps_at=")), describe(mfaLogin.json?.message));
	});
} finally {
	await closeUpstream(upstream);
}

const passed = results.filter((item) => item.ok).length;
console.log(`\n${passed}/${results.length} 项通过`);
process.exit(passed === results.length ? 0 : 1);
