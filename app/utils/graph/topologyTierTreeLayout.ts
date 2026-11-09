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
//   2. **初值每层水平居中**：同层节点以 `centerX` 为中心**等间距**铺开
//      （`x_i = centerX + (i − (n−1)/2) · gapX`），作为下面两趟迭代的初值。
//   3. **同层次序 = 父层重心**（自上而下逐层算）：排序键 `(上层邻居 x 均值, id)` ⇒ 连线更短、交叉更少；
//      无上层邻居者取中线（`centerX`）居中；`barycenterOrder: false` 仅供 A/B 对照。
//   4. **父压子女中点**（自下而上逐层，2026-11-09 加入）：有子女的节点 x = 子女 x 的均值。
//      只有第 2 条时，父节点与子女群的相对位置全靠重心排序碰运气 —— 三台汇聚下面挂的接入台数
//      不一时（2 / 3 / 1），汇聚会偏在子女群一侧，塔型读成「斜的」。压实（`packRow()`）保证
//      同层不重叠，最后**整棵图统一平移**把**末层（终端带）**的均值拉回 `centerX`（等量平移不改
//      父子对齐）。基准是末层而不是根层（2026-11-09 用户裁决「先让末端层居中，再对各层对齐」）：
//      末层台数最多、跨度最宽，它决定整张图看上去「坐在哪里」；锚根层时只有一根竖线落在中线上、
//      最宽的一层被挤向一侧。因此「每层均值 = centerX」只在末层成立，其余层跟自己的子女群走 ——
//      这正是塔型该有的样子。
//   5. **窄画布自适应**：`gapX = clamp(可用宽 / 本层台数, minNodeGap, nodeGap)`
//      ⇒ 台数多时自动收窄（整层仍居中、不溢出），极小画布亦有下限保护。
//   6. **确定性**：内部统一收敛（去重 / tier 收窄 / id 升序）⇒ 结果与入参顺序无关、可被断言。
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

/** 单层结果（供审计：`ids` 即层内自左向右的次序，已含「父压子女中点」的重排） */
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
 * 单行压实：保持**现有次序**，把「期望位置」整理成一行可用的坐标。
 *
 * 三步，缺一不可（第三步是稳定性关键）：
 *   1. 左→右补齐欠距：`out[i] ≥ out[i-1] + gap`，保证不重叠、次序不变；
 *   2. 若期望本身带「空洞」⇒ 补齐会把整行拉长，而拉长后的坐标又被上一层当成期望喂回去 ——
 *      这正是「层层右移 / 越来越宽」的棘轮效应来源。故当跨度超过 `max(最小跨度, 期望跨度)` 时，
 *      把整行**均匀化**到该跨度（均匀即无空洞，喂回去的期望跨度不会超过自己，迭代收敛）；
 *   3. 整行等量平移，使行中心 = 期望中心（等量平移不改变间距，只恢复对齐）。
 */
function packRow(desired: readonly number[], gap: number): number[] {
	const count = desired.length;
	if (count <= 1)
		return [...desired];

	const minSpan = (count - 1) * gap;
	const out = [...desired];
	for (let index = 1; index < count; index++)
		out[index] = Math.max(out[index] as number, (out[index - 1] as number) + gap);

	const desiredSpan = Math.max(...desired) - Math.min(...desired);
	const targetSpan = Math.max(minSpan, desiredSpan);
	const packed = (out[count - 1] as number) - (out[0] as number) > targetSpan + 0.5
		? ((): number[] => {
			const step = targetSpan / (count - 1);
			const center = mean(desired);
			return Array.from({ length: count }, (_, index) => center + (index - (count - 1) / 2) * step);
		})()
		: out;

	const shift = mean(desired) - mean(packed);
	return packed.map((value) => value + shift);
}

function mean(values: readonly number[]): number {
	let sum = 0;
	for (const value of values)
		sum += value;
	return values.length > 0 ? sum / values.length : 0;
}

