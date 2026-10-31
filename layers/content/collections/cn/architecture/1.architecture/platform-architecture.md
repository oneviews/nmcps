---
docId: NMCPS-ARCH-005
title: "平台能力架构"
description: "平台能力面（arch.platform）的 Tier 1 架构基准：Tauri 2 宿主下的桌面 / 移动能力矩阵、权限分层、探针页定位与浏览器降级策略。本文是 arch.platform 域的唯一权威。"
excerpt: "Tauri 宿主的能力矩阵、权限分层、探针页与浏览器降级。"
keywords:
  - "platform"
  - "architecture"
  - "tauri"
  - "capability"
  - "跨平台"
tier: 1
authority: normative
scope:
  - arch.platform
status: baseline
version: 0.2.3
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
  - NMCPS-GOV-003
createdAt: "2026-10-31"
updatedAt: "2026-10-31"
icon: "carbon:layers"
tags:
  - "架构"
  - "平台能力"
  - "Tauri"
  - "跨平台"
---

# 平台能力架构（NMCPS-ARCH-005）

> **本文职责**：`arch.platform` 域的唯一权威 —— 前端在「浏览器 / 桌面壳 / 移动壳」三种宿主下**能用什么、怎么降级、谁授权**。分层归属见 `NMCPS-ADR-0012`（layers/content/collections/cn/records/adr/adr-0012.md），本文取代它的口头约定并给出可执行矩阵；探针化改造的裁决见 `NMCPS-ADR-0015`（layers/content/collections/cn/records/adr/adr-0015.md）。
> **目标读者**：前端工程师 / 打包与发布负责人 / AI 助手。

---

## 一、定位

平台能力面（`layers/platform`）不是业务模块，而是**宿主差异的隔离层**：把「桌面才有的能力」收进少量组合式函数，业务代码只调用组合式函数，不直接 `import` Tauri 插件。

判断标准只有一条：**能否在纯浏览器里安全降级**。

- 能降级 → 业务代码可直接用（如 `useUpdater()` 在浏览器弹「仅桌面支持」）。
- 不能降级（令牌落盘、原生通知、文件写入）→ 必须走 `layers/platform` 的组合式函数，由它统一做 `isTauri()` 守卫。

---

## 二、运行时与构建目标

| 目标 | 产物 | 说明 |
| :--- | :--- | :--- |
| 浏览器（web） | `.output/` + Nitro BFF | 全部平台能力降级；`isTauri()` 为 `false` |
| 桌面（Windows / macOS / Linux） | Tauri 2 安装包 | 能力最全；`updater` 仅此目标可用 |
| 移动（Android / iOS） | Tauri 2 移动包 | 能力子集；窗口与文件语义与桌面不同 |

`ssr: false`（SPA）是前提：`isTauri()` 只在客户端求值，导航与探针页不得在服务端渲染阶段依赖它。

---

## 三、能力矩阵

「权限位」指 `src-tauri/capabilities/` 中声明的位置：`main.json` 为全平台，`desktop.json` 为桌面专属。

| 能力 | 插件 | 桌面 | Android | iOS | 权限位 | 浏览器降级 |
| :--- | :--- | :---: | :---: | :---: | :--- | :--- |
| 系统信息 | `os` | ✅ | ✅ | ✅ | `main.json` | 显示「无法检测」 |
| 键值存储 | `store` | ✅ | ✅ | ✅ | `main.json` | 空实现（`useAuthTokens` 返回 `null`） |
| 文件读写 | `fs` | ✅ 用户文档目录 | ⚠️ 应用私有目录 | ⚠️ 应用私有目录 | `main.json` | 不可用，页面提示 |
| 原生通知 | `notification` | ✅ | ✅（13+ 需运行时授权） | ✅（需运行时授权） | `main.json` | 不可用，页面提示 |
| 外部链接 | `opener` | ✅ | ✅ | ✅ | `main.json` | `window.open` |
| 多窗口 WebView | `webview` | ✅ | ⚠️ 需 Activity Embedding（API 32+） | ⚠️ 需 UIScene | `desktop.json` | 不可用，页面提示 |
| 自动更新 | `updater` | ✅ | ❌ | ❌ | `desktop.json` | 提示「仅桌面应用支持」 |
| 命令执行 | `shell`（插件已移除） | ❌ | ❌ | ❌ | 无 | 无 |

矩阵的两条硬约束：

