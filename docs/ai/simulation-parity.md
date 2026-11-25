# 仿真端复刻对照矩阵（netsim `:8001` → 本仓 2.0）

> **用途**：把「2.0 废弃 `:8001`、由本仓重新实现其全部功能」拆成可排期的模块清单。本文是
> 工程计划产物（`docs/ai/` 作业面），**不是受治理文档**，不参与 `pnpm check:doc-system`；
> 定稿后的裁决进 `NMCPS-DESIGN-008`（已登记，2026-11-25）/ `NMCPS-ARCH-007`（已登记，2026-11-25）/ `NMCPS-ADR-0027`（已登记，2026-11-25）。
>
> **数据来源**：`_reference/netsim/backend`（只读参考）与本仓 `services/mininet-api` 的实测行数、
> 端点清单（2026-11-24 实测）。参考侧行数含 `.bak-*` 热修残留文件，已单独剔除。

## 〇、口径与判定档位

**部署目标**：仿真端仍部署在 `90` 单机（`mininet` + 特权 netns/hwsim 在那一台），管理面
（Nuxt + Nitro BFF）通过 `runtimeConfig.mininet.baseUrl` 远程访问。一台宿主**只跑一个仿真实例**。

> 容量口径：90 现有配置承担全部仿真实例，**不因容量再加第二台仿真宿主**。此前讨论过的「另开 VM」
> 只为一件事服务——需要 DFS/自定义 `regulatory.db` 等**内核定制**时，那台机器必须是专用镜像；
> 与容量无关。

| 档位 | 含义 | 判据 |
|---|---|---|
| **P0** | 2.0 首个可用版本必须具备 | 本仓前端已有页面/能力位依赖，或产品明确要求（频谱、SNMP、拓扑、传输） |
| **P1** | 第二阶段 | 参考侧有、2.0 规划有，但首个版本可只读或降级 |
| **P2** | 建议裁掉或永久排除 | 无产品消费方，或与 `NMCPS-ADR-0022` 的安全裁决冲突 |

「本仓有、参考侧没有」的 1.0 独有能力不在这里定档，统一列在 §三 等产品裁决。

**本仓现状列**：`有` = 已实现且语义等价；`部分` = 有实现但资源模型/字段不同；`—` = 未实现。

## 一、资产盘点

### 1.1 参考侧（`_reference/netsim/backend`，`app/` 共 36,961 行）

| 模块 | 行数 | 性质 | 2.0 归属 |
|---|---|---|---|
| `engines/mininet_wifi/engine.py` | 6,483 | 无线建网引擎（基于 `mn_wifi`，**非其副本**） | `engines/wireless/` 自建 |
| `engines/mininet_wifi/snmp_agent.py` | 2,625 | 进程内 SNMP 代理（MIB 投影） | `snmp/agent.py` |
| `engines/mininet_wifi/runtime_editor.py` | 1,404 | 运行态增删节点/链路 | `engines/runtime_editor` |
| `engines/mininet_wifi/runtime_config.py` | 1,296 | 射频/接口/地址运行态配置 | `engines/runtime_config` |
| `engines/mininet_wifi/metrics.py` | 982 | 指标生成 | `metrics/` |
| `engines/mininet_wifi/dot11_mib.py` | 859 | 802.11 MIB 投影 | `snmp/mib/dot11` |
| `engines/mininet_wifi/wired_set_watcher.py` | 659 | 有线 MIB SET 监听（写锁入口） | `snmp/watcher` |
| `engines/mininet_wifi` 其余 | ≈2,000 | LLDP agent/MIB、弱网施加、SSH、网关、物理接口、拓扑 | 分派到 `lldp/`、`weaknet/`、`gateway/` |
| `engines/mininet/`（有线） | 949 | `mininet` 薄封装（engine/metrics/topology/wired_nodes） | `engines/wired/` |
| `engines/dryrun/` | 658 | 无 root 的假引擎（可测） | `engines/dryrun/`（保留，见 §6） |
| `services/` | 5,869 | 网络/仿真/SNMP 引导/弱网/背景流/完整性/场景/NMS | `services/` |
| `routers/` | 2,152 | 17 个薄路由 | `api/` |
| `mibs/*.mib` | 21 个文件 | 纯文本 MIB 资产 | `mibs/`（先做许可审查） |

### 1.2 本仓现状（`services/mininet-api/mininet_gui_backend`，3,138 行）

| 文件 | 行数 | 内容 |
|---|---|---|
| `api.py` | 2,165 | 单文件：Pydantic 模型 + 全部路由 + 全局 `app.net` 操作 |
| `sniffer.py` | 310 | 抓包（tcpdump 驱动） |
| `export.py` | 298 | 导出 JSON / Python 脚本 / 地址规划 |
| `flow_rules.py` | 100 | OpenFlow 流表（Ryu REST） |
| `schema.py` / `nodes.py` / `utils.py` | 244 | 模型、节点包装、工具 |

**关键结论**：本仓现状 ≈ 参考侧 `engines/mininet/`（949 行）的等价物 + 1.0 独有能力（Ryu/流表/抓包/
导出），**完成度约 13%**；`services/`（5,869 行）除网络增删外基本为空，无线与 SNMP 面为零。

