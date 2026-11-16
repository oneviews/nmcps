---
paths:
  - "layers/scenario/**"
  - "packages/mininet-client/**"
  - "layers/scenario/shared/constants/mininetRoutes.ts"
---
# Lab UI

Mininet 实验台是 scenario 层里的一个受限功能区，不是第二个前端应用；页面与 BFF 路由同属 `layers/scenario`。

- 所有后端访问走 `useApi()` 或 `packages/mininet-client`，禁止在页面里写 axios 或硬编码 `http://...:8000`。
- 所有后端访问走 `useApi()` 或 `packages/mininet-client`，禁止在页面里写 axios 或硬编码 `http://...:8000`。
- 写能力位只读会话能力：页面先读 `GET /api/lab/channel` 的 `capabilities`，未授权动作不渲染，也不得先渲染再等 403/405；后端守卫永远是唯一权限边界（403 `lab_permission_denied` / 404 `lab_resource_not_found` / 409 冲突）。
- 拓扑编辑按能力位分档渲染：`create`（新增节点 / 连线）、`delete`（删节点）、`operate`（拖动落库 / OpenFlow / 删链路 / 流表写入）。没有 `operate` 时 `TopologyCanvas` 必须传 `:draggable="false"`，否则拖动会「看起来成功但没落库」。
- WebSocket 统一走同源 `/lab-ws/*`：先用 `POST /api/lab/ws-ticket` 换 60 秒一次性票，再由 BFF 建连转发；组件不直接 `new WebSocket`，也不得向下发上游地址（`NMCPS-ADR-0022` D6）。
- 依赖 Mininet 的页面/画布使用 `client-only`，不在 SSR 阶段访问本地实验服务。
- 组件优先用 Nuxt UI v4 原生组件；沿用现有设计 token，不复制旧 Vite 的样式体系。
- 所有可见文案进 `i18n/locales/{cn,en}.json`，两边 key 与占位符一致。
- 新页面必须声明权限 meta；终端、抓包、reset 默认不显示，除非后端返回对应能力位。
- 租户与权限只信 BFF 会话；页面不得读取或提交 `x-tenant-id`，也不得把 `sim_id` / 节点 ID 当作权限判断依据（NMCPS-ADR-0021）。
- 终端、抓包默认不渲染；`lab:terminal` / `lab:sniffer` 必须单独授权，不能由 `lab:read` / `lab:operate` 推导。
- 仿真网页面是 `/scenario/simulator`（`layers/scenario/app/pages/scenario/simulator.vue`），复用生产 `TopologyCanvas` 展示台账拓扑，不另写一套画布。
- 旧 Vite 前端按 `NMCPS-ADR-0022` 退役：只按能力位重写行为，不复制源码、不复用其样式体系、不双写；复刻验收后即删除，`services/mininet-api` 只留纯后端。
- 依赖 Mininet 的页面/画布使用 `client-only`，不在 SSR 阶段访问本地实验服务。
- 组件优先用 Nuxt UI v4 原生组件；沿用现有设计 token，不复制旧 Vite 的样式体系。
- 所有可见文案进 `i18n/locales/{cn,en}.json`，两边 key 与占位符一致。
- 新页面必须声明权限 meta；终端、抓包、reset 默认不显示，除非后端返回对应能力位。
- 租户与权限只信 BFF 会话；页面不得读取或提交 `x-tenant-id`，也不得把 `sim_id` / 节点 ID 当作权限判断依据（NMCPS-ADR-0021）。
- 终端、抓包默认不渲染；`lab:terminal` / `lab:sniffer` 必须单独授权，不能由 `lab:read` / `lab:operate` 推导。
- 仿真网页面是 `/scenario/simulator`（`layers/scenario/app/pages/scenario/simulator.vue`），复用生产 `TopologyCanvas` 只读展示台账拓扑，不另写一套画布。
