---
docId: NMCPS-REC-002
title: "上游 `/api/v1/account` 缺陷清单（2026-11-01 首测 / 2026-11-03 复测）"
navigation:
  title: "上游 account 缺陷清单"
description: "记录层缺陷清单：对 http://192.168.1.55:8888/api/v1 的 /account、/account/{code}、/account/{code}/status、/account/role、/tenant/{id}/member 做双身份（超级管理员 / 租户管理员）穷举探测与 swagger 比对，登记 8 项上游缺陷（租户管理员越级建号【已闭环】、accountLevel=0 过滤失效、缺参 500、无改资料与删号端点、列表缺租户归属且时区不一致、超级管理员无法分配角色、建号新增 tenantId 必填、accountLevel=4 归服务账号），附复现命令、期望行为与对 `/system/user` 页面的影响。"
excerpt: "上游 /account 的 8 项缺陷（含 2026-11-03 复测新增 / 闭环结论），附复现与对用户管理页的影响。"
keywords:
  - "defect"
  - "account"
  - "upstream"
  - "iam"
  - "triage"
tier: 5
authority: informative
scope:
  - rec.defects.account
status: superseded
supersededBy: NMCPS-ADR-0018
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-003
  - NMCPS-DESIGN-005
  - NMCPS-ARCH-003
createdAt: "2026-11-01"
updatedAt: "2026-11-03"
icon: "carbon:warning-alt"
tags:
  - "缺陷"
  - "记录层"
  - "IAM"
  - "上游"
  - "账号管理"
---

# 上游 `/api/v1/account` 缺陷清单（NMCPS-REC-002）

> **代际说明（2026-11-04）**：本文的探测对象是**已退役**的旧代 go-zero 网关；该实例已下线，仓库与联调环境统一改为 `http://192.168.1.55:8888/api/v1`。下文复现命令中的主机:端口已按当前实例改写，**但结论只描述旧代** —— 需在新代复测后才可作为落码依据。本文保留作历史，`status` 置 `superseded`。

> **职责**：登记本轮对上游账号接口的缺陷结论与复现方法，供上游 iam 侧跟踪，并说明它们如何影响 `/system/user` 的落码边界。
> **不在本文**：契约语义本身以 `NMCPS-ARCH-003`（`layers/content/collections/cn/architecture/1.architecture/iam-architecture.md`）与 `NMCPS-DESIGN-005` §六（`layers/content/collections/cn/architecture/2.domain/system.md`）为唯一权威；本文只记录「与契约不符 / 值得修」的部分及其现状。

## 一、探测范围与方法

- 目标：`http://192.168.1.55:8888/api/v1`，路径前缀 `/account/*`、`/tenant/*/member`、`/role`、`/permission`。
- 方法：① 以 `/swagger/specs/gateway.json` 比对端点清单（`PATCH` 未开放，只有 `GET` / `POST` / `PUT` / `DELETE`）；② 以**超级管理员**与**租户管理员**两种身份分别做正向、缺参、越权、跨租户、状态越界穷举；③ 记录 BFF 透传后的实际行为（`GATEWAY_RESOURCES` 白名单 + slug 透传，不改变上游判定）。
- 结论口径：**5 个端点可用**（`GET/POST /account`、`GET /account/{code}`、`PUT /account/{code}/status`、`POST|DELETE /account/role`、`POST|DELETE /tenant/{id}/member`）；**`PUT /account/{code}` 与 `DELETE /account/{code}` 不存在**（`405`，无 `Allow` 之外的写方法）。

## 二、上游缺陷（8 项）

编号 `UP-ACC-0x` 是本文与 `NMCPS-DESIGN-005` §6.5 之间的稳定引用。

