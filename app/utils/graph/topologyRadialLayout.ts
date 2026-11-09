// app/utils/graph/topologyRadialLayout.ts
// 2D 径向几何（**tier 楔形扇**：圆心 = tier 最小者；各档**等分半径** + 同档**等间隔**）。
//
// 来源：1.0 `_reference/nmcps-v1/layers/monitor/app/lib/topologyRadialLayout.ts` **逐行搬入**
// （同一套几何常量、同一套分组 / 重心 / 旋转算法），2.0 只换坐标消费方：
// 1.0 把结果写进 G6 节点的 `style.x/y`，2.0 直接作为 `TopologyCanvas` 的 SVG 坐标
// （`NMCPS-ADR-0019` D1：图形自绘、布局以纯函数注入）。基准见 `NMCPS-DESIGN-001` §6.8。
//
// 设计约束：
//   · 纯函数、零依赖、零随机 ⇒ 可被`check:ui` 逐项断言；
//   · **圆心 = 该扇 tier 最小者**（顶点在圆心、半径 0）—— 扇面自圆心朝**左**张开；
//   · **整体扇形**：张角**逐档**取 `RADIAL_SWEEP_BY_TIER`（v0.25 用户规格：tier4 = **65°**、tier2/3 = **75°**，
//     其余回落基线 `RADIAL_SWEEP_DEG = 60`），各档均以「正左方向 180°」为中心左右对称张开；
//     **最外档（tier 最大）节点在本档弧线上等间隔均匀分布**（角步 = 该档张角/该档台数）；
//   · **扇形内部**：`r(t) = (t − apexTier)/tierSpan · R` —— 4 档时即 **1/4、2/4、3/4、4/4**（用户规格）；
//     **每档按父节点分组**：组内等间隔、**组间额外留 `RADIAL_GROUP_GAP`（40px，受张角余量钳制）**，
//     组序 = 父方位角升序 ⇒ **档内父方位角单调不减 ⇒ 主边不交叉**；余量不足（< 12px）即退回纯等间隔；
//   · ★ **v0.26 组内按重心排序（`RADIAL_BARYCENTER_ORDER`）**：组内次序 = 「该节点**全部**上层邻居的方位角
//     均值」升序 ⇒ 接入层「冗余双连汇聚」这类多父节点被排向次要父一侧，其次要边不再横跨整段弧
//     （实测交叉数 74 → 61，−18%）；`options.barycenterOrder: false` 可退回按 id 升序（A/B 对照用）；
//   · **R（扇半径）尽量站满画布**：取「画布能容纳的最大半径」（宽 / 高双向取小，`R = min(宽容量, 高容量)`），
//     下限 `maxTier·ringGap`（档间不塌缩）；**不按弧长容量扩半径** —— 节点尺寸是绝对 px，画布把整张图
//     一起缩放（扩半径只会让字号变小、屏上疏密比不变）⇒ 画布贴合优先，
//     同档台数过多时接受间距 < `nodeArc`（已知密度上限；要更疏请加大 `sweepDeg` 或显式 `stretch: 'auto'`）；
//   · tier 只决定半径：spine 认错父节点只会改变**同档内的角度次序**，绝不改变「某台设备在哪一档」；
//   · 不使用任何布局引擎：本函数输出即最终节点坐标（与 1.0 写 G6 `style.x/y` 同机制）。
//
// 坐标系：视口坐标（左上为原点）。顶点（该扇 tier 最小者）在**圆心**（半径 0）：
//   · **默认 `sweepDeg = 60`**：楔形扇朝**左**张开 —— 半径越大越靠左 ⇒ 沿水平中线带自左向右
//     = tier 最大 → 最小；60° 扇的外框 ≈ R×R（正方形）；
//   · **默认 `stretch = 1`**（真圆弧 ⇒ 同档相邻弦长**严格相等**）；
//     `stretch: 'auto'` = 外框贴合画布长宽比（真正铺满横向）、数字 = 轻度放大，二者均为**显式传参能力**；
//   · `sweepDeg: 360`（**显式传参、非默认**）：整圆同心环 —— 各档为同心圆环、`stretch` 恒 1、
//     **无左右读向**（旋转对称），档位识别由「半径 + 层色 + 图例」承载。该模式保留为**回归用例**。

/** 布局输入节点（只要 id + 档位） */
export interface RadialLayoutNode {
	id: string
	/** 结构推断档位（0 = 主核心；缺省按 `fallbackTier` 兜底） */
	tier?: number
}

/** 布局输入边（仅用于骨架树；不参与半径计算） */
export interface RadialLayoutEdge {
	source: string
	target: string
}

