// app/utils/graph/topologyHighlight.ts
// 选中节点的**关联高亮**（纯函数，零 DOM）：选中一台设备时，与它直连的链路一起被点名。
//
// 语义对照（`NMCPS-DESIGN-001` §6.15）：G6 v5 里这是 `click-select` + 关联激活（`hover-activate`
// 把 `active` 状态同步给相邻节点与边）的组合效果。2.0 的图形自绘（`NMCPS-ADR-0019` D1）没有
// G6 引擎，所以按**同一套语义**自己算「谁和谁有关」，而不是在模板里写 `links.filter(...)`：
// 画布只负责按 key 上样式，判定留在可单测的纯函数里。
import type { TopologyGraphLink } from "~~/shared/types/topology";
import { topologyLinkKey } from "./topologyNormalize";

/** 一次高亮的读模型：画布按这张表决定给谁上强调样式 */
export interface TopologyHighlight {
	/** 被选中的节点 id（`null` = 没有选中） */
	selectedId: string | null
	/** 关联链路的 key（`topologyLinkKey()`，与点选链路用的是同一把尺） */
	linkKeys: ReadonlySet<string>
	/** 一跳邻居的节点 id（不含选中节点自己） */
	neighborIds: ReadonlySet<string>
}

const EMPTY_HIGHLIGHT: TopologyHighlight = {
	selectedId: null,
	linkKeys: new Set(),
	neighborIds: new Set()
};

/**
 * 选中节点 → 关联的链路 / 邻居。
 *
 * 只算**一跳**：拓扑里「和它有关」就是直连的那几条边，二跳会让整张图都亮起来，等于没高亮。
 * 自环（`source === target`）算关联链路但不把自己当邻居（否则「邻居」里会出现自己）。
 */
export function highlightOf(
	links: readonly TopologyGraphLink[],
	selectedId: string | null | undefined
): TopologyHighlight {
	if (!selectedId)
		return EMPTY_HIGHLIGHT;

	const linkKeys = new Set<string>();
	const neighborIds = new Set<string>();

	links.forEach((link, index) => {
		const incident = link.source === selectedId || link.target === selectedId;
		if (!incident)
			return;

		linkKeys.add(topologyLinkKey(link, index));

		const other = link.source === selectedId ? link.target : link.source;
		if (other !== selectedId)
			neighborIds.add(other);
	});

	return { selectedId, linkKeys, neighborIds };
}
