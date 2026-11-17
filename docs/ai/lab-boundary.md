# Lab 边界约定

Mininet 是**有状态、特权、单实例**的实验床，不是普通只读数据源。合并进 nmcps2 后必须保留这层边界。

## 当前事实

- `services/mininet-api` 的 `app.net` 是进程内全局拓扑，同一时间只有一张网络。
- 后端没有登录态；CORS 已关闭（`NMCPS-ADR-0022` D9 / W6），浏览器只经 BFF 访问，`:8000` 只对回环 / 反代暴露。
- 终端、抓包、`reset`、`full_reset` 属于高权限操作。
- 拓扑、节点位置、运行状态都归后端所有，前端不是事实源。

## 阶段一约束（已被 NMCPS-ADR-0022 取代）

- 后端只监听 `127.0.0.1` 或受控内网（仍然有效）。
- 不新增浏览器直连 `:8000` 的代码（仍然有效）。
- ~~旧 Vite 前端只作行为参考，不再扩展功能~~ → 见下节：复刻验收后直接退役。
- ~~先完成 BFF 通道和只读页面，再开放写操作~~ → 只读阶段已完成，写操作按 ADR-0022 W1~W4 分段开放。

## 全量并入与旧前端退役（NMCPS-ADR-0022）

- 目标：把旧 Vite 前端（`mininet_gui_frontend`）全部能力并入 `/scenario/simulator`，验收后删除该前端，`services/mininet-api` 只留纯后端。
- 28 条写端点按 `(method, 模板)` 逐条登记进 `MININET_ROUTES`，一个端点一个权限位：`lab:create`（建网 / 加节点加链）、`lab:operate`（改网络、pingall、iperf、流表）、`lab:delete`（删节点）、`lab:sniffer`（抓包启停）；`full_reset` 与 `import_json` 需 `lab:delete` + `lab:create` 双权限。
- `GET /api/lab/channel` 的 `writeEnabled` / `capabilities` 按会话计算；页面先读能力位再渲染，不再恒为 `false`。
- 写操作先写审计 outbox（`.data/audit/lab-audit.jsonl`）再执行；写盘失败回 `503 audit_unavailable`。同一网络同时只允许一个在途写操作（`409 lab_operation_in_progress`）。
- 四个 WebSocket 走同源 `/lab-ws/*`：`POST /api/lab/ws-ticket` 签 60 秒一次性 HMAC 票，绑定 `sub` / `tid` / `kind` / `target`；票过期、重放、绑定不符一律 `401 lab_ws_ticket_invalid`。四条通道全部落地（`sniffer` / `terminal` / `logs` / `monitor`）：验票、连上游、透传与审计只有一份实现 `layers/scenario/server/utils/bff/labWsRelay.ts` 的 `createLabWsRelay(kind)`，每个路由文件只有一行；`target` 语义按通道登记（抓包=网络 id 可空、终端=节点、监控=`<node>:<intf>`、日志必须为空），票据签出前判形状与台账，会话开始 / 结束各记一条审计（`duration_ms`，**不记**终端输入 / 日志正文 / 抓包载荷）。通道登记表在 `layers/scenario/shared/constants/labWs.ts`（`LAB_WS_UPSTREAMS`），未登记种类回 `400 lab_ws_kind_invalid`；票是一次性的（`jti` 内存表，多实例部署需落台账）。终端是唯一有上行的通道，上游握手期间的上行帧排队到 `open` 再发。
- 导出走独立内容类型通道：`GET /api/lab/export/{kind}`（静态路由 `layers/scenario/server/api/lab/export/[kind].get.ts`）不套 `ApiResponse` 信封，文件名由 BFF 生成（`lab-<network_id>-<UTC>.<ext>`，不信任上游 `Content-Disposition`）。种类与权限位**逐条**登记在 `LAB_EXPORT_UPSTREAMS`：`json` / `script` 要 `lab:read` 并直出 `text/plain`；`pcap` 要 `lab:sniffer`、按 `arrayBuffer` 取二进制（`fetchMininetBinary()`，走 `text()` 会毁掉魔数）。未登记种类回 `400 bff_path_invalid`，且先判种类再判权限。
- 破坏性重建（`POST /api/lab/full_reset`）除 `lab:delete` + `lab:create` 外还要 `{ confirm: "<network_id>" }`：缺失或不符回 `400 lab_confirm_required` 且不触达上游（ADR-0022 W5）；成功后台账 `resources` 整体清空。
- 旧前端删除前打 tag `legacy-mininet-gui-final`；上游 CORS 关闭，只经反代暴露。两条都已完成（W6）：`mininet_gui_frontend` 从未进本仓库，`services/mininet-api` 只剩纯后端；`CORSMiddleware` 已删除，`pnpm lab:check` 断言 `app.user_middleware` 里不再出现 CORS 中间件。

