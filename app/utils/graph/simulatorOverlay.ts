// app/utils/graph/simulatorOverlay.ts
// 仿真运行态叠加（**纯函数**）：把 8001 `runtime-inventory` 的节点对齐到 8888 拓扑图节点上。
//
// 设计基准：NMCPS-DESIGN-001 §6.2（「节点按设备标识与 8888 节点对齐后叠加『仿真中』标记」）、
// §八（仿真不可达时只降级标记区块，不影响整页）。
//
// 对齐键（按可信度排序）：管理 IP → 名称。实测 8888 节点的 `id` 就是管理 IP，而 8001 节点把
// IP 放在 `ip_address`；名称两侧都是人可读的设备名，作为 IP 缺失时的次选。
import type { SimulatorRuntimeInventory, SimulatorRuntimeNode } from "~~/shared/types/simulator";
import type { TopologyGraphLink, TopologyGraphNode } from "~~/shared/types/topology";
import { topologyNodeIp, topologyNodeLabel } from "./topologyNormalize";

export interface SimulatorNodeMarker {
	/** 对端仿真节点 id（`runtime-inventory` 的 `nodes[].id`） */
	simId: string
	/** 仿真侧状态原样（`online` / `offline`…），不翻译成 8888 口径 */
	status: string
	/** 仿真侧名称（用于详情栏对照「现网名 ≠ 仿真名」） */
	name: string
}

function keyOf(value: string | null | undefined): string {
	return (value ?? "").trim().toLowerCase();
}

/**
 * 建立对齐索引：IP 与名称都指向同一个仿真节点。
 *
 * 同一键重复时**保留首个**：`runtime-inventory` 是运行态全量快照，重复键意味着上游数据有重叠，
 * 后者覆盖前者只会让标记随机闪动。
 */
export function buildSimulatorIndex(inventory: SimulatorRuntimeInventory | undefined | null): Map<string, SimulatorRuntimeNode> {
	const index = new Map<string, SimulatorRuntimeNode>();
	if (!inventory)
		return index;

	for (const node of inventory.nodes ?? []) {
		for (const raw of [node.ip_address, node.name, node.id]) {
			const key = keyOf(raw);
			if (key && !index.has(key))
				index.set(key, node);
		}
	}

	return index;
}

/** 取图节点的仿真标记；未匹配到返回 `undefined`（现网节点，非仿真） */
export function simulatorMarkerOf(
	node: TopologyGraphNode,
	index: Map<string, SimulatorRuntimeNode>
): SimulatorNodeMarker | undefined {
	if (index.size === 0)
		return undefined;

	const candidates = [keyOf(topologyNodeIp(node)), keyOf(topologyNodeLabel(node)), keyOf(node.id)];
	for (const key of candidates) {
		const hit = key ? index.get(key) : undefined;
		if (hit)
			return { simId: hit.id, status: hit.status, name: hit.name };
	}

	return undefined;
}

/** 运行态徽标文案口径：`running` 为假时即使有节点也不算「仿真中」 */
export function isSimulatorRunning(inventory: SimulatorRuntimeInventory | undefined | null): boolean {
	return inventory?.running === true;
}

/** 链路的仿真侧读数（链路动作按钮据此判断「这条线在仿真里有没有 id」） */
export interface SimulatorLinkMarker {
	/** 对端仿真链路 id（`runtime-inventory` 的 `links[].id`） */
	simId: string
	/** 仿真侧链路状态原样（`up` / `down`） */
	status: string
	/** 仿真侧链路类型原样（`wired` / `wireless`） */
	linkType: string
}

/** 无向端点键：链路在仿真台账里是 `source → target`，拓扑图里的两端顺序不保证一致 */
function pairKey(a: string, b: string): string {
	return a <= b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * 建立链路对齐索引：键是「两端仿真节点 id 的无向对」。
 *
 * 为什么不按拓扑节点 id 直接建：`runtime-inventory` 的链路两端是**仿真节点 id**（`n1` / `n2`），
 * 而拓扑图的链路两端是管理 IP —— 两边要经过节点索引（`buildSimulatorIndex()`）转一次，
 * 链路索引才与节点索引同源。任一端解析不出来就不建键（宁可按钮置灰，也不猜一条链路的身份）。
 */
export function buildSimulatorLinkIndex(
	inventory: SimulatorRuntimeInventory | undefined | null,
	nodeIndex: Map<string, SimulatorRuntimeNode> = buildSimulatorIndex(inventory)
): Map<string, SimulatorLinkMarker> {
	const index = new Map<string, SimulatorLinkMarker>();
	if (!inventory || nodeIndex.size === 0)
		return index;

	for (const link of inventory.links ?? []) {
		const source = nodeIndex.get(keyOf(link.source));
		const target = nodeIndex.get(keyOf(link.target));
		const [from, to] = [keyOf(source?.id), keyOf(target?.id)];
		if (!from || !to || from === to)
			continue;

		const key = pairKey(from, to);
		// 重复端点对保留首个：运行态是快照，平行链路在仿真侧本来就少见，覆盖只会让按钮随机指向另一条
		if (!index.has(key)) {
			index.set(key, {
				simId: link.id,
				status: link.status,
				linkType: link.type
			});
		}
	}

	return index;
}

/** 取图链路在仿真侧的读数；未对齐到返回 `undefined`（这条链路是现网的，仿真动不了） */
export function simulatorLinkOf(
	link: Pick<TopologyGraphLink, "source" | "target"> | undefined | null,
	nodeIndex: Map<string, SimulatorRuntimeNode>,
	linkIndex: Map<string, SimulatorLinkMarker>
): SimulatorLinkMarker | undefined {
	if (!link || linkIndex.size === 0)
		return undefined;

	const source = nodeIndex.get(keyOf(link.source));
	const target = nodeIndex.get(keyOf(link.target));
	const [from, to] = [keyOf(source?.id), keyOf(target?.id)];
	if (!from || !to || from === to)
		return undefined;

	return linkIndex.get(pairKey(from, to));
}