**结构差异（必须先裁决，否则逐端点移植会反复返工）**：

| 维度 | 参考侧 `:8001` | 本仓现状 | 影响 |
|---|---|---|---|
| 资源模型 | **会话制**：`POST /api/simulation/sessions` 拿到 `sim_id`，其余路径带 `{sim_id}` | **全局单例**：`app.net` 直接就是那张网，路径无 id | 端点路径不能 1:1 复制，需要 `sessions/{id}` 层 |
| 节点模型 | **统一 node**：`router/switch/ap/station` + `/api/network/nodes` | **按类型分表**：`hosts` / `routers` / `switches` / `controllers` / `nats` | 本仓 BFF 白名单与页面按分表写的，需映射层或改契约 |
| 引擎抽象 | `engines/registry.py` + `base.py`（mininet / mininet_wifi / dryrun 可切换） | 无抽象，直接操作 `Mininet()` | 无线/有线必须并存，抽象层是 P0 |
| 权限 | 无（内网服务） | BFF 侧 6 个能力位 | 能力位映射见 §4.3 |
| 单实例 | 全局 `app.net` + 全局 hwsim radio | 同 | 多租户只能靠「一租户一宿主」，见 `NMCPS-ADR-0021` |

## 二、端点级矩阵

路径均省略上游前缀 `/api`。参考侧共 **131 个端点**；下表按语义归并相邻端点（例如节点四种生命周期合成
一行、`{sim_id}` 子路径合并），每行的 `档` 取其中**最小可行能力**。`目标` 列写本仓落点——BFF 对外前缀
**已定为 `/api/mininet/**`**（`NMCPS-ADR-0022` D11，M1.1 由 `/api/lab/**` 一次改净、不留别名）：与上游
同形，隔离靠「浏览器只拿同源相对路径 + Nitro 是唯一出站点」，不再靠前缀差异表达。

### 2.1 `network`（43 端点，`routers/network.py` 540 行 + `services/network_service.py` 741 行）

| 端点 | 语义 | 本仓 | 档 | 目标 |
|---|---|---|---|---|
| `GET /network` | 网络概览 | 部分 | P0 | `services/network` 聚合 |
| `GET /network/stats` | 网络级统计 | 部分 | P0 | `metrics/` |
| `GET /network/scan-subnets` | 扫描可建节点子网 | — | P2 | 特权探测，90 为内网，无消费方 |
| `GET/POST /network/nodes` | 统一节点列表 / 新建 | 部分（分表） | P0 | 需统一 node 模型（§4.2） |
| `GET/PATCH/DELETE /network/nodes/{id}` | 单节点读 / 改 / 删 | 部分 | P0 | 分表 → 统一路由 + 类型分派 |
| `POST /network/nodes/{id}/{start,stop,restart}` | 单节点生命周期 | 部分（只有全网络） | P0 | `engines/*/node_lifecycle` |
| `POST /network/nodes/{id}/{enable,disable}` | 端口/节点启用停用 | — | P1 | 与 `power` 语义合并前先取证 |
| `POST /network/nodes/{id}/power` | 电源动作 | — | P1 | 同上 |
| `POST /network/nodes/{id}/execute` | 节点内任意命令 | — | **P2 永久排除** | 不复刻（`NMCPS-ADR-0022` 已排除） |
| `GET/POST /network/links` | 链路列表 / 建链 | 有 | P0 | 已有（`POST /links` 支持 `options`→TCLink） |
| `GET/PATCH/DELETE /network/links/{id}` | 单链路读 / 改 / 删 | 部分 | P0 | 已有 `PUT /links` + `delete_link`，语义待对齐 |
| `POST /network/links/{id}/{up,down,toggle,disable,power}` | 链路动作 | 部分（`PATCH /links/{src}/{dst}/state`：`up` / `down` / `toggle`） | P0 | `disable` / `power` 未复刻（语义与 `up`/`down` 重叠）；传输域动作按钮仍登记在 `SIMULATOR_ROUTES` |
| `POST /network/links/{id}/reconfigure` | 重新协商 | — | P1 | 依赖 `tc` + 接口重建 |
| `POST/DELETE /network/runtime/{nodes,links}` | 运行态增删 | — | P1 | 建网后改动，风险最高，需二次确认 |
| `PATCH /network/nodes/{id}/ip` | 运行态改地址 | — | P1 | 地址规划域 |
| `GET/POST /network/runtime/preview` | 变更预演 | — | P1 | 场景筹划域 |
| `GET/PATCH /network/nodes/{id}/radio` | 节点射频读写 | — | **P0（频谱）** | 需 hwsim + `hostapd`，radio 属性为 `band/channel/txpower` |
| `PATCH /network/links/{id}/radio` | 链路射频（信道/带宽） | — | **P0（频谱）** | 同上 |
| `PATCH /network/links/{id}/tc` | 链路限速/时延 | 部分（`PUT /links` options） | **P0（传输）** | 独立端点，避免与属性更新混用 |
| `GET /network/runtime-inventory` | 全量运行态台账 | 部分（分表 + `interfaces`） | **P0** | 拓扑页唯一全量读，禁止逐节点拉 |
| `GET /network/wireless-nodes` | 无线节点清单 | — | **P0（频谱）** | 与 `radio` 配对，频谱页数据源 |
| `GET /network/snmp-accounts` | SNMP 账户列表 | — | P1 | SNMP 面 |
| `POST /network/snmp-v3` | 下发 v3 账户 | — | P1 | 同上 |
| `GET/DELETE /network/overrides/{scenario}` | 场景覆盖项 | — | P1 | 场景编排域（`DESIGN-006`） |

