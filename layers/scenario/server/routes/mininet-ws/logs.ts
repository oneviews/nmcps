import { createLabWsRelay } from "#layers/scenario/server/utils/bff/labWsRelay";

/**
 * 上游日志流：`/mininet-ws/logs?ticket=…`（NMCPS-ADR-0022 D6）。
 *
 * 上游是 `ws /api/mininet/logs`（`tail -f mininet.log` 的逐行文本）。日志面向整台上游、
 * 没有单目标，票面 `target` 必须为空 —— 带目标一律 400，不做「忽略即可」的宽容。
 *
 * 权限位取 `lab:read`：日志是只读观测面，不含终端 / 抓包那种可执行能力。
 */
export default createLabWsRelay("logs");
