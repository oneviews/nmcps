# Scenario Layer

场景筹划层。除既有的生产拓扑场景编辑外，本层还承载 Mininet 仿真网的只读入口与 BFF 路由。

## 页面

- `/scenario/*`：场景筹划页面。
- `/scenario/simulator`：仿真网只读总览（`app/pages/scenario/simulator.vue`），读取 `/api/lab/networks` 的台账并投影为 `TopologyCanvas`；旧的 `/sim-generation` 仅保留重定向。
- 所有 Mininet 文案在 `i18n/locales/{cn,en}.json` 的 `pages.scenario-simulator.*`。

## 服务端

- `server/api/lab/**`：Mininet 只读 BFF 通道；`/api/lab` 无路径段回 400，其余走 17 条 GET 白名单。
- 路由白名单与上游路径在 `layers/scenario/shared/constants/mininetRoutes.ts`；通道类型在 `layers/scenario/shared/types/mininet.ts`。
- 鉴权、台账、租户实例与出站过滤同层放在 `layers/scenario/server/utils/bff/lab*` / `mininet*.ts`，由本层路由引用；根 `server/` 不再反向依赖场景层。
- `layers/scenario/scripts/check-lab-bff.mjs`：通道自查，复用根 `scripts/lib/bff-harness.mjs`。

## 验证

```bash
pnpm build:server
pnpm check:lab-bff
pnpm check:i18n
pnpm check:ui
pnpm typecheck
```

## 边界

- 浏览器不得直连 Mininet `:8000`，只经 `/api/lab/**`。
- 只读阶段不渲染写操作、终端、抓包入口；`GET /api/lab/channel` 的 `writeEnabled` 恒为 `false`。
- 仿真网页面只做台账拓扑的只读投影，不把 `sim_id` / 节点 ID 当权限凭据。
