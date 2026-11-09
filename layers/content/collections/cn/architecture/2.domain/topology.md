---
docId: NMCPS-DESIGN-001
title: "拓扑监控领域基准"
description: "拓扑监控域（domain.topology）的 Tier 2 设计基准：网络设备与链路的拓扑可视化、设备/链路监控指标采集与展示、三个子页的目标页清单与数据源、四个自研渲染组件的图形形态、空态与降级态、可断言的验收口径。本文是 domain.topology 域的唯一权威。"
excerpt: "网络设备与链路的拓扑可视化、设备/链路监控指标的领域设计基准（含数据源、图形形态、空态与验收断言）。"
keywords:
  - "topology"
  - "拓扑"
  - "监控"
  - "领域基准"
  - "TopologyCanvas"
  - "TrendChart"
tier: 2
authority: normative
scope:
  - domain.topology
status: baseline
version: 0.17.17
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
  - NMCPS-GOV-003
  - NMCPS-ARCH-001
  - NMCPS-ARCH-002
  - NMCPS-ARCH-006
createdAt: "2026-10-25"
updatedAt: "2026-11-09"
icon: "carbon:cloud-monitoring"
tags:
  - "领域基准"
  - "拓扑"
  - "监控"
---

# 拓扑监控领域基准（NMCPS-DESIGN-001）

> **本文职责**：`domain.topology` 域的唯一权威，定义拓扑监控——网络设备与链路的拓扑可视化、监控指标采集与展示，以及三个子页的目标页清单、数据源、图形形态、空态降级与验收断言。通信采集见 `NMCPS-ARCH-001`，数据存储见 `NMCPS-ARCH-002`，页面结构与工具栏口径见 `NMCPS-ARCH-006`，图形自绘与第二数据源的裁决见 `NMCPS-ADR-0019`（layers/content/collections/cn/records/adr/adr-0019.md）。
> **目标读者**：实施工程师 / AI 助手。

---

## 一、定位

拓扑监控是网络管理系统的「观测面」：以图形化方式呈现设备节点与链路关系，实时监控设备与链路的运行指标，为故障定位与容量规划提供依据。

---

## 二、功能范围

| 子页面 | 功能 | 2.0 落点 |
| :--- | :--- | :--- |
| monitor | 网络拓扑图与全局监控总览 | `layers/topology/app/pages/topology/monitor.vue` |
| link-metrics | 链路指标（带宽、时延、丢包） | `layers/topology/app/pages/topology/link-metrics.vue` |
| device-metrics | 设备指标（CPU、内存、端口流量） | `layers/topology/app/pages/topology/device-metrics.vue` |

三个页面**共用一套取数内核**：拓扑结构来自 8888 `/topology/graph`，指标序列来自 `/metric/datapoint`；页面差异只在「选中对象是节点还是链路」与「展示哪组指标编码（`metric_code`）」。

---

## 三、关键数据实体

| 实体 | 说明 |
| :--- | :--- |
| 设备节点（Device Node） | 路由器/交换机/防火墙等网元 |
| 链路（Link） | 设备间的物理/逻辑连接 |
| 拓扑图（Topology） | 节点 + 链路的可视化模型 |
| 指标（Metric） | 设备/链路的时序监控数据（存 TSDB） |

---

## 四、领域边界与依赖

- **上游依赖**：设备采集（SNMP，见 `NMCPS-ARCH-001`）、指标存储（TSDB，见 `NMCPS-ARCH-002`）。
- **消费方**：dashboard（总览）、scenario（建模输入）。
- **不承载**：设备配置下发（属 device 域）、告警规则管理（属 system 域）。

---

## 五、演进路线

1. 拓扑图渲染（Canvas/SVG 节点 + 链路）。
2. 设备类型图标自动匹配（按设备类型选图）。
3. 设备/链路指标实时刷新与告警联动。

---

## 六、数据源

### 6.1 主数据源（8888 统一网关，经 BFF `[...slug]` 网关，需登录态）

| 用途 | 端点（8888 `/api/v1`） | 关键参数 | 备注 |
| :--- | :--- | :--- | :--- |
| 拓扑结构 | `GET /topology/graph` | `tenant_id` / `include_virtual` / `include_status` / `group_by` | 实测返回 36 节点 / 48 链路 / 3 个组合；`include_status=true` 时节点自带状态色 |
| 设备台账（列表侧栏） | `GET /metric/device` | `page` / `page_size` / `device_code` / `codes` / `role` / `vendor` / `status` / `include` | 分页信封里的 `total` 作为计数来源 |
| 链路台账 | `GET /metric/link` | `page` / `page_size` / `link_id` / `device_code` / `medium` / `status` / `include` / `from` / `to` | `from` / `to` 为时间窗（ISO 字符串） |
| 指标序列 | `GET /metric/datapoint` | `mode` / `mgmt_ip` / `metric_code` / `from` / `to` / `step` / `rate` / `ips` / `codes` | 返回 VM 风格 matrix（`metric` 标签 + `values` 点对），取数口径归 `NMCPS-CONTRACT-002` |
| 指标目录（选择器） | `GET /metric/definition` | `page` / `page_size` / `metric_group` / `keyword` | 决定指标下拉里能选哪些 `metric_code` |
| 可用指标名 | `GET /metric/name` | `mgmt_ip` / `ips` | 单设备可用指标名清单；与 `definition` 二选一优先用本项 |
| 告警叠加 | `GET /alarm/alarm-events` | `page` / `page_size` / `severity` / `status` / `target_type` / `target_id` / `first_triggered_at_from` / `first_triggered_at_to` | 2026-11-07 实测：`target_type` **只有 `device`**（全库无 `node`），`target_id` 就是设备管理 IP = 拓扑节点 `id`，直接 join 不需要映射表；规则管理不属本域 |

### 6.2 第二数据源（8001 仿真平台，经 BFF `server/api/sim/**` 白名单通道）

仿真控制面只在**拓扑写操作**与**仿真运行态**上补充 8888 没有的能力。该通道由 `NMCPS-ADR-0019` §4 定义：独立 `runtimeConfig.simulator`、模板白名单、`allowWrite` 默认 `false`、不发 `Authorization`。

| 用途 | 端点（8001，只读） | 说明 |
| :--- | :--- | :--- |
| 仿真运行态台账 | `GET /api/network/runtime-inventory` | **一次取全量**：`{ running, scenario, overrides:{…}, nodes[], links[] }`，实测返回 36 节点 / 48 链路；节点按设备标识与 8888 节点对齐后叠加「仿真中」标记，链路给现场 up/down |
| 仿真统计 | `GET /api/network/stats` | `node_count` / `link_count` / `nodes_by_type` / `links_by_type` / `nodes_online` / `links_up`，供页头徽标 |
| 邻接发现 | `GET /api/lldp/summary`、`GET /api/lldp/neighbors/{node_id}` | 2026-11-07 实测：summary 是 `{ node_count, neighbor_entry_count, mode, mib_standard, lldp_mib_oid, local_sys_name, local_sys_desc, local_chassis_id }`（**扫描规模 + 一台示例端点**，不是按交换机分组）；邻居项是 `{ neighbor_id, neighbor_type, neighbor_name, local_interface, remote_interface, chassis_id, chassis_id_subtype, port_id, port_id_subtype, port_descr, sys_name, sys_desc, ttl, link_type, link_status, discovered_at, mib_oids }`（见 §6.13） |
| 运行态预览 | `GET /api/network/runtime/preview` | 增删前的候选拓扑预览 |

> 端点动词以实测 `openapi.json` 为准：`/api/network/runtime/nodes` 与 `/api/network/runtime/links` 是 **POST（新建，属写）**，`/api/network/runtime/nodes/{node_id}`、`/api/network/runtime/links/{link_id}` 是 **DELETE（移除，属写）**——只读一律走 `runtime-inventory`，不要按 `runtime/nodes` 取列表（会得到 405）。`NMCPS-ADR-0019` §4.2 已于 2026-11-05 按同一份实测修正。

| 用途 | 端点（8001，写，`write: true`） | 说明 |
| :--- | :--- | :--- |
| 链路动作 | `POST /api/network/links/{link_id}/{down,up,toggle,disable,power,reconfigure}`、`PATCH /api/network/links/{link_id}/{tc,radio}` | 每个动作一个按钮，需二次确认 + 审计日志；`tc` / `radio` 是 **PATCH**（参数化改属性），不是 POST |
| 节点动作 | `POST /api/network/nodes/{node_id}/{start,stop,restart,power}`、`PATCH /api/network/nodes/{node_id}/{radio,ip}` | 同上；`radio` / `ip` 为 **PATCH** |
| 运行态增删 | `POST /api/network/runtime/{nodes,links}`、`DELETE /api/network/runtime/{nodes,links}/{id}` | 直接改动正在跑的仿真，风险最高，需「允许写入」且单独二次确认 |

**写入口落码范围（P1-B，2026-11-06；链路动作 0.16.0 补齐）**：`monitor` 工具栏右区放**两组**动作 —— 选中节点时是两个节点动作（重启 / 停止），选中画布上一条链路时是三个链路动作（断开 / 恢复 / 翻转，`down` / `up` / `toggle`）；两组共用同一套「能力位 → 二次确认 → 动作 → toast + 刷新」流程，确认框的 `pendingScope` 区分 `node` / `link`。运行态增删仍**不设入口**（需单独二次确认与更高权限，留 P1）。

| 页面入口 | 上游端点 | 前置条件 | 交互 |
| :--- | :--- | :--- | :--- |
| 重启节点 | `POST /api/network/nodes/{node_id}/restart` | 选中节点 + 该节点在仿真运行态里（`runtime-inventory` 对齐得到 `marker.simId`）+ 通道 `writeEnabled` | `UModal` 二次确认（写明仿真名与动作）→ 成功 `useToast` 提示 + 立刻 `refresh()` |
| 停止节点 | `POST /api/network/nodes/{node_id}/stop` | 同上 | 同上 |
| 断开 / 恢复 / 翻转链路 | `POST /api/network/links/{link_id}/{down,up,toggle}` | 选中画布上一条链路 + 该链路在仿真运行态里（`simulatorLinkFor(link).simId`）+ 通道 `writeEnabled` | `UModal` 二次确认（写明两端名称、**仿真链路 id**、动作「不可撤销 / BFF 不保留副本 / 不会自动回滚」）→ 成功 `useToast`「链路已断开 / 已恢复 / 状态已翻转」+ 立刻 `refresh()` |
| 运行态增删 | 见上表 | 未开放（P1） | 不设按钮；开放时按同一套「能力位 → 二次确认 → 审计」口径落地 |

客户端**不猜**写权限：页面从 BFF 自己的能力探针 `GET /api/sim/channel` 读 `{ configured, writeEnabled, timeoutMs, readinessPath }`。该端点只回能力位、**不回 `baseUrl`**（不把上游地址泄露给浏览器）；`writeEnabled=false` 时按钮 `disabled` 且页面**不发**写请求——BFF 的 405 是第二道闸，不是第一道。`node_id` 取 `marker.simId`（仿真侧 id），**不用** 8888 的节点 id（前者是仿真引擎的键，后者是管理 IP）。

### 6.3 本地引擎

**本域不使用 BFF 本地引擎**（`NMCPS-ADR-0019` §5.2 未登记本域三元组）。布局计算是客户端纯函数（`app/utils/graph/*`：`topologyLayout` / `topologyLayering` / `topologyRadialLayout` / `topologyTierTreeLayout` / `topologyEdgeStyle`），输入节点与链路数组、输出坐标，不含任何状态。

### 6.4 取数约束

1. **一处出站**：8888 数据只经 `useApi()` → BFF 网关；页面不直连上游、不自建 `$fetch`。
2. **轮询**：拓扑与指标默认 30s 刷新，`document.visibilityState !== "visible"` 时暂停，恢复可见时立即补一次。
3. **时间窗**：指标页默认近 1 小时、`step` 随窗口自动选取；时间窗选择器按 `NMCPS-ARCH-006` §4.1 用「一个摘要按钮 + `UPopover`（预设列 + `UCalendar range`）」，不出现两个并排 `datetime-local`。
4. **失败分类**：`ApiError.code` 为 401 走统一刷新；`5xx` 展示错误态并保留重试；`code=0` 且 `data` 为空按空态处理，**不**渲染成错误。

### 6.5 指标趋势取数口径（A3，2026-11-06 落码；2026-11-08 折线归指标页）

监控页**不再自绘折线**：`monitor` 的详情栏只给一枚深链按钮（`topology-node-metrics`，带所选节点的管理 IP），点它跳到 `device-metrics`，序列在那里画（§6.6）。三条理由：

- 一张图里既画拓扑又画一段时间序列，两件事都读不准 —— 拓扑要「谁连着谁」，序列要横轴时间；
- 监控页一旦自己挂取数，失败语义就得在原地再实现一遍，三个入口三份口径（A13 / A14 修的就是这种漂移，A15 现在钉的是「监控页不编」）；
- 深链带的是**管理 IP**（拓扑侧真有的身份），指标页用自己已取到的台账把它解析成 `device_code` 再写 `?id`（§6.15 要求 5）。

两步取数（口径现由指标页承担，均经 BFF 网关，页面不直连上游）：

| 步骤 | 端点（8888 `/api/v1`） | 参数 | 说明 |
| :--- | :--- | :--- | :--- |
| ① 挑编码 | `GET /metric/name` | `mgmt_ip` = 目标设备的**管理 IP** | 该设备可用指标名清单（双形态，归一口径见 `NMCPS-CONTRACT-002` §七）；只排除采集器自监控命名空间（`up` / `scrape_*`），**不按名字猜类型**。清单可以是**空**而设备仍有序列（2026-11-08 实测 24/36 台），因此回落目录判为 `numeric` 的第一个名字（§6.6 的并集口径） |
| ② 取序列 | `GET /metric/datapoint` | `mode=range` / `mgmt_ip` / `metric_code` / `from` / `to`（ISO 字符串）/ `step=60` | 近 1 小时窗口；`rate` 不传 —— 类型未定就不开速率（`NMCPS-CONTRACT-002` §6.5） |

- **取数内核**：`layers/topology/app/composables/useMetricSeries.ts`（通用的两步请求 + 目录 join + 状态 + 竞态序号）。监控页在 2026-11-08 之后**没有自己的取数层**（`useNodeTrend.ts` 已删）：它不发 `/api/metric/*`，也就不存在「页面级失败文案」。解包 / 升序 / 去重 / 降采样全部落在 `app/utils/chart/metricSeries.ts` 的纯函数里（`NMCPS-CONTRACT-002` §6.6），三分类落在 `app/utils/metric/metricCatalog.ts`（`NMCPS-CONTRACT-002` §八），组件只负责画。
- **图形**：`app/components/Graph/TrendChart.vue`（SVG 折线 + 面积填充；`vector-effect` 让线宽不随拉伸变化；点数 > 2 × 列宽时按列保留 min/max，保住毛刺）。
- **投递口是详情栏的那枚按钮**：深链由 `app/utils/metric/metricDeepLink.ts` 生成（`?mgmt_ip=` → 目标页解析成 `?id=`）；节点没有管理 IP 时按钮置灰 + tooltip 说明原因 —— 不发一枚「点了到空页」的按钮。
- **失败语义全部归指标页**（§6.7 的 S3 / S7）：监控页既不出错误块，也不写「该时间窗内无采集数据」—— 它手上没有这份数据，说哪一句都是编（A15）。
- **类型判定**（指标页）：文本 / 事件指标不进折线面板（`selectable = false`），判定顺序见 `NMCPS-CONTRACT-002` §8.3；目录不可用时退回 name-only（只跳过 `up` / `scrape_*`），此时文本指标仍可能落成直线 —— 缺口如实保留，不用命名猜测绕过去。

### 6.6 指标页取数口径（device-metrics / link-metrics，2026-11-06 落码）

两页共用一套「台账 → 选中一条 → 指标选择器 → `TrendChart`」骨架（`app/components/Layout/Split.vue` 两栏 + `useRecordSelection` 把选中记在 `?id`）：

| 页面 | 台账端点 | 选中后取数 |
| :--- | :--- | :--- |
| `device-metrics` | `GET /metric/device`（`page` / `page_size`；信封的 `total` 作计数） | `mgmt_ip` = 该设备的 `mgmt_ip` |
| `link-metrics` | `GET /metric/link`（同上） | `mgmt_ip` = 链路 **source 端设备**的 `mgmt_ip`（另取一次 `/metric/device` 建 `device_code → mgmt_ip` 映射）+ **过滤键 `ifIndex` = `identity.source.if_index`** |

- **左栏行文案**（两页都是「主标识一行 + 次级信息一行」，口径见 `NMCPS-ARCH-006` §3.6）：设备页 = 设备名 + `管理 IP · 邻居 N · 端口 up/total`（例 `10.0.0.249 · 邻居 2 · 端口 2/2`），CPU / 内存只在右栏概览出；链路页 = 两端**设备名** `A → B`（例 `Wi-Fi胖AP-11 → 接入交换机-1`）+ 两端 `接口名:管理 IP`（例 `n20-eth2:10.0.0.245 → n7-eth3:10.0.0.11`）。链路台账的两端只有 `device_code` + `interface_name`，名字与 IP 都靠 `/metric/device` 反查（`app/utils/metric/metricLedger.ts` 的 `deviceNameIndex()` / `deviceIpIndex()`，共用同一份 200 条台账，不额外发请求）；任一字段缺失写 `—` —— 不写 0、不拼半句、不猜一个地址。利用率 / 时延属于「这一条的当前值」，只在详情概览里出现，列表栏不再重复（列表只回答「是哪条」）。
- **共用内核**：`useMetricSeries(ip, { code, rate, ifIndex })` —— 目录（§6.1 列表里的 `/metric/definition`）、名字清单、序列三步一次到位；页面只把返回值绑到控件上。
- **选择器**：`USelect` 选项 = **目录里 `selectable === true` 的条目 ∪ 名字清单里的名字**（`NMCPS-CONTRACT-002` §8.6 并集口径：清单命中项排在前，label 取 `en_name` 再兜 `code`，后缀给 `unit`）；切换只换 `metric_code`，不重取名字清单。**名字清单为空不再禁用选择器**：2026-11-08 实测 24/36 台设备（18 台胖 AP + 3 台接入交换机 + 3 台汇聚交换机）的清单是 `[]`，而同一台 AP 的 `ifInOctets` 仍有 4 条序列 —— 候选改由目录给出，页面加一句「上游未返回该设备的指标名清单（候选来自指标目录）」，用户选一项再看窗口内有没有采样点。同次实测还修掉两处同源根因：目录条目的类型字段名是 `data_type`（不是 `metric_type`），只认后者会让 `string` 指标混进选项画成恒 1 直线；目录 `total=463`，只取首页 200 条会让余下 263 条没有类型证据。
- **链路时序 = source 端该端口（2026-11-06 实测改口径）**：`/metric/datapoint` 仍没有 `link_id` 维度，但实测序列**带 `ifIndex` 标签**（双 job 重复、2 个接口 × 2 job 共 4 条），因此链路页从「source 设备同名指标」升级为「source 设备**该端口**的接口序列」：传 `ifIndex = identity.source.if_index`，由 `selectMetricSeries`（`NMCPS-CONTRACT-002` §6.9）过滤 + 跨 job 取均值。三种如实标注：① 端点 `if_index` 缺失 ⇒ 只出当前值、不出折线；② 选的指标不带 `ifIndex` 标签（`sysUpTime` 这类设备级指标）⇒ 画出设备级序列并标注「这是设备级，不是端口级」；③ 该指标有端口维度、但没有这个 `if_index` 的序列 ⇒ `no_interface_series` 空态，**不拿别的端口顶替**。真正的 `link_id` 取数仍等上游。
- **速率开关**：只在目录条目 `metric_type === 'counter'` 时出现（`NMCPS-CONTRACT-002` §6.5），`rate` 由用户显式勾选、默认 `false`；`gauge` / `duration` 不显示开关、恒传 `false`。
- **空态与降级**：与 §6.5 同口径（无数据 / 点全部非法都是空态，绝不画 0 值直线）；目录失败只在图表卡内给一行提示，**不升级成页面级错误**；只有目录与名字清单**同时为空**时选择器才禁用并出 `no_metric_names` 空态文案。

### 6.7 节点详情事实层（A21 ~ A23，2026-11-06 落码）

`monitor` 详情栏在 1.0 里除了名称 / 状态，还画 CPU / 内存进度条与「接口数 / 邻居数 / 流量」三张 KPI 卡，并列出邻居。1.0 把这些字段直接铺在节点 `data` 上、用 `-1` 当「取不到」的哨兵；2.0 保留**同端点同字段**，但把读表收成纯函数 `app/utils/graph/topologyNodeFacts.ts`（表里是**拍平后**的读模型字段，上游的 `data` 外壳见 §6.10）：

| 字段（节点线格式） | 单位 / 口径 | 未知判定 | 展示 |
| :--- | :--- | :--- | :--- |
| `cpu` / `memory` | % | 缺省 / `null` / `-1` / 超出 0~100 | 进度条 + 一位小数；未知只写「—」**且不画空进度条**（空条会被读成 0%） |
| `interfaces` | 个 | 缺省 / `null` / 负数 | 直接写数；`0` 是真实值，照写 |
| `traffic` | Mbps（1.0 口径） | 三档都缺才是未知 | `traffic` → `traffic_in + traffic_out` → `trafficTotalKbps / 1000`，逐档兜底 |
| `neighbors` | 个 | —— | 页面**不读**这个上游字段，改由 `topologyNeighborsOf()` 从**当前画布**的链路推导（与 1.0 的「邻居数」同源），只认两端都在画布上的链路；平行链路各算一条 |

- **邻居列表**：每行给「对端节点状态色点 + 名称 + 链路状态徽标」，点击即切换选中；没有邻居时给一句「当前图示里没有其他节点与它直连」，不留空白块。
- **不补 0**：这是本节唯一的硬约束（`NMCPS-CONTRACT-002` §6.3）——未知一律 `null` → 展示「—」，三种未知形态（缺字段 / `-1` / 非数值）走同一条判断，页面里不存在第二套默认值。
- **假上游样本**：`scripts/lib/bff-harness.mjs` 的拓扑图刻意留四种节点（全给 / 只给 `traffic_in|out` / `-1` 哨兵 + 真实 `0` + 旧 Kbps 字段 / 一个都不给），让 A21 ~ A23 三种口径各有独立证据。

### 6.8 画布布局与径向扇旋转（A24 ~ A25，2026-11-06 落码）

1.0 的 `monitor` 顶栏有两组视图控件：一个「2D 布局」下拉（六项 `radial` / `dagre` / `tree` / `force` / `grid` / `circular`，默认 `radial`），紧挨着一组径向扇旋转控件（滑块 −90°~90°、步进 ±5°、复位回默认 25°）。2.0 复刻**两档布局 + 旋转控件**，几何算法从 1.0 同名库**逐行搬入**（0.17.15 起「分层」那一档收起，塔型的语义并入层级树，见下）：

| 布局键（下拉文案见 `layouts.*`） | 几何 | 落点 | 与 1.0 的差异 |
| :--- | :--- | :--- | :--- |
| `radial`（默认） | tier 楔形扇：圆心 = **层序最小者**（即选举出的根，半径 0）、`r(t) = (t − apex)/span · R` 等分半径、逐档张角（按**带数**生成：最外带 65°、其余非顶点带 75°、顶点带 60°）以「正左」为中心、档内按父分组 + 组间留白 + 组内重心排序、默认逆时针 25° | `app/utils/graph/topologyRadialLayout.ts`（1.0 几何库逐行搬入） | 无。1.0 的显式参数能力（`stretch: 'auto'` / `sweepDeg: 360` 整圆 / `barycenterOrder` A/B）一并保留，页面只开默认值 |
| `tree` | 层级树 = **塔型**：每层一条水平线、层内次序按父层重心排（相邻层交叉 0）、层内相邻间距 ≥ 80（1.0 `nodesep`，不铺满整幅画布宽）、父节点压在子女群中线上；**行号 = 层序归约结果** | `app/utils/graph/topologyTierTreeLayout.ts`（1.0 几何库逐行搬入 + 两步 coord 对齐） | 1.0 的 `dagre` 跑在 G6 引擎里、靠隐藏锚点链钉层；2.0 图形自绘（`NMCPS-ADR-0019` D1）没有布局引擎，按 dagre 的两步核心算法（crossing minimization / coordinate assignment）自写，读向同为自上而下 |
| `force` / `grid` / `circular` | —— | **未落** | 三者都是 1.0 借 G6 内置引擎（`d3-force` / `grid` / `circular`）实现的；2.0 图形自绘（`NMCPS-ADR-0019` D1）没有布局引擎，复刻需自写力导向 ⇒ **登记为未复刻项，下拉里不出现这些假选项** |

- **为什么只留两档**（0.17.15，用户裁决）：`layered` 与 `tree` 落到 0.17.14 时已经是**同一套层序归约 + 同一套父压子女中线**的两份实现 —— 同一张图两个下拉项画出来几乎一样，读者只能靠「哪个更像 dagre」分辨，等于让用户替产品选实现。收掉 `layered` 后塔型的全部语义（层内重心排序、最小间距 80、父节点压在子女群中线、半径随层递减、外圈按层级取色）由 `tree` 一处承担，`topologyLayeredLayout.ts` 只留层序归约 `resolveLayeredRanks()`（A42 / A43 / A44 / A46 的断言随之改成在 `tree` 下量）。

- **旋转语义**：视觉逆时针为正，范围 −90°~90°、步进 5°，默认 `RADIAL_ROTATE_DEG = 25`（1.0 v0.30 用户裁决值）；只旋转整张扇面、圆心不动，逐档张角 / 等分半径 / 组内等间隔全部保持。两枚 ±5° 步进按钮的图标是 `carbon:rotate-counterclockwise` / `carbon:rotate-clockwise` —— 0.17.16 之前写的是 `carbon:rotate-ccw` / `-cw`，那不是合法的 Carbon 名，按钮上**什么都没画**（一串空的 `<svg>`），A48 因此改成量 SVG 内容而不是量 `[data-testid]` 是否存在。
- **控件的出现条件**：旋转控件只在 `radial` 布局下**渲染**，其余布局**整块不出现**（不是「渲染但置灰」—— 置灰的滑块等于暗示「拖了会有区别」，而其它布局根本不读这个角度）。
- **裁剪与布局的关系**：先按「tier + id」裁到 400 节点 / 1,200 链路，再交给布局函数；两种布局吃的是**同一份裁剪结果**与**同一份层序归约结果**，切换布局不会改变「裁掉了哪些」、也不会改变「谁在谁上面」，画布角标的数字在任何布局下都相同。
- **控件位置与顺序**（2026-11-09 二次 / 三次收敛）：布局下拉 **与画布控件同处页面工具栏左区**（`#app-toolbar-left`，`topology-controls` 一排），自左向右依次是 **布局下拉 → 旋转 → 缩放 → 显示名称 → 恢复默认配置 → 更新**；它们读的都是「这张图怎么呈现」（几何 + 视口 + 读数），前面几枚是设置、排尾那枚「更新」是取数动作。0.17.8 曾把它们收在**画布右上角**，但那条排会盖住最上层的节点与连线（A48 的旧断言只量「贴着画布右上」，看不出遮挡）；画布右下角留给**图例**（图例是读数、不是控件，§6.15），左上角留给状态角标（裁剪 / 分组折叠 / 收起下级 / 告警 / 聚焦）。A48 因此钉：控件排**归属** `#app-toolbar-left`、与布局下拉**同排**（垂直中心差 ≤ 12px）、**不压在画布上**、排尾三枚的顺序恰为「显示名称 → 恢复默认配置 → 更新」。
- **两枚「复位」已下线**（2026-11-09 用户裁决）：旋转控件旁与缩放控件旁的独立 `carbon:reset` 小按钮（`topology-rotate-reset` / `topology-zoom-reset`）整枚删除 —— 复位旋转角、复位视口本来就只是「恢复默认配置」三合一里的第 2 / 3 步，一排放三个同款图标只会让人不确定该点哪一个。想复位就点「恢复默认配置」（三项都在默认值时它自己 `disabled`，见 §6.9）。A48 用否定式断言钉住：页面上不得再出现这两个 testid。
- **画布尺寸**：`radial` / `tree` 的坐标按逻辑视口 1000×660 计算（`TOPOLOGY_CANVAS_WIDTH` / `TOPOLOGY_CANVAS_HEIGHT`），内容比视口小时整体居中、比视口大时 `viewBox` 跟着长大 —— 后者由几何库的 `bbox` 决定，页面不猜。层级树的**宽度由最宽行决定**（现网 21 台接入 × 80 = 1600，加留白后 `bbox` 约 1740；高度恒为 `110 × (行数 − 1) + 两倍留白`），`viewBox` 随之长大 —— 等价于 1.0 的 `graph.fitView()`：整张塔型缩到视口里，用户再用滚轮 / 缩放按钮放大，**绝不把 21 台挤进 1000 宽**（那样相邻标签会叠成一团）。
- **层级树为什么必须是塔型**（2026-11-08 用户反馈「分层算法结果不对」，0.17.15 起由层级树独家承担）：旧实现只做到`tier` 分带，层内按 `id`（= 管理 IP）字典序铺满整幅画布宽 ⇒ ① 同层里谁挨着谁与拓扑无关，汇聚 → 接入的连线大面积交叉（现网实测 **21 处交叉**，改后 12 处 —— 余下的是 3 核心 × 3 汇聚的全互联网状边，结构本身不可消）；② 3 台核心被摊到 80 / 500 / 920，与子女毫无对齐关系，塔型读不出来；③ 21 台接入挤在 840px 内（42px 间距），标签彼此压叠。现在的两步与 1.0 dagre 同源：**层内排序**按相邻层重心上下交替扫描、取交叉数最少的一版；**层内坐标**先取相邻层邻居均值、再按最小间距压实、最后整行等量平移使**父节点落回子女群的中点**（`topologyTierTreeLayout.ts` 的 `packRow()` / `mean()` 与第 ⑤ 轮「父压子女中点」）。压实里那一步「空洞均匀化」是稳定性关键：不加它，父层被摊开后的坐标会作为下一轮期望喂回子层、逐轮把整行拉宽（实测每两轮宽 ~330px 且不收敛）。
- **父压子女中点**（A24，2026-11-09）：层内坐标先按「相邻层邻居均值」排，再补一轮**自下而上**的收敛 —— 每个父节点的 `x` 取它所有可见子女 `x` 的均值（只有一个子女时两者对齐）。这条让「汇聚交换机居中压在接入之上、核心居中压在汇聚之上」成为可断言的几何事实，而不是排版副作用；根行不参与收敛（它没有上级可压，均值会把它拉离画布中心）；收敛后**整块按末层居中**（下一条）。
- **层序归约：根节点选举 + 无下级节点下移**（A43，2026-11-08；1.0 没有这个能力）：`tier` 只回答「这台设备属于哪一档」，回答不了「同一档里谁在谁上面」—— 现网三台核心是全互联的网状，边关系**等价**，dagre 只能把它们排在同一行。因此层序在「分带」之后还要走两条**只改「谁落在第几行」**的规则，落在纯函数 `resolveLayeredRanks()`（`topologyLayeredLayout.ts`，不依赖 DOM、可直接单测）：
  - **根节点选举**：首层多于一台时，按**设备名称**的命名约定挑一台当根（词表 `LAYERED_ROOT_KEYWORDS`：网控 / 控制中心 / 管理中心 / 管理平台 / 管理服务器 / 中心 / manager / controller / management / mgmt / center / centre / nms；命中取「最长关键词长度」为得分，同分先比连接度数、再比 id 断确定性），把它**单独提到第 1 行**（层序 0，角色 `root`）。没有一台命中判据时**不选举**、保留平顶 —— 在等价图上按 id 或度数猜「谁是上级」等于掷骰子。首层只有一台时它本来就是塔尖，无需选举。本实例选出的根是「网控中心」。
  - **无下级节点下移**：没有「严格更靠下的邻居」的节点，本来就不该占着中间层（它下面是空的，读者会把「层级没画对」读成事实）。这类节点一律下移到**末层**（与终端同排）；首层不参与（首层里没有下级的是孤立设备，下移反而把它从入口位置拽到最底），末层不参与（已在最底）。下移可能让上一层也变成叶子，因此**迭代到不动点**，每轮收掉空层（层序必须连续，否则 `y` 会按空层留缝）。本实例里第 3 层的「Wi-Fi胖AP10」~「Wi-Fi胖AP18」因此落到第 4 层。
  - **角色不跟着行号走**：角色始终按 `tier` 取（`roleOfTier()`；选举出的根覆盖成 `root`）。下移的接入仍是蓝色接入、被留在第 2 行的核心仍是红色核心 —— 换行只说明「它下面没有东西」，不是「它变成了终端设备」（按行号取色会把 9 台 AP 染成终端绿，等于改了设备类别）。
