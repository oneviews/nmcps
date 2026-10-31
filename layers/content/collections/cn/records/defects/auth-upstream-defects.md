---
docId: NMCPS-REC-001
title: "上游 `/api/v1/auth` 缺陷清单（2026-10-31 实测）"
navigation:
  title: "上游 auth 缺陷清单"
description: "记录层缺陷清单：对 http://192.168.1.55:10000/api/v1 的 /auth/* 七个端点做穷举探测（swagger 比对 + 实调 + BFF 端到端），登记 6 项上游缺陷（刷新轮换非原子、缺参 500、Content-Type 未校验、OPTIONS 404、mfaType 缺省、firstReset 跳过旧口令校验）与 4 项仓库内漂移，并附复现步骤、期望行为、已闭环/未闭环清单，以及 6 份可直接提交上游的工单文本（含实测 curl 与输出）。"
excerpt: "上游 /auth 的 6 项缺陷与 4 项仓库内漂移，附复现与期望。"
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

编号 `UP-AUTH-0x` 是本文与 `NMCPS-ARCH-003` §7.8 之间的稳定引用；上游工单号不写进本表，统一登记在 §七，避免两处编号打架。

| 编号 | 严重度 | 现象 | 复现 | 期望 |
| :--- | :--- | :--- | :--- | :--- |
| UP-AUTH-01 | 高 | **刷新轮换非原子**：同一 RT 并发 3 次全部 `200`，返回 3 个不同 `sessionId`，三把 AT 均可 `whoami`；注销其一其余仍有效 | 同一 `refreshToken` 同时发起 3 个 `POST /auth/token/refresh`；随后逐个 `GET /auth/whoami` | 单次消费：仅首个成功，其余 `20205`。当前等于给出 RT 重放窗口 |
| UP-AUTH-02 | 高 | **`firstReset: true` 跳过旧口令校验**：body 只带 `newPassword` 即改密成功（`200`） | 用任意有效 AT 调 `POST /auth/password {"newPassword":"…","firstReset":true}` | `firstReset` 只应影响「是否强制改密」的判定，不应免除 `oldPassword`；会话被劫持即可改密夺号 |
| UP-AUTH-03 | 中 | **缺入参一律 `500 10509`**：`login {}`、`login` 缺 `password`、`refresh {}`、`password {}`、缺 `newPassword`、`mfa/confirm {}` | 逐条发空/缺字段请求 | `400 10101` + 字段级信息（客户端错误不应报成服务崩溃） |
| UP-AUTH-04 | 中 | **`Content-Type` 未校验**：`application/x-www-form-urlencoded` 打 `login` → `500 10509`；`logout` 无 body 却 `200` | 用 form 编码提交登录 | `415` 或明确接受两种编码 |
| UP-AUTH-05 | 低 | **`OPTIONS /api/v1/auth` → `404`**（对比 `/api/v1/account` → `405 + Allow`） | `curl -X OPTIONS .../api/v1/auth` | 统一预检响应，便于能力发现与跨域预检 |
| UP-AUTH-06 | 低 | **`mfaType` 缺省即 TOTP，`0` 未登记却可用**：`{}` / `{mfaType:0}` / `{mfaType:1}` 同效（都回 `otpauthUrl`）；`9` / `99` → `400 20109` | 五种 body 分别 `POST /auth/mfa/bind` | 显式校验并文档化缺省值；`0` 应报错 |

补充观察（非缺陷，但需知晓）：

- **禁用账号与口令错误同码**：`status:2` 后登录返 `401 20201`，前端无法提示「账号停用」。
- **改密不吊销旧令牌**：`password` 成功后旧 AT 仍 `200`，令牌泄露无法靠改密止损。
- **MFA 登录分支是 `401 20203`**，不是「200 + `mfaRequired: true`」；上游从不返回 `mfaRequired`。
- **密码策略**：弱口令 `400 20101`（`123456` / `abc` / `12345678` 均拒），与近 3 次历史重复 `400 20302`。
- **强制改密是纯前端约定**：`mustResetPassword: true` 的账号在未改密时 `whoami` 仍 `200`，上游不拦接口。
- **改密立即生效**：`0 / 200 / 1000 / 3000ms` 四次复测，旧口令均 `401 20201`，无宽限窗口。

## 三、仓库内漂移（4 项，已随本轮修复关闭）

