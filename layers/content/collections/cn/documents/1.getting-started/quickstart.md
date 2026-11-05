---
title: "快速开始"
description: "内容中心开发环境的快速启动指南：环境准备、安装依赖、启动开发服务器与运行校验命令。"
excerpt: "环境准备、安装依赖、启动 dev server 与运行校验。"
createdAt: "2026-10-25"
updatedAt: "2026-10-30"
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
pnpm check:doc-system # 文档体系守卫（七组断言：唯一性 / 完整性 / 引用闭合 / 无环 / 层级合法 / 老化告警 / 中英对齐）
pnpm check:doc-system:selftest # 守卫自测：在临时副本上制造四种漂移，断言守卫必须变红（防断言被改哑）
pnpm check:ci-summary # 步骤摘要自测：十九项断言，钉住 ci-summary.sh 的 --expect 语义、ci.yml 七个调用点的接线（正则唯一来源 scripts/ci-expectations.sh），回放真实日志样本 scripts/fixtures/ci-logs/（含 sha256 清单与产物回填的出处核对），并保证任何一条断言变红时都打出 `::error` 注解（Checks 页直接写明哪条红了）
pnpm check:i18n       # 文案自查（十组断言：键集合对齐 / en 无中文 / 值形状 / 占位符一致 / 系统管理页引用闭合 / 全站 t() 引用闭合 / 模板无硬编码中文）
pnpm build:server     # 先构建 BFF 产物，check:bff 消费 .output/server
pnpm check:bff        # BFF 网关契约（白名单 / 动词 / 路径穿越 / CORS / 信封 / 就绪探针 / SSE，依据 NMCPS-ADR-0007、NMCPS-ADR-0010）
pnpm check:ui         # 页面自查（Playwright，需先起服务；默认指向 http://192.168.1.90:3000）
```

> BFF 有两个探针：`GET /health` 只证明进程存活（liveness），`GET /ready` 额外探测上游（200 `ready` / 503 `not_ready` + `upstream.reason`），见 NMCPS-ADR-0010。

> `check:ui` 可用 `CHECK_UI_BASE_URL` 覆盖被测地址（CI 指向本地构建产物 `http://127.0.0.1:3000`），用 `CHECK_UI_SCREENSHOT` 覆盖截图路径。CI 定义在 `.github/workflows/ci.yml`，三组断言与本地命令一致。

> CI 排查用 `sh scripts/ci-doctor.sh`：默认概览最近一次运行与各 job 结论，`logs [run-id]` 拉全量日志并统计 ✅/❌，`artifacts [run-id]` 把产物下到 `ci-logs/downloads/`，`fixtures [run-id]` 顺手把这批产物回填成六份样本（内部转调 `--from-ci`，只取结论为 success 的步骤）。需本机已 `gh auth login`。步骤摘要由 `scripts/ci-summary.sh` 写入：它先用 `--expect` 声明本步骤必须出现的结论行，抽不到就打 `::error` 并以退出码 1 结束（`ci.yml` 里 `|| status=1`），因此「校验跑通了但摘要抽不到结论」会变红而不是静默降级。六条正则只在 `scripts/ci-expectations.sh` 定义一次，`ci.yml` 只写 key（`--expect "$(sh scripts/ci-expectations.sh <key>)"`），`pnpm check:ci-summary` 会反向断言七个调用点都带 `--expect` 且以 `|| status=1` 收尾，再用 `grep -aE` 把每条正则回放到 `scripts/fixtures/ci-logs/<key>.log`（各步骤真实日志尾部，头部写明出处）；措辞一变就红。样本另有 `scripts/fixtures/ci-logs/.manifest.json` 记录每份的 sha256 与声称出处，手改样本而没重新封存会立刻红（⑮～⑰）。样本重采：`node scripts/check-ci-summary.mjs --write-fixtures` 本地重跑四步（自动重封清单），`node scripts/check-ci-summary.mjs --from-ci [run-id]` 直接从那次运行的产物回填全部六份（bff / ui 只能走这条，别再手抄 `gh run view`）——出处里的步骤名与 job 名取自这次运行，⑱ 静态核对它们都还在 `ci.yml` 里；任何一条断言变红时脚本还会打一行 `::error title=步骤摘要自测失败 …::…`（正文折成单行、标题里的 `,` `:` 转义），于是 Checks 页的注解本身就写明哪条断言红了、哪份样本漂了，不必展开日志。重采自带两道自检：某步 `exit≠0` 时跳过该 key、绝不把失败输出固化成样本（`--from-ci` 同理，它读该次运行里每个步骤的结论，非 `success` 的一律跳过），且新样本写回后立刻用表里的正则回放一遍——任一不过都以退出码 1 结束。`--seal` 是应急入口而非第三条重采路径：它只重封清单、能给盘上任意字节盖章，所以正常情况不该用它。现在它必须带 `--reason "…"`——样本与清单不一致又没给理由时直接拒绝封存（清单原样保留、⑯ 继续红），给了理由就先逐条打印「本次封存改动」（字节变了 / 出处变了 旧→新 / 新封存 / 已移除），再排出一段可直接复制的 commit message 草稿（标题 `chore(ci): 手工重封 <keys> 样本 — <理由>`，正文自动附上改动清单）；样本与清单本来就一致时不需要理由，脚本会直说「没有要提交的东西」。

> 新增内容集合目录后需重启 dev server，让 `@nuxt/content` 监视器识别新目录。