- **层序归约对两种布局都生效**（A45，2026-11-08 用户反馈「径向扇图和层级树图没有按新的分层渲染」）：上面两条规则回答的是「谁在谁上面」，那是**图的语义**、不是某一种几何的私事。0.17.6 把它们只接在塔型几何库里，`radial` / `tree` 仍把原始 `tier` 直接喂给几何库 ⇒ 切到另一档时根被摊回第一圈、无下级的接入又爬回中间环，同一份数据两套层级，等于「换个布局看」变成「换个事实看」。现在归约提到布局入口 `layoutTopology()`（`resolveRanks()`），两档布局共用：
  - **带号 = 层序 + 1**：`radial` / `tree` 是 1.0 逐行搬入的几何库，入参字段叫 `tier`，内部只把它当「第几环 / 第几行」（半径 `r = (t − apex)/span · R`、行号 `y = (t − minTier) · gap` 都只由它推出），因此喂归约后的**带号**（`rank + 1`，见 `bandNodesOf()`）—— 不改几何库内部口径，也就不动它已有的回归几何。
  - **逐档张角按带数生成**：`RADIAL_SWEEP_BY_TIER` 是按「4 档」写死的；层数不再等于 4 时（选举多一层、下移合并两层）按固定档号取张角会错位 —— 5 带图的最外带拿不到 65° 而回落到基线 60°，比它里面那带（65°）还窄。改用 `radialSweepForBands(带数)`：最外带 65°、其余非顶点带 75°；带数 = 4 时与 `RADIAL_SWEEP_BY_TIER` 逐项相同，故默认 6 节点样本的几何一字不变（A24 / A25 / A27 / A42 原样通过）。
  - **角色同样共用**：`radial` / `tree` 也走 `roleOfTier()`（根覆盖成 `root`），按行号取色的旧函数 `roleOfRank()` 随之删除 —— 同一台设备在层级树里是蓝色接入，切到径向扇必须还是蓝色接入。
  - 页面上的表现：径向扇的**圆心**恒为选举出的根（根到自己的半径 0），下移的接入与终端落在**同一最外环**；层级树的**首行**恒为根，下移的接入与终端**同排末行**。
- **居中的锚点是末层，不是包围盒**（A24 / A43，2026-11-09 用户裁决「先让末端层居中，再对各层对齐」）：层级树在「父压子女中点」收敛之后，再把**整块等量平移**，使**末层（终端带）的 `x` 均值 = 画布中心**（`viewBox` 宽度的一半，±1px）。理由：末层台数最多、跨度最宽（现网 21 台接入 / 9 台终端），它居中整张图才像「坐在画布中央」；按包围盒（`bbox` 的 `min/max` 中点）居中会让「上层比末层宽」的那些图里末层整体偏一侧 —— 20 台样本实测偏 37px（末层 274…800，包围盒中点却是 537）。末层居中之后，上面各层已各自压在子女群中线，自下而上天然对齐，读者沿着塔型往上读就是「谁归谁管」。
  - **画布中心要读当前 `viewBox`**：内容比基准视口宽时 `viewBox` 会长大（§6.8「画布尺寸」），`500` 只是「1000 宽视口」的一半。20 台样本的末层铺到 1074px 宽 ⇒ 中心是 `537` 而不是 `500`，断言与实现都按 `width / 2` 读，不写死常量。
  - **不再叠「越界守护」**：`bbox` 是最终落点算出来的，`layoutTopology()` 据此定 `viewBox` 并做整体偏移（`overflowShift()`），内容天然落在画布内、左右各留 `padding`。曾按 `padding` 再硬夹一次平移，结果把末层居中顶掉了（同一份样本全图右移 37px）——居中裁决在前，留白是结果；把两者混在一起，调试时看到的「末层偏了」会被误判成布局算错。
  - **径向扇保持包围盒居中**（否决了「把同一套末层锚点搬过去」）：扇形的重心在圆心（= 根），末层是一条**圆弧**，「末层均值落在画布中心」对圆弧没有几何含义（弧上各点的 `x` 均值恒等于圆心的 `x`，平移量恒为 0，等于什么都没做）；它的居中由 `bbox` 承担，与 1.0 逐行搬入的径向几何一致（A24 的「切回径向扇坐标逐点复原」即钉此）。两种布局「各自居中」不是不一致，而是各自的中心本来就不是同一个东西：塔型的中心是**末层**，扇形的中心是**圆心**。


### 6.9 节点拖拽位移与「恢复默认配置」（A26，2026-11-06 落码）

1.0 v0.36 的用户规格是「2D 模式下鼠标拖拽节点，拖完要留在那儿」，并配一个「恢复默认配置」把拖乱的图一键收回。2.0 复刻成三层，与 1.0 同口径：

| 层 | 落点 | 口径 |
| :--- | :--- | :--- |
| 几何层 | `layoutTopology()`（§6.8） | 唯一产生者：同一份数据 + 同一组选项恒得同一张图，页面无权改坐标 |
| 位移层 | `app/utils/graph/topologyNodeOffsets.ts` | 节点 id → 增量 `{ dx, dy }`（相对几何坐标），不可变写入；`OFFSET_EPSILON = 0.5`（px）内视为没动，**不入表** |
| 合成 | `applyNodeOffsets()`（渲染前，`TopologyCanvas` 内） | 几何 + 增量 = 最终落点；链路端点读同一张表 ⇒ 连线自动跟着节点走 |

- **为什么是增量层而不是绝对坐标**：轮询（30s）、状态事件、容器 resize、缩放与平移都会触发重渲染，绝对坐标会被几何重算覆盖（1.0 v0.36 的原始缺陷就是「拖完又被弹回去」）；增量叠在几何上，重渲染后落点不变。
- **拖拽只改这一层**：「恢复默认配置」= 清空位移层，几何基准毫发无损（不需要重跑布局），页面因此不持有第二套几何。
- **切布局清位移**：位移是「相对**当前**几何」的增量，换一套几何还叠着旧增量，节点既不在新几何位、也不在用户当初放下的位置（`tree` 下整行会被推离画布中心）。因此 `setLayoutMode()` 换布局时一并清空位移层；旋转角变化则**保留**位移（同一张扇面被整体旋转，增量仍成立，与 1.0 文件头第 2 条一致）。
- **「恢复默认配置」三合一**（按钮在工具栏左区控件排**排尾倒数第二枚**，`data-testid="topology-reset-view"`）：清位移 → 旋转角回 `RADIAL_ROTATE_DEG` → 视口复位（缩放 100% / 平移归零）。三项任一不为默认时按钮可点，三项都在默认值时 `disabled` 并提示「没有可复位的改动」——「点了没反应」和「本来就没得复位」是两件事。
- **三合一是**唯一的**复位入口**（2026-11-09 用户裁决）：旋转控件旁那枚 `topology-rotate-reset` 与缩放控件旁那枚 `topology-zoom-reset` 已整枚删除 —— 同一个动作拆成三枚同款 `carbon:reset`，用户没法从图标判断「该点哪一个」，而三合一按钮的 `disabled` 态本身就是「现在没有任何东西需要复位」的读数。控件排的位置、成员与顺序见 §6.8 / §6.15.4。
- **残留条目**：节点从上游消失后，它的位移条目不再参与合成（几何表没有这个 id），属无害残留，由「恢复默认配置」一并清空；不为它引入「随数据修剪」的耦合（1.0 同口径）。
- **不是「拖拽即改拓扑」**：位移纯属本地视图状态，不发任何请求、不写回上游；同一会话内刷新保持，重新加载页面即回几何位（与 1.0 一致）。

### 6.10 线格式的两层形状与拍平（A27，2026-11-07 落码）

8888 `/topology/graph` 的节点 / 链路**不是** §6.7 表格里那些扁平字段，而是 G6 的**元素形态**：事实全在 `data` 里，几何在 `style` 里，分组在 `combo` 上（2026-11-07 对现网 36 节点 / 48 链路复测）：

| 元素 | 实测形状（节选） |
| :--- | :--- |
| 节点 | `{ id: "10.0.0.1", data: { deviceName, label, type, tier, status, ip, cpu, memory, interfaces, traffic, traffic_in, traffic_out, uptime, … }, style: { x, y }, combo: "combo-10.0.0.251" }` |
| 链路 | `{ id, source, target, data: { linkType, bandwidth: "100 Mbps", status, bandwidth_util_pct, medium, relation, telemetry: { traffic_in, traffic_out, … } } }` |

- **拍平在取数边界做一次**：`flattenTopologyNode()` / `flattenTopologyLink()` / `normalizeTopologyGraph()`（`app/utils/graph/topologyNormalize.ts`）把 `data.*` 抬到 §6.7 的扁平槽位，`useTopologyMonitor.loadGraph()` 是唯一调用点；布局、事实层、画布只读扁平读模型，不在各自那里再猜一次「`data` 在哪」。取值优先级与 1.0 的 `normalizeTopologyInput()` 一致（`data.*` 优先、顶层兜底），名称取 `data.deviceName → data.label → 顶层 name / hostname / label`，**绝不先回 `id`**（那是管理 IP）。
- **不拍平会静默退化**：`data.tier` 读不到 ⇒ `normalizeTier(undefined)` 一律回落 3 ⇒ 分层布局把全部节点塞进同一个分带（**一条水平线**，实测 `rows = 1`）、名称退化成管理 IP、状态全 `unknown`、详情栏全写「—」。2026-11-07 用户反馈的「页面没看到变化」就是这一条：页面功能都在（拖拽 / 复位 / 缩放实测正常），退化的是几何。
- **`style.x / y` 不复用**：上游预置坐标在 2.0 不参与布局（几何唯一由 `layoutTopology()` 产生，§6.8）。留着它只作取证，说明上游确实带了布局结果，不改本域口径。
- **`tier` 实测四档齐全**（1: 3 台核心 / 2: 3 台汇聚 / 3: 21 台接入 / 4: 9 台终端），分层布局因此是 4 行、`viewBox` 高 `140 + 150 × (4 − 1) = 590`；`normalizeTier()` 的「1~4 之外回落 3」只在真脏数据上生效。
- **`bandwidth` 是字符串**：实测 `"100 Mbps"`（早期「全为 0」的结论只对部分链路成立），契约类型保留 `number | string`；页面目前不展示带宽，故不做单位解析（要展示时另立口径）。
- **假上游默认就回两层形状**：`scripts/lib/bff-harness.mjs` 的样本本体仍是扁平表，出站时默认经 `nestTopologyGraph()` 包成现网形状（`control.topologyNested` 初值 true）——自检因此**默认**覆盖「线格式 → 拍平」这条路，A21 ~ A26 都跑在两层形状上；`__control/topology-flat` 切回扁平本体，A27 用它钉「两种形状渲染结果逐点一致」。

### 6.11 链路事实、区域分组折叠与无线事实（A28 ~ A30，2026-11-07 落码）

排查 §6.10 时顺手对现网同一份 36 节点 / 48 链路样本做了字段取证，并按取证结论落了三条只读事实（链路卡 / 分组折叠 / 无线卡）。下表是**取证原样**（2026-11-07），落地口径写在表后。

| 取证对象 | 实测（36 节点 / 48 链路） | 判断 |
| :--- | :--- | :--- |
| 链路 `data` 基础事实 | `linkType`（`radio` / `100FE` / `1GE` / `fiber`）、`bandwidth`（`"100 Mbps"` / `"1 Gbps"` / `"4 Gbps"`）、`status`、`medium`（`wifi24` / `eth100m` / `copper1g` / `optical`）、`relation`（`up` / `peer` / `down`）、`admin_status`，**48/48 齐全** | 够做一张诚实的链路提示，不需要新取数 |
| 链路 `data.telemetry` | 48/48 有 `{ traffic_in, traffic_out, in_util_pct, out_util_pct, packet_loss, error_rate, metric_updated_at }`；实测 `in_util_pct` / `out_util_pct` / `packet_loss` / `error_rate` **全 0**，而 `traffic_in`/`traffic_out` 有 21/48 非零（例：`traffic_out: 16.18` 而 `out_util_pct: 0`） | **利用率维度今天不可用**：0 是「没算」不是「空闲」，直接画成 0% 就是撒谎；要展示只能写「未计算」 |
| 节点 `data` 事实 | 基础 13 项 36/36；Wi-Fi 事实（`band` / `channel` / `dbm` / `clients` / `util` / `ssid` / `tx_power`）27/36，`bssid` 与 `temperature` 各 9/36；`neighbors` 是**计数**（如 `5`）而不是清单 | 无线事实已落成 AP 事实卡（A30）；邻居清单只能从 `edges` 推（A21 已是这个口径） |
| 节点 `style.x / y` | `y` 按 `tier` 精确落在 `180 / 360 / 540 / 720`（**每层一行**），`x` 跨 `120 ~ 4520` | 这就是「一层一行铺开」的原始示意图；复用要缩放＋裁切，画出来仍是扁平一行，**2.5D 得不到** |
| `combos` | 3 组，每组 `children` 11 个，带 `data.label` / `layer` / `root` / `counts: { distro, access, terminal }`；30/36 节点带 `combo` | 区域分组＋折叠计数已落（A29）；比 2.5D 更贴近「这块区域有几台」 |

- **链路事实卡（A28）**：画布上每条连线可点（`emit('selectLink', topologyLinkKey(link, index))`），再点同一条取消；详情栏出「链路详情」卡：两端名称（图上叫得出来的名字优先，退回管理 IP）、`linkType` / `medium` / `relation` / `admin_status`、带宽**原文**（`"1 Gbps"` 不换算）、`traffic_in` / `traffic_out`（Mbps），以及四个利用率维度 —— 三者口径不同，读表在 `app/utils/graph/topologyLinkFacts.ts`：① 基础事实字符串原样，缺省 `null` → 「—」；② `traffic_in|out` 是真实计数（`0` 照写），缺省 → 「—」；③ `in_util_pct` / `out_util_pct` / `packet_loss` / `error_rate` **只在 `> 0` 时有值**，`0` 一律 `null` → 「未计算」，卡片底部再说明一句为什么。画布的 `<title>` 悬停提示走同一份读表（基础事实 + 双向流量 + 利用率或「未计算」），因此**悬停与卡片永不失配**。
- **区域分组折叠（A29）**：`combos` 抬成读模型（`flattenTopologyCombo()`：`data.label` / `data.children` / `data.counts` → `label` / `children` / `counts`）。分组清单挂在**画布左上角的浮层**（`topology-groups-toggle` → `topology-groups`）：组名、上游自报的分层计数（`distro` / `access` / `terminal`，词表里有就翻、没有就原样给）、「画布可见 / 上游声明」成员数、折叠开关、「全部展开」与「只看该组」。它决定的是「这张图包括谁」，属于画布的读法，因此不再占侧栏（侧栏只回答「选中的这个东西是什么」，见 §6.15 要求 4）。折叠**只改视图输入**（`collapsedCombos`）：布局按剩下的成员重新铺，挂在该组上的连线随之消失（端点在画布外的边画不出来）、画布角标写「已收起 N 台（M 组）」；**组计数一个字都不变** —— 它是上游自报的事实，不是画布统计。折叠 / 展开与切布局同一条理由清空位移层（成员变了，带内位置就变了）。
- **无线事实卡（A30）**：节点带 Wi-Fi 字段时出「无线」卡（`band` / `channel` / `dbm` / `clients` / `util` / `ssid` / `tx_power`，读表 `wifiFactsOf()`）。七项全空 ⇒ 返回 `null` ⇒ **不画这块**：画一排「—」等于宣称「这台 AP 的 SSID 取不到」，而它根本不是 AP。与链路利用率不同，节点 `util` 的 `0` 是可信真值（节点口径不带「未计算」语义）。
- **2.5D 仍不靠上游坐标**：`style` 已证明是「每层单行」的预置示意图，2.5D 要的层内多行 + z 轴错位只能由 `layoutTopology()` 产出；复用 `style` 只会得到「一行更宽的伪 3D」，与 §6.8 的几何口径冲突。画布现有的「2.5D 观感」来自等轴投影样式（§七），与上游坐标无关。

### 6.12 告警叠加、只看某组与链路动作（A31 ~ A35，2026-11-07 落码）

三条能力各自独立取数、独立降级：告警走 8888 的 `/alarm/alarm-events`（§6.1），聚焦分组只改**视图输入**，链路动作走 8001 白名单写通道（§6.2）。取数在 `useTopologyMonitor()` 里是**三条互不阻断的并发通道**（`Promise.all([loadGraph(), loadSimulator(), loadAlarms()])`）：告警失败不摘拓扑，仿真失败不摘告警。

| 能力 | 取数 / 判据 | 落点 |
| :--- | :--- | :--- |
| 告警叠加（A31） | `GET /api/alarm/alarm-events`（经 BFF `[...slug]` 网关，**server 侧无本地路由**）→ 解包 `{ list, page, page_size, total }`，只留 `status=firing` 且 `target_id` 非空的事件 | 读表 `app/utils/graph/topologyAlarms.ts`（纯函数）；画布角标 + 详情栏「当前告警」卡共用同一张表 `alarmIndex` |
| 只看某个分组（A33） | `focusComboId` → 布局先滤节点（`node.combo === focus`），挂边随之消失 | `useTopologyMonitor()` 的 `focusCombo()` / `clearComboFocus()`；页头徽标 `topology-focus-badge` + `topology-focus-clear` |
| 链路动作（A34 / A35） | `POST /api/sim/api/network/links/{sim_link_id}/{down,up,toggle}` | `performLinkAction()`；按钮组 + `UModal` 二次确认（与节点动作共用 `pendingScope: "node" \| "link"`） |

- **告警读表的三条硬约束**（`topologyAlarms.ts` 文件头）：① **只认 join 得上的目标** —— `target_id` 为空、或该 id 不在当前画布上的事件不参与聚合（`alarmIndexOf()` 的 `keep` 参数就是「画布上真实存在的节点 id」集合）；② **未知严重度不升级** —— 登记三档（`critical` / `warning` / `info`）之外的取值归 `info`，绝不因为「看不清」画成 `critical`；③ **角标只报计数与最高档**，详情栏按同一份排序（严重度降序 → 最近触发降序）列前 3 条，其余写「另有 N 条」，两处不各算一次。
- **`status=firing` 由上游过滤**：请求带 `status=firing`，客户端仍按 ③ 复核一遍 —— 但**缺省 `status` 按 firing 处理**（上游没给状态 ≠ 已恢复）。已恢复的事件带 `status=resolved` 显式到达时被丢掉，正是为了「读到了但已恢复」不被画成角标。
- **「读失败」≠「没有告警」**（§八同一条规则）：告警通道失败时画布角标整块摘掉、页头告警读数写「—」、详情栏写「告警通道不可用：<上游原话>」，**不写**「该节点没有进行中的告警」—— 后者是结论，不是缺省。拓扑与仿真照常渲染。
- **join 损失是设计内的，不是漏画**：现网 77 条 firing 实测 43 条挂在画布外设备、9 条 `target_id` 为空 —— 因此页头读数写的是「图上 N 条 / M 台设备」，不是「全网 N 条」；画布外那些事件留在上游，页面既不静默丢弃，也不假装它们属于某台图上设备。加上这两条比例，才知道「图上只有两台有告警」是数据的形状，而**不是**页面漏画了那 43 条。
- **只看某个分组与折叠互斥**：聚焦一个分组时若它正处于折叠集合里，`focusCombo()` 先把它从 `collapsedCombos` 摘掉（否则会得到一张空画布）；聚焦与折叠都改成员集合，因此都清空位移层（与切布局同一条理由，§6.9）。上游删掉该分组后 `focusedCombo` 自动失效回「看全部」，不留空画布。页头徽标用**上游自报的组名**（`data.label`，取不到才退回 id），不自己编名字。
- **链路动作必须用仿真侧链路 id**：`performLinkAction()` 的 `simId` 取 `simulatorLinkFor(link).simId`，**不是**图上的 `source→target` —— 后者由两端节点 id（管理 IP）拼成，仿真平台不认识，只会 404。`down` / `up` / `toggle` 三个动作各一个按钮，禁用原因按「通道状态 → 写开关 → 是否选中 → 是否在仿真里」的顺序**只说缺的那一层**；`writeEnabled=false` 时页面零写请求（BFF 的 405 是第二道闸）。二次确认正文同时写明两端名称、**仿真链路 id** 与动作原文，确认后加一句「不可撤销 / BFF 不保留副本 / 不会自动回滚」。

### 6.13 邻接发现的上游形状取证（§6.14 落地的前置，2026-11-07）

邻接发现（LLDP）是拓扑域最后一块 P1 只读面。落码前的第一步不是画卡片，而是**对现网取一次样**：探针对 8001 的 `/api/lldp/summary` 与 `/api/lldp/neighbors/{node_id}` 各取一轮（产物 `/tmp/lldp-summary.json`、`/tmp/lldp-probe.out`，不入库），结果与当时的 `shared/types/simulator.ts` **对不上**，因此先修契约、页面分区押到下一个小版（0.17.0 落地，见 §6.14）。

| 项 | 旧契约（错） | 实测原样（已按此修正） |
| :--- | :--- | :--- |
| `summary` 形状 | `{ neighbor_count, switches[] }` | `{ node_count: 36, neighbor_entry_count: 96, mode: "native", mib_standard: "IEEE 802.1AB", lldp_mib_oid: "1.0.8802.1.1.2.1.4.1.1", local_sys_name, local_sys_desc, local_chassis_id }` |
| `summary` 语义 | 「按交换机分组的邻居计数」 | **扫描规模 + 一台示例端点**：`local_*` 三项只是首个被扫描节点（实测 `n1`）的自报身份，读成全网汇总就是编数据 |
| 邻居项字段 | `{ id, name, local_port, remote_port, ttl, mib_oids }` | `{ neighbor_id, neighbor_type, neighbor_name, local_interface, remote_interface, chassis_id, chassis_id_subtype, port_id, port_id_subtype, port_descr, sys_name, sys_desc, ttl, link_type, link_status, discovered_at, mib_oids }` |
| 对端身份 | 单一 `id` + `name` | **两套并存**：`neighbor_id` / `neighbor_name` 是平台台账（`n1` / `N1`），`sys_name` 是 MIB 字段（`核心路由器-1`）—— 两者都照实展示，不互相顶替 |
| `chassis_id` | 视为唯一键 | 实测恒为 `00:00:00:00:00:00`（仿真平台未填），**不能**当键用；`mib_oids` 是「字段名 → OID」的对照表，不是值 |
| `discovered_at` | 可选 | 必填，但**不带时区**（`2026-11-05T10:38:56.863667`）：展示不做时区换算，与告警 `+08:00` 的 ISO 串是两种格式 |

- **空数组是真实回答**：没开采集的节点回 `{ node_id, neighbors: [] }`（不是 404）。页面分区落地时，「这台设备没有邻居」必须是**上游明确回了空数组**才敢说，请求失败只能写失败原因（§八同一条规则）。
- **节点对齐**：`neighbors/{node_id}` 的 `node_id` 与 `runtime-inventory` 的 `nodes[].id` 同源（`n1` / `n4` …），而拓扑图节点 id 是管理 IP —— 两者要经过 §6.2 的仿真节点对齐（`buildSimulatorIndex()`）转一次，不能直接拿拓扑节点 id 去请求。
- **假上游已同步**：`scripts/lib/bff-harness.mjs` 的两个 LLDP 端点已换成上表形状（`n1` 两个邻居：`n2` 在画布上、`n10` 画布外；`n4` 两台；其余空数组），页面分区（§6.14）的断言因此直接站在实测形状上，不再站在比现网「干净」的样本上（与 §6.10 那次形状缺口的教训同源）。

### 6.14 邻接分区落地（A38 ~ A40，2026-11-07）

详情栏新增「LLDP 邻接」卡：它是**上游逐节点的邻接台账**，与详情栏里原有的「邻居」列表（`topologyNeighborsOf()`，只列**本图画布**上的边）不是同一件事 —— 前者是设备自报，对端可能根本不在本图上；两者名称相近，因此分卡展示、各自注明口径，谁也不顶替谁。

| 项 | 取数 / 判据 | 落点 |
| :--- | :--- | :--- |
| 取数 | `GET /api/sim/api/lldp/neighbors/{sim_node_id}`（经 `SIMULATOR_ROUTES` 白名单），`sim_node_id` 取 `selected.marker.simId` —— 即画布节点经 §6.2 对齐后的仿真侧 id（`n1`），**不是**管理 IP | `useTopologyMonitor()` 的 `loadNeighbors()`：以 `selected.marker.simId` 为唯一触发键 `watch`，带请求序号丢弃过期响应 |
| 读表 | 保持上游顺序，`local_interface` / `remote_interface` 分列不合成一个字符串；`neighbor_name`（台账）与 `sys_name`（MIB）并列展示 | 纯函数 `app/utils/graph/topologyNeighbors.ts`（`neighborRowsOf()` / `canvasIdIndex()` / `neighborCanvasCount()`） |
| 对端是否在图 | `neighbor_id` → `runtime-inventory` 的 `nodes[].id` → `ip_address`，命中画布节点 id 集合才算「在图上」 | 行上写「对端在图上的 <管理 IP>」或「对端不在本图上（画布外设备）」，卡片同时给「N 条 · M 台在图上」两个数 |
| `chassis_id` | **不参与任何判断**（实测恒为 `00:00:00:00:00:00`） | 只展示 `discovered_at`（不带时区的本地时间，原样）与 `ttl` 秒数 |

- **四种状态分开写**（`data-lldp-state`）：`idle`（未选中 / 该节点不在仿真运行态里 —— 没有台账可读）、`loading`、`ok`、`error`。`idle` 的文案明说「这不等于它没有邻居」，`error` 只写上游原话（`邻接通道不可用：<原话>`）。
- **只有空数组才敢说「没有邻居」**：`ok` 且 `neighbors: []` 时卡片写「上游明确回了空数组：这台设备没有邻居」；请求失败时**不出现**这句话（与 §6.12 / §八「读失败 ≠ 没有」同一条规则）。A39 / A40 分别钉住这两侧。
- **失败清空、不清屏**：与告警（保留上一轮读数）相反，邻接失败时清空上一台的邻居行 —— 邻接是逐节点清单，留着上一台的邻居会被读成「这台也有这些邻居」。