## 已落地的只读通道（NMCPS-ADR-0020）

- 浏览器入口只有 `/api/lab/**`；上游基址在 `runtimeConfig.mininet.instances`（`NUXT_MININET_INSTANCES`，租户 → 实例 JSON）。未配置实例的租户回 `503 tenant_runtime_unavailable`，不会回退全局 `baseUrl`。
- `layers/scenario/shared/constants/mininetRoutes.ts` 登记 **45 条**端点：17 条查询 + 28 条写（ADR-0022 W1）；导出另走静态路由（`export/[kind].get.ts` + `LAB_EXPORT_UPSTREAMS`，`json` / `script` / `pcap` 三种，权限位与内容类型逐条登记），不占白名单条目。未登记路径回 404、动词不符回 405。
- BFF 出站不读 `nmcps_at`、不转 `Bearer`、不转发 cookie；只带 `accept` / `user-agent` / `x-request-id`。
- `GET /api/lab/channel` 返回 `configured` / `readOnly` / `writeEnabled` / `capabilities` / `endpointCount`，**按会话计算**，不回传上游地址。
- 已开放：四条 WebSocket（抓包实时流 `/lab-ws/sniffer`、Webshell `/lab-ws/terminal`、日志 `/lab-ws/logs`、监控 `/lab-ws/monitor`，均经一次性票）、抓包启停（`lab:sniffer`）与 pcap 下载、导出 JSON / 脚本与 `import_json`（W4）、写操作（按权限位）、旧前端退役（W6：纯后端 + CORS 关闭 + `legacy-mininet-gui-final` 标签）。页面对全部写动作与三条观测面板都先读能力位再渲染。
- `pnpm build:server && pnpm check:lab-bff` 验证 130 项通道契约（含台账租户隔离、资源清单、401/403/503 与上游零命中，⑩ 覆盖导出 `text/plain` / BFF 文件名 / 未登记种类 400 / 导入 multipart 与清单并集，⑪ 覆盖 pcap 的 `lab:sniffer` 门禁与二进制直出、抓包启停、`full_reset` 的 confirm 闸门与清单清空，⑫ 覆盖 WebSocket 票的权限 / 种类 / 目标绑定、无票与篡改与重放三条 401、实时帧透传与上游零 cookie、会话审计不含载荷，⑬ 覆盖终端 / 日志 / 监控三条通道的 target 形状与台账收窄、终端上行回显与 `Ctrl-C` 控制字节、日志逐行原文、监控 `node:intf` 查询串与采样，⑭ 覆盖台账对账的 403 / 400（缺确认、确认不符）/ 409 / 上游读失败不落盘 / 清单整体重写与幽灵 id 清除 / 两条审计 / 不在白名单）。`pnpm check:lab-flows` 另有 21 项纯函数断言（草稿三条校验 / 请求体省略规则 / 清流请求体留空不发 `match` / 行号口径），`pnpm check:lab-run` 有 13 项（运行态三态归一 / iperf 两端与秒数校验 / 请求体省略规则 / `pingall` 与 iperf 结果文本化），`pnpm check:lab-ws` 有 21 项（四通道登记表与权限位 / `target` 四种形状 / 上游地址拼接 / 票与监控帧归一 / PTY 文本清洗），三者都不启 Nitro、不碰上游。
- 拓扑编辑（`/scenario/simulator`，ADR-0022 W2 / W2b）只走 `/api/lab/**`：新增 / 删除节点、连线、拖动落库（`POST /node_position`）、OpenFlow 版本、流表读数（`GET /flows/{switch}`）与流表写入（`POST /flows` 加流、`DELETE /flows/{switch}/{flow_id}` 删单条、`DELETE /flows` 批量删流 —— `match` 留空即清整表，填了只删命中项）；删单条的 `flow_id` 是上游按「含 `actions=` 的行」数的 1 基序号，页面必须按同一口径计（`labFlowRowsOf()`）。`TopologyCanvas` 的 `draggable` 必须跟 `capabilities.operate` 走，否则拖动会「看起来成功但没落库」。
- 运行控制（W3）同样只走 `/api/lab/**`：`POST /start`（`lab:create`）、`POST /stop`（`lab:operate`，确认弹窗）、`POST /pingall` / `POST /iperf`（`lab:operate`）。运行态只读 `GET /start` 的裸布尔：读到 `false` 才写「已停止」，读不到一律「未知」且四个动作全部禁用 —— 把「读不到」当成「没启动」会让启动按钮对着已在跑的网络发请求，再拿上游 400 当失败。四个动作互斥（上游单实例），失败原话（400 / 403 / 409 / 503）逐字显示。
- 台账对账（`NMCPS-ADR-0023`）是唯一的「只改台账、不转发上游写」端点：`POST /api/lab/networks/{id}/sync`（静态路由 `networks/[id]/sync.post.ts`，**不在** `MININET_ROUTES` 里），双权限 `lab:create` + `lab:delete`、逐字确认 `{ confirm: "<network_id>" }`、先审计后执行、同网络单写锁；读 `/hosts` `/switches` `/routers` `/nats` `/controllers` 与 `/links` 后**整体重写**资源清单，任一读取失败原样回上游状态且不落盘。
- 无控制器的交换机按 `NMCPS-ADR-0024` 落在 `failMode='standalone'`（传统自学习，开箱即通），关联控制器后改 `secure`（OpenFlow 流表生效）；`pingall` 100% 丢包的根因就是「默认 secure + 零控制器」。导出脚本同源，`pnpm lab:check` 三条静态断言钉住映射、四个 OVS 分支与导出文本。
- 实时包列表（W5 WebSocket 段）：页面挂载先 `GET /api/lab/sniffer/history` 回填，抓包态变 `true` 时由 `useLabSnifferStream()` 先 `POST /api/lab/ws-ticket` 再连同源 `/lab-ws/sniffer`（`null` / `false` 都不连）；组件不 `new WebSocket`，列表上限 200 条，停止抓包即断流但保留已收到的包。
- Network Tools 面板（工具栏「网络工具」，`SimulatorNetworkTools` + `useLabWsChannel(kind)` / `useLabTerminalSessions()`）：Webshell 要 `lab:terminal`（节点来自台账，逐键上行走 `/lab-ws/terminal`，每个节点一条会话标签，握手期的按键先排队到上游 `open`）；日志与监控只要 `lab:read`（`/lab-ws/logs` 逐行、`/lab-ws/monitor` 的 `target` 为 `<node>:<intf>`，接口选项只来自 `GET /api/lab/interfaces`）。两个能力位都没有时整块入口不渲染；日志随标签打开自动建流、离开即断，监控只有一个目标、切走即停，终端会话是**显式的多会话**——切标签不断流、标签上的 × 才断那一条，关面板才全断。上游在通道内用 `Error: …` 文本表达失败，页面显示成错误行而不是「暂无数据」。终端是逐键终端：`keydown` 翻译成 PTY 字节（回车 `\r`、退格 `0x7f`、方向键走 CSI、`Ctrl+字母` 发 `0x01–0x1A`），连续字符攒 8ms 一帧，中文等 IME 输入由隐藏 textarea 的 `input` 事件整段送出；回显交给 PTY，面板不做本地回显（否则一次输入两份）。输出先过 `labTerminalTextOf()`：真 PTY 带 ANSI 颜色码与 `\r` 重绘，原样渲染会把提示符显示成 `^[[1;32m`；「中断」发 `0x03`，「清屏」只清浏览器侧转写且不断流。

