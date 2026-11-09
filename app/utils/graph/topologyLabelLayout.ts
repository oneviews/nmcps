// app/utils/graph/topologyLabelLayout.ts
// 节点名称标签的**避让计划**（纯函数、零 DOM）：一行里放不放得下、要不要错行、要不要截断。
//
// 为什么需要它：dagre 只保证「节点圆」不重叠（`nodesep = 80`），而名称标签比圆宽得多 ——
// 塔型最宽层有 21 台接入时每台只有 80px 可用，「接入交换机-24」这类标签约 90px，相邻标签
// 会挤在一起互相压字（1.0 的做法是让用户自己滚轮放大，放大后整层又跑出视口）。2.0 只做一件事：
//   · 放得下（`width ≤ spacing − LABEL_GUTTER`）⇒ 单行原样；
//   · 放不下 ⇒ **隔一个抬一行**（奇偶分两条基线，相邻标签不再共享同一行 ⇒ 可用宽度翻倍）。
//
// **不截断**（2026-11-09 用户裁决）：画布上出现「汇聚交换机…」这种带省略号的半截名字，
// 读者拿它去对台账会认错设备；宁可错行、宁可略挤，也不丢字。字号同时从 11px 收到 10px，
// 最小间距（`TIER_TREE_MIN_NODE_GAP = 74`）下「无线终端设备-01」（10px 下 ≈ 77px）错行后
// 可用宽度 140px，仍然放得下 ⇒ 常规规模下既不错行丢字、也不压字。
// ★ 2026-11-09 第二轮裁决：**字号不再逐布局变**（两种布局同一个 10px），变的是**方向** ——
// 径向扇的标签朝「背离圆心」一侧落位（见 `topologyLayout.ts` 的 `labelDirDx`），
// 间距统一成 `半径 + LABEL_GAP + 错行档高`，于是每一台的标签都贴在自己的圆外侧同一处。
//
// 为什么在布局层算、而不是在画布里量：SVG 里量文本要等渲染后 `getBBox()`，既拿不到确定性
// 数值也无法单测。名称本来就是「中文按全角、拉丁按半角」的固定估算，留 6px 余量足够可靠。

/** 标签字号（px，画布逻辑单位；与 `TopologyCanvas` 的 `text-[10px]` 同值；**两种布局同一个字号**） */
export const LABEL_FONT_SIZE = 10;

/** 相邻标签之间至少留的空隙（px；含一点视觉呼吸，避免「勉强贴着」） */
export const LABEL_GUTTER = 6;

/** 错行时两条基线的高度差（px；略大于字号，保证上下两行不粘连） */
export const LABEL_LINE_HEIGHT = 11;

/**
 * 标签中心与节点圆边之间的距离（px）：两种布局共用**同一个值**。
 *
 * 「与节点的相对位置统一」就是这一条：方向由布局给（扇形背离圆心、树形朝下），
 * 间距恒为「半径 + 本值 + 错行档高」⇒ 每一台的标签都贴在自己的圆外侧同一处。
 */
export const LABEL_GAP = 12;

/** 单个标签的避让结果 */
export interface LabelPlan {
	/** 基线档位：0 = 第一条基线，1 = 抬高一行（奇数下标用） */
	shift: 0 | 1
}

/**
 * 全角字符判定（中文 / 日文假名 / 韩文 / 全角标点）：这些字符的字形宽度 ≈ 字号。
 * 拉丁字母、数字、半角标点约为字号的 0.56 倍 —— 与 11px 下的实测宽度同量级。
 */
const WIDE_CHAR = /[\u1100-\u115F\u2E80-\uA4CF\uA960-\uA97F\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/;

/** 估算文本宽度（px，画布逻辑单位）：全角按 1.0 × 字号、半角按 0.56 × 字号、空格按 0.28 × 字号 */
export function estimateTextWidth(text: string): number {
	let width = 0;
	for (const char of text) {
		if (char === " ")
			width += LABEL_FONT_SIZE * 0.28;
		else if (WIDE_CHAR.test(char))
			width += LABEL_FONT_SIZE;
		else
			width += LABEL_FONT_SIZE * 0.56;
	}
	return Math.round(width * 10) / 10;
}

/**
 * 单行标签规划：`names` 是自左向右的节点名称，`spacing` 是该行最小的相邻圆心间距（px）。
 *
 * `spacing` 传 `Number.POSITIVE_INFINITY`（行内只有一台）时一律单行原样。
 * 只要行内有任何一个标签放不下，**整行**按奇偶错行 —— 只抬一半会留下「抬了的压没抬的」。
 * 输出只有基线档位：文本恒为原名（不截断，见文件头）。
 */
export function planLabelRow(names: readonly string[], spacing: number): LabelPlan[] {
	const gap = Number.isFinite(spacing) ? Math.max(1, spacing) : Number.POSITIVE_INFINITY;
	const single = gap - LABEL_GUTTER;

	if (!names.some((name) => estimateTextWidth(name) > single))
		return names.map(() => ({ shift: 0 as const }));

	return names.map((_, index) => ({ shift: (index % 2) as 0 | 1 }));
}