---

### 6.15 画布交互：灰色连线、关联高亮、收起子树与指标深链（A46 ~ A48，2026-11-08 落码）

这一节是 2026-11-08 用户对画布的整体裁决（七条要求，**对所有布局生效**，第 7 条为当日补裁），逐条落到纯函数与画布属性上：

| # | 要求（用户原话） | 落法 | 落点 |
| :---: | :--- | :--- | :--- |
| 1 | 「节点间连接线的颜色改为灰色，且要求在明暗两种模式线明显」 | 链路描边**一律中性灰** `--topology-link`（由 `--ui-text-muted` 派生：同亮度、色度压到 35%，见 §6.15.2 要求 1；浅色 / 深色模式下都自动跟随且都比层色安静）；状态不再靠色相表达，`offline` 改用**粗虚线**（`6 4`）、无线介质用**细密虚线**（`2 3`，见 §6.15.1），其余状态在详情栏 / 邻居徽标 / `<title>` 悬停提示里逐字给出 | `app/utils/graph/topologyStatusStyle.ts`（`linkStrokeClass()` / `linkDashArray()`）+ `app/utils/graph/topologyLinkStyle.ts`（`linkDashPatternOf()`）+ `app/assets/css/main.css`（`--topology-link`） |
| 2 | 「节点和连接线均可选中；节点选中时，与邻居相连的连线也要高亮」 | 节点与链路都可点选（链接 `select-link`，节点 `select`，键盘 `Enter` / `Space` 同效）；选中节点时，**与它直连的链路**与**一跳邻居**各出一圈低不透明度外延环（`topology-link-halo` / `topology-node-halo`）—— 节点环借它自己的层色，链路环取**选中设备的层色**（0.17.15 起，§6.15.3；此前一律借本体那支灰），被点中的那条链路 / 那台节点再高一档 —— **本体颜色与粗细一律不动**（2026-11-08 三次裁决，§6.15.2 要求 2） | 纯函数 `app/utils/graph/topologyHighlight.ts`（`highlightOf()`）+ `app/utils/graph/topologyLinkStyle.ts`（`linkHaloWidthOf()`）+ 画布 `highlightLinkKeys` / `highlightNodeIds` |
| 3 | 「选中节点或连接后，右侧栏显示详情，并加一个按钮切到对应的设备 / 链路遥测指标页」 | 详情栏节点卡与链路卡各加一枚按钮（`topology-node-metrics` / `topology-link-metrics`），深链带**拓扑侧真有的身份**（管理 IP），目标页用自己已取到的台账解析成 `?id`（目标不在第一页时由深链**有限页扫描**找到它，§6.15.1） | `app/utils/metric/metricDeepLink.ts`（`resolveDeepLink()`）+ 两个指标页的 `watchEffect` 解析 |
| 4 | 「画布右下角的控制按钮改到右上角，与径向扇的按钮融合为一排」 | 旋转 / 显示名称 / 恢复默认配置 / 缩放**同一排**（`topology-controls`）；**0.17.15 起这一排整体搬进页面工具栏左区**（`#app-toolbar-left`，与刷新 / 布局下拉同行）—— 贴在画布右上会盖住最上层的节点与连线（§6.8「控件位置」）。缩放状态仍归 `useGraphInteraction()` 独家所有，画布通过 `zoomChange` 上报读数、`defineExpose` 暴露 `zoomIn` / `zoomOut` / `resetViewport` | `monitor.vue`（工具栏左区）+ `TopologyCanvas.vue`（`zoomChange` / expose） |
| 5 | 「删掉内容页拓扑图右侧栏的图例卡片，显示在拓扑图右下角；『根节点』改为『边界层』」 | 图例从详情栏搬到画布右下角（`topology-legend`，`pointer-events-none`），**只留层色一行**（状态组与「虚线 = 仿真」提示已删，§6.15.1）；i18n `roles.root` 由「根节点」改为「边界层」（en `Boundary`），**角色 id 仍是 `root`**（改的是文案，不是数据模型） | `monitor.vue` + `i18n/locales/{cn,en}.json` |
| 6 | 「按 G6 v5 `CollapseExpand` 页的『实际案例』实现展开和收起」 | 有下级的节点带一枚角标（展开态 `-`、收起态 `+N`），**双击节点**或点角标收起 / 展开它的**整棵子树**；收起后该节点自己留在图上，下级与只连着下级的链路从渲染里摘掉，**留下的节点位置逐点不变**（几何按完整集合算） | 纯函数 `app/utils/graph/topologyCollapse.ts`（`collapsePlanOf()` / `childIndex()`）+ `useTopologyMonitor()` 的 `collapsedNodes` |
| 7 | 「右侧栏只留选中对象的详情，别把分组清单和趋势图堆在那里」 | 侧栏 = 选中对象的事实卡（节点 / 链路 / 无线 / 告警 / LLDP）；分组清单进画布左上角浮层（§6.11），折线搬到指标页、侧栏只留深链按钮（§6.5） | `monitor.vue` + `layers/topology/app/composables/useTopologyMonitor.ts` |

- **为什么第 2 / 6 条不是「调 G6 的 behavior」而是自绘**：2.0 的画布是 SVG 自绘（`NMCPS-ADR-0019` D1），项目里没有 G6 运行时依赖 —— G6 v5 的 `click-select` / `hover-activate`（关联激活）/ `collapse-expand` 在这里实现的是**同一套语义**，而不是把 G6 引进来换掉画布（那要重写布局注入、拖拽位移层、告警角标、无 rAF 约束等一整套既有约定）。`collapse-expand` 的四个特性逐条对上：默认触发是**双击**（页面上同时给了可点的角标，键盘 `Enter` 同效）、`enable` 判据是「只有真的有下级才可收起」、被收起的元素**自己留在图上**并显示 `+N`、展开后几何复原（等价于 `graph.expandElement()`）。
- **收起的方向由 `tier` 决定**：下级 = 邻居里**严格更靠下**的那一端。网状顶层（三台核心两两互联）用「边的方向」会互相把对方认成下级，递归一层就停不下来；`tier` 是上游实测字段（§6.10），方向唯一。
- **同档（`tier` 相同）时只认「还有上行」的那一端**（0.17.14 补，A52）：同档邻居之间，一端邻接里存在**严格更靠上**的设备（「还有上行」）、另一端没有，则有上行的那端是上级；**两端都有 / 都没有上行时不认方向**（两台都上联汇聚的接入、两台都上联核心的汇聚、网状顶层 —— 同一条理由：不凭空造层级）。这条是 2026-11-09 用户反馈的直接修法：现网 18 台胖 AP 登记成 `tier 3`，与它们上联的接入交换机同档，只按「严格更靠下」判 ⇒ 收起汇聚时接入被摘掉、AP 却留在画布上，且它们的边全被摘掉 ⇒ 画布上剩下 18 个不连任何东西的孤点。判据落在 `childIndex()` 的 `hasUplink` 集合上，角标读数（`hiddenCounts`）与 `data-collapsed` 的子树过滤同源，画布与详情栏一起变。
- **收起后**：该节点自己留在图上，下级与只连着下级的链路从**渲染**里摘掉 —— 但几何仍按**收起前**的完整集合算，因此留下节点的坐标逐点不变。旧实现把子树从布局输入里摘掉后整行重排，收起一个叶子整张图就挪位，看着像「点了另一张图」（2026-11-08 修，`check:ui` A46 的「展开后坐标逐点相等」从「重排再复原」变成「压根没动」）。位移层因此**不清空**：收起只是「画什么」，不是「重新排版」（与切布局 / 折叠分组是两回事，后两者换了集合才清空，§6.9）。被收起的节点若正好是选中项，选中一并取消（详情栏不能挂着一台画布上不存在的设备）。
- **收起不落盘**：它与「分组折叠」不同（后者按 combo id 持久化，§6.11）；子树收起是对**当前结构**的临时视图，上游删掉那台设备 / 它已经没有下级时自动失效（`watch(graph)` 修剪），落盘只会把失效状态带到下一次会话。
- **灰色连线不丢状态**：状态语义仍在（§6.12 的链路徽标 / 详情栏 / `<title>`），只是不再用色相区分 —— 一张 48 条链路的图画成六种颜色时，读者先看到的是彩虹而不是层级。
- **强调不换色、也不改本体粗细**（2026-11-08 三次裁决，§6.15.2）：选中态与关联态**只加外延环** —— 在同一个 `d` / 同一个 `r` 上叠一条**同色相、低不透明度**的宽描边，本体描边始终是那支中性灰 / 那支层色、宽度始终只读带宽 / 恒为 2px。旧实现给强调链路挂主色 `stroke-(--ui-primary)`（与「灰 = 连接关系」的唯一色义冲突，两个 `stroke-*` 类同时挂着时谁赢还取决于 Tailwind 的生成顺序），随后改成「加粗」又让 4px 的本体与「粗细 = 带宽」打架 —— 两次都是同一个错：把两套语义挤进同一个通道。现在强调档位由 `linkHaloWidthOf(link, emphasis)` / `NODE_HALO` 给出（`none` / `incident` / `selected` / `focus`），模板里不再有第二个 `stroke-*`，也不再有 `nodeStrokeWidth()`。
- **深链的身份是分开的，不硬拼**：拓扑节点 id 是管理 IP，`/metric/device` 的 `?id` 是 `device_code`，`/metric/link` 的 `?id` 是 `link_id`（`device_code:iface--device_code:iface`）。因此深链带 `?mgmt_ip=`（设备页）与 `?source_ip=&target_ip=`（链路页），目标页把**它自己已经取到的台账**解析成自己的记录标识再写 `?id`（`useRecordSelection` 的唯一事实源不变）：设备页按 `mgmt_ip` 列命中，链路页用已有的 `device_code → mgmt_ip` 索引（§6.6）反查两端、方向不敏感。
- **深链可以有限翻页，`?id` 仍然不行**：台账一页 15 条，而现网 36 台设备 / 48 条链路 —— 目标不在第一页是常态，只在第一页里解析等于「点了『遥测』什么都没选中」。因此 `resolveDeepLink()` 先看当前页、再按页扫描（上限 `DEEP_LINK_MAX_PAGES = 20` 页，请求失败即停），命中后**把左栏切到那一页**再写 `?id`，扫不到就保持默认选中。`NMCPS-ARCH-006` §5.2 禁止的「`?id` 不在当前行就静默翻页」原样保留：`?id` 不参与请求键、也永不触发扫描，只有深链参数才触发。
- **图例只列实际出现的角色**（`presentRoles()`）：没有选举出根就不列「边界层」；图例用 `data-role` 暴露色值与角色，`check:ui` 据此断言。色块在 **HTML `<span>` 上用 `border-*`** 画（`roleDotClass()`），不是 SVG 那套 `stroke-*` —— HTML 元素不认 `stroke`，写成 `stroke-*` 时 `border-2` 只剩宽度、颜色落到 `currentColor`，四档层色会全部同色（图例与画布不是一个颜色）。两套类名并列写在 `topologyRoleStyle.ts` 的同一张表里（不运行时拼字符串，Tailwind 要能静态扫到）。

#### 6.15.1 画布口径的二次裁决：只加粗、线宽读带宽、无线虚线、图例与深链（A49 / A50，2026-11-08 落码）

2026-11-08 用户看过 §6.15 落码后的画布，又提了五条（同一天补裁）。它们不是新功能，而是把 §6.15 的「高亮」与「图例」两处口径收紧：

> **0.17.13 起第 1 / 2 条的「按档加粗」口径已被 §6.15.2 取代**：本体粗细不再随强调变化，强调一律改走同色外延环。下表保留当次裁决原文，作为口径演进的记录（读者只按 §6.15.2 落码）。

| # | 要求（用户原话） | 落法 | 落点 |
| :---: | :--- | :--- | :--- |
| 1 | 「节点选中的配色不要变，只加粗（同色相、低饱和度）」 | 外圈一律层色：未选中 2px / 一跳邻居 3px / 选中 4px；选中另加一圈**同色**外环（`r + 4`、2px、`opacity-40` —— 同色相压在背景上即低饱和），因此「点中的是哪一台」不靠换色也读得出 | `TopologyCanvas.vue`（`nodeStrokeWidth()` / `topology-node-halo`） |
| 2 | 「链路加粗表达带宽」 | 带宽原文 → Mbps（`bandwidthMbps()`：`"1 Gbps"` → 1000）→ 四档宽度：缺真值 `1.5` / < 1G `2` / 1G~10G `2.5` / ≥ 10G `3`。强调是**加**在基础档上（关联 +1.5、选中 +2.5），不是「强调一律 3px」—— 否则 10G 干线被强调只粗 0.5px、接入线却翻倍，粗细就读不成带宽了 | `app/utils/graph/topologyLinkFacts.ts`（`bandwidthMbps()`）+ `topologyLinkStyle.ts`（`linkStrokeWidthOf()`） |
| 3 | 「无线链路画虚线；链路也能选中，右侧栏切换为链路详情」 | 介质判据取 `medium` / `linkType`（`linkIsWireless()`：`wifi5` / `wifi24` / `wireless` / `radio`）→ 细密虚线 `2 3`；`offline` 的粗虚线 `6 4` **优先**（两者都是虚线，空口信息不丢，断链信号不被介质吃掉）。每条线另铺一条 14px 的透明命中区（`topology-link-hit`）：1.5px 的细线不可能点得准。选中链路后右栏**整块切换**为链路详情，节点的无线 / 告警 / LLDP 卡全部让位；点节点或有链路在选时点画布空白都先摘掉链路选中 | `topologyLinkStyle.ts`（`linkDashPatternOf()`）+ `TopologyCanvas.vue` + `monitor.vue`（`selectLink()` / `pickNode()`） |
| 4 | 「精简右下角图例，去掉多余说明」 | 只留**这张图实际出现**的层色一行；「层级（外圈颜色 / 半径）」标题、「状态（中心圆点）」整组、以及「虚线外环表示仿真」提示全部删除（文案键 `pages.topology-monitor.legend.*` 一并删除，不留死键）—— 状态由每台节点中心的圆点直接读出，仿真节点自带标记，图例只回答「这几种颜色分别是哪一层」 | `monitor.vue` + `i18n/locales/{cn,en}.json` |
| 5 | 「设备 / 链路的『遥测』按钮深链到指标页对应节点 / 链路」 | 见上一小节：`resolveDeepLink()` 的有限页扫描让「目标在第 2 页」也能落地（选中 + 左栏停在同一页） | `app/utils/metric/metricDeepLink.ts` + `useMetricLedger()` 的 `fetchPage()` |

- **为什么选中态还要外环**：本体只差 1px（4 vs 3），单看一圈容易被读成「这台比邻居大一点」；外环用同一支层色 + 40% 不透明度，既不加新色相，又让「点中的那一台」在 4 个邻居里一眼可辨。
- **为什么线宽不做连续映射**：48 条链路带宽跨三个数量级，`log10` 连续映射会让 100M 与 1G 只差 0.3px —— 肉眼看不出，等于没表达。四档是可数的，也便于断言（A47 钉「唯一一条 2.5px」）。
- **为什么 `offline` 压过无线**：「断了」比「这是空口」更值得先说，而两者都是虚线，无线那一条的信息并没有丢。
- **为什么深链的翻页不违反 §5.2**：见上文「深链可以有限翻页，`?id` 仍然不行」—— 触发源、上限、命中后停在同一页，三条一起才放行。

#### 6.15.2 画布口径的三次裁决：去饱和、选中只加外延环、叶子归位终端层、连线可聚焦（A47 改写 / A49 加严 / A51，2026-11-08 落码）

§6.15.1 的「只加粗」落码后，用户又提了三条口径修正与一条无障碍缺口。它们把「强调」从**本体**彻底搬到**外延环**，并纠正了一处层级语义错误：

| # | 要求（用户原话） | 落法 | 落点 |
| :---: | :--- | :--- | :--- |
| 1 | 「降低链路颜色的饱和度」 | 连线灰不再是 `--ui-text-muted` 本身，而是新 token `--topology-link`：`oklch(from var(--ui-text-muted) l calc(c * 0.35) h)` —— **同亮度**（两种模式与背景的对比度不变）、**色度压到 35%**（连线更安静，层色才是画面主角）。相对色语法是**渐进增强**：`@supports (color: oklch(from white l c h))` 不成立时回落到 `var(--ui-text-muted)`（旧灰），绝不退化成 `currentColor`（黑线） | `app/assets/css/main.css`（`--topology-link`）+ `topologyStatusStyle.ts`（`LINK_STROKE` 六档全指向它） |
| 2 | 「选中 / 高亮用同色相、低饱和的外圈表示，不要加粗」（链路与节点同一口径；2026-11-09 二次收紧，见 §6.15.5；选中链路改主色、外延再收窄，见 §6.15.6） | **链路本体一动不动**：永远只读带宽（1.5 / 2 / 2.5 / 3px）。强调全部落在叠在同一条 `d` / 同一个圆心上的**外延环**上：链路 `incident` = 本体 +6px / **30%**、`selected` = 本体 +5px / **35%**（2026-11-09 用户裁决「选中链路改主色、光晕细一点」，见 §6.15.6）、键盘 `focus` 借用 `incident` 一档且**优先于**它（选中的设备恒存在，关联环不能把焦点盖掉）；节点 `neighbor` = `r + 3` / 2px / 22%、`selected` = `r + 2` / 4px / **50%**。**节点本体是唯一允许变粗的一处**：选中时 2px → 3px（2026-11-09 用户裁决「环再紧一点、本体再粗一点」）—— 节点上没有第二套粗细语义，而链路那边粗细读带宽，所以只给节点开这个口子。环的颜色**等于本体**（链路借那支灰、节点借那支层色），低不透明度叠在画布底色上即「同色相、低饱和」—— 不新增色相，也不让「外圈色 = 层级」被污染 | `topologyLinkStyle.ts`（`HALO_BUMP` / `HALO_OPACITY` / `linkHaloWidthOf()` / `linkHaloOpacityOf()`）+ `TopologyCanvas.vue`（`NODE_HALO` / `nodeStrokeWidth()` / `linkHaloLevelOf()`） |
| 3 | 「没有下级的节点就是末端（叶子），别画成接入层」 | 层序归约把无下级的节点下移到末层（§6.8），这些节点（`demotedIds`）现在**同时归位终端层**：`roleOfNode(tier, isLeaf)` 让叶子读作 `terminal`（绿），`tierOfNode()` 把 `tier` 改写成 `LEAF_TIER = 4` —— 画布、详情栏、图例说的是同一件事。判据不在上游 `type` 也不在名称：现网「Wi-Fi胖AP-10」登记为接入（tier 3）、自己发地址、客户端不进拓扑，画成蓝色接入等于说「它下面还有一层」。**零边图除外**：一条边都没有时「谁是叶子」无从谈起，硬归约会整张图变绿 | `topologyRoleStyle.ts`（`LEAF_TIER` / `roleOfNode()` / `tierOfNode()`）+ `topologyLayeredLayout.ts`（`demotedIds`；顶带的根不参与下移）+ `topologyLayout.ts`（两档布局同源取角色） |
| B | 「链路要能用键盘选中」 | 每条连线的 14px 命中区升级为**可聚焦控件**：`role="button"` + `tabindex="0"` + 事实化 `aria-label`（`pages.topology-monitor.link.selectAria`：「链路 {title}，回车查看详情」）+ `aria-pressed` 报选中态；`focus` / `blur` 驱动那条链路的 `focus` 档外延环（透明命中区上本来什么都看不见），`Enter` / `Space` 与鼠标点击**同效**（`.prevent` 防止页面滚动） | `TopologyCanvas.vue`（`topology-link-hit`）+ `i18n/locales/{cn,en}.json`（`link.selectAria`） |

- **为什么强调必须离开本体**：带宽四档只跨 1.5 ~ 3px，任何「加粗」都直接把读数改掉 —— 被选中的 1.5px 接入线涨到 3px 后，与 10G 干线分不开；节点的「3px / 4px」同理，一跳邻居与选中项只差 1px，读起来像「这台比邻居大一点」。外延环是**加法**：本体读数不变，环只回答「现在看的是哪一条 / 哪一台」，两者互不干扰。
- **为什么环不做成新色相**：一旦给强调一个第五种颜色，「灰 = 连接关系」「外圈 = 层级」两条专属语义就同时失效；低不透明度叠色已足以让环从背景里浮出来（同一支灰在 16% 与 30% 下深浅不同），且明暗两种模式自动跟随。
- **`focus` 为什么借 `incident` 一档、又为什么优先于它**：焦点指示与「这条线是当前项」是同一件事，宽度与不透明度无需再分第三档；`selected` 优先于 `focus`（被选中的链路即便失焦也保持 `selected` 环）。反过来 `focus` 必须压住 `incident`：监控页一进来就选中根（§6.15.6），与根直连的那几条线恒带关联环，若关联赢，键盘用户 Tab 到它们身上画布**毫无变化**，焦点指示等于没有。
- **叶子归位只改「读法」不改几何**：末层位置仍由层序归约给（§6.8），改的是角色与 `tier` 两个字段 —— 因为它们同时喂给层色、半径、状态圆点尺寸与详情栏的层级读数，只改其中一处就会自相矛盾（画布绿、详情栏写「接入层」）。

- **断言**：A47 在层级树下点 `10.0.1.4`（汇聚），4 圈 `incident` 外延环的 `data-link-halo-tint` 必须全等于该节点的 `data-node-role`（`distro`），`stroke` 等于该节点本体描边（层色）且**不等于** `--topology-link`；本体仍是 `1.5px` 的灰、`stroke-width` 不变。


#### 6.15.3 关联连线的外延环取选中设备的层色（A47 加严，2026-11-09 落码）

§6.15.2 把强调搬进外延环之后，环的颜色沿用了本体那支灰 —— 选中一台汇聚时，四条关联线只是「灰得更宽一点」，颜色没回答问题。用户 2026-11-09 裁决：**与选中设备直连的那一圈外延环用选中设备自己的层色**（选中汇聚 → 橙、选中接入 → 蓝），本体仍是一律中性灰（§6.15 要求 1 不动）：

| # | 要求 | 落法 | 落点 |
| :---: | :--- | :--- | :--- |
| 1 | 「选中节点时，与它相连的线也要亮起来，颜色跟着这个节点」 | `linkHaloTintOf(link, index)`：只有 `incident`（直连选中设备）那一档返回**选中节点的角色**，`selected`（被点中的那条线）/ `focus`（键盘焦点）返回空 ⇒ 沿用灰。`linkHaloClass()` 据此在 `roleStrokeClass(角色)` 与 `linkStrokeClass(status)` 之间二选一，模板里 `data-link-halo-tint` 暴露染的是哪个角色 | `TopologyCanvas.vue`（`selectedRole` / `linkHaloTintOf()` / `linkHaloClass()`） |

- **为什么只染 `incident` 一档**：`selected` / `focus` 说的是「这条线被点中 / 有键盘焦点」，它们的身份由档位（更宽、更不透明）表达就够了；再叠一层颜色会让「点中这条线」和「这线连着谁」两句话挤进同一条描边。
- **为什么用选中节点的颜色、不用邻居的**：一圈线只回答「它为什么亮着」，答案是「它连着被点中的那一台」。用邻居的颜色等于说「这线的另一端是汇聚」——那是层色已经在节点本体上说清楚的事，而且与「谁被点中」说反了。



#### 6.15.4 工具栏六项收敛：透明画布、两枚复位下线、排尾「更新」、图标与不截断的标签（A44 / A48 改写，2026-11-09 落码）

2026-11-09 用户看完 0.17.15 的画布又提了六条，全部落在「工具栏 / 标签」这两处：

| # | 要求 | 落法 | 落点 |
| :---: | :--- | :--- | :--- |
| 1 | 「画布背景改成透明」 | 画布框只留描边与圆角，`bg-(--ui-bg)` 整条删除 —— 底色交给页面，画布不再自带一块与页面不同的底 | `monitor.vue`（画布容器 class） |
| 2 | 「旋转、缩放的复位按钮去掉」 | `topology-rotate-reset` / `topology-zoom-reset` 两枚独立按钮删除；复位旋转角与复位视口仍由「恢复默认配置」三合一承担（§6.9） | `monitor.vue` |
| 3 | 「更新挪到最后，且要带文字」 | 原左区第一枚「刷新拓扑」（纯图标）改名为「更新」（`pages.topology-monitor.refreshLabel`）、挪到左区排尾；tooltip 与 `aria-label` 仍是「刷新拓扑」全称 | `monitor.vue` + `i18n/locales/{cn,en}.json` |
| 4 | 「旋转图标方向反了」 | 两枚步进按钮改用合法的 Carbon 名 `carbon:rotate-counterclockwise` / `carbon:rotate-clockwise`（旧名 `rotate-ccw` / `-cw` 不存在，按钮上是空的） | `monitor.vue` |
| 5 | 「布局下拉要有图标」 | 词表 `TOPOLOGY_LAYOUT_ICONS`（`radial` → `carbon:chart-relationship`、`tree` → `carbon:category`）供下拉项与当前按钮**同源**取图标：切档时按钮图标跟着换 | `app/utils/graph/topologyLayout.ts` + `monitor.vue`（`layoutIcon`） |
| 6 | 「节点名称小一号、且不要省略号」 | 字号 11px → 10px（`LABEL_FONT_SIZE`）、留白 8px → 6px（`LABEL_GUTTER`）、基线差 12px → 11px（`LABEL_LINE_HEIGHT`）；`planLabelRow()` **只错行、永不截断**，`fitText()` 整个删除，`LabelPlan` 只剩 `{ shift }`，画布上也不再有 `data-label-truncated` 与补全名的 `<title>` | `app/utils/graph/topologyLabelLayout.ts` + `TopologyCanvas.vue` |

- **为什么不截断**（用户原话「不要省略号」）：画布上的「汇聚交换机…」会被拿去和台账对名字，半截名字认错设备比挤一点更贵。错行已经把可用宽度翻倍（`2 × 74 − 6 = 142px`），10px 下「无线终端设备-01」约 77px，常规规模根本不触发截断；真放不下时宁可略挤也不丢字。
- **为什么收字号是前提**：`TIER_TREE_MIN_NODE_GAP = 74` 是「圆不重叠」的几何下限，11px 下 7 个全角字 ≈ 77px 已经超过单行可用宽度 66px，只能靠错行；收到 10px 后单行 70px、错行 142px 都留出余量，「不截断」才不是嘴上说说。
- **「更新」为什么排尾**：前面几枚都是「这张图怎么画」的设置，只有它取数；放排尾紧贴右侧读数，读完数字顺手点它。左区顺序因此固定为 **布局下拉 → 旋转 → 缩放 → 显示名称 → 恢复默认配置 → 更新**（A48 断言排尾三者的 testid 顺序）。
- **断言**：A48 加钉「两枚复位 testid 不存在」「排尾顺序」「更新按钮文本 = 更新」「两枚旋转图标 SVG 非空且内容不同」「布局图标随档位变化」「画布框两层容器背景全透明」；A44 改钉「文本无省略号 + 字号 10px + 全名逐字相等」，不再看 `data-label-truncated`。


#### 6.15.5 选中态收紧、五档层色与「末层居中」（A24 / A43 / A47 改写，2026-11-09 落码）

同一轮用户看画布提了四条，落在**样式**与**几何**两处（色板与居中口径分别记在 §七「层色板」与 §6.8「居中的锚点」，这里只记因果与断言）：

| # | 要求（用户原话） | 落法 | 落点 |
| :---: | :--- | :--- | :--- |
| 1 | 「根节点应该是 tier 0」 | 选举出的根在**读模型**里就是第 0 档：`ROOT_TIER = 0`，详情栏「层级」写 `0`、画布 `data-node-tier="0"`、「边界层」这一色从此对应一档真实层级（`normalizeTier()` 把上游收在 1..4，`0` 只可能来自选举）。`roleOfTier()` 的 `tier <= 0` 分支照旧读 `root`，五档层级与五个角色一一对应 | `topologyRoleStyle.ts`（`ROOT_TIER` / `roleOfTier()` / `tierOfNode()`）+ `topologyLayout.ts`（`tierOfNode()` 写回读模型） |
| 2 | 「先让末端层居中，再对齐各层」 | 层级树在「父压子女中点」收敛后**整块等量平移**，让末层 `x` 均值落在**当前 `viewBox` 宽度的一半**（±1px）；不再叠按 `padding` 的越界夹取（它会把末层推离中心） | `topologyTierTreeLayout.ts`（第 ⑥ 轮平移 + `bbox`） |
| 3 | 「选中的圈再紧一点、本体再粗一点」 | 节点选中档：外延环 `r + 2` / 4px / 50%（0.17.16 是 `r + 5` / 3px / 45%），本体描边 2px → **3px**；一跳邻居档不变（`r + 3` / 2px / 22%，本体仍 2px） | `TopologyCanvas.vue`（`NODE_HALO` / `nodeStrokeWidth()`） |
| 4 | 「与选中节点相连的线要亮起来，颜色跟着这个节点」 | `incident` 外延环的不透明度 16% → **30%**、`selected` 30% → **45%**（0.17.18 再收到 **35%**，见 §6.15.6）：低不透明度叠在画布底色上时，层色几乎被底吃掉，等于「染了看不出」；本体与档位宽度不动，所以「粗细 = 带宽」「灰 = 连接关系」两条读数仍然成立 | `topologyLinkStyle.ts`（`HALO_OPACITY`） |

