---
docId: NMCPS-GOV-003
title: "文档地图与权威索引（Doc Map）"
navigation:
  title: "文档地图"
description: "全仓文档列表的唯一权威（SSOT）：每篇文档的 docId / tier / authority / scope / status 只在本页维护，其余文档一律引用本页。"
excerpt: "全仓文档列表的唯一权威：docId、tier、authority、scope、status 只在此维护。"
keywords:
  - "doc-map"
  - "索引"
  - "权威"
  - "index"
tier: 0
authority: normative
scope:
  - gov.doc-index
status: baseline
version: 0.32.0
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
createdAt: "2026-10-24"
updatedAt: "2026-11-01"
icon: "carbon:list"
tags:
  - "文档体系"
  - "索引"
  - "权威"
  - "Doc Map"
---

# 文档地图与权威索引（NMCPS-GOV-003）

> **本文职责（SSOT）**：全仓文档列表的唯一权威——每篇文档的 `docId`、层级（tier）、`authority`、`scope`、`status` **只在本页维护**，其余文档一律引用本页，不再各自维护清单。
> **不承载**：提案理由、冲突清单、迁移计划（这些属各篇文档自身）。
> **目标读者**：全体工程师 / AI 助手。

---

## 一、使用规则

1. **找依据**：先看 §三 你的问题属于哪个域 → 打开该域的**唯一权威**（同一 scope 只有一个 `normative`）。
2. **改设计**：改代码前先改对应 Tier 的基准文档；改 Tier 0~1 须先记一条 ADR（Tier 5）。
3. **引用**：低层引用高层即可；高层不在正文引用低层；Tier 5（记录层）永不作依据。
4. **冲突裁决顺序**：代码 / 生成契约 > Tier 0 > 1 > 2 > 3 > 4；Tier 5 不参与。

---

## 二、层级定义（Tier 0~5）

> 权威定义见 `NMCPS-GOV-001`（文档体系章程）§二。此处仅列速查。

| Tier | 名称 | 变化频率 |
| :---: | :--- | :--- |
| 0 | 治理/宪章层 | 极低（变更须 ADR） |
| 1 | 架构层 | 低 |
| 2 | 领域基准层 | 中 |
| 3 | 契约/参考层 | 中 |
| 4 | 作业层 | 高 |
| 5 | 记录层 | 只追加 + supersede |

---

## 三、域级文档地图（每域唯一权威）

> 判定键是 `scope`：同一 scope 只允许一个 `normative`。

| 域 / 主题 | Tier | 唯一权威（docId） | 状态 |
| :--- | :---: | :--- | :--- |
| `gov.doc-system` | 0 | NMCPS-GOV-001 | baseline |
| `gov.doc-index` | 0 | NMCPS-GOV-003 | baseline |
| `arch.transport` | 1 | NMCPS-ARCH-001 | baseline |
| `arch.datasource` | 1 | NMCPS-ARCH-002 | baseline |
| `arch.iam` | 1 | NMCPS-ARCH-003 | baseline |
| `arch.content` | 1 | NMCPS-ARCH-004 | baseline |
| `arch.platform` | 1 | NMCPS-ARCH-005 | baseline |
| `arch.ui` | 1 | NMCPS-ARCH-006 | baseline |
| `domain.topology` | 2 | NMCPS-DESIGN-001 | baseline |
| `domain.spectrum` | 2 | NMCPS-DESIGN-002 | baseline |
| `domain.transmission` | 2 | NMCPS-DESIGN-003 | baseline |
| `domain.device` | 2 | NMCPS-DESIGN-004 | baseline |
| `domain.system` | 2 | NMCPS-DESIGN-005 | baseline |
| `domain.scenario` | 2 | NMCPS-DESIGN-006 | baseline |
| `domain.dashboard` | 2 | NMCPS-DESIGN-007 | baseline |
| `contract.shared-types` | 3 | NMCPS-CONTRACT-001 | baseline |
| `contract.metrics` | 3 | NMCPS-CONTRACT-002 | baseline |

**预留域（待建）**：暂无。

---

## 四、文档总表