### 2.2 `simulation`（15 端点，`routers/simulation.py` 292 行）

| 端点 | 语义 | 本仓 | 档 | 目标 |
|---|---|---|---|---|
| `GET /simulation/engines` | 可用引擎清单 | — | **P0** | 引擎注册表决定前端渲染哪套编辑能力 |
| `POST /simulation/sessions` | 建会话（选引擎 + 场景） | — | **P0** | 会话层是整个 2.0 的资源根 |
| `GET /simulation/sessions` | 会话列表 | — | P0 | — |
| `GET /simulation/sessions/{id}/status` | 会话状态（`created/building/running/paused/stopped/error`） | — | **P0** | 对应本仓台账 `state` 枚举需扩 `building/paused` |
| `POST /simulation/sessions/{id}/{start,stop}` | 起停 | 有（全网络 start/stop） | P0 | 语义等价，改挂会话 |
| `POST /simulation/sessions/{id}/{pause,resume}` | 暂停/恢复 | — | P1 | 依赖 Mininet 无原生 pause → 需 API 冻结实现 |
| `GET /simulation/sessions/{id}/boot-progress` | 建网进度 | — | P1 | 大网（>10 节点）必须，否则前端只能干等 |
| `POST /simulation/sessions/{id}/trigger` | 事件触发 | — | P1 | 场景演练 |
| `DELETE /simulation/sessions/{id}` | 销毁会话 | 部分（`full_reset`） | P0 | 会话删除 ≠ 全清，需区分 |
| `GET /simulation/sessions/{id}/topology` | 会话拓扑 | 部分（`export_json`） | P0 | — |
| `GET /simulation/sessions/{id}/connectivity` | 连通性矩阵 | 部分（`pingall`） | P0 | `pingall` 只有聚合结果，矩阵需逐对 |
| `GET /simulation/sessions/{id}/diagnostics` | 诊断 | — | P1 | — |
| `GET /simulation/sessions/{id}/build-plan` | 建网计划 | — | P1 | 与 `runtime/preview` 合并实现 |

### 2.3 SNMP 面（`snmp` 2 + `snmp_onboard` 6 + `nms` 6）

| 端点 | 语义 | 本仓 | 档 | 目标 |
|---|---|---|---|---|
| `POST /snmp/topology` | 生成可供 NMS 采集的 SNMP 拓扑 | — | **P0** | `snmp/topology.py`：把台账投影成 MIB 视图 |
| `GET /snmp/tools` | 采集工具可用性 | — | P1 | `snmpwalk`/`snmpget` 探测 |
| `POST/GET /snmp/onboard` | 开通/查询采集凭据 | — | P1 | `snmp/onboard.py`（含 v2c/v3） |
| `GET /snmp/onboard/live` | 在线状态 | — | P1 | — |
| `POST /snmp/onboard/{rotate,revoke}` | 轮换/吊销 | — | P1 | 必须与审计联动 |
| `GET /snmp/onboard/export` | 导出采集配置 | — | P1 | 与「文件」菜单导出风格一致 |
| `GET /nms/vmagent` 等 3 条 | VictoriaMetrics agent 目标管理 | — | P2 | 外部监控栈专用，非本产品能力 |
| `GET/POST /nms/snmp-exporter-reset` | 复位 exporter | — | P2 | 同上 |

### 2.4 观测与拓扑（`lldp` 3 + `metrics` 5 + `protocol` 8）

| 端点 | 语义 | 本仓 | 档 | 目标 |
|---|---|---|---|---|
| `GET /lldp` / `/lldp/summary` / `/lldp/neighbors/{node_id}` | LLDP 邻居 | **不复刻**（邻接由 `GET /api/mininet/links` 推导） | P3→撤销 | `NMCPS-ADR-0027` §7 追补：参考侧 native 模式本就是拿台账合成 MIB（不是 LLDP 实测），其「AP 侧假边」「幽灵 404」是合成路径的产物；真采需 `lldpd` 系统依赖 + 每节点守护，而 OVS 不转发 LLDP 保留组播 |
| `GET /metrics/current/{sim_id}` | 当前指标快照 | 部分（`/stats/{node_id}`） | **P0** | 指标字段对齐 `shared/types/metric.ts` |
| `GET /metrics/history/{sim_id}` | 历史序列 | — | P1 | 需时序存储；先做内存环形缓冲 |
| `GET /metrics/summary/{sim_id}` | 汇总 | — | P1 | — |
| `GET /metrics/export/{sim_id}` | 导出 | — | P1 | — |
| `DELETE /metrics/{sim_id}` | 清历史 | — | P2 | — |
| `GET /protocol/{transport,catalog,recommend}/{scenario}` | 协议对比与推荐 | — | P1 | 传输管控域 |
| `GET/POST /protocol/sessions/{sim_id}/set` | 会话内协议切换 | — | P1 | 依赖引擎侧协议栈注入 |
| `POST /protocol/compare` | 对比执行 | — | P2 | 长任务 + 无消费方 |

