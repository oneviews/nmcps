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
version: 0.7.1
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
  - NMCPS-GOV-003
  - NMCPS-ARCH-001
  - NMCPS-ARCH-002
  - NMCPS-ARCH-006
createdAt: "2026-10-25"
updatedAt: "2026-11-06"
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

**写入口落码范围（P1-B，2026-11-06）**：`monitor` 工具栏右区只放两个**节点动作**；链路动作与运行态增删**不设入口**（画布当前只能选中节点，链路选择随 P1 开放），避免出现一个点了没反应的按钮。

| 页面入口 | 上游端点 | 前置条件 | 交互 |
| :--- | :--- | :--- | :--- |
| 重启节点 | `POST /api/network/nodes/{node_id}/restart` | 选中节点 + 该节点在仿真运行态里（`runtime-inventory` 对齐得到 `marker.simId`）+ 通道 `writeEnabled` | `UModal` 二次确认（写明仿真名与动作）→ 成功 `useToast` 提示 + 立刻 `refresh()` |
| 停止节点 | `POST /api/network/nodes/{node_id}/stop` | 同上 | 同上 |
| 链路动作 / 运行态增删 | 见上表 | 未开放（P1） | 不设按钮；开放时按同一套「能力位 → 二次确认 → 审计」口径落地 |

客户端**不猜**写权限：页面从 BFF 自己的能力探针 `GET /api/sim/channel` 读 `{ configured, writeEnabled, timeoutMs, readinessPath }`。该端点只回能力位、**不回 `baseUrl`**（不把上游地址泄露给浏览器）；`writeEnabled=false` 时按钮 `disabled` 且页面**不发**写请求——BFF 的 405 是第二道闸，不是第一道。`node_id` 取 `marker.simId`（仿真侧 id），**不用** 8888 的节点 id（前者是仿真引擎的键，后者是管理 IP）。

### 6.3 本地引擎

**本域不使用 BFF 本地引擎**（`NMCPS-ADR-0019` §5.2 未登记本域三元组）。布局计算是客户端纯函数（`app/utils/graph/*`：`topologyLayout` / `topologyLayering` / `topologyRadialLayout` / `topologyTierTreeLayout` / `topologyEdgeStyle`），输入节点与链路数组、输出坐标，不含任何状态。

### 6.4 取数约束

1. **一处出站**：8888 数据只经 `useApi()` → BFF 网关；页面不直连上游、不自建 `$fetch`。
2. **轮询**：拓扑与指标默认 30s 刷新，`document.visibilityState !== "visible"` 时暂停，恢复可见时立即补一次。
3. **时间窗**：指标页默认近 1 小时、`step` 随窗口自动选取；时间窗选择器按 `NMCPS-ARCH-006` §4.1 用「一个摘要按钮 + `UPopover`（预设列 + `UCalendar range`）」，不出现两个并排 `datetime-local`。
4. **失败分类**：`ApiError.code` 为 401 走统一刷新；`5xx` 展示错误态并保留重试；`code=0` 且 `data` 为空按空态处理，**不**渲染成错误。

### 6.5 节点趋势取数口径（A3，2026-11-06 落码）

`monitor` 详情栏的 `TrendChart` 只画**一个**序列，两步都经 BFF 网关（页面不直连上游）：

| 步骤 | 端点（8888 `/api/v1`） | 参数 | 说明 |
| :--- | :--- | :--- | :--- |
| ① 挑编码 | `GET /metric/name` | `mgmt_ip` = 选中节点的**管理 IP** | 该设备可用指标名清单（双形态，归一口径见 `NMCPS-CONTRACT-002` §七）；只排除采集器自监控命名空间（`up` / `scrape_*`），**不按名字猜类型** |
| ② 取序列 | `GET /metric/datapoint` | `mode=range` / `mgmt_ip` / `metric_code` / `from` / `to`（ISO 字符串）/ `step=60` | 近 1 小时窗口；`rate` 不传 —— 类型未定就不开速率（`NMCPS-CONTRACT-002` §6.5） |

