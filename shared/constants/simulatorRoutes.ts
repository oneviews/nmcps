// shared/constants/simulatorRoutes.ts
// 仿真平台（第二上游）的**出站白名单**：逐端点 `{ method, template, write }`，不做前缀放行。
//
// 设计基准：NMCPS-ARCH-002 §6.3（layers/content/collections/cn/architecture/1.architecture/datasource-architecture.md）、
// 跨层裁决：NMCPS-ADR-0019 决策 D5（layers/content/collections/cn/records/adr/adr-0019.md）、
// 字段契约：NMCPS-CONTRACT-001 §六（layers/content/collections/cn/architecture/3.contract/shared-types.md）。
//
// 约束：纯数据 + 纯函数（无 IO / 无 Nuxt 别名），server 侧与 TypeScript 脚本共用。
// `scripts/check-bff.mjs` 是纯 node ESM，不 import 本文件，而是按源码文本抽取条目做
// 「白名单 ⊆ `scripts/fixtures/simulator-openapi.json`」断言（⑨-6）—— 条目写法一旦漂移，守卫立刻红。
//
// 动词以 2026-11-05 实测 `openapi.json` 为准：`/api/network/runtime/{nodes,links}` 是 **POST**（新建），
// 其 `{id}` 子路径是 **DELETE**；`tc` / `radio` / `ip` 是 **PATCH**。只读全量走
// `GET /api/network/runtime-inventory`（按动词猜 `GET /api/network/runtime/nodes` 会得 405）。

/** 允许转发的动词（与网关 `GATEWAY_METHODS` 同集合，便于前端只记一套） */
export const SIMULATOR_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

export type SimulatorMethod = (typeof SIMULATOR_METHODS)[number];

/** 归档维度：新增条目须同批更新对应 `NMCPS-DESIGN-*` 的数据源表（ARCH-002 §6.3 第 2 条） */
export type SimulatorLayer = "overview" | "topology" | "planning" | "transport" | "spectrum";

export interface SimulatorRoute {
	/** 上游动词（匹配时统一大写） */
	method: SimulatorMethod
	/** 上游路径模板：`{param}` 匹配一个非空路径段，逐段全等，绝不前缀放行 */
	template: string
	/** 写语义：`allowWrite` 关闭时直接 405，不触达上游（ARCH-002 §6.4） */
	write: boolean
	/** 归档维度（拓扑监控 / 场景筹划 / 传输管控 / 频谱管控 / 系统全景） */
	layer: SimulatorLayer
}

/**
 * 白名单本体。**只登记页面真正调用的条目**（ARCH-002 §6.3 第 2 条）：
 * 每条都要能在 `NMCPS-DESIGN-001/007` 的数据源表里找到出处，⑨-6 再断「⊆ openapi paths」。
 */
export const SIMULATOR_ROUTES: readonly SimulatorRoute[] = [
	// ── 只读（拓扑监控页，NMCPS-DESIGN-001 §6.2） ──
	// 运行态台账：一次取全量（实测 36 节点 / 48 链路），不逐节点拉取
	{ method: "GET", template: "/api/network/runtime-inventory", write: false, layer: "topology" },
	{ method: "GET", template: "/api/network/stats", write: false, layer: "topology" },
	{ method: "GET", template: "/api/lldp/summary", write: false, layer: "topology" },
	{ method: "GET", template: "/api/lldp/neighbors/{node_id}", write: false, layer: "topology" },
	{ method: "GET", template: "/api/network/runtime/preview", write: false, layer: "planning" },

	// ── 写（全部受 `allowWrite` 约束：关闭时 405，且不触达上游） ──
	// 链路动作：每个动作一个按钮，需二次确认 + 审计日志
	{ method: "POST", template: "/api/network/links/{link_id}/down", write: true, layer: "topology" },
	{ method: "POST", template: "/api/network/links/{link_id}/up", write: true, layer: "topology" },
	{ method: "POST", template: "/api/network/links/{link_id}/toggle", write: true, layer: "topology" },
	{ method: "POST", template: "/api/network/links/{link_id}/disable", write: true, layer: "topology" },
	{ method: "POST", template: "/api/network/links/{link_id}/power", write: true, layer: "topology" },
	{ method: "POST", template: "/api/network/links/{link_id}/reconfigure", write: true, layer: "transport" },
	{ method: "PATCH", template: "/api/network/links/{link_id}/tc", write: true, layer: "transport" },
	{ method: "PATCH", template: "/api/network/links/{link_id}/radio", write: true, layer: "spectrum" },
	// 节点动作：`radio` / `ip` 是 PATCH，其余是 POST
	{ method: "POST", template: "/api/network/nodes/{node_id}/start", write: true, layer: "topology" },
	{ method: "POST", template: "/api/network/nodes/{node_id}/stop", write: true, layer: "topology" },
	{ method: "POST", template: "/api/network/nodes/{node_id}/restart", write: true, layer: "topology" },
	{ method: "POST", template: "/api/network/nodes/{node_id}/power", write: true, layer: "topology" },
	{ method: "PATCH", template: "/api/network/nodes/{node_id}/radio", write: true, layer: "spectrum" },
	{ method: "PATCH", template: "/api/network/nodes/{node_id}/ip", write: true, layer: "planning" },
	// 运行态增删：直接改动正在跑的仿真，风险最高（额外二次确认由页面负责）
	{ method: "POST", template: "/api/network/runtime/nodes", write: true, layer: "planning" },
	{ method: "POST", template: "/api/network/runtime/links", write: true, layer: "planning" },
	{ method: "DELETE", template: "/api/network/runtime/nodes/{node_id}", write: true, layer: "planning" },
	{ method: "DELETE", template: "/api/network/runtime/links/{link_id}", write: true, layer: "planning" }
] as const;