### 2.5 其余（`weaknet` 6 + `bgtraffic` 3 + `gateway` 3 + `browser` 4 + `test` 6 + `devices` 8 + `config` 8 + `integrity` 5）

| 端点组 | 语义 | 本仓 | 档 | 目标 |
|---|---|---|---|---|
| `weaknet/presets`、`profiles`、`current`、`sessions/{id}/apply\|clear` | 弱网模板与施加 | — | **P1（传输域）** | `weaknet/`，复用 `tc` 施加器，与 `links/{id}/tc` 共用实现 |
| `simulation/sessions/{id}/bgtraffic` GET/POST/DELETE | 背景流 | — | P1 | 用于吞吐曲线可信度 |
| `gateway/{sim_id}` + `connect\|disconnect` | 外网网关 | — | P2 | 90 为隔离内网，无外网需求 |
| `browser/*` | 无头浏览器抓取 | — | **P2 永久排除** | 不复刻（`SIMULATOR_EXCLUDED_PREFIXES` 已排除） |
| `test/{ping,lldp,iperf,mtr,traceroute,netcat}` | 临时探测工具 | 部分（`pingall`/`iperf`） | P1（仅 `ping`/`iperf`），其余 P2 | 合并本仓 `pingall`/`iperf` 为 `test/*` |
| `devices/*` | 设备库（增删改 + 导入） | — | P2 | 设备库属管理面数据，不入引擎 |
| `configs/*` | 场景配置文件 CRUD + 预览 + SNMP 配置 | — | **P1** | 场景编排域（`DESIGN-006`），落地为 JSON 资产 |
| `integrity/{status,baseline,check,watch/*}` | 拓扑/配置完整性基线 | — | P2 | 运维巡检能力，2.0 首个版本不需要 |

## 三、反向差异（本仓有、参考侧没有）——需产品裁决

| 本仓能力 | 端点数 | 参考侧 | 裁决点 |
|---|---|---|---|
| OpenFlow 流表（`/flows` 增删查） | 4 | 无 | 2.0 的 SDN 能力是否保留？若保留，需在统一 node 模型里给 `switch` 挂 OF 子资源 |
| Ryu 控制器（`/controllers`、`/ryu/apps`、`/associate_switch`、`openflow`） | 6 | 无（参考侧不启控制器） | 若保留，无线/有线引擎都要能挂控制器；若不保留，`lab:operate` 少一类动作 |
| 抓包（`/sniffer/{state,history,start,stop,export}` + `/mininet-ws/sniffer`） | 5 | 无 | 建议保留（已有 W5 实现与 pcap 下载），但需在无线下验证 `tcpdump` 抓 hwsim 接口 |
| `pingall` / `iperf` | 2 | `test/ping`、`test/iperf`（语义相近） | 合并为 `test/*` 一套即可 |
| 导出（`export_json` / `export_script` / `addressing_plan` / PNG） | 3+UI | 无 | 保留；`addressing_plan` 可复用参考侧 `address_planner.py` 的地址分配算法 |
| `import_json` / `full_reset` / `reset` / `node_position` | 4 | 部分（`runtime/preview`、`configs/*`） | `import_json` 与 `configs/*` 是同一件事的两种形态，2.0 应只留一套 |
| NAT 节点（`/nats`） | 2 | `gateway/*`（P2） | 二选一，不要两套 |

> 这张表决定「2.0 是否等于参考侧的复制品」。我倾向：**保留流表/控制器/抓包/导出（1.0 已有且有用），
> 裁掉 NAT 与 `import_json`（被 `configs/*` + `sessions` 覆盖）**。但这需要你确认，不能由矩阵单方面决定。

## 四、四个必须先裁决的结构问题

### 4.1 会话层怎么引入

参考侧的资源根是 `sim_id`，本仓的资源根是「全局唯一那张网」。两条路：

- **S-A（推荐）**：直接采用会话模型，BFF 台账从「网络」升级为「会话」，`app.net` 变成「当前会话的引擎实例」。
  代价：本仓 8 个 `check:lab-*` 脚本与 `lab:ledger` 全部要改口径，`/mininet-ws/*` 票据要加 `sim_id` 绑定。
- **S-B**：保留单例，另外加一层「隐式会话」（只有一个 id），路径兼容两套。
  代价：长期两套路径并存，且与参考侧契约漂移，`contracts:gen` 的 OpenAPI 会分裂。

**判断：如果 2.0 只允许一个仿真实例（90 单机），S-B 的「兼容」没有收益，直接 S-A，一次改透。**

### 4.2 节点模型：分表 vs 统一

本仓 `hosts/routers/switches/controllers/nats` 五张表 + BFF 白名单按分表写；参考侧统一 `nodes` +
`type`。2.0 必须统一，否则无线（`ap`/`station`）无处安放。

