// layers/scenario/shared/constants/mininetRoutes.ts
// Mininet 实验后端（第三上游）的**逐端点出站白名单**：`{ method, template, upstream, permissions }`。
//
// 设计基准：NMCPS-ADR-0020（layers/content/collections/cn/records/adr/adr-0020.md）、
// NMCPS-ADR-0021（租户隔离与权限位）、NMCPS-ADR-0022（写端点分档与旧前端退役）。
//
// 约束：
// - 一条端点一个条目，**模板匹配**而非前缀放行：段数必须相等，`{param}` 只吃一个非空段。
// - 写端点的 `permissions` 是权限位列表：单权限位写一个，破坏性重建（`full_reset` / `import_json`）
//   写两个，缺任一即 403；`lab:read` 不在写条目里出现（读权限不是写兜底）。
// - 纯数据 + 纯函数（无 IO / 无 Nuxt 别名），server 侧与 node 脚本共用；权限字符串与
//   `shared/constants/labPermissions.ts` 的 `LAB_PERMISSIONS` 值一致，由 `check:lab-tenancy` 断言。
// - `upstream` 指向 Mininet 后端的真实路径，`{param}` 与 `template` 同名；出站时逐段编码。

/** 白名单动词：查询 + 全部写动词（写能力由 `permissions` 决定，不由动词决定） */
export const MININET_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

export type MininetMethod = (typeof MININET_METHODS)[number];

/** 与 `LAB_PERMISSIONS` 的值一一对应；本文件不 import 以保持纯数据（一致性由脚本断言） */
export type MininetPermission
	= | "lab:read"
		| "lab:create"
		| "lab:operate"
		| "lab:delete"
		| "lab:terminal"
		| "lab:sniffer";

export interface MininetRoute {
	/** 上游动词 */
	method: MininetMethod
	/** BFF 路径模板（`/api/mininet` 之后的段，例：`/hosts`） */
	template: string
	/** Mininet 后端路径模板（例：`/api/mininet/hosts`） */
	upstream: string
	/** 命中该端点所需的权限位（全部满足）；查询端点固定 `lab:read` */
	permissions: readonly MininetPermission[]
}

/** 是否为写端点（用于审计、串行化与 `channel.writeEnabled`） */
export function isWriteRoute(route: MininetRoute): boolean {
	return route.method !== "GET";
}

/**
 * 长时端点（`NMCPS-ADR-0026` D1）：这些请求在上游要跑几十秒（一次 `pingall` 在 9 节点网
 * 实测 42.6 秒、`start` / `stop` 要建 / 拆整个 Mininet 网络），15 秒的出站预算会把
 * 「还在跑」判成 `504 mininet_timeout`。名单以 `METHOD template` 形式登记，BFF 与浏览器侧
 * **共用这一份**：两处各写一份必然漂移。
 */
export const MININET_LONG_OPERATION_TEMPLATES: readonly string[] = [
	"POST /start",
	"POST /stop",
	"POST /reset",
	"POST /full_reset",
	"POST /import_json",
	"POST /pingall",
	"POST /iperf",
	"POST /sessions/{session_id}/start",
	"POST /sessions/{session_id}/stop"
];

/** 浏览器侧与 BFF 同口径的长时预算（毫秒）：`useApi` 的默认 20 秒在这里必须让位 */
export const LAB_LONG_OPERATION_TIMEOUT_MS = 180_000;

/** 该端点是否走长时预算（判据只有名单本身，不看动词以外的任何状态） */
export function isLongOperationRoute(route: Pick<MininetRoute, "method" | "template">): boolean {
	return MININET_LONG_OPERATION_TEMPLATES.includes(`${route.method} ${route.template}`);
}

/**
 * 白名单本体（21 条查询 + 36 条写端点，其中 12 条是 2.0 会话入口）。
 *
 * 刻意**不登记**：
 * - `export_json` / `export_script` / `sniffer/export`：响应是文本 / pcap 二进制，
 *   走独立下载通道 `/api/mininet/export/*`（NMCPS-ADR-0022 D7）；
 * - 四个 WebSocket：终端 / 日志 / 抓包 / 监控走 `/mininet-ws/*` + 短时票（NMCPS-ADR-0022 D6）。
 */
