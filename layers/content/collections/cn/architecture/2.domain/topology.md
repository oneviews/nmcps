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
version: 0.15.2
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
  - NMCPS-GOV-003
  - NMCPS-ARCH-001
  - NMCPS-ARCH-002
  - NMCPS-ARCH-006
createdAt: "2026-10-25"
updatedAt: "2026-11-07"
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

1.0 的 `monitor` 顶栏有两组视图控件：一个「2D 布局」下拉（六项 `radial` / `dagre` / `tree` / `force` / `grid` / `circular`，默认 `radial`），紧挨着一组径向扇旋转控件（滑块 −90°~90°、步进 ±5°、复位回默认 25°）。2.0 本轮复刻**三种布局 + 旋转控件**，几何算法从 1.0 同名库**逐行搬入**：

| 布局键（下拉文案见 `layouts.*`） | 几何 | 落点 | 与 1.0 的差异 |
| :--- | :--- | :--- | :--- |
| `layered`（默认） | 分层网格：`tier` 分带（1 顶 → 4 底），带内按 `id` 等距铺开 | `app/utils/graph/topologyLayout.ts` | 1.0 的 `dagre` 靠 G6 布局引擎 + 隐藏锚点钉层；2.0 无引擎，用**等价的分带网格**（读向同为自上而下） |
| `radial` | tier 楔形扇：圆心 = 最小 tier（半径 0）、`r(t) = (t − apex)/span · R` 等分半径、逐档张角（tier4 65°、tier2/3 75°、其余 60°）以「正左」为中心、档内按父分组 + 组间留白 + 组内重心排序、默认逆时针 25° | `app/utils/graph/topologyRadialLayout.ts`（1.0 几何库逐行搬入） | 无。1.0 的显式参数能力（`stretch: 'auto'` / `sweepDeg: 360` 整圆 / `barycenterOrder` A/B）一并保留，页面只开默认值 |
| `tree` | 层级树居中分层：每层一条水平线、整层以画布中心等距铺开、同层次序 = 父层重心 | `app/utils/graph/topologyTierTreeLayout.ts`（1.0 几何库逐行搬入） | 无 |
| `force` / `grid` / `circular` | —— | **未落** | 三者都是 1.0 借 G6 内置引擎（`d3-force` / `grid` / `circular`）实现的；2.0 图形自绘（`NMCPS-ADR-0019` D1）没有布局引擎，复刻需自写力导向 ⇒ **登记为未复刻项，下拉里不出现这些假选项** |

