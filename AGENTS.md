# AGENTS.md

本文件是跨 AI 工具的入口；Cline 的详细规则在 `.clinerules/`，两者不重复维护业务细节。

## 先读

1. `docs/ai/repo-map.md`：仓库边界、数据流、命令、改动影响矩阵。
2. `docs/ai/task-recipes.md`：常见跨目录任务的执行顺序。
3. `docs/ai/lab-boundary.md`：Mininet 特权操作与隔离约束。

## 基本事实

- 单 Git 根目录；Nuxt 在根目录，Mininet FastAPI 在 `services/mininet-api/`。
- 浏览器只访问 Nitro BFF；`services/mininet-api` 不直接暴露给浏览器。
- 生成契约在 `packages/contracts/openapi/mininet.json`，禁止手改。
- 旧 Vite 前端在仓库外，仅作只读参考，不作为事实源。

## 验证

```bash
pnpm lab:check
pnpm contracts:check
pnpm build:server
pnpm check:lab-bff
pnpm lint
pnpm typecheck
```

未明确要求时不要提交（commit）或推送（push）。
