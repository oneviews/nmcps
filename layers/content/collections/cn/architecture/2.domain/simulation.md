---
docId: NMCPS-DESIGN-008
title: "仿真引擎面领域基准"
description: "domain.simulation 的 Tier 2 设计基准：仿真实例的资源根（会话）、引擎抽象、统一节点投影、对外通道与能力位映射、阶段边界。本文是 domain.simulation 域的唯一权威。"
excerpt: "仿真引擎面的会话层、统一节点投影与能力位边界。"
keywords:
  - "simulation"
  - "仿真"
  - "实验台"
  - "引擎"
  - "会话"
tier: 2
authority: normative
scope:
  - domain.simulation
status: baseline
version: 0.1.0
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
  - NMCPS-GOV-003
  - NMCPS-ARCH-001
  - NMCPS-DESIGN-006
createdAt: "2026-11-25"
updatedAt: "2026-11-25"
icon: "carbon:network-4"
tags:
  - "领域基准"
  - "仿真"
  - "引擎"
  - "会话"
---

# 仿真引擎面领域基准（NMCPS-DESIGN-008）

> **本文职责**：`domain.simulation` 的唯一权威——把「一个仿真实例如何被创建、读写、起停与销毁」定成可验收的接口边界。场景建模本身见 `NMCPS-DESIGN-006`；管理面到引擎面的唯一出站通道见 `NMCPS-ARCH-001`。
> **目标读者**：实施工程师 / AI 助手。

---

## 一、定位

仿真引擎面是实验台的**执行面**：它持有 Mininet（有线，后续无线）实例，对外只暴露「会话 / 节点 / 链路 / 起停」四类事实。管理面（Nuxt + Nitro BFF）是唯一消费方；浏览器不直连引擎面。

引擎面部署在专用实验机（一台宿主一个实例），因此设计上**不追求多实例并发**：隔离靠「一租户一宿主」（`NMCPS-ADR-0021`），不靠单进程内多网络。

---

## 二、资源根：会话

2.0 的资源根是**会话**（`sim_<12 位十六进制>`），不是「全局唯一那张网」。

| 项 | 约定 |
| :--- | :--- |
| 存储 | 进程内表（`mininet_gui_backend/sessions.py`），进程重启即清空，不做持久化 |
| 上限 | `MAX_SESSIONS = 32`，用完必须显式删除，避免「点一次建一个」蚕食端口与内存 |
| 字段 | `id` / `engine` / `name` / `state` / `created_at` / `updated_at` / `metadata` / `last_error`（仅在非空时出现） |
| 归属元数据 | `metadata`（`network_id` / `tenant_id` / `actor_id`）**只由 BFF 写**；客户端填的会被覆盖 |
| 1.x 等价 | `/api/mininet/**` 是「默认会话」的同义词：只有一张网时不传 `session_id`，两条通道共享同一实例与同一把在途写锁 |

会话路径与台账 `session_id` 不一致一律按「不存在」处理（404），与「越权」同口径，避免用状态码枚举别人的会话。

---

## 三、引擎抽象

引擎按名字登记（`engines/registry.py`），**不做回落**：名字没登记就报「未知引擎」，不会退化成「随便挑一个能用的」—— 回落会把「要无线却拿到有线」变成静默的错误拓扑。

| 引擎 | 职责 | 现状 |
| :--- | :--- | :--- |
| `wired` | 有线：起停 + 统一节点 / 链路 CRUD | 已接管（M1） |
| `wireless` | 无线：`ap` / `station` | 建节点回 501，M3 落地 |
| `dryrun` | 无 root 的假引擎，供 CI 跑通整条会话链路 | 保留，是语义回归的唯一无特权手段 |

- 建网实现不在引擎里重写：`TCLink` / OVS 端口 / `switch_fail_mode()` 仍由 legacy 建网函数提供，引擎只做**模型映射与错误归一**（`engine_invalid_request` / `engine_resource_not_found` / `engine_conflict` / `engine_unavailable`）。
- `import mininet` 只允许出现在 `engines/` 内；`api.py` / `export.py` / `schema.py` / `nodes.py` / `cli.py` 是冻结的 legacy 名单，名单漂移由静态守卫拦截，不新增。
- 无线依赖只做存在性探测（`find_spec("mn_wifi")`），顶层 import 会让无无线依赖的机器起不来后端。

---

## 四、统一节点与链路

节点是**统一模型**，不是五张分表：

```json
{ "id": "h1", "type": "host", "name": "h1", "x": 120, "y": 80,
  "attributes": { "ip": "10.0.0.1/8", "mac": "…", "defaultRoute": "…" } }
```