/**
 * 「层级树」居中分层布局（纯函数）。
 *
 * @param nodes - 节点（id + 环号；内部去重、id 升序 ⇒ 与入参顺序无关）
 * @param edges - 边（参与同层次序与「父压子女中点」对齐；同层边 / 悬挂边忽略）
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

	// ⑤ **父压子女中点**（自下而上逐层）：等间距铺开只保证「每层自己居中」，父节点与子女群的
	//    相对位置全靠重心排序碰运气 —— 三台汇聚下面挂的接入台数不一时（2 / 3 / 1），父节点就会
	//    偏在子女群的一侧，塔型读成「斜的」。这里把有子女的节点挪到子女 x 的中点：
	//      · 次序按目标位置重排（子女在左的父节点自然排到左边），再按本层 `gapX` 压实，
	//        保证不重叠、不越出本层次序；
	//      · 没有子女的节点（末层一定没有）保持原位 —— 它们的位置就是「子女」的锚。
	//    整棵图最后统一平移，使根层均值回到 `centerX`（等量平移不破坏任何父子对齐）。
	const childrenOf = new Map<string, string[]>();
	for (const [down, ups] of upperIds) {
		for (const up of ups) {
			const list = childrenOf.get(up) ?? [];
			list.push(down);
			childrenOf.set(up, list);
		}
	}

	for (let index = rows.length - 2; index >= 0; index--) {
		const row = rows[index] as TierTreeRow;
		const next = rows[index + 1] as TierTreeRow;
		const nextIds = new Set(next.ids);
		const targets = row.ids.map((id) => {
			const kids = (childrenOf.get(id) ?? []).filter((kid) => nextIds.has(kid));
			if (kids.length === 0)
				return (positions.get(id) as TierTreePoint).x;
			return mean(kids.map((kid) => (positions.get(kid) as TierTreePoint).x));
		});
		const order = row.ids
			.map((id, position) => ({ id, target: targets[position] as number }))
			.sort((a, b) => a.target - b.target || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
		const packed = packRow(order.map((entry) => entry.target), row.gapX);
		row.ids = order.map((entry) => entry.id);
		row.ids.forEach((id, position) => {
			positions.set(id, { x: packed[position] as number, y: row.y });
		});
	}

	/**
	 * 统一平移：**末层（终端带）的均值**回到画布中心 x（2026-11-09 用户裁决「先让末端层居中，
	 * 再对各层对齐」）。末层台数最多、跨度最宽 ⇒ 它居中，整张图才像是「坐在画布中央」；
	 * 上面各层已由第 ⑤ 步对齐到自己的子女群，所以自下而上天然对齐。等量平移不改父子对齐。
	 */
	const baseRow = rows[rows.length - 1] as TierTreeRow;
	const drift = centerX - mean(baseRow.ids.map((id) => (positions.get(id) as TierTreePoint).x));
	if (Math.abs(drift) > 0.5) {
		for (const [id, point] of [...positions])
			positions.set(id, { x: point.x + drift, y: point.y });
	}

	/**
	 * bbox（审计 / 贴合用；宽高均含留白，宽度取实际落点而非「最宽层的理论跨度」）。
	 *
	 * 这里**不再加「越界守护」**：`bbox` 由最终落点算出，`layoutTopology()` 再据此定 `viewBox`
	 * 与整体偏移（`overflowShift()`）—— 内容因此总能待在画布内、左右各留 `padding`。
	 * 曾按 `padding` 再硬夹一次平移，反而把「末层居中」顶掉了（20 台样本：整张图比视口宽 74px，
	 * `overflowShift()` 已把它摆正，再夹一次 → 全图右移 37px ⇒ 末层均值偏离画布中心，
	 * 正是 A43 抓到的回归）。居中裁决在前，留白是结果，不能倒过来。
	 */
	const spanX = () => {
		const xs = [...positions.values()].map((point) => point.x);
		return { min: Math.min(...xs), max: Math.max(...xs) };
	};
	const finalSpan = spanX();
	const contentWidth = positions.size > 0 ? finalSpan.max - finalSpan.min : 0;
	return {
		positions,
		rows,
		centerX,
		centerY,
		bbox: { width: Math.round(contentWidth + 2 * padding), height: Math.round(totalH + 2 * padding) }
	};
}
