// app/utils/graph/topologyLayout.ts
// 拓扑布局**纯函数**（零 I/O、零状态、零 rAF）：输入节点 / 链路数组，输出坐标。
//
// 设计基准：`NMCPS-DESIGN-001` §七（`TopologyCanvas` 的布局以纯函数注入）、§6.8（布局词表与径向旋转）、
// `NMCPS-ADR-0019` D1（图形自绘）与「布局算法可搬」的边界。两种布局（`radial` / `tree`）都先吃
// 同一份裁剪结果、**同一份层序归约**（根节点选举 + 无下级节点下移），再各自算坐标 —— 切换布局
// 只改坐标：裁掉了哪些、谁在谁上面、角色是什么，两件事都不随布局变化。
//
// 布局词表只有两档（2026-11-09 用户裁决）：**径向扇（默认）** 与 **层级树**。原先的
// `layered`（塔型）与它的 `dagre` 参数一起下线 —— 下拉里三个选项、其中两个又只能在特定数据下
// 才看得懂，用户实测后只留下这两档。
//
// 未复刻项：1.0 的 `force` / `grid` / `circular` 都借 G6 内置布局引擎实现，2.0 没有布局引擎
// （图形自绘），复刻需自写力导向；因此下拉里不出现这三个假选项（§6.8 表格）。
import type { TopologyGraphLink, TopologyGraphNode } from "~~/shared/types/topology";
import type { LayeredRanking } from "./topologyLayeredLayout";
import type { TopologyNodeRole } from "./topologyRoleStyle";
import { planLabelRow } from "./topologyLabelLayout";
import { resolveLayeredRanks } from "./topologyLayeredLayout";
import { normalizeTier, topologyNodeLabel } from "./topologyNormalize";
import { computeRadialPositions, RADIAL_ROTATE_DEG, radialSweepForBands } from "./topologyRadialLayout";
import { roleOfNode, tierOfNode } from "./topologyRoleStyle";
import { computeTierTreePositions } from "./topologyTierTreeLayout";

/** 节点上限（NMCPS-DESIGN-001 §七：超出按权重裁剪并显示「已裁剪 N 个」） */
export const TOPOLOGY_MAX_NODES = 400;
/** 链路上限（同上） */
export const TOPOLOGY_MAX_LINKS = 1_200;

/** 画布逻辑尺寸（SVG `viewBox`，与容器像素无关：容器只决定缩放） */
export const TOPOLOGY_CANVAS_WIDTH = 1_000;
/** 布局高度基准（`radial` / `tree` 用它当视口高） */
export const TOPOLOGY_CANVAS_HEIGHT = 660;

/**
 * 2D 布局词表（§6.8，2026-11-09 收窄为两档）：
 * - `radial` 径向扇（默认）：1.0 几何库逐行搬入，圆心 = **层序最小者**（被选举的根），逐档张角 +
 *   分组留白 + 重心排序；环序读的是**同一份**层序归约结果；
 * - `tree` 层级树：每层一条水平线、父节点压在子女群的**中位**上方（1.0 几何库逐行搬入）。
 *
 * 两种布局的「第几环 / 第几行」都是 `resolveLayeredRanks()` 的输出（根节点选举 + 无下级节点下移，
 * 见 `layoutTopology()`）—— 切换布局只改坐标，不改层级。
 *
 * 为什么是两档：原先的 `layered`（塔型）与 `tree` 在四层图里读出来几乎一样（都是「每层一条线」），
 * 但多一档就多一份几何、多一份标签避让、多一份回归；用户实测后只留下「一眼看出层级」的层级树与
 * 「一眼看出扇区归属」的径向扇。
 */
export const TOPOLOGY_LAYOUT_MODES = ["radial", "tree"] as const;
export type TopologyLayoutMode = (typeof TOPOLOGY_LAYOUT_MODES)[number];

