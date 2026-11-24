// layers/scenario/shared/constants/labWs.ts
// `/mininet-ws/*` 的通道登记表（NMCPS-ADR-0022 D6）。
//
// 约束（与 `MININET_ROUTES` 同一条纪律）：
// - 浏览器只能连**同源** `/mininet-ws/<kind>`，上游地址永远不下发；
// - 通道表里的 `upstream` 是**上游**路径（拼在实例 `baseUrl` 之后），与浏览器面 `/mininet-ws/<kind>`
//   同形但不同主机（NMCPS-ADR-0022 D11）：改浏览器面只改 `LAB_WS_PATHS`，不要动 `upstream`；
// - 每种通道一个权限位，terminal / sniffer 不能由 `lab:read` 推导（NMCPS-ADR-0021 D3）；
// - 未登记的种类一律 400 `lab_ws_kind_invalid`：票不能签给「还没实现的服务」。
//
// 当前已落地四条：`sniffer`（抓包实时流）、`terminal`（Webshell）、`logs`（上游日志）、
// `monitor`（单接口速率）。四条共用同一张表：新增通道只需登记条目 + 一个
// `server/routes/mininet-ws/<kind>.ts`（一行 `createLabWsRelay(kind)`），票的签名 / 一次性 /
// 绑定逻辑不变。
//
// `target` 的语义按通道分档（`targetKind`）：
// - `network`：可空，非空时必须是本租户当前网络 id（抓包面整网）；
// - `node`：必填，节点 id（Webshell）；
// - `node-intf`：必填，`<node>:<intf>`（监控一条接口）；
// - `none`：必须为空（日志面向整台上游，没有单目标）。

// 相对路径而不是 `~~`：`shared/` 也进 `.nuxt/tsconfig.node.json`（`scripts/**/*` 会顺着
// import 把它们拉进来），那份 project 没有 `~~` 别名，用别名会让 `pnpm typecheck` 报 TS2307。
import type { LabPermission } from "../../../../shared/constants/labPermissions";

/** 票的有效期（秒）：客户端不得续期（NMCPS-ADR-0022 D6） */
export const LAB_WS_TICKET_TTL_SECONDS = 60;

export type LabWsTargetKind = "network" | "node" | "node-intf" | "none";

export interface LabWsUpstream {
	/** 上游 WebSocket 路径（拼在实例 baseUrl 之后；`{node}` 由 `labWsUpstreamPath()` 替换） */
	upstream: string
	/** 建票所需的权限位（升级时不再二次判权限：票只由 BFF 签出） */
	permission: LabPermission
	/** 票的 `target` 是否必填 */
	targetRequired: boolean
	/** 票面 `target` 的语义（决定签票时怎么校验、升级时怎么拼上游地址） */
	targetKind: LabWsTargetKind
	/** 浏览器 → 上游是否需要转发（终端要；抓包 / 日志 / 监控只下行） */
	clientToUpstream: boolean
}

/** 已实现的通道登记表（键＝`/mininet-ws/<kind>` 的 `<kind>`） */
export const LAB_WS_UPSTREAMS = {
	sniffer: {
		upstream: "/api/mininet/sniffer",
		permission: "lab:sniffer",
		targetRequired: false,
		targetKind: "network",
		clientToUpstream: false
	},
	terminal: {
		upstream: "/api/mininet/terminal",
		permission: "lab:terminal",
		targetRequired: true,
		targetKind: "node",
		clientToUpstream: true
	},
	logs: {
		upstream: "/api/mininet/logs",
		permission: "lab:read",
		targetRequired: false,
		targetKind: "none",
		clientToUpstream: false
	},
	monitor: {
		upstream: "/api/mininet/monitor",
		permission: "lab:read",
		targetRequired: true,
		targetKind: "node-intf",
		clientToUpstream: false
	}
} as const satisfies Record<string, LabWsUpstream>;

export type LabWsKind = keyof typeof LAB_WS_UPSTREAMS;

export const LAB_WS_KINDS = Object.keys(LAB_WS_UPSTREAMS) as LabWsKind[];

