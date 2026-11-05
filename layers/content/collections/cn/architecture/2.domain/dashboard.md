---
docId: NMCPS-DESIGN-007
title: "仪表盘领域基准"
description: "仪表盘域（domain.dashboard）的 Tier 2 设计基准：系统总览、智能体助手、Kubernetes 监控与大屏呈现，含四个子页的目标页清单与数据源、自研图形形态、空态与降级态、可断言的验收口径。本文是 domain.dashboard 域的唯一权威。"
excerpt: "系统总览、智能体助手、Kubernetes 监控与大屏呈现的领域设计基准（含数据源、图形形态、空态与验收断言）。"
keywords:
  - "dashboard"
  - "仪表盘"
  - "大屏"
  - "领域基准"
  - "SparkStat"
  - "TopologyCanvas"
tier: 2
authority: normative
scope:
  - domain.dashboard
status: baseline
version: 0.2.0
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
  - NMCPS-GOV-003
  - NMCPS-ARCH-002
  - NMCPS-ARCH-006
  - NMCPS-DESIGN-001
createdAt: "2026-10-25"
updatedAt: "2026-11-05"
icon: "carbon:dashboard"
tags:
  - "领域基准"
  - "仪表盘"
  - "大屏"
---

# 仪表盘领域基准（NMCPS-DESIGN-007）

> **本文职责**：`domain.dashboard` 域的唯一权威，定义仪表盘——系统总览、智能体助手、Kubernetes 监控与大屏呈现，以及四个子页的目标页清单、数据源、图形形态、空态降级与验收断言。数据消费见 `NMCPS-ARCH-002`，页面结构与工具栏口径见 `NMCPS-ARCH-006`，拓扑图形与数据源来自 `NMCPS-DESIGN-001`，图形自绘与第二数据源的裁决见 `NMCPS-ADR-0019`（layers/content/collections/cn/records/adr/adr-0019.md）。
> **目标读者**：实施工程师 / AI 助手。

---

## 一、定位

仪表盘是网络管理系统的「呈现面」：聚合各域状态，提供系统总览、智能体交互、云原生资源监控与指挥大屏。**它不生产数据**——所有卡片都是别的域已有数据的只读重组，因此页面不得新增取数通道，也不得自带缓存层。

---

## 二、功能范围

| 子页面 | 功能 | 2.0 落点 |
| :--- | :--- | :--- |
| overview | 系统总览（数字驾驶舱，只读） | `layers/dashboard/app/pages/dashboard/overview.vue` |
| agent | 智能体助手 | `layers/dashboard/app/pages/dashboard/agent.vue` |
| kubernetes | Kubernetes 资源监控（外嵌控制台） | `layers/dashboard/app/pages/dashboard/kubernetes.vue` |
| screen | 指挥大屏（2.5D 主画面 + 浮卡） | `layers/dashboard/app/pages/dashboard/screen.vue` |

四个页面**共用一套取数内核**：`overview` 与 `screen` 读同一批 `metric` / `topology` / `alarm` 数据，只差排版密度与轮询间隔（`overview` 30s、`screen` 60s）。1.0 的大屏页就是这么做的——复用同一个拓扑 composable，**零新增 BFF 路由、零新增取数通道**；2.0 沿用此约束。

---

## 三、关键数据实体

| 实体 | 说明 |
| :--- | :--- |
| 总览指标（Overview） | 跨域聚合的摘要指标 |
| 智能体会话（Agent） | 人机交互上下文 |
| 集群资源（K8s） | 云原生资源状态 |

---

## 四、领域边界与依赖

- **上游依赖**：跨域聚合数据（见 `NMCPS-ARCH-002`）。
- **消费方**：终端用户（唯一聚合入口）。
- **不承载**：各域原始数据（由各域 `domain.*` 提供）。

---

## 五、演进路线

1. 系统总览（跨域指标聚合）。
2. 智能体助手（自然语言运维交互）。
3. Kubernetes 监控与指挥大屏。

---

## 六、数据源

### 6.1 主数据源（8888 统一网关，经 BFF `[...slug]` 网关，需登录态）