## 已落地的鉴权（NMCPS-ADR-0021 P1）

- 登录 / 刷新签发 `nmcps_sess`：HMAC-SHA256、`HttpOnly`、`SameSite=Lax`、`Path=/`，载荷含 `sub` / `tid` / `iat` / `exp` / `ath`。
- `ath` 是访问令牌的 SHA-256；会话与凭据必须同源，错配一律 401。
- 密钥来自 `NUXT_BFF_SESSION_SECRET`（至少 32 字节），轮换窗口用 `NUXT_BFF_SESSION_SECRET_PREVIOUS` 验证旧 cookie；缺密钥回 `503 bff_auth_not_configured`。
- **生产启动的 `.env` 加载**：`pnpm start` 现在走 `scripts/start-server.mjs` —— 它先 `process.loadEnvFile('.env')`（只填**尚未设置**的变量，显式 export / 部署平台注入的变量优先），再 import `.output/server/index.mjs`。直接 `node .output/server/index.mjs` 不读 `.env`：忘了导出密钥时，登录照常但 `/scenario/simulator` 的每个 `/api/lab/**` 都回 `503 bff_auth_not_configured`（已实测：带密钥时同一请求是 `401 bff_auth_required`）——这与角色无关，不是租户管理员被拒。密钥缺失或不足 32 字节时启动脚本会打印一条同名警告。
- `/api/lab/**` 先解析 IAM `subject-roles → roles/{id}`，租户角色必须满足 `role.tenant_id === 会话 tid`；查询失败回 `503 bff_role_resolution_failed`，不降级成 `tenant_user`。
- 平台管理员（`tid === null`）回 `403 lab_permission_denied`，没有运行态权限。
- 主网关已剥离客户端 `x-tenant-id`；租户只来自签名会话，不来自请求头 / 查询 / body。
- 桌面端（`x-nmcps-client: desktop`）当前只在响应体拿 tokens，不落签名会话；在补充桌面会话承载前，`/api/lab/**` 对桌面端返回 401。
- `/api/sim/**` 仍保持原只读通道，尚未接入租户实例与签名会话；在 P3 写操作开放前必须补齐。

