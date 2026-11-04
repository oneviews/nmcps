---
docId: NMCPS-REC-003
title: "上游 `/api/v1/{role,permission,abac,access}` 缺陷清单（2026-11-01 实测）"
navigation:
  title: "上游 policy 缺陷清单"
description: "记录层缺陷清单：对 http://192.168.1.55:8888/api/v1 的 /role、/role/{code}/permission、/permission、/abac/rule、/access/dryrun 做双身份（超级管理员 / 租户管理员）穷举探测与 swagger 比对，登记 10 项上游缺陷（无生命周期端点、DSL 不校验语法、授权回读缺 effect、入参与过滤残缺、等级越界、试算忽略上下文、账号↔角色只写不读、超管域拒绝、内置角色只读、时区不一致），附复现命令、期望行为与对 `/system/policy`、`/system/permission` 两页面的影响。"
excerpt: "上游策略与权限域的 10 项缺陷，附复现与两页面的收敛口径。"
keywords:
  - "defect"
  - "policy"
  - "permission"
  - "upstream"
  - "iam"
tier: 5
authority: informative
scope:
  - rec.defects.policy
status: superseded
supersededBy: NMCPS-ADR-0018
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-003
  - NMCPS-DESIGN-005
  - NMCPS-ARCH-003
createdAt: "2026-11-01"
updatedAt: "2026-11-01"
icon: "carbon:warning-alt"
tags:
  - "缺陷"
  - "记录层"
  - "IAM"
  - "上游"
  - "策略"
  - "权限"
---

# 上游 `/api/v1/{role,permission,abac,access}` 缺陷清单（NMCPS-REC-003）

> **代际说明（2026-11-04）**：本文的探测对象是**已退役**的旧代 go-zero 网关；该实例已下线，仓库与联调环境统一改为 `http://192.168.1.55:8888/api/v1`。下文复现命令中的主机:端口已按当前实例改写，**但结论只描述旧代** —— 需在新代复测后才可作为落码依据。本文保留作历史，`status` 置 `superseded`。

> **职责**：登记本轮对上游策略 / 权限接口的缺陷结论与复现方法，供上游 iam 侧跟踪，并说明它们如何影响 `/system/policy` 与 `/system/permission` 的落码边界。
> **不在本文**：契约语义以 `NMCPS-ARCH-003`（`layers/content/collections/cn/architecture/1.architecture/iam-architecture.md`）与 `NMCPS-DESIGN-005` §七 / §八（`layers/content/collections/cn/architecture/2.domain/system.md`）为唯一权威；本文只记录「与契约不符 / 值得修」的部分及其现状。

## 一、探测范围与方法

- 目标：`http://192.168.1.55:8888/api/v1`，路径前缀 `/role`、`/role/{roleCode}/permission`、`/permission`、`/abac/rule`、`/access/dryrun`。
- 方法：① 以 swagger 比对端点清单（无 `PATCH`，只有 `GET` / `POST` / `PUT` / `DELETE`）；② 以**超级管理员**与**租户管理员**两种身份分别做正向、缺参、越权、跨租户、越界等级穷举；③ 记录经 BFF 透传后的实际行为（`GATEWAY_RESOURCES` 白名单 + slug 透传，不改变上游判定）。
- 结论口径：可用端点 10 个（`GET /role`、`GET|POST|DELETE /role/{code}`、`GET|POST|DELETE /role/{code}/permission`、`GET|POST /permission`、`GET|POST /abac/rule`、`POST /access/dryrun`）；**规则无改删端点**（`PUT` / `PATCH` / `DELETE /abac/rule/{id}` 全部 `404`）。

## 二、上游缺陷（10 项）

编号 `UP-POL-0x` 是本文与 `NMCPS-DESIGN-005` §7.5 / §8.5 及代码注释之间的稳定引用。

