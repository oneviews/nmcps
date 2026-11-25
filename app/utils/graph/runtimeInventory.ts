// app/utils/graph/runtimeInventory.ts
// 实验运行态读表（**纯函数**）：把 `GET /api/mininet/nodes` 的统一投影 + `GET /api/mininet/links`
// 收敛成页面消费的一份快照（`NMCPS-ADR-0027` §4 R8 的读路径切换）。
//
// 为什么要有这一层：页面此前直接吃 8001 `runtime-inventory` 的形状（`nodes[].ip_address`、
// `links[].source|target`、`running`）。切到 `services/mininet-api` 后字段名不同 —— 统一投影是
// `id/type/name/x/y` + `attributes`（IP 在 `attributes.ip`），链路是 `from/to` —— 而画布对齐
// （`simulatorOverlay.ts`）只关心「仿真节点 id + 管理 IP + 链路两端」。映射只写在这一处，
// 页面与对齐算法都不再认识上游字段名。
//
// 状态口径（`NMCPS-ADR-0026` D4 / `NMCPS-ADR-0027` §7.3）：节点级状态**不是**实测值 ——
// 引擎面没有逐节点状态端点，这里只如实复述网络运行态（`started` / `stopped`）；运行态读不到时
// 是 `unknown`，绝不补 `up`。链路的 `status` 是 M1.2 的实测读数（`up` / `down` / `unknown`），
// 上游没给就按 `unknown`，同样不猜。

/** `GET /api/mininet/nodes` 的一项（五类分表的统一投影） */
export interface LabUnifiedNode {
	id?: string
	type?: string
	name?: string
	attributes?: Record<string, unknown> | null
}

/** `GET /api/mininet/links` 的一项（M1.2 起带运行态 `status`） */
export interface LabLink {
	from?: string
	to?: string
	status?: string
	intfs?: { from?: string, to?: string } | null
}

/** `GET /api/mininet/channel` 里页面真正读到的字段（BFF 自产，不触达上游） */
export interface LabChannelInfo {
	configured: boolean
	writeEnabled: boolean
	capabilities: {
		read: boolean
		operate: boolean
	}
}

/** 节点运行态：只复述网络运行态，不是逐节点测量值 */
export type RuntimeNodeStatus = "started" | "stopped" | "unknown";

export interface RuntimeInventoryNode {
	id: string
	type: string
	name: string
	status: RuntimeNodeStatus
	/** 管理 IP（统一投影的 `attributes.ip`）；没有就是 `null`，不拿空串顶替 */
	ip_address: string | null
}

export interface RuntimeInventoryLink {
	/** 链路标识：两端 id 拼成，页面只用于展示与二次确认 */
	id: string
	source: string
	target: string
	/** `up` / `down` / `unknown`（M1.2 的实测读数；认不出的取值一律 `unknown`） */
	status: "up" | "down" | "unknown"
	type: string
	/** 两端接口名（台账 `intfs`，方向与 `source` / `target` 一致）；上游没给时为空串 */
	intfs: { from: string, to: string } | null
}

export interface RuntimeInventory {
	/** 网络运行态（`GET /api/mininet/start` 的裸布尔；读不到为 `null`，不假设「没启动」） */
	running: boolean | null
	nodes: RuntimeInventoryNode[]
	links: RuntimeInventoryLink[]
}

function readText(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

/** 运行态三态：布尔原样，其余视为未知（与 `labRunStateOf()` 同口径） */
function readStarted(started: unknown): boolean | null {
	return typeof started === "boolean" ? started : null;
}

function nodeStatusOf(started: boolean | null): RuntimeNodeStatus {
	if (started === true)
		return "started";
	return started === false ? "stopped" : "unknown";
}

/** 链路运行态收窄：只认 M1.2 的三个取值，其余一律 `unknown`（不猜成 up） */
function linkStatusOf(value: unknown): "up" | "down" | "unknown" {
	return value === "up" || value === "down" ? value : "unknown";
}

/**
 * 统一投影 + 链路台账 → 页面快照。
 *
 * 丢弃没有 `id` 的节点与端点不全的链路：它们无法与画布对齐，留着只会让计数对不上。
 * 顺序保持上游顺序（台账顺序即上游顺序，重排只是把偶然顺序换成我们的猜测）。
 */
export function runtimeInventoryOf(
	nodes: readonly LabUnifiedNode[] | null | undefined,
	links: readonly LabLink[] | null | undefined,
	started: unknown
): RuntimeInventory {
	const run = readStarted(started);
	const status = nodeStatusOf(run);
	const inventoryNodes: RuntimeInventoryNode[] = [];

	for (const node of nodes ?? []) {
		const id = readText(node?.id);
		if (!id)
			continue;
		const attributes = node.attributes ?? {};
		inventoryNodes.push({
			id,
			type: readText(node.type),
			name: readText(node.name) || id,
			status,
			ip_address: readText(attributes.ip) || readText(attributes.ip_address) || null
		});
	}

	const inventoryLinks: RuntimeInventoryLink[] = [];
	for (const link of links ?? []) {
		const source = readText(link?.from);
		const target = readText(link?.to);
		if (!source || !target || source === target)
			continue;
		inventoryLinks.push({
			id: `${source} → ${target}`,
			source,
			target,
			status: linkStatusOf(link.status),
			type: "wired",
			intfs: {
				from: readText(link.intfs?.from),
				to: readText(link.intfs?.to)
			}
		});
	}

	return { running: run, nodes: inventoryNodes, links: inventoryLinks };
}
