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
 * 无线事实（AP）：`null` 表示上游没给（没有这组字段的节点不画无线卡）。
 * 口径同节点事实：缺省即未知，不补 0 —— `clients: 0` 是「一台都没连」，照写。
 */
export interface TopologyWifiFacts {
	ssid: string | null
	band: string | null
	channel: number | null
	dbm: number | null
	clients: number | null
	/** 信道利用率（%）：与链路利用率不同，这里 `0` 是可信的真值（节点口径不带「未计算」语义） */
	util: number | null
	txPower: number | null
}

/** 字符串原样（`ssid` / `band` 属数据，不翻译）；空串按未知 */
function readText(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** 数值原样（dBm 可以是负数，所以不复用 `readCount` 的「负数即未知」） */
function readNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * 无线事实读表（复刻 1.0 的 AP 卡口径；2026-11-07 复测 27/36 节点带这组字段）。
 *
 * 一个字段都没有时返回 `null`：页面据此**不画**无线区块 —— 画一排「—」等于告诉用户
 * 「这台 AP 的 SSID 取不到」，而实际上它根本不是 AP。
 */
export function wifiFactsOf(node: TopologyGraphNode | undefined | null): TopologyWifiFacts | null {
	if (!node)
		return null;

	const facts: TopologyWifiFacts = {
		ssid: readText(node.ssid),
		band: readText(node.band),
		channel: readNumber(node.channel),
		dbm: readNumber(node.dbm),
		clients: readNumber(node.clients),
		util: readPercent(node.util),
		txPower: readNumber(node.tx_power)
	};

	return Object.values(facts).some((value) => value !== null) ? facts : null;
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