1. **`fs` 的 `BaseDirectory.Document` 在移动端是应用私有目录**，不是用户可见的「文档」。探针页必须据此调整文案，不得承诺「文件出现在系统文档目录」。
2. **`shell` 一律不授权，插件本体也一并不留**。`shell:allow-execute` 的校验器形同虚设（`\S.*` 即任意命令），等于把 WebView 变成任意代码执行入口；因此 `tauri-plugin-shell`（Rust 依赖与注册）、`@tauri-apps/plugin-shell`（npm 依赖）与 `modules/tauri.ts` 的 shell 自动导入已全部移除 —— 不是「注册着但没授权」，而是根本不存在。确需调用系统程序时，走 Rust 侧自定义 `#[tauri::command]` + 参数白名单，并按 ADR 记录。

---

## 四、权限分层

- `src-tauri/capabilities/main.json`：全平台能力，只放「移动端也成立」的插件默认权限。
- `src-tauri/capabilities/desktop.json`：`platforms: ["macOS", "windows", "linux"]`，放 `updater` / `webview` 等桌面专属能力。
- 新增插件必须三处同步：`src-tauri/src/lib.rs`（`init`）、`src-tauri/capabilities/*.json`（权限）、`modules/tauri.ts`（`useTauri<Module><Function>` 自动导入前缀）。移除插件同样三处同步，外加 npm 依赖；`pnpm check:platform` 用四条断言守住 `shell` 零残留（`lib.rs` / `Cargo.toml` / `package.json` / `modules/tauri.ts`）。

任何 `allow-*` 粒度放宽都要在 PR 里写明「谁调用、失败后果、为何不能用默认权限」，因为移动端权限声明与桌面共用同一份文件。

---

## 五、组合式约定

`layers/platform` 只导出组合式函数，页面不得直接调用 `useTauri*`（`os` 探针除外，它本身就是系统信息透出）。

| 组合式 | 职责 | 浏览器行为 |
| :--- | :--- | :--- |
| `usePlatformInfo()` | 平台 / 版本 / 架构 / 区域 | 返回 `null` 字段 |
| `usePlatformStore()` | 探针专用键值仓（`platform-probe.bin`） | `store()` 返回 `null` |
| `usePlatformFile()` | 写文本文件 + 适用范围说明 | 返回 `unavailable` |
| `usePlatformNotify()` | 权限链 + 发送原生通知 | 返回 `unavailable` |
| `usePlatformWindow()` | 多窗口（桌面专属） | 返回 `unsupported` |
| `useExternalLink()` | 外部链接（Tauri `opener` / 浏览器新窗口） | `window.open` |

约定：

- 组合式函数**不吞异常**：以 `{ ok: false, reason }` 形式返回，由页面决定提示文案（i18n 键在 `pages.*` 下）。
- 每次调用都现算 `isTauri()`，不缓存模块级布尔值，避免测试与预览环境串味。
- 探针专用 store 使用独立文件名，不复用 `auth.bin`，避免 `autoSave` 互相覆盖。

---

## 六、探针页

五个探针页保留为「能力是否真的可用」的现场验证入口，**不作为产品功能**：

| 路由 | 探针 | 典型失败形态 |
| :--- | :--- | :--- |
| `/os` | 系统信息 | 插件未注册 → 调用抛错 |
| `/file` | 文件写入 | 权限位缺失 → `not allowed` |
| `/store` | 键值持久化 | 重启后读不到值 |
| `/notifications` | 原生通知 | 权限链中断 → 静默无通知 |
| `/webview` | 多窗口 | 移动端不支持 → 需降级为同窗口跳转 |

`/commands` 已下线：它演示的正是本文禁止的 `shell:allow-execute`。

**入口规则**：侧栏出现「平台能力」虚拟分组（`meta.group = "platform"`），**仅在 Tauri 环境显示**（`meta.tauriOnly`）。浏览器里页面仍可直接访问，但只显示降级提示 —— 这样 CI 能断言「浏览器不暴露入口」，而桌面用户又能一眼找到探针。

---

## 七、自查

