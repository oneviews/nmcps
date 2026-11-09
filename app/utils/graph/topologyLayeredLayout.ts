// app/utils/graph/topologyLayeredLayout.ts
// **层序归约**（rank resolution）的几何基座（纯函数、零 I/O、零状态）。
//
// 本模块原先还给出「分层 = 塔型」的坐标（1.0 `dagre` 等价：交叉最小化 + 逐层压实）。
// 2026-11-09 用户裁决把布局词表收窄成**径向扇 / 层级树**两档（`topologyLayout.ts` 的
// `TOPOLOGY_LAYOUT_MODES`），塔型的几何与它的 `dagre` 参数（`ranksep 150 / nodesep 80`）
// 一起下线 —— 留一段没人能选到的几何就是给下一个人留坑，所以这里只保留**两种布局共用**的
// 「谁在第几层」：`tier` 分带 → 根节点选举（上提）→ 无下级节点下移（下沉）。
//
// 为什么层序归约留在这个模块、而不是塞进某一种布局里：它回答的是「谁在谁上面」，那是**图的
// 语义**，不是某一种几何的私事。径向扇读它当「第几环」、层级树读它当「第几行」，两种布局
// 因此共用同一份层级；否则「换个布局看」会变成「换个事实看」。
//
// 设计要点：
//   1. 规则只改「谁落在第几层」，不改 `tier`：角色 / 层色仍按 `tier` 取
//      （唯一例外是叶子一律归位终端层，见 `LEAF_TIER`）；
//   2. 根节点选举只在**顶层多于一台**时启动：顶层内部关系等价（全互联 / 网状）⇒ 边表达不了
//      上下，只能看命名约定（`LAYERED_ROOT_KEYWORDS`）；没有一台命中就不选举，绝不靠 id 猜；
//   3. 叶子下移**迭代到不动点**（下移可能让它上一层也变成叶子），每轮收掉空层 ⇒ 层序连续；
//   4. 确定性：内部统一收敛（去重 / tier 收窄 / id 升序 / 并列按 id 断），结果与入参顺序无关；
//   5. 无依赖（不引入 DOM / 不引第三方布局库）⇒ 可直接单测。

/** 二维点（画布坐标口径） */
export interface LayeredPoint {
	x: number
	y: number
}

/** 参与布局的节点（只需要 id + 环号；环号缺失 / 非法按 `fallbackTier` 收窄） */
export interface LayeredNode {
	id: string
	tier: number
	/** 设备名（只用于根节点选举的名称判据；缺省按 `id` 参与匹配） */
	name?: string
}

/** 参与布局的边（无向；自环与悬挂边忽略） */
export interface LayeredEdge {
	source: string
	target: string
}

/** 选项（全部可选；缺省走本文件唯一源常量） */
export interface LayeredOptions {
	/** 非法 / 缺失 tier 的兜底环号（与 `normalizeTier()` 兜底一致） */
	fallbackTier?: number
}

/** 层序归约的结果（`rankOf` 之外的两条审计信息） */
export interface LayeredRanking {
	rankOf: Map<string, number>
	rankCount: number
	rootId: string | null
	demotedIds: string[]
}

/** 非法 / 缺失 tier 的兜底环号（与 `normalizeTier()` 的中间层兜底同值） */
export const LAYERED_FALLBACK_TIER = 3;

/**
 * 根节点选举的**名称判据**（`NMCPS-DESIGN-001` §6.8）。
 *
 * 为什么需要选举：同 tier 的设备之间**图关系是等价的**（核心之间常常是全互联 / 网状，
 * 边无法表达「谁在谁上面」），因此层级只能来自**命名约定**——现场把「网控中心 / 管理中心」
 * 这类设备放在塔尖。命中即得分（取命中的最长关键词长度），未命中不得分。
 *
 * 加词条的口径：宁可少加也不要误伤——`中心` 已覆盖「网控中心 / 监控中心 / 数据中心」，
 * 所以不再单列 `网控` 的变体；拉丁词一律小写匹配（`center` / `centre` / `manager`…）。
 */
export const LAYERED_ROOT_KEYWORDS: readonly string[] = [
	"网控",
	"控制中心",
	"管理中心",
	"管理平台",
	"管理服务器",
	"中心",
	"manager",
	"controller",
	"management",
	"mgmt",
	"center",
	"centre",
	"nms"
];

/** 名称的根节点得分：命中的最长关键词长度（未命中 0） */
function rootScore(name: string): number {
	const lower = name.toLowerCase();
	let score = 0;
	for (const keyword of LAYERED_ROOT_KEYWORDS) {
		if (lower.includes(keyword) && keyword.length > score)
			score = keyword.length;
	}
	return score;
}

/** 按层带构造「id → 层序」 */
function rankMapOf(bands: readonly (readonly string[])[]): Map<string, number> {
	const rankOf = new Map<string, number>();
	bands.forEach((band, rank) => {
		for (const id of band)
			rankOf.set(id, rank);
	});
	return rankOf;
}

