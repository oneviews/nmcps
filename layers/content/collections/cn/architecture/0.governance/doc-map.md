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
version: 0.39.23
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
createdAt: "2026-10-24"
updatedAt: "2026-11-04"
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
| NMCPS-ADR-0018 | 后端代际切换 | 5 | informative | rec.adr.0018 | baseline | records/adr/adr-0018.md |
| NMCPS-REC-001 | 上游 auth 缺陷清单 | 5 | informative | rec.defects.auth | superseded | records/defects/auth-upstream-defects.md |
| NMCPS-REC-002 | 上游 account 缺陷清单 | 5 | informative | rec.defects.account | superseded | records/defects/account-upstream-defects.md |
| NMCPS-REC-003 | 上游 policy 缺陷清单 | 5 | informative | rec.defects.policy | superseded | records/defects/policy-upstream-defects.md |
| NMCPS-REC-004 | 上游 audit 缺陷清单 | 5 | informative | rec.defects.audit | superseded | records/defects/audit-upstream-defects.md |
| NMCPS-REC-005 | 上游 iam 策略与授权缺陷清单 | 5 | informative | rec.defects.iam-policy | baseline | records/defects/iam-policy-upstream-defects.md |
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
| 2026-11-01 | 0.33.0 | **ARCH-006 → 0.2.10（面包屑路由段的结构）**：§5.1 新增「父段链接落点是默认子页（`defaultChildPath()`，不是无页面的 `m.path`）」；§7 新增第 16 行（`/system/user`：`[系统管理(a → /system/user) / 用户管理(span)]`，选中记录后末位加 `Alice(button)` 且前两段不变），`check:ui` 90 → 92 项（`/system/user` 18 → 20 项）。 |
| 2026-11-01 | 0.34.0 | 登记记录层缺陷清单：REC-003 上游 `/api/v1/{role,permission,abac,access}` 缺陷与对 `/system/policy`、`/system/permission` 落码的边界（10 项缺陷：无生命周期端点 / DSL 不校验 / 回读无 `effect` / 入参与过滤残缺 / 等级越权与越界 / 试算忽略上下文 / 账号↔角色只写不读 / 超管被域拒绝 / 内置角色三码 / 时区不一致，Tier 5，informative）；同步 DESIGN-005 升 0.4.0（新增第七节 `/system/policy` 与第八节 `/system/permission` 落码基准，原变更记录顺延为第九节）。 |
| 2026-11-01 | 0.35.0 | **ARCH-006 → 0.2.11 与 DESIGN-005 → 0.4.1（口径说明 Alert 下移到详情栏顶部）**：三页（`/system/user`、`/system/policy`、`/system/permission`）页根的身份 / 范围说明横幅（`mx-3 mt-3`）改到 `#detail` 顶部（`px-4 pt-4`），未选中空态由 `h-full` 改 `flex-1`、详情栏内层用 `flex min-h-full flex-col` 承接（不再撑出滚动条）；ARCH-006 §3.7 的反馈分工与 §4.1 的对齐规则同步收窄（内容页不再有页面级 Alert），DESIGN-005 §7.3 / §8.3 的客户端收敛条目点明该位置。`check:ui` 仍为 92/92。 |
| 2026-11-02 | 0.36.0 | 登记记录层缺陷清单：REC-004 上游 `/api/v1/audit` 缺陷与对 `/system/log` 落码的边界（9 项缺陷：租户数据范围未文档化且失效令牌与越权同码 / `category` 大小写敏感且未知值静默忽略 / 未知查询参数被忽略且 `pageSize` 无稳定上限 / 时间参数双格式且非法值不报错 / `verify` 是写操作且断点是整链序号 / 导出缺必填回 `500` / 导出无详情与删除端点 / 导出列表时区偏移 8 小时 / 详情快照字段恒为空，Tier 5，informative）；同步 DESIGN-005 升 0.5.0（新增第九节 `/system/log` 审计日志落码基准，原变更记录顺延为第十节）。 |
| 2026-11-02 | 0.36.1 | **DESIGN-005 → 0.5.1（`/system/permission` 授权矩阵改两列）**：左列资源类（`resourceType` ≠ `4`）、右列接口类（`4`）。接口点在目录里占大头（24 条中 15 条），混排会把「单设备 / 指标 / MIB / 告警」压到底部；列序固定、窄容器自动堆叠（`repeat(auto-fit, minmax(17rem, 1fr))`，接口列仍第二）、空列留一行灰字。 |
| 2026-11-02 | 0.36.2 | `NMCPS-ARCH-006` → 0.2.12（§3.7 右栏内「字段 + 只读分区」并排的例外、§3.2 宽度口径）、`NMCPS-DESIGN-005` → 0.5.2（§8.3 授权矩阵回单列并右移到详情栏右侧）。 |
| 2026-11-02 | 0.36.3 | `NMCPS-ARCH-006` → 0.2.13（§3.7 右栏等分两列、铺满容器；§3.2 去掉并排形态的 `max-w` 上限）、`NMCPS-DESIGN-005` → 0.5.3（§8.3 详情栏等分两列 + 矩阵内部恢复资源类 / 接口类两列）。 |
| 2026-11-02 | 0.36.4 | `NMCPS-ARCH-006` → 0.2.14（§4.1 新增「左区常驻筛选控件预算」与「不自造控件：只用 Nuxt UI v4 原生组件」两条）、`NMCPS-DESIGN-005` → 0.5.4（§9.3 第 2 条：时间范围与类别常驻工具栏左区，其余标识类筛选留浮层）。 |
| 2026-11-02 | 0.36.5 | `NMCPS-ARCH-006` → 0.2.15（§4.1 补时间区间浮层的落码位置与两条实测口径：日历容器不能写 `w-0 flex-1`、整日窗口必须 `00:00:00` … `23:59:59`；§7 第 17 行断言 7 → 8，总数 99 → 100）、`NMCPS-DESIGN-005` → 0.5.5（§9.3 第 2 条：时间范围浮层改为快捷项列 + 双月日历 + 到秒补手）。 |
| 2026-11-03 | 0.36.6 | `NMCPS-ARCH-006` → 0.2.16（§3.6 选中行底色由 `bg-elevated/60` 改为 `bg-accented` 并记下两模式实测原因；新增 §3.8「列表栏尾部：计数 / 每页条数 / 分页」：高度读 `--app-list-footer-h`、每页默认 15、选项 15·30·50·100 且四页统一、窄栏收敛顺序、`/system/policy` 客户端分页只切渲染层；§7 第 17 行去掉「每页条数」并新增第 18 行三条断言，总数 100 → 103）、`NMCPS-DESIGN-005` → 0.5.6（§7.3 第 3 条补客户端分页口径、§9.2 的 `pageSize` 选项改为 15 / 30 / 50 / 100、§9.3 第 2 条把每页条数移出筛选浮层、第 6 条补尾部断言）。 |
| 2026-11-03 | 0.36.7 | `NMCPS-ARCH-006` → 0.2.17（§7 新增第 19 行：建号等级候选 = 严格低于会话等级且 ≤ 3，并落 2 条 `check:ui`；总数 103 → 105）、`NMCPS-DESIGN-005` → 0.5.7（§6.1 建号补「超级管理员需 `tenantId`」与 `GET /tenant`；§6.2 等级语义改为 0/1/2–3/4 四档；§6.3 矩阵按 2026-11-03 复测重写并列客户端收敛两条；§6.4 补 `20102` / `20103`；§6.5 标 `UP-ACC-01` 闭环并新增 `UP-ACC-07` / `UP-ACC-08`）、`NMCPS-REC-002` 复测更新（`UP-ACC-01` 标已闭环，新增 `UP-ACC-07` 建号 `tenantId` 必填与 `UP-ACC-08` 的 `L4` 归属服务账号，缺陷数 6 → 8，附复测命令）。 |
| 2026-11-04 | 0.37.0 | 登记记录层 ADR：`NMCPS-ADR-0018` 后端代际切换（旧代 go-zero 网关退役，BFF 唯一上游改 `http://192.168.1.55:8888/api/v1`；10 条实测证据、4 张字段映射表、10 个能力缺口、13 个影响文件；局部作废 ADR-0011 的刷新轮换条款，Tier 5，informative）；`NMCPS-REC-001~004` 置 `superseded` 并补 `supersededBy: NMCPS-ADR-0018` 与文首代际说明（探测对象为已退役旧代）；新增 Tier 4 作业单 `documents/3.operations/backend-generation-migration.md`（逐文件 diff 草案 / `check:bff` 假上游改造点 / 验收与回滚，非受治理文档）。 |
| 2026-11-04 | 0.38.0 | 登记记录层缺陷清单：`NMCPS-REC-005` 新代 `iam/{roles,policies,role-policies,subject-roles}` 缺陷（10 项：无授权校验 / 系统对象可删 / `enabled` 写入无效 / 400 回原始 SQL / 删除失败用 200 承载 / 过滤残缺且分页无上限 / 必填校验缺失 / `tenant_id` 入参被忽略 / 跨租户授权无拦 / 孤儿关系行，Tier 5，informative，`baseline`）；同步 `NMCPS-DESIGN-005` 升 0.8.0（§7 / §8 按新代 `iam` 命名空间重写：策略 CRUD + 角色 CRUD + `role-policies` 授权 + `subject-roles` 授受，ABAC 段 / 试算 / 权限点目录随 G4 / G5 / G3 退役，失败改按 HTTP 形态分派）、`NMCPS-ARCH-006` 升 0.2.20（§3.8 撤销 `/system/policy` 客户端分页例外）。 |
| 2026-11-04 | 0.39.0 | `NMCPS-ARCH-006` → 0.2.21（§7 补第 20 / 21 行：`/system/policy` 与 `/system/permission` 的契约面断言，`check:ui` 106 → 116）、`NMCPS-DESIGN-005` → 0.8.1（§8.1 补「`GET /iam/subject-roles` 只认 `subject_id`，按角色反查在前端做」这条实测约束，并记 C4c-1 / C4c-2 验收：`check:bff` 106/106、`check:ui` 116/116）。 |
| 2026-11-04 | 0.39.1 | `NMCPS-ARCH-006` → 0.2.22（§7 补第 22 行「文案与数据的分界」：界面文案只来自 `i18n/locales/{cn,en}.json`、模板不写死中文，上游数据按原值渲染不做本地化映射；正文写明「英文界面出现中文 = 数据问题」的判定顺序）。配套新增 `pnpm check:i18n`（九组断言：键集合一致 / en 值不含中文 / 值形状 / 占位符一致 / `layers/system` 引用闭合 / 93 个 `.vue` 模板无硬编码中文）并接入 CI quality job；`check:ui` 用例数不变（116）。 |
| 2026-11-04 | 0.39.2 | `NMCPS-ARCH-006` → 0.2.23（§7 第 22 行去掉硬编码组件计数：改成「`app` 与 `layers` 下全部 `.vue` 模板」并注明计数由 `check:i18n` 按实际扫描输出；断言组数 9、`check:ui` 116 不变）。 |
| 2026-11-04 | 0.39.3 | `NMCPS-ARCH-006` → 0.2.24（`check:i18n` 新增第 ⑧ 组「全站引用闭合」：扫 `app` 与全部 `layers/*/app` 的 `t()` / `$t()` / `tm()` 字面量键，动态拼接按静态前缀断言；断言组数 9 → 10，`check:ui` 116 与 `quickstart` 同步改为十组）。 |
| 2026-11-04 | 0.39.4 | `NMCPS-ARCH-006` → 0.2.25（`check:i18n` 的 ⑥ / ⑧ 合为 `auditUsage()` 一份实现，前缀判定拆 `segment` / `open` 两态；断言组数仍 10，实测 333/5 与 497/9 不变）。 |
| 2026-11-04 | 0.39.5 | **守卫增强**：`check:doc-system` 新增第 ⑦ 组「中英对齐」——(a) 比对两份 doc-map 变更记录正文里的「`docId` → x.y.z」目标版本集合，任何一侧缺版本即报错；(b) 对 `DOC_PATHS` 登记的每个 docId 断言 en 镜像存在且 `version` 与 cn 相同，`NMCPS-GOV-003` 自身例外（两套编号平行独立，由 (a) 覆盖内容集合）。断言 886 → 967（受治理文档 40 篇、39 对中英文档）。负例实测：把 en 的 0.2.22 改为 0.2.99 → 966 通过 / 1 失败并列出 `missing` / `extra`；同时章末断言组数在 `quickstart`、`doc-workflow`、`content-center-architecture` 三处中英文同步改为七组。 |
| 2026-11-04 | 0.39.6 | **守卫自测落地**：新增 `pnpm check:doc-system:selftest`（`scripts/check-doc-system.selftest.mjs`）——把 `check-doc-system.ts`、`docIds.ts` 与全部 `.md` 拷进系统临时目录，在副本上制造漂移后跑真脚本，按「退出码 + 报文字样」判定。四个用例：① 原样副本 0 失败；② en doc-map 的 `0.2.22` 改成 `0.2.99` → 1 失败且报文带 `missing` / `extra`；③ en 的 ARCH-006 文档 `version` 改小一版 → 1 失败；④ 删掉 en 的 ARCH-006 → 1 失败。自测已接入 `check:governance` 与 CI 的 governance job，本地 `文档体系自测 4/4 通过`；工作区零改动（每个用例一份干净副本，跑完即删）。自测首轮就复现了一个真 bug：守卫末行用 `process.exit()`，967 行输出写满管道缓冲区时尾部（含 ❌ 与结果行）会被截断——已改为 `process.exitCode`，`check:i18n` / `check:rules` 同步改掉（`check:bff` 保留 `process.exit()`，因为它持有 socket 需要强制终止）。 |
| 2026-11-04 | 0.39.7 | **CI 摘要前置结论**：`scripts/ci-summary.sh` 不再只贴日志尾部——新增「关键结论」段（抽取 `结果：N 通过 / M 失败 / K 告警`、`文档体系自测 N/M 通过`、`文案自查 N/M 通过`、`N/M 项通过`，最多 8 条）、「失败明细」段（`❌` / `error TS…` / `Error:` 最多 5 条），尾部 40 行收进 `<details>` 默认折叠；无小结行时显式提示。本地用 governance / selftest / i18n / rules 四份真日志与「失败」「无小结」两类假日志验证过（`check:governance` 摘要现为 `967 通过 / 0 失败 / 0 告警` + `4/4` + `30/30` + `34/34` 四行并列）。 |
| 2026-11-04 | 0.39.8 | **摘要缺失即失败**：`scripts/ci-summary.sh` 增加可选 `--expect "<扩展正则>"`——调用方声明「本步骤日志里必须出现的结论行」，抽不到就 ① 打 `::error` 注解（Runner 的 Annotations 变红）② 在步骤摘要顶部写「预期结论缺失」③ 退出码 1；`ci.yml` 六处调用改成 `… --expect '<正则>' \|\| status=1`（lint `\$ eslint`、typecheck `vue-tsc`、i18n `文案自查 N/M 通过`、governance `结果：N 通过`、BFF `N/M 项通过`、page UI `N/M 项通过`），于是「校验跑通了但摘要抽不到结论」不再静默降级；page UI 的失败分支只补摘要（`\|\| true`），不覆盖真实失败码。新增 `pnpm check:ci-summary`（`scripts/check-ci-summary.mjs`，六个用例：命中 / 未命中 / 不给 `--expect` 的向后兼容 / 非 CI 环境同样生效 / 参数缺值 / 未知选项）并接入 `check:governance`，本地报 `步骤摘要自测 6/6 通过`。 |
| 2026-11-04 | 0.39.9 | **正则收敛为单一事实源**：六条 `--expect` 正则从 `ci.yml` 内联搬到新文件 `scripts/ci-expectations.sh`（`sh scripts/ci-expectations.sh <key>` 打印正则、`--list` 列出 `key<TAB>正则`、unknown key 退出 2），`ci.yml` 七个调用点改成 `--expect "$(sh scripts/ci-expectations.sh <key>)"`。`pnpm check:ci-summary` 由 6 项扩到 11 项：新增 ⑤ 类静态接线断言——⑦ 每处调用都带该形式 ⑧ 每处以 `\|\| status=1` 收尾（仅已红分支允许 `\|\| true`，靠回溯最近的 `if [ "$status" -ne 0 ]` 判定）⑨ ci.yml 用到的 key 与 `--list` 表双向一致（无死条目、无未登记 key）⑩ 每个 key 解析出非空正则 ⑪ unknown key 报错。负例实测：删掉一行的 `--expect` → 9/11；把 page UI 成功分支的 `\|\| status=1` 改成 `\|\| true` → 10/11。 |
| 2026-11-04 | 0.39.10 | **正则回放真实日志**：新增 `scripts/fixtures/ci-logs/<key>.log` 六份样本（各步骤真实日志尾部，头部 `# source:` 写出处与重采方式），`pnpm check:ci-summary` 由 11 项扩到 14 项：⑫ 样本与表 key 双向一致（缺样本 / 孤儿样本都红）⑬ 每条正则用 `grep -aE`（与 `ci-summary.sh` 同工具同参数）在对应样本上命中 ⑭ 每份样本都带 `# source:` 行（防编造）。补上「接线对但正则匹配不上今天措辞」的盲区。重采入口 `node scripts/check-ci-summary.mjs --write-fixtures` 重跑 lint / typecheck / i18n / governance 四步写回尾部（先跑完再统一落盘，避免中途改样本让 `check:governance` 假红）；bff / ui 需构建产物 + 真浏览器，从 `gh run view <id> --log` 手工取。负例实测：删 `ui.log` → 12/14；把 `116/116 项通过` 改成 `116/116 cases passed` → 12/14；删 `bff.log` 的 `# source:` 行 → 13/14。 |
| 2026-11-04 | 0.39.11 | **样本清单双源互证**：新增 `scripts/fixtures/ci-logs/.manifest.json`，每条记录样本的 `sha256` 与它声称的 `source`；`pnpm check:ci-summary` 由 14 项扩到 17 项：⑮ 清单与样本文件双向一致（漏封 / 多出记录都红）⑯ 每条 `sha256` 与样本字节一致（手改样本没重封即红）⑰ 清单 `source` 与样本 `# source:` 行一致（只改头部也会被两处 source 打架抓出）。补上上一轮遗留的「`# source:` 只是备注，改样本的人顺手也能改」的漏洞。封存入口：`--write-fixtures` 重采四步后自动封存，新增 `--seal` 只重封清单不跑命令（供手工替换 bff / ui 样本后用）。负例实测：改 `ui.log` 的 `116/116`→`118/118` 不重封 → 16/17；只改 `bff.log` 第 2 行 source → 15/17（⑯⑰ 同红）；删清单里 i18n 记录 → 14/17。 |
| 2026-11-04 | 0.39.12 | **重采自带两道自检**：`--write-fixtures` 从「先跑完再统一落盘」升级为「不绿不写 + 写回即回放」——某步 `exit≠0` 时跳过该 key（失败输出绝不固化成「真实日志样本」，上一轮就踩过 lint 红输出被写进 `lint.log` 的坑），已绿的 key 照常写入并封存；每份新样本写回后立刻用 `scripts/ci-expectations.sh` 的该条正则 `grep -aE` 一遍，措辞漂移在重采当场就报出来，而不是等下一次跑断言。任一不过 → 退出码 1（样本仍保持自洽，断言依旧 17/17）。负例实测：临时加一条 `no-unused-vars` 违规 → `❌ 跳过 lint.log`、lint.log 字节未变（sha256 一致）、其余三步刷新、exit 1；临时把表里 `typecheck` 正则改成 `vue-tsc-nonexistent` → `⚠️ 正则不再命中新样本：key=typecheck` + 下游 governance 因 ⑬ 变红被跳过、exit 1。 |
| 2026-11-04 | 0.39.13 | **样本回填改成机器抓取**：新增 `--from-ci [run-id]`——从该次运行的产物（`ci.yml` 里 `tee` 落盘的那份，`check-logs-quality` / `check-logs-runtime` 已随每次运行上传）回填**全部六份**样本，含本地根本跑不了的 bff / ui。出处写成 `CI run <id> 步骤 "<step>"（job: <job>）产物 <artifact>/<file> 尾部`，步骤名与 job 名取自这次 `gh run view` 的实际组成（找不到同名步骤就跳过并红），于是整条链上"人肉抄日志"这个唯一能伪造来源的环节被拿掉；顺带修掉 `ui.log` 里那句早已改名的旧出处（`Build & run UI self-check` → `Page UI checks`）。新增第 ⑱ 项断言：回填表里每个步骤名与产物名都必须在 `ci.yml` 里存在（步骤/产物改名即红）。断言 17 → 18。实测：`--from-ci 41923275927` 回填六份后 18/18；`--from-ci 999999999` → 干净报错 exit 1；`PATH` 去掉 gh → `拿不到 run id` exit 1；把 `ui` 的步骤名改回旧名 → `跳过 ui.log` exit 1 且 ⑱ 同红。 |
| 2026-11-04 | 0.39.14 | **`--seal` 降级为应急入口**：它仍能给盘上任意字节盖章（清单损坏、产物过期时的逃生门），但正常路径只有 `--write-fixtures` 与 `--from-ci`，所以三处加固把它变成「看得见的例外」而非静默后门：脚本头部说明与 `--seal` 输出首行都写明「应急入口 + 手工封存必须在 commit message 里写明改了哪一份、为什么走不了机器回填」；封存前先读旧清单做 diff，逐条打印「本次封存改动」（`字节变了 <sha>… → <sha>…` / `出处变了 旧「…」新「…」` / `新封存` / `已从清单移除`），叫人没法「顺手重封」而不知道自己改了什么；样本与清单本来就一致时直说「这次 `--seal` 没改变任何东西，不需要提交」。配套把 `readManifest()` 抽成函数，断言层与封存层共用（文件缺失 / JSON 坏掉一律当空清单，由 ⑮ 判红）。负例实测：删清单里 `ui` 记录 → `ui: 新封存`；`ui.log` 末尾加一行 → `ui: 字节变了 c0821b915da3… → cc7404d46ea2…`；只改 `ui.log` 的 `# source:` 行 → 同时报「字节变了」与「出处变了 旧…/新…」；把 `ui.log` 移走 → `ui: 已从清单移除`；原样再封 → 「清单无变化」。断言仍 18/18。 |
| 2026-11-05 | 0.39.15 | **理由从「自觉」变成「必填」**：`--seal` 现在要求 `--reason "…"`。盘上样本与清单不一致却没给理由 → 直接拒绝封存、exit 1，且**清单一个字节都不写**（⑯ 继续红，恢复样本即自动转绿）；给了理由才封存，并把理由排成可直接复制的 commit message 草稿：标题 `chore(ci): 手工重封 <keys> 样本 — <理由>`、正文自动附本次改动清单（`出处变了` 那条自带换行，排进正文时压回一行）。样本与清单本来就一致时不需要理由（`😐 … 没有要提交的东西`）。配套：`seal()` 拆出 `snapshotManifest()` 并可接收快照（先算 diff、后落盘，才有"拒绝时不写盘"这一步），`--reason` 是写给人看的，不进清单结构（⑮ 仍按 6 条 key 校验）。负例实测：`ui.log` 加一行后 `--seal` 无理由 → `❌ 这次 --seal 会改动 1 处，但没给理由，拒绝封存`、exit 1，清单 sha 与封存前一致（`3100136c…`）、断言 17/18；补 `--reason` → exit 0 并打出草稿；同时改正文与 `# source:` → 草稿正文两行（字节变了 / 出处变了 旧…新…）；还原样本后不再封存即自动回到 18/18。 |
| 2026-11-05 | 0.39.16 | **回填并入排查入口 + 只收绿步骤**：`scripts/ci-doctor.sh` 新增 `fixtures [run-id]` 子命令——查 CI 与回填样本从此同一入口（打一行运行横幅后 `exec node scripts/check-ci-summary.mjs --from-ci <id>`，退出码原样透传），`--help`、文件头注释同步写明它是唯一会写仓库子目录的子命令。同时堵上一条真实的漏子：`--from-ci` 以前只按步骤名找产物，不看该步骤在这次运行里的结论，而失败步骤的日志同样被 `tee` 落盘并上传，于是从一次红的运行回填就等于把失败输出固化成「真实日志样本」（正是 `--write-fixtures` 的「不绿不写」要防的事）。现在步骤元数据里带上 `conclusion`，非 `success` 的 key 一律 `❌ 跳过 …：run <id> 里「<step>」的结论是 failure，不把失败输出固化成样本` 并 exit 1。实测：红运行 `41156254383`（`Page UI checks=failure`，其余五步 success）→ 四份回填，`i18n.log`（该运行还没有 `Text (i18n) guard` 这一步）与 `ui.log`（结论 failure）两处跳过、exit 1；绿运行 `41930512655` → 六份回填、`已封存`、exit 0，diff 仅 `# source:` 的日期一行（内容字节不变，说明回填可重复）；`fixtures 999999999` → `❌ gh run view … 失败：HTTP 404`、exit 1；回填后 `git checkout -- scripts/fixtures/ci-logs/` 即恢复 18/18。断言仍 18/18。 |
| 2026-11-05 | 0.39.17 | **断言红了要自己说话**：`pnpm check:ci-summary` 的每条失败断言现在多打一行 `::error title=步骤摘要自测失败（第 <n> 条）：<断言名>::<明细首行>（共 N 行明细，见日志）`。起因是真红演练（run `41937577101`：把 `ui.log` 的 `116/116` 手改成 `118/118` 且不重封）实测到——Runner 上 `Governance guard` 确实变红、`Upload quality check logs` 仍 success（失败日志同样上传，正是 `--from-ci` 按 conclusion 过滤的理由），但 check-runs 注解里只有通用的一句 `Process completed with exit code 1.`，真正定位用的 `❌ 清单里每条 sha256 与样本字节一致（手改样本未重新封存即红）` / `ui: 清单 c0821b915da3… ≠ 实际 5f7f918982b6…` 只在日志里，Checks 页看不见。转义按 GitHub 的两套规矩分开做：标题（属性）转 `%` `\r` `\n` `:` `,`，正文（消息）只转 `%` `\r` `\n`——正文里的 `:` 若也转成 `%3A`，Runner 不解码、注解里会原样显示 `%3A`，比不转更糟。注解只认单行：正文放明细首行 + 「共 N 行明细，见日志」，完整明细仍由 `❌` 块给出。定点实测在第二轮真红演练（run `41943103624`，同一手法手改 `ui.log` 且不重封）：check-run 的 failure 注解为 `title=步骤摘要自测失败（1/17）：清单里每条 sha256 与样本字节一致（手改样本未重新封存即红）`、`message=ui: 清单 c0821b915da3… ≠ 实际 5f7f918982b6…（改完样本请跑 --seal）`——上一轮同一手法只有通用那一句，这一轮注解自己就把断言、样本、两个哈希说完了。该轮同时暴露 `（1/17）` 的歧义（分母其实是「已评估的断言数」，⑯ 恰是第 17 条），故标题改为「第 N 条」，避免被读成「1 / 共 17 项」。新增第 ⑲ 项断言盯四件会真坏的事（多行未折行、标题未转义、正文过度转义、`wiring()` 里 `console.log(annotationOf(...))` 被删），断言 18 → 19。 |
| 2026-11-05 | 0.39.18 | **四种入口收成一张表**：`--write-fixtures` / `--from-ci [run-id]`（含 `ci-doctor fixtures`）/ `--seal --reason` / 手抄 `gh run view` 的「何时允许 / 之后必须做什么 / 被哪条断言抓」，从 quickstart 的一整段散文与 `.clinerules/02` 的一条长 bullet 里抽出来，落成 quickstart 新章节「CI 样本重采的四个入口」的四列表；散文只留「正则唯一来源 / 七个调用点反向断言 / 注解给定位」这层结论，`.clinerules/02` 改为指向该表，`scripts/check-ci-summary.mjs` 头注释同步声明「改行为就改那张表」。 |
| 2026-11-05 | 0.39.19 | **真红注解演练脚本化**：`scripts/ci-doctor.sh` 新增 `drill [key] [--yes] [--dry-run]`——往 `scripts/fixtures/ci-logs/<key>.log` 尾部注入一行漂移（只动正文，不碰 `# source:`，所以踩 ⑯ 而不是 ⑰）→ 推一个临时提交 → 轮询该提交的 `check-runs` 注解 → 与本地 `check-ci-summary.mjs` **现场生成**的期望文案逐字比对 → 回滚并等回滚那次运行回到绿；`trap` 兜底回滚、`--yes` 闸门、只推 `main` 且永不 force push。`check:ci-summary` 新增断言 ⑳ 静态钉住这六件事（19 → 20 项，`quickstart` 中英同步改为二十项并新增「演练真红注解」小节）。实测 2026-11-05：演练 run `41959174877` 变红，failure 注解为 `步骤摘要自测失败（第 17 条）：清单里每条 sha256 与样本字节一致（手改样本未重新封存即红） | ui: 清单 c0821b915da3… ≠ 实际 fb4e604c1c99…（改完样本请跑 --seal）`，与本地现场生成的期望逐字一致；回滚 run `41959739050` → `success`、0 条 failure 注解，收尾工作区干净且 `HEAD == origin/main`、`ui.log` 字节回到基线。 |
| 2026-11-05 | 0.39.20 | **一次演练多份样本**：`drill` 的参数从「一个位置参数 key」扩成 `drill [key|--keys a,b,c|all] [--yes] [--dry-run]`（位置参数仍可当简写，`--keys` 优先；`all` 展开成 `scripts/fixtures/ci-logs/*.log`）。key 列表在**动手之前**就全部校验：不存在就报 `❌ 没有这份样本：<路径>` 并列出可用 key（`bff governance i18n lint typecheck ui`），重复 key 去重，空列表直接 exit 2。每份样本各追加一行漂移（仍只动正文、不碰 `# source:`），于是 ⑯ 的明细变成 N 行——而 `annotationOf` 只把**首行** + `（共 N 行明细，见日志）` 写进注解，这是单份演练永远走不到的折行路径，批量演练正好覆盖它。比对也随之从「`head -n 1` 找一条像的」升级为**集合比对**：本地 `check-ci-summary.mjs` 打出的所有 `::error title=` 行逐条反转义成 `<标题> \| <正文>`，排序后与 CI 实测的 failure 注解集合（剔除 Runner 那条空标题兜底）`diff`，少一条、多一条、折行丢了都会红并打印 unified diff。`trap drill_cleanup` 与显式回滚都改成遍历整张文件列表（`git checkout "$drill_pre" -- $drill_files`），中途崩溃不会把剩下的漂移留在 `main` 上。断言 ⑳ 从六件扩到九件（新增 `--keys` / 集合 diff / 回滚覆盖全列表），仍未削弱原有六件。诚实边界：⑯ 无论漂几份也只产出一条注解，GitHub 每步 10 条 error 注解的上限靠样本漂移**撞不到**，脚本只在实测条数 >10 时告警，不假装验过上限。实测（本地）：`drill --keys all --dry-run` 一次漂 6 份，期望仅 1 条注解且正文带 `（共 6 行明细，见日志）`；`drill --keys lint,lint --dry-run` 去重后只漂 `lint.log`；`drill ui --dry-run` 与单份行为一致；三次 dry-run 结束工作区均回到只剩预期改动。实测（CI，2026-11-05）：`drill --keys lint,governance --yes` 推演练提交 `5624ace` → run `41966370449` `failure`，failure 注解恰为 1 条 `步骤摘要自测失败（第 17 条）：清单里每条 sha256 与样本字节一致（手改样本未重新封存即红） | governance: 清单 1eb0fab5510a… ≠ 实际 1966e8d78748…（改完样本请跑 --seal）（共 2 行明细，见日志）`，与本机现场生成的期望逐字一致——连「共 2 行明细，见日志」的折行都对上，且首行是字典序更小的 governance；回滚提交 `ded7930` → run `41966917965` `success`、0 条 failure 注解，收尾 `HEAD == origin/main`、工作区干净、六份样本零漂移行。全量演练（同日）：`drill --keys all --yes` 一次漂满 6 份 → 演练提交 `d08f3d7` → run `41973955457` `failure`，注解仍恰 1 条且正文折行扩到 `（共 6 行明细，见日志）`（首行 `bff: 清单 33c35ac5bcd3… ≠ 实际 29f4f5bb5369…`），与本机期望逐字一致，说明折行对 N 不敏感；回滚提交 `2858290` → run `41974481509` `success`、0 条 failure 注解，收尾工作区干净、`HEAD == origin/main`、六份样本零漂移行。 |
| 2026-11-05 | 0.39.21 | **演练从「记得跑」变成「每周必跑」**：新增 `.github/workflows/drill-nightly.yml`——每周一 03:00 UTC 跑一次 `drill --keys all --yes`，另留 `workflow_dispatch` 供排障时手动重跑；失败开 issue（同标题只留一个开着的，后续失败改成追加评论，避免每周刷屏）。硬约束与理由：它必须用 PAT（`secrets.DRILL_TOKEN`，`contents: write`），因为**用 `GITHUB_TOKEN` 推的提交不会再触发 `ci.yml`**，演练会「等不到运行」并判自己无效——那正是假绿；所以缺 secret 时工作流直接红并打 `::error title=drill-nightly 缺 secrets.DRILL_TOKEN::…` 说明要配什么，绝不静默跳过（checkout 回落 `GITHUB_TOKEN` 只为让这道闸门能报错，而不是死在 checkout）。`concurrency: group: drill-nightly` 防止两次演练同时抢 `main` 的 HEAD。自动化多一层兜底：正常路径仍由 drill 自己的 `trap` 回滚；runner 若在演练中途退出，最后一道 `always()` 步骤扫 `origin/main` 上是否有 `# drill: 注入漂移` marker 行，有就 `sed` 只剥这几行再补一个正常回滚提交（除 marker 行外一个字节都不碰，因此不会掩盖真实漂移），并把这次运行判红。人工闸门未取消：`--yes` / `HEAD == origin/main` / 干净工作区三道前置条件一条没放宽，nightly 只是「每周至少跑一次」的补网。`check:ci-summary` 新增断言 ㉑ 静态钉住七件事（cron / 可手动重跑 / `--keys all` / 用 PAT 推 / `concurrency` / 残留漂移兜底 / 失败开 issue），20 → 21 项；`quickstart` 中英同步改为二十一项并新增「定时演练」段落。负例实测（本地，2026-11-05）：把兜底 `sed` 换成 `true` → ㉑ 红并打出 `第 21 条` + `没有残留漂移兜底…`；把 `GH_TOKEN` 从 `DRILL_TOKEN` 换成 `GITHUB_TOKEN` → ㉑ 红 + `演练没用 PAT…`；把 `--keys all` 改成 `--keys ui` → ㉑ 红 + `不是 \`drill --keys all --yes\``；三者还原后 21/21 绿。兜底步骤用本地裸仓库真跑验证过（2026-11-05）：注入两行 marker → 报出两份文件、只剥 marker 行、与未漂移基线的 `git diff` 为空（字节完全回到基线）、补一个回滚提交并 `exit 1` + `::error`；再跑一次幂等（`origin/main 上没有残留漂移`、`exit 0`）。这次真跑当场抓到第一版的真 bug——`git ls-tree` 少了 `-r` 只吐出目录名（`scripts/fixtures/ci-logs`），循环扫不到任何 `.log`，兜底会「什么都没找到」而假装修好了；所以 ㉑ 现在同时要求 `ls-tree -r` 与那条 `sed`。缺 token 的闸门同样实测：空 `DRILL_TOKEN` → `exit 1` + `::error title=drill-nightly 缺 secrets.DRILL_TOKEN::…`，有值 → `token 就位`、`exit 0`。**未验证项（如实记录）**：仓库尚未配置 `DRILL_TOKEN`，因此定时触发的首次真实运行会是红的（并开一条 issue 指路），schedule 的真实触发只能等下周或手动 `workflow_dispatch` 观察。 |
| 2026-11-05 | 0.39.22 | **定时演练首次真跑（workflow_dispatch）实测**：`dd55581..3fdb3b5` 推上去后 ci run `41978019696` → `success`，产物 `check-logs-quality` 的 governance 日志实测 `步骤摘要自测 21/21 通过`、`结果：967 通过 / 0 失败 / 0 告警`、`::error title=` 计数 0。接着 `gh workflow run drill-nightly.yml --ref main` → run `41978053735` 判 `failure`，失败步骤**恰为** `Require a push-capable token`（`Prepare git identity` / `Drill all six samples` 均 `skipped`），`Self-heal a leftover drift on main` → `success`（走的是「没有 token，跳过兜底」分支，实测不会误伤），`Upload the drill log` 与 `Open an issue when the drill fails` → `success`；该提交上 failure 级注解两条：Runner 的无标题兜底 `Process completed with exit code 1.` + 我们那条 `drill-nightly 缺 secrets.DRILL_TOKEN | 演练要往 main 推两次提交，并靠这次 push 触发 ci.yml；用 GITHUB_TOKEN 推的提交不会触发 workflow，所以必须配一个 contents:write 的 PAT`——即「缺凭据也绝不假绿」按设计落地。issue #1 已开（正文含运行链接与三步排查顺序），但正文明细段落的日志位印成 `(没有日志)`：失败发生在演练开始前，`drill-logs/drill.log` 压根没生成，据此把 issue 正文改成「有日志就贴尾 60 行、没有就明说失败在演练开始前」两种形态。收尾核对：`HEAD == origin/main == 3fdb3b5`、六份样本的 `# drill: 注入漂移` 行数均为 0、没有演练提交被推上去。**仍未验证**：配好 `DRILL_TOKEN` 后的完整定时演练（`schedule` 真实触发留给下周一，或配好 secret 后手动 `workflow_dispatch`）。 |
| 2026-11-05 | 0.39.23 | **配好 `DRILL_TOKEN` 后的完整演练实测通过**（还掉上一条的「仍未验证」）：`gh secret set DRILL_TOKEN` 落库（`gh secret list` 出现 `DRILL_TOKEN`）后 `gh workflow run drill-nightly.yml --ref main` → run `41982302704` → **success**。三步实测：① `Drill all six samples` 推漂移提交 `a79363d`，其 ci run `41982322933` 判 `failure`，且失败**只在** `lint / typecheck / governance`（`BFF contract / page UI` 仍 `success`），证明红确实来自样本字节而非环境；② Checks 页实测 failure 注解 1 条，与本地现场生成的期望**逐字一致**：标题 `步骤摘要自测失败（第 17 条）：清单里每条 sha256 与样本字节一致（手改样本未重新封存即红）`，正文点名 `bff: 清单 33c35ac5bcd3… ≠ 实际 23fd448522ee…（改完样本请跑 --seal）（共 6 行明细，见日志）`——六份样本一起漂时 ⑯ 用**一条**折叠注解把 6 行明细装进正文，而不是散成 6 条；③ 回滚提交 `c143b59` 的 ci run `41982873961` → `success`、failure 注解 0 条。收尾核对：`git diff --stat 13266da origin/main` 为空（净改动 0）、六份样本的 `# drill: 注入漂移` 残留行数全 0、两笔演练提交按预期留在 main 历史里（普通 push，非 force）、issue #1 已按「已处理」关闭且本次**没有**重复开新 issue。**仍未观测**：真实 `schedule` 触发（下周一 03:00 UTC）与 token 过期后的失败形态。 |
| 2026-11-05 | 0.39.24 | **PAT 到期前主动预警 + 断言 ㉒（21 → 22）**：`DRILL_TOKEN` 到期那天演练会红在 checkout/push，而那一刻离上次绿只有 7 天，人第一反应会是「代码坏了」。`drill-nightly.yml` 因此在演练**之前**加了一步 `Warn early when DRILL_TOKEN is about to expire`：用 token 打一次 `GET /user`，读 GitHub 回的 `github-authentication-token-expiration` 响应头——剩 ≤`WARN_DAYS`（14）天只打 `::warning` 并把到期日写进 step summary（本周演练照跑），**401 或已过期才红**，非 200（网络/限流）与「token 本来就没有期限」都只记日志、不阻断演练；提示语里给的换法用 `gh secret set DRILL_TOKEN --repo $GITHUB_REPOSITORY`。**实测**：把该 step 的 `run:` 块抠到本地、用假 `curl` 造响应，六种场景逐一跑通（401 → `::error` 退出 1；无过期头 → 跳过；5 天后到期 → `::warning` + step summary 渲染正确；3 天前过期 → `::error` 退出 1；60 天后到期 → 静默 exit 0；502 → `::warning` 不阻断）。过程中真踩到两个坑：① 摘要文案里写了 `${{ github.repository }}`，本地跑直接 `Bad substitution`（Runner 会先替换，所以只在离线复现时炸）——改成 `$GITHUB_REPOSITORY`，并把「run 块里不许出现 `${{ }}`」写进断言；② 第一版 ㉒ 只做文本存在性匹配，负向自证里「删掉 401 分支」「阈值改成 3650 天」「把 `if` 短路成 `false`」三组仍然全绿（`401` 与 `::error title=drill-nightly DRILL_TOKEN` 在注释和别的分支里也能匹配）——收紧成结构匹配（`[ "$code" = '401' ]`、`[ "$left" -le 0 ]`、`[ "$left" -le "${WARN_DAYS:-14}" ]`、`[ "$code" != '200' ]` 各自的 branch 内必须带对应注解）+ 阈值取值必须落在 1～30，现在九组负向自证（删 env / 阈值 3650 / 去 401 / 去已过期 / 短路 warn / 短路抖动 / 不读头 / run 块塞 `${{ }}` / 体检挪到演练之后）**每一组都报红并点名 ㉒**，还原后 22/22。文档同步：quickstart cn/en「演练真红注解」新增一段说明体检与换法，`.clinerules` 补 ㉒ 的九项。**仍未观测**：真实 `schedule` 触发（下周一 03:00 UTC），以及真实 PAT 临近到期时这一步在 Runner 上的输出（取决于 `DRILL_TOKEN` 到底有没有到期时间）。 |
