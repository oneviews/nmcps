---
docId: NMCPS-REC-001
title: "上游 `/api/v1/auth` 缺陷清单（2026-10-31 实测）"
navigation:
  title: "上游 auth 缺陷清单"
description: "记录层缺陷清单：对 http://192.168.1.55:10000/api/v1 的 /auth/* 七个端点做穷举探测（swagger 比对 + 实调 + BFF 端到端），登记 6 项上游缺陷（刷新轮换非原子、缺参 500、Content-Type 未校验、OPTIONS 404、mfaType 缺省、firstReset 跳过旧口令校验）与 3 项仓库内漂移，并附复现步骤、期望行为与已闭环/未闭环清单。"
excerpt: "上游 /auth 的 6 项缺陷与 3 项仓库内漂移，附复现与期望。"
keywords:
  - "defect"
  - "auth"
  - "upstream"
  - "iam"
  - "triage"
tier: 5
authority: informative
scope:
  - rec.defects.auth
status: baseline
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-003
  - NMCPS-ARCH-003
createdAt: "2026-10-31"
updatedAt: "2026-10-31"
icon: "carbon:warning-alt"
tags:
  - "缺陷"
  - "记录层"
  - "IAM"
  - "上游"
---

# 上游 `/api/v1/auth` 缺陷清单（NMCPS-REC-001）

> **职责**：登记本轮对上游认证接口的缺陷结论与复现方法，供上游 iam 侧跟踪。
> **不在本文**：契约语义本身以 `NMCPS-ARCH-003`（`layers/content/collections/cn/architecture/1.architecture/iam-architecture.md`）§7 为唯一权威；本文只记录「与契约不符 / 值得修」的部分及其现状。

## 一、探测范围与方法

- 目标：`http://192.168.1.55:10000/api/v1`，路径前缀 `/auth/*`。
- 方法：① 以 `/swagger/specs/gateway.json` 比对端点清单；② 对每个端点做正向、缺参、越权、错误凭据、重复调用、并发调用穷举；③ 用 BFF（`PORT=39881 NUXT_BFF_UPSTREAM_BASE=<上游>`）做端到端复验，确认缺陷是否被 BFF 吸收。
- 结论口径：**7 个端点全部可用**（`login`、`whoami`、`token/refresh`、`logout`、`password`、`mfa/bind`、`mfa/confirm`），未登记路径（`/auth/session`、`/auth/captcha`、`/auth/mfa/disable`、`/auth/mfa/verify`、`/auth/validate`）一律 `404`，无隐藏能力。BFF 端到端 10/10 通过。

## 二、上游缺陷（6 项）

| 编号 | 严重度 | 现象 | 复现 | 期望 |
| :--- | :--- | :--- | :--- | :--- |
| UP-AUTH-01 | 高 | **刷新轮换非原子**：同一 RT 并发 3 次全部 `200`，返回 3 个不同 `sessionId`，三把 AT 均可 `whoami`；注销其一其余仍有效 | 同一 `refreshToken` 同时发起 3 个 `POST /auth/token/refresh`；随后逐个 `GET /auth/whoami` | 单次消费：仅首个成功，其余 `20205`。当前等于给出 RT 重放窗口 |
| UP-AUTH-02 | 高 | **`firstReset: true` 跳过旧口令校验**：body 只带 `newPassword` 即改密成功（`200`） | 用任意有效 AT 调 `POST /auth/password {"newPassword":"…","firstReset":true}` | `firstReset` 只应影响「是否强制改密」的判定，不应免除 `oldPassword`；会话被劫持即可改密夺号 |
| UP-AUTH-03 | 中 | **缺入参一律 `500 10509`**：`login {}`、`login` 缺 `password`、`refresh {}`、`password {}`、缺 `newPassword`、`mfa/confirm {}` | 逐条发空/缺字段请求 | `400 10101` + 字段级信息（客户端错误不应报成服务崩溃） |
| UP-AUTH-04 | 中 | **`Content-Type` 未校验**：`application/x-www-form-urlencoded` 打 `login` → `500 10509`；`logout` 无 body 却 `200` | 用 form 编码提交登录 | `415` 或明确接受两种编码 |
| UP-AUTH-05 | 低 | **`OPTIONS /api/v1/auth` → `404`**（对比 `/api/v1/account` → `405 + Allow`） | `curl -X OPTIONS .../api/v1/auth` | 统一预检响应，便于能力发现与跨域预检 |
| UP-AUTH-06 | 低 | **`mfaType` 缺省即 TOTP，`0` 未登记却可用**：`{}` / `{mfaType:0}` / `{mfaType:1}` 同效；仅 `99` → `400 20109` | 三种 body 分别 `POST /auth/mfa/bind` | 显式校验并文档化缺省值；`0` 应报错 |