| 编号 | 严重度 | 现象 | 复现 | 期望 |
| :--- | :--- | :--- | :--- | :--- |
| UP-POL-01 | 高 | **写操作端点残缺**：规则建了不能改也不能删（`PUT` / `PATCH` / `DELETE /abac/rule/{id}` → `404`）；`POST /permission` 存在但无删除端点；角色没有 `PUT /role/{code}/status`，`status` 只能改库 | 逐一请求上述路径并比对 swagger | 补齐规则生命周期与权限点删除；角色状态显式文档化或提供端点 |
| UP-POL-02 | 高 | **`conditionDsl` 不做语法校验**：写入非法 govaluate 表达式仍 `200`；同 `ruleCode` 重复则 `409 10302` | `POST /abac/rule` 带 `conditionDsl: "("` | 写入前校验语法并回 `400 10101` + 位置信息 |
| UP-POL-03 | 高 | **授权回读不含 `effect`**：`POST .../permission` 可写 `effect=2`（拒绝），`GET .../permission` 只回权限点本体，拒绝写入后不可见 | 写入 `{permCode, effect: 2}` 后回读 | 回读带 `effect`，否则「拒绝」无法审计 |
| UP-POL-04 | 中 | **入参与过滤能力残缺**：`GET /abac/rule` 只认 `page` / `pageSize`（无 `keyword`）；`POST /role` 缺任一必填回 `500 10509` 而非 `400 10101` | `GET /abac/rule?keyword=x`、`POST /role` 空 body | 列表补 `keyword`；缺参回 `400 10101` |
| UP-POL-05 | 中 | **等级越界与越权**：租户管理员建同级 / 更高等级角色回 `20103`，`roleLevel > 4` 回 `40308`（文案不区分两者） | 以租户管理员 `POST /role` 带 `roleLevel: 0/1/9` | 区分「越权」与「越界」，并回字段级信息 |
| UP-POL-06 | 中 | **试算忽略可选上下文**：`clientIp` / `deviceCode` / `resourceTags` / `accountLevel` 上游接受但实测不参与判定 | 同 `accountId` / `path` / `method` 固定，仅改上述四字段比对结果 | 要么参与判定，要么拒绝未知字段 |
| UP-POL-07 | 中 | **账号↔角色只写不读**：`GET /account/role?accountId=` 不存在（`404`），`POST|DELETE /account/role` 可用 | `GET /account/role?accountId=…` | 提供读端点，否则绑定结果不可审计 |
| UP-POL-08 | 中 | **超级管理员对策略域全拒**：`/role`、`/permission`、`/abac/rule`、`/access/dryrun` 以超管身份恒 `401 10201` | 超管 AT 逐一请求四端点 | 平台级角色 / 规则应可管理，或文档化「策略域仅租户」 |
| UP-POL-09 | 中 | **内置角色只读却返回三种码**：授权 `40307`、撤销 `40305`、删除 `40303`，同一语义三种文案来源 | 对 `isBuiltin: true` 角色分别调 `POST` / `DELETE` / `DELETE /role/{code}` | 统一为一个「内置角色只读」业务码 |
| UP-POL-10 | 低 | **时区不一致**：`GET /role` 的 `createdAt` 为 UTC，`POST /role` 返回本地时 | 建角色后比对同一字段 | 统一 UTC 并标注 |

补充观察（非缺陷，但页面必须知晓）：

- **路径段是 `roleCode`**（不是 `roleId`）：`/role/{roleCode}/permission`、`DELETE /role/{roleCode}`。
- **`GET /role/{code}` 存在**，但本仓两页面不单独调用：列表项已含全部展示字段。
- **权限点目录很小**（实测 24 条），可一次全量拉取；`resourceType=0` 会被上游当「未提供」。
- **`roleCode: ""` 是全局规则**：上游用空串而不是 `null`，页面原样展示。

## 三、对 `/system/policy` 与 `/system/permission` 落码的影响