/**
 * **永久排除**的上游前缀（ARCH-002 §6.3 第 3 条）：解锁任意一项须另立 ADR。
 *
 * 它们大多比白名单条目更危险（节点内任意命令执行、无头浏览器兼 SSRF、长驻守护任务…），
 * 因此即使将来有人误加入一条能匹配它们的宽模板，解析阶段也会先在此拦下。
 */
export const SIMULATOR_EXCLUDED_PREFIXES = [
	"/api/network/nodes/{node_id}/execute",
	"/api/browser",
	"/api/integrity/watch",
	"/api/devices/clear",
	"/api/test",
	"/api/snmp/onboard",
	"/api/nms/vmagent"
] as const;

/** 拒绝码：与网关共用一套词汇（`server/utils/bff/gateway.ts`），前端只需处理一种拒绝形态 */
export type SimulatorRejectionMessage
	= | "bff_path_missing"
		| "bff_path_invalid"
		| "bff_resource_not_allowed"
		| "bff_method_not_allowed";

export interface SimulatorRejection {
	status: 400 | 404 | 405
	message: SimulatorRejectionMessage
}

export interface SimulatorMatch {
	route: SimulatorRoute
	/** 模板参数（`{node_id}` → 实际值），供写调用日志使用 */
	params: Record<string, string>
	/** 已解码的实际路径段（出站时逐段编码后拼接） */
	segments: string[]
}

export type SimulatorResolution = SimulatorMatch | { rejection: SimulatorRejection };

function safeDecode(part: string): string {
	try {
		return decodeURIComponent(part);
	} catch {
		return part;
	}
}

function isUnsafeSegment(segment: string): boolean {
	return segment === "."
		|| segment === ".."
		|| segment.includes("/")
		|| segment.includes("\\")
		|| segment.includes("\0");
}

/**
 * catch-all slug → 路径段。与网关同口径：先解码再按 `/` 拆（拦住 `%2e%2e%2f` 这类编码穿越），
 * 保留 `.` / `..` 段交给上层判 400，而不是悄悄过滤掉（过滤会让穿越请求命中别的模板）。
 */
function normalizeSegments(slug: unknown): string[] {
	const raw = Array.isArray(slug) ? slug : typeof slug === "string" ? [slug] : [];

	return raw
		.flatMap((part) => safeDecode(String(part)).split("/"))
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
}

function matchesPrefix(prefix: string, segments: string[]): boolean {
	const wanted = prefix.split("/").filter(Boolean);
	if (wanted.length > segments.length) {
		return false;
	}

	return wanted.every((part, index) => /^\{\w+\}$/.test(part) || part === segments[index]);
}

/**
 * 模板匹配：段数必须相等，`{param}` 吃掉一个非空段，其余逐段全等。
 *
 * 不做前缀放行、不做通配 —— 这是本白名单的安全边界所在（ARCH-002 §6.3 第 1 条）。
 */
function matchTemplate(template: string, segments: string[]): Record<string, string> | undefined {
	const wanted = template.split("/").filter(Boolean);
	if (wanted.length !== segments.length) {
		return undefined;
	}

	const params: Record<string, string> = {};
	for (const [index, part] of wanted.entries()) {
		const param = /^\{(\w+)\}$/.exec(part);
		const name = param?.[1];
		if (name) {
			params[name] = segments[index] ?? "";
			continue;
		}
		if (part !== segments[index]) {
			return undefined;
		}
	}

	return params;
}

/**
 * 把 `/api/sim/**` 的 catch-all 段解析为白名单条目。
 *
 * 与 `resolveGatewayTarget()` 同风格：返回结果而不是抛错，让 handler 用统一 `ApiResponse` 信封回话。
 * 判定顺序：空路径 400 → 穿越 400 / 永久排除 404 → 模板未命中 404 → 动词不符 405。
 */
export function resolveSimulatorRoute(slug: unknown, method: string): SimulatorResolution {
	const segments = normalizeSegments(slug);

	if (!segments.length) {
		return { rejection: { status: 400, message: "bff_path_missing" } };
	}

	if (segments.some(isUnsafeSegment)) {
		return { rejection: { status: 400, message: "bff_path_invalid" } };
	}

	if (SIMULATOR_EXCLUDED_PREFIXES.some((prefix) => matchesPrefix(prefix, segments))) {
		return { rejection: { status: 404, message: "bff_resource_not_allowed" } };
	}

	const candidates = SIMULATOR_ROUTES.filter((route) => matchTemplate(route.template, segments) !== undefined);

	if (!candidates.length) {
		return { rejection: { status: 404, message: "bff_resource_not_allowed" } };
	}

	const upperMethod = method.toUpperCase();
	const hit = candidates.find((route) => route.method === upperMethod);

	if (!hit) {
		return { rejection: { status: 405, message: "bff_method_not_allowed" } };
	}

	return {
		route: hit,
		params: matchTemplate(hit.template, segments) ?? {},
		segments
	};
}