建议：**引擎层统一 `node{type, ...}`，API 层保留分表只读视图做兼容**（`GET /hosts` = `nodes?type=host`），
写路径只留统一入口。这样本仓页面改动最小，契约也只有一套。

### 4.3 能力位映射

| 参考侧动作 | 本仓能力位 |
|---|---|
| 读（nodes/links/inventory/lldp/metrics/radio GET） | `lab:read` |
| 建节点/链路、起会话、导入场景 | `lab:create` |
| 起停、单链路 tc/radio、流表、探测 | `lab:operate` |
| 删节点/链路、销毁会话 | `lab:delete` |
| 终端（参考侧 `ssh_agent`） | `lab:terminal` |
| 抓包 | `lab:sniffer` |
| **SNMP 面（`snmp/*`、`snmp-v3`）** | **新增建议 `lab:snmp`**，不得由 `lab:operate` 推导（与 `lab:terminal` 同口径） |

### 4.4 单实例与容量（90 单机）

- `app.net` 与 `mac80211_hwsim` radio 都是**全局资源**：一宿主一实例，多租户只能「一租户一宿主/一实例」。
- 需在 `90` 上确认的容量项（不猜，落地前实测）：`mac80211_hwsim radios=N` 的上限、36 节点会话的
  CPU/内存峰值、`ovs-vswitchd` 线程数、`hostapd` 每 BSS 的进程开销。
- 无线建网必须在**子进程**里做：参考侧 `configureNodes` 会裸 `exit()`，同进程会打死 API。

## 五、阶段划分与验收

**P0 范围汇总**：24 组端点（约覆盖 36 个实际端点），集中在 `network`（13 组）、`simulation`（8 组）、
`snmp`（1 组）、`lldp`/`metrics`（2 组）。这 24 组就是「2.0 首个可用版本」的引擎面边界。

| 阶段 | 内容 | 出口验收 |
|---|---|---|
| **M0 骨架** | 引擎注册表（`registry` + `base` + `dryrun`）、会话层、BFF 远程化（token + `/api/version` 握手）、`engines/{wired,wireless}` 分层与静态守卫 | `pnpm contracts:gen` + `pnpm check:lab-bff`（远端 baseUrl 用例）；**无 root 的 `dryrun` 引擎能让 CI 跑通全链路** |
| **M1 有线全量** | §2.1 与 §2.2 的 P0（统一 node、runtime-inventory、metrics 基础、connectivity 矩阵；LLDP 已撤销，见 §五之三） | `check:lab-real`（90 真机）+ 前端拓扑/场景页端到端 |
| **M2 SNMP 面** | `snmp/topology` + MIB 投影（按 7 类分批）、`snmp/onboard` | 外部 `snmpwalk` 取到一致 OID；`check:lab-bff` 加 SNMP 用例 |
| **M3 无线 + 频谱** | hwsim + `hostapd` + `radio` 读写 + `wireless-nodes`；频谱页（冲突检测纯函数 + 一键消解） | 改信道 → 回读一致 → 冲突消失；`check:lab-real` 增加无线用例（root） |
| **M4 传输** | `links/{id}/tc`、链路动作、弱网（P1） | tc 类 `rate` 与请求值一致（需 root 断言） |
| **M5 编排** | `configs/*`、`runtime/preview`、`build-plan`、`boot-progress` | 场景导入 → 预演 → 建网 → 进度可见 |

**依赖顺序**：M0 → M1 → (M2 ∥ M3) → M4 → M5。M3 不能先于 M1：无线需要统一 node 模型与 runtime-inventory。

## 五之二、裁决与 M0 落地（2026-11-24）

**四项裁决（已定）**

| 待裁决项 | 结论 | 落点 |
|---|---|---|
| §三 反向差异 | 保留流表 / 控制器 / 抓包 / 导出；**裁掉** NAT 与 `import_json`（2.0 用 `configs/*` 重建拓扑，不做 1.0 的 NAT 形状） | M1 / M5 |
| §六-1 许可证与来源 | **移植门禁**：未确认来源与 21 个 MIB 的再分发许可前，不复制参考侧任何代码或 MIB 文本。本仓按行为自写，因此 M1 不受阻；只有「照抄 MIB 定义」这一步要等许可 | M2 之前 |
| §六-2 MIB 范围 | 先做 NMS 验收子集（`system` / `if` / `ip` / `lldp`），其余按批次补 | M2 |
| §六-4 SNMP 形态 | 沿用进程内 Python agent（与台账同源）；端口 161 的冲突与并发写进 `NMCPS-ARCH-007` | M2 |

**M0 已落地（本次提交内容，全部验证通过）**