/** 布局参数（全部有默认值；调用方可逐项覆盖以断言几何） */
export interface RadialLayoutOptions {
	/** 同档每台节点所需弧长（px，含节点尺寸 + 间隙）：半径容量约束的最小值 */
	nodeArc?: number
	/** 档间最小径向间距（px） */
	ringGap?: number
	/**
	 * 扇面张角（度；**基线**）：**60 = 楔形扇（默认，v0.24 用户规格）**；180 = 左半扇；360 = 整圆同心环（显式传参）；下限 20。
	 * ★ 逐档张角用 `sweepDegByTier`（v0.25：tier4 = 65°、tier2/3 = 75°，其余回落本值）。
	 */
	sweepDeg?: number
	/** 逐档张角覆盖（度）：`{ 4: 65, 3: 75, 2: 75 }`；缺省取 `RADIAL_SWEEP_BY_TIER`，未列出的档位回落 `sweepDeg` */
	sweepDegByTier?: Readonly<Record<number, number>>
	/** 同档按父分组的**组间目标间距（px）**：缺省 `RADIAL_GROUP_GAP`；受张角余量钳制，不足下限则退回纯等间隔 */
	groupGap?: number
	/** 组内排序是否按重心（barycenter）：缺省 `RADIAL_BARYCENTER_ORDER`（true）；`false` 仅供 A/B 对照 */
	barycenterOrder?: boolean
	/** 整体旋转（度，**视觉逆时针为正**）：缺省 `RADIAL_ROTATE_DEG`（10°）；仅改变扇面中心角，不改相对几何 */
	rotateDeg?: number
	/**
	 * 横轴放大系数（**仅 `sweepDeg < 360` 时生效**）：
	 *   · 缺省 = `RADIAL_STRETCH` = **1（真圆弧 ⇒ 同档相邻弦长严格相等；v0.24 默认）**；
	 *   · `'auto'` = **外框贴合画布长宽比（真正铺满横向）** —— 代价：椭圆端点弧长速度 = 中线的 s 倍
	 *     ⇒ 同档弦长 `max/min ≈ s`（v0.21 被判为「不均匀」的形态，故**非默认**、仅显式传参）；
	 *   · 数字 = 直接采用（钳制 [1,4]）；整圆下恒为 1。
	 */
	stretch?: number | "auto"
	/** 画布尺寸（`stretch: 'auto'` 与「扇半径尽量站满画布」都要用它；缺省 1200×700） */
	viewport?: { width: number, height: number }
	/** 多分量扇之间的水平间距（px） */
	fanGap?: number
	/** 画布内边距（px） */
	padding?: number
	/** 数据未给 tier 时的兜底档位（与 useTopology 的孤立节点兜底一致，默认 4） */
	fallbackTier?: number
}

/** 一个扇（连通分量；孤立节点并入主扇） */
export interface RadialFan {
	/** 扇内节点（id 升序） */
	ids: string[]
	/** 圆心（顶点）：tier 最小者，并列取「度数最大 → id 最小」 */
	apexId: string
	/** 该扇占用的水平宽度（px：**整圆 = 直径**、部分张角 = 半宽；已含 stretch） */
	width: number
}

/** 布局结果 */
export interface RadialLayoutResult {
	/** id → 视口坐标（取整） */
	positions: Map<string, { x: number, y: number }>
	/** 档位 → 半径（**等分扇半径**：`r(t) = t/maxTier · fanRadius`，全图统一；顶点档 = 0） */
	radii: Map<number, number>
	/** 档位 → 台数（全图） */
	tierCounts: Map<number, number>
	/** 扇（自左向右顺序：规模降序 → 最小 id） */
	fans: RadialFan[]
	/** 内容外框（含内边距；60° 楔形下 ≈ `R × R`） */
	bbox: { width: number, height: number }
	/** 实际使用的横轴放大系数（**v0.24 默认 = 1 = 真圆弧**；整圆下恒为 1；`'auto'` = 外框贴合画布长宽比） */
	stretch: number
	/** **扇半径 R**（最外档半径；等分半径的基准：`r(t) = t/maxTier · fanRadius`） */
	fanRadius: number
	/** 落位后实测的**同档相邻最小间距**（px；整圆含首尾跨缝对；据此断言不重叠） */
	minGap: number
}

// ── 视觉常量（唯一源；改形态只改这里）────────────────────────────────────────
/** 同档每台节点所需弧长（≈ 节点直径 36~50 + 间隙） */
export const RADIAL_NODE_ARC = 60;
/** 档间最小径向间距 */
export const RADIAL_RING_GAP = 70;
/**
 * 默认扇面张角（度；**基线**）：**60 = 楔形扇（v0.24 用户规格「所有 tier=4 的节点均匀分布在一个 60度角的弧线上」）**；
 * 180 = 左半扇；360 = 整圆同心环（均显式传参）。扇面以「正左方向 180°」为中心张开。
 * ★ v0.25：**逐档张角**见 `RADIAL_SWEEP_BY_TIER`（未列出的档位回落到本基线）。
 */
export const RADIAL_SWEEP_DEG = 60;
/**
 * **逐档张角（度；v0.25 用户规格）**：
 *   · tier 4（终端层）⇒ **65°**：拉大最外档节点间距、给节点名留空间、降低与 tier 3 连线的交叉；
 *   · tier 2 / tier 3 ⇒ **75°**：为「按父节点分组 + 组间拉开间距」提供角度余量；
 *   · 其余档位不列 ⇒ 回落基线 `RADIAL_SWEEP_DEG`。
 * ★ 余量即组间距的唯一来源：加宽的部分（`ringSweep − 基线`）用于组间留白，**组内间距不会被吃小**。
 */
