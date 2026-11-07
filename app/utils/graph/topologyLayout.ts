// app/utils/graph/topologyLayout.ts
// 拓扑布局**纯函数**（零 I/O、零状态、零 rAF）：输入节点 / 链路数组，输出坐标。
//
// 设计基准：`NMCPS-DESIGN-001` §七（`TopologyCanvas` 的布局以纯函数注入）、§6.8（布局词表与径向旋转）、
// `NMCPS-ADR-0019` D1（图形自绘）与「布局算法可搬」的边界。三种布局（`layered` / `radial` / `tree`）
// 都先吃同一份裁剪结果，再各自算坐标 —— 切换布局只改坐标，不改「裁掉了哪些」。
//
// 未复刻项：1.0 的 `force` / `grid` / `circular` 都借 G6 内置布局引擎实现，2.0 没有布局引擎
// （图形自绘），复刻需自写力导向；因此下拉里不出现这三个假选项（§6.8 表格）。
import type { TopologyGraphLink, TopologyGraphNode } from "~~/shared/types/topology";
import { normalizeTier, topologyNodeLabel } from "./topologyNormalize";
import { computeRadialPositions, RADIAL_ROTATE_DEG } from "./topologyRadialLayout";
import { computeTierTreePositions } from "./topologyTierTreeLayout";

/** 节点上限（NMCPS-DESIGN-001 §七：超出按权重裁剪并显示「已裁剪 N 个」） */
export const TOPOLOGY_MAX_NODES = 400;
/** 链路上限（同上） */
export const TOPOLOGY_MAX_LINKS = 1_200;

/** 画布逻辑尺寸（SVG `viewBox`，与容器像素无关：容器只决定缩放） */
export const TOPOLOGY_CANVAS_WIDTH = 1_000;
/** 布局高度基准（`radial` / `tree` 用它当视口高；`layered` 由分带数算出） */
export const TOPOLOGY_CANVAS_HEIGHT = 660;
/** 单个分带高度 */
const BAND_HEIGHT = 150;
/** 左右留白 */
const PADDING_X = 80;
/** 上下留白 */
const PADDING_Y = 70;

/**
 * 2D 布局词表（§6.8）：
 * - `layered` 分层网格（默认）：`tier` 分带、带内按 id 等距 —— 与 1.0 的 `dagre` 塔型同读向（自上而下）；
 * - `radial` 径向扇：1.0 几何库逐行搬入，圆心 = 最小 tier，逐档张角 + 分组留白 + 重心排序；
 * - `tree` 层级树：每层一条水平线、整层以画布中心居中（1.0 几何库逐行搬入）。
 */
export const TOPOLOGY_LAYOUT_MODES = ["layered", "radial", "tree"] as const;
export type TopologyLayoutMode = (typeof TOPOLOGY_LAYOUT_MODES)[number];

/** 旋转角范围 / 步进（`radial` 专用，与 1.0 同值） */
export const TOPOLOGY_ROTATE_MIN = -90;
export const TOPOLOGY_ROTATE_MAX = 90;
export const TOPOLOGY_ROTATE_STEP = 5;
/** 默认旋转角的唯一源在几何库里（1.0 `RADIAL_ROTATE_DEG`），这里只再导出给页面 */
export { RADIAL_ROTATE_DEG };

export interface TopologyLayoutOptions {
	/** 布局形态（缺省 `layered`） */
	mode?: TopologyLayoutMode
	/** 径向扇整体旋转（度，视觉逆时针为正；仅 `radial` 读取） */
	rotateDeg?: number
}

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

interface KeptNode {
	node: TopologyGraphNode
	tier: number
}

/** 裁剪：按「tier + id」取前 `TOPOLOGY_MAX_NODES` 个，再只保留两端都留下的链路 */
function crop(nodes: readonly TopologyGraphNode[], links: readonly TopologyGraphLink[]) {
	const ordered: KeptNode[] = nodes
		.map((node) => ({ node, tier: normalizeTier(node.tier) }))
		.sort((a, b) => a.tier - b.tier || a.node.id.localeCompare(b.node.id));

	const kept = ordered.slice(0, TOPOLOGY_MAX_NODES);
	const keptIds = new Set(kept.map((item) => item.node.id));
	const drawable = links.filter((link) => keptIds.has(link.source) && keptIds.has(link.target));
	const drawn = drawable.slice(0, TOPOLOGY_MAX_LINKS);

	return {
		kept,
		drawn,
		croppedNodes: ordered.length - kept.length,
		croppedLinks: links.length - drawn.length
	};
}

/** 把「id → 坐标」贴回节点视图模型（三种布局共用；`offset` 用于在小图里把内容摆到画布中央） */
function positioned(
	kept: readonly KeptNode[],
	points: Map<string, { x: number, y: number }>,
	offset: { dx: number, dy: number } = { dx: 0, dy: 0 }
): PositionedTopologyNode[] {
	return kept.map((item) => {
		const point = points.get(item.node.id) ?? { x: 0, y: 0 };
		return {
			node: item.node,
			id: item.node.id,
			label: topologyNodeLabel(item.node),
			tier: item.tier,
			x: point.x + offset.dx,
			y: point.y + offset.dy
		};
	});
}

