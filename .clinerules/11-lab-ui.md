---
paths:
  - "layers/scenario/**"
  - "packages/mininet-client/**"
  - "layers/scenario/shared/constants/mininetRoutes.ts"
---
# Lab UI

Mininet 实验台是 scenario 层里的一个受限功能区，不是第二个前端应用；页面与 BFF 路由同属 `layers/scenario`。

- 所有后端访问走 `useApi()` 或 `packages/mininet-client`，禁止在页面里写 axios 或硬编码 `http://...:8000`。
- 只读阶段只有 `/api/lab/**` 的 GET 查询；写按钮不得先渲染再等 405，`GET /api/lab/channel` 的 `writeEnabled` 恒为 `false`。
- WebSocket 统一走同源 `/lab-ws/*`，由 BFF/反代签票转发；组件不直接 `new WebSocket`。
- 依赖 Mininet 的页面/画布使用 `client-only`，不在 SSR 阶段访问本地实验服务。
- 组件优先用 Nuxt UI v4 原生组件；沿用现有设计 token，不复制旧 Vite 的样式体系。
- 所有可见文案进 `i18n/locales/{cn,en}.json`，两边 key 与占位符一致。
- 新页面必须声明权限 meta；终端、抓包、reset 默认不显示，除非后端返回对应能力位。
- 租户与权限只信 BFF 会话；页面不得读取或提交 `x-tenant-id`，也不得把 `sim_id` / 节点 ID 当作权限判断依据（NMCPS-ADR-0021）。
- 终端、抓包默认不渲染；`lab:terminal` / `lab:sniffer` 必须单独授权，不能由 `lab:read` / `lab:operate` 推导。
- 仿真网页面是 `/scenario/simulator`（`layers/scenario/app/pages/scenario/simulator.vue`），复用生产 `TopologyCanvas` 只读展示台账拓扑，不另写一套画布。
