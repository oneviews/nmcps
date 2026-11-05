// app/utils/graph/topologyLayout.ts
// 拓扑布局**纯函数**（零 I/O、零状态、零 rAF）：输入节点 / 链路数组，输出坐标。
//
// 设计基准：NMCPS-DESIGN-001 §七（`TopologyCanvas` 的布局以纯函数注入）、
// NMCPS-ADR-0019 D1（图形自绘）与「布局算法可搬」的边界。
// 1.0 的力导向 / 分层 / 径向 / 树四套算法留在 `_reference`，2.0 先落**分层网格**：
// 按 `tier` 分带（1 在顶、4 在底），带内按 id 稳定排序 —— 同一份数据每次都画在同一处，
// `check:ui` 的「SVG 内 circle/path 数量 > 0」才有意义。
import type { TopologyGraphLink, TopologyGraphNode } from "~~/shared/types/topology";
import { normalizeTier, topologyNodeLabel } from "./topologyNormalize";

/** 节点上限（NMCPS-DESIGN-001 §七：超出按权重裁剪并显示「已裁剪 N 个」） */
export const TOPOLOGY_MAX_NODES = 400;
/** 链路上限（同上） */
export const TOPOLOGY_MAX_LINKS = 1_200;

/** 画布逻辑尺寸（SVG `viewBox`，与容器像素无关：容器只决定缩放） */
export const TOPOLOGY_CANVAS_WIDTH = 1_000;
/** 单个分带高度 */
const BAND_HEIGHT = 150;
/** 左右留白 */
const PADDING_X = 80;
/** 上下留白 */
const PADDING_Y = 70;

export interface PositionedTopologyNode {
	node: TopologyGraphNode
	id: string
	label: string
	/** 归一后的层级（1 顶 → 4 底） */
	tier: number
	x: number
	y: number
}

export interface TopologyLayout {
	nodes: PositionedTopologyNode[]
	links: TopologyGraphLink[]
	width: number
	height: number
	/** 被裁剪掉的节点数（0 表示未触发上限） */
	croppedNodes: number
	/** 被裁剪掉的链路数（端点被裁或超出上限） */
	croppedLinks: number
}

/**
 * 分层网格布局。
 *
 * - 分带：`tier` 升序，缺省按 3；
 * - 带内：按 `id` 稳定排序后等距铺开（节点多时自动变密，不换行 —— 换行会让层级语义失真）；
 * - 裁剪：先按「tier + id」取前 `TOPOLOGY_MAX_NODES` 个节点，再只保留两端都留下的链路。
 */
export function layoutTopology(
	nodes: readonly TopologyGraphNode[],
	links: readonly TopologyGraphLink[]
): TopologyLayout {
	const ordered = nodes
		.map((node) => ({ node, tier: normalizeTier(node.tier) }))
		.sort((a, b) => a.tier - b.tier || a.node.id.localeCompare(b.node.id));

	const kept = ordered.slice(0, TOPOLOGY_MAX_NODES);
	const keptIds = new Set(kept.map((item) => item.node.id));
	const croppedNodes = ordered.length - kept.length;

	const bandCount = Math.max(1, ...kept.map((item) => item.tier));
	const bands = new Map<number, typeof kept>();
	for (const item of kept) {
		const band = bands.get(item.tier) ?? [];
		band.push(item);
		bands.set(item.tier, band);
	}

	const positioned: PositionedTopologyNode[] = [];
	for (const [tier, band] of [...bands.entries()].sort((a, b) => a[0] - b[0])) {
		const span = TOPOLOGY_CANVAS_WIDTH - PADDING_X * 2;
		const step = band.length > 1 ? span / (band.length - 1) : 0;
		band.forEach((item, index) => {
			positioned.push({
				node: item.node,
				id: item.node.id,
				label: topologyNodeLabel(item.node),
				tier,
				x: band.length > 1 ? PADDING_X + step * index : TOPOLOGY_CANVAS_WIDTH / 2,
				y: PADDING_Y + BAND_HEIGHT * (tier - 1)
			});
		});
	}

	const drawable = links.filter((link) => keptIds.has(link.source) && keptIds.has(link.target));
	const drawn = drawable.slice(0, TOPOLOGY_MAX_LINKS);

	return {
		nodes: positioned,
		links: drawn,
		width: TOPOLOGY_CANVAS_WIDTH,
		height: PADDING_Y * 2 + BAND_HEIGHT * (bandCount - 1),
		croppedNodes,
		croppedLinks: links.length - drawn.length
	};
}