| 编号 | 严重度 | 现象 | 复现 | 期望 |
| :--- | :--- | :--- | :--- | :--- |
| UP-ACC-01 | ~~高~~ **已闭环** | **租户管理员越级建号**：2026-11-01 首测时 `accountLevel: 0` / `2` / `4` 全部 `200`（可越级）。**2026-11-03 复测已修**：同级或更高一律 `20103 只能向下管控：不可操作与自身同级或更高权限的账号/角色` | 以租户管理员 AT 调 `POST /api/v1/account`，`accountLevel` 依次取 `0` / `1` / `2` / `3` / `4` / `9`（账号名重复以规避落库）：`0` / `1` → `20103`，`2` / `3` → 通过等级校验（回 `10302` 重名），`4` → `20102`，`9` → `10101` | 已符合：只允许创建严格低于自身等级的账号 |
| UP-ACC-02 | 中 | **`accountLevel=0` 作为过滤条件被忽略**：`GET /account?accountLevel=0` 返回全量（零值被当「未提供」），`=1` / `=2` 正常过滤 | 同一状态下分别请求 `accountLevel=0` 与 `accountLevel=1`，比对 `total` | 零值也应作为有效过滤值；或显式拒绝并文档化 |
| UP-ACC-03 | 中 | **缺参 / 越界等级报 `500 10509`**：空 body、缺 `accountLevel`、`status: 5` 均返回 `500`（与 `UP-AUTH-03` 同源）；**复测补充**：`accountLevel: 9` 已改为 `10101`，但缺 `tenantId` 同样回 `10101` 而非字段级信息 | 逐条发缺字段请求 | `400 10101` + 字段级信息 |
| UP-ACC-04 | 中 | **无改资料、无删号端点**：`PUT /account/{code}`、`DELETE /account/{code}` 均 `405`；`displayName` 建号后不可改 | `curl -X PUT .../account/ACC…`、`curl -X DELETE ...` | 补齐 `PUT`（改显示名 / MFA 开关）与 `DELETE`（或明确「只停用」为设计） |
| UP-ACC-05 | 低 | **列表缺租户归属 + 时区不一致**：列表项无 `tenantId` / `tenantCode`（超级管理员无法判断账号属于哪个租户）；`createdAt` 在 `GET` 返回本地时、在 `POST` 返回 UTC | 超级管理员 `GET /account` 与 `POST /account` 后比对同一字段 | 列表补 `tenantId` / `tenantCode`；时间统一 UTC 并标注 |
| UP-ACC-06 | 低 | **超级管理员无法分配角色**：`POST /account/role` 以超级管理员身份恒 `10201`（域拒绝），租户管理员对本租户账号可用 | 两种身份对同一 `accountCode` 调 `POST /account/role` | 平台级账号的角色由平台域管理，应可分配或明确返回「不可用」语义 |
| UP-ACC-07 | 中 | **建号新增 `tenantId` 必填且只存在于上游**：`POST /account` 缺 `tenantId`（或传 `0`）→ `10101 请求参数不合法：缺少必填参数 tenantId`。租户管理员不传也能建（上游从令牌推断），**超级管理员不传必然失败**；但 `GET /account` 与 `/auth/whoami` 均无租户字段可复用 | 同一体不带 `tenantId` 以两种身份各建一次号：超级管理员 → `10101`，租户管理员 → 通过 | ① 租户上下文应可从令牌统一推断，或② 在 `GET /account` 回填 `tenantId` 让客户端有据可选 |
| UP-ACC-08 | 低 | **`accountLevel: 4` 语义已归位但仍不可建**：`4` → `20102 账号等级与归属层不匹配：平台层仅可建 L0，租户层为 L1-L3，服务账号由系统自动开通`。同一文案里「平台层仅可建 L0」与实测（超级管理员可建 `1`–`3`）自相矛盾 | 两种身份各发 `accountLevel: 4` | 文案与判定对齐；服务账号的查询入口需另行说明 |

补充观察（非缺陷，但页面必须知晓）：

- **状态枚举**：`1` 启用 / `2` 禁用 / `3` 锁定 / `4` 待激活（swagger）；`0`、`5` 不可写。
- **路径段是 `accountCode`**（`ACC…`），不是 `accountId`；跨租户操作返回 `10301`，不泄露存在性。
- **账号名唯一**：重复建号 `10302`；弱口令 `20101`（与近 3 次历史重复另码）。
- **`mustResetPassword` 生效面**：建号后账号 `status` 为 `4`，首次登录强制改密仍是纯前端约定（同 `UP-AUTH` 记录）。
- **建号可选等级（复测口径）**：严格低于自己且 `≤ 3` —— 超级管理员 `L1`–`L3`、租户管理员 `L2`–`L3`。`2` / `3` 在上游文案里属「租户层」，除等级数字外没有其它差异化字段。



## 三、对 `/system/user` 落码的影响

页面只依赖已确认可用的端点（`GET /account`、`POST /account`、`PUT /account/{code}/status`，以及超级管理员建号时选租户用的 `GET /tenant`），并把缺口显式挡在 UI 之外：