| 编号 | 现象 | 处理 |
| :--- | :--- | :--- |
| REPO-01 | 假上游 MFA 分支回 `400 20205 mfa_required`，真实回 `401 20203`，自查长期假绿 | `scripts/lib/bff-harness.mjs` 改为 `401 / 20203`，`check:bff` 用例同步 |
| REPO-02 | 登录页只认 `20205`，MFA 账号看不到动态口令输入框 | `app/pages/auth/login.vue` 改认 `20203`（`submit` 与 `describeError` 两处） |
| REPO-03 | 假上游刷新为严格单次消费，真实上游允许并发使用 | 假上游改为「并发窗口内允许重复使用、串行复用仍 `401`」，并新增并发用例锁定该语义 |
| REPO-04 | **强制改密分支是死代码**：登录页把 `mustResetPassword` 塞进 ref 后立刻 `navigateTo(redirect)`，警告 `v-if` 永远渲染不到；上游又不拦接口 ⇒ 初始口令可长期使用 | 带标志时改为跳 `/user/security` + 常驻 toast（`duration: 0`）；假上游加 `reset-user` 账号；`check:ui` 锁「落点 + 提示」、`check:bff` 锁「标志透传」 |

## 四、已闭环与未闭环的验证项

已闭环（测试账号 `AUTOTEST-*`，用完置 `status: 2`）：

- 改密成功路径、旧口令失效、旧 AT 仍有效；
- `mfa/bind` + 真实 TOTP → `mfa/confirm` 成功，`whoami.mfaEnabled` 转 true；
- MFA 账号带正确 `mfaCode` 登录成功、不带 `20203`、带错 `20204`；
- 禁用后登录 `20201`；
- `mustResetPassword: true` 建号 → 登录带标志 → `firstReset` 改密后标志清除；
- 密码复杂度与历史重复两条策略。

自查守卫（假上游，不依赖真上游可复现）：`check:bff` 81 项覆盖 `20203` / `20204` 双码透传与 `mustResetPassword` 标志透传；`check:ui` 自建模式 52 项覆盖 MFA 补码登录与强制改密落点（`/user/security` + 常驻提示）。

未闭环：AT 30 分钟 / RT 7 天自然过期；浏览器多标签页并发刷新的实际表现。

## 五、复测方法

1. 起 BFF：`PORT=39881 NUXT_BFF_UPSTREAM_BASE=http://192.168.1.55:10000/api/v1 node .output/server/index.mjs`。
2. 直连上游跑 UP-AUTH-01（并发刷新）、UP-AUTH-03/04（缺参与 Content-Type）——这三项只在上游侧可见，BFF 已吸收。
3. 走 BFF 复验端到端：`pnpm check:bff`（假上游，81 项）与 `pnpm check:ui`（自建假上游 + 构建产物，52 项）各一轮，再补一次真上游手工登录。
4. 本地 curl 记得 `--noproxy '*'`（环境变量里有 `http_proxy`）。

## 六、工单文本（可直接提交）

以下 6 份文本自包含：标题、环境、复现、实测输出、期望、影响、验收标准。复现命令与输出均为 2026-10-31 对 `http://192.168.1.55:10000/api/v1` 的原样记录。所有命令前缀统一：

```bash
UP=http://192.168.1.55:10000/api/v1
AT=$(curl -s --noproxy '*' -X POST "$UP/auth/login" -H 'content-type: application/json' \
  -d '{"accountName":"admin","password":"Admin@123456"}' | jq -r '.data.accessToken')
```

### 工单 1 ·【高】刷新令牌轮换非原子，同一 RT 并发可用三次

**复现**

```bash
RT=$(curl -s --noproxy '*' -X POST "$UP/auth/login" -H 'content-type: application/json' \
  -d '{"accountName":"admin","password":"Admin@123456"}' | jq -r '.data.refreshToken')
for i in 1 2 3; do
  curl -s --noproxy '*' -X POST "$UP/auth/token/refresh" -H 'content-type: application/json' \
    -d "{\"refreshToken\":\"$RT\"}" -o /tmp/r$i.json &
done; wait
jq -r '[.code, (.data.sessionId // "-")] | @tsv' /tmp/r1.json /tmp/r2.json /tmp/r3.json
```

**实测**：三路全 `200 / code:0`，`sessionId` 三个互不相同（`cc094934…` / `ab8f003a…` / `512f0f93…`）；三把 AT 调 `GET /auth/whoami` 全 `200`；注销第一把后第二把仍 `200`。