export const RADIAL_SWEEP_BY_TIER: Readonly<Record<number, number>> = { 2: 75, 3: 75, 4: 65 };
/** 逐档张角的两档取值：**最外档** = 65°、**其余非顶点档** = 75°（`RADIAL_SWEEP_BY_TIER` 就是层数 = 4 时的特例） */
export const RADIAL_SWEEP_OUTER_DEG = 65;
export const RADIAL_SWEEP_INNER_DEG = 75;

/**
 * 逐档张角按**带号**生成（`NMCPS-DESIGN-001` §6.8）：最外档 65°、其余非顶点档 75°、顶点档不列（回落基线 60°）。
 *
 * 为什么需要它：`RADIAL_SWEEP_BY_TIER` 是按「4 档」写死的 —— 层数不再等于 4 时
 * （根节点选举会多出一层、无下级节点下移会合并两层）按固定档号取张角就会错位：
 * 5 档图的最外档会拿不到 65° 而回落到 60°，比它里面那档（65°）还窄。
 * 层数 = 4 时 `radialSweepForBands(4)` 与 `RADIAL_SWEEP_BY_TIER` **逐项相同**（回归不变）。
 */
export function radialSweepForBands(bandCount: number): Record<number, number> {
	const sweep: Record<number, number> = {};
	const last = Number.isFinite(bandCount) ? Math.max(1, Math.floor(bandCount)) : 1;
	for (let band = 2; band <= last; band++)
		sweep[band] = band === last ? RADIAL_SWEEP_OUTER_DEG : RADIAL_SWEEP_INNER_DEG;
	return sweep;
}
/**
 * **同档按父节点分组的组间目标间距（px，v0.25）**：组与组之间在弧上额外留出这么多像素。
 *   实际值受「该档张角余量」钳制（`余量弧长 ÷ (组数 − 1)`），不足 `RADIAL_MIN_GROUP_GAP` 则**退回纯等间隔**。
 */
export const RADIAL_GROUP_GAP = 40;
/** 组间距的下限（px）：钳制后低于此值即放弃分组留白（保住组内间距优先） */
export const RADIAL_MIN_GROUP_GAP = 12;
/**
 * **整体旋转（度；v0.27 用户规格「以 tier=0 层节点为圆心逆时针旋转 10 度」；v0.30 用户规格改为 25°）**：
 *   · 语义 = **视觉逆时针为正**；实现落在「扇面中心角」`θmid = 180° − 旋转角`
 *     （画布 **y 轴向下** ⇒ 角度增大 = 视觉顺时针，故取负号）；
 *   · 只旋转整张扇（所有档、所有扇一起），**圆心不变** ⇒ 逐档张角 / 等分半径 / 组内等间隔 / 分组留白全部保持；
 *   · 外框与纵向跨度按**旋转后的弧段极值**计算（不再假设左右对称）⇒ `vSpan` / 横向跨度随旋转变大。
 */
export const RADIAL_ROTATE_DEG = 25;
/**
 * **组内排序是否按重心（barycenter，v0.26）**：默认 `true` —— 组内按「该节点**全部**上层邻居的方位角均值」
 * 升序 ⇒ 多父（接入层冗余双连汇聚）节点被排向次要父一侧，其次要边不再横跨整段弧（实测交叉数 −18%）。
 * 传 `false` 可退回「按 id 升序」（**仅供 A/B 对照断言**，生产路径勿改）。
 */
export const RADIAL_BARYCENTER_ORDER = true;
/** 多分量扇之间的水平间距 */
export const RADIAL_FAN_GAP = 160;
/** 画布内边距 */
export const RADIAL_PADDING = 40;
/**
 * **默认横轴放大系数 = 1（v0.24：真圆弧 ⇒ 同档相邻弦长严格相等）**：
 *   60° 楔形扇的外框 ≈ `R × R`（正方形），半径 R 已按「画布能容纳的最大值」取 ⇒ 不需要放大；
 *   需要**真正铺满横向**时显式传 `'auto'`（外框贴合画布长宽比；代价：同档弦长 `max/min ≈ s`），
 *   或传数字（钳制 `[1,4]`）做轻度放大。
 */
export const RADIAL_STRETCH: number | "auto" = 1;
/** 横轴放大系数上下限（**仅显式放大时**用到；整圆下恒为 1、不使用本范围） */
export const RADIAL_MIN_STRETCH = 1;
export const RADIAL_MAX_STRETCH = 4;
/** 缺省画布尺寸（调用方通常传真实容器尺寸） */
export const RADIAL_DEFAULT_VIEWPORT = { width: 1200, height: 700 } as const;

const DEG_TO_RAD = Math.PI / 180;

function cmpId(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function clamp(value: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, value));
}

