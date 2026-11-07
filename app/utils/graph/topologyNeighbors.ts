// app/utils/graph/topologyNeighbors.ts
// 邻接发现（LLDP）的**读表纯函数**（NMCPS-DESIGN-001 §6.13 / §6.14）。
//
// 上游形状是 2026-11-07 对 8001 的实测原样（`shared/types/simulator.ts` 的 LLDP 两段），取值口径三条：
//   ① 一行 = 本端设备的一个邻接，两端接口分名（`local_interface` / `remote_interface`），不合成一个字符串；
//   ② 对端有**两套身份**：`neighbor_name` 是平台台账（`N2`）、`sys_name` 是 MIB 自报（`汇聚交换机-1`），
//      两个都照实展示，不互相顶替（顶替就是替上游做归一，等于编数据）；
//   ③ join 到画布只用 `neighbor_id`（与 `runtime-inventory` 的 `nodes[].id` 同源）—— `chassis_id` 实测恒为
//      `00:00:00:00:00:00`，拿它当键会把所有对端 join 成同一台。
import type { SimulatorLldpNeighbor, SimulatorRuntimeNode } from "~~/shared/types/simulator";

/** 读表后的一行邻接（页面只认这个形状，不再直接摸上游字段） */
export interface TopologyNeighborRow {
	/** 对端仿真节点 id（`neighbor_id`）：join 的唯一键 */
	simId: string
	/** 平台台账名（`N2`） */
	name: string
	/** MIB 自报系统名（`汇聚交换机-1`）：与 `name` 并存 */
	sysName: string
	/** 对端类型原样（`router` / `switch` / `ap` / `station`） */
	type: string
	/** 本端接口（`n1-eth0`） */
	localInterface: string
	/** 对端接口（`n2-eth0`） */
	remoteInterface: string
	/** `up` / `down` 原样 */
	linkStatus: string
	/** LLDP TTL（秒）；上游没给数值时为 `null`（不写 0） */
	ttl: number | null
	/** 上游本地时间字符串，**不带时区**：展示原样，不做时区换算 */
	discoveredAt: string
	/** 对端在本图画布上的节点 id（= 管理 IP）；`null` = 不在图里（画布外设备，照实列出但不跳转） */
	canvasId: string | null
}

function keyOf(value: string | null | undefined): string {
	return (value ?? "").trim();
}

/**
 * 建「仿真节点 id → 画布节点 id」对照表。
 *
 * 两套 id 不同源：LLDP 的 `neighbor_id` 是仿真侧 id（`n1`），画布节点 id 是管理 IP（`10.0.0.1`）。
 * 对照靠 `runtime-inventory` 的 `ip_address`（运行态快照里 IP 就放在这个字段），只认**画布上真有**的 IP，
 * 因此「对端不在本图」是可判定的（不是猜的）。
 */
export function canvasIdIndex(
	simulatedNodes: SimulatorRuntimeNode[] | undefined | null,
	canvasNodeIds: Set<string>
): Map<string, string> {
	const index = new Map<string, string>();
	for (const node of simulatedNodes ?? []) {
		const simId = keyOf(node.id);
		const ip = keyOf(node.ip_address);
		if (simId && ip && canvasNodeIds.has(ip) && !index.has(simId))
			index.set(simId, ip);
	}
	return index;
}

/**
 * 上游 `neighbors[]` → 读表行。**保持上游顺序**：LLDP 条目没有可信的排序字段
 * （`discovered_at` 是各端各自的本地时间），重排只是把上游的偶然顺序换成我们的猜测。
 */
export function neighborRowsOf(
	neighbors: SimulatorLldpNeighbor[] | undefined | null,
	simulatedNodes: SimulatorRuntimeNode[] | undefined | null,
	canvasNodeIds: Set<string>
): TopologyNeighborRow[] {
	const canvasOf = canvasIdIndex(simulatedNodes, canvasNodeIds);
	const rows: TopologyNeighborRow[] = [];

	for (const item of neighbors ?? []) {
		const simId = keyOf(item.neighbor_id);
		if (!simId)
			continue;

		rows.push({
			simId,
			name: keyOf(item.neighbor_name) || simId,
			sysName: keyOf(item.sys_name),
			type: keyOf(item.neighbor_type),
			localInterface: keyOf(item.local_interface),
			remoteInterface: keyOf(item.remote_interface),
			linkStatus: keyOf(item.link_status),
			ttl: typeof item.ttl === "number" && Number.isFinite(item.ttl) ? item.ttl : null,
			discoveredAt: keyOf(item.discovered_at),
			canvasId: canvasOf.get(simId) ?? null
		});
	}

	return rows;
}

/** 画布上的对端个数（与总条数分开报：「2 个邻居，其中 1 台在图上」） */
export function neighborCanvasCount(rows: TopologyNeighborRow[]): number {
	return rows.filter((row) => row.canvasId !== null).length;
}