- **为什么环要「紧」而不是「大」**：选中档作用在**已经加粗到 3px 的本体**外面，环再外扩（`r + 5`）就与本体之间留出一圈缝，读起来像两个互不相干的圆；贴着圆边（`r + 2`）+ 4px 宽 + 50% 才像「这台被圈住了」。邻居档保持 22%：它只回答「这条线连着谁」，不该与选中项抢注意力。
- **为什么把「粗」还给节点本体**：链路那边粗细是带宽的唯一读数，加粗等于改读数；节点上没有第二套粗细语义（全图恒 2、只为选中服务），因此「本体 2 → 3」不会与任何读数冲突，而它让选中项在不放大半径的前提下变得更好点、更好认。
- **叶子的「归位终端层」先于根优先**：一台没有下级的设备若被选举成根（单机图），它是顶点不是末端 —— `tierOfNode()` 先判 `isRoot` 再判 `isLeaf`，否则同一台设备会同时被要求「在首行」和「读作终端层」。
- **断言**：A24 改成「末层 `x` 均值 = 画布中心（读当前 `viewBox` 宽度的一半，本例 537 而不是写死的 500）±1px」；A43 在同一份 20 台样本上加钉 `data-node-tier` 的 `0` / `1` 与「末层 14 台均值 = 画布中心」；A47 改钉「选中节点本体 3px + 外环 `r+2` / 4px / 0.5 且环色 = 该节点层色」「4 条 `incident` 外环 0.3」，A51 的焦点环 0.3、A49 的选中环 0.35 / 7.5px 随之同源（选中链路的外延在 §6.15.6 收窄）。

#### 6.15.6 选中链路改主色、标签方向由布局给、默认选中根、指标按钮压底（A44 / A45 / A47 / A48 / A49 / A51 改写，2026-11-09 落码）

同一轮用户看监控页提了四条，覆盖**当前项怎么说**与**标签怎么摆**两件事：

| # | 要求（用户原话） | 落法 | 落点 |
| :---: | :--- | :--- | :--- |
| 1 | 「选中的链路用主色，光晕细一点」 | 被点中的那条链路是 §6.15.2「强调不动本体」的**唯一例外**：本体描边 `stroke-(--ui-primary)`，外延环随之收窄 —— `selected` 档增量 9 → **5**（1 Gbps 那条 = 本体 2.5 + 5 = 7.5px）、不透明度 45% → **35%**。关联档（`incident`）不动（+6 / 30%，仍染选中设备的层色） | `topologyLinkStyle.ts`（`HALO_BUMP` / `HALO_OPACITY`）+ `TopologyCanvas.vue`（`linkBodyClass()` / `linkHaloClass()`） |
| 2 | 「径向标签字号、位置要统一」 | 字号不再逐布局变（两种布局同一个 10px，`LABEL_FONT_SIZE` 不变）；**位置**改成「节点 + 布局给的单位方向 × 半径 + `LABEL_GAP`」，方向由布局层给：径向扇 = 背离本扇圆心（`fans[].apexId` 的坐标）、层级树 = 正下方 `(0, 1)`。文本改为 `text-anchor="middle"` + `dominant-baseline="middle"`（锚点 = 文字中心），错行档高仍按 `LABEL_LINE_HEIGHT` 叠在同一个方向上 | `topologyLayout.ts`（`labelDirDx` / `labelDirDy` / `labelDirOf()`）+ `topologyLabelLayout.ts`（`LABEL_GAP = 12`）+ `TopologyCanvas.vue`（`labelAnchor()`） |
| 3 | 「打开监控页就选中根节点；右栏只有设备或链路，不许有空态；链路卡片不要关闭叉」 | `defaultSelectionId()`（选举出的根；顶端带只有一台时选举不触发，此时取**最上一档** —— 径向扇里是扇心 `fans[].apexId`、层级树里是塔尖）成为 `selectedNodeKey` 的初值，收起子树把它藏起来时也回落到它；`selectNode()` **不再**「点第二下取消选中」。链路视图与设备视图是**同一份当前项**的两种形态：点链路时节点选中保留、画布 `selected-id` 暂置空（`canvasSelectedId`），再点同一条线即退回设备视图 —— 因此链路卡片不需要关闭按钮，`topology-link-close` 与其 i18n 键一并删除 | `useTopologyMonitor.ts`（`defaultSelectionId()` / `selectNode()`）+ `monitor.vue`（`canvasSelectedId` / `selectLink()`） |
| 4 | 「指标按钮挪到卡片最下面、用主色」 | 节点卡与链路卡的深链按钮从标题下方移到**卡片最后一块**（`primary` + `soft`，`block` 居中），读完全部事实再决定往下走；文案写成动作本身「查看设备指标 / 查看链路指标」（旧的「打开指标页」更像跳转说明） | `monitor.vue` + `i18n/locales/{cn,en}.json`（`detail.openMetrics` / `link.openMetrics`，删 `link.close`） |

- **为什么选中链路可以换色、关联链路不行**：关联链路是**背景关系**（「这些线连着谁」），换色会让「灰 = 连接关系」这条唯一色义失效；被点中的那条是**当前项**，与右栏那张卡片是同一个东西的两种视图，用 `primary` 说「就是这条」比再加一层灰环直接。本体的**宽度**仍然只读带宽 —— 换的是色，不是粗细。
- **为什么标签位置交给布局层**：径向扇里同档节点沿弧排开，「一律写在下方」会把名字压到下一个节点上（20 台样本里 9 个标签压节点，读者分不清名字属于谁）。方向是几何事实，只有排坐标的人同时知道它，画布层再去猜就晚了一步；布局层给单位向量，画布只做一次乘加。
- **为什么「没有未选中态」**：右栏的空态卡片只告诉人「这里能点」，而画布上本来就没法「什么都不选」—— 面板与画布的当前项应该一致。默认选根（塔尖那一台）是唯一不偏袒分支的选择，且它与「边界层」的视觉一致。
- **为什么去掉链路卡片的关闭叉**：一枚叉把「关掉卡片」和「取消选中」混成两件事，还让人以为卡片是个弹窗。退出链路视图的出口是「再点一次这条线」或「点一台设备」，两者都在画布上、都在当前项的语汇里。
- **断言**：A44 加钉「层级树标签 `data-label-dir` 恒为 `0,1`」；A45 加钉「径向扇 19 台非圆心节点的 `data-label-dir` 与它到根的射线同向（点积 > 0.3）、标签中心真的落在该方向的外侧」；A47 把「取消选中」改成「再点同一台仍是 3px + `selected` 环 + 4 条关联」，A51 的 `Space` 从「取消」改成「回到设备视图」且焦点环仍只借那支灰、`Enter` 后本体是主色；A48 加钉两枚指标按钮「压在卡片最底部（所有事实行都在它上面、后面没有兄弟节点）、class 含 `primary`」；A49 加钉「进页即选中根（恰 1 个 `selected` 环、就是 `data-node-role=root` 那台、右栏无空态）+ 链路态无 `topology-link-close` + 选中链路本体 = 主色 / 外延 7.5px / 0.35」。`check:ui` 条数不变（六条改写、零新增）。



---

## 七、图形形态

图形全部自绘（`NMCPS-ADR-0019` D1 / D2），本域只允许使用下列组件，页面不得自建 canvas 或自起 `requestAnimationFrame`。

| 组件 | 用在哪 | 载体 | 关键要求 |
| :--- | :--- | :--- | :--- |
| `TopologyCanvas` | `monitor` 主视图 | SVG（≤ 400 节点）+ 等轴投影（2.5D 观感） | 布局以纯函数注入；节点上限 400 / 链路上限 1,200，超出按权重裁剪并显示「已裁剪 N 个」；拖拽 / 缩放 / 框选命中测试由 `app/composables/useGraphInteraction.ts` 统一提供；节点手动拖拽的**位移增量**由 `app/utils/graph/topologyNodeOffsets.ts` 记账并在渲染前合成（§6.9）；连线一律中性灰、选中节点时关联链路与一跳邻居一并高亮（§6.15，`topologyHighlight.ts`）；有下级的节点可收起 / 展开子树（§6.15，`topologyCollapse.ts`）；画布自身**不上底色**（框内透明、只留描边与圆角，0.17.16 起）；控件排（旋转 / 缩放 / 显示名称 / 恢复默认配置 / 更新）在页面工具栏左区、图例在画布右下角（§6.8 / §6.15.4） |
| `TrendChart` | `device-metrics` / `link-metrics` 主图（`monitor` 不再自绘，详情栏只给深链按钮，§6.5） | SVG 折线 + 面积填充 | 阈值带、时间窗选区、游标读数；> 2,000 点按像素列聚合（保留极值） |
| `SparkStat` | 页面头部与详情栏的小卡片 | SVG | 单值 + 迷你趋势 + 状态色，替代 1.0 里分散的 unovis 迷你图 |

- **状态色**：节点 / 链路状态色来自 `app.config.ts` 的语义色，禁止硬编码 hex。
- **节点视觉语言（复刻 1.0，2026-11-08；色板 2026-11-09 改版）**：外圈**恒为层色**、填充恒为极淡中性色、半径随层级递减（根 19 / 核心 17 / 汇聚 16 / 接入 14 / 终端 12 逻辑单位）；**状态语义只由中心圆点承载**（半径 = 节点半径 × 0.38），状态变化不改外圈颜色。五档层色是用户指定的固定色板，**唯一源**在 `app/assets/css/main.css` 的 `--topology-tier-*`（`boundary #f33` / `core #f3c` / `distro #c63` / `access #369` / `terminal #0c6`），`topologyRoleStyle.ts` 只引用变量名，组件里没有硬编码 hex（五档对照见本节末「层色板」表）。层由**所在层序**决定而不是上游 `type`（1.0 ADR-012 同口径：按 `type` 取色会让接入交换机与核心路由器同色），角色 → 描边 / 半径的唯一源是 `topologyRoleStyle.ts`，画布只在 `data-node-role` / `data-node-tier` / `data-node-status` 上暴露结果。**为什么不再借 Nuxt UI 的四档语义色**（`error` / `warning` / `info` / `success`）：层级有五档而语义档位只有四个，五层必然有两层同色（根曾借用中性深色 `--ui-text`，图例里说不出它是什么颜色），且语义色自带「严重程度」含义 —— 一台红色的核心会被读成「这台有故障」。1.0 的圆点比例是「直径 × 0.2」，2.0 放大到 0.38 是因为塔型 `viewBox` 会缩到 0.3~0.5 倍（×0.2 在屏幕上只剩 1px，状态等于看不见）—— 语义不变，只是把 1.0 在 1:1 画布上的可读比例搬过来。图例本体只回答「外圈这几种颜色分别是哪一层」（只列实际出现的角色，挂在**画布右下角**，§6.15.1 起状态组已删 —— 状态由圆点直接读出）；此前它还在详情栏卡片里，对色号要移开视线，等于让人靠记忆比对。
- **页头读数在工具栏右区**（2026-11-08 用户裁决；2026-11-09 收成四枚）：节点 / 链路 / 组合 / 告警四个 `UBadge` 注入 `#app-toolbar-right`（`topology-stats`），不再用 `SparkStat` 卡片独占内容区第一行 —— 那一行 100px 高只为装几个数字，却把画布整个往下推（「仿真中」那枚已删，仿真没配置是部署形态不是读数，§6.15.4）。读数口径不变：缺数据写「—」而不是 0（告警通道没起来时 0 条是误读）。`SparkStat` 组件本身保留（`dashboard/overview` 的统计卡仍按它的形态排，`dashboard.md` B2 引用同一 testid）。
- **根节点的视觉**（A43 / A45，2026-11-09 改版）：选举出的根用**边界层红**（`--topology-tier-boundary` `#f33`）+ 最大半径（19）表示。0.17.16 之前它借的是中性深色（`--ui-text`），因为当时只有「核心红 / 汇聚橙 / 接入蓝 / 终端绿」四色、再加一色怕与接入蓝混淆；改成五档色板后根有了自己的第五档红，「同一层 = 同一色」在根上也成立，图例因此能把它当一种颜色列出来（文案仍是「边界层」）。根在图上有且只有一个、又位于塔尖（径向扇里落在圆心、层级树里落在首行），再加上「更大的圆」，三重区分足够。图例只列**这张图实际出现**的角色（`presentRoles()`：没有选举出根就不列「边界层」，i18n `roles.root` 的文案自 0.17.8 起是「边界层」而不是「根节点」—— 改的是文案，角色 id 仍是 `root`），避免图例宣称画布上不存在的层；角色由两档布局**共用**的层序归约 + `roleOfNode(tier, isLeaf)` 给出（叶子一律归位终端层，§6.15.2 要求 3），切布局不改颜色（A45）。
- **名称标签只错行、不截断**（A44，`app/utils/graph/topologyLabelLayout.ts`，纯函数，2026-11-09 用户裁决）：dagre 只保证**圆心**不重叠（`nodesep 80`，窄画布收窄到 `TIER_TREE_MIN_NODE_GAP = 74`），名称比圆宽得多 —— 硬摆会互相压字。规则只有一条：放得下（`宽度 ≤ 间距 − LABEL_GUTTER`）⇒ 单行原样；放不下 ⇒ **整行隔一个抬一行**（奇偶分两条基线，可用宽度翻倍）。0.17.16 起**截断整条删除**（`fitText()` / `LabelPlan.text` / `data-label-truncated` / 补全名的 `<title>` 一并下线）：画布上的「汇聚交换机…」会被拿去对台账，半截名字认错设备比略挤更贵。字宽是「中文按 1.0 × 字号、拉丁按 0.56 × 字号、空格 0.28」的估算（留 `LABEL_GUTTER = 6px` 余量），因此在布局层就能算完、不需要渲染后 `getBBox()`。**方向由布局层给**（§6.15.6）：径向扇背离本扇圆心、层级树正下方 `(0, 1)`，间距统一为 `半径 + LABEL_GAP(12) + 错行档高`，文本居中锚定（`text-anchor` / `dominant-baseline` 都是 `middle`）—— 每一台的标签与自己的圆保持同一个间距，径向扇里不会再压到下一个节点上。
- **字号 10px 是「不截断也不压字」的前提**（2026-11-09）：`LABEL_FONT_SIZE = 10` / `LABEL_LINE_HEIGHT = 11`（画布上同值 `text-[10px]`）。11px 时 7 个全角字约 77px，超过最小间距下单行可用宽度（74 − 6 = 68px），满行只能靠截断；收到 10px 后错行可用宽度 `2 × 74 − 6 = 142px`、单行 68px，「无线终端设备-01」约 77px 在错行下仍有余量 ⇒ 常规规模既不错行丢字、也不压字。字号再小就影响可读性，间距再放大就把塔型挤出视口，10px 是这两条约束的交点。
- **「显示名称」开关**（A44）：工具栏左区控件排里 `data-testid="topology-labels-toggle"` 的 `UButton`（`aria-pressed` 反映状态，0.17.15 起随其余控件搬进工具栏左区，0.17.8 时在画布右上），关掉后塔型只剩节点与状态圆点。它只影响**渲染**：布局、几何、位移增量表都不动，关掉再打开必须原样复原（窄屏看层级、截图时用）。
- **2.5D 观感的来源**：等轴投影是画布**样式**（椭圆基底 / 斜切连线 / 阴影），几何仍只来自 `layoutTopology()`；不读上游 `style.x|y`（§6.11 已证它是「每层单行」的示意图，`x` 跨 120 ~ 4520，复用得先缩放再裁切，画出来仍是扁平一行）。

**层色板**（2026-11-09 用户指定；唯一源 `app/assets/css/main.css` 的 `--topology-tier-*`，明暗两模式同一组值）：

| `tier` | 角色 | 文案 | CSS 变量 | 色号 |
| :---: | :--- | :--- | :--- | :---: |
| 0 | `root` | 边界层 | `--topology-tier-boundary` | `#f33` |
| 1 | `core` | 核心层 | `--topology-tier-core` | `#f3c` |
| 2 | `distro` | 汇聚层 | `--topology-tier-distro` | `#c63` |
| 3 | `access` | 接入层 | `--topology-tier-access` | `#369` |
| 4 | `terminal` | 终端层 | `--topology-tier-terminal` | `#0c6` |

档号与角色**一一对应**：`normalizeTier()` 把上游值收在 1..4，`0` 只可能由层序归约（根节点选举）产生（`ROOT_TIER`），叶子则一律改写为 `4`（`LEAF_TIER`）；详情栏的「层级」读数与画布外圈因此同源。

- **尺寸**：一律 `ResizeObserver` + `useDevicePixelRatio`，不读 `window.innerWidth` 决定布局（容器查询收敛，`NMCPS-ARCH-006`）。
- **动效**：遵循 `prefers-reduced-motion`；不跑常驻 `rAF` 循环，仅在数据到达时重绘。
- **无障碍**：图与图例 `role="img"` + `aria-label`，并提供等价的列表视图（键盘可达）。

---

## 八、空态与降级态

| 场景 | 表现 | 判定依据 |
| :--- | :--- | :--- |
| 拓扑为空（上游返回空 `nodes`） | 空态插画 + 「当前租户下暂无拓扑数据」+ 刷新按钮；**不**显示空白画布 | `data.nodes.length === 0` |
| 指标无数据点 | 空态 + 「该时间窗内无采集数据」；时间窗与指标选择器保持可用 | `matrix` 为空且无错误 |
| 节点事实字段缺失（`cpu` / `memory` / `interfaces` / `traffic`） | 该格显示「—」，**不画**空进度条、不写 `0%` / `0 Mbps`；`interfaces: 0` 照写 `0` | `nodeFactsOf()` 返回 `null`（缺字段 / `-1` / 非数值），§6.7 |
| 当前布局不支持某个视图控件 | 旋转控件在非 `radial` 布局下**整块不渲染**（不置灰占位）；切回 `radial` 时角度保持用户上次设定 | `layoutMode !== 'radial'`，§6.8 |
| 拖拽位移的归属与失效 | 位移只是**本地视图增量**：节点拖走后 30s 轮询 / 手动刷新不会弹回；切换布局时随几何基准一起清空（不留「半新半旧」的图）；没有可复位项时「恢复默认配置」`disabled` 并在 tooltip 说明原因，而不是按钮亮着却点了没变化 | `nodeOffsets` 非空 / `rotationDeg !== RADIAL_ROTATE_DEG` / 视口偏离（§6.9） |
| 指标取数失败（上游信封 `code !== 0`） | `UAlert`「取数失败」+ **上游原话逐字**（不翻译、不换成 `api_request_failed`）+ 重试按钮；**不**同时渲染「该时间窗内无采集数据」的空图（失败不等于没数据）；若手上还有上次成功的数据，图保留并加一行「指标通道暂时不可用」的 stale 提示 | BFF 归一后的 `status: "error"` / 客户端 `ApiError` |
| 8888 未配置 / 不可达 | 页面级 `UAlert`（错误态）+ 重试；导航与其他域不受影响 | `/ready` 的 `upstream.configured === false` 或请求 `5xx` |
| 仿真平台未配置 | **页面正常只读**：拓扑、指标照常展示；仿真控制按钮组整体 `disabled`，失败原因留在按钮的 tooltip（「仿真控制未启用（未配置仿真平台）」），**页头不挂常驻告警条** —— 「没配仿真平台」是部署形态而不是故障，常驻告警条等于把它当缺陷报给用户（1.0 顶栏也没有这条；`check:ui` 的「不再挂『未启用』告警条」一条钉住它） | `runtimeConfig.simulator.baseUrl` 为空（`simState === "disabled"`） |
| 仿真平台 `allowWrite=false` | 写按钮可见但 `disabled`，hover 说明「仿真写入未开启」；即使绕过前端，BFF 亦返回 405 | `/api/sim/channel` 的 `writeEnabled === false`（客户端不猜；页面对应请求一条都不发） |
| 仿真平台不可达 | 局部降级：只读部分保留，仿真标记与 LLDP 分区显示「仿真平台不可达」；**不得**让 `/ready` 变红 | 通道请求超时 / 连接失败 |
| 裁剪触发 | 画布内角标「已裁剪 N 个节点 / M 条链路」，并给出「切到分层/径向视图减少裁剪」的提示 | 节点 > 400 或链路 > 1,200 |
| 上游形状与读模型不一致（节点 / 链路带 `data` 外壳） | **不退化**：拍平在取数边界完成，布局 / 详情栏 / 画布照常出数（分层仍按 `tier` 分行、名称取 `data.deviceName`、事实取 `data.cpu` 等）；拍平缺失时的表现为「一条水平线 + 名称退化成 IP + 详情全『—』」，属缺陷而不是降级态 | `normalizeTopologyGraph()` 在 `loadGraph()` 调用；§6.10 / `check:ui` A27 |
| 指标台账加载失败（`/metric/device` / `/metric/link`） | 左栏只出一条 `UAlert`（标题 i18n + 上游原话）+ 重试；**不**同时渲染空态文案，计数改「设备数 / 链路数未知（台账加载失败）」而不是「共 0 台」；右栏若挂着 `?id`，提示改「台账加载失败，无法确认这台设备」而不是「不在当前分页结果内」 | `useMetricLedger` 的 `error` 非空（如 `bff_upstream_unreachable`）；`check:ui` A19 / A20 |
| 告警通道失败（`/alarm/alarm-events` 信封 `code !== 0` / 网络错误） | **只摘叠加层**：画布角标零个、页头「告警设备」读数写「—」（不写 `0`）、详情栏出「告警通道不可用：<上游原话>」；**不**写「该节点没有进行中的告警」—— 读失败不是「没有」。拓扑、链路、仿真区块一律照常渲染 | `alarmState === "error"` 且 `alarmReason` 非空；`check:ui` A32（假上游 `__control/alarm-error`） |
| 只有一个分组可见（聚焦） | 画布只留该组成员与组内链路，页头出徽标「只看 <组名>」+「看全部区域」清除按钮；清空后复原全部节点与链路，位移层同时清空 | `focusedCombo` 非空；`check:ui` A33 |
| 收起某个节点的下级 | 该节点留在图上并显示 `+N`，被遮住的下级与挂边从渲染里摘掉，**留下节点的坐标逐点不变**（几何按完整集合算，位移层不清空）；左上角出「已收起 N 台」徽标 + 「全部展开」；上游删掉该设备 / 它已没有下级时收起条目自动失效（不落盘） | `collapsedNodes` 非空且仍可收起；`check:ui` A46（§6.15） |
| 选中了没有下级的节点 | **不出现**展开角标、双击也不收起 ——「没有这个能力」与「有但点了没反应」是两件不同的事 | `childCounts[id]` 为 `0`；`check:ui` A46 断言可收起节点数 |
| 指标页深链解析不到记录（管理 IP 在台账前 20 页里都不存在） | 目标页保持默认选中（列表首条），**不无限翻页去捞**、不显示「不在当前分页结果内」的假空态；深链参数本身保留在 URL 里，可复制、可刷新。目标在**第 2~20 页**时则由深链自己切到那一页并选中它（§6.15.1） | `resolveDeepLink()` 返回 `null`（`app/utils/metric/metricDeepLink.ts`，§6.15） |
| 深链缺身份（节点没有管理 IP） | 详情栏按钮 `disabled`，tooltip 写明「该节点没有管理 IP，无法在设备台账里定位它」；不发一枚点了到空页的按钮 | `selected.ip` 为空串；i18n `detail.openMetricsNoIp` |

**硬性要求**：任何降级态都必须说明「缺的是哪一路数据、影响哪些区块、能否重试」，不允许静默空屏或把可选上游的抖动升级成整页错误。

---

## 九、验收断言

`check:ui` 落地时逐条断言（未实现的项在 P1 落地时补齐，不得先写成「已通过」）：

| # | 断言 | 判据 |
| :---: | :--- | :--- |
| A1 | 三页均可路由到达且标题来自 i18n | `i18n/locales/*.json` 的 `topology-{monitor,device-metrics,link-metrics}` 各出现一次，页面无硬编码 CJK |
| A2 | 拓扑页渲染出 `TopologyCanvas` | 选择器命中 `[data-testid="topology-canvas"]`，SVG 内 `circle`/`path` 数量 > 0 |
| A3 | 监控页把「看趋势」交给指标页（详情栏只留深链按钮） | 点击节点 → 右栏**不出现** `trend-chart` / `trend-error`，页面**零** `/api/metric/*` 请求，`topology-node-metrics` 的 `data-mgmt-ip` = 该节点管理 IP；点它跳到 `/topology/device-metrics`，`/api/metric/datapoint` 带 `mgmt_ip` 与 `metric_code=if_in_octets`（编码取自 `/metric/name` 的首个非采集器名），折线出在该页；非法采样点丢弃并计数，不补 0 | 折线归指标页（§6.5）：监控页不取数，就没有「页面级失败文案」可言；能力没被砍掉由「深链真的落地」这一半钉住 |
| A4 | 空拓扑渲染空态而非空白画布 | 假上游返回 `nodes: []` → 出现空态文案，`topology-canvas` 不存在 |
| A5 | 8888 掉线降级 | 关闭假上游 → 点工具栏「刷新拓扑」→ 出现错误态 `UAlert` + 重试按钮，页面不白屏；上游恢复后点「重试」回到拓扑。**不整页 reload**：掉线时重载会让会话探测一起失败，被守卫送回登录页，断言的就不是本页的错误态了 |
| A6 | 仿真未配置时只读 | 不设 `NUXT_SIMULATOR_BASE_URL` → 拓扑正常渲染、画布上**没有**任何节点级动作按钮（`topology-node` 里不再有 `sim-action`，2026-11-09 用户裁决下线），且页面**不再出现**「仿真控制未启用」的常驻告警条（`sim-degraded` 不存在；原因只在链路动作按钮的 tooltip 里） | 「未配置」是部署形态不是故障（§八）；「画布不提供节点停止 / 重启」在 A6 与 A9 各钉一次（只读实例 / 开了写的实例），写入口只剩链路详情卡里的 `topology-link-action`（A35 端到端） |
| A7 | 写端点被拒 | 两层门槛，顺序固定（路径白名单 → 通道是否启用 → 写权限）：通道未配置先短路成 503 `simulator_not_configured`；通道已配置而 `allowWrite` 仍为默认 false 时返回 405 `simulator_write_disabled`，且该请求不触达上游 |
| A8 | 不做全站失效 | A6 / A7 场景下 `/ready` 仍 200 且 `upstream.configured === true` |
| A9 | 写入口二次确认 + 审计留痕 | `allowWrite: true` 的实例上：`/api/sim/channel` 回 `writeEnabled=true`，画布**仍然没有**节点级动作按钮（`sim-action` 数 0、页面文案里没有「停止节点」/「重启节点」—— 写入口只剩链路卡里的 `topology-link-action`，端到端见 A35）；BFF 侧对每次写输出一行结构化审计日志 `{"event":"simulator.write",…}`（方法 / 模板 / 状态 / 耗时 / `x-request-id` / 客户端 IP，**不含请求体**）。`allowWrite=false` 时链路动作按钮 `disabled`、页面零写请求，且能力探针响应里不出现上游 `baseUrl` | 节点级「停止 / 重启」2026-11-09 下线（那两档改的是整台设备的运行态，与「看拓扑」不是一件事）：A9 因此从「六个节点写流程断言」收成一条否定式断言 —— 开了写也不许在画布上长出动作 |