| 项 | 位置 | 验收 |
|---|---|---|
| 引擎抽象 | `mininet_gui_backend/engines/{base,registry,dryrun,wired,wireless}.py`；`NODE_TYPES` 含 `ap`/`station`，为 M3 预留 | `pnpm check:engines` 7/7 |
| 会话层 | `sessions.py` + `/api/simulation/**` 13 个操作（engines 1、sessions 6、nodes 3、links 3，9 条路径） | `pnpm check:simulation` 17/17（无 root） |
| 入口鉴权 | `auth.py`：`LAB_API_TOKEN` ⇒ HTTP 要 `x-lab-token`；WS 用 `HMAC-SHA256(token, path 与 ts 两行拼接)` 查询串（120 秒、绑定路径）；未设置时只信任回环 | `check:simulation` 401 用例 + `check:engines` 签名用例 |
| BFF 远程化 | `runtimeConfig.mininet.token`、出站 `x-lab-token`（`mininet.ts`）、`GET /api/mininet/version` 握手、`signedLabWsPath()`（`labWsAuth.ts`） | `pnpm check:lab-bff` 157/157，其中 ①b 六条 |
| 静态守卫 | `scripts/check-engines.mjs`：`import mininet` 只允许 `engines/` 与**冻结的 5 个 legacy 文件**（`api.py`/`export.py`/`schema.py`/`nodes.py`/`cli.py`），名单漂移即红 | 同上 |

**M0 的已知边界（不是缺陷，是后续阶段的入口）**

- ~~会话路径还没进 BFF 白名单~~ → **M1 已接（见下）**：`/api/mininet/sessions/**` 12 条端点登记进白名单，
  权限位、台账归属与审计齐备；页面仍走 `/api/mininet/**`（M1.1 迁），两条通道共享同一套台账与锁。
- ~~`wired` 引擎只接管 `start` / `stop`~~ → **M1 已接管统一节点 / 链路**（见下）。
- 非 root 时 `app.net = None`：`Mininet()` 会 `ensureRoot() → exit(1)`，所以后端在无 root 机器上只跑 `dryrun`；
  `LAB_SKIP_STARTUP_CLEANUP=1` 跳过启动 / 关闭的 `mn -c`（非 root 会对别人的进程无限 `pkill` 失败并卡住启动）。
- WS 签名只有**函数级**用例，没有真实 WS 客户端往返（Node 内置 `WebSocket` 不能设头，见 `labWsAuth.ts`）。

**M1 已落地（统一节点 + 会话入口，2026-11-24）**

| 项 | 位置 | 验收 |
|---|---|---|
| 统一节点 / 链路 | `engines/wired.py`：`list_nodes` / `add_node` / `remove_node` / `list_links` / `add_link` / `remove_link` 全部接管；模型类从 `api` 模块按名取（`api.Host`），建网逻辑仍走 legacy `create_*`，错误按 `status_code` 归一成 `EngineInvalidRequest` / `EngineResourceNotFound` | `pnpm check:engines` 7/7（第 7 条跑 `scripts/check-wired-adapter.py`：桩 `api`，无 root / 无 mininet / 无 fastapi） |
| 会话入口 | 白名单新增 12 条 `/sessions/**` → `/api/simulation/**`（`mininetRoutes.ts`，靠 `isSimulationRoute()` 与 1.x 区分）；查询 4 + 写 8，M1 时总计 **22 查询 + 36 写 = 58**（会话侧全是 `/sessions/**`；M1.2 之后写端点为 **37**、总计 **59**） | `pnpm check:lab-bff` ⑯ 十条 + ⓪ 计数断言 |
| 归属 | 台账新增 `session_id`（`shared/types/lab.ts` / `labLedger.parseRecord`）；`POST /sessions` 成功即写回、`DELETE` 解绑（`bindLabNetworkSession()`）；会话路径与台账不一致一律 404（与「不存在」同口径），已绑定时再建 → 409 `lab_session_exists` 且不触达上游 | ⑯「写回台账」「已绑定 409」「未绑定路径 404 零上游请求」 |
| 写路径复用 | 会话写与 1.x 写共用 `handleWrite()`：审计先行、同网络在途写 409、成功后清单收敛与 `state` 写回（`start` → running、`stop` / 删会话 → stopped） | ⑯「清单收敛」「start → running」「审计 allowed + succeeded」 |
| 会话归属由 BFF 写 | `sessionCreateBodyOf()`：客户端只能选 `engine` / `name`，`metadata`（`network_id` / `tenant_id` / `actor_id`）由 BFF 填，客户端伪造无效 | ⑯「metadata 由 BFF 写」 |

**M1 明确不做（不是遗漏）**

- **更新类操作仍走 1.x**：拖动落点、改 IP / 默认路由、OpenFlow 版本、流表、统计、抓包、导出都在
  `/api/mininet/**`。统一模型的「更新」语义（哪些 `attributes` 可写、位置能否与属性同请求改）还没冻结，
  先不发明一套；`Engine` 协议里也刻意没有 `update_node`。
- ~~**前端未迁移**~~ → **M1.1 已收敛读路径**（见下）：页面拓扑只读 `GET /api/mininet/nodes` + `/links`，
  不再并发拉五张分表；会话通道仍未被页面使用（更新类动作仍走 1.x，一个动作只有一个入口，不做双写）。
- **`ap` / `station`**：`NODE_TYPES` 已收，但 `wired` 建它们回 501；无线在 M3。
- **`check:engines` / `check:simulation` 仍未进 `ci.yml`**（要同步 `ci-summary` 期望表与 ⑱/⑳ 断言）。

