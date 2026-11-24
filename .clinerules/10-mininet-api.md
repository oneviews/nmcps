---
paths:
  - "services/mininet-api/**"
---
# Mininet API

本目录是独立部署的 FastAPI 服务，不是 Nitro 的一部分。引擎面的领域裁决（会话为资源根、统一节点投影、阶段边界）见 `NMCPS-DESIGN-008`（`layers/content/collections/cn/architecture/2.domain/simulation.md`）。

- 沿用 `mininet_gui_backend/` 现有模块划分；新增文件放同包内，不建第二套入口。
- 依赖保持 `requirements.txt` + `pyproject.toml` 显式声明；不引入 Node 工具链。
- 修改路由或 Pydantic schema 后，运行 `pnpm lab:check` 和 `pnpm contracts:gen`。
- 同一份自检有两种模式：`--source-only` 只切 `api.py` 文本、零第三方依赖（CI 的 `lab-api` 步骤跑它），
  完整模式额外导入后端校验路由清单 / CORS / standalone 落库；两种模式共用 `check_*()` 里的断言，
  新增守卫写进这些函数，别在 `ci.yml` 里另写一份 grep。
- 引擎分层：新增代码只能在 `engines/` 内 `import mininet` / `mn_wifi`；`scripts/check-engines.mjs`
  冻结了 5 个 legacy 文件（`api.py`/`export.py`/`schema.py`/`nodes.py`/`cli.py`），搬走一个就更新名单，
  不许新增。无线依赖只用 `find_spec("mn_wifi")` 探测 —— 顶层 import 会让无无线依赖的机器起不来后端。
- 会话与引擎：`/api/simulation/**` 是 2.0 入口（`sessions.py` + `engines/`），1.x 的 `/api/mininet/**` 仍在用。
  `GET /api/mininet/nodes` 是五类分表的统一投影（M1.1）：与 `/sessions/{id}/nodes` 同形（`id/type/name/x/y` +
  `attributes`），但**不判会话绑定**（1.x 等价「默认会话」，只读会话也能读）；投影本身只有
  `engines/wired.py` 的 `unified_nodes()` 一份，会话侧在 `_bound()` 之后复用它，别在 `api.py` 里另写一份。
  `wired` 引擎自 M1 起接管会话起停**与统一节点 / 链路 CRUD**（`list_nodes` / `add_node` / `remove_node` /
  `list_links` / `add_link` / `remove_link`）：统一 `NodeSpec{type,...}` ↔ legacy `api.Host` 等模型 +
  `create_*` handler，错误按 `status_code` 归一成引擎错误（`engine_invalid_request` /
  `engine_resource_not_found` / `engine_conflict` / `engine_unavailable`）。建网实现不改写：
  `TCLink` / OVS 端口 / `switch_fail_mode()` 仍只在 `api.py` 里。`ap` / `station` 建节点回 501（M3）。
  更新类操作（位置 / IP / 默认路由 / OpenFlow / 流表 / 统计）仍是 1.x，`Engine` 协议没有 `update_node`。
- BFF 会话通道：`/api/mininet/sessions/**`（12 条）→ `/api/simulation/**`，与 1.x 共用 `handleWrite()`
  （审计先行、同网络在途写 409、成功后清单 / `state` 收敛）。归属靠台账 `session_id`：
  `POST /sessions` 成功后写回（`bindLabNetworkSession()`）、路径里的会话与台账不一致一律 404
  （与「不存在」同口径）、已绑定时再建回 409 `lab_session_exists` 且不触达上游。`metadata`
  （`network_id` / `tenant_id` / `actor_id`）只能由 BFF 写，客户端填的会被覆盖。
  分辨两套上游靠 `isSimulationRoute()`（`upstream` 前缀），白名单每行仍然只有四个键 ——
  脚本按这一行的形状解析源码，多一个键会让解析静默变成空表。
- 入口凭据：`LAB_API_TOKEN` 设置后 HTTP 要 `x-lab-token`、WebSocket 要 `lab_ts` + `lab_sig` 签名
  （Node 内置 WebSocket 不能设头）；BFF 侧是同值的 `NUXT_MININET_TOKEN`，握手走 `GET /api/mininet/version`。
  token 不进查询串、不进日志、不回传。监听面 / 特权 / 凭据 / 重启语义的完整基准见 `NMCPS-ARCH-007`
  （`layers/content/collections/cn/architecture/1.architecture/lab-deployment-architecture.md`）。
- 非 root 时 `app.net` 为 `None`（`Mininet()` 会 `exit(1)`），只有 `dryrun` 可用；自检带
  `LAB_SKIP_STARTUP_CLEANUP=1`，否则启动时的 `mn -c` 会反复 `pkill` 失败并卡住启动。
  `pnpm check:engines` 零依赖，`pnpm check:simulation` 需 uvicorn + mininet，两者都无 root。
- 浏览器不得直连本服务；新端点必须在 BFF 白名单登记并通过 `/api/mininet/**` 暴露。
- 终端、抓包、`reset`、`full_reset` 等特权端点必须带权限与审计设计，不能默认开放。
- 日志写 `mininet_gui_backend/mininet.log`，不得提交；`.venv`、`__pycache__`、`nohup.out` 同样不提交。
- 后端仍是单实例 `app.net`；未完成隔离前，不要假设多用户可并发操作。
