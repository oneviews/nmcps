# AI 任务配方

每个配方都从**仓库根目录**执行。先读 `docs/ai/repo-map.md`，再按影响面顺序改。

## 新增/修改 Mininet REST 接口

1. 改 `services/mininet-api/mininet_gui_backend/api.py` 与 `schema.py`。
2. 运行 `pnpm lab:check`，确认后端可导入、路由存在。
3. 运行 `pnpm contracts:gen` 刷新 `packages/contracts/openapi/mininet.json`。
4. 在 `layers/scenario/shared/constants/mininetRoutes.ts` 增加逐端点白名单；只读阶段只加 `GET`，写端点不得登记。
5. 更新 `packages/mininet-client` 的调用与类型（尚未创建时先落最小客户端）。
6. 更新 `layers/scenario` 页面/composable，禁止直连 `:8000`。
7. 跑 `pnpm contracts:check && pnpm build:server && pnpm check:lab-bff && pnpm lint && pnpm typecheck`。

## 新增 Lab 页面

1. 在 `layers/scenario/app/pages/scenario/` 建页面，路由沿用 `/scenario/*`；仿真网只读页是 `simulator.vue`。
2. 文案写进 `i18n/locales/{cn,en}.json`，两边 key 一致。
3. 通过 `useApi()` 或 `mininet-client` 取数，不写 axios。
4. 页面数据加载用 `client-only`，避免 SSR 访问本地实验服务。
5. 跑 `pnpm check:i18n && pnpm lint && pnpm typecheck`。

## 修改 WebSocket

1. 改 `services/mininet-api` 的 WS 处理逻辑。
2. 同步 BFF/反代路由与 ticket 校验。
3. 改 `packages/mininet-client` 的连接、重连、错误归一。
4. 在 `layers/scenario` 用 composable 消费，不在组件里 new WebSocket。
5. 手动验证：断网重连、后端重启、页面切换、权限过期。

## 排查 BFF 502 / WS 断连

1. `pnpm lab:check` 确认后端可导入。
2. `curl http://127.0.0.1:8000/api/health` 确认服务活着。
3. 检查 `NUXT_MININET_INSTANCES` 是否为当前租户配置实例、是否被防火墙拦截；`GET /api/lab/channel` 的 `configured` 是否为 `true`。
4. 检查 BFF 白名单是否包含该 path；只读阶段 method 必须是 `GET`。
5. WS 额外检查反向代理的 Upgrade 头、ticket 是否过期。

## 迁移旧 Vite 页面

1. 只迁移交互和业务规则，不整文件复制。
2. 把状态与 API 调用抽成 `layers/scenario/app/composables/`。
3. 把画布交互拆成独立组件，图表库保持 `client-only`。
4. 旧实现作为行为参考，迁完一个页面就标记 parity，不长期双写。