- **取数内核**：`layers/topology/app/composables/useMetricSeries.ts`（通用的两步请求 + 目录 join + 状态 + 竞态序号）；本页的 `useNodeTrend.ts` 是它不传编码时的薄包装。解包 / 升序 / 去重 / 降采样全部落在 `app/utils/chart/metricSeries.ts` 的纯函数里（`NMCPS-CONTRACT-002` §6.6），三分类落在 `app/utils/metric/metricCatalog.ts`（`NMCPS-CONTRACT-002` §八），组件只负责画。
- **图形**：`app/components/Graph/TrendChart.vue`（SVG 折线 + 面积填充；`vector-effect` 让线宽不随拉伸变化；点数 > 2 × 列宽时按列保留 min/max，保住毛刺）。
- **本页不设选择器**：监视页只画目录判为 `numeric` 的**第一个**名字；选择器在 `device-metrics` / `link-metrics`（§6.6），同一个内核换个 `metricCode` 即可。
- **失败语义**：`code !== 0` → `UAlert` 展示上游 `message` 原文 + 重试；同一节点重取失败保留上一次序列并标「可能不是最新」；`results: []` 与「点全部非法」都走空态，**绝不画 0 值直线**。
- **类型判定**：文本 / 事件指标不进折线面板（`selectable = false`），判定顺序见 `NMCPS-CONTRACT-002` §8.3；目录不可用时退回 name-only（只跳过 `up` / `scrape_*`），此时文本指标仍可能落成直线 —— 缺口如实保留，不用命名猜测绕过去。

### 6.6 指标页取数口径（device-metrics / link-metrics，2026-11-06 落码）

两页共用一套「台账 → 选中一条 → 指标选择器 → `TrendChart`」骨架（`app/components/Layout/Split.vue` 两栏 + `useRecordSelection` 把选中记在 `?id`）：

| 页面 | 台账端点 | 选中后取数 |
| :--- | :--- | :--- |
| `device-metrics` | `GET /metric/device`（`page` / `page_size`；信封的 `total` 作计数） | `mgmt_ip` = 该设备的 `mgmt_ip` |
| `link-metrics` | `GET /metric/link`（同上） | `mgmt_ip` = 链路 **source 端设备**的 `mgmt_ip`（另取一次 `/metric/device` 建 `device_code → mgmt_ip` 映射）+ **过滤键 `ifIndex` = `identity.source.if_index`** |

- **共用内核**：`useMetricSeries(ip, { code, rate, ifIndex })` —— 目录（§6.1 列表里的 `/metric/definition`）、名字清单、序列三步一次到位；页面只把返回值绑到控件上。
- **选择器**：`USelect` 选项 = 目录里 `selectable === true` 的条目（label 取 `en_name` 再兜 `code`，后缀给 `unit`）；切换只换 `metric_code`，不重取名字清单。
- **链路时序 = source 端该端口（2026-11-06 实测改口径）**：`/metric/datapoint` 仍没有 `link_id` 维度，但实测序列**带 `ifIndex` 标签**（双 job 重复、2 个接口 × 2 job 共 4 条），因此链路页从「source 设备同名指标」升级为「source 设备**该端口**的接口序列」：传 `ifIndex = identity.source.if_index`，由 `selectMetricSeries`（`NMCPS-CONTRACT-002` §6.9）过滤 + 跨 job 取均值。三种如实标注：① 端点 `if_index` 缺失 ⇒ 只出当前值、不出折线；② 选的指标不带 `ifIndex` 标签（`sysUpTime` 这类设备级指标）⇒ 画出设备级序列并标注「这是设备级，不是端口级」；③ 该指标有端口维度、但没有这个 `if_index` 的序列 ⇒ `no_interface_series` 空态，**不拿别的端口顶替**。真正的 `link_id` 取数仍等上游。
- **速率开关**：只在目录条目 `metric_type === 'counter'` 时出现（`NMCPS-CONTRACT-002` §6.5），`rate` 由用户显式勾选、默认 `false`；`gauge` / `duration` 不显示开关、恒传 `false`。
- **空态与降级**：与 §6.5 同口径（空清单 / 无数据 / 点全部非法都是空态，绝不画 0 值直线）；目录失败只在图表卡内给一行提示，**不升级成页面级错误**。


---

## 七、图形形态

图形全部自绘（`NMCPS-ADR-0019` D1 / D2），本域只允许使用下列组件，页面不得自建 canvas 或自起 `requestAnimationFrame`。

