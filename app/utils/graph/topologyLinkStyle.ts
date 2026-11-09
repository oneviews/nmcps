// app/utils/graph/topologyLinkStyle.ts
// 链路**样式读表**（纯函数，零 DOM）：线宽来自带宽、线型来自介质与状态、强调只改粗细不改色。
//
// 设计基准：`NMCPS-DESIGN-001` §6.15（2026-11-08 用户对画布的整体裁决）。三条口径：
//   ① **粗细表达带宽**（要求 3）：带宽越大线越粗 —— 画布上一眼能分出「干线」与「接入线」；
//      带宽缺失 / `0`（= 上游缺真值，见 `topologyLinkFacts.ts` 文件头）落最低一档，
//      绝不因为「不知道」就画成最细或最粗；
//   ② **无线链路画虚线**（要求 4）：`medium` / `linkType` 任一指向无线（`wifi5` / `wireless` …）
//      即用细密虚线，「这条线是空口」这件事不靠悬停才知道；
//   ③ **强调只加外延、不改本体宽度**（要求 1 / 2）：选中节点时它的关联链路，以及被点中的那条链路，
//      粗细仍只读带宽；关联链路连颜色也不动（仍是那一档中性灰），只在同一个 `d` 上叠一条同色相的
//      淡外延环 —— 换色会让「灰 = 连接关系」这条唯一色义失效，加粗会让「粗细 = 带宽」失效。
//      唯一的例外是**被点中的那一条**：它的本体改成 `primary`（2026-11-09 用户裁决「选中链路改主色」），
//      外延环随之收窄 +5；这一条是用户显式点的「当前项」，用主色说「就是这条」比一层灰外延更直接。
//
// 优先级（同时成立时的取舍，写死在 `linkDashPatternOf()` 里）：`offline` 的粗虚线优先于无线的
// 细密虚线 —— 「断了」比「这是空口」更值得先说，而两者都是虚线，无线那一条的信息没有丢。
import type { TopologyGraphLink } from "~~/shared/types/topology";
import { bandwidthMbps, linkIsWireless } from "./topologyLinkFacts";
import { normalizeLinkStatus } from "./topologyNormalize";
import { linkDashArray } from "./topologyStatusStyle";

/** 链路强调档位：`selected` = 被点中的那条；`incident` = 与选中节点直连 */
export type LinkEmphasis = "none" | "incident" | "selected";

/**
 * 线宽分档（画布用户单位）。四档够用：`1.5` 基础 / `2` 百兆~1G / `2.5` 1G~10G / `3` 10G 以上。
 *
 * 不做连续映射（`log10` 曲线）：48 条链路里带宽跨三个数量级，连续映射会让 100M 与 1G 差
 * 0.3px —— 肉眼看不出，等于没表达。
 */
const BANDWIDTH_WIDTHS = {
	unknown: 1.5,
	subGigabit: 2,
	subTenGigabit: 2.5,
	tenGigabit: 3
} as const;

/**
 * 强调的**外延环**增量（画布用户单位）：关联链路 +6、被点中的链路 +5。
 *
 * 「强调」不靠加粗可见线（2026-11-08 用户裁决第 2 条）：加粗会与「粗细读带宽」打架 ——
 * 被点中的 1.5px 接入线一旦涨到 4px，读者就分不清它是干线还是被选中。改成在同一个 `d` 上
 * 叠一条**低不透明度**的宽描边（外延），本体宽度一动不动，带宽语义完整保留。
 *
 * 选中那条更细（+5 < +6）：它的本体已经换成 `primary`（见 `TopologyCanvas` 的
 * `linkBodyClass()`）—— 颜色先把「就是这条」说清了，外延环只剩一圈柔光，
 * 再给 +9 就成了两重强调，选中线反而比连线成片的邻居更抢眼（2026-11-09 用户裁决
 * 「选中链路改成主色、光晕细一点」）。
 */
const HALO_BUMP: Record<Exclude<LinkEmphasis, "none">, number> = {
	incident: 6,
	selected: 5
};

/**
 * 外延环的不透明度：关联一档亮到「一眼看出这条线连着谁」（2026-11-09 用户裁决
 * 「与选中节点的层色连线」—— 16% 压在画布上几乎看不见颜色，等于没染色），
 * 选中一档再实一点（主色柔光），两者都仍是外延、不动本体宽度。
 */
const HALO_OPACITY: Record<LinkEmphasis, number> = {
	none: 0,
	incident: 0.3,
	selected: 0.35
};

/** 无线链路的细密虚线（空口的「射频感」：短促）；断链仍用 `topologyStatusStyle` 的 `6 4` */
const WIRELESS_DASH = "2 3";

/** 带宽（Mbps）→ 基础线宽 */
function baseWidthOf(link: TopologyGraphLink): number {
	const mbps = bandwidthMbps(link.bandwidth);
	if (mbps === null)
		return BANDWIDTH_WIDTHS.unknown;
	if (mbps >= 10_000)
		return BANDWIDTH_WIDTHS.tenGigabit;
	if (mbps >= 1_000)
		return BANDWIDTH_WIDTHS.subTenGigabit;
	return BANDWIDTH_WIDTHS.subGigabit;
}

/**
 * 链路描边宽度：**只读带宽**（强调不改粗细，见 `HALO_BUMP` 的说明）。
 *
 * 用户要的是「粗细读带宽」与「强调不破坏这个读数」两件事同时成立，所以强调搬到外延环上：
 * 本体宽度恒定，选中与否都不影响「干线比接入线粗」这条读数。
 */
export function linkStrokeWidthOf(link: TopologyGraphLink | undefined | null): number {
	if (!link)
		return BANDWIDTH_WIDTHS.unknown;
	return baseWidthOf(link);
}

/**
 * 强调时叠在同一个 `d` 上的外延环宽度（`0` = 不画），永远比本体宽，但不动本体。
 * 用 `stroke-opacity` 压在画布底色上得到「同色相、低饱和」的一圈，不引入新色相。
 */
export function linkHaloWidthOf(link: TopologyGraphLink | undefined | null, emphasis: LinkEmphasis): number {
	if (!link || emphasis === "none")
		return 0;
	return baseWidthOf(link) + HALO_BUMP[emphasis];
}

/** 外延环的不透明度（`0` = 不画；模板据此决定挂不挂这条 `path`） */
export function linkHaloOpacityOf(emphasis: LinkEmphasis): number {
	return HALO_OPACITY[emphasis];
}

/**
 * 链路虚线模式：`offline` → `6 4`（粗虚线，断了）> 无线 → `2 3`（细密虚线，空口）> `undefined`（实线）。
 *
 * `undefined` 让模板不写 `stroke-dasharray`（SVG 里「没写」与「`none`」等价，但少一个属性就少一次
 * 与 `getComputedStyle` 的字符串比对歧义）。
 */
export function linkDashPatternOf(link: TopologyGraphLink | undefined | null): string | undefined {
	if (!link)
		return undefined;
	const offline = linkDashArray(normalizeLinkStatus(link.status));
	if (offline)
		return offline;
	return linkIsWireless(link) ? WIRELESS_DASH : undefined;
}

/** 空口链路用的虚线模式（自检与文档引用同一常量，不在断言里重抄字符串） */
export const WIRELESS_DASH_PATTERN = WIRELESS_DASH;