export const MININET_ROUTES: readonly MininetRoute[] = [
	// ── 服务探针（BFF 侧仍挂在 `/api/mininet` 下，上游映射到 `/api/*`） ──
	{ method: "GET", template: "/health", upstream: "/api/health", permissions: ["lab:read"] },
	{ method: "GET", template: "/version", upstream: "/api/version", permissions: ["lab:read"] },
	{ method: "GET", template: "/ryu/apps", upstream: "/api/ryu/apps", permissions: ["lab:read"] },

	// ── 拓扑台账（只读） ──
	{ method: "GET", template: "/hosts", upstream: "/api/mininet/hosts", permissions: ["lab:read"] },
	{ method: "GET", template: "/interfaces", upstream: "/api/mininet/interfaces", permissions: ["lab:read"] },
	{ method: "GET", template: "/switches", upstream: "/api/mininet/switches", permissions: ["lab:read"] },
	{ method: "GET", template: "/controllers", upstream: "/api/mininet/controllers", permissions: ["lab:read"] },
	{ method: "GET", template: "/nats", upstream: "/api/mininet/nats", permissions: ["lab:read"] },
	{ method: "GET", template: "/routers", upstream: "/api/mininet/routers", permissions: ["lab:read"] },
	{ method: "GET", template: "/links", upstream: "/api/mininet/links", permissions: ["lab:read"] },
	// 统一节点读（M1.1）：五类分表的投影，页面拓扑只打这一条。
	// 与会话侧的 `/sessions/{session_id}/nodes` 同形（`id/type/name/x/y` + `attributes`），
	// 但 1.x 这条不需要 session_id —— 它等价于「默认会话」。
	{ method: "GET", template: "/nodes", upstream: "/api/mininet/nodes", permissions: ["lab:read"] },
	{ method: "GET", template: "/start", upstream: "/api/mininet/start", permissions: ["lab:read"] },

	// ── 运行态读数（只读） ──
	{ method: "GET", template: "/addressing_plan", upstream: "/api/mininet/addressing_plan", permissions: ["lab:read"] },
	{ method: "GET", template: "/stats/{node_id}", upstream: "/api/mininet/stats/{node_id}", permissions: ["lab:read"] },
	{ method: "GET", template: "/flows/{switch_id}", upstream: "/api/mininet/flows/{switch_id}", permissions: ["lab:read"] },
	{ method: "GET", template: "/links/stats/{src_id}/{dst_id}", upstream: "/api/mininet/links/stats/{src_id}/{dst_id}", permissions: ["lab:read"] },

	// ── 抓包读数（只读；启停需 lab:sniffer） ──
	{ method: "GET", template: "/sniffer/state", upstream: "/api/mininet/sniffer/state", permissions: ["lab:read"] },
	{ method: "GET", template: "/sniffer/history", upstream: "/api/mininet/sniffer/history", permissions: ["lab:read"] },

	// ── 建网与加节点 / 加链路（lab:create） ──
	{ method: "POST", template: "/start", upstream: "/api/mininet/start", permissions: ["lab:create"] },
	{ method: "POST", template: "/hosts", upstream: "/api/mininet/hosts", permissions: ["lab:create"] },
	{ method: "POST", template: "/switches", upstream: "/api/mininet/switches", permissions: ["lab:create"] },
	{ method: "POST", template: "/routers", upstream: "/api/mininet/routers", permissions: ["lab:create"] },
	{ method: "POST", template: "/nats", upstream: "/api/mininet/nats", permissions: ["lab:create"] },
	{ method: "POST", template: "/controllers", upstream: "/api/mininet/controllers", permissions: ["lab:create"] },
	{ method: "POST", template: "/links", upstream: "/api/mininet/links", permissions: ["lab:create"] },

	// ── 改网络 / 跑测试 / 改流表（lab:operate） ──
	{ method: "POST", template: "/stop", upstream: "/api/mininet/stop", permissions: ["lab:operate"] },
	{ method: "POST", template: "/reset", upstream: "/api/mininet/reset", permissions: ["lab:operate"] },
	{ method: "POST", template: "/node_position", upstream: "/api/mininet/node_position", permissions: ["lab:operate"] },
	{ method: "POST", template: "/associate_switch", upstream: "/api/mininet/associate_switch", permissions: ["lab:operate"] },
	{ method: "POST", template: "/flows", upstream: "/api/mininet/flows", permissions: ["lab:operate"] },
	{ method: "POST", template: "/pingall", upstream: "/api/mininet/pingall", permissions: ["lab:operate"] },
	{ method: "POST", template: "/iperf", upstream: "/api/mininet/iperf", permissions: ["lab:operate"] },
	{ method: "PATCH", template: "/hosts/{host_id}", upstream: "/api/mininet/hosts/{host_id}", permissions: ["lab:operate"] },
	{ method: "PATCH", template: "/routers/{router_id}", upstream: "/api/mininet/routers/{router_id}", permissions: ["lab:operate"] },
	{ method: "PUT", template: "/links", upstream: "/api/mininet/links", permissions: ["lab:operate"] },
	{ method: "PUT", template: "/controllers/{controller_id}", upstream: "/api/mininet/controllers/{controller_id}", permissions: ["lab:operate"] },
	{ method: "PUT", template: "/switches/{switch_id}/openflow", upstream: "/api/mininet/switches/{switch_id}/openflow", permissions: ["lab:operate"] },
	{ method: "DELETE", template: "/delete_link/{src_id}/{dst_id}", upstream: "/api/mininet/delete_link/{src_id}/{dst_id}", permissions: ["lab:operate"] },
	{ method: "DELETE", template: "/remove_association/{src_id}/{dst_id}", upstream: "/api/mininet/remove_association/{src_id}/{dst_id}", permissions: ["lab:operate"] },
	{ method: "DELETE", template: "/flows", upstream: "/api/mininet/flows", permissions: ["lab:operate"] },
	{ method: "DELETE", template: "/flows/{switch_id}/{flow_id}", upstream: "/api/mininet/flows/{switch_id}/{flow_id}", permissions: ["lab:operate"] },

	// ── 删节点（lab:delete） ──
	{ method: "DELETE", template: "/delete_node/{node_id}", upstream: "/api/mininet/delete_node/{node_id}", permissions: ["lab:delete"] },

	// ── 破坏性重建（lab:delete + lab:create 双权限） ──
	{ method: "POST", template: "/full_reset", upstream: "/api/mininet/full_reset", permissions: ["lab:delete", "lab:create"] },
	{ method: "POST", template: "/import_json", upstream: "/api/mininet/import_json", permissions: ["lab:delete", "lab:create"] },

	// ── 抓包启停（lab:sniffer，独立授权） ──
	{ method: "POST", template: "/sniffer/start", upstream: "/api/mininet/sniffer/start", permissions: ["lab:sniffer"] },
	{ method: "POST", template: "/sniffer/stop", upstream: "/api/mininet/sniffer/stop", permissions: ["lab:sniffer"] },

	// ── 2.0 会话入口（`/api/simulation/**`，NMCPS-DESIGN-008 M1） ──
	// 与上面那批的差别只有两点：上游前缀不同（`upstream` 以 `/api/simulation` 开头，
	// `isSimulationRoute()` 据此分辨），以及路径里的 `{session_id}` 必须是台账
	// `session_id` 绑定的那一个（见 `[...slug].ts`），否则 404。
	{ method: "GET", template: "/sessions", upstream: "/api/simulation/sessions", permissions: ["lab:read"] },
	{ method: "POST", template: "/sessions", upstream: "/api/simulation/sessions", permissions: ["lab:create"] },
	{ method: "GET", template: "/sessions/{session_id}", upstream: "/api/simulation/sessions/{session_id}", permissions: ["lab:read"] },
	{ method: "DELETE", template: "/sessions/{session_id}", upstream: "/api/simulation/sessions/{session_id}", permissions: ["lab:delete"] },
	{ method: "POST", template: "/sessions/{session_id}/start", upstream: "/api/simulation/sessions/{session_id}/start", permissions: ["lab:create"] },
	{ method: "POST", template: "/sessions/{session_id}/stop", upstream: "/api/simulation/sessions/{session_id}/stop", permissions: ["lab:operate"] },
	{ method: "GET", template: "/sessions/{session_id}/nodes", upstream: "/api/simulation/sessions/{session_id}/nodes", permissions: ["lab:read"] },
	{ method: "POST", template: "/sessions/{session_id}/nodes", upstream: "/api/simulation/sessions/{session_id}/nodes", permissions: ["lab:create"] },
	{ method: "DELETE", template: "/sessions/{session_id}/nodes/{node_id}", upstream: "/api/simulation/sessions/{session_id}/nodes/{node_id}", permissions: ["lab:delete"] },
	{ method: "GET", template: "/sessions/{session_id}/links", upstream: "/api/simulation/sessions/{session_id}/links", permissions: ["lab:read"] },
	{ method: "POST", template: "/sessions/{session_id}/links", upstream: "/api/simulation/sessions/{session_id}/links", permissions: ["lab:create"] },
	{ method: "DELETE", template: "/sessions/{session_id}/links/{link_id}", upstream: "/api/simulation/sessions/{session_id}/links/{link_id}", permissions: ["lab:operate"] }
] as const;