/** 同源浏览地址：票放查询串，`target` 不进 URL（它已绑定在票里） */
export const LAB_WS_PATHS: Record<LabWsKind, string> = {
	sniffer: "/mininet-ws/sniffer",
	terminal: "/mininet-ws/terminal",
	logs: "/mininet-ws/logs",
	monitor: "/mininet-ws/monitor"
};

/** 票面 `target` 的解析结果：`node` 只有节点，`node-intf` 两段都有 */
export interface LabWsTargetParts {
	node: string
	intf: string
}

function unsafeTargetPart(value: string): boolean {
	return !value || value.includes("/") || value.includes("\\") || value.includes("|") || /\s/.test(value);
}

/**
 * 校验票面 `target` 的**形状**（存在性由调用方对台账再判）：
 * 返回 `undefined` 表示形状合法，否则给出拒绝档位。
 *
 * 节点 id / 接口名都不允许 `/`、`\`、`|` 或空白：`|` 是票的字段分隔符，
 * `/` 会改变上游路径段数，空白会污染查询串。
 */
export function labWsTargetError(kind: LabWsKind, target: string): "missing" | "invalid" | undefined {
	const entry = LAB_WS_UPSTREAMS[kind];

	if (!target)
		return entry.targetRequired ? "missing" : undefined;

	if (entry.targetKind === "none")
		return "invalid";

	if (entry.targetKind === "node")
		return unsafeTargetPart(target) || target.includes(":") ? "invalid" : undefined;

	if (entry.targetKind === "node-intf") {
		const parts = target.split(":");
		if (parts.length !== 2 || parts.some((part) => unsafeTargetPart(part)))
			return "invalid";
		return undefined;
	}

	// `network`：单个网络 id，形状与节点 id 同一套限制
	return unsafeTargetPart(target) ? "invalid" : undefined;
}

/** 形状已校验过的 `target` → `{ node, intf }`（`network` / `none` 两段都为空） */
export function labWsTargetParts(kind: LabWsKind, target: string): LabWsTargetParts {
	if (labWsTargetError(kind, target))
		return { node: "", intf: "" };

	if (LAB_WS_UPSTREAMS[kind].targetKind === "node")
		return { node: target, intf: "" };

	if (LAB_WS_UPSTREAMS[kind].targetKind === "node-intf") {
		const [node, intf] = target.split(":");
		return { node: node ?? "", intf: intf ?? "" };
	}

	return { node: "", intf: "" };
}

/**
 * 上游 WebSocket 路径（拼在实例 baseUrl 之后）。
 *
 * 终端是路径段 `/api/mininet/terminal/<node>`，监控是查询串 `?node=…&intf=…`
 * —— 与 `mininet_gui_backend/api.py` 的四个 `@app.websocket` 路由一一对应。
 */
export function labWsUpstreamPath(kind: LabWsKind, target: string): string {
	const { upstream, targetKind } = LAB_WS_UPSTREAMS[kind];

	if (targetKind === "node") {
		const { node } = labWsTargetParts(kind, target);
		return `${upstream}/${encodeURIComponent(node)}`;
	}

	if (targetKind === "node-intf") {
		const { node, intf } = labWsTargetParts(kind, target);
		const query = new URLSearchParams({ node, intf });
		return `${upstream}?${query.toString()}`;
	}

	return upstream;
}

export function isLabWsKind(value: unknown): value is LabWsKind {
	return typeof value === "string" && Object.hasOwn(LAB_WS_UPSTREAMS, value);
}

/**
 * `POST /api/mininet/ws-ticket` 回给页面的 `url`（相对同源，不含上游地址）。
 *
 * 票面签了非空 `target` 时，URL 一并带上：升级钩子要求查询串里的 `target` 与票面一致，
 * 否则一张「给 net_a 的票」可以拿去连 net_b 的通道。
 */
export function labWsTicketUrl(kind: LabWsKind, ticket: string, target = ""): string {
	const query = new URLSearchParams({ ticket });
	if (target)
		query.set("target", target);
	return `${LAB_WS_PATHS[kind]}?${query.toString()}`;
}