| 组件 | 用在哪 | 载体 | 关键要求 |
| :--- | :--- | :--- | :--- |
| `TopologyCanvas` | `monitor` 主视图 | SVG（≤ 400 节点）+ 等轴投影（2.5D 观感） | 布局以纯函数注入；节点上限 400 / 链路上限 1,200，超出按权重裁剪并显示「已裁剪 N 个」；拖拽 / 缩放 / 框选命中测试由 `app/composables/useGraphInteraction.ts` 统一提供 |
| `TrendChart` | `device-metrics` / `link-metrics` 主图；`monitor` 详情栏的节点趋势 | SVG 折线 + 面积填充 | 阈值带、时间窗选区、游标读数；> 2,000 点按像素列聚合（保留极值） |
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
| 仿真平台 `allowWrite=false` | 写按钮可见但 `disabled`，hover 说明「仿真写入未开启」；即使绕过前端，BFF 亦返回 405 | `/api/sim/channel` 的 `writeEnabled === false`（客户端不猜；页面对应请求一条都不发） |
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
| A3 | 选中节点后详情栏出现该节点指标 | 点击节点 → 右栏出现 `TrendChart`，且请求 `/api/metric/datapoint` 带该节点 `mgmt_ip`（编码取自 `/metric/name` 的首个非采集器名；序列里非法采样点丢弃并计数，不补 0） |
| A4 | 空拓扑渲染空态而非空白画布 | 假上游返回 `nodes: []` → 出现空态文案，`topology-canvas` 不存在 |
| A5 | 8888 掉线降级 | 关闭假上游 → 点工具栏「刷新拓扑」→ 出现错误态 `UAlert` + 重试按钮，页面不白屏；上游恢复后点「重试」回到拓扑。**不整页 reload**：掉线时重载会让会话探测一起失败，被守卫送回登录页，断言的就不是本页的错误态了 |
| A6 | 仿真未配置时只读 | 不设 `NUXT_SIMULATOR_BASE_URL` → 拓扑正常渲染，仿真动作按钮全部 `disabled` |
| A7 | 写端点被拒 | 两层门槛，顺序固定（路径白名单 → 通道是否启用 → 写权限）：通道未配置先短路成 503 `simulator_not_configured`；通道已配置而 `allowWrite` 仍为默认 false 时返回 405 `simulator_write_disabled`，且该请求不触达上游 |
| A8 | 不做全站失效 | A6 / A7 场景下 `/ready` 仍 200 且 `upstream.configured === true` |
| A9 | 写入口二次确认 + 审计留痕 | `allowWrite: true` 的实例上：`/api/sim/channel` 回 `writeEnabled=true`、选中仿真节点后按钮可点、`UModal` 二次确认后请求**到达假仿真平台**（方法与路径原样）、成功后 `useToast` 提示并刷新；BFF 侧输出一行结构化审计日志 `{"event":"simulator.write",…}`（方法 / 模板 / 状态 / 耗时 / `x-request-id` / 客户端 IP，**不含请求体**）。`allowWrite=false` 时按钮 `disabled`、页面零写请求，且能力探针响应里不出现上游 `baseUrl` |

| A10 | 指标页台账与选择器（`device-metrics`） | 左栏渲染设备台账（行数 > 0、计数来自信封 `total`），默认选中第一条；右栏指标选择器**只列目录判为 `numeric` 的条目**（假上游把 `sys_name` 标成 `string`，选项里不得出现它） | 清单元数据 `meta_source` 为 `backend`（目录命中）；`GET /metric/definition` 只发一次 |
| A11 | 指标页出图与速率开关（`device-metrics`） | 默认指标渲染 `TrendChart`，`/api/metric/datapoint` 带该设备 `mgmt_ip` 与 `metric_code=if_in_octets`；切到 `gauge` 类指标后请求换 `metric_code` 且**不带** `rate`（`counter` 才有速率开关） | 序列里非法点丢弃并计数；空态不画 0 值直线 |
| A12 | 链路页台账与出图（`link-metrics`） | 左栏渲染链路台账（行数 > 0，当前值列来自 `/metric/link` 的 `metrics`）；选中一条后右栏出现 `TrendChart`，`/api/metric/datapoint` 带该链路 **source 端设备**的 `mgmt_ip`，折线取的是 **`metric.ifIndex === identity.source.if_index`** 的那一组（同 `ifIndex` 跨 `job` 先取均值，不与他端口混画） | `device_code → mgmt_ip` 映射来自 `/metric/device`；`if_index` 缺失 / 指标无 `ifIndex` 标签 / 零匹配三种情况按 §6.6 如实标注，不回落、不伪造 |