/**
 * 布局下拉的图标（2026-11-09 用户指定，`carbon` 集合里两枚语义对得上的图）：
 * - `radial` → `carbon:chart-relationship`（关系图，一眼看出「谁围着谁」的扇区归属）；
 * - `tree` → `carbon:category`（分类阶层，一眼看出「上下级」）。
 * 图标与词表同源放在这里，页面不自己列一份（下拉项与当前档按钮共读这一张表）。
 */
export const TOPOLOGY_LAYOUT_ICONS: Record<TopologyLayoutMode, string> = {
	radial: "carbon:chart-relationship",
	tree: "carbon:category"
};

/** 旋转角范围 / 步进（`radial` 专用，与 1.0 同值） */
export const TOPOLOGY_ROTATE_MIN = -90;
export const TOPOLOGY_ROTATE_MAX = 90;
export const TOPOLOGY_ROTATE_STEP = 5;
/** 默认旋转角的唯一源在几何库里（1.0 `RADIAL_ROTATE_DEG`），这里只再导出给页面 */
export { RADIAL_ROTATE_DEG };

export interface TopologyLayoutOptions {
	/** 布局形态（缺省 `radial`：径向扇） */
	mode?: TopologyLayoutMode
	/** 径向扇整体旋转（度，视觉逆时针为正；仅 `radial` 读取） */
	rotateDeg?: number
}

