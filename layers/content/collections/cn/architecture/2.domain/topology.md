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
version: 0.2.0
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
  - NMCPS-GOV-003
  - NMCPS-ARCH-001
  - NMCPS-ARCH-002
  - NMCPS-ARCH-006
createdAt: "2026-10-25"
updatedAt: "2026-11-05"
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
| 告警叠加 | `GET /alarm/alarm-events` | `page` / `page_size` / `severity` / `status` / `target_type` / `target_id` / `first_triggered_at_from` / `first_triggered_at_to` | `target_type=node` + `target_id=<节点 id>` 用于节点告警角标；规则管理不属本域 |

### 6.2 第二数据源（8001 仿真平台，经 BFF `server/api/sim/**` 白名单通道）

仿真控制面只在**拓扑写操作**与**仿真运行态**上补充 8888 没有的能力。该通道由 `NMCPS-ADR-0019` §4 定义：独立 `runtimeConfig.simulator`、模板白名单、`allowWrite` 默认 `false`、不发 `Authorization`。

| 用途 | 端点（8001，只读） | 说明 |
| :--- | :--- | :--- |
| 仿真运行态台账 | `GET /api/network/runtime-inventory` | **一次取全量**：`{ running, scenario, overrides:{…}, nodes[], links[] }`，实测返回 36 节点 / 48 链路；节点按设备标识与 8888 节点对齐后叠加「仿真中」标记，链路给现场 up/down |
| 仿真统计 | `GET /api/network/stats` | `node_count` / `link_count` / `nodes_by_type` / `links_by_type` / `nodes_online` / `links_up`，供页头徽标 |
| 邻接发现 | `GET /api/lldp/summary`、`GET /api/lldp/neighbors/{node_id}` | 详情栏「邻居」分区（`neighbors[]` 含对端 id / 名称 / 两端接口 / TTL / `mib_oids`） |
| 运行态预览 | `GET /api/network/runtime/preview` | 增删前的候选拓扑预览 |

> 端点动词以实测 `openapi.json` 为准：`/api/network/runtime/nodes` 与 `/api/network/runtime/links` 是 **POST（新建，属写）**，`/api/network/runtime/nodes/{node_id}`、`/api/network/runtime/links/{link_id}` 是 **DELETE（移除，属写）**——只读一律走 `runtime-inventory`，不要按 `runtime/nodes` 取列表（会得到 405）。`NMCPS-ADR-0019` §4.2 已于 2026-11-05 按同一份实测修正。

| 用途 | 端点（8001，写，`write: true`） | 说明 |
| :--- | :--- | :--- |
| 链路动作 | `POST /api/network/links/{link_id}/{down,up,toggle,disable,power,reconfigure}`、`PATCH /api/network/links/{link_id}/{tc,radio}` | 每个动作一个按钮，需二次确认 + 审计日志；`tc` / `radio` 是 **PATCH**（参数化改属性），不是 POST |
| 节点动作 | `POST /api/network/nodes/{node_id}/{start,stop,restart,power}`、`PATCH /api/network/nodes/{node_id}/{radio,ip}` | 同上；`radio` / `ip` 为 **PATCH** |
| 运行态增删 | `POST /api/network/runtime/{nodes,links}`、`DELETE /api/network/runtime/{nodes,links}/{id}` | 直接改动正在跑的仿真，风险最高，需「允许写入」且单独二次确认 |

### 6.3 本地引擎

**本域不使用 BFF 本地引擎**（`NMCPS-ADR-0019` §5.2 未登记本域三元组）。布局计算是客户端纯函数（`app/utils/graph/*`：`topologyLayout` / `topologyLayering` / `topologyRadialLayout` / `topologyTierTreeLayout` / `topologyEdgeStyle`），输入节点与链路数组、输出坐标，不含任何状态。

### 6.4 取数约束

1. **一处出站**：8888 数据只经 `useApi()` → BFF 网关；页面不直连上游、不自建 `$fetch`。
2. **轮询**：拓扑与指标默认 30s 刷新，`document.visibilityState !== "visible"` 时暂停，恢复可见时立即补一次。
3. **时间窗**：指标页默认近 1 小时、`step` 随窗口自动选取；时间窗选择器按 `NMCPS-ARCH-006` §4.1 用「一个摘要按钮 + `UPopover`（预设列 + `UCalendar range`）」，不出现两个并排 `datetime-local`。
4. **失败分类**：`ApiError.code` 为 401 走统一刷新；`5xx` 展示错误态并保留重试；`code=0` 且 `data` 为空按空态处理，**不**渲染成错误。

---

## 七、图形形态

图形全部自绘（`NMCPS-ADR-0019` D1 / D2），本域只允许使用下列组件，页面不得自建 canvas 或自起 `requestAnimationFrame`。