/**
 * 层序归约：`tier` 分带 → **根节点选举（上提）** → **无下级节点下移（下沉）**。
 *
 * 两条规则都只改「谁落在第几行」，不改 `tier`（角色按 `roleOfNode()` 取：`tier` 决定层色，
 * 唯一例外是叶子一律归位终端层，见 `LEAF_TIER`）：
 *
 * ① **根节点选举**（要求顶层多于一台）：顶层内部关系等价 ⇒ 用名称判据挑一台当根，
 *    单独提到它自己的一层。没有一台命中判据时**不选举**（保留平顶，绝不靠 id / 度数猜）。
 *    顶层只有一台时它本来就是塔尖，无需选举。
 * ② **叶子下移**：没有「下一级节点」（严格更靠下的邻居）的节点，本来就不该占着中间层 ——
 *    它下面是空的，读者会误以为「层级没画对」。这类节点一律下移到**末层**（与终端同排），
 *    并因此在画布上读作终端层（`LEAF_TIER`）；顶带上除**选举出的根**之外的叶子同样参与
 *    （平顶三台接入都没下级时，三台都是末端，留一台在塔尖才是错的），末带不参与（已经在最底）。
 *    下移可能让上一层也变成叶子，因此**迭代到不动点**，每轮把空的层带收掉（层序必须连续）。
 */
export function resolveLayeredRanks(
	nodes: readonly LayeredNode[],
	edges: readonly LayeredEdge[],
	options: LayeredOptions = {}
): LayeredRanking {
	const fallbackTier = options.fallbackTier ?? LAYERED_FALLBACK_TIER;
	const tierById = new Map<string, number>();
	const nameById = new Map<string, string>();
	for (const node of nodes) {
		if (!node.id || tierById.has(node.id))
			continue;
		tierById.set(node.id, tierOf(node, fallbackTier));
		nameById.set(node.id, (node.name ?? "").trim() || node.id);
	}
	return rankFields([...tierById.keys()].sort(), tierById, nameById, edges);
}

/** `resolveLayeredRanks()` 的内部实现（`computeLayeredPositions()` 复用同一份收敛后的入参） */
function rankFields(
	ids: readonly string[],
	tierById: ReadonlyMap<string, number>,
	nameById: ReadonlyMap<string, string>,
	edges: readonly LayeredEdge[]
): LayeredRanking {
	if (ids.length === 0)
		return { rankOf: new Map(), rankCount: 0, rootId: null, demotedIds: [] };

	const idSet = new Set(ids);
	const neighborOf = new Map<string, Set<string>>();
	for (const id of ids)
		neighborOf.set(id, new Set<string>());
	for (const edge of edges) {
		if (!edge.source || !edge.target || edge.source === edge.target)
			continue;
		if (!idSet.has(edge.source) || !idSet.has(edge.target))
			continue;
		(neighborOf.get(edge.source) as Set<string>).add(edge.target);
		(neighborOf.get(edge.target) as Set<string>).add(edge.source);
	}

	// ① tier 分带（升序 = 自上而下；带内 id 升序，与入参顺序无关）
	const bands: string[][] = [...new Set(ids.map((id) => tierById.get(id) as number))]
		.sort((a, b) => a - b)
		.map((tier) => ids.filter((id) => tierById.get(id) === tier));

	// ② 根节点选举：名称判据得分高者当选；同分先看度数（连接多的是枢纽），再按 id 断（确定性）
	const top = bands[0] as string[];
	let rootId: string | null = null;
	if (top.length > 1) {
		const scored = top
			.map((id) => ({ id, score: rootScore(nameById.get(id) ?? id) }))
			.filter((item) => item.score > 0)
			.sort((a, b) =>
				b.score - a.score
				|| (neighborOf.get(b.id)?.size ?? 0) - (neighborOf.get(a.id)?.size ?? 0)
				|| a.id.localeCompare(b.id));
		rootId = scored[0]?.id ?? null;
	}
	if (rootId) {
		bands[0] = top.filter((id) => id !== rootId);
		bands.unshift([rootId]);
	}

	// ③ 叶子下移：迭代到不动点（下移只会让节点更深，因此必收敛）
	//    图里一条边都没有时不参与：那时「谁是叶子」无从谈起，硬下移会把整张图压成一行终端。
	const demotedIds: string[] = [];
	const hasAnyEdge = [...neighborOf.values()].some((neighbors) => neighbors.size > 0);
	for (;;) {
		if (!hasAnyEdge)
			break;
		const last = bands.length - 1;
		const rankOf = rankMapOf(bands);
		let moved = false;
		for (let row = 0; row < last; row++) {
			// 塔尖那台（选举出的根）不参与：它本来就是入口，下移会把入口拽到最底
			if (row === 0 && bands[0]?.length === 1 && bands[0]?.[0] === rootId)
				continue;
			const keep: string[] = [];
			for (const id of bands[row] as string[]) {
				const hasLower = [...(neighborOf.get(id) ?? [])]
					.some((neighbor) => (rankOf.get(neighbor) ?? -1) > row);
				if (hasLower) {
					keep.push(id);
				} else {
					(bands[last] as string[]).push(id);
					demotedIds.push(id);
					moved = true;
				}
			}
			bands[row] = keep;
		}
		if (!moved)
			break;
		// 收掉空层（层序必须连续，否则 y 会按空层留出一道缝）；顶带变空时整带去掉，
		// 但**最后一条带必须留下**（全部节点都被下移到底时它就是唯一那一行）
		for (let row = bands.length - 1; row > 0; row--) {
			if ((bands[row] as string[]).length === 0)
				bands.splice(row, 1);
		}
		if (bands.length > 1 && (bands[0] as string[]).length === 0)
			bands.shift();
	}

	for (const band of bands)
		band.sort((a, b) => a.localeCompare(b));

	return {
		rankOf: rankMapOf(bands),
		rankCount: bands.length,
		rootId,
		demotedIds: demotedIds.sort((a, b) => a.localeCompare(b))
	};
}

/** 环号收窄：有限且 ≥ 0 取整，否则兜底 */
function tierOf(node: LayeredNode, fallback: number): number {
	const tier = Number(node.tier);
	return Number.isFinite(tier) && tier >= 0 ? Math.floor(tier) : fallback;
}