| 缺陷 | 页面处置 |
| :--- | :--- |
| UP-POL-01 | `/system/policy` 只做只读巡检：不提供新建 / 修改 / 删除 / 启停入口（一个只能创建、不能回收的写入口比没有入口更危险）；`/system/permission` 不提供角色启停与权限点增删 |
| UP-POL-02 | DSL 原样展示 + 提供复制，不做「美化」或「修正」；建角色编码冲突 `10302` 内联到 `roleCode` |
| UP-POL-03 | 授权开关只表达 `ALLOW`，不提供「拒绝」开关（写了看不见） |
| UP-POL-04 | 规则搜索在**客户端**过滤（先分页拉全，上限 `MAX_RULE_PAGES` 兜底）；建角色必填先在本地拦下 |
| UP-POL-05 | 等级下拉按身份收敛（租户管理员只给 `2`–`4`），`20103` / `40308` 映射成可读文案 |
| UP-POL-06 | 试算表单只提供 `accountId` / `path` / `method` 三个字段，不摆不生效的控件 |
| UP-POL-07 | 不提供账号↔角色绑定入口 |
| UP-POL-08 | 超管进入两页面只看到身份说明 Alert，**不发起任何请求** |
| UP-POL-09 | 内置角色列表照常展示，授权开关与删除入口禁用并给出原因 |
| UP-POL-10 | `createdAt` 原样展示，不做时区换算 |

客户端收敛**不是安全边界**：BFF 只做白名单透传，越权判定仍在上游，缺陷须由上游修。

## 四、复现命令（可直接粘贴）

```bash
BASE=http://192.168.1.55:8888/api/v1
AT=$(curl -s -X POST "$BASE/auth/login" -H 'content-type: application/json' \
  -d '{"accountName":"admin","password":"<pwd>"}' | jq -r .data.accessToken)

# UP-POL-01 规则无改删端点（应可用，实测 404）
curl -s -o /dev/null -w '%{http_code}\n' -X PUT "$BASE/abac/rule/1" -H "authorization: Bearer $AT"
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE "$BASE/abac/rule/1" -H "authorization: Bearer $AT"

# UP-POL-02 非法 DSL 仍 200
curl -s -X POST "$BASE/abac/rule" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d '{"ruleCode":"probe_dsl","ruleName":"probe","conditionDsl":"(","priority":99}'

# UP-POL-03 拒绝写入后回读不到 effect
curl -s -X POST "$BASE/role/$ROLE/permission" -H "authorization: Bearer $AT" \
  -H 'content-type: application/json' -d '{"permCode":"asset:device:read","effect":2}'
curl -s "$BASE/role/$ROLE/permission?page=1&pageSize=100" -H "authorization: Bearer $AT" | jq '.data.list[0]'

# UP-POL-04 规则列表无 keyword；建角色缺参 500
curl -s "$BASE/abac/rule?page=1&pageSize=5&keyword=x" -H "authorization: Bearer $AT" | jq .data.total
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$BASE/role" -H "authorization: Bearer $AT" \
  -H 'content-type: application/json' -d '{}'

# UP-POL-05 等级越界 / 越权
curl -s -X POST "$BASE/role" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d '{"roleCode":"probe_l0","roleName":"probe","roleLevel":0}'

# UP-POL-07 账号角色读端点不存在
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/account/role?accountId=1" -H "authorization: Bearer $AT"

# UP-POL-08 超管调策略域（应可用，实测 401 10201）
curl -s "$BASE/abac/rule?page=1&pageSize=5" -H "authorization: Bearer $AT" | jq .code
```

## 五、闭环状态

| 项 | 状态 |
| :--- | :--- |
| UP-POL-01～UP-POL-10 | **未闭环**（上游 iam 侧待修），两页面已按第三节收敛 |
| `/system/policy`、`/system/permission` | 按「最小可信面」落码，不把缺口当契约 |
| BFF 白名单 | `role` / `permission` / `abac` / `access` 已纳入 `GATEWAY_RESOURCES`，透传不改判定 |
| 文档同步 | `NMCPS-DESIGN-005` §七 / §八（cn/en）、本文、`doc-map`、`shared/constants/docIds.ts` 同步更新 |

## 六、未验证项

- `conditionDsl` 的 govaluate 支持范围（运算符、函数白名单）：只探到「不校验语法」，未探语义边界。
- `status` 的取值域未穷举：规则 / 角色实测只见 `1`（生效）、`2`（停用），`0` 无样本 —— 页面因此把非 `1` / `2` 一律落到 `status.unknown` 并带出原值。
- `access/dryrun` 在真实 ABAC 规则触发时的判定顺序（`priority` 升序是否唯一依据）：无稳定样本。
- 移动端 / 桌面端窗口内表现：两页面只在浏览器与 `check:ui` 的桩环境下验证，未上真机。