| docId | 文档 | tier | authority | scope | status | 路径 |
| :--- | :--- | :---: | :---: | :--- | :---: | :--- |
| NMCPS-GOV-001 | 文档体系章程 | 0 | normative | gov.doc-system | baseline | architecture/0.governance/doc-system-charter.md |
| NMCPS-GOV-003 | 文档地图 | 0 | normative | gov.doc-index | baseline | architecture/0.governance/doc-map.md |
| NMCPS-ADR-0001 | 模块改名 | 5 | informative | rec.adr.0001 | baseline | records/adr/adr-0001.md |
| NMCPS-ADR-0002 | 路由中英文命名规范 | 5 | informative | rec.adr.0002 | baseline | records/adr/adr-0002.md |
| NMCPS-ADR-0003 | 路由排序规范 | 5 | informative | rec.adr.0003 | baseline | records/adr/adr-0003.md |
| NMCPS-ADR-0004 | 权威金字塔落地 | 5 | informative | rec.adr.0004 | baseline | records/adr/adr-0004.md |
| NMCPS-ADR-0005 | 双语镜像与接入 | 5 | informative | rec.adr.0005 | baseline | records/adr/adr-0005.md |
| NMCPS-ADR-0006 | 桌面端自动更新入口 | 5 | informative | rec.adr.0006 | baseline | records/adr/adr-0006.md |
| NMCPS-ADR-0007 | Nitro BFF 网关 | 5 | informative | rec.adr.0007 | baseline | records/adr/adr-0007.md |
| NMCPS-ADR-0008 | 下载落地页恢复 | 5 | informative | rec.adr.0008 | superseded | records/adr/adr-0008.md |
| NMCPS-ADR-0009 | 会话与令牌模型 | 5 | informative | rec.adr.0009 | superseded | records/adr/adr-0009.md |
| NMCPS-ADR-0010 | 就绪探针与 SSE 透传 | 5 | informative | rec.adr.0010 | baseline | records/adr/adr-0010.md |
| NMCPS-ADR-0011 | 认证接口对接与令牌轮换 | 5 | informative | rec.adr.0011 | baseline | records/adr/adr-0011.md |
| NMCPS-ADR-0012 | 新增 platform 分层 | 5 | informative | rec.adr.0012 | baseline | records/adr/adr-0012.md |
| NMCPS-ADR-0013 | 登录页命名与种子预填 | 5 | informative | rec.adr.0013 | baseline | records/adr/adr-0013.md |
| NMCPS-ADR-0014 | 强制改密页命名 | 5 | informative | rec.adr.0014 | baseline | records/adr/adr-0014.md |
| NMCPS-ADR-0015 | 平台能力探针化 | 5 | informative | rec.adr.0015 | baseline | records/adr/adr-0015.md |
| NMCPS-ADR-0016 | 移除下载落地页 | 5 | informative | rec.adr.0016 | baseline | records/adr/adr-0016.md |
| NMCPS-ADR-0017 | 数据表单交互基准 | 5 | informative | rec.adr.0017 | baseline | records/adr/adr-0017.md |
| NMCPS-REC-001 | 上游 auth 缺陷清单 | 5 | informative | rec.defects.auth | baseline | records/defects/auth-upstream-defects.md |
| NMCPS-REC-002 | 上游 account 缺陷清单 | 5 | informative | rec.defects.account | baseline | records/defects/account-upstream-defects.md |
| NMCPS-ARCH-001 | 通信面架构 | 1 | normative | arch.transport | baseline | architecture/1.architecture/transport-architecture.md |
| NMCPS-ARCH-002 | 数据源架构 | 1 | normative | arch.datasource | baseline | architecture/1.architecture/datasource-architecture.md |
| NMCPS-ARCH-003 | IAM 架构 | 1 | normative | arch.iam | baseline | architecture/1.architecture/iam-architecture.md |
| NMCPS-ARCH-004 | 内容中心架构 | 1 | normative | arch.content | baseline | architecture/1.architecture/content-center-architecture.md |
| NMCPS-ARCH-005 | 平台能力架构 | 1 | normative | arch.platform | baseline | architecture/1.architecture/platform-architecture.md |
| NMCPS-ARCH-006 | UI 交互架构 | 1 | normative | arch.ui | baseline | architecture/1.architecture/ui-architecture.md |
| NMCPS-DESIGN-001 | 拓扑监控领域基准 | 2 | normative | domain.topology | baseline | architecture/2.domain/topology.md |
| NMCPS-DESIGN-002 | 频谱管控领域基准 | 2 | normative | domain.spectrum | baseline | architecture/2.domain/spectrum.md |
| NMCPS-DESIGN-003 | 传输管控领域基准 | 2 | normative | domain.transmission | baseline | architecture/2.domain/transmission.md |
| NMCPS-DESIGN-004 | 设备组网领域基准 | 2 | normative | domain.device | baseline | architecture/2.domain/device.md |
| NMCPS-DESIGN-005 | 系统管理领域基准 | 2 | normative | domain.system | baseline | architecture/2.domain/system.md |
| NMCPS-DESIGN-006 | 场景建模领域基准 | 2 | normative | domain.scenario | baseline | architecture/2.domain/scenario.md |
| NMCPS-DESIGN-007 | 仪表盘领域基准 | 2 | normative | domain.dashboard | baseline | architecture/2.domain/dashboard.md |
| NMCPS-CONTRACT-001 | 共享类型契约 | 3 | normative | contract.shared-types | baseline | architecture/3.contract/shared-types.md |
| NMCPS-CONTRACT-002 | 指标契约 | 3 | normative | contract.metrics | baseline | architecture/3.contract/metrics.md |