**M1.1 已落地（统一节点读路径，2026-11-25）**

| 项 | 位置 | 验收 |
|---|---|---|
| 上游统一读 | `api.py` 的 `GET /api/mininet/nodes` → `engines/wired.py` 的 `unified_nodes()`（五类分表的投影：`id/type/name/x/y` 提出、其余进 `attributes`）；会话侧 `WiredEngine.list_nodes()` 先过 `_bound()` 再复用同一投影 | `pnpm lab:check` 38 条 HTTP 路径；`check:engines` 7/7 不变 |
| 白名单 | `mininetRoutes.ts` 新增 `GET /nodes`（`lab:read`），查询 21 → **22**、总计 **58** 条 | `check:lab-bff` ⓪ 计数 + ②「GET /nodes 转发上游并回统一投影」 |
| 页面 | `simulator.vue` 的 `load()` 由五张分表并发改为一条 `/api/mininet/nodes` + `/links`；`rawUnifiedNodesOf()` 只认画布支持的五个 kind（`ap`/`station` 到 M3 才进 `NODE_KIND_ICONS`），字段从 `attributes` 摊平 | `check:ui` 299/299（假上游 `scripts/lib/bff-harness.mjs` 同步给出 `/nodes`） |

**M1.1 明确不做**

- **页面不建会话**：`session_id` 只在 `POST /sessions` 成功后由 BFF 写回台账，页面既不读也不传；1.x 这条
  `/api/mininet/nodes` 就是「默认会话」的读，因此只读会话（只有 `lab:read`）也能拿到拓扑。
- **对账（`NMCPS-ADR-0023`）仍读五张分表**：它要按 kind 逐表比对台账清单，统一投影会把「哪张表少了」这条
  信息抹掉；`check:ui` 11.6b 的 `expectedReconcileReads` 因此保持不变。

**M1.2 已落地（链路运行态面，2026-11-25）**

拓扑监控页的链路动作（断开 / 恢复 / 来回切）原先只存在于 `:8001`（`POST /network/links/{id}/{up,down,toggle}`）。
这一批把「此刻通不通」补进 mininet 引擎面，页面切读路径时才有可打的端点（`NMCPS-ADR-0027` §4 R8 的第 2 个前置）。

| 项 | 位置 | 验收 |
|---|---|---|
| 写端点 | `api.py` 的 `PATCH /api/mininet/links/{src_id}/{dst_id}/state`（`{state: up|down|toggle}`）：两端接口 `ifconfig`，`toggle` 由**服务端**按当前状态取反；网络未启动回 `400`、链路不存在回 `404` | `pnpm lab:check` 新增一组桩断言（未启动 400 / 未知链路 404 / 两次 toggle 先 `down` 再 `up` / 两端都调用 `ifconfig`） |
| 读端点 | `GET /api/mininet/links` 每项加 `status`：`up` / `down` / `unknown`（网络未启动恒 `unknown`，不拿停网前的状态冒充运行态）；`engines/wired.py` 的 `list_links()` 透传同一字段 | `check:lab-bff` ⑧ 两条（PATCH 到达上游 + `state` 原样 + 回上游算出的 `status`；无 `lab:operate` 403 且零上游请求） |
| 生命周期 | 状态是**运行态**：`stop` / `full_reset` 清空、建链从 `up` 起算、删节点 / 删链路一并摘除；不改 `app.link_attrs`（`bw` / `delay` / `loss` 仍归 `PUT /links`，停网重建后仍生效） | `pnpm lab:check`；`pnpm contracts:gen` 快照更新 |
| 白名单 | `mininetRoutes.ts` 新增 `PATCH /links/{src_id}/{dst_id}/state`（`lab:operate`），写 36 → **37**、总计 **59**；`GET /api/mininet/channel` 的 `endpointCount` 同步 | `check:lab-bff` ⓪ 计数 / ① `endpointCount === 59` |

**M1.2 明确不做**

- **`disable` / `power`**：参考侧与 `up` / `down` 语义重叠（都落到接口状态），2.0 只复刻三个动作，
  多余动作不出现在页面上，也不另开端点。
- **页面切换**：`layers/topology` 的拓扑监控页仍读 `:8001`（`/api/sim/**`）。原本记作「R8 最后一个前置」的
  **LLDP 面已撤销**（见 §五之三）：邻接改由 `/links` 推导，页面切换不再有引擎面前置。

## 五之三、LLDP 面撤销（2026-11-25，`NMCPS-ADR-0027` §7 追补）

结论：**不建 `/api/lldp/summary` / `/api/lldp/neighbors/{node_id}`，不引入 `lldpd`**；页面邻接由
`GET /api/mininet/links` + 现役纯函数 `topologyNeighborsOf()`（`app/utils/graph/topologyNodeFacts.ts`）推导。

