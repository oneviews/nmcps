// layers/scenario/shared/constants/mininetRoutes.ts
// Mininet 实验后端（第三上游）的**只读出站白名单**：逐端点 `{ method, template, upstream }`。
//
// 设计基准：NMCPS-ADR-0020（layers/content/collections/cn/records/adr/adr-0020.md）、
// NMCPS-ARCH-002 §6（layers/content/collections/cn/architecture/1.architecture/datasource-architecture.md）。
//
// 约束：
// - 只登记 `GET`；写端点（hosts / links / start / reset / sniffer/start / terminal…）不在本表，
//   因此永远不会被 `/api/lab/**` 触达。开放写操作须另立 ADR 并先补权限位与审计。
// - 模板匹配而非前缀放行：段数必须相等，`{param}` 只吃一个非空段。
// - 纯数据 + 纯函数（无 IO / 无 Nuxt 别名），server 侧与 TypeScript 脚本共用。
// - `upstream` 指向 Mininet 后端的真实路径，`{param}` 与 `template` 同名；出站时逐段编码。

/** 白名单动词：当前只有查询（写语义一律不登记） */
export const MININET_METHODS = ["GET"] as const;

export type MininetMethod = (typeof MININET_METHODS)[number];

export interface MininetRoute {
	/** 上游动词（当前恒为 GET） */
	method: MininetMethod
	/** BFF 路径模板（`/api/lab` 之后的段，例：`/hosts`） */
	template: string
	/** Mininet 后端路径模板（例：`/api/mininet/hosts`） */
	upstream: string
}

/**
 * 只读白名单本体。
 *
 * 刻意**不登记**：
 * - `export_json` / `export_script` / `sniffer/export`：响应是文本 / pcap 二进制，
 *   需要单独的下载通道与内容类型契约；
 * - 所有 POST / PUT / PATCH / DELETE：写操作未开放（NMCPS-ADR-0020 D2）；
 * - 四个 WebSocket：终端 / 日志 / 抓包 / 监控走 `/lab-ws/*`，需要 ticket 鉴权。
 */
export const MININET_ROUTES: readonly MininetRoute[] = [
	// ── 服务探针（不属于 /api/mininet 前缀） ──
	{ method: "GET", template: "/health", upstream: "/api/health" },
	{ method: "GET", template: "/version", upstream: "/api/version" },
	{ method: "GET", template: "/ryu/apps", upstream: "/api/ryu/apps" },

	// ── 拓扑台账（只读） ──
	{ method: "GET", template: "/hosts", upstream: "/api/mininet/hosts" },
	{ method: "GET", template: "/interfaces", upstream: "/api/mininet/interfaces" },
	{ method: "GET", template: "/switches", upstream: "/api/mininet/switches" },
	{ method: "GET", template: "/controllers", upstream: "/api/mininet/controllers" },
	{ method: "GET", template: "/nats", upstream: "/api/mininet/nats" },
	{ method: "GET", template: "/routers", upstream: "/api/mininet/routers" },
	{ method: "GET", template: "/links", upstream: "/api/mininet/links" },
	{ method: "GET", template: "/start", upstream: "/api/mininet/start" },

	// ── 运行态读数（只读） ──
	{ method: "GET", template: "/addressing_plan", upstream: "/api/mininet/addressing_plan" },
	{ method: "GET", template: "/stats/{node_id}", upstream: "/api/mininet/stats/{node_id}" },
	{ method: "GET", template: "/flows/{switch_id}", upstream: "/api/mininet/flows/{switch_id}" },
	{ method: "GET", template: "/links/stats/{src_id}/{dst_id}", upstream: "/api/mininet/links/stats/{src_id}/{dst_id}" },

	// ── 抓包状态（只读；启动 / 停止 / 导出均不在白名单） ──
	{ method: "GET", template: "/sniffer/state", upstream: "/api/mininet/sniffer/state" },
	{ method: "GET", template: "/sniffer/history", upstream: "/api/mininet/sniffer/history" }
] as const;

/** 拒绝码：与主网关 / 仿真通道共用一套词汇，前端只需处理一种拒绝形态 */
export type MininetRejectionMessage
	= | "bff_path_missing"
		| "bff_path_invalid"
		| "bff_resource_not_allowed"
		| "bff_method_not_allowed";

export interface MininetRejection {
	status: 400 | 404 | 405
	message: MininetRejectionMessage
}

export interface MininetMatch {
	route: MininetRoute
	/** 模板参数（`{node_id}` → 实际值），出站前逐段编码 */
	params: Record<string, string>
	/** 已解码的 BFF 路径段（日志 / 诊断用） */
	segments: string[]
}

export type MininetResolution = MininetMatch | { rejection: MininetRejection };

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

/** catch-all slug → 路径段：先解码再拆 `/`，保留 `.` / `..` 交给上层判 400 */
function normalizeSegments(slug: unknown): string[] {
	const raw = Array.isArray(slug) ? slug : typeof slug === "string" ? [slug] : [];

	return raw
		.flatMap((part) => safeDecode(String(part)).split("/"))
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
}

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
 * 把 `/api/lab/**` 的 catch-all 段解析为白名单条目。
 *
 * 判定顺序：空路径 400 → 穿越 400 → 模板未命中 404 → 动词不符 405。
 * 未登记端点不会因为“像是 Mininet 路径”而被放行。
 */
export function resolveMininetRoute(slug: unknown, method: string): MininetResolution {
	const segments = normalizeSegments(slug);

	if (!segments.length) {
		return { rejection: { status: 400, message: "bff_path_missing" } };
	}

	if (segments.some(isUnsafeSegment)) {
		return { rejection: { status: 400, message: "bff_path_invalid" } };
	}

	const candidates = MININET_ROUTES.filter((route) => matchTemplate(route.template, segments) !== undefined);

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

/**
 * 用模板参数拼出上游路径（逐段 `encodeURIComponent`）。
 *
 * 不由调用方传 path：白名单条目是唯一事实源，避免“匹配了 A 却请求 B”。
 */
export function buildMininetUpstreamPath(route: MininetRoute, params: Record<string, string>): string {
	return route.upstream.replace(/\{(\w+)\}/g, (_, name: string) => encodeURIComponent(params[name] ?? ""));
}