- **旋转语义**：视觉逆时针为正，范围 −90°~90°、步进 5°，默认 `RADIAL_ROTATE_DEG = 25`（1.0 v0.30 用户裁决值）；只旋转整张扇面、圆心不动，逐档张角 / 等分半径 / 组内等间隔全部保持。
- **控件的出现条件**：旋转控件只在 `radial` 布局下**渲染**，其余布局**整块不出现**（不是「渲染但置灰」—— 置灰的滑块等于暗示「拖了会有区别」，而其它布局根本不读这个角度）。
- **裁剪与布局的关系**：先按「tier + id」裁到 400 节点 / 1,200 链路，再交给布局函数；三种布局吃的是**同一份裁剪结果**，切换布局不会改变「裁掉了哪些」，画布角标的数字在任何布局下都相同。
- **控件位置**：布局下拉在页面工具栏左区（集合域动作，是「看哪一层」的唯一入口）；旋转控件浮在画布右上角（只对画布生效，且避免与页头仿真写入口抢位，`NMCPS-ARCH-006` §4.1）。
- **画布尺寸**：`radial` / `tree` 的坐标按逻辑视口 1000×660 计算（`TOPOLOGY_CANVAS_WIDTH` / `TOPOLOGY_CANVAS_HEIGHT`），内容比视口小时整体居中、比视口大时 `viewBox` 跟着长大 —— 后者由几何库的 `bbox` 决定，页面不猜。

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
- **「恢复默认配置」三合一**（按钮在画布左下角，`data-testid="topology-reset-view"`）：清位移 → 旋转角回 `RADIAL_ROTATE_DEG` → 视口复位（缩放 100% / 平移归零）。三项任一不为默认时按钮可点，三项都在默认值时 `disabled` 并提示「没有可复位的改动」——「点了没反应」和「本来就没得复位」是两件事。
- **落在画布左下角而不是顶栏**：它只作用于这张画布；顶栏左区留给「刷新 + 布局」两个集合域动作，不再加第三枚常驻控件（`NMCPS-ARCH-006` §4.1）。
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
- **区域分组折叠（A29）**：`combos` 抬成读模型（`flattenTopologyCombo()`：`data.label` / `data.children` / `data.counts` → `label` / `children` / `counts`），详情栏出「区域分组」卡：组名、上游自报的分层计数（`distro` / `access` / `terminal`，词表里有就翻、没有就原样给）、「画布可见 / 上游声明」成员数、折叠开关与「全部展开」。折叠**只改视图输入**（`collapsedCombos`）：布局先滤掉该组节点，挂在上面的连线随之消失（端点在画布外的边画不出来）、画布角标写「已收起 N 台（M 组）」；**组计数一个字都不变** —— 它是上游自报的事实，不是画布统计。折叠 / 展开与切布局同一条理由清空位移层（成员变了，带内位置就变了）。
- **无线事实卡（A30）**：节点带 Wi-Fi 字段时出「无线」卡（`band` / `channel` / `dbm` / `clients` / `util` / `ssid` / `tx_power`，读表 `wifiFactsOf()`）。七项全空 ⇒ 返回 `null` ⇒ **不画这块**：画一排「—」等于宣称「这台 AP 的 SSID 取不到」，而它根本不是 AP。与链路利用率不同，节点 `util` 的 `0` 是可信真值（节点口径不带「未计算」语义）。
- **2.5D 仍不靠上游坐标**：`style` 已证明是「每层单行」的预置示意图，2.5D 要的层内多行 + z 轴错位只能由 `layoutTopology()` 产出；复用 `style` 只会得到「一行更宽的伪 3D」，与 §6.8 的几何口径冲突。画布现有的「2.5D 观感」来自等轴投影样式（§七），与上游坐标无关。

---

## 七、图形形态

图形全部自绘（`NMCPS-ADR-0019` D1 / D2），本域只允许使用下列组件，页面不得自建 canvas 或自起 `requestAnimationFrame`。

| 组件 | 用在哪 | 载体 | 关键要求 |
| :--- | :--- | :--- | :--- |
| `TopologyCanvas` | `monitor` 主视图 | SVG（≤ 400 节点）+ 等轴投影（2.5D 观感） | 布局以纯函数注入；节点上限 400 / 链路上限 1,200，超出按权重裁剪并显示「已裁剪 N 个」；拖拽 / 缩放 / 框选命中测试由 `app/composables/useGraphInteraction.ts` 统一提供；节点手动拖拽的**位移增量**由 `app/utils/graph/topologyNodeOffsets.ts` 记账并在渲染前合成（§6.9） |
| `TrendChart` | `device-metrics` / `link-metrics` 主图；`monitor` 详情栏的节点趋势 | SVG 折线 + 面积填充 | 阈值带、时间窗选区、游标读数；> 2,000 点按像素列聚合（保留极值） |
| `SparkStat` | 页面头部与详情栏的小卡片 | SVG | 单值 + 迷你趋势 + 状态色，替代 1.0 里分散的 unovis 迷你图 |