**期望**：RT 单次消费——首个 `200`，其余 `401 20205`；被轮换的旧会话失效。

**影响**：RT 泄露后有并发重放窗口，可长期维持多个独立会话（含被注销后残留的会话）。

**验收**：同一 RT 并发 N 路刷新，成功数恒为 1；`sessionId` 全局唯一；注销后同源会话全部失效。

### 工单 2 ·【高】`firstReset: true` 跳过旧口令校验，仅凭会话即可改密

**复现**（`$AT` 必须是**测试账号**的令牌；用 admin 的令牌会真的把 admin 口令改掉）

```bash
# 先用测试账号换一枚 AT（不要用上面的 admin 令牌）
AT=$(curl -s --noproxy '*' -X POST "$UP/auth/login" -H 'content-type: application/json' \
  -d '{"accountName":"AUTOTEST-TICKET","password":"Ticket@123456"}' | jq -r '.data.accessToken')
curl -s --noproxy '*' -X POST "$UP/auth/password" -H "authorization: Bearer $AT" \
  -H 'content-type: application/json' \
  -d '{"newPassword":"Ticket@654321","firstReset":true}'
```

**实测**：`200 {"code":0,"msg":"ok"}`——body 中没有 `oldPassword`；随后旧口令登录 `401 20201`、新口令登录 `200`。

**期望**：`firstReset` 只影响「是否强制改密」的判定，不得免除 `oldPassword`；缺 `oldPassword` 应 `400` 且不改密。

**影响**：任何拿到 AT 的一方（XSS、日志泄漏、共享终端）可直接改密夺号，且原用户被锁在门外。

**验收**：缺 `oldPassword` 的 `password` 请求一律 `400`；`firstReset` 仅能免除「强制改密闸门」，不能免除凭据校验（或改为服务端一次性 reset token）。

### 工单 3 ·【中】缺入参一律 `500 10509`，把客户端错误报成服务崩溃

**复现**

```bash
UP=http://192.168.1.55:10000/api/v1
curl -s --noproxy '*' -X POST "$UP/auth/login" -H 'content-type: application/json' -d '{}'
curl -s --noproxy '*' -X POST "$UP/auth/login" -H 'content-type: application/json' -d '{"accountName":"admin"}'
curl -s --noproxy '*' -X POST "$UP/auth/token/refresh" -H 'content-type: application/json' -d '{}'
curl -s --noproxy '*' -X POST "$UP/auth/password" -H "authorization: Bearer $AT" -H 'content-type: application/json' -d '{}'
curl -s --noproxy '*' -X POST "$UP/auth/mfa/confirm" -H "authorization: Bearer $AT" -H 'content-type: application/json' -d '{}'
```

**实测**：五条全部 `500 {"code":10509,"msg":"系统内部错误","traceId":"…"}`。

**期望**：`400` + 明确的业务码与字段级信息（如 `10101 参数校验失败`，附 `field`）。

**影响**：客户端无法区分「自己传错」与「服务挂了」；监控被无效 5xx 噪声污染；BFF 只能统一兜成 `bff_upstream_error`。

**验收**：上表五条均返回 `400` 且响应体指出缺失字段；该路径不产生 5xx 日志。

### 工单 4 ·【中】`Content-Type` 未校验，form 编码直接 500、`logout` 无 body 却 200

**复现**

```bash
curl -s --noproxy '*' -X POST "$UP/auth/login" \
  -H 'content-type: application/x-www-form-urlencoded' \
  -d 'accountName=admin&password=Admin@123456'
curl -s --noproxy '*' -X POST "$UP/auth/logout" -H "authorization: Bearer $AT" \
  -H 'content-type: application/x-www-form-urlencoded'
```

**实测**：登录 `500 10509`；`logout` 空 body `200 {"code":0,"data":{"ok":true}}`。

**期望**：两个端点行为一致——要么 `415 Unsupported Media Type`（明确只接受 `application/json`），要么显式支持两种编码；不能一端 500 一端 200。

**影响**：任何表单提交的客户端（含部分网关/代理重写）会得到 500 而非可解释错误；`logout` 的宽容使「媒体类型校验」语义自相矛盾。

**验收**：非 JSON 编码在 `/auth/*` 各写端点返回同一状态码（`415` 或 `400`），`logout` 不再例外。