> 路径为相对 `layers/content/collections/cn/` 的相对路径；`en/` 为镜像集合，docId 一致。

---

## 五、变更记录

| 日期 | 版本 | 变更 |
| :--- | :--- | :--- |
| 2026-10-24 | 0.1.0 | 首版：登记 GOV-001、GOV-003，定义域级地图骨架与预留域。 |
| 2026-10-24 | 0.2.0 | 登记首批记录层 ADR：0001 模块改名 / 0002 命名规范 / 0003 排序（Tier 5，informative）。 |
| 2026-10-24 | 0.3.0 | 登记 S1 架构层：ARCH-004 内容中心架构（Tier 1，normative）。 |
| 2026-10-25 | 0.4.0 | 登记 S1 架构层：ARCH-001 通信面 / ARCH-002 数据源 / ARCH-003 IAM（Tier 1，normative）。 |
| 2026-10-25 | 0.5.0 | 登记 S2 领域基准：DESIGN-001~007（topology / spectrum / transmission / device / system / scenario / dashboard，Tier 2，normative）。 |
| 2026-10-25 | 0.6.0 | 登记 S3 契约层：CONTRACT-001 共享类型 / CONTRACT-002 指标契约（Tier 3，normative）。 |
| 2026-10-25 | 0.7.0 | 登记记录层 ADR：0004 权威金字塔落地 / 0005 en 双语镜像与接入（Tier 5，informative）。 |
| 2026-10-25 | 0.8.0 | Tier 0~3 全部推进为 baseline（评审通过，authority 正式生效）。 |
| 2026-10-28 | 0.9.0 | 登记记录层 ADR：0006 桌面端自动更新入口（Tier 5，informative）。 |
| 2026-10-28 | 0.10.0 | 登记记录层 ADR：0007 启用 Nitro BFF 网关与 server/shared 目录（Tier 5，informative）。 |
| 2026-10-29 | 0.11.0 | 登记记录层 ADR：0008 恢复站点下载落地页与首页入口（Tier 5，informative）。 |
| 2026-10-30 | 0.12.0 | 登记记录层 ADR：0010 BFF 上游就绪探针与 SSE 流式透传（Tier 5，informative；0009 由 ADR-0008 预留给会话/令牌模型）。 |
| 2026-10-30 | 0.13.0 | 登记记录层 ADR：0009 会话与令牌模型（Tier 5，informative；清空 ADR-0008 预留位）。 |
| 2026-10-31 | 0.14.0 | 登记记录层 ADR：0011 认证接口对接与令牌轮换（Tier 5，informative）；0009 登记 `supersededBy` 并置为 superseded。 |
| 2026-10-31 | 0.15.0 | 登记记录层 ADR：0012 新增 platform 分层（Tauri 平台能力演示页归入 `layers/platform`，路由 path 不变）。 |
| 2026-10-31 | 0.16.0 | 登记记录层 ADR：0013 登录页命名统一为 `login` 与演示种子账号预填（Tier 5，informative）。 |
| 2026-10-31 | 0.17.0 | 登记记录层缺陷清单：REC-001 上游 `/api/v1/auth` 缺陷与仓库内漂移（6 项上游 + 3 项已修，Tier 5，informative）。 |
| 2026-10-31 | 0.18.0 | 登记记录层 ADR：0014 强制改密页命名为 `change-password`（`reset` 留给忘记口令流程，Tier 5，informative）。 |
| 2026-10-31 | 0.19.0 | 登记 S1 架构层：ARCH-005 平台能力架构（`arch.platform`，Tier 1，normative：能力矩阵 / 权限分层 / 探针口径）与记录层 ADR-0015 平台能力探针化（删 `commands` 与 `shell:allow-execute`，Tier 5，informative）。 |
| 2026-10-31 | 0.20.0 | 登记记录层 ADR：0016 移除根路径下载落地页并把它迁入系统管理的「下载中心」（`/` 302 到登录页、`/system/download` 需登录，取代 ADR-0008，Tier 5，informative）。 |
| 2026-11-01 | 0.21.0 | 登记记录层缺陷清单：REC-002 上游 `/api/v1/account` 缺陷与对 `/system/user` 落码的边界（6 项缺陷，Tier 5，informative）；同步 DESIGN-005 升 0.3.0（新增第六节用户管理落码基准）。 |
| 2026-11-01 | 0.22.0 | 登记 S1 架构层：ARCH-006 UI 交互架构（`arch.ui`，Tier 1，normative：四布局矩阵 / 三段式分栏与容器查询收敛 / 工具栏左右语义 / 记录级面包屑与 `?id` 契约）与记录层 ADR-0017 数据表单交互基准（废弃 `usePageToolbar` 模块级通道，工具栏改 Teleport 注入，Tier 5，informative）。 |
| 2026-11-01 | 0.23.0 | ARCH-006 升到 0.2.0、ADR-0017 补齐基准细则（依据 1.0 的 `connector/device.vue` 与 `system/user.vue`）：每栏尺寸与可拖拽三条、详情栏 `view/edit/create` 三态与切换守卫、列表行规范与默认选中同源、关联栏与四类反馈、工具栏由「页级一层」升级为 **L0 页级 / L1 面板级两级** 并给出动作归属三问与 49px 固定高度；同步 §6 反模式与 §7 验收（新增行内动作上限、视图态守卫、默认选中、分隔条持久化四条断言，待随 §5 步骤在 `check:ui` 落地）。 |
| 2026-11-01 | 0.24.0 | **ARCH-006 → 0.2.1，ADR-0017 追加 §7.1**：数据表单页由三段式收敛为两栏（左栏列表 / 右栏详情），关联数据改为右栏内固定分区，形态只剩「两栏 / 覆盖式」两种；新增最小页面宽度常量（`--page-min-w` 20rem、两栏门槛 `--split-min-w` 56rem = 左栏上限 24rem + 右栏下限 32rem、右栏 ≥ 32rem），判据改为「`isMobile` 或容器 < 56rem → 覆盖式」，历史行为改按形态而非设备，工具栏高度改读 `--app-toolbar-h` 且覆盖式只渲染一层；同时修正两处失实描述（`check:ui` 未覆盖四模式切换；`usePageToolbar` 在 `ssr: false` 下不存在跨请求共享）。 |
| 2026-11-01 | 0.25.0 | **ARCH-006 → 0.2.2（机制层落地回填）**：§3.3 把 definite height 链改为按现状描述（内容容器 `flex min-h-0 flex-1 flex-col` + 内层 `data-layout-scroll` 滚动容器；页面根 `flex-1 min-h-0` 是分栏页的显式选择），并记录「两种模式的工具栏都在滚动容器之外 ⇒ `--content-sticky-top` 恒为 0」；`--app-toolbar-h` 成为工具栏高度唯一来源，删除 `usePageToolbar`（0 命中）改由 `#app-toolbar-left` / `#app-toolbar-right` 挂载点承接 L0 注入；新增 `Layout/Split.vue` + `usePaneResize`，已在 320 / 768 / 1024 / 1366 / 1440 / 1920 六档实测两档形态、无横向滚动、拖拽 18–28rem、双击复位 22rem、刷新保持。 |
| 2026-11-01 | 0.26.0 | **ARCH-006 → 0.2.3（选择 URL 契约落码）**：§5.2 补实现说明 —— `useRecordSelection`（`app/composables/useRecordSelection.ts`）统一读写 `?id`（命中判定只在当前 `rows`、`?id` 不进列表请求键、两栏 `replace` / 覆盖式 `push`、默认选中由 `autoSelect` + 同源 `defaultRecord` 开启且只执行一次、覆盖式不默认选中）；记录段走 `useRecordContext`（`app/composables/useRecordContext.ts`），`AppToolbar` 在面包屑末位渲染成按钮（点击 = 清除选择）。`/system/user` 已接入该契约（行可聚焦 + 选中高亮 + `?id` 不在 rows 时提示与清除、且不额外请求），两栏形态与默认选中随迁移步骤 4 开启，§7 的 `check:ui` 用例仍待补。 |
| 2026-11-01 | 0.27.0 | **ARCH-006 → 0.2.4（`/system/user` 两栏落码回填）**：§7 第 1、2、4、6、9 行由 `check:ui` 覆盖（六档宽度形态、320px 无横向溢出、覆盖式 `push` + 返回、深链命中、`?id` 不在 `rows` 零详情请求、`?id=new` 内联建号、两栏默认选中），假上游补账号域三个端点；面包屑用例改为显式待补。补登此前遗漏的本条变更。 |
| 2026-11-01 | 0.28.0 | **ARCH-006 → 0.2.5，ADR-0017 追加 §7.2（工具栏收敛为单层 + 左右分区）**：撤销 0.2.0 的 L0 / L1 两级分层 —— 内容页预留的 `AppToolbar` 是唯一一层，集合域动作进 `#app-toolbar-left`、记录域 / 提交域 / 主 CTA 进 `#app-toolbar-right`，栏内不再起 header（`Layout/Split.vue` 去掉 `#list-toolbar` / `#detail-toolbar` 与自带返回行）；覆盖式与两栏共用这一层并按当前面板切换内容，记录标题下沉到右栏内容区顶部，「返回」由页面注入左区；`AppToolbar` 改用 `MutationObserver` 观测两个挂载点判空，无动作且非 `topbar` 模式时整条收成 0 高。`check:ui` 增至 83 项（新增「无动作页整条收起」「预留工具栏承载动作」「只有一层工具栏」「覆盖式跟随面板」）。 |
| 2026-11-01 | 0.29.0 | **ARCH-006 → 0.2.6（工具栏左右内边距与内容对齐）**：§4.1 新增一条规范 —— 工具栏左右各 `px-3`（12px），与栏内 `p-3`、页面级 Alert 的 `mx-3` 同坐标，左区首个动作与左栏内容左缘齐、右区主 CTA 与右栏内容右缘齐；`UDashboardToolbar` 根内边距一并清零（`px-0 sm:px-0`，只写 `px-0` 会被默认 `sm:px-6` 在 ≥640px 再叠 24px），并禁用 `UHeader` 的 `px-4 sm:px-6 lg:px-8`（工具栏在内容盒内，`lg` 档 32px 与内容错位 20px）。§7 新增第 12 行验收，`check:ui` 增至 84 项（实测左右各 12px、列表行首内容 14px）。 |
| 2026-11-01 | 0.30.0 | **ARCH-006 → 0.2.7（工具栏改为单一渲染点，修「侧栏模式下动作全丢」）**：`default.vue` 原先按模式写了两处 `<AppToolbar>`（大屏模式在滚动容器内、其余模式在外），切模式时旧挂载点被销毁重建，页面 `Teleport` 的内容留在已脱离文档的子树里（实测侧栏模式 `leftKids=0`、h=0）。改为全模式只渲染一次且位于滚动容器之外；§4.3 新增「单一渲染点」规则，§3.3 措辞同步；§7 新增第 13 行，`check:ui` 增至 85 项（切「侧栏」后断言动作仍在）。 |

| 2026-11-01 | 0.31.0 | **ARCH-006 → 0.2.8（`topbar` 模式补 `check:ui` 用例）**：§7 第 5 行「面包屑记录段」由待补转已覆盖（1920 视口切「顶栏」→ `[系统管理 / 用户管理 / Alice]`，点记录段去掉 `?id`）；新增第 14 行验收「工具栏与页头对齐的是限宽容器（同为 `left=240` / `width=1440`），内边距各保持 12px / 32px、20px 差为有意保留」，§4.1 同步写明该口径；`check:ui` 85 → 88 项。 |
| 2026-11-01 | 0.32.0 | **ARCH-006 → 0.2.9（无动作页的三模式收起口径）**：§4.4 补 `mobile` 与 `bigscreen` 同口径、`topbar` 不收起（面包屑常驻，左区 0 子节点，判空为 `!isTopbarMode && !hasPageActions`）；§7 新增第 15 行（`/dashboard/overview`：大屏 `h=0` / 顶栏 `h=49` / 手机 `h=0`），`check:ui` 88 → 90 项。 |
