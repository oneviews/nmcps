---
title: "快速开始"
description: "内容中心开发环境的快速启动指南：环境准备、安装依赖、启动开发服务器与运行校验命令。"
excerpt: "环境准备、安装依赖、启动 dev server 与运行校验。"
createdAt: "2026-10-25"
updatedAt: "2026-11-05"
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
pnpm check:ci-summary # 步骤摘要自测：二十三项断言，钉住 ci-summary.sh 的 --expect 语义、ci.yml 七个调用点的接线（正则唯一来源 scripts/ci-expectations.sh），回放真实日志样本 scripts/fixtures/ci-logs/（含 sha256 清单与产物回填的出处核对），任何一条断言变红时都打出 `::error` 注解（Checks 页直接写明哪条红了），`scripts/ci-doctor.sh drill` 的接线（usage / dispatch / trap 回滚 / `--yes` / 只推 main / `--keys` 批量），`.github/workflows/drill-nightly.yml` 的定时演练接线（cron / 用 PAT 推 / concurrency / 残留漂移兜底 / 失败开 issue）与其 `DRILL_TOKEN` 到期体检，以及 `scripts/ci-doctor.sh nightly` 那个只读核对入口（只认 schedule / 没数据不假绿 / `^{tree}` 证净变更为零 / 不许写仓库）
pnpm check:i18n       # 文案自查（十组断言：键集合对齐 / en 无中文 / 值形状 / 占位符一致 / 系统管理页引用闭合 / 全站 t() 引用闭合 / 模板无硬编码中文）
pnpm build:server     # 先构建 BFF 产物，check:bff 消费 .output/server
pnpm check:bff        # BFF 网关契约（白名单 / 动词 / 路径穿越 / CORS / 信封 / 就绪探针 / SSE，依据 NMCPS-ADR-0007、NMCPS-ADR-0010）
pnpm check:ui         # 页面自查（Playwright，需先起服务；默认指向 http://192.168.1.90:3000）
```

> BFF 有两个探针：`GET /health` 只证明进程存活（liveness），`GET /ready` 额外探测上游（200 `ready` / 503 `not_ready` + `upstream.reason`），见 NMCPS-ADR-0010。

> `check:ui` 可用 `CHECK_UI_BASE_URL` 覆盖被测地址（CI 指向本地构建产物 `http://127.0.0.1:3000`），用 `CHECK_UI_SCREENSHOT` 覆盖截图路径。CI 定义在 `.github/workflows/ci.yml`，三组断言与本地命令一致。

> CI 排查用 `sh scripts/ci-doctor.sh`：默认概览最近一次运行与各 job 结论，`logs [run-id]` 拉全量日志并统计 ✅/❌，`artifacts [run-id]` 把产物下到 `ci-logs/downloads/`，`fixtures [run-id]` 顺手把这批产物回填成六份样本（内部转调 `--from-ci`，只取结论为 success 的步骤）。需本机已 `gh auth login`。步骤摘要由 `scripts/ci-summary.sh` 写入：它先用 `--expect` 声明本步骤必须出现的结论行，抽不到就打 `::error` 并以退出码 1 结束（`ci.yml` 里 `|| status=1`），因此「校验跑通了但摘要抽不到结论」会变红而不是静默降级。六条正则只在 `scripts/ci-expectations.sh` 定义一次，`ci.yml` 只写 key（`--expect "$(sh scripts/ci-expectations.sh <key>)"`）；`pnpm check:ci-summary` 反向断言七个调用点都带 `--expect` 且以 `|| status=1` 收尾，再把每条正则用 `grep -aE` 回放到 `scripts/fixtures/ci-logs/<key>.log`，并核对 `.manifest.json` 里的 `sha256` 与出处（⑮～⑰）。样本怎么重采、哪些入口算应急，见下一节的表。

> 新增内容集合目录后需重启 dev server，让 `@nuxt/content` 监视器识别新目录。

## CI 样本重采的四个入口

`scripts/fixtures/ci-logs/` 里的六份样本是各步骤**真实日志的尾部**，措辞一变就要重采。重采有四种入口，只有前两种是正常路径；表里第三列是每个入口**之后必须做的事**，第四列是没做到时**哪条断言会红**（编号对应 `scripts/check-ci-summary.mjs` 头部注释的 ⑫～⑳）。

| 入口 | 何时允许 | 之后必须做什么 | 谁抓它 |
| --- | --- | --- | --- |
| `node scripts/check-ci-summary.mjs --write-fixtures` | 改的是本机能跑的四步（lint / typecheck / i18n / governance）小结措辞，或首次补样本 | 只写 `exit=0` 的步骤（失败输出绝不固化成样本）；新样本写回即用表里的正则回放；顺手封存清单，不需要再跑 `--seal` | ⑫⑮ 清单与样本双向一致、⑬ 正则回放、⑯ `sha256` |
| `node scripts/check-ci-summary.mjs --from-ci [run-id]`（`sh scripts/ci-doctor.sh fixtures [run-id]` 是同一入口） | bff / ui 只能走这条（本地起不来它们的被测环境）；想把最近一次绿运行的六份一起同步 | 只取该次运行里 `conclusion=success` 的步骤，非 `success` 直接跳过并 `exit 1`；出处写成 `CI run <id> 步骤 "<step>"（job: <job>）产物 <artifact>/<file> 尾部`；写回后回放正则 | 结论过滤本身、⑯⑰ 字节与出处互证、⑱ 步骤名 / 产物名必须还在 `ci.yml` 里 |
| `node scripts/check-ci-summary.mjs --seal --reason "…"` | **应急**：清单损坏或产物过期，上两条机器路线都用不了 | 理由必填（不给就拒绝封存、清单一个字节不写）；先看它打出的「本次封存改动」，再粘贴它排好的 commit message 草稿——写明改了哪一份、为什么走不了机器路线 | 强制 `--reason`；被拒绝期间 ⑯ 一直红 |
| 手抄 `gh run view` 输出 | 永不（唯一能伪造样本来源的做法） | — | ⑭ 每份样本必须带 `# source:` 出处行、⑯ 手改不重封必红、⑰ 只改头部也会与清单两处 source 打架 |

