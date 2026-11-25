// app/utils/graph/labAdjacency.ts
// 拓扑邻接读表（**纯函数**，`NMCPS-ADR-0027` §7）：从实验链路台账推导某台设备在本图上的邻接。
//
// 为什么不是 LLDP：本仓不建 `/api/lldp/**`，也不引入 `lldpd`（ADR-0027 §7 裁决）。参考侧
// `:8001` 的 `neighbors[]` 本来就是拿台账链路合成的 LLDP 外壳，没有收到过 LLDP 帧；真采还要
// 每节点一个守护进程，而 OVS 只做二层转发、交换机身份无处可取。所以这里直接读台账：
// `neighbor_id` / 名称 / 两端接口 / 链路状态（`up` / `down` / `unknown`，M1.2 的实测读数）。
//
// 字段落差照实承认：`ttl` / `discovered_at` / `sys_name` / `chassis_id` 只在真实 LLDP TLV 里
// 存在，本口径**没有替代品**，不编、也不拿本机时间冒充 `discovered_at`。
import type { RuntimeInventoryLink, RuntimeInventoryNode } from "./runtimeInventory";

/** 邻接读表的一行（对端 + 两端接口 + 链路状态） */
export interface LabAdjacencyRow {
	/** 对端仿真节点 id（与 `RuntimeInventory` 的 `nodes[].id` 同源）：join 画布的唯一键 */
	simId: string
	/** 对端名称（统一投影的 `name`） */
	name: string
	/** 对端类型原样（`host` / `switch` / `router` / `nat` / `controller`） */
	type: string
	/** 本端接口（台账 `intfs` 的方向展开） */
	localInterface: string
	/** 对端接口 */
	remoteInterface: string
	/** `up` / `down` / `unknown` 原样 */
	linkStatus: "up" | "down" | "unknown"
	/** 对端在本图画布上的节点 id（= 管理 IP）；`null` = 不在图里（画布外设备，照实列出） */
	canvasId: string | null
}

function readText(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

/**
 * 某台仿真设备的邻接行。
 *
 * 只认台账里真实存在的链路（平行链路各算一行：去重会掩盖事实）。两端接口按链路方向展开 ——
 * `intfs.from` 属于 `link.from`，反方向连上来时必须换位，否则「本端 / 对端」会写反。
 */
export function labAdjacencyOf(
	nodeId: string,
	links: readonly RuntimeInventoryLink[] | null | undefined,
	nodes: readonly RuntimeInventoryNode[] | null | undefined,
	canvasIdBySimId: ReadonlyMap<string, string>
): LabAdjacencyRow[] {
	const self = readText(nodeId);
	if (!self)
		return [];

	const byId = new Map<string, RuntimeInventoryNode>();
	for (const node of nodes ?? [])
		byId.set(node.id, node);

	const rows: LabAdjacencyRow[] = [];
	for (const link of links ?? []) {
		const forward = link.source === self;
		const peerId = forward ? link.target : link.target === self ? link.source : "";
		if (!peerId)
			continue;

		const peer = byId.get(peerId);
		const intfs = link.intfs;
		rows.push({
			simId: peerId,
			name: peer?.name || peerId,
			type: peer?.type || "",
			localInterface: forward ? readText(intfs?.from) : readText(intfs?.to),
			remoteInterface: forward ? readText(intfs?.to) : readText(intfs?.from),
			linkStatus: link.status,
			canvasId: canvasIdBySimId.get(peerId) ?? null
		});
	}

	return rows.sort((a, b) => a.name.localeCompare(b.name) || a.simId.localeCompare(b.simId));
}