- `pnpm check:platform`：静态断言（能力矩阵 / 权限文件无 `shell:allow-execute` / `shell` 插件零残留（`lib.rs`、`Cargo.toml`、`package.json`、`modules/tauri.ts`）/ 五个探针页与组合式存在 / cn-en 文案键对齐 / 导航分组 meta 齐全）。
- `pnpm check:ui`：浏览器侧两条断言 —— 侧栏不出现「平台能力」分组、`/os` 显示「无法检测」而非报错；相反分支由下一条的宿主模拟锁住。
- **Tauri 宿主模拟**：`isTauri()` 只读 `globalThis.isTauri`，故 `check:ui` 末尾另起一个带 `NUXT_PUBLIC_BFF_BASE` 的实例，注入这一位 + 最小 IPC 桩（store / updater / os 命令，桩 store 落 sessionStorage —— 桌面模式 BFF 不回写 cookie），再登录一次并断言分组出现、含 5 个入口。它走的是与真实桌面壳同一份运行时分支。
- **仍需手验**：无头环境没有 `DISPLAY`，原生窗口渲染、多窗口（`/webview`）与通知横幅的实际弹出只能在有图形环境的机器上 `pnpm tauri:dev` 逐页确认；移动端同理由真机覆盖。`pnpm tauri:dev` 前置条件是「本目录没有别的 Nuxt dev server」（换端口绕不过 `.nuxt/nuxt.lock`）且存在显示服务，两者缺失时脚本会在编译前直接报错退出（实测 2026-10-31：换端口后 `beforeDevCommand` 报 `ActionableError`，随后 `cargo run` 在 `gtk::rt::init` panic）。
- **移动端无法自动化**：Android / iOS 的权限链与文件语义须在真机各跑一遍探针，结果回填本节。

---

## 八、保留策略

探针页与组合式函数是**能力储备**，不是产品页：它们存在的意义是把「桌面 / 移动宿主才有的能力」先跑通并留档，等 NMCPS 业务功能需要时直接复用。

- **保留范围**：系统信息、文件读写与目录选择、键值存储、原生通知、窗口 / 多窗口、外链打开、更新器 —— 六组组合式函数与五个探针页全部保留，能力代码不做清理。
- **唯一例外**：任意命令执行（`shell:allow-execute`）不予保留，理由见 `NMCPS-ADR-0015`（layers/content/collections/cn/records/adr/adr-0015.md）—— 它是任意代码执行面，而未来功能没有这类需求；插件本体（Rust 依赖与注册、npm 依赖、自动导入）已一并移除。确需调用外部程序时，新增专用后端命令并在本文矩阵登记，不复用通用 shell。
- **未来对接方式**：业务代码只消费 `layers/platform/app/composables` 暴露的 API，不直接 `import` Tauri 插件；探针页只作为回归样例（升级 Tauri / 插件大版本后逐页复验），不作为业务入口。
- **新增一项能力的准入**：组合式函数 + 探针页用例 + 本文能力矩阵一行 + `capabilities` 权限位，四者缺一不可。
- **移除门槛**：删除任何探针页或组合式函数前，先修订本文与 `NMCPS-ADR-0015`；未经这两处的移除视为回归。

---

## 九、变更记录

| 日期 | 版本 | 变更 |
| :--- | :--- | :--- |
| 2026-10-31 | 0.1.0 | 首版：能力矩阵、权限分层、组合式约定、五个探针页与自查口径；`shell` 明确不授权（裁决见 ADR-0015）。 |
| 2026-10-31 | 0.2.0 | 第七节把「仅 Tauri 显示分组」从纯手验升级为 `check:ui` 的宿主模拟断言（注入 `globalThis.isTauri` + 最小 IPC 桩，另一个带 `NUXT_PUBLIC_BFF_BASE` 的实例，68 项自建断言）；原生窗口与移动端仍列为手验项。 |
| 2026-10-31 | 0.2.1 | 第七节补 `pnpm tauri:dev` 的两条前置条件（本目录无其他 Nuxt dev server、存在显示服务），并对应在 `scripts/tauri-dev.ts` 增加编译前的前置检查。 |
| 2026-10-31 | 0.2.2 | 新增第八节「保留策略」：五个探针页与六个组合式函数作为能力储备整体保留（供未来 NMCPS 业务功能复用），唯一例外是任意命令执行；新增能力与移除探针各自的准入 / 门槛一并写死，变更记录改为第九节。 |
| 2026-10-31 | 0.2.3 | `shell` 插件本体移除（`Cargo.toml` / `lib.rs` / `modules/tauri.ts` / `package.json`），矩阵与第四节改写为「根本不存在」；`check:platform` 增加四条零残留断言，计数 30 → 34。 |