/**
 * 分层网格布局（默认）。
 *
 * - 分带：`tier` 升序，缺省按 3；
 * - 带内：按 `id` 稳定排序后等距铺开（节点多时自动变密，不换行 —— 换行会让层级语义失真）。
 */
function layoutLayered(kept: readonly KeptNode[]): Pick<TopologyLayout, "nodes" | "width" | "height"> {
	const bandCount = Math.max(1, ...kept.map((item) => item.tier));
	const bands = new Map<number, KeptNode[]>();
	for (const item of kept) {
		const band = bands.get(item.tier) ?? [];
		band.push(item);
		bands.set(item.tier, band);
	}

	const nodes: PositionedTopologyNode[] = [];
	for (const [tier, band] of [...bands.entries()].sort((a, b) => a[0] - b[0])) {
		const span = TOPOLOGY_CANVAS_WIDTH - PADDING_X * 2;
		const step = band.length > 1 ? span / (band.length - 1) : 0;
		band.forEach((item, index) => {
			nodes.push({
				node: item.node,
				id: item.node.id,
				label: topologyNodeLabel(item.node),
				tier,
				x: band.length > 1 ? PADDING_X + step * index : TOPOLOGY_CANVAS_WIDTH / 2,
				y: PADDING_Y + BAND_HEIGHT * (tier - 1)
			});
		});
	}

	return {
		nodes,
		width: TOPOLOGY_CANVAS_WIDTH,
		height: PADDING_Y * 2 + BAND_HEIGHT * (bandCount - 1)
	};
}

/**
 * 布局入口：按 `options.mode` 分派（缺省 `layered`）。
 *
 * 三条布局共用同一份裁剪结果，因此「切换布局」只改变坐标，不会改变被裁掉的节点 / 链路集合 ——
 * 页面上的「已裁剪 N 个」角标在任意布局下都是同一个数。
 */
export function layoutTopology(
	nodes: readonly TopologyGraphNode[],
	links: readonly TopologyGraphLink[],
	options: TopologyLayoutOptions = {}
): TopologyLayout {
	const { kept, drawn, croppedNodes, croppedLinks } = crop(nodes, links);
	const mode = options.mode ?? "layered";
	const viewport = { width: TOPOLOGY_CANVAS_WIDTH, height: TOPOLOGY_CANVAS_HEIGHT };

	if (mode === "radial") {
		const result = computeRadialPositions(
			kept.map((item) => ({ id: item.node.id, tier: item.tier })),
			drawn.map((link) => ({ source: link.source, target: link.target })),
			{ rotateDeg: options.rotateDeg ?? RADIAL_ROTATE_DEG, viewport }
		);
		return {
			...layoutBox(result.bbox),
			nodes: positioned(kept, result.positions, centerOffset(result.bbox)),
			links: [...drawn],
			croppedNodes,
			croppedLinks
		};
	}

	if (mode === "tree") {
		const result = computeTierTreePositions(
			kept.map((item) => ({ id: item.node.id, tier: item.tier })),
			drawn.map((link) => ({ source: link.source, target: link.target })),
			{ viewport }
		);
		// 层级树自己就以视口中心为基准（每层均值 = centerX），**不能**再加居中偏移，
		// 否则每层会被推离画布中心（A24 断言的正是「每层均值 = 500」）。
		// 只有「内容比视口还宽 / 还高」（viewBox 因此长大）时才把整体右移 / 下移，让中心重新落在画布中央。
		const box = layoutBox(result.bbox);
		return {
			...box,
			nodes: positioned(kept, result.positions, overflowShift(box, viewport)),
			links: [...drawn],
			croppedNodes,
			croppedLinks
		};
	}

	return {
		...layoutLayered(kept),
		links: [...drawn],
		croppedNodes,
		croppedLinks
	};
}

/**
 * 画布逻辑尺寸：几何库给的 `bbox` 已含内边距，但不能比基准视口更小 ——
 * 否则 `viewBox` 收窄会把整张图放大到贴边（同档节点看起来更挤）。
 */
function layoutBox(bbox: { width: number, height: number }): Pick<TopologyLayout, "width" | "height"> {
	return {
		width: Math.max(Math.round(bbox.width), TOPOLOGY_CANVAS_WIDTH),
		height: Math.max(Math.round(bbox.height), TOPOLOGY_CANVAS_HEIGHT)
	};
}

/** 内容比基准视口小时把它挪到正中（否则整张图会贴在左上角，右下留一片空白） */
function centerOffset(bbox: { width: number, height: number }): { dx: number, dy: number } {
	return {
		dx: Math.max(0, Math.round((TOPOLOGY_CANVAS_WIDTH - bbox.width) / 2)),
		dy: Math.max(0, Math.round((TOPOLOGY_CANVAS_HEIGHT - bbox.height) / 2))
	};
}

/** 内容比视口大时（`viewBox` 跟着长大）把整体右移 / 下移一半，让「以视口中心摆放」的内容落回画布中央 */
function overflowShift(
	box: { width: number, height: number },
	viewport: { width: number, height: number }
): { dx: number, dy: number } {
	return {
		dx: Math.max(0, Math.round((box.width - viewport.width) / 2)),
		dy: Math.max(0, Math.round((box.height - viewport.height) / 2))
	};
}
