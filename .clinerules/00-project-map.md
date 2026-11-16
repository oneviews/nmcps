# Project Map

本文件是 Cline 的入口，不是仓库结构的事实源。目录职责、数据流、常用命令、改动影响矩阵只在
`docs/ai/repo-map.md` 维护；这里只保留读取顺序和硬约束，**不要复制第二份地图**（避免两处漂移）。

开始任何跨目录任务前，按顺序读：

- `docs/ai/repo-map.md`：系统边界、数据流、命令、改动影响矩阵（唯一真源）。
- `docs/ai/task-recipes.md`：后端、BFF、Lab UI、WebSocket 的标准步骤。
- `docs/ai/lab-boundary.md`：Mininet 特权操作与多用户隔离约束。

## 硬约束

- 浏览器不得直连 Mininet `:8000`；必须经 BFF `/api/lab/**` 与 `/lab-ws/*`。
- 改 Mininet 路由或 schema 后必须跑 `pnpm contracts:gen`。
- 旧 Vite 前端按 `NMCPS-ADR-0022` 退役：只按能力位重写行为，不复制源码、不复用其样式体系、不双写；复刻验收后删除，`services/mininet-api` 只留纯后端。
- 生产拓扑模型与实验拓扑模型不混用。
- 新增文件前先确认落在既有目录边界内，不新增第二个 Git 根或 submodule。
- 共享 BFF 工具留在 `server/utils/bff/`；只服务 Lab 的实现放 `layers/scenario/server/utils/bff/`，
  根层不得反向 import `layers/scenario`。