- **状态色**：节点 / 链路状态色来自 `app.config.ts` 的语义色，禁止硬编码 hex。
- **2.5D 观感的来源**：等轴投影是画布**样式**（椭圆基底 / 斜切连线 / 阴影），几何仍只来自 `layoutTopology()`；不读上游 `style.x|y`（§6.11 已证它是「每层单行」的示意图，`x` 跨 120 ~ 4520，复用得先缩放再裁切，画出来仍是扁平一行）。
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
| 仿真平台未配置 | **页面正常只读**：拓扑、指标照常展示；仿真控制按钮组整体 `disabled` 并带提示「仿真控制未启用」 | `runtimeConfig.simulator.baseUrl` 为空 |
| 仿真平台 `allowWrite=false` | 写按钮可见但 `disabled`，hover 说明「仿真写入未开启」；即使绕过前端，BFF 亦返回 405 | `/api/sim/channel` 的 `writeEnabled === false`（客户端不猜；页面对应请求一条都不发） |
| 仿真平台不可达 | 局部降级：只读部分保留，仿真标记与 LLDP 分区显示「仿真平台不可达」；**不得**让 `/ready` 变红 | 通道请求超时 / 连接失败 |
| 裁剪触发 | 画布内角标「已裁剪 N 个节点 / M 条链路」，并给出「切到分层/径向视图减少裁剪」的提示 | 节点 > 400 或链路 > 1,200 |
| 上游形状与读模型不一致（节点 / 链路带 `data` 外壳） | **不退化**：拍平在取数边界完成，布局 / 详情栏 / 画布照常出数（分层仍按 `tier` 分行、名称取 `data.deviceName`、事实取 `data.cpu` 等）；拍平缺失时的表现为「一条水平线 + 名称退化成 IP + 详情全『—』」，属缺陷而不是降级态 | `normalizeTopologyGraph()` 在 `loadGraph()` 调用；§6.10 / `check:ui` A27 |
| 指标台账加载失败（`/metric/device` / `/metric/link`） | 左栏只出一条 `UAlert`（标题 i18n + 上游原话）+ 重试；**不**同时渲染空态文案，计数改「设备数 / 链路数未知（台账加载失败）」而不是「共 0 台」；右栏若挂着 `?id`，提示改「台账加载失败，无法确认这台设备」而不是「不在当前分页结果内」 | `useMetricLedger` 的 `error` 非空（如 `bff_upstream_unreachable`）；`check:ui` A19 / A20 |

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
| A13 | 指标取数失败不降级成空态（`TrendPanel` 共用面板） | 上游回 HTTP 200 + `code !== 0` 时出现 `[data-testid="metric-trend-error"]`，描述文字**等于上游 `message` 原文**、带「重试」按钮，且页面上不出现「该时间窗内无采集数据」、图表容器不渲染；上游恢复后点「重试」真的取到数据（错误态消失、折线回来） | 假上游 `__control/metric-error` 造信封失败（不是网络错误，后者走 `__control/down` 的 stale 分支）；`check:ui` 中两条断言，对应 `NMCPS-CONTRACT-002` §6.7 的 S3 |
| A14 | 设备页复用同一面板时语义一致（`device-metrics`） | 选中一台设备后，上游 `code !== 0` 同样只出 `[data-testid="metric-trend-error"]`（原话逐字 + 重试），页面无「该时间窗内无采集数据」、图表容器不渲染 | `check:ui` 一条断言；同一 `MetricTrendPanel`，防的是「换页时语义漂移」 |
| A15 | 监控页详情栏语义一致（`monitor`，经 `useNodeTrend` 薄封装） | 选中节点后，`code !== 0` 只出 `[data-testid="trend-error"]`（原话逐字 + 重试），`trend-chart` 不渲染 | 薄封装不能再把失败漏回图表；`check:ui` 一条断言 |
| A16 | 同设备重取遇**网络错误**时保留旧折线并标 stale | 先成功出图（`data-series-count` 非空），上游掉线后点「刷新指标」：错误提示出现、折线仍在且序列数不变、页面出现「指标通道暂时不可用」 | 走 `__control/down`（网络错误，`bff_upstream_unreachable`），与 A13/A14/A15 的信封失败是两条不同的路；`check:ui` 一条断言 |
| A17 | 目录失败不阻塞出图、也不冒充取数失败（§8.4 的第三种失败） | 让假上游对 `/metric/definition` 回 HTTP 200 + `code !== 0`：出现 `[data-testid="metric-catalog-degraded"]`（含「只按名字判断类型」）、`trend-chart` 照常渲染且 `data-series-count` 非空、**不出现** `[data-testid="metric-trend-error"]`、目录的失败原话一个字都不上页面 | 失败在「类型判定依据」而不是取数：名字清单与序列都还好，所以既不许降级成空态，也不许把目录原话当成取数失败展示；假上游 `__control/catalog-error` 造样本，`check:ui` 一条断言，对应 `NMCPS-CONTRACT-002` §8.5 的 S5 |
| A18 | 降级的**后果**如实暴露（选择器退化为只按名字判断） | 同一目录失败态下打开指标选择器：选项只剩编码（`if_in_octets` / `cpu_util_pct` / `sys_name`，`en_name` 随目录一起消失），且 `sys_name` 这种目录里标 `string` 的文本指标**真的混进选项** | 断言「提示不是装饰」：如果选择器依旧干净还带显示名，说明目录其实没失败、A17 的降级是假象；`check:ui` 一条断言 |
| A19 | 台账失败不冒充空态（`device-metrics`） | 上游掉线后进 `?id=DEV-CORE-1`：左栏出现「加载设备台账失败」+ 上游原话 + 重试，页面**不出现**「当前租户下没有设备事实」、**不出现**「共 0 台设备」，右栏**不出现**「不在当前分页结果内」（改为「无法确认这台设备」） | 走 `__control/down`；本行补的是 2026-11-06 视觉自查里肉眼发现、当时所有断言都没覆盖的一处矛盾（`NMCPS-ARCH-006` §3.4） |
| A20 | 台账失败不冒充空态（`link-metrics`，`?id=LNK-0001`） | 同 A19 的三条否定判据，外加左栏错误提示与重试按钮在场 | 两页共用同一套列表/详情模板，只钉一页等于没钉 |
| A21 | 节点详情事实层照 1.0 口径出数（`monitor`） | 选中 `10.0.0.1`（假上游把 `cpu` / `memory` / `interfaces` / `traffic` 全给了）：`topology-fact-cpu` 为 `21.5%`、`memory` 为 `48%`、`interfaces` 为 `24`、`neighbors` 为 `2`、`traffic` 以 `12.5` 开头，并列出 2 行邻居 | 「复刻 1.0 详情栏」的最小可证面；`check:ui` 一条断言 |
| A22 | 上游没给的事实写「—」而不是 0 | 选中一个指标字段都不给的节点：`cpu` / `memory` / `interfaces` / `traffic` 四格**全为「—」**，且进度条元素数为 **0**（不画空条） | 空进度条会被读成 0%，所以「不渲染」本身也在断言里（`NMCPS-CONTRACT-002` §6.3） |
| A23 | 1.0 的 `-1` 哨兵按未知处理，真实 0 与旧 Kbps 字段照实归一 | 选中 `cpu: -1` / `memory: -1` / `interfaces: 0` / `trafficTotalKbps: 1500` 的节点：CPU 与内存为「—」，接口数为 `0`，流量以 `1.5`（Mbps）开头 | 三种口径必须分开判：哨兵当未知、`0` 当真实值、Kbps 归一为 Mbps |
| A24 | 三种布局可切换且**真的换了坐标** | 下拉依次切 `径向扇` → `层级树` → `分层`：`[data-testid="topology-layout-switcher"]` 的 `data-layout` 依次为 `radial` / `tree` / `layered`；三种布局的节点坐标两两不同；切回 `分层` 与初始坐标**逐点相等**；`树` 的每层均值都等于画布中心（500 ± 1）、两种新布局的节点都不越 `viewBox` | 断言的是几何而不是「点了没报错」：`tree` 的每层居中由几何库的数学性质保证（§6.8），坐标比对见 `check:ui` 第 11 段 |
| A25 | 径向扇旋转：只在 `radial` 出现、步进 +5°、复位回 25° | `layered` 下 `[data-testid="topology-rotate"]` **不存在**；切到 `radial` 后角度徽标为 `25°`、点一次逆时针步进变 `30°` 且节点坐标变化、点复位回 `25°` 且坐标与未旋转时**逐点相等**；切回 `layered` 控件再次消失 | 「渲染但置灰」不算过：控件的不存在本身在判定里（§6.8） |
| A26 | 节点拖拽位移保持 + 「恢复默认配置」三合一复位 | 在 `radial` 下按住节点圆心拖 (+90, +50) 像素：**只有被拖的那一台**坐标变化，`[data-testid="topology-reset-view"]` 的 `data-offsets` 由 `0` 变 `1` 且按钮可点；点工具栏刷新（一次完整重渲染）后坐标**逐点不变**（不弹回几何位）；再叠一次缩放（`125%`）与 +5° 旋转后点复位：角度回 `25°`、缩放回 `100%`、`data-offsets` 回 `0`、坐标与拖拽前**逐点相等**、按钮重新 `disabled`；再拖一次后切 `层级树`：`data-offsets` 归 `0` 且按钮复位为 `disabled`（切布局清位移） | 位移层与几何层分离的直接后果（§6.9）：「拖完保持」与「一键收回」必须同时成立，只断言其一等于没测；`check:ui` 一条断言 |
| A27 | 两层形状（`data` 嵌套）拍平后仍是正常拓扑，且与扁平形状**逐点一致** | 假上游默认回现网形状（`control.topologyNested` 初值 true），`__control/topology-nested` + 整页重载后：分层布局 `data-layout=layered`、6 台节点落在 4 行（`cy` = `70,220,370,520`，即 `PADDING_Y + BAND_HEIGHT × (tier − 1)`）、节点名取自 `data.deviceName`（不是管理 IP）、选中 `10.0.0.1` 后 `topology-fact-cpu` = `21.5%`、`interfaces` = `24`；再 `__control/topology-flat` 切回扁平本体重载，读到的每个节点坐标必须与两层形状**完全相同** | 2026-11-07 用户反馈「页面没看到变化」的真因：不拍平则 `tier` 全落空 ⇒ 36 个节点排成一条水平线；坐标落点钉住「tier → 分带」的映射，`flatSame` 再钉「形状不影响结果」，`check:ui` 一条断言 |
| A28 | 点链路出事实卡，利用率四项写「未计算」 | 点 `10.0.0.1 → 10.0.0.2` 那条连线（假上游把 `medium` / `relation` / `admin_status` / `telemetry` 全给齐）：`topology-link-card` 出现且读数 = `fiber` / `optical` / `up` / `enabled` / `1 Gbps` / `12.5 Mbps` / `16.18 Mbps`，四格利用率（`util-in` / `util-out` / `packet-loss` / `error-rate`）**全是「未计算」**，卡片所有事实格里不出现 `0%`，画布 `<title>` 也含「未计算」 | 现网 48/48 链路这四项实测全 0 而流量非零（§6.11）⇒ 0 是「没算」；`cells` 全量扫描钉住「任何一格都不得把没算的写成 0%」 |
| A29 | 折叠区域分组后画布摘掉成员与挂边，组计数不变 | `combo-edge` 折叠：节点 6 → 3、连线 6 → 2（挂在该组上的 4 条随之消失）、角标写「已收起 3 台（1 组）」、`topology-groups-expand` 出现，且 `topology-group-counts-combo-edge` 文本**折叠前后逐字相同**；点「全部展开」复原到 6 / 6、角标消失 | `counts` 是上游自报的分层计数而不是画布统计，折叠只改视图输入（`collapsedCombos`）—— 计数跟着画布变就等于把「上游说了什么」改写了 |
| A30 | 无线事实卡：AP 七项照实，非 AP 不画 | 选中 `10.0.0.4`（AP）：`topology-wifi-card` 出现且七项 = `NMCPS-Lab` / `5G` / `149` / `-52 dBm` / `12` / `34%` / `20 dBm`；选中 `10.0.0.1`（核心路由器）：卡片**不出现** | 现网 27/36 节点带 Wi-Fi 字段（§6.11）；七项全空的节点画一排「—」等于宣称「这台 AP 的 SSID 取不到」，因此整块不画 |