| A10 | 指标页台账与选择器（`device-metrics`） | 左栏渲染设备台账（行数 > 0、计数来自信封 `total`，行恰 2 行：主标识 + `IP · 邻居 N · 端口 up/total`），默认选中第一条；右栏指标选择器**只列目录判为 `numeric` 的条目**（假上游把 `sys_name` 标成 `string`，选项里不得出现它） | 清单元数据 `meta_source` 为 `backend`（目录命中）；`GET /metric/definition` 只发一次 |
| A11 | 指标页出图与速率开关（`device-metrics`） | 默认指标渲染 `TrendChart`，`/api/metric/datapoint` 带该设备 `mgmt_ip` 与 `metric_code=if_in_octets`；切到 `gauge` 类指标后请求换 `metric_code` 且**不带** `rate`（`counter` 才有速率开关） | 序列里非法点丢弃并计数；空态不画 0 值直线 |
| A12 | 链路页台账与出图（`link-metrics`） | 左栏渲染链路台账（行数 > 0，标题 = 两端设备名如 `核心路由器-1 → 接入交换机-1`、次级信息 = 两端 `接口名:IP` 如 `GE0/0/1:10.0.0.2 → GE1/0/1:10.0.0.3`）；选中一条后右栏出现 `TrendChart`，`/api/metric/datapoint` 带该链路 **source 端设备**的 `mgmt_ip`，折线取的是 **`metric.ifIndex === identity.source.if_index`** 的那一组（同 `ifIndex` 跨 `job` 先取均值，不与他端口混画） | `device_code → mgmt_ip` 映射来自 `/metric/device`；`if_index` 缺失 / 指标无 `ifIndex` 标签 / 零匹配三种情况按 §6.6 如实标注，不回落、不伪造 |
| A13 | 指标取数失败不降级成空态（`TrendPanel` 共用面板） | 上游回 HTTP 200 + `code !== 0` 时出现 `[data-testid="metric-trend-error"]`，描述文字**等于上游 `message` 原文**、带「重试」按钮，且页面上不出现「该时间窗内无采集数据」、图表容器不渲染；上游恢复后点「重试」真的取到数据（错误态消失、折线回来） | 假上游 `__control/metric-error` 造信封失败（不是网络错误，后者走 `__control/down` 的 stale 分支）；`check:ui` 中两条断言，对应 `NMCPS-CONTRACT-002` §6.7 的 S3 |
| A14 | 设备页复用同一面板时语义一致（`device-metrics`） | 选中一台设备后，上游 `code !== 0` 同样只出 `[data-testid="metric-trend-error"]`（原话逐字 + 重试），页面无「该时间窗内无采集数据」、图表容器不渲染 | `check:ui` 一条断言；同一 `MetricTrendPanel`，防的是「换页时语义漂移」 |
| A15 | 指标失败时监控页不编（`monitor` 不再取数） | 上游 `code !== 0` 时进监控页并选中节点：不出现 `trend-error`，页面上既无「该时间窗内无采集数据」也无上游原话，`trend-chart` 不渲染，且页面**零** `/api/metric/*` 请求；深链按钮仍在（能力在指标页，A13 / A14 钉它） | 监控页手上根本没有这份数据，说「没采到」或「没取到」都是编；这是「不取数」而非「取数失败降级」 |
| A16 | 同设备重取遇**网络错误**时保留旧折线并标 stale | 先成功出图（`data-series-count` 非空），上游掉线后点「刷新指标」：错误提示出现、折线仍在且序列数不变、页面出现「指标通道暂时不可用」 | 走 `__control/down`（网络错误，`bff_upstream_unreachable`），与 A13/A14/A15 的信封失败是两条不同的路；`check:ui` 一条断言 |
| A17 | 目录失败不阻塞出图、也不冒充取数失败（§8.4 的第三种失败） | 让假上游对 `/metric/definition` 回 HTTP 200 + `code !== 0`：出现 `[data-testid="metric-catalog-degraded"]`（含「只按名字判断类型」）、`trend-chart` 照常渲染且 `data-series-count` 非空、**不出现** `[data-testid="metric-trend-error"]`、目录的失败原话一个字都不上页面 | 失败在「类型判定依据」而不是取数：名字清单与序列都还好，所以既不许降级成空态，也不许把目录原话当成取数失败展示；假上游 `__control/catalog-error` 造样本，`check:ui` 一条断言，对应 `NMCPS-CONTRACT-002` §8.5 的 S5 |
| A18 | 降级的**后果**如实暴露（选择器退化为只按名字判断） | 同一目录失败态下打开指标选择器：选项只剩编码（`if_in_octets` / `cpu_util_pct` / `sys_name`，`en_name` 随目录一起消失），且 `sys_name` 这种目录里标 `string` 的文本指标**真的混进选项** | 断言「提示不是装饰」：如果选择器依旧干净还带显示名，说明目录其实没失败、A17 的降级是假象；`check:ui` 一条断言 |
| A19 | 台账失败不冒充空态（`device-metrics`） | 上游掉线后进 `?id=DEV-CORE-1`：左栏出现「加载设备台账失败」+ 上游原话 + 重试，页面**不出现**「当前租户下没有设备事实」、**不出现**「共 0 台设备」，右栏**不出现**「不在当前分页结果内」（改为「无法确认这台设备」） | 走 `__control/down`；本行补的是 2026-11-06 视觉自查里肉眼发现、当时所有断言都没覆盖的一处矛盾（`NMCPS-ARCH-006` §3.4） |
| A20 | 台账失败不冒充空态（`link-metrics`，`?id=LNK-0001`） | 同 A19 的三条否定判据，外加左栏错误提示与重试按钮在场 | 两页共用同一套列表/详情模板，只钉一页等于没钉 |
| A21 | 节点详情事实层照 1.0 口径出数（`monitor`） | 选中 `10.0.0.1`（假上游把 `cpu` / `memory` / `interfaces` / `traffic` 全给了）：`topology-fact-cpu` 为 `21.5%`、`memory` 为 `48%`、`interfaces` 为 `24`、`neighbors` 为 `2`、`traffic` 以 `12.5` 开头，并列出 2 行邻居 | 「复刻 1.0 详情栏」的最小可证面；`check:ui` 一条断言 |
| A22 | 上游没给的事实写「—」而不是 0 | 选中一个指标字段都不给的节点：`cpu` / `memory` / `interfaces` / `traffic` 四格**全为「—」**，且进度条元素数为 **0**（不画空条） | 空进度条会被读成 0%，所以「不渲染」本身也在断言里（`NMCPS-CONTRACT-002` §6.3） |
| A23 | 1.0 的 `-1` 哨兵按未知处理，真实 0 与旧 Kbps 字段照实归一 | 选中 `cpu: -1` / `memory: -1` / `interfaces: 0` / `trafficTotalKbps: 1500` 的节点：CPU 与内存为「—」，接口数为 `0`，流量以 `1.5`（Mbps）开头 | 三种口径必须分开判：哨兵当未知、`0` 当真实值、Kbps 归一为 Mbps |
| A24 | 两档布局可切换且**真的换了坐标**，层级树的父节点压在子女中线上 | 下拉只有 `径向扇` / `层级树` 两项：`[data-testid="topology-layout-switcher"]` 的 `data-layout` 依次为 `radial` / `tree`；两档的节点坐标两两不同；切回 `径向扇` 与初始坐标**逐点相等**；层级树里 `core.x = 两台汇聚的中点 = access.x = 两台终端的中点`（±1px）、**末层均值 = 画布中心**（当前 `viewBox` 宽度的一半，本例 537 而不是写死的 500，±1px），两档的节点都不越 `viewBox` | 断言的是几何而不是「点了没报错」：父压子女中线由几何库第 ⑤ 轮收敛保证（§6.8），坐标比对见 `check:ui` 第 11 段；0.17.15 收掉 `layered` 后这条从「三档两两不同」改成「两档不同 + 父压子女中线」 |
| A25 | 径向扇旋转：只在 `radial` 出现、步进 +5°、复位回 25° | `layered` 下 `[data-testid="topology-rotate"]` **不存在**；切到 `radial` 后角度徽标为 `25°`、点一次逆时针步进变 `30°` 且节点坐标变化、点复位回 `25°` 且坐标与未旋转时**逐点相等**；切回 `layered` 控件再次消失 | 「渲染但置灰」不算过：控件的不存在本身在判定里（§6.8） |
| A26 | 节点拖拽位移保持 + 「恢复默认配置」三合一复位 | 在 `radial` 下按住节点圆心拖 (+90, +50) 像素：**只有被拖的那一台**坐标变化，`[data-testid="topology-reset-view"]` 的 `data-offsets` 由 `0` 变 `1` 且按钮可点；点工具栏刷新（一次完整重渲染）后坐标**逐点不变**（不弹回几何位）；再叠一次缩放（`125%`）与 +5° 旋转后点复位：角度回 `25°`、缩放回 `100%`、`data-offsets` 回 `0`、坐标与拖拽前**逐点相等**、按钮重新 `disabled`；再拖一次后切 `层级树`：`data-offsets` 归 `0` 且按钮复位为 `disabled`（切布局清位移） | 位移层与几何层分离的直接后果（§6.9）：「拖完保持」与「一键收回」必须同时成立，只断言其一等于没测；`check:ui` 一条断言 |
| A27 | 两层形状（`data` 嵌套）拍平后仍是正常拓扑，且与扁平形状**逐点一致** | 假上游默认回现网形状（`control.topologyNested` 初值 true），`__control/topology-nested` + 整页重载后：分层布局 `data-layout=layered`、6 台节点落在 4 行（`cy` = `70,220,370,520`，即 `PADDING_Y + BAND_HEIGHT × (tier − 1)`）、节点名取自 `data.deviceName`（不是管理 IP）、选中 `10.0.0.1` 后 `topology-fact-cpu` = `21.5%`、`interfaces` = `24`；再 `__control/topology-flat` 切回扁平本体重载，读到的每个节点坐标必须与两层形状**完全相同** | 2026-11-07 用户反馈「页面没看到变化」的真因：不拍平则 `tier` 全落空 ⇒ 36 个节点排成一条水平线；坐标落点钉住「tier → 分带」的映射，`flatSame` 再钉「形状不影响结果」，`check:ui` 一条断言 |
| A28 | 点链路出事实卡，利用率四项写「未计算」 | 点 `10.0.0.1 → 10.0.0.2` 那条连线（假上游把 `medium` / `relation` / `admin_status` / `telemetry` 全给齐）：`topology-link-card` 出现且读数 = `fiber` / `optical` / `up` / `enabled` / `1 Gbps` / `12.5 Mbps` / `16.18 Mbps`，四格利用率（`util-in` / `util-out` / `packet-loss` / `error-rate`）**全是「未计算」**，卡片所有事实格里不出现 `0%`，画布 `<title>` 也含「未计算」 | 现网 48/48 链路这四项实测全 0 而流量非零（§6.11）⇒ 0 是「没算」；`cells` 全量扫描钉住「任何一格都不得把没算的写成 0%」 |
| A29 | 折叠区域分组后画布摘掉成员与挂边，组计数不变 | 打开画布左上角的分组浮层（`topology-groups-toggle`）后折叠 `combo-edge`：节点 6 → 3、连线 6 → 2（挂在该组上的 4 条随之消失）、角标写「已收起 3 台（1 组）」、`topology-groups-expand` 出现，且 `topology-group-counts-combo-edge` 文本**折叠前后逐字相同**；点「全部展开」复原到 6 / 6、角标消失 | `counts` 是上游自报的分层计数而不是画布统计，折叠只改视图输入（`collapsedCombos`）—— 计数跟着画布变就等于把「上游说了什么」改写了；清单在浮层里，所以断言先开浮层再读（§6.11） |
| A30 | 无线事实卡：AP 七项照实，非 AP 不画 | 选中 `10.0.0.4`（AP）：`topology-wifi-card` 出现且七项 = `NMCPS-Lab` / `5G` / `149` / `-52 dBm` / `12` / `34%` / `20 dBm`；选中 `10.0.0.1`（核心路由器）：卡片**不出现** | 现网 27/36 节点带 Wi-Fi 字段（§6.11）；七项全空的节点画一排「—」等于宣称「这台 AP 的 SSID 取不到」，因此整块不画 |
| A31 | 告警角标只挂 join 得上的节点，计数来自 firing 事件 | 假上游回 5 条 firing + 3 条干扰行（空 `target_id` / 图外的 `10.9.9.9` / 已 `resolved` 的 `10.0.0.2`）：角标只出现 **2** 个（`10.0.0.1` = 4、`10.0.0.4` = 1），页头徽标写「5 条告警 · 2 台设备」；干扰行一条都不落角标 | 干扰行钉住「不许靠客户端猜」：`status=firing` 由上游过滤，`target_id` 为空 / 图外的一律无角标可挂（§6.12 口径 ①） |
| A31 | 详情栏列该节点告警原文（严重度降序，前 3 条 + 「另有 N 条」） | 选中 `10.0.0.1`：`topology-alarm-card` 出现，`topology-alarm-event` **恰 3 条**且严重度降序（critical → warning → warning），徽标「严重」，页面上出现「另有 1 条未列出」；属于别的节点 / 图外 / 已恢复的事件**一条都不上屏** | 角标与卡片读同一份 `alarmIndex`，排序只有一处；余下的条数写清楚而不是静默截断（§6.12 口径 ③） |
| A32 | 告警通道失败只摘叠加层，且不冒充「无告警」 | `__control/alarm-error` 后刷新：画布照常（节点数不变）、角标 **0** 个、页头「告警设备」读数 = `—`、详情栏出现「告警通道不可用：告警库连接超时（alarm-db: connection timed out）」逐字，页面**不出现**「该节点没有进行中的告警」 | 「读失败」不是「没有」：`0` 或空态都是结论，缺省只能写「—」+ 上游原话（§八） |
| A33 | 只看某个分组：画布只留该组节点与组内链路，页头标明范围并可一键回到全部 | 点 `combo-edge` 的「只看该组」：节点 6 → 3、连线 6 → 2，页头出 `topology-focus-badge`「只看 边缘区」与 `topology-focus-clear`，`data-focused` 落在该组按钮上；点「看全部区域」复原 6 / 6、徽标消失 | 聚焦只改视图输入（`focusComboId`），与折叠互斥、清空位移层（§6.12） |
| A34 | 链路动作三个按钮齐备，仿真未配置时整组置灰并写明原因 | 未设 `NUXT_SIMULATOR_BASE_URL`：链路动作按钮 = `down` / `up` / `toggle` 三个、全部 `disabled`、提示「仿真控制未启用」、文案为「断开链路」/「恢复链路」/「翻转链路状态」 | 与 A6 同一口径：能力位缺失时按钮可见但不可点，页面零写请求 |
| A35 | 选中仿真里的链路后链路动作可点，写明端点 | 带 `NUXT_SIMULATOR_BASE_URL` + `allowWrite=true` 的实例上点中一条在仿真里的链路：三个按钮 `disabled=0`，提示写明两端名称 | 禁用原因按「通道 → 写开关 → 选中 → 是否在仿真里」只说缺的那一层（§6.12） |
| A35 | 链路动作二次确认写明**仿真链路 id** 而不是图上 id | 点「断开链路」：`UModal` 正文含两端名称 + 「仿真链路 id `l1`」+ 动作原文 + 「不可撤销 / BFF 不保留副本 / 不会自动回滚」 | 图上链路 id 由管理 IP 拼成，仿真平台不认识；确认框里写错 id 等于让人确认一件不会发生的事 |
| A35 | 确认后写请求打到仿真平台的链路端点（id 用仿真 id） | 确认后假仿真平台侧收到 **恰好 1 次** `POST /api/network/links/l1/down`（路径与方法原样，无 `source→target` 形态） | 用错 id 的请求在今天同样「成功」（404 也只是 toast），因此必须断言落地路径 |
| A35 | 成功后提示「链路已断开」 | 请求成功后出现 toast「链路已断开」，且就地刷新运行态台账（不等 30s 轮询） | 动作改的是运行态，不刷新会让人以为没生效（与节点动作同一条理由） |
| A36 | 角标数字超 99 写 `99+`，而 `data-alarm-count` 仍是真实条数 | `__control/alarm-flood` 换成 103 条挂在 `10.0.0.1` 的极端样本后：角标文本 = `99+`、`data-alarm-count` = **103**、页头徽标 `data-alarm-events` = 103、`data-alarm-nodes` = 1 | 角标是读数不是报表：数字截断不等于把读数也截断，两者必须分开（否则「102 条」和「103 条」显示成同一件事） |
| A37 | 未登记严重度落到最低档 `info`，排序仍在 `warning` 之后 | 同一极端样本里有一条 `severity=catastrophic`（现网实测只有 `critical` / `warning`）：详情栏 `topology-alarm-event` 的 `data-severity` 依次为 `critical,warning,info`（第三条就是它，文案含「板卡温度异常」），徽标写「严重」，余下写「另有 100 条未列出」 | 「看不清」不许升级成「严重」（§6.12 口径 ②）：未登记取值归最低档，且参与同一套排序，不插队到最前 |
| A38 | LLDP 邻接卡两套身份并存、两端接口分名、画布外对端照实列出 | 选中 `10.0.0.1`（仿真 `n1`）：`data-lldp-state=ok`、`data-lldp-count=2`、`data-lldp-on-canvas=1`；第一行 `data-neighbor-id=n2` / `data-on-canvas=true`，文本含台账名 `N2`、MIB 名 `汇聚交换机-1`、`n1-eth0 → n2-eth0` 与「对端在图上的 10.0.0.2」；第二行 `n10` / `false` 且写「对端不在本图上」 | 两套身份谁也不顶替谁（§6.13 口径②）；join 只用 `neighbor_id`（`chassis_id` 恒零）；「不在图上」是可判定的结果，不是猜的 |
| A39 | 上游明确回空数组才写「没有邻居」 | 选中 `10.0.0.2`（仿真 `n2`，上游回 `[]`）：`data-lldp-state=ok`、`data-lldp-count=0`、`topology-lldp-empty` 文案含「空数组」与「没有邻居」，且 `topology-lldp-error` 不存在 | 空数组是真实回答（不是 404、不是失败）：只有拿到 `[]` 才允许下结论（§6.14） |
| A41 | 页头读数改为工具栏右区徽标，内容区不再有卡片行 | 五个 `[data-testid^="topology-stat-"]` 全部落在 `#app-toolbar-right` 内：`节点 6` / `链路 6` / `组合 3` / `仿真中节点 —` / `告警设备 5`；内容区 `[data-testid="spark-stat"]` 数 = 0；仿真未配置时「仿真中节点」写「—」（不是 0），告警通道失败时「告警设备」写「—」（A32 同口径） | 位置变了、口径没变：徽标文案 = 「标签 + 读数」，读数取自同一份数据（§七） |
| A42 | 层级树 = 塔型：父层压在子女群中线、层内按重心排序（交叉 0）、间距 ≥ 80、外圈按层级取色 | 6 台默认样本（切到层级树）：4 行 `cy` = 165 / 275 / 385 / 495（行距 110）；`data-node-role` 依次 `core,distro,access,terminal`；半径 17 / 16 / 14 / 12（严格递减）；同层相邻 `cx` 差 ≥ 79.5（`nodesep 80`）；核心 `x` = 两台汇聚的中点 = 接入 `x` = 两台终端的中点（±1px，即「父压子女群中线」）；相邻层连线交叉数 = 0；每个节点都有 `topology-node-dot`（状态圆点，半径 > 0） | 旧实现的判据是「分层只按 tier 分行」（A27），钉不住「同层怎么排」——现网 21 处交叉、核心与子女无对齐仍会通过。0.17.15 收掉 `layered` 后这条断言改在层级树下量：塔型的两步（重心排序 + 父压子女中线）现在是层级树的唯一实现（§6.8） |
| A43 | 层序归约：名称判据选举根节点（组网等价时上提到首行）、叶子下移到末层并归位终端层 | `__control/topology-mesh`（顶层三台两两互联 + 一台无下级接入 + 13 台终端，切到层级树）：节点 20、**5 行**且行距恒为 110（层序连续、无空行留缝）；`data-node-role="root"` 恰 **1** 个且名称「网控中心」、在**第 0 行**且 `data-node-tier="0"`（根是第 0 档，不是「借了核心那一档」）；被留在第 1 行的核心 `data-node-role=core` / `data-node-tier="1"`（换了行不等于换了设备类别）；「接入交换机-1」（`10.0.1.6`，挂着 13 台终端）在第 3 行、「接入交换机-2」在**第 4 行（末行）**且 `data-node-role=terminal`（无下级 ⇒ 末端，§6.15.2 要求 3）；末行共 **14** 台，其 `x` 均值 = 画布中心（`viewBox` 宽度的一半 ±1px）。行号一律由「排序后的 `y` 集合」推出，不写死绝对坐标 | `tier` 分带回答不了「同档谁在上」（核心全互联时边关系等价），只能按命名约定选举；下移的接入若仍按登记 `tier` 取蓝，等于在图上宣称「它下面还有一层」 |
| A44 | 名称标签按奇偶错行、**永不截断**（10px）+「显示名称」开关 | 同一满行样本（层级树末行 14 台，同层间距收窄到 `TIER_TREE_MIN_NODE_GAP = 74`）：20 个 `topology-node-label`；末行（按节点 `cy` 最大值取，不写死 y）`data-label-shift` 同时出现 `0` 与 `1`（奇偶错行）；**任何**标签文本里都不含省略号 `…`（0 个），末行文案逐字含「接入交换机-2」/「无线终端设备-01」/「无线终端设备-13」；字号 `getComputedStyle().fontSize` = **10px**（与 `LABEL_FONT_SIZE` 同值）；点 `topology-labels-toggle` 后标签数 **0**、再点恢复 **20** | 标签比圆心宽：`nodesep=80` 只保证圆不重叠。0.17.16 起「错行 + 截断」的第二级取消（用户裁决：半截名字对台账会认错设备），只剩「错行」，并把字号收到 10px 换取余量；断言因此从 `data-label-truncated === false` 改成「文本里没有省略号 + 全名逐字相等 + 字号 10px」——属性消失后，旧断言会静默变成永远真。关掉名称只改渲染（布局 / 位移不动），两种需求（读名字 / 看层级）用同一张画布满足（§七） |
| A45 | 径向扇与层级树读**同一份**层序归约（圆心 / 首行 = 选举出的根，叶子与终端同环 / 同排） | 同一份 `topology-mesh` 样本：切到径向扇 → 5 个环半径（0 / 144 / 289 / 432 / 576，6px 容差归并）、圆心是被选举的根且「网控中心」恰 1 个 `root`、核心 / 汇聚 / 接入 / 终端分别落在第 1 / 2 / 3 / 4 环、下移的「接入交换机-2」与终端**同在第 4 环**且 `data-node-role=terminal`；切到层级树 → 5 条水平线、根独占首行、核心第二行、接入第 3 行、下移叶子与终端同排末行；切回层级树后读数与 A43 一致（布局切换不攒状态） | 层序归约回答的是「谁在谁上面」（图的语义），只接在塔型几何里会让另一档把根摊回第一圈、把无下级接入爬回中间环 —— 同一份数据两套层级，「换布局看」变成「换事实看」（§6.8） |
| A46 | 收起 / 展开下级（G6 v5 `collapse-expand` 实际案例的等价实现） | 同一份 `topology-mesh` 样本（层级树）：可收起角标 `topology-node-collapse` **恰 6 个**（只有真有下级的节点才有：`10.0.1.1`~`10.0.1.6`），末行 13 台终端与「接入交换机-2」没有；双击「接入交换机-1」后节点 20 → **7**、挂在该节点上的 13 条链路一起消失（画布上没有任何一条链路的端点是隐藏节点），该节点仍在图上且 `data-collapsed=true`、角标写 `+13`，左上角出现「已收起 13 台」+「全部展开」；再双击复原 20 台且坐标与收起前**逐点相等**；最后双击根「网控中心」收起整棵子树，只剩顶层 4 台 | 收起的语义是「元素自己留着、子树与挂边摘掉」（§6.15），四件事缺一条都不算过：角标只长在有下级的节点上 / 挂边不留悬空 / 读数与遮住的台数一致 / 展开是幂等的 |
| A47 | 连线一律**低饱和**中性灰（同一档灰、不等于任何层色），关联强调只加**选中设备层色**外延环（本体颜色 / 粗细全不动），线宽读带宽、线型读介质与状态 | 在层级树下点节点 `10.0.1.4`（汇聚交换机-1）：所有 `topology-link` 的 `stroke` 解析结果**相同**、且等于 `--topology-link`（与五档层色 `--topology-tier-boundary` / `-core` / `-distro` / `-access` / `-terminal` 全不相等、也不等于 `--ui-primary`），并**比 `--ui-text-muted` 同亮度、色度只剩 35%**（±0.06）；`data-link-emphasized=true` 的链路恰 **4 条**（`1→4`、`2→4`、`4→6`、`4→7`）且 `stroke-width` **仍是 1.5px**（不因强调变粗）、`stroke` 仍是那支灰，另出 4 圈 `topology-link-halo`（`data-link-halo-emphasis=incident`、7.5px = 1.5 + 6、`stroke-opacity=0.3`），其 `data-link-halo-tint` 全等于选中节点的 `data-node-role`（`distro`）、`stroke` 等于该节点的层色描边且**不等于** `--topology-link`（§6.15.3）；`data-node-emphasized=true` 的节点恰 **4 个**（一跳邻居）且本体 `stroke-width=2`、层色不变、外圈 2px / 0.22；选中节点本体 `stroke-width=3`（比邻居粗一档）且是层色，同色外环 `r + 2` / 4px / 0.5 / `data-halo-emphasis=selected`，画布上一共 **5** 圈节点外延环（选中 1 + 邻居 4）；取消选中后强调链路数、节点外环数、链路外延环数**全为 0**，本体回到 2px。默认 6 节点样本上：`status=down` 的两条带 `stroke-dasharray=6 4`、无线的两条带 `2 3`（其中 `4→6` 两者兼具 ⇒ 粗虚线优先），`up` 的有线链路不带虚线；唯一给了 `1 Gbps` 的 `10.0.0.1→10.0.0.2` 是**唯一一条 2.5px**，其余 5 条 1.5px | 灰色是「层级是画面里唯一彩色」的前提（§6.15 要求 1），去饱和是三次裁决第 1 条；「强调只加外延、本体读数不动」是第 2 条（节点本体 3px 是唯一例外，节点上没有第二套粗细语义，§6.15.5）—— 只断言「颜色变了 / 变粗了」都不够，必须断言「灰是同一档、且真的更淡」「被强调的链路本体宽度没变、多出来的是环」「带宽四档仍能读」；外延环**染色**（而不是继续借灰）把「它亮着是因为连着这台」说清楚（§6.15.3） |
| A48 | 控件排搬进工具栏左区与布局下拉同排、排尾「显示名称→恢复默认配置→更新」、两枚复位下线、图标非空、画布透明，图例落在右下角、详情栏可跳指标页 | ① `topology-controls` 与 `topology-layout-switcher` **都在** `#app-toolbar-left` 内（`document.querySelector("#app-toolbar-left […]")` 命中，归属不靠类名），两者竖直中心差 ≤ 12px（同一排），`topology-controls` **不压在画布上**（不与画布矩形相交），其子元素里同时有 `topology-labels-toggle` / `topology-reset-view` / `topology-zoom-in` / `topology-zoom` / **`topology-refresh`**；`topology-rotate` 在 `radial` 下也在**同一排**（竖直中心差 ≤ 12px）；② 左区末三个 `[data-testid]` 恰为 `topology-labels-toggle` → `topology-reset-view` → `topology-refresh`（两档布局都量一遍），`topology-refresh` 的文本是「更新」，`topology-rotate-reset` / `topology-zoom-reset` **一个都不存在**；③ 图标真画出来了 —— 两枚旋转按钮的 `<svg>` 内容非空且彼此不同，布局按钮的 `<svg>` 非空且切到径向扇后与层级树那版**不同**，`topology-labels-toggle` 的 `<svg>` 非空；④ 画布 `<svg>` 上两层容器的 `backgroundColor` 都是 `rgba(0, 0, 0, 0)`（画布透明）；⑤ 画布右下角有 `topology-legend`（`right` / `bottom` 与画布边界之差 ≤ 12px），详情栏里**不再有** `topology-legend-roles`（只此一份），图例的角色项文案 `root` 为「边界层」且 `data-role-color` 与画布外圈一致；⑥ 选中节点后 `topology-node-metrics` 的 `data-mgmt-ip` = 该节点 id，点它跳到 `/topology/device-metrics` 且台账选中项对应该设备；点一条链路后 `topology-link-metrics` 跳到 `/topology/link-metrics` 并选中那条链路 | 位置 / 唯一性 / 跳转真落地只能靠几何与 URL 断言（§6.15 要求 3 ~ 5）；0.17.15 起第 ①项 从「贴着画布右上 ≤ 12px」改成「在工具栏左区 + 同排 + 不压画布」——旧口径量不出「控件盖住最上层节点」这种坏法。0.17.16 加钉 ②③④：`[data-testid]` 存在不代表按钮上有东西（`carbon:rotate-ccw` 不是合法 Carbon 名时是一串空 `<svg>`），所以图标要量内容、布局图标要量「两档不同」；排尾顺序与「更新」有文字是用户对「最常用的动作放哪儿」的裁决，靠可见文本钉住比靠注释可靠（§6.15.4）。深链能否解析成 `?id` 也在这里钉住 —— 只断言「URL 变了」会漏掉「跳过去是另一台设备」 |
| A49 | 链路可点选中、右栏二选一切换、右下角图例只留层色一行、进页即选中根（无空态、无关闭叉） | ① 图例：`topology-legend` 内 `<p>` 数 **0**、`topology-legend-statuses` **不存在**、`li` 数 === 实际出现的角色数（≥ 3）；② **刚进页**：恰 1 圈 `selected` 节点外延环，它的 `data-node-tier` 就是全图最上一档（= 根，按层号认 —— 顶端带只有一台时 `resolveLayeredRanks()` 不选举 `role=root`），右栏是节点事实（`topology-node-metrics` 在）且没有链路卡、没有空态提示；③ 点节点 `10.0.0.3` → 右栏仍出节点事实；再点画布链路 `10.0.0.1↔10.0.0.2` → `topology-link-card` 出现、节点卡与无线 / 告警 / LLDP 卡**全部消失**、`topology-link-close` **不存在**（再点同一条线即退回设备视图，见 §6.15.6 要求 3），该链路 `data-link-emphasis=selected` 且恰 1 条、`stroke-width` **仍是 2.5px**（只读带宽，不加粗）、本体描边 = `--ui-primary`，选中强调只落在 1 圈同色外延环上（2.5 + 5 = **7.5px / 0.35**），其 `aria-pressed=true`；透明命中区 `topology-link-hit` 恰 6 个（每条线一个）且**全部** `role=button` + `tabindex=0`（键盘可达的前置条件）；④ 再点节点 `10.0.0.6` → 链路卡让位、节点卡回来 | 三条各自独立会坏：图例精简（§6.15.1 要求 4）、链路选中与右栏二选一（要求 3）、命中区够大才点得中 1.5px 的线；只断言「卡片出现」不够，还要断言「另一套事实真的让位」，并顺手把「每条线都是可聚焦控件」钉住（§6.15.2 要求 B 的第一半）。②③ 是「右栏永远有内容」这一条的全部证据：默认项认错（例如退化成入参第一台）时右栏仍非空，所以根必须按层号对齐；「没有关闭叉」不靠 UI 美观，靠「再点同一条线」（A51 的 `Space`）这条路存在 |
| A50 | 深链目标落在第 2 页时自己翻页并选中对应设备 / 链路 | 假上游垫 15 / 20 条填充行把真样本挤到第 2 页（第 2 页 = 3 台设备 / 7 条链路），`?mgmt_ip=10.0.0.2` 进入设备页 → `?id=DEV-CORE-1`、`[data-device-id='DEV-CORE-1']` 在**当前页**且 `aria-selected=true`、详情名 = 核心路由器-1；`?source_ip=10.0.0.2&target_ip=10.0.0.3` 进入链路页 → `?id=DEV-CORE-1:GE0/0/1--DEV-ACC-1:GE1/0/1` 且该行在当前页并选中 | 「跳过去要选中它」是用户点『遥测』的全部诉求（§6.15.1 要求 5）；只断言 URL 带了 IP 会漏掉「什么都没选中」这一半 |
| A51 | 连线可以用键盘选中：`role=button` + `tabindex=0` + 事实化 `aria-label`，`Enter` / `Space` 与鼠标点击同效并回报 `aria-pressed` | 聚焦 `10.0.0.1↔10.0.0.2` 的命中区（`topology-link-hit`）→ `document.activeElement` 就是它、`role=button`、`tabindex=0`、`aria-label` 以「链路」开头且带上该链路的事实（`1 Gbps`）与「回车查看详情」，**这一条线自己**的 `topology-link-halo` 是 `data-link-halo-emphasis=focus`、8.5px（该链路 2.5 + 6）、0.3（焦点优先于「关联」：与默认选中的根直连的线一进图就带 `incident` 环，若让关联压住焦点，Tab 到这几条线上画布毫无变化）；按 `Enter` → `topology-link-card` 出现、节点卡消失、`aria-pressed=true` 的命中区恰 1 个、这条线的外延环升到 `selected` 的 7.5px（2.5 + 5）、本体 `stroke` 是主色且宽度仍是 2.5px（强调不动本体）；再按 `Space` → 卡片消失、`aria-pressed` 全为 `false`、环退回 `focus` 而本体退回状态灰；`blur()` 后这条线的环退回 `incident` 的 8.5px / 0.3、卡片仍不出现 | 缺任何一条都等于「只能用鼠标点」：焦点看不见（透明命中区上什么都没有）、键按不动、或无状态回报。名字必须带事实而不能只写「链路」—— 屏幕阅读器用户靠它分辨「是哪一条」；焦点环故意借 `incident` 一档而不是新色相，与要求 2 同源（§6.15.2 要求 B） |
| A52 | **同档**（`tier` 相同）的上下级：接入收走它同档的胖 AP，两端都有上行的同档邻居互不认下级 | 假上游换 `__control/topology-same-tier` 样本（8 台：核心-1 tier1 / 汇聚-1 tier2 / 接入-1·接入-2 tier3 / 胖AP-10~12 tier3 / 终端 tier4，两台接入都上联汇聚、AP 只连接入、终端挂在 AP-10 下）：① 可收起角标恰 **4 个**（`10.0.3.1` / `10.0.3.2` / `10.0.3.3` / `10.0.3.10`）—— `10.0.3.4`（接入-2，同样上联汇聚）与 `10.0.3.11` / `10.0.3.12`（只连接入的 AP）都**没有**；② 展开态角标一律 `-`；收起 `10.0.3.2` 后它的角标写 `+6`，收起 `10.0.3.3` 后它的角标写 `+4`（`+4` 必须穿过「同档那一跳」把 3 台 AP 与挂在 AP 下的终端一起算上）；③ 双击 `10.0.3.2` → 8 台 → **2 台**（只剩核心-1 与自己）、链路 → **1 条**、无悬空边；④ 再双击复原 8 台且坐标逐点相等，双击 `10.0.3.3` → **4 台**（接入-2 留着，同档不互认下级） | 只按「严格更靠下」判时 ③ 会剩 6 台：接入被摘掉、3 台 AP 与 1 台终端留在画布上，而它们的边全被摘掉 ⇒ 4 个不连任何东西的孤点（2026-11-09 用户反馈「点收起，Wi-Fi胖AP-10~18 没有收起来」）。①/④ 同时钉住反面：同档不得凭空造层级，否则收起一台接入会把另一台也带走 |