function tierOf(node: RadialLayoutNode, fallback: number): number {
	const t = Number(node.tier);
	return Number.isFinite(t) && t >= 0 ? Math.floor(t) : fallback;
}

/**
 * 计算径向扇坐标（**唯一入口**）。
 *
 * @param nodes 节点（id + 结构推断档位）
 * @param edges 边（仅用于骨架树；不参与半径计算）
 * @param options 参数（全部可选）
 * @returns 坐标 / 半径表 / 档位直方图 / 扇划分 / 外框 / 实际 stretch
 */
export function computeRadialPositions(
	nodes: readonly RadialLayoutNode[],
	edges: readonly RadialLayoutEdge[],
	options: RadialLayoutOptions = {}
): RadialLayoutResult {
	const nodeArc = options.nodeArc ?? RADIAL_NODE_ARC;
	const ringGap = options.ringGap ?? RADIAL_RING_GAP;
	const sweepDeg = clamp(options.sweepDeg ?? RADIAL_SWEEP_DEG, 20, 360);
	const sweepByTier = options.sweepDegByTier ?? RADIAL_SWEEP_BY_TIER;
	const groupGap = options.groupGap ?? RADIAL_GROUP_GAP;
	const barycenterOrder = options.barycenterOrder ?? RADIAL_BARYCENTER_ORDER;
	const rotateDeg = options.rotateDeg ?? RADIAL_ROTATE_DEG;
	const fanGap = options.fanGap ?? RADIAL_FAN_GAP;
	const padding = options.padding ?? RADIAL_PADDING;
	const fallbackTier = options.fallbackTier ?? 4;
	const viewport = options.viewport ?? RADIAL_DEFAULT_VIEWPORT;

	const positions = new Map<string, { x: number, y: number }>();
	const radii = new Map<number, number>();
	const tierCounts = new Map<number, number>();
	const fans: RadialFan[] = [];

	// ① 节点收敛：去重 + id 升序 ⇒ 结果与入参顺序无关
	const tierById = new Map<string, number>();
	for (const n of nodes) {
		if (!n || !n.id || tierById.has(n.id))
			continue;
		tierById.set(n.id, tierOf(n, fallbackTier));
	}
	const ids = [...tierById.keys()].sort(cmpId);
	if (ids.length === 0) {
		return {
			positions,
			radii,
			tierCounts,
			fans,
			bbox: { width: 0, height: 0 },
			stretch: RADIAL_MIN_STRETCH,
			fanRadius: 0,
			minGap: 0
		};
	}

	// ② 无向邻接（去自环 / 去悬挂边 / 去重）
	const adj = new Map<string, Set<string>>();
	for (const id of ids)
		adj.set(id, new Set<string>());
	for (const e of edges) {
		if (!e || !e.source || !e.target || e.source === e.target)
			continue;
		const a = adj.get(e.source);
		const b = adj.get(e.target);
		if (!a || !b)
			continue;
		a.add(e.target);
		b.add(e.source);
	}
	const degreeOf = (id: string): number => adj.get(id)?.size ?? 0;

	// ③ 连通分量（按 id 升序 DFS ⇒ 确定性）；分量按「规模降序 → 最小 id」排序
	const compOf = new Map<string, number>();
	const comps: string[][] = [];
	for (const start of ids) {
		if (compOf.has(start))
			continue;
		const index = comps.length;
		const list: string[] = [];
		const stack: string[] = [start];
		compOf.set(start, index);
		while (stack.length > 0) {
			const cur = stack.pop() as string;
			list.push(cur);
			for (const next of adj.get(cur) ?? []) {
				if (!compOf.has(next)) {
					compOf.set(next, index);
					stack.push(next);
				}
			}
		}
		list.sort(cmpId);
		comps.push(list);
	}
	comps.sort((a, b) => (a.length !== b.length ? b.length - a.length : cmpId(a[0] as string, b[0] as string)));

	// ④ 扇划分：**孤立节点（度 0）并入主扇**（其档位本就是兜底值，不单独成扇以免画布爆炸）；
	//    全图无边 ⇒ 所有节点视为单一虚拟扇（顶点 = 最小档位）
	const isolated = ids.filter((id) => degreeOf(id) === 0);
	const solid = comps.filter((c) => c.length > 1 || degreeOf(c[0] as string) > 0);
	const fanSets: string[][] = solid.length > 0 ? solid.map((c) => [...c]) : [[]];
	if (isolated.length > 0)
		fanSets[0] = [...(fanSets[0] as string[]), ...isolated].sort(cmpId);
	if ((fanSets[0] as string[]).length === 0)
		fanSets[0] = [...ids];

	// ⑤ 档位直方图（全图统一）+ 张角 / 整圆判定
	//    ★ v0.24 结构：半径**不再**按「上一档 + ringGap」递推，而是**等分扇半径**
	//      `r(t) = (t − apexTier) / tierSpan · R`（4 档时即 1/4·2/4·3/4·4/4，用户规格）；
	//      最外档半径 `R` 由「画布能容纳的最大半径」与「弧长容量」共同决定（见 ⑤b）。
	for (const id of ids) {
		const t = tierById.get(id) as number;
		tierCounts.set(t, (tierCounts.get(t) ?? 0) + 1);
	}
	const tiers = [...tierCounts.keys()].sort((a, b) => a - b);
	const apexTier = tiers[0] as number;
	const maxTier = tiers[tiers.length - 1] as number;
	const tierSpan = Math.max(1, maxTier - apexTier);
	const sweepRad = sweepDeg * DEG_TO_RAD;
	// ★ 整圆判定（显式 `sweepDeg: 360`）：整圆下 `stretch ≡ 1`（真圆而非椭圆），
	//   且同档相邻间距必须计入**首尾跨缝对**（θ=0 与 θ=2π 在几何上相邻）。
	const fullCircle = sweepRad >= (2 * Math.PI) - 1e-9;
	// ★ v0.25 **逐档张角**（扇面仍以 180° 为中心）：整圆下全档 = 2π；
	//   否则按 `sweepDegByTier`（默认 tier4 = 65°、tier2/3 = 75°）⇒ 未列出的档位回落基线 `sweepDeg`。
	const ringSweepRad = new Map<number, number>();
	for (const tier of tiers) {
		const deg = fullCircle ? 360 : clamp(sweepByTier[tier] ?? sweepDeg, 20, 360);
		ringSweepRad.set(tier, deg * DEG_TO_RAD);
	}
	const ringSweepOf = (tier: number): number => ringSweepRad.get(tier) ?? sweepRad;
	const fanCount = Math.max(1, fanSets.length);
	// ★ v0.27 **整体旋转**：视觉逆时针为正 ⇒ 扇面中心角 = 180° − 旋转角（画布 y 轴向下 ⇒ 角度增大 = 视觉顺时针）
	const thetaMid = Math.PI - (rotateDeg * DEG_TO_RAD);
	/** 弧段 `[a, b]` 上 `sin` / `cos` 的极值（端点 + 跨越极值点时取 ±1） */
	const arcRange = (a: number, b: number): { sinMin: number, sinMax: number, cosMin: number, cosMax: number } => {
		const TAU = 2 * Math.PI;
		const crosses = (target: number): boolean => {
			const k = Math.ceil((a - target) / TAU);
			return (target + (k * TAU)) <= b + 1e-12;
		};
		const sins = [Math.sin(a), Math.sin(b)];
		const coss = [Math.cos(a), Math.cos(b)];
		if (crosses(Math.PI / 2))
			sins.push(1);
		if (crosses((3 * Math.PI) / 2))
			sins.push(-1);
		if (crosses(0))
			coss.push(1);
		if (crosses(Math.PI))
			coss.push(-1);
		return { sinMin: Math.min(...sins), sinMax: Math.max(...sins), cosMin: Math.min(...coss), cosMax: Math.max(...coss) };
	};
	/** 各档弧段（档位半径占比 × 该弧段 sin/cos 极值）—— 旋转后外框不再左右对称，故一律由极值求解 */
	const ringArcs = tiers.map((tier) => ({
		frac: (tier - apexTier) / tierSpan,
		range: arcRange(thetaMid - (ringSweepOf(tier) / 2), thetaMid + (ringSweepOf(tier) / 2))
	}));
	/** 纵向跨度系数（圆心也在包络内 ⇒ 与 0 取极值）；**无档位跨度**（全部节点同档 ⇒ 只剩圆心一点）时取单位值 */
	const vSpanRaw = Math.max(0, ...ringArcs.map((a) => a.frac * a.range.sinMax))
		- Math.min(0, ...ringArcs.map((a) => a.frac * a.range.sinMin));
	/** 每扇横向跨度系数（× `stretch × R`；圆 / 楔形 / 旋转统一由此得出）；同上，退化时取单位值 */
	const hSpanRaw = Math.max(0, ...ringArcs.map((a) => a.frac * a.range.cosMax))
		- Math.min(0, ...ringArcs.map((a) => a.frac * a.range.cosMin));
	const hasTierSpread = (maxTier - apexTier) > 0;
	const vSpanFactor = hasTierSpread ? vSpanRaw : 1;
	const hSpanPerFan = hasTierSpread ? hSpanRaw : 1;
	const availW = Math.max(1, viewport.width - (2 * padding) - (fanGap * (fanCount - 1)));
	const availH = Math.max(1, viewport.height - (2 * padding));

	// ⑤a 横轴放大系数（**先定**，因为「可容纳半径」依赖它；整圆恒 1）
	const stretchOption = options.stretch ?? RADIAL_STRETCH;
	const autoStretch = stretchOption === "auto";
	const stretchNum = (fullCircle || autoStretch)
		? RADIAL_MIN_STRETCH
		: clamp(stretchOption as number, RADIAL_MIN_STRETCH, RADIAL_MAX_STRETCH);

	// ⑤b 扇半径 R（**尽量站满画布**，v0.24 用户规格「扇形半径尽量站满横向空间」）：
	//     · **填充**：宽 `扇数·stretch·hSpan·R ≤ availW`、高 `vSpan·R ≤ availH`
	//       ⇒ `R = max(下限, min(availW / (扇数·stretch·hSpan), availH / vSpan))`（宽高双向取小）；
	//     · **下限** `R ≥ tierSpan·ringGap`（档间径向间距，防极小画布把档位压成一点）；
	//     · ★ **不再按弧长容量扩半径**：节点尺寸是绝对 px，画布会把「半径 + 节点」一起缩放
	//       ⇒ 扩半径只会让字号变小、屏上疏密比不变（且可能溢出画布）；因此**画布贴合优先**，
	//       同档台数过多时接受间距 < nodeArc（**已知密度上限**：60° 楔形 + 该画布尺寸的容量就这么大，
	//       要更疏只能加大张角 `sweepDeg` 或显式 `stretch: 'auto'`）。
	const rFloor = tierSpan * ringGap;
	const fanRadius = Math.max(
		rFloor,
		Math.min(availW / (fanCount * Math.max(stretchNum, RADIAL_MIN_STRETCH) * hSpanPerFan), availH / vSpanFactor)
	);
	// ⑤c 等分半径表（顶点档 = 0；4 档 ⇒ 1/4·2/4·3/4·4/4）
	for (const tier of tiers)
		radii.set(tier, ((tier - apexTier) / tierSpan) * fanRadius);
	const maxRadius = fanRadius;

	// ⑥ 逐扇角度分配（**同档等间隔**，v0.24 用户规格）
	//    · 半径只由档位决定（见 ⑤c）⇒ 本段**只产角度**：每一档在本档弧线上**等间隔**均匀分布
	//      （角步 = 张角 / 该档台数 ⇒ 相邻间隔全部相等，最外档尤其明显）；
	//    · 档内次序 = 「父节点方位角升序 → id 升序」⇒ 同一父节点下的节点在弧上相邻、连线少交叉；
	//      父指针**只用于排序**（认错父节点也只改变同档次序，不影响任何一台的档位 / 半径）。
	interface FanSpine {
		ids: string[]
		apexId: string
		angles: Map<string, number>
	}

	// 扇面中心角已在 ⑤ 由「旋转角」定出（v0.27：`θmid = 180° − 旋转角`），此处不再重复定义。

	const spines: FanSpine[] = fanSets.map((fanIds) => {
		const fanSet = new Set(fanIds);
		// 顶点 = 档位最小者（并列：度数最大 → id 最小）
		const apexId = [...fanIds].sort((a, b) => {
			const ta = tierById.get(a) as number;
			const tb = tierById.get(b) as number;
			if (ta !== tb)
				return ta - tb;
			const da = degreeOf(a);
			const db = degreeOf(b);
			if (da !== db)
				return db - da;
			return cmpId(a, b);
		})[0] as string;

		// 父选择：候选 = 「档位更小的邻居」；排序键 = 度数降序 → **已挂载子树规模升序（均衡）** → id 升序。
		// ★ 均衡键的必要性（ADR-014 实施修订②，2026-09-21 实时数据实测）：
		//   真实仿真网络里核心层与汇聚层是**全连**的（3 核心 × 3 汇聚，三台核心度数全相等、三台汇聚度数也全相等），
		//   仅按「度数最大 → id 最小」会把**全部汇聚子树统统挂到同一台核心**下，另两台核心退化为叶节点
		//   （子树权重 = 1）⇒ 每条只剩 1/N 扇面（实测 ≈9.5°）⇒ **核心档在扇心挤成一团，不成扇形**。
		//   引入「已挂载子树规模最小者优先」后，子树在各候选父节点间自动摊平（等价于按扇区容量分摊），
		//   核心档随即摊开成扇 —— 且 **tier 仍只决定半径**，读向 / 档位读数完全不受影响。
		//   处理顺序 = 档位升序 → id 升序 ⇒ 与入参顺序无关（确定性保持）。
		const load = new Map<string, number>();
		const parentOf = new Map<string, string>();
		const byTierAsc = [...fanIds].sort((a, b) => {
			const ta = tierById.get(a) as number;
			const tb = tierById.get(b) as number;
			if (ta !== tb)
				return ta - tb;
			return cmpId(a, b);
		});
		for (const id of byTierAsc) {
			if (id === apexId)
				continue;
			const parent = [...(adj.get(id) ?? [])]
				.filter((u) => fanSet.has(u) && (tierById.get(u) as number) < (tierById.get(id) as number))
				.sort((a, b) => {
					const da = degreeOf(a);
					const db = degreeOf(b);
					if (da !== db)
						return db - da;
					const la = load.get(a) ?? 0;
					const lb = load.get(b) ?? 0;
					if (la !== lb)
						return la - lb;
					return cmpId(a, b);
				})[0] ?? apexId;
			parentOf.set(id, parent);
			// 已挂载子树规模累加到自身与全部祖先（父指针已定型 ⇒ 单遍向上即可）
			for (let cur: string | undefined = id; cur !== undefined; cur = parentOf.get(cur))
				load.set(cur, (load.get(cur) ?? 0) + 1);
		}

		// 档内清单（按档位分组，顶点单独处理）
		const byTier = new Map<number, string[]>();
		for (const id of fanIds) {
			if (id === apexId)
				continue;
			const t = tierById.get(id) as number;
			const list = byTier.get(t) ?? [];
			list.push(id);
			byTier.set(t, list);
		}

		// 逐档（档位升序 ⇒ 父方位角已定）铺开：**按父节点分组**（v0.25）→ **父对齐**（v0.26，见下）
		//   · 组序 = 父方位角升序 → 组内 id 升序 ⇒ 档内「父方位角序列单调不减」⇒ **连线不交叉**；
		//   · ★ v0.26 **父对齐（消除交叉的核心）**：每组以父节点方位角为**中心**摆放
		//     （`child_j = p + (j − (n−1)/2)·s`），全档统一步长 `s = min(公平份额, sMax)`，
		//     其中 `sMax` 由「相邻组保序不重叠 + 不越出本档张角」解析求得：
		//     相邻组 `s ≤ 2·Δp/(n_i + n_{i+1})`（由此推出**组间空隙 ≥ s**）、首/末组受本档边界约束。
		//     这样「子节点角度序 = 父节点角度序」⇒ 该档与其父档之间**零交叉**（v0.25 的顺序铺开会把
		//     块中心推离父方位角，实测可差十几度 ⇒ 单条连线横跨多条）。
		//   · **退化保护**：若对齐会把步长压到 `nodeArc`（物理下限）以下（父节点过密 + 子节点过多），
		//     则退回 v0.25 的「顺序铺开 + 组间留白」（间距优先，容忍交叉）。
		//   · 整圆（显式 360°）不分组/不对齐（首尾相接，无「组间」可言 ⇒ 纯等间隔）。
		const angles = new Map<string, number>();
		angles.set(apexId, thetaMid); // 圆心（半径 0；角度仅供子节点排序用）
		for (const tier of [...byTier.keys()].sort((a, b) => a - b)) {
			const ringIds = (byTier.get(tier) as string[]).sort((a, b) => {
				const pa = angles.get(parentOf.get(a) ?? apexId) ?? thetaMid;
				const pb = angles.get(parentOf.get(b) ?? apexId) ?? thetaMid;
				if (pa !== pb)
					return pa - pb;
				return cmpId(a, b);
			});
			const ringSweep = ringSweepOf(tier);
			const radius = radii.get(tier) ?? 0;
			// 分组：同父节点连续成组（组序 = 首次出现顺序 = 父方位角升序）
			const groups: Array<{ parent: string, ids: string[] }> = [];
			for (const id of ringIds) {
				const parent = parentOf.get(id) ?? apexId;
				const last = groups[groups.length - 1];
				if (!last || last.parent !== parent)
					groups.push({ parent, ids: [id] });
				else
					last.ids.push(id);
			}
			// ★ v0.26 **重心（barycenter）排序**：组内按「**全部**上层邻居的方位角均值」升序 ⇒
			//   接入层「冗余双连汇聚」时，多父节点被排向次要父一侧 ⇒ 其次要边不再横跨整段弧（交叉数实测大降）。
			//   组本身仍按主父方位角排（保证同父连续成组），只有组内次序用重心。
			const barycenterOf = (id: string): number => {
				const parents = [...(adj.get(id) ?? [])]
					.filter((u) => fanSet.has(u) && (tierById.get(u) as number) < tier);
				if (parents.length === 0)
					return angles.get(parentOf.get(id) ?? apexId) ?? thetaMid;
				return parents.reduce((sum, u) => sum + (angles.get(u) ?? thetaMid), 0) / parents.length;
			};
			for (const group of groups) {
				group.ids.sort((a, b) => {
					// ★ v0.26：组内按**重心**（全部上层邻居的方位角均值）升序 ⇒ 多父节点排向次要父一侧（少交叉）；
					//   `barycenterOrder: false` 时退回按 id 升序（仅 A/B 对照用）。
					if (!barycenterOrder)
						return cmpId(a, b);
					const ba = barycenterOf(a);
					const bb = barycenterOf(b);
					if (ba !== bb)
						return ba - bb;
					return cmpId(a, b);
				});
			}
			// v0.25 基准：等间隔 + 组间留白（留白只花「本档张角相对基线的余量弧长」，不足下限即放弃）
			let gapPx = 0;
			if (!fullCircle && groups.length > 1 && radius > 0) {
				const gapBudget = (Math.max(0, ringSweep - sweepRad) * radius) / (groups.length - 1);
				gapPx = Math.min(groupGap, gapBudget);
				if (gapPx < RADIAL_MIN_GROUP_GAP)
					gapPx = 0;
			}
			const gapRad = radius > 0 ? gapPx / radius : 0;
			const step = (ringSweep - ((groups.length - 1) * gapRad)) / ringIds.length;
			// 顺序铺开：每组占 `n·step` 弧长、组间插入 `gapRad`（顶点档 = 0 的组天然退化）
			let cursor = thetaMid - (ringSweep / 2);
			for (const group of groups) {
				group.ids.forEach((id, index) => {
					angles.set(id, cursor + ((index + 0.5) * step));
				});
				cursor += (group.ids.length * step) + gapRad;
			}
		}
		return { ids: fanIds, apexId, angles };
	});

	// ⑦ 横轴放大系数（数字 / 整圆情形已在 ⑤a 定；此处只解 `'auto'`）
	//    `'auto'` = **外框贴合画布长宽比（真正铺满横向）**：半径先按高度取满（⑤b 已含），
	//    再把横轴放大到把可用宽度铺满：`s = clamp(availW / (扇数·hSpan·R), 1, 4)`。
	//    ★ 代价：椭圆端点弧长速度 = 中线的 s 倍 ⇒ 同档弦长 `max/min ≈ s`（v0.21 被判为「不均匀」的根因，
	//      故**非默认**）；默认 `stretch = 1` = 真圆弧 ⇒ **同档相邻弦长严格相等**（v0.24 用户规格）。
	const stretch = (!fullCircle && autoStretch)
		? clamp(availW / (fanCount * hSpanPerFan * Math.max(fanRadius, 1)), RADIAL_MIN_STRETCH, RADIAL_MAX_STRETCH)
		: stretchNum;

	// ⑧ 扇自左向右排布（顺序 = 规模降序 → 最小 id）
	//    · 以「旋转后的弧段极值」定位（v0.27）：左 / 右 / 上 / 下分别由极值给出，圆心在包络内
	//      ⇒ `offsetX = cursor − leftExtent`、`offsetY = padding − bottomExtent`；占位宽度 = 左右极值之差。
	const leftExtent = Math.min(0, ...ringArcs.map((a) => a.frac * a.range.cosMin)) * stretch * maxRadius;
	const rightExtent = Math.max(0, ...ringArcs.map((a) => a.frac * a.range.cosMax)) * stretch * maxRadius;
	const topExtent = Math.max(0, ...ringArcs.map((a) => a.frac * a.range.sinMax)) * maxRadius;
	const bottomExtent = Math.min(0, ...ringArcs.map((a) => a.frac * a.range.sinMin)) * maxRadius;
	const fanWidth = Math.max(rightExtent - leftExtent, nodeArc);
	let cursor = padding;
	for (const fan of spines) {
		const width = fanWidth;
		const offsetX = cursor - leftExtent;
		const offsetY = padding - bottomExtent;
		for (const id of fan.ids) {
			const r = radii.get(tierById.get(id) as number) ?? 0;
			if (r <= 0) {
				positions.set(id, { x: Math.round(offsetX), y: Math.round(offsetY) });
				continue;
			}
			const angle = fan.angles.get(id) as number;
			positions.set(id, {
				x: Math.round(offsetX + (stretch * r * Math.cos(angle))),
				y: Math.round(offsetY + (r * Math.sin(angle)))
			});
		}
		fans.push({ ids: fan.ids, apexId: fan.apexId, width: Math.round(width) });
		cursor += width + fanGap;
	}

	// ⑨ 落位后实测「同档相邻最小间距」（按角度相邻；据此断言不重叠）
	let minGap = Number.POSITIVE_INFINITY;
	for (const fan of spines) {
		const byTier = new Map<number, string[]>();
		for (const id of fan.ids) {
			if (id === fan.apexId)
				continue;
			const tier = tierById.get(id) as number;
			const list = byTier.get(tier) ?? [];
			list.push(id);
			byTier.set(tier, list);
		}
		for (const list of byTier.values()) {
			const sorted = [...list].sort((a, b) => (fan.angles.get(a) as number) - (fan.angles.get(b) as number));
			const pairs: Array<[string, string]> = [];
			for (let i = 1; i < sorted.length; i++)
				pairs.push([sorted[i - 1] as string, sorted[i] as string]);
			// ★ v0.20 整圆：**首尾跨缝对**（接缝两侧实为相邻节点，漏掉会低估拥挤/高估 minGap）
			if (fullCircle && sorted.length > 2)
				pairs.push([sorted[sorted.length - 1] as string, sorted[0] as string]);
			for (const [ida, idb] of pairs) {
				const a = positions.get(ida) as { x: number, y: number };
				const b = positions.get(idb) as { x: number, y: number };
				minGap = Math.min(minGap, Math.hypot(b.x - a.x, b.y - a.y));
			}
		}
	}

	return {
		positions,
		radii,
		tierCounts,
		fans,
		bbox: { width: Math.round(cursor - fanGap + padding), height: Math.round((topExtent - bottomExtent) + (2 * padding)) },
		stretch,
		fanRadius,
		minGap: Number.isFinite(minGap) ? Math.round(minGap * 10) / 10 : 0
	};
}
