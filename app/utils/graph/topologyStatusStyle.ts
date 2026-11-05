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

const LINK_STROKE: Record<TopologyLinkStatus, string> = {
	online: "stroke-(--ui-success)/60",
	degraded: "stroke-(--ui-warning)/70",
	congested: "stroke-(--ui-error)/70",
	switching: "stroke-(--ui-info)/70",
	offline: "stroke-(--ui-text-dimmed)",
	unknown: "stroke-(--ui-text-dimmed)/60"
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