> **落地状态（2026-11-09）**：A1 ~ A52 已全部由 `pnpm check:ui` 断言（`scripts/check-ui.mjs` 第 11 段；A4 / A5 依赖假上游的 `__control/topology-empty` 与 `__control/down`，只在自建模式跑），自建模式实测 `219/219` 全绿（0.17.15 起：节点级「停止 / 重启」下线 ⇒ A6 / A9 改成「画布上不得出现 `sim-action`」的否定式断言（A9 由 6 条收成 1 条，`224 → 219`）；「分层」那一档收起 ⇒ A27 / A42 / A43 / A44 改在层级树下量；A41 的读数徽标由 5 枚收成 4 枚（「仿真中」那档删除）；A47 加钉「邻居连线外延环取选中设备的层色」；A48 改钉「控件排在工具栏左区 + 与布局下拉同排 + 不压画布」。0.17.17 起：A24 / A43 改钉「末层 `x` 均值 = 画布中心（读当前 `viewBox` 的一半）」、A43 另钉 `data-node-tier` 的 `0` / `1`、A47 改钉「选中本体 3px + 外环 `r+2` / 4px / 0.5、`incident` 0.3」。0.17.13 起：A43 / A45 改钉「叶子归位终端层」、A47 改钉「低饱和灰 + 只加外延环」、A49 加钉命中区可聚焦、A51 新增「键盘选中链路」；0.17.14 起：A52 新增「同档（`tier` 相同）的上下级」）。设备 / 链路指标页的右侧详情区按 1.0 版式复刻（`UTabs` 多页 + 卡片分区），记录标识与页签不再在栏内自建 header —— 标识进内容页工具栏左区、页签 / 页签数 / 刷新进右区（`NMCPS-ARCH-006` §4.5）：设备页 7 页、链路页 6 页，缺字段的页**不隐藏**，页内给缺口卡（`telemetry-gap`）说明上游没给什么；新增 A10 / A12 钉版式本身（页签数 / 默认页不出图）、A10n / A12g 钉「记录标识在工具栏左区、页签与刷新在右区、右栏内零 header 零页签」、A10o 钉窄屏把 7 页签折叠成 `UDropdownMenu`，A10b / A10c 钉「接口列表两个方向都没选时只给用法说明 + 缺口卡，选定后按 `ifIndex` 出端口表且设备级组排末尾」，A12b ~ A12d 钉端点对比、错误统计、链路质量三页「缺的字段写 `—`、有的字段按 4 位小数、缺口卡列出 2.0 缺的计数」，计数 186 → 193。**0.17.1 纠正一处误判**：`/metric/device` 实测每个设备还回 `sys_*` / `hw` / `neighbors` / `neighbor_summary` / `protocol.{ip,icmp,tcp,udp}` / `lldp.{ports,neighbors}` / `radio.associations[]` / `device_quality` / `quality` / `sim` / `jobs`（2026-11-08 取胖 AP 与 AP-10 两个样本），此前契约只登记 identity / health / traffic，于是协议 / 射频 / LLDP / 数据质量四页被写成「2.0 没有端点」的缺口页 —— 真正缺的只有 OSPF / BGP 邻居协议表与「探针侧 vs 网管侧两条链路对比」（这两条仍写在本版四页底部的缺口卡里）。修法：`MetricDeviceFact` 按实测补全字段、归一内核把这批字段收进 `MetricDeviceRow`、四页换成 `DeviceProtocol` / `DeviceRadio` / `DeviceLldp` / `DeviceQuality` 四个卡片组件，「接口列表」页顶部补上来自 `lldp.ports` 的端口清单（上游有端口清单，缺的是逐端口状态与计数）；假上游三个设备样本同步换成实测形状，`radio=null` / `lldp=null` / `protocol=null` 三种缺省各留一台，A10d ~ A10i 钉「概览出系统信息 / 硬件 / 邻居、协议计数器照实（IP 组整组 null 显 `—`，`487114` 渲染成 `487,114`）、`radio=null` 与 `lldp=null` 只说明上游没给、无线设备出信道与关联表、邻居的本机端口按 `port_num` 反查成端口名」，A10b 另补一条「端口清单行数 = 2」，计数 193 → 201。**0.17.2 按三份实测响应再纠正一处同源误判**：`/metric/link`（47 条）的 `metrics` 逐条都有 `in_errors` / `out_errors` / `in_discards` / `out_discards` / `in_ucast_pkts` / `out_ucast_pkts` / `in_nucast_pkts` / `out_nucast_pkts` / `in_unknown_protos` / `out_qlen`、探针侧 `probe_peer` / `probe_dir` / `rtt_mdev_us`、四个新鲜度 `*_age_sec` 与 `metric_valid`，此前契约只登记 12 个字段，于是「错误统计」「链路质量」两页把真字段写成「2.0 没有端点」；设备侧同样漏了 `radio.multilinks[]`（9 台终端共 15 条）、`radio.peer_ap_*`（9 台终端各 1 个）、`radio.{role,bss_type,power_mgmt_mode,supported_rates_*}`、`hw.entities[]`（9 台交换机各 1 条，带板名 / 型号 / 两个状态）与 `lldp.man_addr` 及邻居的 `man_addr` / `sys_desc`（110 条邻居多数有）。① 契约 — `MetricLinkMetrics` / `MetricLinkEndpoint` 按实测补全（含 `if_mtu` / `if_phys_address` / `if_speed_bps` / `graph_medium`），新增 `MetricRadioMultilink` 与 `MetricHwEntity`；② 归一 — `MetricLinkRow` / `MetricRadioView` / `MetricLldpNeighborView` / `MetricDeviceRow` 收进这批字段；③ 页面 — 错误统计页拆「错误与丢包 + 报文计数」两卡照实出数、链路质量页补探针侧与新鲜度、端点对比补 alias / MTU / MAC / 速率 / 管理状态、射频页补 MLO 多链路表与对端 AP、概览页把 `hw.entities` 画成实体表、LLDP 页补本机与对端管理地址，缺口卡缩到真正缺的三项（CRC / 对齐 / 冲突计数、重传 / 乱序、分端点质量）；④ 端口维度 — 实测 `metric_code=simIfaceInKbps` 的序列标签是 `simIfaceMetricIndex` 而不是 `ifIndex`，`seriesGroupKey()` 因此改成「`ifIndex` 优先、唯一 `*Index` 兜底、多个 `*Index` 不猜」，否则接口列表对仿真指标只能出「设备级」一行；⑤ 断言 — A10j 射频多链路表 + 对端 AP、A10k LLDP 两处管理地址、A10l 硬件实体表、A10m `simIfaceMetricIndex` 出 3 个端口、A12e 报文字段照实（`in_errors=0` / `in_ucast=103`）、A12f 探针侧与新鲜度（`n7` / `8 µs` / `49 s`），计数 201 → 207。0.17.0 把 LLDP 邻接分区落地（§6.14）：详情栏新增「LLDP 邻接」卡（`topology-lldp-card`，`data-lldp-state` / `data-lldp-count` / `data-lldp-on-canvas`），读表收成纯函数 `app/utils/graph/topologyNeighbors.ts`（保持上游顺序、两套身份并列、两端接口分名、`neighbor_id` → `runtime-inventory` → 画布节点 id 判「在不在图上」），并以 `selected.marker.simId` 为唯一触发键取数（带序号丢弃过期响应）；假上游 `n1` 的样本改成两个邻居（`n2` 在画布上、`n10` 画布外）并新增 `__control/lldp-error` / `__control/lldp-ok`，A38 钉「两套身份并存 + 画布外对端照实列出」、A39 钉「上游明确回空数组才写没有邻居」、A40 钉「失败只写上游原话、全页零『这台设备没有邻居』」，计数 183 → 186；同版把 §6.12 的 join 损失量化（现网 77 条 firing 里 43 条在画布外、9 条 `target_id` 为空）。0.16.1 补两条告警读表的兜底断言并修一处契约：A36 钉「角标数字超 99 写 `99+`、`data-alarm-count` 仍是真实条数」（`__control/alarm-flood` 换 103 条挂一台设备的极端样本），A37 钉「未登记严重度落最低档 `info` 且排序不插队」（样本里一条 `severity=catastrophic`，详情栏 `data-severity` 依次 `critical,warning,info`）；同版按 8001 实测重写 LLDP 契约（§6.13：summary 是扫描规模 + 示例端点、邻居项两套身份并存、`chassis_id` 恒零不可当键），假上游两个 LLDP 端点同步换成实测形状 —— 页面分区 0.17.0 已按实测形状落地。0.16.0 把 §6.12 的三条能力落成断言：A31 告警角标只挂 join 得上的两台（假上游回 5 条 firing + 三条干扰行：空 `target_id` / 图外 IP / 已 `resolved`，角标实测 `10.0.0.1`=4、`10.0.0.4`=1，页头徽标「5 条告警 · 2 台设备」），A31-续 详情栏按严重度降序列前 3 条并写「另有 1 条」，A32 告警通道失败只摘叠加层（读数「—」+ 上游原话，页面上零「无告警」字样），A33 只看某个分组（6 / 6 → 3 / 2 且可一键复原），A34 / A35 链路动作（未配置时整组置灰，配置后三个按钮可点、二次确认写明仿真链路 id、写请求落到 `/api/network/links/l1/down`、成功出 toast）。0.15.2 按 §6.11 的取证落成三条只读事实：A28 点链路出事实卡（基础事实 + 双向流量照实，四个利用率维度写「未计算」，`cells` 全量扫描保证一格都不出 `0%`，画布 `<title>` 与卡片同一份读表）、A29 折叠区域分组（画布摘掉该组 3 台与挂在上面的 4 条边，而 `counts` 折叠前后逐字相同、「全部展开」复原 6 / 6）、A30 无线事实卡（AP 七项照实，非 AP 不画）。**假上游默认就回现网的两层形状**（`nestTopologyGraph()`，`control.topologyNested` 初值 true），A21 ~ A26 因此全部跑在两层形状上；A27 再切 `__control/topology-flat` 证明「形状不影响渲染结果」（`flatSame=true`）—— 这是 0.15.1 补的口径：0.15.0 时默认仍是扁平样本，只有 A27 一条发现得了形状缺口，其余用例其实还站在「比现网干净」的样本上。A27 补的是 2026-11-07 现场排查出来的**形状缺口**（§6.10）：现网节点 / 链路是 `{ id, data: { … }, style, combo }` 的两层形状，2.0 的读模型却按扁平字段取值 ⇒ `tier` 全部落空 ⇒ 分层布局把 36 个节点排成一条水平线（实测 `rows = 1`），名称退化成管理 IP、状态全 `unknown`、详情栏全写「—」。修法是把「线格式 → 读模型」的拍平收成纯函数（`flattenTopologyNode()` / `flattenTopologyLink()` / `normalizeTopologyGraph()`），只在 `useTopologyMonitor.loadGraph()` 调用一次；A27 用与现网同形的假上游样本钉住「6 台 4 行、`cy` 落在分带公式上、名称与 CPU 取自 `data`、扁平形状渲染逐点一致」。**这处缺口此前没有任何断言覆盖**，原因是假上游一直回扁平形状（自检样本比真上游「干净」），代价是页面看起来「功能都在、图却是错的」。A26 复刻 1.0 v0.36 的「拖拽位移保持 + 恢复默认配置」（§6.9）：位移是叠在几何之上的**增量层**（`app/utils/graph/topologyNodeOffsets.ts`，不可变写入 + `0.5px` 抖动容差），断言四条同时成立 —— 只有被拖的那一台动、刷新重渲染后不弹回、三合一复位把位移 / 旋转角 / 缩放一起归零且坐标逐点复原、切布局时位移随几何基准清空；位移表的持有者是页面（`useTopologyMonitor()`），画布只做「几何 + 增量」合成，`check:ui` 用真指针（pointerdown → 6 步 pointermove → pointerup）拖拽，而不是直接改状态。A24 / A25 复刻 1.0 顶栏的「2D 布局」下拉与径向扇旋转控件（§6.8）：几何算法从 1.0 的 `topologyRadialLayout` / `topologyTierTreeLayout` 逐行搬入 `app/utils/graph/`，`layoutTopology()` 按 `mode` 分派、三种布局共用同一份裁剪结果；A24 断言三种布局两两不同坐标、切回分层逐点复原、层级树每层均值 = 画布中心、节点不越 `viewBox`，A25 断言旋转控件只在 `radial` 渲染、步进 +5° 改坐标、复位回默认 25° 且坐标复原。面板高度与画布一次**视觉自查**（一次性 playwright 脚本，产物留在 `/tmp/qa-layouts`、不入库）确认：三态下画布无内部滚动，旋转控件浮在画布右上角且不与裁剪角标重叠。A21 ~ A23 复刻 1.0 详情栏的事实层（CPU / 内存进度条 + 接口·邻居·流量 KPI + 邻居列表），三条断言分别钉「已知值照上游」「未知写『—』且不画空进度条」「`-1` 哨兵当未知、真实 `0` 照写、Kbps 归一为 Mbps」——口径见 §6.7，实现见 `app/utils/graph/topologyNodeFacts.ts`。A3 由三条断言锁住：点节点后详情栏出现 `TrendChart` 且编码取自 `/metric/name` 的**首个可绘图名**（假上游故意把 `up` / `scrape_*` 排在清单最前，并把 `sys_name` 标成 `string`）、`/api/metric/datapoint` 请求带该节点 `mgmt_ip` 与 `metric_code`、序列里夹的两个非法点（空串 / `NaN`）被丢弃并计数（不补 0）。A10 ~ A12 覆盖指标页（`device-metrics` / `link-metrics`）：台账左栏行数与 `total` 一致、指标选择器只列目录判为 `numeric` 的条目（`sys_name` 不得出现）、切换指标后请求换 `metric_code`、链路页取该链路 source 端设备的 `mgmt_ip`。0.17.4 又补两条：A10p（名字清单为 `[]` 时候选来自指标目录、选择器仍可用、提示一句、照常出图）与 A10q（目录按**实测字段名** `data_type` 判类型，`string` 指标不进选项）。A7 / A9 的精确面放在「仿真通道已配置」的两个对照面里（另起带 `NUXT_SIMULATOR_BASE_URL` 的 BFF：一个 `allowWrite=false`，断言按管理 IP 对齐的「仿真中」标记真的画出来、降级条消失、写端点 405 且假仿真平台侧零写命中；一个 `NUXT_SIMULATOR_ALLOW_WRITE=true`，断言按钮可点、`UModal` 二次确认后写请求真的落到假仿真平台且路径与方法原样、成功 toast 出现）—— 只测「未配置」等于没测过通道接通。2026-11-06 另做了一次链路页的**视觉 + DOM 双通道**自查（一次性 playwright 脚本，产物留在 `/tmp`、不入库），四态实测：状态 ① 选中 `LNK-0001` 时 `data-series-if-index=101`、`data-series-count=2`，两条跨 job 序列合成一条曲线并提示「已忽略 2 个非法采样点（不补 0）」；状态 ② 切到 `cpu_util_pct` 时该属性为空、图下出现「设备级」标注；状态 ③ 把 `ifIndex=101` 的组从响应里剔掉后出现 `no_interface_series` 空态、SVG `path` 数为 0（不画 0 值线、不顶替 102 端口）；状态 ④ 选中 `LNK-0002` 时只有缺口提示、零 `/api/metric/datapoint` 请求。这次自查也暴露了一处文案自相矛盾（② 态顶部提示仍写「折线 = ifIndex=101 的接口序列」，已改为描述规则）——「面板标了设备级、页面却在断言端口级」这类冲突断言抓不到，只能靠肉眼，因此记在这里。证据本身不新增断言；随后补的 A13（信封失败逐字展示 + 重试，两条断言）把计数推到 `155/155`，也顺手清掉「错误提示旁边还挂着『该时间窗内无采集数据』」这对矛盾。紧接着的 A14 ~ A16 把同一语义补齐到另外两个入口（设备页 / 监控页详情栏），并把 `__control/down` 的 stale 分支也钉住（折线保留、序列数不变、出「指标通道暂时不可用」），计数到 `160/160`。随后的 A17 / A18 把**第三种失败**也钉住 —— 目录失败（`__control/catalog-error` 让 `/metric/definition` 回 HTTP 200 + `code !== 0`）：图表照常出、只多一句「指标目录不可用」、目录原话一个字节不上屏、`metric-trend-error` 不出现；降级的**后果**同样断言到（选择器只剩编码、`sys_name` 这种文本指标混进选项），计数到 `160/160`。设备页随即照同一套方法自查（五态 + 台账失败态，产物同样留在 `/tmp`）：① 正常态 `data-series-count=2` / `data-series-if-index=101` / 速率开关在场；② 切 `cpu_util_pct` 后该属性为空、速率开关消失；③ 信封失败（`__control/metric-error`）逐字给出「指标库查询超时（tsdb: query timeout after 30s）」+ 重试，手上还有旧序列所以折线保留并带 stale 一行；④ `__control/down` 下 `bff_upstream_unreachable` + 折线保留（与 A16 一致）；⑤ 目录失败下图表 `series=2` 照常、选择器只剩 `if_in_octets`（与 A17 / A18 一致）。第六态查出**四处互相打架**：台账掉线时左栏「加载设备台账失败」旁边还挂着「当前租户下没有设备事实」、页脚写「共 0 台设备」，右栏把「没加载出来」讲成「该设备不在当前分页结果内」。修法是让「失败」不再冒充「没有」：空态与错误互斥、计数改「设备数未知（台账加载失败）」、`?id` 提示改「台账加载失败，无法确认这台设备」（规则写进 `NMCPS-ARCH-006` §3.4，§八同步一行），并新增 A19 / A20 把两页的否定判据钉住，计数到 `162/162`。LLDP 邻接分区已于 0.17.0 落地（§6.14 / A38 ~ A40），真正的 `link_id` 级时序仍属 P1（上游暂不支持，`if_index` 级已按 §6.6 落地）—— 告警角标与链路动作于 0.16.0 落地（§6.12 / A31 ~ A35），0.16.1 又按 8001 实测把 LLDP 契约改对（§6.13）。

---

## 十、变更记录

| 日期 | 版本 | 变更 |
| 2026-11-08 | 0.17.10 | **指标页左栏行文案定稿：设备页只留一行次级信息、链路页标题换成两端设备名（A10 / A12）**：① 设备页 — 原先两行（`管理 IP · 设备标识` 与 `CPU x% · 内存 y% · 端口 u/t`），现在一行 `管理 IP · 邻居 N · 端口 u/t`（例 `10.0.0.249 · 邻居 2 · 端口 2/2`），CPU / 内存只在右栏概览；② 链路页 — 标题从「端口 → 端口」改成两端**设备名**（例 `Wi-Fi胖AP-11 → 接入交换机-1`），次级信息改成两端 `接口名:管理 IP`（例 `n20-eth2:10.0.0.245 → n7-eth3:10.0.0.11`），利用率 / 时延撤出列表（右栏概览仍照实测出 `32.5%` / `1.2 ms`）—— 列表只回答「是哪条」，当前值在详情里；端点只有 `device_code` + `interface_name`，名字与 IP 都由 `/metric/device` 反查：新增 `deviceNameIndex()`（`sys_name` 兜 `device_code`）与既有的 `deviceIpIndex()` 共用同一份 200 条台账，不额外发请求，查不到写 `—` 而不是猜一个名字或地址；③ 选中行底色同轮改为 `NMCPS-ARCH-006` §3.6 的 `.list-row-selected`（主色半透明 + 左缘主色竖条，六个 listbox 同一规则）；④ 断言 — A10 补「左栏选中行恰 2 行、次级信息逐字 `10.0.0.2 · 邻居 2 · 端口 22/24`」，A12 补「标题 = `核心路由器-1 → 接入交换机-1`、次级信息 = `GE0/0/1:10.0.0.2 → GE1/0/1:10.0.0.3`」，两条都是改写不新增，`check:ui` 仍 **220** 条。 |

