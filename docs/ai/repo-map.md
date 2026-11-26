# AI 项目地图

本仓库是**一个 Git 根目录 + 多个部署单元**的 monorepo。目录可以分开，AI 上下文必须统一。
本文件是给 AI 的最短事实源；细节以对应代码为准。
`.clinerules/00-project-map.md` 只保留 Cline 入口与硬约束，目录 / 命令 / 影响矩阵以本文件为准。

## 系统边界

| 路径 | 职责 | 部署 |
|---|---|---|
| `app/`、`layers/*/app/` | Nuxt 4 前端与业务页面 | Nuxt 构建 |
| `server/`、`layers/*/server/` | Nitro BFF，浏览器唯一出口 | 随 Nuxt 构建 |
| `services/mininet-api/` | FastAPI + Mininet 实验后端 | 独立 Linux 服务/容器 |
| `packages/contracts/` | FastAPI OpenAPI 生成快照 | 随前端构建消费 |
| `packages/mininet-client/` | 下一阶段的 Lab REST/WS 客户端（尚未创建） | 随前端构建 |
| `layers/scenario/` | 场景筹划 + 仿真网页面、`/api/mininet/**` BFF 路由、路由白名单与自查脚本 | Nuxt 构建 |
| `_reference/` | 只读参考代码 | 不部署 |

旧 Vite 前端不在本仓库内，位于外部归档目录；**不要把它当作事实源**。

## 数据流

```text
Browser/Tauri
  → /api/**        → Nitro BFF → 主 API :8888
  → /api/mininet/** → Nitro BFF → Mininet API :8000（GET 查询 + 写端点白名单，逐条能力位）
  → /mininet-ws/*   → Nitro BFF（验一次性票）→ Mininet API WebSocket（sniffer / terminal / logs / monitor）
```

> `/api/sim/**`（8001 仿真平台）已于 2026-11-25 随 `NMCPS-ADR-0027` §4 R8 退役：通道、白名单与
> openapi 快照一次删净，实验面只剩 `/api/mininet/**` 与 `/mininet-ws/*`。

BFF 与上游**前缀同形**（`NMCPS-ADR-0022` D11）：同一串 `/api/mininet/**` 在浏览器侧是 Nitro 路径，
在出站侧拼在租户实例 `baseUrl` 之后 —— 排障时按「有没有主机 / 端口」区分，别按前缀猜。

浏览器**不得**直连 `:8000`。所有 Lab 写操作、终端、抓包都必须经过 BFF 鉴权与审计。

## 常用命令

| 命令 | 用途 |
|---|---|
| `pnpm dev` / `pnpm dev:web` | 启动 Nuxt |
| `pnpm dev:lab-api` | 启动 Mininet FastAPI（`127.0.0.1:8000`） |
| `pnpm lab:check` | 导入后端并校验 HTTP/WS 路由（CI 只跑 `--source-only` 的源码守卫，见 `lab-api` 步骤） |
| `pnpm check:lab-bff` | 校验 `/api/mininet/**` BFF 通道（台账与资源清单、长时预算、iperf 的 504 / 409 透传、审计），需先 `build:server` |
| `pnpm check:lab-flows` | 校验流表编辑纯函数（草稿校验 / 请求体 / 清流请求体 / 行号口径） |
| `pnpm check:lab-run` | 校验运行控制纯函数（运行态三态 / iperf 校验与请求体 / pingall 与 iperf 文本化） |
| `pnpm check:lab-ws` | 校验 `/mininet-ws/*` 纯函数（四通道登记表 / `target` 形状 / 上游地址 / 票归一 / 监控帧 / PTY 文本清洗） |
| `pnpm check:lab-terminal` | 校验 Webshell 按键 → PTY 字节的等价性（真 `bash` + 伪终端，需 POSIX；裁决见 `NMCPS-ADR-0025`） |
| `pnpm check:lab-real` | 真 Mininet 端到端手验（五标签右栏 + 真 PTY 键盘）；默认跳过，`CHECK_REAL_MININET=1` 才跑，需要 root 后端 `:8000` 与 `build:server` |
| `pnpm check:lab-real:root` | 同一手验的提权包装（`layers/scenario/scripts/check-lab-real-root.mjs`）：组装 `PATH` / `CHECK_REAL_MININET` / `REAL_MININET_BASE` 后走 `sudo -A env`，root 下 tc 层真断言 |
| `pnpm contracts:gen` | 重新生成 Mininet OpenAPI 快照 |
| `pnpm contracts:check` | 校验快照是否过期 |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | vue-tsc |
| `pnpm check:governance` | 文档 / 规则 / CI 治理守卫 |

