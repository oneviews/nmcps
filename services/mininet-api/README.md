# Mininet API

独立部署的 Mininet 实验后端（FastAPI）。它属于本仓库，但**不跟随 Nuxt 构建**：
运行在需要 Linux、root、Mininet、OVS、Ryu 的实验主机或容器中。

## 边界

- 只监听 `127.0.0.1:8000` 或受控内网，由 nmcps2 BFF 的 `/api/mininet/**` 代理（BFF 前缀与本服务同形、
  靠主机 / 端口区分，见 `NMCPS-ADR-0022` D11）。
- 浏览器不得直接访问本服务；终端、抓包、reset 等特权操作必须经过 BFF 鉴权与审计。
- 拓扑状态归本服务所有，Nuxt 只读或通过显式 API 修改。
- 接口变更后运行 `pnpm contracts:gen`，契约快照位于 `packages/contracts/openapi/mininet.json`。

## 本地运行

```bash
pnpm dev:lab-api
pnpm lab:check
pnpm check:engines     # 引擎分层静态守卫 + dryrun 全链路（无 root / 无 fastapi）
pnpm check:simulation  # 起真后端：会话端点 + 入口鉴权（无 root，dryrun）
```

依赖：系统已安装 Mininet/OVS/Ryu，Python 依赖见 `requirements.txt`。

## 引擎与会话（2.0 M0 → M1）

- `mininet_gui_backend/engines/`：`base`（统一 `Engine` 协议 + 统一节点 `NodeSpec{type}`）、
  `registry`（按名取引擎，未登记抛 404，绝不回落）、`wired`（legacy 全局网的适配器：起停 + 统一
  节点 / 链路 CRUD）、`wireless`（M3 之前的占位，只探测 `mn_wifi` 是否可导入）、`dryrun`（纯内存，CI 无 root 用）。
- `wired` 的节点 / 链路 CRUD 是**适配**而不是重写：模型类从 `api` 模块按名取（`api.Host` / `api.Switch`…），
  写操作仍调 legacy `create_host` / `create_link` 等（`TCLink`、OVS 端口、`switch_fail_mode()` 只在那边实现），
  本层只做 `NodeSpec` ↔ legacy 模型的形状转换与错误归一（`HTTPException.status_code` →
  `engine_invalid_request` / `engine_resource_not_found` / `engine_conflict`）。因此引擎层不 import
  pydantic / mininet，`pnpm check:engines` 能用桩 `api` 在无 root 的机器上跑通（`scripts/check-wired-adapter.py`）。
- `sessions.py`：会话表（`sim_<12hex>`，单进程、重启即清），`/api/simulation/**` 是 2.0 的入口；
  1.x 的 `/api/mininet/**` 继续工作（更新类操作、流表、统计、抓包、导出仍只有它），两者互不踩。
- **新增代码不得在 `engines/` 之外 `import mininet` / `mn_wifi`**：`scripts/check-engines.mjs`
  冻结了 5 个 legacy 文件（`api.py`/`export.py`/`schema.py`/`nodes.py`/`cli.py`），
  M1 每搬走一个就更新名单，新文件出现一次 import 即红。
- 无线依赖只能 `importlib.util.find_spec("mn_wifi")` 探测，不许顶层 import —— 否则无无线依赖的机器起不来后端。

## 入口鉴权与远程部署（M0）

- `LAB_API_TOKEN` 已设置 ⇒ 所有 HTTP（除 `/api/health`、`/api/version`）必须带 `x-lab-token`；
  WebSocket 走 `lab_ts` + `lab_sig`（`HMAC-SHA256(token, "<path>\n<ts>")`，120 秒窗口、绑定路径），
  因为 Node 内置 `WebSocket` 不能设请求头。
- 未设置 ⇒ 只接受回环客户端（本机现状），启动日志打一条 warning。
- BFF 侧同值配置 `NUXT_MININET_TOKEN`；`GET /api/mininet/version` 是握手端点，读上游 `api_contract`
  并回 `compatible`（主版本比较，缺省期望 `2.0`）。
- 非 root 时 `app.net` 为 `None`（`Mininet()` 会 `ensureRoot() → exit(1)`）：只有 `dryrun` 会话可用。
  非 root 跑自检要带 `LAB_SKIP_STARTUP_CLEANUP=1`（否则启动时的 `mn -c` 会对着别人的进程反复 `pkill` 失败并卡住）。
