---
title: "快速开始"
description: "内容中心开发环境的快速启动指南：环境准备、安装依赖、启动开发服务器与运行校验命令。"
excerpt: "环境准备、安装依赖、启动 dev server 与运行校验。"
createdAt: "2026-10-25"
updatedAt: "2026-10-25"
icon: "carbon:book"
---

# 快速开始

内容中心开发环境的快速启动指南。

## 环境准备

- Node.js >= 20。
- 包管理器：pnpm >= 9。

## 安装依赖

```bash
pnpm install
```

## 启动开发服务器

```bash
pnpm dev
```

默认监听 `http://localhost:3000`（strictPort）。

## 运行校验

```bash
pnpm typecheck        # 类型检查
pnpm lint             # ESLint（含 i18n 键序）
pnpm check:doc-system # 文档体系守卫（六组断言：唯一性 / 完整性 / 引用闭合 / 无环 / 层级合法 / 老化告警）
pnpm build:server     # 先构建 BFF 产物，check:bff 消费 .output/server
pnpm check:bff        # BFF 网关契约（白名单 / 动词 / 路径穿越 / CORS / 信封，依据 NMCPS-ADR-0007）
pnpm check:ui         # 页面自查（Playwright，需先起服务；默认指向 http://192.168.1.90:3000）
```

> `check:ui` 可用 `CHECK_UI_BASE_URL` 覆盖被测地址（CI 指向本地构建产物 `http://127.0.0.1:3000`），用 `CHECK_UI_SCREENSHOT` 覆盖截图路径。CI 定义在 `.github/workflows/ci.yml`，三组断言与本地命令一致。

> 新增内容集合目录后需重启 dev server，让 `@nuxt/content` 监视器识别新目录。