| :--- | :--- | :--- |
| 2026-11-08 | 0.17.9 | **右侧栏只留事实卡：分组清单进画布浮层、趋势折线归指标页，收起子树不再挪人（A3 / A15 / A29 / A33 / A46）**：① 侧栏 — 删除「区域分组」与「节点指标趋势」两张卡。分组清单（组名 / 上游自报的分层计数 / 可见·声明成员数 / 折叠 / 只看该组 / 全部展开）搬进**画布左上角浮层**（`topology-groups-toggle` → `topology-groups`），它回答的是「这张图包括谁」；侧栏从此只回答「选中的这个东西是什么」（§6.11 / §6.15 要求 7）。② 折线归位 — 删 `useNodeTrend.ts` 与 `pages.topology-monitor.trend.*` 九个文案键；监控页不再发 `/api/metric/*`。A3 改为「零指标请求 + 深链按钮带管理 IP + 点它到 `device-metrics` 真出图（`metric_code=if_in_octets`、非法点丢弃计数）」，A15 改为「上游 `code !== 0` 时监控页既不出错误块也不写『该时间窗内无采集数据』」—— 手上没有这份数据，说哪一句都是编（§6.5）。③ 收起子树不再重排 — `layout` 的几何改为按**完整集合**算，收起只从渲染里摘元素（`collapsePlan.nodes` 过滤），留下节点坐标逐点不变、位移层也不再清空；旧实现把子树从布局输入里摘掉后整行重铺，收起一个叶子整张图就挪位（§6.15）。④ 断言 — A29 / A33 先开浮层再读（浮层开着时点画布只关浮层、不穿透，故各补一次 `Escape`），A46 的「展开后坐标逐点相等」从「重排再复原」变成「压根没动」；`check:ui` 仍 **220** 条（三条改写、零新增，`sh scripts/ci-expectations.sh ui` 不变）。 |
| 2026-11-08 | 0.17.8 | **画布六条整体裁决：灰色连线、关联高亮、指标深链、控件收敛、图例落角、收起子树（A46 ~ A48）**：① 连线 — 一律中性灰 `--ui-text-muted`（浅色中灰 / 深色浅灰，两种模式都与背景拉开），`offline` 改用虚线 `6 4`，状态语义改由文字承载（详情栏 / 邻居徽标 / `<title>`）—— 48 条链路画成六种颜色时读者先看到的是彩虹而不是层级。② 高亮 — 节点与链路都可点选；选中节点时**直连链路**改主色 + 2.5px、**一跳邻居**外圈加粗到 3px（层色不变），判定收在纯函数 `app/utils/graph/topologyHighlight.ts`（G6 `click-select` + 关联激活的等价语义）。③ 深链 — 详情栏节点卡 / 链路卡各加一枚按钮跳到设备 / 链路遥测指标页；两个域的记录标识不同（拓扑 id 是管理 IP、设备台账 `?id` 是 `device_code`、链路台账 `?id` 是 `link_id`），因此深链带 `?mgmt_ip=` / `?source_ip=&target_ip=`，目标页用自己已取到的台账解析成 `?id`（`app/utils/metric/metricDeepLink.ts`），命中不了保持默认选中、不静默翻页（§5.2 同规则）。④ 控件 — 径向扇旋转 / 显示名称 / 恢复默认配置 / 缩放收敛到**画布右上一条排**（`topology-controls`），缩放状态仍归 `useGraphInteraction()`，画布改用 `zoomChange` 上报读数 + `defineExpose` 暴露 `zoomIn` / `zoomOut` / `resetViewport`。⑤ 图例 — 从详情栏卡片搬到**画布右下角**（`topology-legend`），i18n `roles.root` 文案「根节点」→「边界层」（en `Boundary`，角色 id 仍是 `root`）。⑥ 收起 / 展开 — 按 G6 v5 `collapse-expand` 的「实际案例」实现：有下级的节点带角标（`-` / `+N`），双击节点或点角标收起整棵子树（元素自己留在图上、下级与挂边摘掉、几何重排、位移层清空、不落盘、上游变了自己失效），方向由 `tier` 定（纯函数 `app/utils/graph/topologyCollapse.ts`）。⑦ 断言 — A46（可收起角标恰 6 个、双击「接入交换机-1」后 20 → 7 台且 13 条挂边一起消失、角标 `+13`、展开后坐标逐点复原、收起根只剩顶层 4 台）、A47（所有链路 stroke 同一档灰且不等于任何层色、关联链路恰 4 条为主色 + 2.5px、一跳邻居恰 4 个外圈 3px）、A48（控件排贴着画布右上且四类控件同排、图例只在画布右下角且文案「边界层」、两枚深链按钮真跳到指标页并选中对应记录），`check:ui` 217 → 220（`sh scripts/ci-expectations.sh ui` 注释同步）。 |
| 2026-11-08 | 0.17.7 | **层序归约对齐三种布局：径向扇 / 层级树按同一份层序渲染（A45）**：用户反馈「径向扇图和层级树图没有按新的分层渲染」。① 根因 — 0.17.6 的层序归约（根节点选举 + 无下级节点下移）只接在塔型几何库里，`radial` / `tree` 仍把原始 `tier` 直接喂给几何库 ⇒ 切到另两种布局时根被摊回第一圈、无下级的接入又爬回中间环：同一份数据两套层级，「换个布局看」变成「换个事实看」。② 修法 — 归约提到布局入口 `layoutTopology()`（`resolveRanks()`），三种布局共用；`radial` / `tree` 的几何库入参 `tier` 在内部只当「第几环 / 第几行」用，因此喂归约后的**带号** `rank + 1`（`bandNodesOf()`），1.0 逐行搬入的几何库内部口径不动；角色也统一走 `roleOfTier()`（选举出的根覆盖成 `root`），按行号取色的 `roleOfRank()` 随之删除 —— 换布局只换坐标，不换角色。径向扇的逐档张角改按**带数**生成（新增 `radialSweepForBands()`：最外带 65°、其余非顶点带 75°），否则 5 带图的最外带会回落到基线 60°、比它里面那带还窄；带数 = 4 时与 `RADIAL_SWEEP_BY_TIER` 逐项相同，故默认 6 节点样本的几何一字不变（A24 / A25 / A27 / A42 原样通过）。③ 断言 — A45：同一份 `topology-mesh` 样本切到径向扇 → 5 个环半径 0 / 144 / 289 / 432 / 576、圆心是被选举的根、核心 / 汇聚 / 接入 / 终端分别在第 1 / 2 / 3 / 4 环、下移的「接入交换机-2」与终端同在第 4 环且角色仍是 `access`；切到层级树 → 5 条水平线 110 / 220 / 330 / 440 / 550、根独占首行、下移接入与终端同排末行；切回塔型读数与 A43 一致。`check:ui` 216 → 217（`sh scripts/ci-expectations.sh ui` 注释同步）。 |
| 2026-11-08 | 0.17.6 | **分层补两条层序归约规则（根节点选举 + 无下级节点下移）与名称标签避让（A43 / A44）**：① 层序 — `tier` 只能回答「这台设备属于哪一档」，回答不了「同一档里谁在谁上面」：现网三台核心是全互联的网状，边关系**等价**，dagre 只能把它们排在同一行。因此分带之后再走两条**只改「谁落在第几行」**的规则（纯函数 `resolveLayeredRanks()`）：**(a) 根节点选举** —— 首层多于一台时按**设备名称**的命名约定挑一台当根（`LAYERED_ROOT_KEYWORDS`：网控 / 控制中心 / 管理中心 / 管理平台 / 管理服务器 / 中心 / manager / controller / management / mgmt / center / centre / nms；得分 = 命中的最长关键词长度，同分先比度数再比 id），单独上提到第 1 行；没有一台命中则不选举、保留平顶（在等价图上按 id 或度数猜「谁是上级」等于掷骰子）。**(b) 无下级节点下移** —— 没有「严格更靠下的邻居」的节点一律下移到末层（首层 / 末层不参与），于是第 3 层里「Wi-Fi胖AP10」~「Wi-Fi胖AP18」落到第 4 层；下移会让上一层也变叶子，因此迭代到不动点并收掉空层（层序必须连续）。角色**不跟着行号走**（`roleOfTier()` 按 tier 取、选举出的根覆盖成 `root`）：下移的接入仍是蓝色接入，按行号取色会把它染成终端绿 = 改了设备类别。② 标签 — dagre 只保证圆心不重叠，名称比圆宽：新增纯函数 `app/utils/graph/topologyLabelLayout.ts` 做三级避让（放得下 ⇒ 单行；错行放得下 ⇒ 整行奇偶错行，一个字不丢；仍放不下 ⇒ 错行 + `…`，全名留在 `<title>` / `aria-label`），画布新增左下角「显示名称」开关（`topology-labels-toggle`，只影响渲染、不动布局与位移层）。③ 角色 — `TopologyNodeRole` 增 `root`（中性深色描边 + 半径 19，不占第五个彩色），图例改用 `presentRoles()` 只列实际出现的角色，i18n 增 `roles.root` 与 `labels.toggle` / `labels.toggleHint`。④ 断言 — 假上游新增 `__control/topology-mesh`（顶层三台两两互联 + 一台无下级接入 + 13 台终端的满行样本）与 `__control/topology-default`（复位），A43 钉「5 行 `cy` = 70/220/370/520/670、`root` 恰 1 个且是「网控中心」、第 2 行核心仍是 `core`、无下级接入落末行仍是 `access`、末行 14 台」，A44 钉「奇偶错行且零截断、关掉名称后 0 标签、再开恢复 20」，`check:ui` 214 → 216（`sh scripts/ci-expectations.sh ui` 同步）。默认 6 节点样本不受影响（首层只有一台 ⇒ 不选举；无叶子 ⇒ 不下移），A27 / A42 的落点与角色序列原样通过。 |
| 2026-11-08 | 0.17.5 | **拓扑页三处版式对齐 1.0：页头读数进工具栏、去掉「仿真控制未启用」告警条、分层改为真塔型（A41 / A42）**：① 读数 — 节点 / 链路 / 组合 / 仿真中 / 告警五张 `SparkStat` 卡片原先独占内容区第一行（100px 高，只装 5 个数字，把画布整个往下推），改为五个 `UBadge` 注入 `#app-toolbar-right`（`topology-stats`，一处 `statBadges` 计算属性给数据）；口径不变（缺数据写「—」不写 0），A41 钉「徽标在右区 / 内容区零卡片 / 文案 = 标签 + 读数」。② 告警条 — `simState === "disabled"` 的常驻 `UAlert`（「仿真控制未启用」）删除：「没配仿真平台」是**部署形态**而不是故障，仿真按钮已整体置灰、原因在 tooltip 里（`simControlHint`），1.0 顶栏也没有这条；`unreachable`（本可工作但现在坏了、可重试）保留。i18n 同步删 `degraded.disabledTitle` / `disabledBody` 两个键。③ 布局 — 「分层」旧实现只做到 `tier` 分带，层内按 `id`（= 管理 IP）字典序**铺满整幅画布宽**，于是汇聚 → 接入大面积交叉（现网实测 21 处）、3 台核心被摊到 80 / 500 / 920 与子女毫无对齐、21 台接入挤在 840px 内标签压叠。新增纯函数 `app/utils/graph/topologyLayeredLayout.ts`，把 1.0 G6 `dagre` 的两步核心算法写全：**层内排序**按相邻层重心上下交替扫描、取交叉数最少的一版；**层内坐标**先取相邻层邻居均值、再按最小间距压实、最后整行等量平移使行中心落回期望中心（`ranksep 150` / `nodesep 80` 与 1.0 同值 ⇒ 四层图 `cy` 仍是 70 / 220 / 370 / 520，A27 不变）。压实里的「空洞均匀化」是稳定性关键：不加它，父层摊开后的坐标会作为下一轮期望喂回子层、逐轮把整行拉宽（实测每两轮 +330px 不收敛）。画布宽度改由最宽层决定（现网 1740，`viewBox` 跟着长大 = 1.0 的 `fitView()`），不再把 21 台挤进 1000 宽。④ 节点视觉复刻 1.0（`app/utils/graph/topologyRoleStyle.ts`）：外圈**恒为层色**（核心红 / 汇聚橙 / 接入蓝 / 终端绿）、填充极淡中性、半径随层级递减（17 / 16 / 14 / 12），**状态语义只由中心圆点承载**（半径 = 节点半径 × 0.38；1.0 是 0.2，2.0 因 `viewBox` 缩放放大到 0.38 才看得见）—— 旧实现把状态色填满整个圆，36 台设备全是绿的，层级完全看不出来。角色按**所在层序**取（不是上游 `type`），`PositionedTopologyNode` 增 `rank` / `role` 两字段，画布暴露 `data-node-role` / `data-node-status`；图例拆「层级（外圈）」+「状态（圆点）」两组，i18n 增 `roles.*` / `legend.rolesTitle` / `legend.statusTitle`。⑤ 断言 — A41、A42（`check:ui` 212 → 214，`sh scripts/ci-expectations.sh ui` 同步），A6 由「必须有降级条」翻转为「不再有降级条、按钮仍置灰」。 |
| 2026-11-08 | 0.17.4 | **指标选择器：名字清单为空不再等于「选不了」，目录字段名按实测修正（A10p / A10q）**：用户报「设备遥测页选一台路由器 / 二三层交换机 / AP 后，图表页签的『选择指标』选不了」。直连上游（`192.168.1.55:8888`）逐台取证，三条同源根因：① 36 台设备里 24 台（18 台胖 AP + 3 台接入交换机 + 3 台汇聚交换机）的 `/metric/name` 回 `metrics: []`，而同一台 AP 的 `ifInOctets` 仍有 4 条序列、`10.0.0.250` 的 `hwEntityCpuUsage` 仍有 2 条 —— 空清单被当成「没有可画的指标」，选择器直接禁用；② 目录条目的类型字段名是 `data_type`（不是 `metric_type`）、展示字段是 `metric_name` / `metric_name_en`（不是 `cn_name` / `en_name`），解析只认后者 ⇒ 整份目录「没有类型证据」⇒ 76 条 `string` 指标混进路由器选项、画成恒 1 直线；③ 目录 `total=463`，前端只取 `page_size=200` 首页 ⇒ 余下 263 条落 `name-only` 当 `numeric` 放行。改法：候选集改成**并集**（`NMCPS-CONTRACT-002` §8.6：目录 `numeric` 条目 ∪ 名字清单，清单命中项排在前），目录按 `total` 翻页取全量，解析认 `data_type` / `metric_name` / `metric_name_en` 并丢弃 `enabled === false` 的条目；名字清单为空时页面加一句「上游未返回该设备的指标名清单（候选来自指标目录）」，用户选一项再看窗口内有没有采样点（无点走 `no_datapoints` 空态，不画 0 值直线）。断言：`check:ui` 新增 A10p（`__control/names-empty` 让 `/metric/name` 回空数组：选择器可用 + 提示在 + 图照常出 + 选项含只在目录里出现的指标）与 A10q（假上游目录新增实测形状的 `hw_board_name`（`data_type=string`）：它不得出现在选项里），计数 210 → 212（`sh scripts/ci-expectations.sh ui` 同步）。 §6.5 / §6.6 的取数口径同步改写。 |
| 2026-10-25 | 0.1.0 | 首版：固化拓扑监控领域基准（定位、功能范围、数据实体、边界、演进）。 |
| 2026-11-05 | 0.2.0 | 按 `NMCPS-ADR-0019` 落实码前义务 1：补三页的 2.0 落点、数据源（8888 七个端点 + 8001 只读/写白名单 + 本地引擎空集）、图形形态（`TopologyCanvas` / `TrendChart` / `SparkStat`）、八种空态与降级态、8 条验收断言；`dependsOn` 增加 `NMCPS-ARCH-006`（`NMCPS-ADR-0019` 只作正文引用，Tier 2 normative 不 `dependsOn` Tier 5 记录层）。 |
| 2026-11-05 | 0.3.0 | **`monitor` 页落码**（`layers/topology/app/pages/topology/monitor.vue`）：结构来自 `GET /api/topology/graph`，仿真运行态来自 8001 `runtime-inventory` / `stats`（按管理 IP 对齐后叠加虚线外环标记）；取数内核 `useTopologyMonitor()` 30s 轮询 + 页面不可见暂停，主上游失败走页面级错误、仿真通道失败只降级仿真区块。图形落 `app/components/Graph/{TopologyCanvas,SparkStat}.vue` + `app/utils/graph/{topologyNormalize,topologyLayout,topologyStatusStyle,simulatorOverlay}.ts`（纯函数）+ `app/composables/useGraphInteraction.ts`（拖拽 / 缩放，无 rAF）。§九 补落地状态：A1/A2/A4~A8 已进 `check:ui`，A3 与 LLDP / 台账 / 告警角标留 P1。 |
| 2026-11-06 | 0.4.0 | **写入口 P1-B 落码**：`monitor` 工具栏右区两个节点动作（重启 / 停止）接 `POST /api/network/nodes/{node_id}/{restart,stop}`，目标取仿真侧 `marker.simId`（不是 8888 的节点 id）；交互为 `UModal` 二次确认 + 成功 `useToast` + 立即刷新。写权限不再靠猜：新增 BFF 能力探针 `GET /api/sim/channel`（只回 `configured` / `writeEnabled` / `timeoutMs` / `readinessPath`，**不回 `baseUrl`**），`writeEnabled=false` 时按钮 `disabled` 且页面零写请求。§6.2 补写入口范围表（链路动作 / 运行态增删留 P1，**不设按钮**——不留点了没反应的死按钮）、§八 `allowWrite=false` 的判据改为能力位、§九 新增 **A9**（二次确认 + 上游实收 + 结构化审计日志 + 能力探针不泄露地址），落地状态更新为 `139/139`。 |
| 2026-11-06 | 0.5.0 | **A3 落码，A1~A9 全绿**：`monitor` 详情栏接上节点趋势 —— 选中节点 → `GET /api/metric/name`（`mgmt_ip`）挑编码（只排除 `up` / `scrape_*` 采集器命名空间，不按名字猜类型）→ `GET /api/metric/datapoint`（`mode=range`、近 1 小时、`step=60`、`rate` 不传）→ `TrendChart` 自绘折线。取数内核 `layers/topology/app/composables/useNodeTrend.ts`（含切节点清空、同节点失败保留旧序列并标 stale 的竞态处理），解包 / 升序 / 去重 / 像素降采样落在 `app/utils/chart/metricSeries.ts` 纯函数（空串显式判掉：`Number("")` 是 0，会把「没采到」画成 0 值线）；§6.5 新增取数口径与登记缺口（类型三分类需目录 join，属指标页 P1）；§七 `TrendChart` 行补本页用法；§九 A3 判据补「非法点丢弃不补 0」，落地状态改为 `142/142`（第 11 段新增三条断言）。 |
| 2026-11-06 | 0.6.0 | **指标页落码，A10~A12 随之上线**：`/metric/datapoint` 的两步取数抽成 `layers/topology/app/composables/useMetricSeries.ts`（目录 join + 名字清单 + 序列，通用内核），`useNodeTrend.ts` 收成不传编码的薄包装；类型三分类落到 `app/utils/metric/metricCatalog.ts`（判定顺序见 `NMCPS-CONTRACT-002` §八），`device-metrics` / `link-metrics` 从占位页变成真实页面（`Layout/Split.vue` 台账 + `useRecordSelection` + `USelect` 指标选择器 + `counter` 才有速率开关）。新增 §6.6 取数口径，并登记链路级时序缺口：`/metric/datapoint` 只认 `mgmt_ip`，链路页画的是 source 端设备的同名指标，链路当前值取自 `/metric/link` 的 `metrics`。`check:ui` 142 → 151 条（第 11 段 A10 ~ A12 共九条断言：台账行数 / 默认选中 / 目录只取一次 / 选择器只列 numeric / 换指标改写 `metric_code` / `gauge` 无速率开关 / 链路当前值 / source 端 IP 反查 / 缺 IP 不发请求）。 |
| 2026-11-06 | 0.7.0 | **链路折线改成「source 端该端口」并清掉「`results` 恒一条」的错误假设**：直连上游实测 `/metric/datapoint` 的 `range` 返回带 `ifIndex` 标签的多条序列（同设备可能被 2 个 job 重复采集），据此 §6.6 把链路页的口径从「source 设备同名指标」改为「`metric.ifIndex === identity.source.if_index` 的接口序列」（跨 job 逐时间戳取均值，规则见 `NMCPS-CONTRACT-002` §6.9）；三种情况如实标注：`if_index` 缺失不出折线、指标无 `ifIndex` 标签时标为设备级、零匹配走 `no_interface_series` 空态不回落。A12 的判据同步收紧，`check:ui` 151 → 153 条（新增「折线命中 source 端 `ifIndex`」与「设备级指标如实标注」两条断言，假上游改为双 `ifIndex` × 双 `job`）。 |
| 2026-11-06 | 0.7.1 | **链路页视觉自查留痕，并修掉一处提示与面板互相矛盾的文案**：一次性 playwright 脚本（不入库）逐态截图 + DOM 抓取，四态实测写进 §九「落地状态」（端口组键 `101`、2 条跨 job 序列合成 1 条、设备级标注、零匹配空态 `path=0`、缺 IP 零请求）；② 态发现页面顶部仍断言「折线 = ifIndex=101 的接口序列」而面板已标「设备级」，遂把 `portBody`（cn / en）改成描述规则 —— 端口级指标取该端口序列，所选指标本身是设备级时图下另行标注。判据与断言数不变。 |

| 2026-11-06 | 0.8.0 | **指标取数失败不再与「无数据」混为一谈（A13）**：网关回 HTTP 200 + `code !== 0` 时，`TrendPanel` 只出 `UAlert`（标题 i18n、描述是上游 `message` 原文）+ 重试，**不再**在下面同时渲染「该时间窗内无采集数据」的空图 —— 两句话并排会让用户以为「这段时间没采到」而不是「取数没成功」；有旧序列时仍保留折线并标 stale（`NMCPS-CONTRACT-002` §6.7）。§八 新增「指标取数失败」一行，§九 新增 A13；假上游加 `__control/metric-error` / `__control/metric-ok`（只让 `/metric/datapoint` 回信封失败，目录与名字清单照常），`check:ui` 153 → 155 条（逐字比对原话 + 恢复后重试真拿到 `ifIndex=101` 的序列）。 |
| 2026-11-06 | 0.9.0 | **失败语义补齐到三个入口，并把 stale 分支也钉住（A14 ~ A16）**：A13 只锁了链路详情页，而 `MetricTrendPanel` 还挂在 `device-metrics` 设备详情、`useNodeTrend` 薄封装还挂在 `monitor` 节点详情栏 —— 两处在同一场景下仍会把「该时间窗内无采集数据」和「指标取数失败」并排画出来（把「取不到」说成「没采到」）。现在纯失败态整个图表容器不渲染（`!error || points.length > 0`），只有同设备重取失败才留图 + 一行 stale。新增 A14（设备页一致）、A15（监控页一致）、A16（`__control/down` 下的 stale：折线保留、序列数不变、出现 「指标通道暂时不可用」），`check:ui` 155 → 158 条，`NMCPS-CONTRACT-002` §6.7 补「三个入口一视同仁 + 纯失败态不画图」与断言 S7。 |
| 2026-11-06 | 0.10.0 | **目录失败成为第三种被断言住的失败（A17 ~ A18）**：§8.4 早就写着「目录失败不阻塞出图、不冒充取数失败」，但 `check:ui` 没有一条断言碰它 —— 现在假上游新增 `__control/catalog-error`（`/metric/definition` 回 HTTP 200 + `code !== 0`），A17 断言图表照常出（`data-series-count=2`）、`metric-catalog-degraded` 出现且含「只按名字判断类型」、`metric-trend-error` 不出现、目录原话零上屏；A18 断言降级的**后果**：选择器只剩编码（`en_name` 随目录消失）、`sys_name` 这种文本指标真的混进选项。三条失败路径（信封失败 / 网络错误留 stale / 目录降级）至此各有断言，计数 `160/160`。 |
| 2026-11-06 | 0.11.0 | **台账失败不再冒充空态（A19 ~ A20）**：设备页的视觉自查（五态 + 台账失败态）拍到掉线时四处互相打架 —— 左栏「加载设备台账失败」旁边挂着「当前租户下没有设备事实」、页脚「共 0 台设备」，右栏把「没加载出来」讲成「该设备不在当前分页结果内」。「失败」被讲成了「一台都没有」。修法：空态与错误互斥（`rows.length === 0 && !error`）、页脚计数改「设备数 / 链路数未知（台账加载失败）」、`?id` 提示改「台账加载失败，无法确认这台设备 / 链路」，分页在有错误时禁用；规则同时写进 `NMCPS-ARCH-006` §3.4（错误与空态互斥），§八新增一行，§九新增 A19（`device-metrics`）/ A20（`link-metrics`）把三条否定判据钉住 —— 「不出现空态文案」「不写共 0 台」「不断言不在当前分页」，`check:ui` 160 → 162。 |
| 2026-11-06 | 0.12.0 | **节点详情事实层照 1.0 复刻（A21 ~ A23）**：1.0 的 `monitor` 详情栏除了名称 / 状态，还画 CPU / 内存进度条、接口数·邻居数·流量三张 KPI 卡与邻居列表；2.0 的节点契约里一个字段都没有，详情栏只能显示 IP / 层级 / 类别。补法：节点线格式按 1.0 的 `TopologyNodeData` 补上 `cpu` / `memory` / `interfaces` / `traffic` / `traffic_in|out` / `trafficTotalKbps` / `uptime`（`shared/types/topology.ts`），读表收成纯函数 `app/utils/graph/topologyNodeFacts.ts`（未知 = `null`，`-1` 与非数值同样按未知，Kbps 归一 Mbps），邻居数改由 `topologyNeighborsOf()` 从当前画布的链路推导（与 1.0 同源，平行链路各算一条）；详情栏新增进度条 + 三张 KPI 卡 + 可点击的邻居列表。§6.7 新增字段口径表，§八新增一行「事实字段缺失」；`check:ui` 新增 A21（已知值照上游）/ A22（未知写「—」且不画空进度条）/ A23（`-1` 哨兵当未知、真实 `0` 照写、Kbps 归一），计数 162 → 165。
| 2026-11-06 | 0.13.0 | **画布布局切换与径向扇旋转（A24 ~ A25）**：1.0 的 `monitor` 顶栏有「2D 布局」下拉（六项）与一组径向旋转控件（滑块 ±90°、步进 ±5°、复位 25°），2.0 只有一套写死的分层网格。本轮把 1.0 的两个几何库 **逐行搬入** `app/utils/graph/topologyRadialLayout.ts`（tier 楔形扇：圆心 = 最小 tier、等分半径、逐档张角、按父分组 + 组间留白 + 组内重心、整体旋转）与 `topologyTierTreeLayout.ts`（每层一条水平线 + 整层居中）；`layoutTopology()` 增设 `mode` / `rotateDeg` 选项并在三种布局间分派，裁剪逻辑抽成 `crop()` 由三者共用（切换布局不改变「裁掉了哪些」）。`force` / `grid` / `circular` 是 1.0 借 G6 引擎实现的，2.0 无布局引擎，**登记为未复刻项且不进下拉**（不放假选项）。页面：工具栏左区加布局下拉（当前项打勾、`data-layout` 暴露当前布局），画布右上角加旋转控件（滑块 + 度数徽标 + ±5° 步进 + 复位），**只在 `radial` 渲染**（其它布局不读该角度，置灰滑块等于暗示「拖了会有区别」）。§6.8 新增布局词表与旋转口径、§八新增「当前布局不支持某个视图控件」一行、§九新增 A24（三布局坐标两两不同 + 层级树每层居中 + 切回复原）/ A25（控件仅 radial 存在 + 步进 +5° + 复位 25° 坐标复原），`check:ui` 165 → 167。
| 2026-11-06 | 0.14.0 | **节点拖拽位移与「恢复默认配置」（A26）**：1.0 v0.36 的用户规格是「2D 模式下鼠标拖拽节点，拖完要留在那儿」+ 一键「恢复默认配置」，2.0 的节点拖拽此前会变成拖画布（`<svg>` 的平移抢走了 `pointerdown`）。本轮把 1.0 的 `lib/topologyNodeOffsets.ts` 搬成纯函数 `app/utils/graph/topologyNodeOffsets.ts`（节点 id → 增量 `{dx,dy}`、`OFFSET_EPSILON = 0.5px` 抖动容差、不可变写入、`applyNodeOffsets()` 负责「几何 + 增量」合成），位移表由 `useTopologyMonitor()` 持有（`nodeOffsets` / `moveNode` / `resetNodeOffsets` / `nodeOffsetCount`），`TopologyCanvas` 只合成不改表：节点 `<g>` 用 `.stop` 接管 `pointerdown`，`getScreenCTM().inverse()` 把屏幕坐标换成 viewBox 用户单位（缩放 / 平移不会把增量算歪），松手后 emit `offsetChange`。页面画布左下角新增「恢复默认配置」（`topology-reset-view`，`data-offsets` 暴露条目数）：清位移 → 旋转角回 25° → 视口复位三合一，三项任一非默认才可点；`setLayoutMode()` 换布局时清空位移（位移只相对当前几何成立，`tree` 下旧增量会把整行推出画布中心）。§6.9 新增三层口径与失效规则，§八新增「拖拽位移的归属与失效」一行，§九新增 A26（真指针拖拽 → 只有被拖的那台动 → 刷新不弹回 → 三合一复位坐标逐点复原 → 切布局清位移），`check:ui` 167 → 168。 |
| 2026-11-07 | 0.15.2 | **链路事实卡 / 区域分组折叠 / 无线事实卡（A28 ~ A30，§6.11 落码）**：0.15.1 只做了取证，这一轮把三条只读事实落下来。① 链路：`TopologyGraphLink` 补 `medium` / `relation` / `admin_status` / `telemetry`，读表收成纯函数 `app/utils/graph/topologyLinkFacts.ts` —— 基础事实与 `traffic_in|out` 照实（`0` 是真实值），而 `in|out_util_pct` / `packet_loss` / `error_rate` **只在 `> 0` 时有值**，现网这四项 48/48 全 0 而流量非零 ⇒ 一律 `null` ⇒ 展示「未计算」，卡片底部加一句说明；画布连线可点（`selectLink` / `data-link-key` / 选中高亮，再点取消），`<title>` 与卡片共用同一份读表，悬停提示因此永不失配。② 分组：`TopologyCombo` 补 `data` / `children` / `counts`，`flattenTopologyCombo()` 抬成读模型，详情栏出「区域分组」卡（组名、上游自报的 `distro`/`access`/`terminal` 计数、可见/声明成员数、折叠开关、「全部展开」）；折叠只改视图输入 `collapsedCombos`，布局先滤节点、挂边随之消失、画布角标写「已收起 N 台（M 组）」，**组计数一个字不变**，位移层随成员变化清空。③ 无线：节点补 `ssid` / `band` / `channel` / `dbm` / `clients` / `util` / `tx_power`，读表 `wifiFactsOf()`（七项全空返回 `null` ⇒ 整块不画，画一排「—」等于宣称取不到）。假上游样本同步补齐（首个链路给全 `medium` / `relation` / `admin_status` / `telemetry`，`10.0.0.4` 给七项 Wi-Fi，三个组带 `children` 与 `counts`，节点带 `combo`），`check:ui` 新增 A28 / A29 / A30，计数 169 → 172（`172/172` 实测全绿）。 |
| 2026-11-07 | 0.15.1 | **假上游默认回现网形状，并给链路 / 2.5D / 分组做取证（§6.11）**：0.15.0 的教训是「自检样本比真上游干净」，所以假上游的样本本体仍是扁平表，但**出站默认**经 `nestTopologyGraph()` 包成 `{ id, data, style, combo }`（`control.topologyNested` 初值 true）—— A21 ~ A26 从此全部跑在两层形状上，`__control/topology-flat` 只留给 A27 做对照：A27 现在读两次几何，两层形状与扁平本体必须**逐点相同**（实测 `flatSame=true`，6 台 4 行 `cy` = 70/220/370/520）。同时对现网同一份 36 节点 / 48 链路样本做字段取证并写成 §6.11：链路 `data.telemetry` 48/48 存在，但 `in|out_util_pct`、`packet_loss`、`error_rate` **实测全 0**（而 `traffic_out` 有 16.18 Mbps），所以链路提示只能展示 `bandwidth` / `linkType` / `medium` / `relation` + `traffic_in|out`，利用率维度写「未计算」而不是 0%；上游 `style.x/y` 的 `y` 按 tier 精确落在 180/360/540/720、`x` 跨 120 ~ 4520，是「每层一行」的示意图，2.5D 因此仍由 `layoutTopology()` 产出而不复用上游坐标；`combos`（3 组、各 11 个 children、带 `counts`）与 27/36 节点的 Wi-Fi 事实列为下一步 P1。 |
| 2026-11-07 | 0.15.0 | **线格式的两层形状拍平（A27）**：现场排查「分层布局把所有节点排成一条水平线」的真因是**形状缺口**，不是几何算法 —— 8888 `/topology/graph` 的节点 / 链路是 G6 元素形态 `{ id, data: { deviceName, tier, status, cpu… }, style, combo }`，事实全在 `data` 里，而 2.0 的读模型一直按扁平字段取值：`data.tier` 读不到 ⇒ `normalizeTier(undefined)` 一律回落 3 ⇒ 36 个节点全部塞进同一个分带（实测 `rows = 1`、`cy` 全等），连带名称退化成管理 IP、状态全 `unknown`、详情栏全写「—」。修法：新增纯函数 `flattenTopologyNode()` / `flattenTopologyLink()` / `normalizeTopologyGraph()`（`app/utils/graph/topologyNormalize.ts`，取值优先级与 1.0 的 `normalizeTopologyInput()` 对齐：`data.*` 优先、顶层兜底，名称取 `data.deviceName → data.label → 顶层 name / hostname / label`），只在 `useTopologyMonitor.loadGraph()` 调用一次，布局 / 事实层 / 画布都只吃扁平读模型。顺带按实测修正契约注记：`data.tier` 实测四档齐全（3/3/21/9）、链路 `data.bandwidth` 是字符串 `"100 Mbps"`、节点带 `style.x|y`（2.0 不复用，几何仍由 `layoutTopology()` 唯一产生）。§6.10 新增两层形状与拍平口径、§八新增「上游形状与读模型不一致」一行、§九新增 A27；假上游加 `__control/topology-nested` / `__control/topology-flat`（与现网同形的两层样本），`check:ui` 168 → 169。 |
| 2026-11-07 | 0.17.0 | **LLDP 邻接分区落地（A38 ~ A40，§6.14），并把 join 损失量化（§6.12）**：① 页面 — 详情栏新增「LLDP 邻接」卡，与原有「邻居」（只列本图画布上的边）分卡展示、各注口径；读表收成纯函数 `app/utils/graph/topologyNeighbors.ts`（`neighborRowsOf()` 保持上游顺序、`neighbor_name` 与 `sys_name` 并列不互相顶替、`local_interface` / `remote_interface` 分列、`ttl` 非数值写 `null` 而不是 `NaN`；`canvasIdIndex()` / `neighborCanvasCount()` 走 `neighbor_id` → `runtime-inventory.ip_address` → 画布节点 id 三跳），取数以 `selected.marker.simId` 为唯一触发键并带请求序号丢弃过期响应；四种状态分开写（`data-lldp-state`：`idle` / `loading` / `ok` / `error`），`idle` 明说「不等于它没有邻居」，`error` 只写上游原话，且失败时清空上一台的邻居行（与告警保留旧读数相反 —— 邻接是逐节点清单，留着会串台）。② 假上游 — `n1` 的样本改成两个邻居（`n2` 在画布上、`n10` 画布外），新增 `__control/lldp-error` / `__control/lldp-ok`（500 + `lldp_agent_unreachable: snmp timeout on n1`）。③ 断言 — A38 两套身份并存 + 画布外对端照实列出（`count=2` / `on-canvas=1`，两行 `data-on-canvas` 分别为 `true` / `false`）、A39 上游明确回空数组才写「没有邻居」、A40 失败只写原话且全页零「这台设备没有邻居」，`check:ui` 计数 183 → 186。④ 事实 — §6.12 补「join 损失是设计内的」：现网 77 条 firing 实测 43 条挂在画布外、9 条 `target_id` 为空，页头读数是「图上 N 条 / M 台设备」而非全网。 |
| 2026-11-08 | 0.17.1 | **纠正「协议 / 射频 / LLDP / 数据质量四页没有端点」的误判（A10d ~ A10i）**：按 2026-11-08 实测的 `/api/v1/metric/device`（胖 AP 两台样本）逐字段对账，上游对每个设备其实都回 `sys_descr` / `sys_object_id` / `sys_contact` / `sys_location` / `sys_services` / `sys_uptime_ticks`、`hw.{entities,vlan_count,route_count,fdb_count,mstp_status}`、`neighbors[]` + `neighbor_summary`、`protocol.{ip,icmp,tcp,udp}` 计数器、`lldp.{chassis_id,ports[],neighbors[]}`（`local_port_num` 与本机 `port_num` 同域）、`radio.{channel,frequency_mhz,tx_power_dbm,noise_dbm,associations[]…}`、`device_quality.{device_latency_us,device_jitter_us,device_loss_ratio_ppm,metric_age_sec,metric_valid,peer_count}`、`quality` 标记、`sim` 与 `jobs`；此前 `MetricDeviceFact` 只登记 identity / health / interface_summary / traffic，四页因此被写成缺口卡，实际数据一直在响应里。① 契约 — `shared/types/metric.ts` 按实测补全（`health` 与 `lldp`、`radio`、`device_quality` 整块可为 `null`）；② 归一 — `MetricDeviceRow` 收进这批字段（协议计数器按固定顺序成表、`neighbor_summary.total` 优先于清单长度、`quality` 取值为 `true` 的键），仍守 §九 三条口径（主键缺即丢、`null` 显 `—`、不补 0）；③ 页面 — 四页换成 `DeviceProtocol` / `DeviceRadio` / `DeviceLldp` / `DeviceQuality` 卡片组件，概览页补「系统信息 / 硬件 / 邻居」三卡与 `portRows` 的 `unknown / wired / wireless`，接口列表页顶部补 `lldp.ports` 端口清单，四页底部只保留**真正**缺的两项（OSPF / BGP 邻居协议表、探针侧与网管侧两条链路对比）；④ 假上游 — 三个设备样本换成实测形状，`protocol=null` / `lldp=null` / `radio=null` 各留一台，旧键 `gap.deviceProtocol*` / `deviceRadio*` / `deviceLldp*` / `deviceDataQuality*` 全部删除（它们把「有来源」写成了「没有端点」）；⑤ 断言 — A10d 概览出系统信息 / 硬件 / 邻居、A10e 协议计数器照实（IP 组整组 `null` 显 `—`、`487114` 渲染 `487,114`）、A10f `radio=null` 说明没给、A10g 无线设备出信道 36 与一条 assoc 行、A10h `lldp=null` 与「端口 2 条 + 邻居 1 条且本机端口反查成 `n10-eth2`」两个分支、A10i 探针侧质量 `16,850 µs` / `0 ppm` / `job_mixed` 置位，A10b 补「上游端口清单 2 行」，`check:ui` 计数 193 → 201（`sh scripts/ci-expectations.sh ui` 同步）。 |
| 2026-11-08 | 0.17.2 | **按三份实测响应纠正链路页与设备页的同类误判（A10j ~ A10m、A12e / A12f）**：拿 `/api/v1/metric/device`（36 条）、`/api/v1/metric/link`（47 条）、`/api/v1/metric/datapoint?mode=range&metric_code=simIfaceInKbps` 三份真响应逐字段对账。① 链路侧 — `metrics` 每条都有 `in_errors` / `out_errors` / `in_discards` / `out_discards` / `in_ucast_pkts` / `out_ucast_pkts` / `in_nucast_pkts` / `out_nucast_pkts` / `in_unknown_protos` / `out_qlen`、`probe_peer` / `probe_dir` / `rtt_mdev_us`、`latency_age_sec` / `jitter_age_sec` / `loss_age_sec` / `rate_age_sec` / `metric_valid`、`graph_medium`，端点侧还有 `if_mtu` / `if_phys_address` / `if_speed_bps` / `admin_status` / `if_alias`，而契约只登记了 12 个字段 ⇒「错误统计」「链路质量」两页把真字段写成「2.0 没有端点」；`redundancy_state` / `real_if_index` / `if_alias` 才是实测恒 `null` 的那几个。② 设备侧 — 漏掉的是 `radio.multilinks[]`（只有终端报，9 台共 15 条，带 BSSID / 信道 / RSSI / 速率）、`radio.peer_ap_name` / `peer_ap_mac`（9 台终端各 1 个）、`radio.{role,bss_type,power_mgmt_mode,supported_rates_tx_mbps,supported_rates_rx_mbps}`、`hw.entities[]`（9 台交换机各 1 条：板名 / 型号 / `admin_status` / `oper_status`）、`lldp.man_addr` 与邻居的 `man_addr` / `sys_desc`（110 条邻居多数有），`hw.entities` 此前只数了条数。③ 端口维度 — `simIfaceInKbps` 的序列标签是 `simIfaceMetricIndex`（不是 `ifIndex`），`seriesGroupKey()` 只认 `ifIndex` 时接口页对仿真指标只能出「设备级」一行；改为「`ifIndex` 优先 → 唯一的 `*Index` 兜底 → 多个 `*Index` 不猜（不把两种口径的索引混成一组）」。④ 页面 — 错误统计页拆「错误与丢包 + 报文计数」两卡、链路质量页补探针侧与四个新鲜度、端点对比补 alias / MTU / MAC / 速率 / 管理状态、概览加 `graph_medium` 与作业、射频页补 MLO 表与对端 AP、概览页把 `hw.entities` 画成表、LLDP 页补两处管理地址，缺口卡缩到真正缺的三项（CRC / 对齐 / 冲突计数、重传 / 乱序、分端点质量）。⑤ 假上游 — 链路两条样本换成实测形状（`link_id` 改为 `A:port--B:port` 复合键，一条全字段、一条逐项 `null`），`sim_iface_kbps` 进名字清单与目录、`/metric/datapoint` 回三组 `simIfaceMetricIndex`。⑥ 断言 — A10j 多链路表 + 对端 AP、A10k 两处管理地址、A10l 硬件实体表、A10m 三个仿真端口、A12e 报文字段照实、A12f 探针侧与新鲜度，`check:ui` 计数 201 → 207（`sh scripts/ci-expectations.sh ui` 同步）。 |

