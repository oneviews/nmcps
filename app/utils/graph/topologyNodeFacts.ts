// app/utils/graph/topologyNodeFacts.ts
// 拓扑节点**事实读表 + 邻居推导**（纯函数，零 I/O、零状态）。
//
// 设计基准：NMCPS-DESIGN-001 §6.5（节点详情）与 NMCPS-CONTRACT-002 §6.3（缺省即未知，不补 0）。
// 1.0 在 `useTopology.ts` 里把 `cpu / memory / traffic / interfaces / neighbors` 直接铺进节点
// `data`，并用 `-1` 表示「取不到」；详情栏照着 `-1` 显示 `N/A`。2.0 把这层收成两个纯函数：
//   · `nodeFactsOf()`      —— 线格式 → 可展示事实（未知 = `null`，不是 `0`）；
//   · `topologyNeighborsOf()` —— 从**当前画布**的链路推导邻居列表（1.0 的「邻居数」也是这么来的，
//     它和上游的 `neighbors` 字段是两件事：前者是画布上真实存在的边，后者是设备自报的邻居数）。
import type { TopologyGraphLink, TopologyGraphNode, TopologyLinkStatus, TopologyNodeStatus } from "~~/shared/types/topology";
import type { TopologyLayout } from "./topologyLayout";
import { normalizeLinkStatus, normalizeNodeStatus, topologyNodeLabel } from "./topologyNormalize";

/** 节点可展示的指标事实：`null` = 上游没给（展示为「—」，绝不写 0） */
export interface TopologyNodeFacts {
	/** CPU 使用率（%） */
	cpu: number | null
	/** 内存使用率（%） */
	memory: number | null
	/** 接口总数 */
	interfaces: number | null
	/** 总流量（Mbps） */
	traffic: number | null
	trafficIn: number | null
	trafficOut: number | null
	/** 运行时长（秒） */
	uptime: number | null
}

/** 画布上的一个邻居（一条链路对端） */
export interface TopologyNeighbor {
	/** 邻居节点 id（管理 IP） */
	id: string
	label: string
	/** 邻居节点自身的状态 */
	status: TopologyNodeStatus
	/** 连接两端的那条链路的状态 */
	linkStatus: TopologyLinkStatus
}

/** 百分比收窄：非有限数 / 负数（1.0 的 `-1` 哨兵）→ `null`；超出 0~100 的脏值同样视为未知 */
function readPercent(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100)
		return null;
	return value;
}

/** 计数收窄：非有限数 / 负数 → `null`；`0` 是真实值，保留 */
function readCount(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
		return null;
	return value;
}

/** Kbps → Mbps（1.0 兼容口径，保留一位小数以内的精度，不做展示取整） */
function kbpsToMbps(value: unknown): number | null {
	const kbps = readCount(value);
	return kbps === null ? null : kbps / 1_000;
}

/**
 * 节点事实读表。
 *
 * 流量口径按 1.0 实测顺序收敛：`traffic`（Mbps，后端口径）→ `traffic_in + traffic_out`
 * → `trafficTotalKbps / 1000`（首轮实测的旧字段）。三档都拿不到才是 `null`，
 * 不允许「入 + 出都没有、就当 0」。
 */
export function nodeFactsOf(node: TopologyGraphNode | undefined | null): TopologyNodeFacts {
	if (!node)
		return { cpu: null, memory: null, interfaces: null, traffic: null, trafficIn: null, trafficOut: null, uptime: null };

	const trafficIn = readCount(node.traffic_in) ?? kbpsToMbps(node.trafficInKbps);
	const trafficOut = readCount(node.traffic_out) ?? kbpsToMbps(node.trafficOutKbps);
	const bothDirections = trafficIn !== null && trafficOut !== null ? trafficIn + trafficOut : null;

	return {
		cpu: readPercent(node.cpu),
		memory: readPercent(node.memory),
		interfaces: readCount(node.interfaces),
		traffic: readCount(node.traffic) ?? bothDirections ?? kbpsToMbps(node.trafficTotalKbps),
		trafficIn,
		trafficOut,
		uptime: readCount(node.uptime)
	};
}

/**
 * 从画布链路推导某节点的邻居（含链路状态与对端节点状态）。
 *
 * 只认**两端都在画布上**的链路：端点被裁剪掉的链路画不出来，也就不该出现在邻居列表里
 * （否则「邻居 3 个」和图上数出来的 2 条边对不上）。同一对端多条链路时保留每一条
 * （平行链路是真实存在的事实，去重会掩盖它）。
 */
export function topologyNeighborsOf(
	layout: Pick<TopologyLayout, "nodes" | "links">,
	nodeId: string,
	links?: readonly TopologyGraphLink[]
): TopologyNeighbor[] {
	const source = links ?? layout.links;
	const byId = new Map(layout.nodes.map((item) => [item.id, item]));
	const result: TopologyNeighbor[] = [];

	for (const link of source) {
		const otherId = link.source === nodeId ? link.target : link.target === nodeId ? link.source : null;
		if (!otherId)
			continue;

		const other = byId.get(otherId);
		if (!other)
			continue;

		result.push({
			id: other.id,
			label: topologyNodeLabel(other.node),
			status: normalizeNodeStatus(other.node.status),
			linkStatus: normalizeLinkStatus(link.status)
		});
	}

	return result.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}