| 依据 | 事实 |
|---|---|
| 参考侧不是 LLDP 实测 | `_reference/netsim/.../lldp_agent.py` 的 native 模式注释即「基于真实拓扑构建 LLDP-MIB 数据（无需额外守护进程）」，实现是把台账链路拼成 `lldpRem*` 字段；`shared/types/simulator.ts` 记的「实测原样」是**合成结果**的形状 |
| 合成路径的已知缺陷 | `_reference/netsim/docs/已知问题-AP侧LLDP假边.md`（假边）、`docs/backlog/2026-09-21-lldp-ghost-404.md`（未知节点 200 + 空数组） |
| 真采代价 | 宿主无 `lldpd`（`which lldpd` 空）、需每节点命名空间一个守护；交换机是根 netns 的 OVS，只做二层转发，LLDP 保留组播 `01:80:C2:00:00:0E` 默认不转发不上送，交换机身份也无处可取 |
| 与既有口径的冲突 | 没测过的读数只能回 `unknown`（M1.2）；合成邻接会给 `up` + `ttl: 120`，等于编数据 |

字段落差照实承认：`ttl` / `discovered_at` / `sys_name` / `chassis_id` / `mib_oids` 无替代品，页面卡片切过去时
只展示 `neighbor_id` / 名称 / 两端接口 / 链路状态（`up` / `down` / `unknown`），文案改叫「拓扑邻接」。
`SIMULATOR_ROUTES` 里的两条 `/api/lldp/*` 是 1.0 通道现状，随页面切换与 `check:lab-bff` ⑨-6 一起退役。

## 六、未决问题（阻塞项在前）

1. **许可证与来源**（裁决：移植门禁，见 §五之二）：参考侧代码与 21 个 MIB 的再分发许可未确认前不复制；
   按行为自写不受阻，**照抄 MIB 定义**要等这一步。
2. **MIB 范围**（已裁决）：先做 NMS 验收子集（`system` / `if` / `ip` / `lldp`），其余分批补。
3. **`dryrun` 引擎是否保留**：保留（已落地）。它是唯一能在无 root CI 上验证 API 语义的手段，
   `pnpm check:simulation` 与 `pnpm check:engines` 都靠它。
4. **SNMP 实现形态**（已裁决）：沿用进程内 Python agent（`snmp_agent.py` 的形态），与台账天然一致；
   端口 161 的冲突与并发约束写进 `NMCPS-ARCH-007`。
5. **`.bak-*` 热修残留**（`engine.py` 5 个、`runtime_config.py` 2 个、`snmp_agent.py` 2 个…）：
   一律视为 bug 线索，**不作为需求**。移植前先确认主线版本，避免把已修 bug 带进来。
6. **90 的部署形态**：确认是 systemd unit（`User=labrun` + `AmbientCapabilities`）还是直接 root 启动；
   若需要 DFS/自定义 `regulatory.db`，那台机器就是专用镜像，本仓只提供安装脚本与验收。

## 七、下一步

1. ~~「废弃 `:8001`」写进 `NMCPS-ADR-0027`（引擎面定位 + R1–R8），把 P0 边界冻结成受治理文档。~~ **已完成（2026-11-25）**：`NMCPS-ADR-0027`
   （`layers/content/collections/cn/records/adr/adr-0027.md`）= D1–D7 引擎面定位（唯一引擎面 / 统一 `NodeSpec` / 会话为资源根 /
   注册表不回落 / 能力位不随参考侧扩张 / 一宿主一实例 fail closed / 移植门禁）+ R1–R8 退役与不复刻清单
   （R1–R7 逐条对应 `SIMULATOR_EXCLUDED_PREFIXES`，R8 是 `/api/sim/**` 通道退役，含迁移顺序与完成判据）。
2. P0 范围折进 `NMCPS-DESIGN-008`（**已登记**，2026-11-25，`layers/content/collections/cn/architecture/2.domain/simulation.md`）；部署 / 特权 / token 与端口约束折进 `NMCPS-ARCH-007`（**已登记**，2026-11-25，`layers/content/collections/cn/architecture/1.architecture/lab-deployment-architecture.md`）。
3. 起 M1：统一 node 模型 + `/api/simulation/sessions/{id}/nodes` 接管有线 CRUD，
   同时把会话路径登记进 BFF 白名单（含权限位、台账归属、审计），前端从 `/api/mininet/**` 迁过来。
   **进度（2026-11-24）**：统一节点 / 链路与白名单已落地（见 §五之二「M1 已落地」）；
   剩余 = 更新类操作（位置 / IP / 默认路由 / OpenFlow / 流表）与前端读路径切换，记为 M1.1。
4. `check:engines` / `check:simulation` 进 CI：前者零依赖可直接进 quality job，
   后者需要 mininet 与 uvicorn，挂在 lab 专用 job（与 `lab:check` 同环境）。
5. **R8 页面切换（可开始）**：读路径三项已就绪（`/nodes`、`/links`、邻接由 `/links` 推导，LLDP 面已撤销见 §五之三）。
   顺序按 `NMCPS-ADR-0027` §4：先切读（含把「LLDP 邻居」卡改名「拓扑邻接」并按 `topologyNeighborsOf()` 出数），
   再切能力位（`GET /api/mininet/channel`），最后删 `/api/sim/**` 与 `check:lab-bff` ⑨-6；`check:ui` 的 11.x 相邻用例
   需同步改写（假上游改供 `/api/mininet/links`，断言不再看 `data-lldp-*` 的 LLDP 语义）。