补充观察（非缺陷，但需知晓）：

- **禁用账号与口令错误同码**：`status:2` 后登录返 `401 20201`，前端无法提示「账号停用」。
- **改密不吊销旧令牌**：`password` 成功后旧 AT 仍 `200`，令牌泄露无法靠改密止损。
- **MFA 登录分支是 `401 20203`**，不是「200 + `mfaRequired: true`」；上游从不返回 `mfaRequired`。
- **密码策略**：弱口令 `400 20101`（`123456` / `abc` / `12345678` 均拒），与近 3 次历史重复 `400 20302`。
- **强制改密是纯前端约定**：`mustResetPassword: true` 的账号在未改密时 `whoami` 仍 `200`，上游不拦接口。
- **改密立即生效**：`0 / 200 / 1000 / 3000ms` 四次复测，旧口令均 `401 20201`，无宽限窗口。

## 三、仓库内漂移（3 项，已随本轮修复关闭）

| 编号 | 现象 | 处理 |
| :--- | :--- | :--- |
| REPO-01 | 假上游 MFA 分支回 `400 20205 mfa_required`，真实回 `401 20203`，自查长期假绿 | `scripts/lib/bff-harness.mjs` 改为 `401 / 20203`，`check:bff` 用例同步 |
| REPO-02 | 登录页只认 `20205`，MFA 账号看不到动态口令输入框 | `app/pages/auth/login.vue` 改认 `20203`（`submit` 与 `describeError` 两处） |
| REPO-03 | 假上游刷新为严格单次消费，真实上游允许并发使用 | 假上游改为「并发窗口内允许重复使用、串行复用仍 `401`」，并新增并发用例锁定该语义 |

## 四、已闭环与未闭环的验证项

已闭环（测试账号 `AUTOTEST-*`，用完置 `status: 2`）：

- 改密成功路径、旧口令失效、旧 AT 仍有效；
- `mfa/bind` + 真实 TOTP → `mfa/confirm` 成功，`whoami.mfaEnabled` 转 true；
- MFA 账号带正确 `mfaCode` 登录成功、不带 `20203`、带错 `20204`；
- 禁用后登录 `20201`；
- `mustResetPassword: true` 建号 → 登录带标志 → `firstReset` 改密后标志清除；
- 密码复杂度与历史重复两条策略。

未闭环：AT 30 分钟 / RT 7 天自然过期；浏览器多标签页并发刷新的实际表现。

## 五、复测方法

1. 起 BFF：`PORT=39881 NUXT_BFF_UPSTREAM_BASE=http://192.168.1.55:10000/api/v1 node .output/server/index.mjs`。
2. 直连上游跑 UP-AUTH-01（并发刷新）、UP-AUTH-03/04（缺参与 Content-Type）——这三项只在上游侧可见，BFF 已吸收。
3. 走 BFF 复验端到端：`pnpm check:bff`（假上游）与手工登录（真上游）各一轮。
4. 本地 curl 记得 `--noproxy '*'`（环境变量里有 `http_proxy`）。
