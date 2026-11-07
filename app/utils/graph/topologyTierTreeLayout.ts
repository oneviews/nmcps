// app/utils/graph/topologyTierTreeLayout.ts
// 「层级树」2D 布局的**居中分层**几何库（纯函数）。
//
// 来源：1.0 `_reference/nmcps-v1/layers/monitor/app/lib/topologyTierTreeLayout.ts` **逐行搬入**，
// 2.0 只是把输出直接当作 `TopologyCanvas` 的 SVG 坐标（1.0 写 G6 的 `style.x/y`）。
// 基准见 `NMCPS-DESIGN-001` §6.8。
//
// 为什么不用通用树布局（试错记录，勿回退 —— 1.0 实测结论）：
//   · `dendrogram` 是**聚类树图**语义（所有叶子对齐到同一侧）⇒ 本图真实节点全是叶子 ⇒ 实测被压成一条线；
//   · `compact-box`（TB）+「虚拟根 + 层锚点链」虽能分层，但**隐藏脊柱**使「父居中于子」的整齐树**逐层歪斜**
//     （探针实测每层中心 -86 → -202 → -318 → -492 → -724，整体是斜的）⇒ 锚点撑分层这条路**无法居中**。
// 故本库与径向扇同机制：**预设坐标**，把「分层 + 居中」直接算准。
//
// 设计要点：
//   1. **每层一条水平线**：`y(tier) = centerY − totalH/2 + (tier − minTier) · tierGap`
//      ⇒ 层序 = tier 序，且整块**垂直居中**于画布（首行到末行的中点 = 画布中心 y）。
//   2. **每层水平居中**：同层节点以 `centerX` 为中心**等间距**铺开
//      （`x_i = centerX + (i − (n−1)/2) · gapX`）⇒ **每层均值恒等于 centerX**（居中的数学保证）。
//   3. **同层次序 = 父层重心**（自上而下逐层算）：排序键 `(上层邻居 x 均值, id)` ⇒ 连线更短、交叉更少；
//      无上层邻居者取中线（`centerX`）居中；`barycenterOrder: false` 仅供 A/B 对照。
//   4. **窄画布自适应**：`gapX = clamp(可用宽 / 本层台数, minNodeGap, nodeGap)`
//      ⇒ 台数多时自动收窄（整层仍居中、不溢出），极小画布亦有下限保护。
//   5. **确定性**：内部统一收敛（去重 / tier 收窄 / id 升序）⇒ 结果与入参顺序无关、可被断言。
//
// 本模块**无副作用、无依赖**（不引入 DOM）⇒ 可直接单测。

/** 二维点（画布坐标口径） */
export interface TierTreePoint {
	x: number
	y: number
}

/** 参与布局的节点（只需 id + 环号；环号缺失/非法按 `fallbackTier` 收窄） */
export interface TierTreeNode {
	id: string
	tier: number
}

/** 参与排序的边（仅用于「父层重心」；方向不设限，两端取 tier 较小者为上层） */
export interface TierTreeEdge {
	source: string
	target: string
}

/** 布局选项（全部可选；缺省走本文件唯一源常量） */
export interface TierTreeOptions {
	/** 可用视口（未测量时走 `TIER_TREE_DEFAULT_VIEWPORT`） */
	viewport?: { width: number, height: number }
	/** 相邻层 y 差（px） */
	tierGap?: number
	/** 同层相邻节点标准间距（px，未被宽度约束时的上限） */
	nodeGap?: number
	/** 同层相邻节点最小间距（px，窄画布收窄下限） */
	minNodeGap?: number
	/** 左右/上下留白（px，参与可用宽度与 bbox 计算） */
	padding?: number
	/** 非法/缺失 tier 的兜底环号（与 useTopology 的孤立节点兜底一致） */
	fallbackTier?: number
	/** 同层是否按父层重心排序（默认 `true`；`false` 仅供 A/B 对照） */
	barycenterOrder?: boolean
}

/** 单层结果（供审计：均值必须 = centerX） */
export interface TierTreeRow {
	tier: number
	y: number
	ids: string[]
	gapX: number
}

/** 布局结果 */
export interface TierTreeResult {
	/** 节点 id → 坐标（调用方据此定位节点） */
	positions: Map<string, TierTreePoint>
	rows: TierTreeRow[]
	centerX: number
	centerY: number
	bbox: { width: number, height: number }
}

/** 层间距（px）：≥ 最大节点直径（核心 50 × 画布缩放上限 1.5 = 75）+ 余量 */
export const TIER_TREE_TIER_GAP = 110;

/** 同层相邻节点标准间距（px） */
export const TIER_TREE_NODE_GAP = 120;

/** 同层相邻节点最小间距（px；窄画布收窄下限 —— 再小节点/标签就会压叠） */
export const TIER_TREE_MIN_NODE_GAP = 74;

/** 布局留白（px；不贴画布边缘） */
export const TIER_TREE_PADDING = 56;