| 2026-11-07 | 0.16.1 | **告警兜底口径两条断言 + LLDP 契约按实测重写（A36 / A37，§6.13）**：① 断言：假上游新增 `__control/alarm-flood` / `__control/alarm-flood-off`，换成「103 条挂一台设备」的极端样本（其中一条 `severity=catastrophic`，现网实测只有 `critical` / `warning`）；A36 钉「角标文本 = `99+` 而 `data-alarm-count` / `data-alarm-events` 仍是 103」（截断的是显示，不是读数），A37 钉「未登记严重度落最低档 `info`（`data-severity` 依次 `critical,warning,info`）、不在 warning 之前插队」，`check:ui` 计数 181 → 183。② 契约：对 8001 取一次 LLDP 样本（`/api/lldp/summary` 与 `/api/lldp/neighbors/{node_id}`），实测与 `shared/types/simulator.ts` 完全不符 —— summary 是 `{ node_count, neighbor_entry_count, mode, mib_standard, lldp_mib_oid, local_sys_name, local_sys_desc, local_chassis_id }`（扫描规模 + 一台示例端点，**不是**按交换机分组），邻居项是 `{ neighbor_id, neighbor_type, neighbor_name, local_interface, remote_interface, chassis_id, chassis_id_subtype, port_id, port_id_subtype, port_descr, sys_name, sys_desc, ttl, link_type, link_status, discovered_at, mib_oids }`（平台台账名 `N1` 与 MIB 名 `核心路由器-1` 并存、`chassis_id` 恒零不可当键、`discovered_at` 不带时区）；同版按实测重写契约并把假上游两个 LLDP 端点换成本形状（`n4` 两台、`n1` 一台、其余空数组），§6.1 的 `target_type=node` 同时按实测改为 `device`。页面分区仍留 P1。 |
| 2026-11-07 | 0.16.0 | **告警叠加 / 只看某组 / 链路动作（A31 ~ A35，§6.12 落码）**：三条能力各自独立取数、独立降级（`Promise.all([loadGraph(), loadSimulator(), loadAlarms()])`，告警失败不摘拓扑）。① 告警：`useTopologyMonitor` 读 `/api/alarm/alarm-events`（经 BFF `[...slug]` 网关，server 侧无本地路由），读表收成纯函数 `app/utils/graph/topologyAlarms.ts` —— 只认 join 得上的 `target_id`、未知严重度降为 `info`、角标只报计数与最高档、详情栏按同一份排序列前 3 条 + 「另有 N 条」；画布节点带 `topology-node-alarm` 角标（`data-alarm-count`，99+ 截断），详情栏出「当前告警」卡；**读失败 ≠ 没有**：通道失败时角标全摘、页头读数「—」、详情栏写「告警通道不可用：<上游原话>」，拓扑与仿真照常。② 只看某组：`focusCombo()` 只改视图输入 `focusComboId`（与折叠互斥、清空位移层、上游删组后自动失效），页头出「只看 <组名>」徽标 + 「看全部区域」。③ 链路动作：`simulatorLinkFor()` 把图上链路对齐到仿真侧 `simId`，`performLinkAction()` 打 `POST /api/sim/api/network/links/{sim_id}/{down,up,toggle}`，按钮禁用原因按「通道 → 写开关 → 选中 → 是否在仿真里」只说缺的那一层，二次确认写明两端、**仿真链路 id** 与「不可撤销 / 不保留副本 / 不会自动回滚」，成功 toast + 就地刷新。假上游新增 `/alarm/alarm-events` 样本（5 条 firing + 3 条干扰行：空 `target_id` / 图外 `10.9.9.9` / 已 `resolved` 的 `10.0.0.2`）与 `__control/alarm-error` / `__control/alarm-ok`，`check:ui` 新增 A31（两条）/ A32 / A33 / A34 / A35（四条），计数 172 → 181（`181/181` 实测全绿）；节点手势与形状读取改用 `topology-node-shape` / `topology-node-alarm` 稳定 testid，不再依赖 `circle:last-of-type` 这类位置选择器。 |

| 2026-11-08 | 0.17.3 | **设备 / 链路指标页的标识与页签从右栏上移到内容页工具栏（A10n / A10o / A12g）**：1.0 版式把「名称 · 管理 IP · 状态 + 页签数 + 刷新」放在详情栏第一行、`UTabs` 页签条放在第二行，等于在右栏内自建第二条 header —— 与 `NMCPS-ARCH-006` §4「栏内不再起 header」冲突，且两条横条约吃掉右栏 90px，而这两行全是记录域动作与导航、没有一条是内容。① 改动 — `device-metrics`（7 页）与 `link-metrics`（6 页）的 `<header>` 与 `<UTabs>` 从 `#detail` 里整段删除：记录标识（设备页 = 名称 · 管理 IP · 状态；链路页 = `A → B` · `link_id` · 状态）注入 `#app-toolbar-left`，页签条 / 页签数徽标 / 刷新按钮注入 `#app-toolbar-right`（顺序：页签 → 页签数 → 刷新）。② 一个动作一个入口 — 未选中记录时刷新留在左区（作用对象是整份台账 = 集合域），选中后随页签进右区、左区那份同时消失，全页不会出现两个刷新。③ 放不下就折叠 — 一条 49px 工具栏装不下「标识 + 6~7 页签 + 计数 + 刷新」，`compactToolbar`（`useMediaQuery("(max-width: 1279px)")`）成立时页签条换成 `UDropdownMenu`（按钮文案 = 当前页、菜单一项不少、当前页打勾），与 `NMCPS-ARCH-006` §4.4 的折叠口径同源。④ 断言 — A10n 钉设备页「左区有标识且与左栏选中行同名同 IP、右区 7 页签 + 计数 + 刷新、右栏内零 `header` 零 `role=tab`」，A10o 钉 1180px 下页签条消失、菜单 7 项、选中 LLDP 即换页，A12g 钉链路页同版式（6 页签、`link_id` 原样），计数 207 → 210（`sh scripts/ci-expectations.sh ui` 同步）。 |
| 2026-11-08 | 0.17.11 | **指标页工具栏与左栏行结构收敛到共享组件：页签改 pill、徽标升 `md`（A10 / A10n / A12 / A12g）**：① 页签条改用 `Layout/ToolbarTabs.vue`（`UTabs` + `variant="pill"` + `size="sm"` + `:content="false"`）—— `link` 变体的选中标记是一枚 `rounded-full` 指示条加下划线色条，摆在 49px 工具栏里与旁边的方角按钮对不上；pill 把整条页签做成 `bg-elevated` 胶囊、当前页给主色块。② 两页的状态徽标与页签数徽标改用 `Layout/ToolbarBadge.vue`（`UBadge` + `size="md"`，`text-xs` 与旁边的 `sm` 按钮同高，不再缩成一条虚线），栏内徽标（列表行 / 详情卡）仍是 `sm`。③ 左栏行改用 `Layout/ListRow.vue`（六个 listbox 共用一份 `<li role="option">`；行内文案、选中态与键盘语义不变，`rowElements` 改存组件实例，`focus()` 由组件转给 `<li>`）。规则写进 `NMCPS-ARCH-006` §3.6 / §4.4（§七新增第 23 行「工具栏组件基线」）；断言改写不新增：A10 / A12 的「1.0 版式」两条各加「页签列表 class 含 `bg-elevated`」与「页签数、状态徽标 class 含 `text-xs` 且不含 `text-[10px]`」，`check:ui` 仍 **220** 条（`sh scripts/ci-expectations.sh ui` 不变）。 |
| 2026-11-08 | 0.17.12 | **画布口径二次裁决：选中只加粗、线宽读带宽、无线虚线、图例精简、深链翻页（A47 改写 / A49 / A50，§6.15.1）**：① 选中态不再换色 —— 节点 2 / 3 / 4px 三档 + 同色低饱和外环（`topology-node-halo`），关联链路与选中链路只加 1.5 / 2.5px，`stroke-(--ui-primary)` 那一档整个删掉（灰是「连接关系」的唯一色义）。② 线宽新增 `app/utils/graph/topologyLinkStyle.ts`（`linkStrokeWidthOf()` / `linkDashPatternOf()`）与 `bandwidthMbps()`：带宽四档、无线介质 `2 3`、`offline` 的 `6 4` 优先。③ 链路可点 —— 每条线多铺一层 14px 透明命中区（`topology-link-hit`），右栏改成**二选一**（`selectLink()` / `pickNode()` 互摘），节点的无线 / 告警 / LLDP 卡不再与链路详情上下堆叠。④ 图例只留层色一行，`pages.topology-monitor.legend.*` 四个死键从 cn / en 一并删除。⑤ 深链能翻页：`metricDeepLink.resolveDeepLink()`（上限 `DEEP_LINK_MAX_PAGES = 20`，`useMetricLedger().fetchPage()` 不改当前页）命中后把左栏切到那一页再写 `?id`；假上游加 `__control/metric-deep-page`（垫 15 / 20 条填充行把真样本挤到第 2 页）。`check:ui` **220 → 222**（A47 改写、A49 / A50 新增），`sh scripts/ci-expectations.sh ui` 同步。 |
| 2026-11-08 | 0.17.13 | **画布口径三次裁决：连线去饱和、选中只加外延环、叶子归位终端层、连线可聚焦（A43 / A45 / A47 / A49 加严、A51 新增，§6.15.2）**：① 连线灰换成新 token `--topology-link`（`oklch(from var(--ui-text-muted) l calc(c * 0.35) h)` + `@supports` 渐进增强：明暗两态同亮度、色度压到 35%，不支持相对色语法时退回 `--ui-text-muted`，绝不退化成黑色）；② 强调彻底离开本体 —— `linkStrokeWidthOf()` 不再收 `emphasis`、`nodeStrokeWidth()` 整个删除（节点本体恒 2px），关联 / 选中 / 键盘焦点一律走同色低不透明度外延环（`topology-link-halo` / `topology-node-halo`：链路 +6 / +9px @ 16% / 30%，节点 `r+3` / `r+5` @ 22% / 45%）；③ 层序归约认定的叶子（`demotedIds`）归位终端层：`roleOfNode(tier, isLeaf)` + `tierOfNode()` + `LEAF_TIER = 4`，零边图不参与、顶带的根不下移；④ 连线可聚焦（`role=button` / `tabindex=0` / 事实化 `aria-label`（`pages.topology-monitor.link.selectAria`）/ `aria-pressed`，`focus` 驱动 `focus` 档外延环，`Enter` / `Space` 与鼠标点击同效）。`check:ui` **222 → 223**，`sh scripts/ci-expectations.sh ui` 注释同步。
| 2026-11-09 | 0.17.14 | **收起下级走通「同档那一跳」：`tier` 相同的上下级按「还有上行」定向（A52 新增，§6.15）**：用户反馈「点汇聚交换机-1~3 的收起，Wi-Fi胖AP-10~18 没有跟着收起来，留在画布上也不连任何东西」。根因是 `childIndex()` 只有一条判据「下级 = 邻居里严格更靠下的那一端」：现网 18 台胖 AP 登记成 `tier 3`，与它们上联的 3 台接入交换机**同档** ⇒ AP 谁也不认接入为上级；收起汇聚时接入（tier 3）被摘掉，AP 与它们之间的边也一起被摘（边的一端是隐藏节点），于是画布上剩下 18 个没有任何边的孤点 —— 0.17.13 把状态语义挪到中心圆点、连线去饱和之后，这种「空壳节点」比之前更醒目。修法：同档邻居之间补第二条判据 —— 一端邻接里存在**严格更靠上**的设备（「还有上行」）、另一端没有时，有上行的那端是上级；两端都有 / 都没有上行时不认方向（两台都上联汇聚的接入、网状顶层同理，仍不凭空造层级）。实现落在 `app/utils/graph/topologyCollapse.ts` 的 `hasUplink` 集合上，`hiddenCounts` 与子树过滤同源，角标读数、左上角「已收起 N 台」与画布一起变。① 假上游新增 `__control/topology-same-tier`（8 台：核心 / 汇聚 / 两台接入 / 3 台胖 AP / 1 台终端，AP 只连接入、终端挂在 AP 下、两台接入都上联汇聚），`__control/topology-mesh` 与 `__control/topology-default` 互斥复位；② A52 钉四件事 —— 角标恰 4 个（同档且两端都有上行的接入-2 与只连接入的 AP-11/12 都没有）、读数 `+6` / `+4` / `+1`、双击汇聚后 8 台 → 2 台且链路剩 1 条、展开逐点复原后双击接入-1 → 4 台（接入-2 留着）；③ `check:ui` **223 → 224**，`sh scripts/ci-expectations.sh ui` 注释同步。样本上「旧判据」会剩 6 台（接入摘掉、3 台 AP + 1 台终端留成孤点），因此这条断言对旧实现是红的。 |
| 2026-11-09 | 0.17.15 | **布局只留两档（径向扇 / 层级树）、汇聚居中压在子女之上、邻居连线随选中设备染色、画布控件搬进工具栏左区（A24 / A27 / A41 / A42 ~ A45 / A47 / A48 改写，§6.8 / §6.15.3）**：① 布局 — `layered` 与 `tree` 到 0.17.14 已是同一套层序归约 + 同一套父压子女中线的两份实现，同一张图画出来几乎一样，用户只能靠「哪个更像 dagre」分辨 ⇒ 收掉 `layered`，塔型语义整份并入 `tree`（`topologyLayeredLayout.ts` 只留 `resolveLayeredRanks()`，`TOPOLOGY_LAYOUT_MODES` 两档，i18n `layouts.layered` 两语删除）。② 父压子女中点 — `topologyTierTreeLayout.ts` 新增第 ⑤ 轮收敛：每个父节点的 `x` 取所有可见子女 `x` 的均值（新增 `packRow()` / `mean()`），根行除外（它没有上级可压，均值会把它拉离画布中心）。这样「汇聚居中压在接入之上、核心居中压在汇聚之上」成为可断言的几何事实（A24 / A42 钉 `core.x = 两汇聚中点 = access.x = 两终端中点 ±1px`）。③ 邻居连线染色 — 选中设备时，与它直连的 `incident` 档外延环改用**选中设备自己的层色**（`selectedRole` / `linkHaloTintOf()` / `linkHaloClass()`，模板暴露 `data-link-halo-tint`）；`selected` / `focus` 两档仍借灰 —— 前者说的是「这条线被点中」，染色会把「谁被点中」说反。④ 控件位置 — 旋转 / 显示名称 / 恢复默认配置 / 缩放整排**搬进工具栏左区**（`#app-toolbar-left`，与刷新、布局下拉同行）：贴在画布右上会盖住最上层的节点与连线，A48 因此改钉「归属左区 + 与布局下拉同排（≤12px）+ 不压画布」。⑤ 读数 — 页头「仿真中节点」徽标删除（仿真没配置是部署形态，不是读数），读数由 5 枚收成 4 枚。⑥ 节点级「停止 / 重启」下线 ⇒ A6 / A9 改成「画布上不得出现 `sim-action`」的否定式断言（A9 由 6 条收成 1 条），写入口只剩链路详情卡里的 `topology-link-action`（A35 端到端不变）。`check:ui` **224 → 219**，`sh scripts/ci-expectations.sh ui` 注释同步。 |
| 2026-11-09 | 0.17.16 | **工具栏六项收敛：透明画布、两枚复位下线、排尾「更新」、旋转 / 布局图标、标签永不截断（A44 / A48 改写，§6.8 / §6.9 / §6.15.4）**：① 画布背景透明 —— 画布框去掉 `bg-(--ui-bg)`、只留描边与圆角，底色交回页面；② 旋转旁与缩放旁那两枚独立复位（`topology-rotate-reset` / `topology-zoom-reset`）整枚删除，复位旋转角 / 复位视口仍由「恢复默认配置」三合一承担（一排放三个同款 `carbon:reset` 只会让人不确定该点哪一个）；③ 左区第一枚「刷新拓扑」改名为「更新」（新增 `pages.topology-monitor.refreshLabel`；tooltip 与 `aria-label` 仍是「刷新拓扑」全称）并挪到左区排尾 —— 左区顺序固定为 **布局下拉 → 旋转 → 缩放 → 显示名称 → 恢复默认配置 → 更新**，前面几枚是「这张图怎么画」、排尾那枚取数；④ 旋转步进按钮改用合法的 Carbon 名 `carbon:rotate-counterclockwise` / `carbon:rotate-clockwise`（旧名 `rotate-ccw` / `-cw` 不存在，按钮上是一串空 `<svg>`）；⑤ 布局下拉与它自己的按钮共用 `TOPOLOGY_LAYOUT_ICONS`（`radial` → `carbon:chart-relationship`、`tree` → `carbon:category`），切档时按钮图标跟着换；⑥ 名称标签**永不截断**：`fitText()` / `LabelPlan.text` / `data-label-truncated` / 补全名的 `<title>` 全部下线，`planLabelRow()` 只按奇偶错行；字号 11px → 10px、留白 8px → 6px、基线差 12px → 11px（`TIER_TREE_MIN_NODE_GAP = 74` 下「无线终端设备-01」错行后仍放得下，因此不截断也不会压字）。死键 `rotate.reset` / `zoomReset` 两语一并删除。A44 改钉「文本里零省略号 + 全名逐字相等 + 字号 10px + 错行档位 0/1」，A48 加钉「两枚复位 testid 不存在」「左区排尾顺序与『更新』文本」「旋转两枚图标 SVG 非空且互不相同」「布局图标随档位变化」「画布上两层容器背景全透明」；`check:ui` 计数不变（**219**，两条断言改写而不新增）。 |
| 2026-11-09 | 0.17.17 | **根是第 0 档、五档层色、层级树按末层居中、选中态收紧（A24 / A43 / A47 改写，§6.8 / §6.15.5 / §七）**：用户看完 0.17.16 的画布提了四条。① **`tier=0`** —— 选举出的根从「借核心那一档」改成真正的第 0 档（`ROOT_TIER = 0`）：详情栏「层级」写 `0`、画布 `data-node-tier="0"`，五档层级（0/1/2/3/4）与五个角色一一对应；`normalizeTier()` 仍把上游值收在 1..4，因此 `0` 只可能来自层序归约。② **五档层色** —— 用户指定色板落成 `--topology-tier-*`（边界 `#f33` / 核心 `#f3c` / 汇聚 `#c63` / 接入 `#369` / 终端 `#0c6`）：不再借 Nuxt UI 的四档语义色（五层必然两层同色，且「红色核心」会被读成故障），根也不再借中性深色 —— 图例能把五行都列成一种颜色。③ **居中改锚末层** —— 层级树在「父压子女中点」收敛后整块平移，让**末层 `x` 均值 = 画布中心**（读当前 `viewBox` 宽度的一半，20 台样本是 537 而不是写死的 500）；同时删掉「按 `padding` 再夹一次平移」的越界守护 —— 它把末层又推离中心 37px（`bbox` + `overflowShift()` 已经保证内容在画布内），「末层居中」是裁决、留白是结果。径向扇仍按 `bbox` 居中（弧上各点 `x` 均值恒等于圆心，套末层锚点等于什么都不做），两种布局的中心本来就不是同一个东西。④ **选中态收紧** —— 节点选中档外延环 `r+5 / 3px / 45%` → `r+2 / 4px / 50%`（贴着已经加粗的本体才像「被圈住」），节点本体描边 2px → 3px（节点上没有第二套粗细语义，链路那边仍恒读带宽、一根不动）；`incident` 外延环不透明度 16% → 30%、`selected` 30% → 45%（层色压在画布上 16% 几乎看不出来，等于「染了没效果」）。断言：A24 改钉「末层均值 = 画布中心（当前 `viewBox` 一半）」、A43 加钉 `data-node-tier` 的 `0` / `1` 与末层 14 台的均值、A47 改钉「选中本体 3px + 外环 4px / 0.5」「`incident` 0.3」、A49 的选中环 0.45 与 A51 的焦点环 0.3 同源；`check:ui` 计数不变（**219**，三条断言改写而不新增）。 |
| 2026-11-09 | 0.17.18 | **选中链路改主色、标签方向由布局给、默认选中根、指标按钮压底（A44 / A45 / A47 / A48 / A49 / A51 改写，§6.15.6 / §七）**：用户看完 0.17.17 的监控页提了四条。① **选中链路用主色、光晕更细** —— 被点中的那条线本体换成 `stroke-(--ui-primary)`（§6.15.2「强调不动本体」的唯一例外），外延环增量 9 → 5（1 Gbps 那条 2.5 + 5 = 7.5px）、不透明度 45% → 35%；关联档不动（+6 / 30% / 染选中设备的层色）。② **径向标签字号与位置统一** —— 字号不再逐布局变（统一 10px），方向交给布局层：径向扇背离本扇圆心（`labelDirOf()` 读 `fans[].apexId` 的坐标）、层级树正下方 `(0,1)`，间距统一 `半径 + LABEL_GAP(12) + 错行档高`，画布改居中锚定（`text-anchor` / `dominant-baseline` 都是 `middle`），20 台样本里 9 个「标签压节点」归零。③ **默认选中根、没有未选中态** —— `defaultSelectionId()`（选举出的根；顶端带只有一台时选举不触发，此时取**最上一档**：径向扇里是扇心、层级树里是塔尖；A49 也因此按层号认根，不按 `data-node-role`）成为初值，收起子树把它藏起来时回落到它；`selectNode()` 不再「点第二下取消选中」；点链路时节点选中保留、画布 `selected-id` 暂置空（`canvasSelectedId`），再点同一条线退回设备视图 —— 链路卡片的关闭叉与 `link.close` 键一并删除。④ **指标按钮压底、主色** —— 两张卡片的深链按钮移到卡片最后一块（`primary` + `soft` + `block`），文案改成动作本身「查看设备指标 / 查看链路指标」。断言：A44 加钉层级树 `data-label-dir` 恒 `0,1`、A45 加钉径向 19 台标签方向与它到根的射线同向、A47 的「取消选中」改成「再点同一台仍是 3px + `selected` 环」、A51 的 `Space` 改成「回到设备视图」且 `Enter` 后本体是主色、A48 加钉两枚按钮压底 + `primary`、A49 加钉「进页即选中根 + 无空态 + 无 `topology-link-close` + 选中链路 7.5px / 0.35」；`check:ui` 计数不变（六条改写而不新增）。 |