| 用途 | 端点（8888 `/api/v1`） | 关键参数 | 备注 |
| :--- | :--- | :--- | :--- |
| 总网计数（顶部统计卡） | `GET /metric/device`、`GET /metric/link` | `page` / `page_size` / `status` / `role` / `medium` | 用分页信封的 `total` 做分母，不拉全量列表 |
| 节点 / 链路指标（图卡） | `GET /metric/datapoint` | `mode` / `mgmt_ip` / `metric_code` / `from` / `to` / `step` / `rate` / `ips` / `codes` | 总览与拓扑页共用同一批 `metric_code`，口径归 `NMCPS-CONTRACT-002` |
| 可用指标名 | `GET /metric/name` | `mgmt_ip` / `ips` | 决定设备卡能选哪些指标，避免猜编码 |
| 全网拓扑（中列 / 大屏主画面） | `GET /topology/graph` | `tenant_id` / `include_virtual` / `include_status` / `group_by` | 实测 36 节点 / 48 链路 / 3 组合；图形形态归 `NMCPS-DESIGN-001` |
| 告警摘要（右列 / 浮卡） | `GET /alarm/alarm-events` | `severity` / `status` / `target_type` / `target_id` / `first_triggered_at_from` / `first_triggered_at_to` | 只读计数与最近若干条，不做确认 / 关闭动作（属 system 域） |
| 设备台账（设备卡上下文） | `GET /asset/device` | `page` / `page_size` / 设备标识 | `snmp_*_pass` 由 BFF 出口掩码（`NMCPS-ADR-0018` D7），页面不得缓存明文 |
| 频道占用（总览第三行） | `GET /frequency/wifi/aps`、`/state`、`/scan` | 见 spectrum 域 | 组件由 `domain.spectrum` 提供，本域只做排版，不改其取数 |

### 6.2 明确不使用的端点

| 端点 | 实测状态 | 结论 |
| :--- | :--- | :--- |
| `GET /dashboard/dashboards`、`/widgets`、`/widget-bindings` | 空列表（`list: null, total: 0`） | **不用于承载 2.0 页面结构**。卡片布局写在页面代码里（可版本化、可评审），不依赖一个空的上游配置库；待上游有真实看板数据后再评估「用户自定义看板」为独立能力 |
| `/ai/**` | 8888 无该命名空间（仅剩旧代资源名兜底） | **一期不接**。智能体助手保留页面与空态，不伪造响应；接入方式另立 ADR |

### 6.3 本地引擎

**本域不使用 BFF 本地引擎**（`NMCPS-ADR-0019` §5.2 未登记本域三元组）。所有聚合都是前端 `computed`。

### 6.4 取数约束

1. **零新增通道**：`overview` / `screen` 必须复用拓扑与指标 composable，不得为「大屏」单开一个 BFF 路由（1.0 的硬约束，2.0 继承）。
2. **轮询**：`overview` 30s、`screen` 60s；页面不可见时暂停，恢复时补一次。
3. **单飞**：同屏多张卡片请求同一端点时按参数合并，避免 N 张卡打 N 次上游。
4. **只读**：本域不发任何 `POST` / `PUT` / `PATCH` / `DELETE`；`/dashboard/**` 的写在 2.0 一期全部不下发。

---

## 七、图形形态

自绘组件（`NMCPS-ADR-0019` D1），本域只允许下列形态：

| 组件 | 用在哪 | 载体 | 关键要求 |
| :--- | :--- | :--- | :--- |
| `SparkStat` | 总览顶部 5 张总网统计卡、大屏浮卡读数 | SVG | 单值 + 迷你趋势 + 状态色；无数据时显示「—」而非 `0` |
| `TrendChart` | 节点 / 链路遥测图卡、频道占用趋势 | SVG | 与 `NMCPS-DESIGN-001` 同一组件、同一取数；不在本域复制一份图表实现 |
| `TopologyCanvas` | 总览中列全网拓扑、大屏 2.5D 主画面 | SVG + 等轴投影 | **只读模式**（无写动作按钮）；布局仍走纯函数，大屏可切分层 / 径向 |
| `FloatingCard`（2.5D 浮卡） | 大屏节点 / 链路详情卡 | HTML + 磨砂玻璃 | 同一时刻**只开一张**；点空白关闭并清选中 |
| 外嵌 iframe | `kubernetes` 页 | iframe | 地址由 `runtimeConfig.public.kubernetesUiUrl` 下发，页面零硬编码；须带尾斜杠（否则 307 降级为 `http:` 被混合内容拦截）；`referrerpolicy="no-referrer"`；高度链 `flex-1` + `min-h-0`，整页不滚动 |

- **密度差异只靠排版**：大屏与总览使用同一批组件，仅字号、间距、卡片数量不同；不出现「大屏专用图表」。
- **动效**：大屏可保留入场过渡，但必须响应 `prefers-reduced-motion`，且不跑常驻 `rAF`。
- **配色**：状态色来自 `app.config.ts` 语义色；大屏的深色 HUD 皮肤只覆盖表面 token，不改语义。