/** 未测量视口时的兜底基准（与 `lib/topologyCanvasScale` 的基准同值） */
export const TIER_TREE_DEFAULT_VIEWPORT = { width: 1200, height: 700 } as const;

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

/** 环号收窄：有限且 ≥ 0 取整，否则兜底 */
function tierOf(node: TierTreeNode, fallback: number): number {
	const t = Number(node.tier);
	return Number.isFinite(t) && t >= 0 ? Math.floor(t) : fallback;
}

/**
 * 「层级树」居中分层布局（纯函数）。
 *
 * @param nodes - 节点（id + 环号；内部去重、id 升序 ⇒ 与入参顺序无关）
 * @param edges - 边（仅参与同层「父层重心」排序；同层边 / 悬挂边忽略）
 * @param options - 选项（间距 / 视口 / 兜底环号）
 */
export function computeTierTreePositions(
	nodes: readonly TierTreeNode[],
	edges: readonly TierTreeEdge[],
	options: TierTreeOptions = {}
): TierTreeResult {
	const tierGap = options.tierGap ?? TIER_TREE_TIER_GAP;
	const nodeGap = options.nodeGap ?? TIER_TREE_NODE_GAP;
	const minNodeGap = Math.min(options.minNodeGap ?? TIER_TREE_MIN_NODE_GAP, nodeGap);
	const padding = options.padding ?? TIER_TREE_PADDING;
	const fallbackTier = options.fallbackTier ?? 4;
	const barycenterOrder = options.barycenterOrder ?? true;
	const viewport = options.viewport ?? TIER_TREE_DEFAULT_VIEWPORT;

	const positions = new Map<string, TierTreePoint>();

	// ① 节点收敛：去重（保留首个）+ tier 收窄 + id 升序 ⇒ 结果与入参顺序无关
	const validIds = new Set<string>();
	const tierById = new Map<string, number>();
	for (const n of nodes) {
		if (!n.id || validIds.has(n.id))
			continue;
		validIds.add(n.id);
		tierById.set(n.id, tierOf(n, fallbackTier));
	}
	const ids = [...validIds].sort();

	const centerX = viewport.width / 2;
	const centerY = viewport.height / 2;
	if (ids.length === 0)
		return { positions, rows: [], centerX, centerY, bbox: { width: 0, height: 0 } };

	// ② 分层：tier 升序 + 层内 id 升序（层序 = tier 序）
	const tiers = [...new Set(ids.map((id) => tierById.get(id) as number))].sort((a, b) => a - b);
	const minTier = tiers[0] as number;
	const rows: TierTreeRow[] = tiers.map((tier) => ({
		tier,
		y: 0,
		ids: ids.filter((id) => tierById.get(id) === tier),
		gapX: nodeGap
	}));

	// ③ 上层邻居表（父层重心排序用；两端 tier 较小者为上层，同层边忽略）
	const upperIds = new Map<string, string[]>();
	for (const e of edges) {
		const ts = tierById.get(e.source);
		const tt = tierById.get(e.target);
		if (ts === undefined || tt === undefined || ts === tt)
			continue;
		const up = ts < tt ? e.source : e.target;
		const down = ts < tt ? e.target : e.source;
		const list = upperIds.get(down) ?? [];
		list.push(up);
		upperIds.set(down, list);
	}

	// ④ 逐层落位：先定同层次序（父层重心），再**以 centerX 为中心等间距**铺开
	const totalH = (rows.length - 1) * tierGap;
	const availWidth = Math.max(viewport.width - 2 * padding, minNodeGap);
	for (const row of rows) {
		const count = row.ids.length;
		if (barycenterOrder && row.tier !== minTier) {
			const bary = (id: string): number => {
				const ups = (upperIds.get(id) ?? []).filter((u) => positions.has(u));
				if (ups.length === 0)
					return centerX;
				let sum = 0;
				for (const u of ups)
					sum += (positions.get(u) as TierTreePoint).x;
				return sum / ups.length;
			};
			row.ids.sort((a, b) => {
				const delta = bary(a) - bary(b);
				return delta !== 0 ? delta : (a < b ? -1 : a > b ? 1 : 0);
			});
		}
		// 窄画布自适应：台数多 ⇒ 收窄间距（下限 minNodeGap）⇒ 整层仍居中、不溢出
		row.gapX = count > 1 ? clamp(availWidth / count, minNodeGap, nodeGap) : nodeGap;
		row.y = centerY - totalH / 2 + (row.tier - minTier) * tierGap;
		const half = (count - 1) / 2;
		row.ids.forEach((id, index) => {
			positions.set(id, { x: centerX + (index - half) * row.gapX, y: row.y });
		});
	}

	// ⑤ bbox（审计 / 贴合用；宽高均含留白）
	const widest = rows.reduce((m, r) => Math.max(m, (r.ids.length - 1) * r.gapX), 0);
	return {
		positions,
		rows,
		centerX,
		centerY,
		bbox: { width: Math.round(widest + 2 * padding), height: Math.round(totalH + 2 * padding) }
	};
}