| 组件 | 用在哪 | 载体 | 关键要求 |
| :--- | :--- | :--- | :--- |
| `TopologyCanvas` | `monitor` 主视图 | SVG（≤ 400 节点）+ 等轴投影（2.5D 观感） | 布局以纯函数注入；节点上限 400 / 链路上限 1,200，超出按权重裁剪并显示「已裁剪 N 个」；拖拽 / 缩放 / 框选命中测试由 `app/composables/useGraphInteraction.ts` 统一提供 |
| `TrendChart` | `device-metrics` / `link-metrics` 主图 | SVG 折线 + 面积填充 | 阈值带、时间窗选区、游标读数；> 2,000 点按像素列聚合（保留极值） |
| `SparkStat` | 页面头部与详情栏的小卡片 | SVG | 单值 + 迷你趋势 + 状态色，替代 1.0 里分散的 unovis 迷你图 |

- **状态色**：节点 / 链路状态色来自 `app.config.ts` 的语义色，禁止硬编码 hex。
- **尺寸**：一律 `ResizeObserver` + `useDevicePixelRatio`，不读 `window.innerWidth` 决定布局（容器查询收敛，`NMCPS-ARCH-006`）。
- **动效**：遵循 `prefers-reduced-motion`；不跑常驻 `rAF` 循环，仅在数据到达时重绘。
- **无障碍**：图与图例 `role="img"` + `aria-label`，并提供等价的列表视图（键盘可达）。

---

## 八、空态与降级态

| 场景 | 表现 | 判定依据 |
| :--- | :--- | :--- |
| 拓扑为空（上游返回空 `nodes`） | 空态插画 + 「当前租户下暂无拓扑数据」+ 刷新按钮；**不**显示空白画布 | `data.nodes.length === 0` |
| 指标无数据点 | 空态 + 「该时间窗内无采集数据」；时间窗与指标选择器保持可用 | `matrix` 为空且无错误 |
| 8888 未配置 / 不可达 | 页面级 `UAlert`（错误态）+ 重试；导航与其他域不受影响 | `/ready` 的 `upstream.configured === false` 或请求 `5xx` |
| 仿真平台未配置 | **页面正常只读**：拓扑、指标照常展示；仿真控制按钮组整体 `disabled` 并带提示「仿真控制未启用」 | `runtimeConfig.simulator.baseUrl` 为空 |
| 仿真平台 `allowWrite=false` | 写按钮可见但 `disabled`，hover 说明「仿真写入未开启」；即使绕过前端，BFF 亦返回 405 | 白名单条目的 `write: true` + 开关 false |
| 仿真平台不可达 | 局部降级：只读部分保留，仿真标记与 LLDP 分区显示「仿真平台不可达」；**不得**让 `/ready` 变红 | 通道请求超时 / 连接失败 |
| 裁剪触发 | 画布内角标「已裁剪 N 个节点 / M 条链路」，并给出「切到分层/径向视图减少裁剪」的提示 | 节点 > 400 或链路 > 1,200 |

**硬性要求**：任何降级态都必须说明「缺的是哪一路数据、影响哪些区块、能否重试」，不允许静默空屏或把可选上游的抖动升级成整页错误。

---

## 九、验收断言

`check:ui` 落地时逐条断言（未实现的项在 P1 落地时补齐，不得先写成「已通过」）：

| # | 断言 | 判据 |
| :---: | :--- | :--- |
| A1 | 三页均可路由到达且标题来自 i18n | `i18n/locales/*.json` 的 `topology-{monitor,device-metrics,link-metrics}` 各出现一次，页面无硬编码 CJK |
| A2 | 拓扑页渲染出 `TopologyCanvas` | 选择器命中 `[data-testid="topology-canvas"]`，SVG 内 `circle`/`path` 数量 > 0 |
| A3 | 选中节点后详情栏出现该节点指标 | 点击节点 → 右栏出现 `TrendChart`，且请求 `/api/metric/datapoint` 带该节点 `mgmt_ip` |
| A4 | 空拓扑渲染空态而非空白画布 | 假上游返回 `nodes: []` → 出现空态文案，`topology-canvas` 不存在 |
| A5 | 8888 掉线降级 | 关闭假上游 → 出现错误态 `UAlert` + 重试按钮，页面不白屏 |
| A6 | 仿真未配置时只读 | 不设 `NUXT_SIMULATOR_BASE_URL` → 拓扑正常渲染，仿真动作按钮全部 `disabled` |
| A7 | 写端点被拒 | `allowWrite=false` 时点击（或直接请求）`/api/sim/api/network/links/{id}/down` 返回 405 |
| A8 | 不做全站失效 | A6 / A7 场景下 `/ready` 仍 200 且 `upstream.configured === true` |

---

## 十、变更记录

| 日期 | 版本 | 变更 |
| :--- | :--- | :--- |
| 2026-10-25 | 0.1.0 | 首版：固化拓扑监控领域基准（定位、功能范围、数据实体、边界、演进）。 |
| 2026-11-05 | 0.2.0 | 按 `NMCPS-ADR-0019` 落实码前义务 1：补三页的 2.0 落点、数据源（8888 七个端点 + 8001 只读/写白名单 + 本地引擎空集）、图形形态（`TopologyCanvas` / `TrendChart` / `SparkStat`）、八种空态与降级态、8 条验收断言；`dependsOn` 增加 `NMCPS-ARCH-006`（`NMCPS-ADR-0019` 只作正文引用，Tier 2 normative 不 `dependsOn` Tier 5 记录层）。 |
