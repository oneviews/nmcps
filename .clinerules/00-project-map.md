# Project Map

本仓库是一个 Git 根目录下的多部署单元 monorepo。开始任何跨目录任务前，先读：

- `docs/ai/repo-map.md`：系统边界、数据流、命令、改动影响矩阵。
- `docs/ai/task-recipes.md`：后端、BFF、Lab UI、WebSocket 的标准步骤。
- `docs/ai/lab-boundary.md`：Mininet 特权操作与多用户隔离约束。

## 目录职责

- `app/`、`layers/*/app/`：Nuxt 前端。
- `server/`：Nitro BFF，浏览器唯一出口。
- `services/mininet-api/`：独立部署的 FastAPI + Mininet 后端。
- `packages/contracts/`：从 FastAPI OpenAPI 生成的契约，禁止手改。
- `packages/mininet-client/`：下一阶段的 Lab REST/WS 客户端（尚未创建）。
- `layers/scenario/`：场景筹划与 Mininet 仿真网（页面、`/api/lab/**` BFF 路由、路由白名单、自查脚本）。

## 硬约束

- 浏览器不得直连 Mininet `:8000`；必须经 BFF `/api/lab/**` 与 `/lab-ws/*`。
- 改 Mininet 路由或 schema 后必须跑 `pnpm contracts:gen`。
- 旧 Vite 前端是只读行为参考，不整页复制、不双写。
- 生产拓扑模型与实验拓扑模型不混用。
- 新增文件前先确认落在既有目录边界内，不新增第二个 Git 根或 submodule。