> **落地状态（2026-11-06）**：A1 ~ A12 已全部由 `pnpm check:ui` 断言（`scripts/check-ui.mjs` 第 11 段；A4 / A5 依赖假上游的 `__control/topology-empty` 与 `__control/down`，只在自建模式跑），自建模式实测 `153/153` 全绿。A3 由三条断言锁住：点节点后详情栏出现 `TrendChart` 且编码取自 `/metric/name` 的**首个可绘图名**（假上游故意把 `up` / `scrape_*` 排在清单最前，并把 `sys_name` 标成 `string`）、`/api/metric/datapoint` 请求带该节点 `mgmt_ip` 与 `metric_code`、序列里夹的两个非法点（空串 / `NaN`）被丢弃并计数（不补 0）。A10 ~ A12 覆盖指标页（`device-metrics` / `link-metrics`）：台账左栏行数与 `total` 一致、指标选择器只列目录判为 `numeric` 的条目（`sys_name` 不得出现）、切换指标后请求换 `metric_code`、链路页取该链路 source 端设备的 `mgmt_ip`。A7 / A9 的精确面放在「仿真通道已配置」的两个对照面里（另起带 `NUXT_SIMULATOR_BASE_URL` 的 BFF：一个 `allowWrite=false`，断言按管理 IP 对齐的「仿真中」标记真的画出来、降级条消失、写端点 405 且假仿真平台侧零写命中；一个 `NUXT_SIMULATOR_ALLOW_WRITE=true`，断言按钮可点、`UModal` 二次确认后写请求真的落到假仿真平台且路径与方法原样、成功 toast 出现）—— 只测「未配置」等于没测过通道接通。2026-11-06 另做了一次链路页的**视觉 + DOM 双通道**自查（一次性 playwright 脚本，产物留在 `/tmp`、不入库），四态实测：状态 ① 选中 `LNK-0001` 时 `data-series-if-index=101`、`data-series-count=2`，两条跨 job 序列合成一条曲线并提示「已忽略 2 个非法采样点（不补 0）」；状态 ② 切到 `cpu_util_pct` 时该属性为空、图下出现「设备级」标注；状态 ③ 把 `ifIndex=101` 的组从响应里剔掉后出现 `no_interface_series` 空态、SVG `path` 数为 0（不画 0 值线、不顶替 102 端口）；状态 ④ 选中 `LNK-0002` 时只有缺口提示、零 `/api/metric/datapoint` 请求。这次自查也暴露了一处文案自相矛盾（② 态顶部提示仍写「折线 = ifIndex=101 的接口序列」，已改为描述规则）——「面板标了设备级、页面却在断言端口级」这类冲突断言抓不到，只能靠肉眼，因此记在这里。证据不新增断言，`check:ui` 仍为 153 条。LLDP 邻接分区、告警角标、**链路动作**、真正的 `link_id` 级时序（上游暂不支持，`if_index` 级已按 §6.6 落地）同样属 P1。

---

## 十、变更记录

