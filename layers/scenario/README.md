# Scenario Layer

场景筹划层。除既有的生产拓扑场景编辑外，本层还承载 Mininet 仿真网的入口、拓扑编辑与 BFF 路由。

## 页面

- `/scenario/*`：场景筹划页面。
- `/scenario/simulator`：仿真网总览 + 拓扑编辑（`app/pages/scenario/simulator.vue`），读取 `/api/lab/networks` 的台账并投影为 `TopologyCanvas`；旧的 `/sim-generation` 仅保留重定向。
- 编辑动作按 `GET /api/lab/channel` 的能力位分档渲染（NMCPS-ADR-0022 W2）：新增节点（五类）/ 连线用 `create`，删节点用 `delete`，拖动落库 / OpenFlow / 删链路用 `operate`；没有 `operate` 时画布不接收拖动。
- 表单与确认组件在 `app/components/Simulator/`（`NodeFormModal` / `DeleteTargetModal`），校验与请求体组装在 `shared/types/labNodes.ts`（纯函数）。
- 所有 Mininet 文案在 `i18n/locales/{cn,en}.json` 的 `pages.scenario-simulator.*`。
- `scripts/check-ui.mjs` 的 11.3 覆盖只读路径（空台账、正常台账、`/api/lab/networks` 503/403 与刷新恢复、资源清单外节点/链路过滤），11.4 覆盖写路径（能力位渲染、新增 → 请求体 / 画布一致、拖动落成绝对值、删除 + 流表读数、加流 → 请求体与回显一致、删单条流按 dump 行序，以及加流本地校验三条分支 —— 动作必填 / 匹配域夹带 `actions=` / 优先级超 65535 —— 就地报错且零请求）。

## 服务端

- `server/api/lab/**`：Mininet BFF 通道；`/api/lab` 无路径段回 400，其余走 45 条白名单（17 条查询 + 28 条写）。
- 路由白名单与上游路径在 `layers/scenario/shared/constants/mininetRoutes.ts`；通道类型在 `layers/scenario/shared/types/mininet.ts`；节点草稿与请求体映射在 `layers/scenario/shared/types/labNodes.ts`。
- 鉴权、台账、租户实例、审计、串行化锁与出站过滤同层放在 `layers/scenario/server/utils/bff/lab*` / `mininet*.ts`，由本层路由引用；根 `server/` 不再反向依赖场景层。
- `layers/scenario/scripts/check-lab-bff.mjs`：通道自查，复用根 `scripts/lib/bff-harness.mjs`。

## 验证

```bash
pnpm build:server
pnpm check:lab-bff
pnpm check:lab-tenancy
pnpm check:lab-flows
pnpm check:i18n
pnpm check:ui
pnpm typecheck
```

## 边界

- 浏览器不得直连 Mininet `:8000`，只经 `/api/lab/**`。
- 终端、抓包、WebSocket 与导出通道尚未开放（W4 / W5）；`GET /api/lab/channel` 的 `writeEnabled` / `capabilities` 按会话计算，页面先读能力位再渲染。
- 仿真网页面不把 `sim_id` / 节点 ID 当权限凭据；写失败原话（403 / 404 / 409 / 503）照实展示，不做二次解释。
