import { createLabWsRelay } from "#layers/scenario/server/utils/bff/labWsRelay";

/**
 * 单接口速率监控：`/mininet-ws/monitor?ticket=…&target=<node>:<intf>`（NMCPS-ADR-0022 D6）。
 *
 * 票面 `target` 是 `node:intf` 两段：节点 id 进必填校验，接口名在 `labWsTargetError()`
 * 里只判形状（`:` 恰好一次、无 `/` `\` `|` 与空白）。上游是
 * `ws /api/mininet/monitor?node=…&intf=…`，回 `{ node, intf, ts, tx_gbps, rx_gbps }`。
 *
 * 权限位取 `lab:read`：这是只读采样，和「看运行态 / 看流表」同一档。
 */
export default createLabWsRelay("monitor");