## 改动影响矩阵

| 改动 | 必须同步 |
|---|---|
| Mininet 路由或 Pydantic schema | `packages/contracts/openapi/mininet.json`、BFF 白名单、client |
| Lab REST 调用 | `packages/mininet-client` → `layers/scenario`，禁止页面内 axios |
| Lab WebSocket | BFF/反代配置、ticket 鉴权、client 重连逻辑 |
| 新增 Lab 文案 | `i18n/locales/{cn,en}.json`，跑 `pnpm check:i18n` |
| 新增 Lab 页面 | `layers/scenario/app/pages/scenario`、导航、权限 meta |
| 后端特权操作 | 权限位、审计、二次确认、`allowWrite` 开关 |

## BFF 工具归属

- `server/utils/bff/` 是主网关共享层：`auth` / `session` / `config` / `iamRoles` 等服务登录、刷新、
  登出、改密和 Lab 鉴权共同使用，**留在根层**。
- 只服务 Lab 的实现（`labGuard` / `labLedger` / `labEgress` / `mininet` / `mininetConfig`）放在
  `layers/scenario/server/utils/bff/`。Nuxt 会把 scenario 层的 `/api/mininet/**` 路由并入根应用，但根层
  工具不得反向 import `layers/scenario`。
- `iamRoles.ts` 的 `clearLabRoleCache()` 被 `server/api/auth/{password,logout}.post.ts` 直接调用，
  因此不迁入 scenario 层；迁移会形成根层 → scenario 的反向依赖。

## 仿真端复刻计划

- 2.0 废弃仿真平台 `:8001`、由本仓重建其全部功能；参考实现在 `_reference/netsim`（只读）。
  **退役已落地（2026-11-25）**：`/api/sim/**`、`SIMULATOR_ROUTES`、openapi 快照与 `check:bff` 第 ⑨ 组一并删除（`NMCPS-ADR-0027` §4 R8）。
- 分档、端点对照、阶段划分见 `docs/ai/simulation-parity.md`（工程计划产物，不受 doc-system 治理）。
- 仿真端仍部署在 `90` 单机，管理面经 `runtimeConfig.mininet.baseUrl` 远程访问；一宿主一实例。
- M0 已落地：`services/mininet-api/mininet_gui_backend/engines/**`（`base`/`registry`/`dryrun`/`wired`/`wireless`）
  + `sessions.py`（`/api/simulation/**`）+ `auth.py`（`LAB_API_TOKEN` / WS 签名）；BFF 侧 `mininet.token`、
  `GET /api/mininet/version` 握手。自检：`pnpm check:engines`（零依赖）、`pnpm check:simulation`（无 root，dryrun）。
- M1 已落地：`wired` 引擎接管统一节点 / 链路 CRUD（适配 legacy `api.Host` 等模型与 `create_*`，不重写建网），
  BFF 白名单新增 12 条 `/api/mininet/sessions/**` → `/api/simulation/**`（权限位 + 台账 `session_id` 归属 + 审计）。
  更新类操作（位置 / IP / 默认路由 / OpenFlow / 流表 / 统计 / 抓包 / 导出）仍在 1.x；页面尚未切换，见 M1.1。
- M2 首增量（SNMP 采集面，`NMCPS-ADR-0028`）：`services/mininet-api/mininet_gui_backend/snmp/**`（自写 stdlib
  只读 v2c agent，每节点 netns 一份）+ 两个台账投影 GET（`/api/mininet/snmp/{state,topology}`，BFF 同名、
  `lab:read`）。自检：`pnpm check:snmp`（零依赖、无 root；CI 里是独立步骤 `SNMP agent self-check`，结论键
  `snmp` + 样本 `scripts/fixtures/ci-logs/snmp.log`）。真采集由外部 NMS 直连
  节点 IP，不经 BFF（2026-11-26 在 90 上以 net-snmp `snmpwalk` 闭环，见 ADR-0028 §5）。

## 禁止事项

- 不新增第二个 Git 根、submodule 或跨仓库相对引用。
- 不在 `.vue` / composable 里硬编码 `http://...:8000`。
- 不把旧 Vite 组件整页复制进 `layers/scenario`。
- 不把生产拓扑模型 `TopologyGraph` 和实验拓扑模型混用（仿真网页面只做只读投影）。
- 不手改生成文件 `packages/contracts/openapi/mininet.json`。
- 不在未隔离的多用户环境中暴露全局 `reset` / 终端 / 抓包。
