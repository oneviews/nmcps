// layers/scenario/shared/types/labSideTabs.ts
// 实验台右栏的标签页枚举（NMCPS-ADR-0022 D6 / W7）。
//
// 右栏只有一块面板、五个标签页：观测三块（Webshell / 日志 / 监控）由
// `SimulatorNetworkTools` 承接，台账两块（网络 + 详情 / 连通性 + 吞吐）由页面自己渲染。
// 标签页状态放在页面里（`sideTab`），组件只接收「现在是哪一页」——
// 这样 `UTabs` 只有一份，而 WebShell 的多会话仍由同一个组件实例保活（`v-show` 不卸载）。

/** 右栏标签页 */
export type LabSideTab = "webshell" | "logs" | "monitor" | "network" | "connectivity";

/** 需要换票建连的观测通道标签（`SimulatorNetworkTools` 的三种承接对象） */
export type LabObservationTab = Extract<LabSideTab, "webshell" | "logs" | "monitor">;

export const LAB_OBSERVATION_TABS: readonly LabObservationTab[] = ["webshell", "logs", "monitor"];

export function isLabObservationTab(tab: LabSideTab): tab is LabObservationTab {
	return (LAB_OBSERVATION_TABS as readonly string[]).includes(tab);
}
