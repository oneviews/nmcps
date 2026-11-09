// app/utils/graph/topologyCollapse.ts
// 「收起 / 展开下级」（纯函数，零 DOM、零状态）：`NMCPS-DESIGN-001` §6.15。
//
// 语义照 G6 v5 `collapse-expand` 的**实际案例**搬：被收起的那个元素本身**留在图上**（并带上
// 「已收起」读数），它的下级与「只连着下级的边」一起从画面上消失；展开后一切复原。
// 2.0 的图形自绘（`NMCPS-ADR-0019` D1）没有 G6 引擎，所以这条「隐藏哪些元素」的规则写成纯函数，
// 布局前用它过滤输入 —— 与区域分组折叠（§6.11）走同一条路：**摘掉输入，让几何自己重排**，
// 不造「簇节点」（簇节点要有几何、层级、事实，全是编出来的）。
//
// 「谁是下级」由 `tier` 定向：方向 = 邻居里**严格更靠下**的那一端。这几层图里层级是上游给的实测字段
// （1 核心 / 2 汇聚 / 3 接入 / 4 终端），比「边的方向」可靠 —— 网状顶层（三台核心两两互联）用
// 边方向会互相把对方认成下级，递归一层就停不下来了。
//
// 同档（`tier` 相同）的邻居另有第二条判据：**只有一端「还有上行」时才算方向**（见 `childIndex()`）。
// 现网的 18 台胖 AP 登记成 tier 3，与它们上联的接入交换机同档，只按「严格更靠下」判 ⇒ 接入收走后
// AP 变成了既留在画布上、又不连任何东西的孤点（2026-11-09 用户反馈）。
import type { TopologyGraphLink, TopologyGraphNode } from "~~/shared/types/topology";
import { normalizeTier } from "./topologyNormalize";

/** 收起 / 展开的读模型：布局层直接吃 `nodes` / `links` */
export interface TopologyCollapsePlan {
	/** 仍在图上的节点（被收起的子树已摘掉） */
	nodes: TopologyGraphNode[]
	/** 仍在图上的链路（两端都在 `nodes` 里） */
	links: TopologyGraphLink[]
	/** 节点 id → 直接下级清单（纵向邻居；没有下级的不出现在表里） */
	childIds: Map<string, string[]>
	/** 节点 id → 收起后会遮住的台数（含传递），节点卡片与角标共用这一个数 */
	hiddenCounts: Map<string, number>
	/** 当前被收起遮住的节点总数 */
	hiddenNodes: number
	/** 当前被收起遮住的链路总数 */
	hiddenLinks: number
}

/** 纵向邻居表：`parent → [child…]`，方向由 `tier` 决定（严格更靠下，或同档但只有一端还有上行） */
export function childIndex(
	nodes: readonly TopologyGraphNode[],
	links: readonly TopologyGraphLink[]
): Map<string, string[]> {
	const tierOf = new Map<string, number>();
	for (const node of nodes)
		tierOf.set(node.id, normalizeTier(node.tier));

	// 「还有上行」= 邻接里存在**严格更靠上**的设备（tier 更小）。同档定向只看这一位：
	// 现网胖 AP（tier 3）只连着接入交换机（tier 3）⇒ AP 没有上行、接入有 ⇒ 接入是上级。
	// 两端都有上行（两台都上联汇聚的接入 / 两台都上联核心的汇聚）或都没有时**不认方向**，
	// 与「网状顶层谁也不是谁的下级」同一条理由：不凭空造层级。
	const hasUplink = new Set<string>();
	for (const link of links) {
		const sourceTier = tierOf.get(link.source);
		const targetTier = tierOf.get(link.target);
		if (sourceTier === undefined || targetTier === undefined || sourceTier === targetTier)
			continue;
		hasUplink.add(sourceTier > targetTier ? link.source : link.target);
	}

	const children = new Map<string, string[]>();

	for (const link of links) {
		for (const [parent, child] of [[link.source, link.target], [link.target, link.source]] as const) {
			const parentTier = tierOf.get(parent);
			const childTier = tierOf.get(child);
			if (parentTier === undefined || childTier === undefined)
				continue;
			// 同档 / 更靠上的邻居默认不是下级：网状互连的核心因此谁也不是谁的下级；
			// 同档唯一例外是「上面还有东西」的那一端当上级（2026-11-09，§6.15）。
			const downward = childTier > parentTier
				|| (childTier === parentTier && hasUplink.has(parent) && !hasUplink.has(child));
			if (!downward)
				continue;

			const list = children.get(parent);
			if (!list)
				children.set(parent, [child]);
			else if (!list.includes(child))
				list.push(child);
		}
	}

	return children;
}

/** 一棵子树里除自己以外的全部节点（广度优先，环安全：`seen` 兜住重复访问） */
function descendantsOf(childIds: Map<string, string[]>, id: string): Set<string> {
	const seen = new Set<string>();
	const queue = [...(childIds.get(id) ?? [])];

	while (queue.length > 0) {
		const current = queue.shift();
		if (!current || seen.has(current) || current === id)
			continue;
		seen.add(current);
		queue.push(...(childIds.get(current) ?? []));
	}

	return seen;
}

/**
 * 收起状态 → 布局输入。
 *
 * `collapsedIds` 里认不出的 id（上游删了这台设备 / 它已经没有下级）**自动失效**：
 * 收起是一份本地视图偏好，上游一变就不该再拿着它去藏东西。
 */
export function collapsePlanOf(
	nodes: readonly TopologyGraphNode[],
	links: readonly TopologyGraphLink[],
	collapsedIds: readonly string[]
): TopologyCollapsePlan {
	const childIds = childIndex(nodes, links);

	const hiddenCounts = new Map<string, number>();
	for (const [id, children] of childIds)
		hiddenCounts.set(id, children.length > 0 ? descendantsOf(childIds, id).size : 0);

	const hidden = new Set<string>();
	for (const id of collapsedIds) {
		if (!childIds.get(id)?.length)
			continue;
		for (const descendant of descendantsOf(childIds, id))
			hidden.add(descendant);
	}

	const keptNodes = hidden.size > 0 ? nodes.filter((node) => !hidden.has(node.id)) : [...nodes];
	const keptLinks = hidden.size > 0
		? links.filter((link) => !hidden.has(link.source) && !hidden.has(link.target))
		: [...links];

	return {
		nodes: keptNodes,
		links: keptLinks,
		childIds,
		hiddenCounts,
		hiddenNodes: hidden.size,
		hiddenLinks: links.length - keptLinks.length
	};
}

/** 一键展开所有的可展开读数（页面按钮的禁用态判定用） */
export function hasCollapsible(plan: TopologyCollapsePlan): boolean {
	for (const count of plan.hiddenCounts.values()) {
		if (count > 0)
			return true;
	}
	return false;
}