### 工单 5 ·【低】`OPTIONS /api/v1/auth` 返回 `404`，与 `/api/v1/account` 的 `405 + Allow` 不一致

**复现**

```bash
curl -s -i --noproxy '*' -X OPTIONS "$UP/auth" | head -3
curl -s -i --noproxy '*' -X OPTIONS "$UP/account" | head -3
```

**实测**：`/auth` → `404`，body 为网关的 `404 page not found`；`/account` → `405`，`Allow: POST, GET`。

**期望**：同类资源的预检响应一致（`204/405 + Allow`），或由网关统一处理 CORS 预检。

**影响**：浏览器跨域预检失败，能力发现与自动化探测拿不到 `Allow`。

**验收**：`OPTIONS /api/v1/auth` 不再 `404`；`/auth/*` 与 `/account` 的 `Allow` 语义一致。

### 工单 6 ·【低】`mfaType` 缺省值未文档化，`0`/`1` 同效且都返回 TOTP 的 `otpauthUrl`

**复现**

```bash
for B in '{}' '{"mfaType":0}' '{"mfaType":1}' '{"mfaType":9}' '{"mfaType":99}'; do
  echo "== $B"
  curl -s --noproxy '*' -X POST "$UP/auth/mfa/bind" -H "authorization: Bearer $AT" \
    -H 'content-type: application/json' -d "$B"
done
```

**实测**：`{}` / `{mfaType:0}` / `{mfaType:1}` 均 `200` 且都带 `otpauthUrl`；`{mfaType:9}` 与 `{mfaType:99}` → `400 {"code":20109,"msg":"该 MFA 因子类型暂未实现"}`。

**期望**：枚举值文档化（缺省等于哪个值）；未实现的类型（含 `0`，若确未实现）应报 `20109`；非 TOTP 类型的响应不应携带 `otpauthUrl`。

**影响**：客户端无法确定默认因子；`0` 到底是「默认 TOTP」还是「未实现」，只能靠试。

**验收**：`/docs` 列出 `mfaType` 枚举与缺省值；`0`/`1` 的语义与响应体保持一致（TOTP 才给 `otpauthUrl`）。

> 提交建议：6 份可合并为一个 EPIC，工单 1、2 为高优（安全），3、4 为健壮性，5、6 为一致性。

## 七、上游单号登记（一个 EPIC + 6 子单）

提交后只改这张表：`UP-AUTH-0x` 是仓库内稳定编号（§二 与 `NMCPS-ARCH-003` §7.8 都引用它），上游单号是外部编号，两者不要互相替换。EPIC 标题「【EPIC】`/api/v1/auth` 契约与安全缺陷（6 项，2026-10-31 探测）」，子单标题直接抄 §六 各工单的首行标题。

| 上游单号 | 类型 | 对应缺陷 | 标题（§六） | 状态 | 提交日 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| — | EPIC | UP-AUTH-01…06 | 上游 `/api/v1/auth` 契约与安全缺陷（6 项） | 待提交 | — |
| — | 子单 | UP-AUTH-01 | 刷新令牌轮换非原子，同一 RT 并发可用三次 | 待提交 | — |
| — | 子单 | UP-AUTH-02 | `firstReset: true` 跳过旧口令校验，仅凭会话即可改密 | 待提交 | — |
| — | 子单 | UP-AUTH-03 | 缺入参一律 `500 10509`，把客户端错误报成服务崩溃 | 待提交 | — |
| — | 子单 | UP-AUTH-04 | `Content-Type` 未校验，form 编码直接 500、`logout` 无 body 却 200 | 待提交 | — |
| — | 子单 | UP-AUTH-05 | `OPTIONS /api/v1/auth` 返回 `404`，与 `/api/v1/account` 的 `405 + Allow` 不一致 | 待提交 | — |
| — | 子单 | UP-AUTH-06 | `mfaType` 缺省值未文档化，`0`/`1` 同效且都返回 TOTP 的 `otpauthUrl` | 待提交 | — |

状态口径：`待提交` → `已提交`（填单号与提交日）→ `已修复`（复跑 §五 复测方法后）→ `已验收`（`pnpm check:bff` / `check:ui` 全绿且 §二 该行可删除）。任何一行进入 `已修复` 时，同步改 §二、`NMCPS-ARCH-003` §7.8 与本表状态。
