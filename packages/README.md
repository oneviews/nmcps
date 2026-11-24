# Packages

跨应用共享的 TypeScript 包。只放**被多个运行时复用**的代码，不放页面或 Nuxt 页面级组件。

- `contracts/`：从 FastAPI OpenAPI 生成的契约快照（禁止手改）。
- 后续计划：`mininet-client/`，封装 `/api/mininet/**` 的 REST + WebSocket 客户端。

新增包必须：

1. 在根 `pnpm-workspace.yaml` 的 `packages/*` 范围内；
2. 提供独立 `package.json`；
3. 不引用 `app/`、`layers/*` 的页面级代码；
4. 通过根 `pnpm check` 的 lint / typecheck。