/** 2.0 会话入口的上游前缀：白名单里靠它区分「1.x 全局 API」与「会话 API」 */
export const SIMULATION_UPSTREAM_PREFIX = "/api/simulation";

/**
 * 这条白名单条目是不是 2.0 会话入口。
 *
 * 用 `upstream` 前缀推导而不是另加一个 `sessionScoped` 字段：白名单每行只有
 * `{ method, template, upstream, permissions }` 四个键，脚本按这一行的形状解析源码
 * （`check-lab-bff.mjs` 的 `readMininetWhitelist()`），多一个键就会让解析静默返回空表。
 */
export function isSimulationRoute(route: Pick<MininetRoute, "upstream">): boolean {
	return route.upstream === SIMULATION_UPSTREAM_PREFIX || route.upstream.startsWith(`${SIMULATION_UPSTREAM_PREFIX}/`);
}

/**
 * 导出通道的上游表（NMCPS-ADR-0022 §五 / W5）：**非 JSON 信封**的响应不进 `MININET_ROUTES`。
 *
 * 为什么单开一张表：白名单里的每条都会经 `proxyToMininet()` 包成 `ApiResponse` JSON，
 * 而 `export_json` / `export_script` 回的是纯文本（导出脚本还要能被浏览器另存为 `.py`）、
 * `sniffer/export` 回的是 **pcap 二进制**。包一层字符串既破坏 `wget` 也丢
 * `Content-Disposition` —— 所以导出走 `GET /api/mininet/export/{json|script|pcap}` 的独立
 * handler，这里登记上游路径、扩展名、BFF 该回的 `content-type`、以及**出站前要判的权限位**。
 *
 * `permission` 逐种类不同：拓扑导出与 Python 脚本只要 `lab:read`（不改变上游状态），
 * 抓包文件里有全网流量原文，必须单独授权 `lab:sniffer`（NMCPS-ADR-0021 D3）——
 * 拿 `lab:read` 换 pcap 等于把抓包权限降解成读权限。
 */
