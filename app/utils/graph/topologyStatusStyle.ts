// app/utils/graph/topologyStatusStyle.ts
// 状态 → 样式类（**纯函数**）：状态色只来自 Nuxt UI 语义变量，禁止硬编码 hex。
//
// 设计基准：NMCPS-DESIGN-001 §七「状态色来自 `app.config.ts` 的语义色」。
// 三处共用本文件：画布节点 / 画布链路 / 详情栏徽标，避免同一状态在三处出现三种颜色。
import type { TopologyLinkStatus, TopologyNodeStatus } from "~~/shared/types/topology";

/** Nuxt UI 语义色名（`UBadge` / `UIcon` 的 `color` 取值） */
export type StatusColor = "success" | "warning" | "error" | "neutral";

const NODE_FILL: Record<TopologyNodeStatus, string> = {
	online: "fill-(--ui-success)",
	warning: "fill-(--ui-warning)",
	critical: "fill-(--ui-error)",
	offline: "fill-(--ui-text-muted)",
	unknown: "fill-(--ui-text-dimmed)"
};

/**
 * 链路描边类：**一律中性灰、且比正文灰更淡**（2026-11-08 用户两次裁决：「连接线的颜色改为灰色」、
 * 「降低链路颜色的饱和度」）。
 *
 * 旧实现按状态给六种色（绿 / 橙 / 红 / 蓝…），三层叠加后画布上一片彩色，层级反而读不出来；
 * 灰色让「节点层色」成为画面里唯一的彩色信号。灰走 `--topology-link` 而不是写死的 hex：
 * 它由 `--ui-text-muted` 派生出**同亮度、色度 35%** 的一支（定义在 `app/assets/css/main.css`），
 * 浅色 / 深色模式都自动跟随，且永远比节点层色更安静 —— 连线是背景关系，层色才是主角。
 *
 * 状态信息没有丢：`offline` 改用**虚线**（见 `linkDashArray()`），其余状态在链路详情栏、
 * 邻居徽标与 `<title>` 悬停提示里照旧逐字给出 —— 语义由文字承载，不靠色相猜。
 */
const LINK_STROKE: Record<TopologyLinkStatus, string> = {
	online: "stroke-(--topology-link)",
	degraded: "stroke-(--topology-link)",
	congested: "stroke-(--topology-link)",
	switching: "stroke-(--topology-link)",
	offline: "stroke-(--topology-link)",
	unknown: "stroke-(--topology-link)"
};

const NODE_COLOR: Record<TopologyNodeStatus, StatusColor> = {
	online: "success",
	warning: "warning",
	critical: "error",
	offline: "neutral",
	unknown: "neutral"
};

const LINK_COLOR: Record<TopologyLinkStatus, StatusColor> = {
	online: "success",
	degraded: "warning",
	congested: "error",
	switching: "warning",
	offline: "neutral",
	unknown: "neutral"
};

/** 节点填充类（`fill` 走语义变量，深色模式自动跟随） */
export function nodeFillClass(status: TopologyNodeStatus): string {
	return NODE_FILL[status];
}

/** 链路描边类 */
export function linkStrokeClass(status: TopologyLinkStatus): string {
	return LINK_STROKE[status];
}

/**
 * 链路虚线样式：灰色是统一底色，**唯有 `offline` 用虚线**区分「这条线不通」。
 *
 * 为什么不给每种状态各配一种线型：线型种类越多越像「装饰」，而这里只需要回答一个问题 ——
 * 这条链路是不是断的。`undefined` = 实线（SVG 不写 `stroke-dasharray`）。
 */
export function linkDashArray(status: TopologyLinkStatus): string | undefined {
	return status === "offline" ? "6 4" : undefined;
}

/** 节点徽标语义色 */
export function nodeStatusColor(status: TopologyNodeStatus): StatusColor {
	return NODE_COLOR[status];
}

/** 链路徽标语义色 */
export function linkStatusColor(status: TopologyLinkStatus): StatusColor {
	return LINK_COLOR[status];
}

/** 状态文案的 i18n 相对键（`pages.topology-monitor.status.*`） */
export function statusI18nKey(status: TopologyNodeStatus | TopologyLinkStatus): string {
	return `pages.topology-monitor.status.${status}`;
}