| 缺陷 | 页面处置 |
| :--- | :--- |
| UP-ACC-01 | **已闭环**。页面仍按同一口径收敛：等级下拉 = 严格低于自己且 `≤ 3`（超级管理员 `L1`–`L3`、租户管理员 `L2`–`L3`）。复测前只给 `1`，等于让租户管理员只能提交必被 `20103` 拒绝的值（2026-11-03 修复） |
| UP-ACC-02 | 不提供「只看超级管理员」筛选项（`accountLevel=0` 过滤无效，发了反而误导） |
| UP-ACC-03 | 表单前置校验（必填、口令长度、等级范围），并把 `10101` / `10509` 映射成可读文案 |
| UP-ACC-04 | 不提供编辑与删除按钮；「禁用」承接删除语义，`displayName` 只读展示 |
| UP-ACC-05 | 不展示租户列；`createdAt` 原样展示，不做时区换算、不加「(UTC)」后缀 |
| UP-ACC-06 | 不提供角色绑定入口；角色 / 权限归 `/system/permission` |
| UP-ACC-07 | 超级管理员建号时强制选「所属租户」（`GET /tenant`），`tenantId` 随请求提交；租户管理员不出现该字段（上游从令牌推断） |
| UP-ACC-08 | 等级下拉上限锁在 `3`；`20102` 映射成「本级不能建该等级」并回填到等级字段 |

客户端收敛**不是安全边界**：BFF 只做白名单透传，越权判定仍在上游，缺陷须由上游修。

## 四、复现命令（可直接粘贴）

```bash
BASE=http://192.168.1.55:8888/api/v1
# 取令牌（超级管理员 / 租户管理员各一份）
AT=$(curl -s -X POST "$BASE/auth/login" -H 'content-type: application/json' \
  -d '{"accountName":"admin","password":"<pwd>"}' | jq -r .data.accessToken)

# UP-ACC-01（2026-11-03 复测已闭环）租户管理员同级 / 越级建号 → 20103
# 账号名故意用已存在的「tenantadmin」：等级校验先于唯一性校验，不会落库
for L in 0 1 2 3 4 9; do curl -s -X POST "$BASE/account" -H "authorization: Bearer $AT" \
  -H 'content-type: application/json' \
  -d "{\"accountName\":\"tenantadmin\",\"displayName\":\"probe\",\"password\":\"<pwd>\",\"accountLevel\":$L}"; echo; done
# 期望：0/1 → 20103；2/3 → 10302（等级通过，仅重名）；4 → 20102；9 → 10101

# UP-ACC-07 超级管理员建号缺 tenantId → 10101 缺少必填参数 tenantId
curl -s -X POST "$BASE/account" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d '{"accountName":"admin","displayName":"probe","password":"<pwd>","accountLevel":1}'

# UP-ACC-07 补充：tenantId 取值的唯一来源是 GET /tenant
curl -s "$BASE/tenant" -H "authorization: Bearer $AT" | jq '.data.list[].tenantId'

# UP-ACC-02 等级零值过滤失效（应只回超级管理员，实测回全量）
curl -s "$BASE/account?page=1&pageSize=200&accountLevel=0" -H "authorization: Bearer $AT" | jq .data.total

# UP-ACC-03 缺参报 500（应 400 10101）
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$BASE/account" \
  -H "authorization: Bearer $AT" -H 'content-type: application/json' -d '{}'

# UP-ACC-04 不存在改资料 / 删号端点
curl -s -o /dev/null -w '%{http_code}\n' -X PUT "$BASE/account/ACC00000000" -H "authorization: Bearer $AT"
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE "$BASE/account/ACC00000000" -H "authorization: Bearer $AT"

# UP-ACC-06 超级管理员分配角色被域拒（实测 10201）
curl -s -X POST "$BASE/account/role" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d '{"accountCode":"ACC00000000","roleCode":"viewer"}'
```

## 五、闭环状态

| 项 | 状态 |
| :--- | :--- |
| UP-ACC-01 | **已闭环**（2026-11-03 复测：同级 / 越级回 `20103`） |
| UP-ACC-02～UP-ACC-08 | **未闭环**（上游 iam 侧待修），页面已按 §三 收敛 |
| `/system/user` 页面 | 按「最小可信面」落码，不把缺口当契约；建号等级与租户选择随复测口径更新 |
| BFF 白名单 | `account` / `tenant` 已在 `GATEWAY_RESOURCES`，透传不改判定 |
| 文档同步 | `NMCPS-DESIGN-005` §六（cn/en，0.5.7）、本文、`doc-map` 同步更新 |

## 六、未验证项

- 超级管理员对平台账号的「角色分配」是否另有平台域端点：当前只探测了 `/account/role`，未发现替代路径。
- `accountLevel: 2` / `3` 的业务差异：上游文案只把它们统称「租户层」，返回字段里没有任何区分，无法断定用途。
- 超级管理员建号成功后 `tenantId` 是否真实生效（新建账号落到所选租户）：验证需要真实落库一个新账号，本轮只用重名请求卡在「等级 / 唯一性」校验阶段，未落库。
- 移动端 / 桌面端窗口内表现：`/system/user` 只在浏览器与 `check:ui` 的桩环境下验证，未上真机。