红了先看 Checks 页的注解：每条失败的断言都会打一行 `::error title=步骤摘要自测失败（第 N 条）：<断言名>::<明细首行>（共 N 行明细，见日志）`，注解给定位、日志给完整明细（`❌` 块）。

### 演练真红注解

注解链路要定期自证一次，否则「样本漂了会红」只是信仰：

```bash
sh scripts/ci-doctor.sh drill ui --dry-run            # 只注入 + 核对本地期望文案，不提交不推送
sh scripts/ci-doctor.sh drill ui --yes                # 完整演练：推临时提交 → 核对 Checks 注解 → 自动回滚
sh scripts/ci-doctor.sh drill --keys all --dry-run    # 六份样本一起漂，验「共 N 行明细」折行
sh scripts/ci-doctor.sh drill --keys lint,governance --yes
```

`drill` 往 `scripts/fixtures/ci-logs/<key>.log` 尾部注入一行漂移（只动正文，不碰 `# source:`，所以踩的是 ⑯ 而不是 ⑰），推一个临时提交，等那次运行变红，把该提交的 failure 注解与**本地现场生成**的期望文案逐字比对，然后回滚并把回滚那次运行跑到绿。期望文案不硬编码，改断言措辞不用改演练。`key` 默认 `ui`；`--yes` 必填（它会往 main 推两次提交）；前置条件是工作区干净且 `HEAD == origin/main`。

`--keys a,b,c`（或 `--keys all`）一次演练多份：⑯ 给每份漂移样本一行明细，而注解只放**首行** + `（共 N 行明细，见日志）`，所以批量演练顺带验了「多明细折行」——单份演练永远只有一行明细，验不到这条路径。比对不是「找到一条像的就算过」，而是把本地期望的**整个注解集合**与实测集合 `diff`，少一条、多一条、折行丢了都会红。它仍然只产出一条注解：GitHub 每步 10 条 error 注解的上限靠样本漂移撞不到，脚本只在实测条数 >10 时告警——不假装验过上限。

**定时演练**：`.github/workflows/drill-nightly.yml` 每周一 03:00 UTC 自动跑一次 `drill --keys all --yes`（也支持 `workflow_dispatch` 手动重跑，排障不必等下周），失败时开 issue（同标题只留一个开着的，后续失败改成追加评论）。

它依赖仓库 secret `DRILL_TOKEN`（PAT，`contents: write`），原因很硬：用 `GITHUB_TOKEN` 推的提交**不会再触发 `ci.yml`**，演练只会「等不到运行」并判自己无效——那是假绿。所以缺这个 secret 时工作流**直接红**并打出 `::error` 说明要配什么，绝不静默跳过。

PAT 会过期，所以它在演练前先做一次体检（名字叫 `Warn early when DRILL_TOKEN is about to expire`）：用 token 打一次 `GET /user`，读 GitHub 在响应头里回的 `github-authentication-token-expiration`。剩 ≤`WARN_DAYS`（默认 14）天时只打 `::warning` 并把到期日写进步骤摘要——本周演练照跑，别让一次本来能跑完的演练被提前判死；**401 或已过期**才红，因为那时演练注定推不上去，早说清楚省一轮排查；API 抖动（非 200）或 token 本来就没有到期时间，只记一行日志、不阻断演练。到期后换一个新的 fine-grained PAT（`Contents: Read and write`）再 `gh secret set DRILL_TOKEN --repo <owner>/<repo>` 覆盖即可。这九项由断言 ㉒ 钉住。

自动化还多一层兜底：正常路径由 drill 自己的 `trap` 回滚；万一 runner 在演练中途被杀，最后一道 `always()` 步骤会检查 `origin/main` 上有没有 `# drill: 注入漂移` marker 行，有就只剥这几行再补一个回滚提交（除了 marker 行一个字节都不碰，所以不会掩盖真实漂移）。

人工闸门没有取消：日常仍是 `--yes` 手动演练，nightly 只是「保证每周至少跑一次」的补网；脚本自己的 `--yes`、`HEAD == origin/main`、干净工作区三道前置条件一条没放宽。

周一之后核对不用手敲一串 `gh`：`sh scripts/ci-doctor.sh nightly [run-id]` 是这条定时链路的只读体检——只认 `schedule` 触发的那次运行（手工 `workflow_dispatch` 绿了说明不了定时链路还在跑），还没有 schedule 运行时它报 ⏳ 并**退出 1**（「没数据」不许当「通过」，与 `--expect` 同一条原则），顺手把运行里体检出来的到期日打出来，再用 `git rev-parse <回滚>^{tree}` 与演练前那棵树对比证明**净变更为零**（只看 commit message 会漏掉「回滚提交里夹带了别的改动」），最后扫六份样本的残留 marker、查有没有挂着的失败 issue。它自己绝不 commit / push：核对工具一旦会写仓库，就会改动被核对的对象。这七项由断言 ㉓ 钉住。

它**不是**第五条重采入口：样本本来没坏，是故意弄坏再修回来。所以演练收尾只有一种合法状态——工作区干净、`HEAD == origin/main`、回滚那次运行 `success` 且 0 条 failure 注解；任一条不成立，`drill` 自己会以退出码 1 结束（中途崩了也有 `trap` 兜底回滚）。
