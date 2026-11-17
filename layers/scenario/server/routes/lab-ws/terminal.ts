import { createLabWsRelay } from "#layers/scenario/server/utils/bff/labWsRelay";

/**
 * Webshell：`/lab-ws/terminal?ticket=…&target=<node>`（NMCPS-ADR-0022 D6）。
 *
 * 与其余三条通道的唯一差别是**上行**：终端要把浏览器敲的键转发给上游 PTY
 * （`clientToUpstream: true`）。上游是 `ws /api/mininet/terminal/{node_id}`，
 * 节点 id 由 `labWsUpstreamPath()` 拼进路径段并逐段编码。
 *
 * 权限位 `lab:terminal` 单独授予，不能由 `lab:read` / `lab:operate` 推导。
 */
export default createLabWsRelay("terminal");
