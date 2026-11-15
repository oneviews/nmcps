# @nmcps/contracts

跨 Nuxt BFF、Lab UI 和测试共享的 **生成契约**，不是手写业务代码。

## 权威来源

- OpenAPI 快照：`openapi/mininet.json`
- 生成器：`scripts/gen-mininet-contracts.py`
- 上游实现：`services/mininet-api/mininet_gui_backend/api.py`
- 生成命令：`pnpm contracts:gen`
- 过期守卫：`pnpm contracts:check`

修改 Mininet 后端的路由或 Pydantic schema 后，必须重新生成快照。CI 应把
`contracts:check` 与 `lab:check` 一起跑；快照过期即失败。

## 约束

- 不手改 `openapi/mininet.json`。
- 前端不得绕过 BFF 直接访问 Mininet 端口。
- BFF 的 `/api/lab/**` 白名单必须能追溯到本快照中的 path + method。
- WebSocket 不在 OpenAPI 中，后续在 `layers/scenario/shared/constants/mininetRoutes.ts` 单独登记。