| 规则 | 说明 |
| :--- | :--- |
| 提出字段 | `id` / `type` / `name` / `x` / `y` 在顶层，其余一律进 `attributes` |
| 排序 | 按 `id` 升序，读两次顺序稳定 |
| 唯一投影 | 投影只写在 `engines/wired.py` 的 `unified_nodes()` 一处；会话侧 `list_nodes()` 先校验会话绑定，再复用同一函数 |
| 1.x 读 | `GET /api/mininet/nodes` 是「默认会话」读，**不判会话绑定**，因此只有 `lab:read` 的会话也能加载拓扑 |
| 类型集合 | `host` / `router` / `switch` / `controller` / `nat`（`ap` / `station` 已进 `NODE_TYPES`，画布支持要到 M3） |
| 更新 | 统一模型的「更新」语义未冻结，`Engine` 协议**刻意没有** `update_node`；位置 / IP / 默认路由 / OpenFlow / 流表 / 统计仍走 1.x 的分表端点 |

分表只作为 legacy 兼容视图存在（`GET /hosts` 等形式），写路径不因分表存在而分叉。

---

## 五、对外通道与能力位

浏览器只访问 BFF 的同源 `<prefix>/**` 与 `<prefix>-ws/*`，前缀与上游同形（`NMCPS-ADR-0022` D11）：不带主机的路径指 BFF，带引擎面主机与端口的是上游直连（只允许自检脚本）。

| 通道 | 端点 | 权限位 |
| :--- | :--- | :--- |
| 会话读 | `GET /sessions`、`/sessions/{id}`、`/sessions/{id}/{nodes,links}` | `lab:read` |
| 会话建 | `POST /sessions`、`POST /sessions/{id}/nodes`、`POST /sessions/{id}/links` | `lab:create` |
| 起停 / 删链路 | `POST /sessions/{id}/start`（`lab:create`）、`/stop`（`lab:operate`）、`DELETE /sessions/{id}/links/{link_id}`（`lab:operate`） | 逐条登记 |
| 销毁 / 删节点 | `DELETE /sessions/{id}`、`DELETE /sessions/{id}/nodes/{node_id}` | `lab:delete` |
| 终端 / 抓包 | `<prefix>-ws/{terminal,logs,monitor,sniffer}` | `lab:terminal` / `lab:sniffer`，**不得**由 `lab:read` / `lab:operate` 推导 |

- 白名单每行只有 `method` / `template` / `upstream` / `permissions` 四个键，靠 `upstream` 前缀分辨两套上游。
- 写路径共用一套：审计先行（allowed / denied 都落盘）、同网络在途写回 409、成功后收敛资源清单与台账 `state`。
- WebSocket 一律先换一次性票（60 秒、绑定种类与目标），BFF 验票后才建上游连接；token 不进查询串、不进日志、不回传。

---

## 六、台账可见的运行态

台账 `state` 是 BFF 自己的枚举（`creating` / `running` / `stopped` / `error`），在 `start` / `stop` / `full_reset` **上游成功之后**写回，并在读路径与上游布尔对账：上游 `false` 而台账 `running` → 回 `stopped`；读不到则保持原值，不猜。

增删节点 / 链路、流表、`pingall` / `iperf` **不**写运行态：它们可能「网没起也成功」，用它改运行态会伪造事实。

---

## 七、阶段与验收

| 阶段 | 范围 | 出口验收 |
| :--- | :--- | :--- |
| M0 | 引擎注册表、会话层、BFF 远程化（token + 握手）、引擎分层与静态守卫 | 契约生成 + BFF 自检；无 root 的 `dryrun` 让 CI 跑通全链路 |
| M1 | 统一节点 / 链路 CRUD、会话路径进白名单、台账 `session_id` 归属、统一读路径 | 自检计数与真机回归（起停、改带宽、真 iperf） |
| M2 | SNMP 面（拓扑投影、开通凭据） | 外部 `snmpwalk` 取到一致 OID |
| M3 | 无线 + 频谱（hwsim / `hostapd` / radio 读写） | 改信道 → 回读一致 → 冲突消失（需 root） |
| M4 | 传输（链路 tc、链路动作、弱网） | tc 类 `rate` 与请求值一致（需 root） |
| M5 | 编排（场景配置、预演、建网进度） | 导入 → 预演 → 建网 → 进度可见 |

依赖顺序：M0 → M1 →（M2 ∥ M3）→ M4 → M5。M3 不得先于 M1：无线需要统一节点模型与全量运行态台账。

---

## 八、不承载

- **不做参考侧 `:8001` 的 P2 项**：节点内任意命令执行（`execute`）、无头浏览器抓取（`browser/*`）、VictoriaMetrics agent 管理（`nms/*`）、完整性巡检（`integrity/*`）、子网扫描（`scan-subnets`）。
- **不做双写**：同一动作只有一个入口。页面已收敛读路径到统一节点读，写与更新类仍走 1.x，会话通道不被页面直接调用。
- **不做会话持久化**：会话是运行态事实，重启即失效；需要长期留存的是台账与审计，不是会话表。
- **不做多租户并发**：单实例宿主上多租户只能靠「一租户一宿主」；多用户并发操作的隔离不在本文范围。

---

## 九、变更记录

| 日期 | 版本 | 变更 |
| :--- | :--- | :--- |
| 2026-11-25 | 0.1.0 | 首版：固化仿真引擎面领域基准（会话为资源根、引擎抽象、统一节点投影、对外通道与能力位、台账运行态、阶段边界）。对应已落地的 M0 / M1 / M1.1 与其余阶段入口。 |
