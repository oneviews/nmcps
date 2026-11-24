import { createLabWsRelay } from "#layers/scenario/server/utils/bff/labWsRelay";

/**
 * 抓包实时流：`/mininet-ws/sniffer?ticket=…`（NMCPS-ADR-0022 D6 / W5）。
 *
 * 验票 / 连上游 / 透传 / 审计全在 `createLabWsRelay()`：本文件只钉款式。
 * 票的**签发**（会话 + 权限位 + 台账 + 审计）在 `POST /api/mininet/ws-ticket`，
 * 升级时不二次判权限 —— 票就是那次判定的凭据。
 */
export default createLabWsRelay("sniffer");
