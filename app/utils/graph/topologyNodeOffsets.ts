// app/utils/graph/topologyNodeOffsets.ts
// 2D 画布「节点手动位移」**纯函数唯一落点**（复刻 1.0 `lib/topologyNodeOffsets.ts`，v0.36 用户规格：
// 「2D 模式下鼠标拖拽」的结果要**保持住**，并提供「恢复默认配置」一键回位）。
//
// 设计要点（与 1.0 同口径，差异只在渲染层）：
//   1. 几何坐标的唯一产生者仍是布局纯函数（`layoutTopology()`，NMCPS-ADR-0019 D1）；
//      手动位移只是**独立增量层**，二者在渲染前合成（`applyNodeOffsets()`）⇒ 30s 轮询 / 状态事件 /
//      容器 resize 触发的重渲染**不会把拖走的节点弹回**；「恢复默认配置」= **清空位移层**，
//      几何基准毫发无损（无需触碰布局库）。
//   2. 位移以「相对几何坐标」的增量记录（`offsetOf()`）而非绝对坐标 ⇒ 画布缩放 / 平移 / 旋转角
//      变化导致几何重算后，位移仍按同一增量叠加。
//   3. `OFFSET_EPSILON` 抖动容差：落点与几何位几乎重合者**不入表**，避免「点一下即留下脏位移」——
//      否则「恢复默认配置」按钮会一直亮着、永远关不掉。
//   4. 本模块**无副作用、不可变**（`setNodeOffset()` 返回新表）⇒ 调用方整体替换引用即可。
//   5. 残留条目口径：节点已不在图里（id 消失）时该条目不参与合成（几何表没有这个 id），
//      属无害残留 —— 由「恢复默认配置」一并清空；不为此引入「随数据修剪」的耦合（与 1.0 一致）。
//
// 1.0 的 `resolvePosition()`（几何表 + id → 最终落点）在 2.0 换成 `applyNodeOffsets()`：
// 1.0 需要它是因为 G6 的位置模型读 `datum.style.x/y`（视觉坐标与拖拽基准必须同源，1.0 文件头第 6 条）；
// 2.0 自绘 SVG 没有第二套坐标模型，一份「几何 + 增量 → 落点」就够。
import type { PositionedTopologyNode } from "~~/app/utils/graph/topologyLayout";

/** 二维点（与布局库的坐标同口径，单位 = viewBox 用户单位） */
export interface Point2D {
	x: number
	y: number
}

/** 单台节点的位移增量（px，相对几何坐标） */
export interface NodeOffset {
	dx: number
	dy: number
}

/** 位移表：节点 id → 位移增量（**只读**，写入一律走 `setNodeOffset()`） */
export type NodeOffsetMap = Readonly<Record<string, NodeOffset>>;

/** 位移抖动容差（px）：横纵**都**小于该值 ⇒ 视为「未移动」 */
export const OFFSET_EPSILON = 0.5;

/** 落点与几何位之差 → 位移增量 */
export function offsetOf(current: Point2D, base: Point2D): NodeOffset {
	return { dx: current.x - base.x, dy: current.y - base.y };
}

/** 位移是否可忽略（`|dx| < ε` 且 `|dy| < ε`） */
export function isNegligibleOffset(offset: NodeOffset): boolean {
	return Math.abs(offset.dx) < OFFSET_EPSILON && Math.abs(offset.dy) < OFFSET_EPSILON;
}

/** 几何坐标 + 位移增量 → 最终落点（无位移 ⇒ 原几何坐标） */
export function shiftPosition(base: Point2D, offset?: NodeOffset): Point2D {
	if (!offset)
		return { x: base.x, y: base.y };
	return { x: base.x + offset.dx, y: base.y + offset.dy };
}

/**
 * 几何坐标表 + 位移表 → **最终落点表**（渲染层唯一合成口径）。
 *
 * 返回新数组（不改入参）：链路端点也读这张表，所以「连线跟着节点走」是自动的。
 */
export function applyNodeOffsets(
	nodes: readonly PositionedTopologyNode[],
	offsets: NodeOffsetMap
): PositionedTopologyNode[] {
	return nodes.map((item) => {
		const offset = offsets[item.id];
		if (!offset)
			return item;
		const { x, y } = shiftPosition(item, offset);
		return { ...item, x, y };
	});
}

/** 不可变写入：位移可忽略 ⇒ 等同**删除**该 id（返回新表；原表不被修改） */
export function setNodeOffset(map: NodeOffsetMap, id: string, offset: NodeOffset): NodeOffsetMap {
	const next: Record<string, NodeOffset> = { ...map };
	if (isNegligibleOffset(offset))
		delete next[id];
	else
		next[id] = offset;
	return next;
}

/** 清空位移表（= 「恢复默认配置」的位移部分） */
export function clearNodeOffsets(): NodeOffsetMap {
	return {};
}

/** 位移表条目数（供 UI 禁用态判定） */
export function countNodeOffsets(map: NodeOffsetMap): number {
	return Object.keys(map).length;
}