export const LAB_EXPORT_UPSTREAMS = {
	json: {
		upstream: "/api/mininet/export_json",
		extension: "json",
		contentType: "text/plain; charset=utf-8",
		permission: "lab:read",
		binary: false
	},
	script: {
		upstream: "/api/mininet/export_script",
		extension: "py",
		contentType: "text/plain; charset=utf-8",
		permission: "lab:read",
		binary: false
	},
	pcap: {
		upstream: "/api/mininet/sniffer/export",
		extension: "pcap",
		contentType: "application/vnd.tcpdump.pcap",
		permission: "lab:sniffer",
		binary: true
	}
} as const;

export type LabExportKind = keyof typeof LAB_EXPORT_UPSTREAMS;

/** 路径段 → 导出种类（未登记的种类回 `undefined`，由 handler 回 400） */
export function parseLabExportKind(value: unknown): LabExportKind | undefined {
	return typeof value === "string" && Object.hasOwn(LAB_EXPORT_UPSTREAMS, value)
		? value as LabExportKind
		: undefined;
}

/**
 * 下载文件名由 BFF 生成，**不信任上游 `Content-Disposition`**（NMCPS-ADR-0022 §五）：
 * `lab-<network_id>-<yyyyMMddTHHmmssZ>.<ext>`。时间戳只保留到秒并去掉标点，便于再上传。
 */
export function labExportFilename(networkId: string, kind: LabExportKind, now: Date = new Date()): string {
	const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
	return `lab-${networkId}-${stamp}.${LAB_EXPORT_UPSTREAMS[kind].extension}`;
}

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
 * 把 `/api/mininet/**` 的 catch-all 段解析为白名单条目。
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