## 已裁决：每租户独立实例（NMCPS-ADR-0021）

- **隔离级别 A**：每个租户独立 Mininet 实例 / 容器 / 网络命名空间，不共享 `app.net`；单实例只能叫「global lease」，不得宣称隔离。
- **租户来源**：只从 BFF 签名会话取，`x-tenant-id`、请求体与查询参数一律不参与归属；P1 前不开放写操作。
- **权限矩阵**：`shared/constants/labPermissions.ts` 是唯一真源。租户普通用户默认 `lab:read`，租户管理员额外 `lab:create` / `lab:operate` / `lab:delete`；`lab:terminal` 与 `lab:sniffer` 必须单独授权。
- **角色校验**：租户角色必须满足 `role.tenant_id === 会话 tenant_id`（UP-RBAC-09）；平台管理员默认没有运行态访问权。
- **资源边界**：BFF 台账记录 `tenant_id` / `engine` / `upstream_id`，上游 `sim_id`、节点 ID、链路 ID 都不是权限凭据；跨租户统一 404。
- **单网络**：同一租户同一引擎同时最多一张运行中网络，第二次创建 / 启动回 `409`。
- **审计**：创建、启动、停止、重置、删除、终端、抓包全部留痕；高风险动作审计失败即拒绝。

## 后续必须拍板

1. **WebSocket 鉴权**：BFF 签发短时 ticket，反代校验后转发。
2. **平台管理员支持会话**：若需要排障，另立 ADR 定义授权人、时限与范围（当前默认拒绝）。
3. **每租户实例编排**：容器 / 命名空间 / 配额的创建与销毁在部署面，BFF 只消费注册表。
4. **数据归属**：实验拓扑只导出/导入，不覆盖生产拓扑。
5. **审计落地**：审计存储、保留期与查询入口。