export interface PositionedTopologyNode {
	node: TopologyGraphNode
	id: string
	label: string
	/**
	 * 标签基线档位（0 = 第一行，1 = 抬高一行；行内放不下时按奇偶错行避让）。
	 * 规划见 `topologyLabelLayout.ts`（§七）—— **只错行、不截断**，文本恒为 `label`。
	 */
	labelShift: 0 | 1
	/**
	 * 名称相对节点的**单位方向**（标签中心落在 `节点 + 方向 × (半径 + 间距)` 处）。
	 *
	 * 为什么不让画布一律写「正下方」：径向扇里同一档的节点沿弧排开，正下方那 10px
	 * 的名字会压在**下一个节点**上（实测 20 台样本 9 个标签压节点，读者分不清名字属于谁）。
	 * 方向由布局层给 —— 扇形 = **背离圆心**（同一档的标签因此沿各自半径朝外，互不遮挡），
	 * 层级树 = 正下方 `(0, 1)`（每层一条水平线，向下才是空白）。两档都保持「同一个间距」，
	 * 标签与节点的相对位置因此逐台一致（2026-11-09 用户裁决）。
	 */
	labelDirDx: number
	labelDirDy: number
	/** 归一后的层级（1 顶 → 4 底） */
	tier: number
	/**
	 * 所在层序（0 = 首层）。两种布局同源：由 `resolveLayeredRanks()` 的层序归约给出
	 * （含根节点选举 / 无下级节点下移），不随布局形态变化。
	 */
	rank: number
	/** 层级角色（按 tier 取；层序 0 且被选举为根时是 `root`；画布据此取层色与半径，§七） */
	role: TopologyNodeRole
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

/**
 * 两种布局共用的**层序归约**（`NMCPS-DESIGN-001` §6.8）：`tier` 分带 → **根节点选举**（上提）
 * → **无下级节点下移**（下沉）。
 *
 * 为什么放在这里而不是某一种布局内部：层序归约回答的是「谁在谁上面」，那是**图的语义**，
 * 不是某一种几何的私事。若只有塔型读了归约结果，切到径向扇 / 层级树就会出现同一份数据
 * 两套层级（根被摊回第一圈、无下级的接入又爬回中间圈）——「换个布局看」变成「换个事实看」。
 */
function resolveRanks(kept: readonly KeptNode[], drawn: readonly TopologyGraphLink[]): LayeredRanking {
	return resolveLayeredRanks(
		kept.map((item) => ({ id: item.node.id, tier: item.tier, name: topologyNodeLabel(item.node) })),
		drawn.map((link) => ({ source: link.source, target: link.target }))
	);
}

/**
 * 层序 → 径向扇 / 层级树几何库读的「带号」（1 起）。
 *
 * 两个几何库是 1.0 逐行搬入的，入参字段叫 `tier`，但内部只把它当「第几环 / 第几行」
 * （半径 `r = (t − apex)/span · R`、行号 `y = (t − minTier) · gap` 都只由它推出）。
 * 因此这里喂 `rank + 1`：**层序归约的结果就是两种布局共用的带号**，而不必改几何库的内部口径。
 */
function bandNodesOf(kept: readonly KeptNode[], ranking: LayeredRanking): Array<{ id: string, tier: number }> {
	return kept.map((item) => ({ id: item.node.id, tier: (ranking.rankOf.get(item.node.id) ?? 0) + 1 }));
}

/**
 * 节点视图（层序 + 角色）：两种布局同源 —— 角色按 `tier` 取、叶子归位终端层，选举出的根覆盖成 `root`
 * 并单独占 **0 档**（`ROOT_TIER`，2026-11-09 用户裁决：根比边界层还高一档，不再和核心同为 1）。
 */
interface RankView {
	rank: number
	role: TopologyNodeRole
	tier: number
}

function rankViewsOf(kept: readonly KeptNode[], ranking: LayeredRanking): Map<string, RankView> {
	const demoted = new Set(ranking.demotedIds);
	return new Map(kept.map((item) => {
		const leaf = demoted.has(item.node.id);
		const isRoot = item.node.id === ranking.rootId;
		const role: TopologyNodeRole = isRoot
			? "root"
			: roleOfNode(item.tier, leaf);
		return [item.node.id, { rank: ranking.rankOf.get(item.node.id) ?? 0, role, tier: tierOfNode(item.tier, leaf, isRoot) }];
	}));
}

/**
 * 把「id → 坐标」贴回节点视图模型（两种布局共用；`offset` 用于在小图里把内容摆到画布中央）。
 *
 * 层序与角色一律由调用方给出（`viewOf`），这里不再自己按坐标猜：两种布局的层序来自
 * **同一份** `resolveLayeredRanks()` 结果（见 `resolveRanks()`）。
 */
function positioned(
	kept: readonly KeptNode[],
	points: Map<string, { x: number, y: number }>,
	offset: { dx: number, dy: number },
	viewOf: (id: string) => Partial<Pick<PositionedTopologyNode, "rank" | "role" | "tier" | "labelShift" | "labelDirDx" | "labelDirDy">>
): PositionedTopologyNode[] {
	return kept.map((item) => {
		const point = points.get(item.node.id) ?? { x: 0, y: 0 };
		const label = topologyNodeLabel(item.node);
		const override = viewOf(item.node.id);
		return {
			node: item.node,
			id: item.node.id,
			label,
			labelShift: override.labelShift ?? 0,
			// 缺省方向 = 正下方（层级树的口径）；径向扇在调用处覆盖
			labelDirDx: override.labelDirDx ?? 0,
			labelDirDy: override.labelDirDy ?? 1,
			tier: override.tier ?? item.tier,
			rank: override.rank ?? 0,
			role: override.role ?? roleOfNode(item.tier, false),
			x: point.x + offset.dx,
			y: point.y + offset.dy
		};
	});
}

/**
 * 标签避让规划（`radial` / `tree` 共用，见 `topologyLabelLayout.ts`）。
 *
 * 为什么按「层序」分行而不是按坐标聚类：同一环 / 同一行的左右相邻才是标签会撞上的那一对，
 * 而层序已经是「谁和谁同一行」的唯一真相（`resolveLayeredRanks()`）。行内次序按 x 升序取 ——
 * 奇偶错行只看左右相邻，坐标即次序。
 *
 * 间距取行内相邻 x 间隙的最小值（只有一个节点时无上限 ⇒ 标签一律单行）；
 * 满行时 `planLabelRow()` 先按奇偶错行、仍放不下再截断。
 */
function planLabelsByRank(
	kept: readonly KeptNode[],
	points: Map<string, { x: number, y: number }>,
	rankOfId: Map<string, number>
): Map<string, { shift: 0 | 1 }> {
	const rowsOfRank = new Map<number, string[]>();
	for (const item of kept) {
		const rank = rankOfId.get(item.node.id) ?? 0;
		const row = rowsOfRank.get(rank);
		if (row)
			row.push(item.node.id);
		else
			rowsOfRank.set(rank, [item.node.id]);
	}

	const labelOf = new Map(kept.map((item) => [item.node.id, topologyNodeLabel(item.node)]));
	const planOf = new Map<string, { shift: 0 | 1 }>();
	for (const ids of rowsOfRank.values()) {
		const ordered = [...ids].sort((a, b) =>
			(points.get(a)?.x ?? 0) - (points.get(b)?.x ?? 0) || a.localeCompare(b));
		const xs = ordered.map((id) => points.get(id)?.x ?? 0);
		const gaps = xs.slice(1).map((x, index) => Math.abs(x - (xs[index] as number)));
		const spacing = gaps.length > 0 ? Math.min(...gaps) : Number.POSITIVE_INFINITY;
		const plans = planLabelRow(ordered.map((id) => labelOf.get(id) ?? id), spacing);
		ordered.forEach((id, index) => {
			const plan = plans[index];
			if (plan)
				planOf.set(id, { shift: plan.shift });
		});
	}
	return planOf;
}

/**
 * 布局入口：按 `options.mode` 分派（缺省 `radial`，见 `TOPOLOGY_LAYOUT_MODES`）。
 *
 * 两条布局共用同一份裁剪结果 **与同一份层序归约**（`resolveRanks()`：根节点选举 + 无下级节点下移），
 * 因此「切换布局」只改变坐标：
 *   · 被裁掉的节点 / 链路集合不变（页面「已裁剪 N 个」角标在任意布局下都是同一个数）；
 *   · 层序不变（根始终在最内 / 最上一带、无下级的接入始终在最外 / 最下一带）；
 *   · 角色不变（恒按 `tier` 取、叶子归位终端层，见 `roleOfNode()`）。
 *
 * 径向扇 / 层级树是 1.0 逐行搬入的几何库，入参 `tier` 在它们内部只当「第几环 / 第几行」用，
 * 所以喂的是归约后的**带号**（`rank + 1`，见 `bandNodesOf()`），不改几何库内部口径。
 * 标签避让（`planLabelsByRank()`）也在分派之后按层序统一规划：两种布局的标签规则必须一致，
 * 否则「切布局」会顺带改掉截断结果。
 */
export function layoutTopology(
	nodes: readonly TopologyGraphNode[],
	links: readonly TopologyGraphLink[],
	options: TopologyLayoutOptions = {}
): TopologyLayout {
	const { kept, drawn, croppedNodes, croppedLinks } = crop(nodes, links);
	const mode = options.mode ?? "radial";
	const viewport = { width: TOPOLOGY_CANVAS_WIDTH, height: TOPOLOGY_CANVAS_HEIGHT };

	if (mode === "tree") {
		const ranking = resolveRanks(kept, drawn);
		const views = rankViewsOf(kept, ranking);
		const result = computeTierTreePositions(
			bandNodesOf(kept, ranking),
			drawn.map((link) => ({ source: link.source, target: link.target })),
			{ viewport }
		);
		const planOf = planLabelsByRank(kept, result.positions, ranking.rankOf);
		// 层级树自己就以视口中心为基准（**末层（终端带）**均值 = centerX；其余层跟各自的子女群走，
		// 见 `topologyTierTreeLayout.ts` 的第 4 条「父压子女中点」），**不能**再加居中偏移，
		// 否则末层会被推离画布中心（A24 / A43 断言的正是「末层居中 + 父压子女中点」）。
		// 只有「内容比视口还宽 / 还高」（viewBox 因此长大）时才把整体右移 / 下移，让中心重新落在画布中央。
		const box = layoutBox(result.bbox);
		return {
			...box,
			nodes: positioned(kept, result.positions, overflowShift(box, viewport), (id) => ({
				...views.get(id),
				labelShift: planOf.get(id)?.shift
			})),
			links: [...drawn],
			croppedNodes,
			croppedLinks
		};
	}

	const ranking = resolveRanks(kept, drawn);
	const views = rankViewsOf(kept, ranking);
	// 张角按**带数**生成（最外带 65° / 其余 75°）：层数不再等于 4 时按固定档号取张角会错位，
	// 5 带图的最外带会回落到基线 60°、比它里面那带还窄（见 `radialSweepForBands()`）。
	const result = computeRadialPositions(
		bandNodesOf(kept, ranking),
		drawn.map((link) => ({ source: link.source, target: link.target })),
		{
			rotateDeg: options.rotateDeg ?? RADIAL_ROTATE_DEG,
			viewport,
			sweepDegByTier: radialSweepForBands(ranking.rankCount)
		}
	);
	const planOf = planLabelsByRank(kept, result.positions, ranking.rankOf);
	/**
	 * 标签方向 = **背离本扇圆心**（单位向量，见 `PositionedTopologyNode.labelDirDx`）。
	 *
	 * 圆心就是该扇被选举出的顶点（`fans[].apexId`），坐标在同一份 `positions` 里，所以方向
	 * 不必由几何库再算一遍；顶点自己的方向无定义（半径为 0），退回「正下方」。
	 */
	const apexOfId = new Map<string, { x: number, y: number }>();
	for (const fan of result.fans) {
		const apex = result.positions.get(fan.apexId);
		if (!apex)
			continue;
		for (const id of fan.ids)
			apexOfId.set(id, apex);
	}
	const labelDirOf = (id: string): { labelDirDx: number, labelDirDy: number } => {
		const point = result.positions.get(id);
		const apex = apexOfId.get(id);
		const vx = (point?.x ?? 0) - (apex?.x ?? 0);
		const vy = (point?.y ?? 0) - (apex?.y ?? 0);
		const length = Math.hypot(vx, vy);
		if (!point || !apex || length < 1)
			return { labelDirDx: 0, labelDirDy: 1 };
		return {
			labelDirDx: Math.round((vx / length) * 1000) / 1000,
			labelDirDy: Math.round((vy / length) * 1000) / 1000
		};
	};
	// 径向扇**不套用「末层居中」**：扇面上各带是**同心环**，环心只有一个（= 顶点 / 根），
	// 层与层天生对齐 —— 「先让末端层居中、再对齐各层」在扇形里没有第二层自由度可用。
	// 硬把最外带（终端带）的弧中点摆到视口中心，实测会把顶点推到 `x = width`（2026-11-09 实测：
	// 6 台样本根节点落到 `1000, 92`，节点一半被 `viewBox` 裁掉、连点都点不中，A26 拖拽直接失效），
	// 因为 65° 楔形扇的外弧跨度就是整个半径 R，弧居中 ⇒ 顶点再向右挪 R。
	// 所以扇形仍按**包围盒**居中（`centerOffset()`）：顶点的左右余量由 `padding` 决定，整张扇坐正。
	// 「末层居中」的裁决落在层级树上（塔型每层一个 x 自由度，见 `topologyTierTreeLayout.ts` 第 ③ 步）。
	return {
		...layoutBox(result.bbox),
		nodes: positioned(kept, result.positions, centerOffset(result.bbox), (id) => ({
			...views.get(id),
			labelShift: planOf.get(id)?.shift,
			...labelDirOf(id)
		})),
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

/**
 * 内容比基准视口小时把它挪到正中（否则整张图会贴在左上角，右下留一片空白）。
 *
 * 径向扇用的就是它 = **包围盒**居中，而不是「最外带（终端带）的弧中点落在视口中心」：
 * 65° 楔形扇的外弧跨度就是半径 R，弧居中会把顶点（根）推到 `x = width` —— 6 台样本实测
 * 根节点落在 `1000, 92`（一半被 `viewBox` 裁掉、指针点不中 ⇒ A26 拖拽失效）。同心环只有
 * 一个环心，「各层对齐」由「同圆心」保证；末层居中的裁决落在层级树上。
 */
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