| 日期 | 版本 | 变更 |
| :--- | :--- | :--- |
| 2026-10-25 | 0.1.0 | 首版：固化拓扑监控领域基准（定位、功能范围、数据实体、边界、演进）。 |
| 2026-11-05 | 0.2.0 | 按 `NMCPS-ADR-0019` 落实码前义务 1：补三页的 2.0 落点、数据源（8888 七个端点 + 8001 只读/写白名单 + 本地引擎空集）、图形形态（`TopologyCanvas` / `TrendChart` / `SparkStat`）、八种空态与降级态、8 条验收断言；`dependsOn` 增加 `NMCPS-ARCH-006`（`NMCPS-ADR-0019` 只作正文引用，Tier 2 normative 不 `dependsOn` Tier 5 记录层）。 |
| 2026-11-05 | 0.3.0 | **`monitor` 页落码**（`layers/topology/app/pages/topology/monitor.vue`）：结构来自 `GET /api/topology/graph`，仿真运行态来自 8001 `runtime-inventory` / `stats`（按管理 IP 对齐后叠加虚线外环标记）；取数内核 `useTopologyMonitor()` 30s 轮询 + 页面不可见暂停，主上游失败走页面级错误、仿真通道失败只降级仿真区块。图形落 `app/components/Graph/{TopologyCanvas,SparkStat}.vue` + `app/utils/graph/{topologyNormalize,topologyLayout,topologyStatusStyle,simulatorOverlay}.ts`（纯函数）+ `app/composables/useGraphInteraction.ts`（拖拽 / 缩放，无 rAF）。§九 补落地状态：A1/A2/A4~A8 已进 `check:ui`，A3 与 LLDP / 台账 / 告警角标留 P1。 |
| 2026-11-06 | 0.4.0 | **写入口 P1-B 落码**：`monitor` 工具栏右区两个节点动作（重启 / 停止）接 `POST /api/network/nodes/{node_id}/{restart,stop}`，目标取仿真侧 `marker.simId`（不是 8888 的节点 id）；交互为 `UModal` 二次确认 + 成功 `useToast` + 立即刷新。写权限不再靠猜：新增 BFF 能力探针 `GET /api/sim/channel`（只回 `configured` / `writeEnabled` / `timeoutMs` / `readinessPath`，**不回 `baseUrl`**），`writeEnabled=false` 时按钮 `disabled` 且页面零写请求。§6.2 补写入口范围表（链路动作 / 运行态增删留 P1，**不设按钮**——不留点了没反应的死按钮）、§八 `allowWrite=false` 的判据改为能力位、§九 新增 **A9**（二次确认 + 上游实收 + 结构化审计日志 + 能力探针不泄露地址），落地状态更新为 `139/139`。 |
| 2026-11-06 | 0.5.0 | **A3 落码，A1~A9 全绿**：`monitor` 详情栏接上节点趋势 —— 选中节点 → `GET /api/metric/name`（`mgmt_ip`）挑编码（只排除 `up` / `scrape_*` 采集器命名空间，不按名字猜类型）→ `GET /api/metric/datapoint`（`mode=range`、近 1 小时、`step=60`、`rate` 不传）→ `TrendChart` 自绘折线。取数内核 `layers/topology/app/composables/useNodeTrend.ts`（含切节点清空、同节点失败保留旧序列并标 stale 的竞态处理），解包 / 升序 / 去重 / 像素降采样落在 `app/utils/chart/metricSeries.ts` 纯函数（空串显式判掉：`Number("")` 是 0，会把「没采到」画成 0 值线）；§6.5 新增取数口径与登记缺口（类型三分类需目录 join，属指标页 P1）；§七 `TrendChart` 行补本页用法；§九 A3 判据补「非法点丢弃不补 0」，落地状态改为 `142/142`（第 11 段新增三条断言）。 |
| 2026-11-06 | 0.6.0 | **指标页落码，A10~A12 随之上线**：`/metric/datapoint` 的两步取数抽成 `layers/topology/app/composables/useMetricSeries.ts`（目录 join + 名字清单 + 序列，通用内核），`useNodeTrend.ts` 收成不传编码的薄包装；类型三分类落到 `app/utils/metric/metricCatalog.ts`（判定顺序见 `NMCPS-CONTRACT-002` §八），`device-metrics` / `link-metrics` 从占位页变成真实页面（`Layout/Split.vue` 台账 + `useRecordSelection` + `USelect` 指标选择器 + `counter` 才有速率开关）。新增 §6.6 取数口径，并登记链路级时序缺口：`/metric/datapoint` 只认 `mgmt_ip`，链路页画的是 source 端设备的同名指标，链路当前值取自 `/metric/link` 的 `metrics`。`check:ui` 142 → 151 条（第 11 段 A10 ~ A12 共九条断言：台账行数 / 默认选中 / 目录只取一次 / 选择器只列 numeric / 换指标改写 `metric_code` / `gauge` 无速率开关 / 链路当前值 / source 端 IP 反查 / 缺 IP 不发请求）。 |
| 2026-11-06 | 0.7.0 | **链路折线改成「source 端该端口」并清掉「`results` 恒一条」的错误假设**：直连上游实测 `/metric/datapoint` 的 `range` 返回带 `ifIndex` 标签的多条序列（同设备可能被 2 个 job 重复采集），据此 §6.6 把链路页的口径从「source 设备同名指标」改为「`metric.ifIndex === identity.source.if_index` 的接口序列」（跨 job 逐时间戳取均值，规则见 `NMCPS-CONTRACT-002` §6.9）；三种情况如实标注：`if_index` 缺失不出折线、指标无 `ifIndex` 标签时标为设备级、零匹配走 `no_interface_series` 空态不回落。A12 的判据同步收紧，`check:ui` 151 → 153 条（新增「折线命中 source 端 `ifIndex`」与「设备级指标如实标注」两条断言，假上游改为双 `ifIndex` × 双 `job`）。 |
| 2026-11-06 | 0.7.1 | **链路页视觉自查留痕，并修掉一处提示与面板互相矛盾的文案**：一次性 playwright 脚本（不入库）逐态截图 + DOM 抓取，四态实测写进 §九「落地状态」（端口组键 `101`、2 条跨 job 序列合成 1 条、设备级标注、零匹配空态 `path=0`、缺 IP 零请求）；② 态发现页面顶部仍断言「折线 = ifIndex=101 的接口序列」而面板已标「设备级」，遂把 `portBody`（cn / en）改成描述规则 —— 端口级指标取该端口序列，所选指标本身是设备级时图下另行标注。判据与断言数不变。 |