> **落地状态（2026-11-07）**：A1 ~ A30 已全部由 `pnpm check:ui` 断言（`scripts/check-ui.mjs` 第 11 段；A4 / A5 依赖假上游的 `__control/topology-empty` 与 `__control/down`，只在自建模式跑），自建模式实测 `172/172` 全绿。0.15.2 按 §6.11 的取证落成三条只读事实：A28 点链路出事实卡（基础事实 + 双向流量照实，四个利用率维度写「未计算」，`cells` 全量扫描保证一格都不出 `0%`，画布 `<title>` 与卡片同一份读表）、A29 折叠区域分组（画布摘掉该组 3 台与挂在上面的 4 条边，而 `counts` 折叠前后逐字相同、「全部展开」复原 6 / 6）、A30 无线事实卡（AP 七项照实，非 AP 不画）。**假上游默认就回现网的两层形状**（`nestTopologyGraph()`，`control.topologyNested` 初值 true），A21 ~ A26 因此全部跑在两层形状上；A27 再切 `__control/topology-flat` 证明「形状不影响渲染结果」（`flatSame=true`）—— 这是 0.15.1 补的口径：0.15.0 时默认仍是扁平样本，只有 A27 一条发现得了形状缺口，其余用例其实还站在「比现网干净」的样本上。A27 补的是 2026-11-07 现场排查出来的**形状缺口**（§6.10）：现网节点 / 链路是 `{ id, data: { … }, style, combo }` 的两层形状，2.0 的读模型却按扁平字段取值 ⇒ `tier` 全部落空 ⇒ 分层布局把 36 个节点排成一条水平线（实测 `rows = 1`），名称退化成管理 IP、状态全 `unknown`、详情栏全写「—」。修法是把「线格式 → 读模型」的拍平收成纯函数（`flattenTopologyNode()` / `flattenTopologyLink()` / `normalizeTopologyGraph()`），只在 `useTopologyMonitor.loadGraph()` 调用一次；A27 用与现网同形的假上游样本钉住「6 台 4 行、`cy` 落在分带公式上、名称与 CPU 取自 `data`、扁平形状渲染逐点一致」。**这处缺口此前没有任何断言覆盖**，原因是假上游一直回扁平形状（自检样本比真上游「干净」），代价是页面看起来「功能都在、图却是错的」。A26 复刻 1.0 v0.36 的「拖拽位移保持 + 恢复默认配置」（§6.9）：位移是叠在几何之上的**增量层**（`app/utils/graph/topologyNodeOffsets.ts`，不可变写入 + `0.5px` 抖动容差），断言四条同时成立 —— 只有被拖的那一台动、刷新重渲染后不弹回、三合一复位把位移 / 旋转角 / 缩放一起归零且坐标逐点复原、切布局时位移随几何基准清空；位移表的持有者是页面（`useTopologyMonitor()`），画布只做「几何 + 增量」合成，`check:ui` 用真指针（pointerdown → 6 步 pointermove → pointerup）拖拽，而不是直接改状态。A24 / A25 复刻 1.0 顶栏的「2D 布局」下拉与径向扇旋转控件（§6.8）：几何算法从 1.0 的 `topologyRadialLayout` / `topologyTierTreeLayout` 逐行搬入 `app/utils/graph/`，`layoutTopology()` 按 `mode` 分派、三种布局共用同一份裁剪结果；A24 断言三种布局两两不同坐标、切回分层逐点复原、层级树每层均值 = 画布中心、节点不越 `viewBox`，A25 断言旋转控件只在 `radial` 渲染、步进 +5° 改坐标、复位回默认 25° 且坐标复原。面板高度与画布一次**视觉自查**（一次性 playwright 脚本，产物留在 `/tmp/qa-layouts`、不入库）确认：三态下画布无内部滚动，旋转控件浮在画布右上角且不与裁剪角标重叠。A21 ~ A23 复刻 1.0 详情栏的事实层（CPU / 内存进度条 + 接口·邻居·流量 KPI + 邻居列表），三条断言分别钉「已知值照上游」「未知写『—』且不画空进度条」「`-1` 哨兵当未知、真实 `0` 照写、Kbps 归一为 Mbps」——口径见 §6.7，实现见 `app/utils/graph/topologyNodeFacts.ts`。A3 由三条断言锁住：点节点后详情栏出现 `TrendChart` 且编码取自 `/metric/name` 的**首个可绘图名**（假上游故意把 `up` / `scrape_*` 排在清单最前，并把 `sys_name` 标成 `string`）、`/api/metric/datapoint` 请求带该节点 `mgmt_ip` 与 `metric_code`、序列里夹的两个非法点（空串 / `NaN`）被丢弃并计数（不补 0）。A10 ~ A12 覆盖指标页（`device-metrics` / `link-metrics`）：台账左栏行数与 `total` 一致、指标选择器只列目录判为 `numeric` 的条目（`sys_name` 不得出现）、切换指标后请求换 `metric_code`、链路页取该链路 source 端设备的 `mgmt_ip`。A7 / A9 的精确面放在「仿真通道已配置」的两个对照面里（另起带 `NUXT_SIMULATOR_BASE_URL` 的 BFF：一个 `allowWrite=false`，断言按管理 IP 对齐的「仿真中」标记真的画出来、降级条消失、写端点 405 且假仿真平台侧零写命中；一个 `NUXT_SIMULATOR_ALLOW_WRITE=true`，断言按钮可点、`UModal` 二次确认后写请求真的落到假仿真平台且路径与方法原样、成功 toast 出现）—— 只测「未配置」等于没测过通道接通。2026-11-06 另做了一次链路页的**视觉 + DOM 双通道**自查（一次性 playwright 脚本，产物留在 `/tmp`、不入库），四态实测：状态 ① 选中 `LNK-0001` 时 `data-series-if-index=101`、`data-series-count=2`，两条跨 job 序列合成一条曲线并提示「已忽略 2 个非法采样点（不补 0）」；状态 ② 切到 `cpu_util_pct` 时该属性为空、图下出现「设备级」标注；状态 ③ 把 `ifIndex=101` 的组从响应里剔掉后出现 `no_interface_series` 空态、SVG `path` 数为 0（不画 0 值线、不顶替 102 端口）；状态 ④ 选中 `LNK-0002` 时只有缺口提示、零 `/api/metric/datapoint` 请求。这次自查也暴露了一处文案自相矛盾（② 态顶部提示仍写「折线 = ifIndex=101 的接口序列」，已改为描述规则）——「面板标了设备级、页面却在断言端口级」这类冲突断言抓不到，只能靠肉眼，因此记在这里。证据本身不新增断言；随后补的 A13（信封失败逐字展示 + 重试，两条断言）把计数推到 `155/155`，也顺手清掉「错误提示旁边还挂着『该时间窗内无采集数据』」这对矛盾。紧接着的 A14 ~ A16 把同一语义补齐到另外两个入口（设备页 / 监控页详情栏），并把 `__control/down` 的 stale 分支也钉住（折线保留、序列数不变、出「指标通道暂时不可用」），计数到 `160/160`。随后的 A17 / A18 把**第三种失败**也钉住 —— 目录失败（`__control/catalog-error` 让 `/metric/definition` 回 HTTP 200 + `code !== 0`）：图表照常出、只多一句「指标目录不可用」、目录原话一个字节不上屏、`metric-trend-error` 不出现；降级的**后果**同样断言到（选择器只剩编码、`sys_name` 这种文本指标混进选项），计数到 `160/160`。设备页随即照同一套方法自查（五态 + 台账失败态，产物同样留在 `/tmp`）：① 正常态 `data-series-count=2` / `data-series-if-index=101` / 速率开关在场；② 切 `cpu_util_pct` 后该属性为空、速率开关消失；③ 信封失败（`__control/metric-error`）逐字给出「指标库查询超时（tsdb: query timeout after 30s）」+ 重试，手上还有旧序列所以折线保留并带 stale 一行；④ `__control/down` 下 `bff_upstream_unreachable` + 折线保留（与 A16 一致）；⑤ 目录失败下图表 `series=2` 照常、选择器只剩 `if_in_octets`（与 A17 / A18 一致）。第六态查出**四处互相打架**：台账掉线时左栏「加载设备台账失败」旁边还挂着「当前租户下没有设备事实」、页脚写「共 0 台设备」，右栏把「没加载出来」讲成「该设备不在当前分页结果内」。修法是让「失败」不再冒充「没有」：空态与错误互斥、计数改「设备数未知（台账加载失败）」、`?id` 提示改「台账加载失败，无法确认这台设备」（规则写进 `NMCPS-ARCH-006` §3.4，§八同步一行），并新增 A19 / A20 把两页的否定判据钉住，计数到 `162/162`。LLDP 邻接分区、告警角标、**链路动作**、真正的 `link_id` 级时序（上游暂不支持，`if_index` 级已按 §6.6 落地）同样属 P1。

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