---

## 八、空态与降级态

| 场景 | 表现 | 判定依据 |
| :--- | :--- | :--- |
| 总览指标为空 | 卡片显示占位「—」+ 卡片内「无采集数据」；同屏其余卡片正常 | `datapoint` 返回空 matrix 且无错误 |
| 拓扑为空 | 中列 / 大屏出空态插画 + 「当前租户下暂无拓扑数据」，**不**渲染空白画布 | `data.nodes.length === 0` |
| 8888 未配置 / 不可达 | 页级 `UAlert`（错误）+ 重试；导航与其他域不受影响 | `/ready` 的 `upstream.configured === false` 或请求 `5xx` |
| 部分卡片失败 | **局部**错误占位，不整页红；失败的卡片单独提供重试 | 单请求失败而其余成功 |
| 告警接口空（无告警） | 显示「暂无告警」，与「取数失败」用不同视觉 | `total === 0` 且 `code === 0` |
| 大屏无 WebGL / 低性能设备 | 降级为 SVG 主画面（同一组件不同 `renderer` 参数），并提示「已切换为兼容渲染」 | 能力探测失败 |
| `kubernetesUiUrl` 未配置 | **不渲染空 iframe**，改用空态说明「云原生控制台地址未配置」 | `public.kubernetesUiUrl` 为空 |
| 智能体未接入 | 空态说明「智能体尚未接入」+ 不可发送；**不**伪造回复、不显示假会话 | 一期无上游 |

**硬性要求**：本域是「聚合呈现」，任何单元失败都只能降级自身那块；把单卡失败升级成整页错误，或把空数据画成 `0`，均视为缺陷。

---

## 九、验收断言

`check:ui` 落地时逐条断言（未实现项随 P1 补齐，不得先标「已通过」）：

| # | 断言 | 判据 |
| :---: | :--- | :--- |
| B1 | 四个页面可路由且标题来自 i18n | `dashboard-{overview,agent,kubernetes,screen}` 各在 `i18n/locales/*.json` 出现一次；页面无硬编码 CJK |
| B2 | 总览渲染统计卡与拓扑 | `[data-testid="spark-stat"]` ≥ 1，`[data-testid="topology-canvas"]` 存在且为只读（无写动作按钮） |
| B3 | 大屏与总览共用取数 | 两页请求的端点集合相同（`/api/metric/*`、`/api/topology/graph`、`/api/alarm/alarm-events`），大屏不出现额外 BFF 路由 |
| B4 | 空指标不算 0 | 假上游返回空 matrix → 卡片文本为「—」，且不出现 `0` 作为该指标读数 |
| B5 | 局部失败不整页红 | 令 `/api/alarm/alarm-events` 返回 500 → 仅告警卡出错误占位，统计卡与拓扑仍正常 |
| B6 | 8888 掉线降级 | 关闭假上游 → 页级 `UAlert` + 重试，页面不白屏 |
| B7 | 外嵌地址未配置不渲染 iframe | `NUXT_PUBLIC_KUBERNETES_UI_URL` 为空 → 页面无 `<iframe>`，出现「地址未配置」空态 |
| B8 | 智能体不伪造 | 未接上游时发送按钮不可用，DOM 中不存在伪造的助手消息节点 |
| B9 | 只读 | 全程不出现 `POST`/`PUT`/`PATCH`/`DELETE` 请求（`/api/iam/refresh` 之外） |

---

## 十、变更记录

| 日期 | 版本 | 变更 |
| :--- | :--- | :--- |
| 2026-10-25 | 0.1.0 | 首版：固化仪表盘领域基准（定位、功能范围、数据实体、边界、演进）。 |
| 2026-11-05 | 0.2.0 | 按 `NMCPS-ADR-0019` 落实码前义务 1：补四页的 2.0 落点与「共用一套取数内核」约束、数据源（七个 8888 端点 + 明确不使用的 `/dashboard/**` 与 `/ai/**`）、图形形态（`SparkStat` / `TrendChart` / `TopologyCanvas` / `FloatingCard` / 外嵌 iframe）、八种空态降级、九条验收断言；`dependsOn` 增加 `NMCPS-ARCH-006`、`NMCPS-DESIGN-001`（`NMCPS-ADR-0019` 只作正文引用，Tier 2 normative 不 `dependsOn` Tier 5 记录层）。 |
