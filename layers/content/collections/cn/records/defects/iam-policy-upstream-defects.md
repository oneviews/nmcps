---
docId: NMCPS-REC-005
title: "上游 `/api/v1/iam/{roles,policies,role-policies,subject-roles}` 缺陷清单（2026-11-04 首测）"
navigation:
  title: "上游 iam 策略与授权缺陷清单"
description: "记录层缺陷清单：对 http://192.168.1.55:8888/api/v1 的 iam/roles、iam/policies、iam/role-policies、iam/subject-roles 做三种会话（平台超管 / 租户管理员 / 零角色账号）穷举探测与 openapi 比对，登记 10 项上游缺陷（无授权校验、系统对象可删、enabled 写入无效、400 回原始 SQL、删除失败用 200 承载、列表过滤残缺且分页无上限、必填校验缺失、tenant_id 入参被忽略、跨租户授权无拦、孤儿关系行），附复现命令、期望行为与对 /system/policy、/system/permission 两页面的影响。"
excerpt: "新代 IAM 角色 / 策略 / 授权端点的 10 项缺陷，附复现与两页面的收敛口径。"
keywords:
  - "defect"
  - "iam"
  - "policy"
  - "role"
  - "upstream"
tier: 5
authority: informative
scope:
  - rec.defects.iam-policy
status: baseline
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-003
  - NMCPS-DESIGN-005
  - NMCPS-ARCH-003
createdAt: "2026-11-04"
updatedAt: "2026-11-04"
icon: "carbon:warning-alt"
tags:
  - "缺陷"
  - "记录层"
  - "IAM"
  - "上游"
  - "策略"
  - "权限"
---

# 上游 `/api/v1/iam/{roles,policies,role-policies,subject-roles}` 缺陷清单（NMCPS-REC-005）

> **职责**：登记本轮对新代 IAM 角色 / 策略 / 授权接口的缺陷结论与复现方法，供上游 iam 侧跟踪，并说明它们如何影响 `/system/policy` 与 `/system/permission` 的落码边界。
> **不在本文**：契约语义以 `NMCPS-ARCH-003`（`layers/content/collections/cn/architecture/1.architecture/iam-architecture.md`）与 `NMCPS-DESIGN-005` §七 / §八（`layers/content/collections/cn/architecture/2.domain/system.md`）为唯一权威；本文只记录「与契约不符 / 值得修」的部分及其现状。
> **与旧代的关系**：`NMCPS-REC-003` 描述的是已退役的旧代 `/role|/permission|/abac|/access`，已置 `superseded`；本文是新代结论，编号用 `UP-RBAC-xx`，与旧代 `UP-POL-0x` 不重叠。

## 一、探测范围与方法

- 目标：`http://192.168.1.55:8888/api/v1`，路径前缀 `/iam/roles`、`/iam/policies`、`/iam/role-policies`、`/iam/subject-roles`。
- 方法：① 以 `/swagger/openapi.json`（127 条路径）比对端点清单；② 用**三种会话**分别做正向、缺参、重复、越权、跨租户穷举 —— 平台超管 `admin`（`tenant_id = null`）、临时租户管理员（`POST /iam/users` + `AssignRole` 造出来，用完软删）、零角色账号（同法造但不分配角色）；③ 写操作一律用探针对象（自建角色 / 策略 / 用户），结束时软删回收。
- 结论口径：**12 个端点可用** —— `GET|POST /iam/roles`、`GET|PUT|DELETE /iam/roles/{id}`、`GET|POST /iam/policies`、`GET|PUT|DELETE /iam/policies/{id}`、`GET /iam/role-policies`、`POST /iam/role-policies/{AttachPolicy,DetachPolicy}`、`GET /iam/subject-roles`、`POST /iam/subject-roles/{AssignRole,RevokeRole}`；**`/permission`、`/abac/rule`、`/access/dryrun` 在新代 openapi 中 0 命中**（缺口 G3 / G4 / G5 由「契约未知」升级为「端点缺失」）。

## 二、上游缺陷（10 项）

编号 `UP-RBAC-0x` 是本文与 `NMCPS-DESIGN-005` §7.5 / §8.5 及代码注释之间的稳定引用。

| 编号 | 严重度 | 现象 | 复现 | 期望 |
| :--- | :--- | :--- | :--- | :--- |
| UP-RBAC-01 | 高 | **无授权校验**：零角色账号（仅 `subject-roles` 无绑定）照样 `GET|POST|DELETE /iam/roles`、`GET /iam/policies`、`GET /iam/users` 全部 200，且能建角色再删角色 | 造一个不分配角色的用户并登录，读 IAM 四个资源 | IAM 管理端点按策略 `actions` 鉴权，越权回 `403` |
| UP-RBAC-02 | 高 | **系统对象无保护**：`DELETE /iam/roles/{id}` 对 `is_system=true` 的角色返回 `200 {code:0}`，实测删掉了种子角色 `r_tenant_viewer_isp_a` | `DELETE /iam/roles/r_tenant_viewer_isp_a` | 系统角色 / 策略只读，回 `403`；软删也不允许 |
| UP-RBAC-03 | 高 | **`enabled` 写入被忽略**：`PUT /iam/roles/{id} {enabled:false}` 回 `200`，回读仍 `true`；`PUT /iam/policies/{id}` 同 | 建角色 → PUT `enabled:false` → GET | 启停生效，或明确文档化「不支持启停」 |
| UP-RBAC-04 | 高 | **400 回原始 PostgreSQL 错误文本**：无 envelope、无业务码，且泄露表名 / 约束名 —— 重复 `code` → `ERROR: duplicate key value violates unique constraint \"uk_sys_role_tenant_code\" (SQLSTATE 23505)`；非法 `document` → `SQLSTATE 22P02`；挂不存在的 policy → `SQLSTATE 23503` | 见 §四 | 回 `400 { code, message }` 业务码，禁止透传数据库错误 |
| UP-RBAC-05 | 高 | **失败通道不统一**：`DELETE /iam/roles/not-a-uuid` 回 **HTTP 200 + `{code:400,message:\"资源不存在或无权访问\"}`**；而 `GET /iam/roles/{id}` 不存在回 **HTTP 400 + 纯文本 `记录不存在`** | 见 §四 | 统一为 HTTP 4xx + 单一 envelope |
| UP-RBAC-06 | 中 | **过滤残缺 + 分页无上限**：`/iam/roles` 只认 `keyword` / `code`，`enabled` / `tenant_id` 静默忽略；`/iam/policies` 只认 `keyword`（`code=tenant.viewer`、`policy_type=system`、`enabled=false` 全被忽略，都回 10 条）；`page_size=1000` 原样生效（24 条 subject-roles 全返），`page=0&page_size=0` 退回默认 | 见 §四 | 声明支持的过滤项并生效，非法值报错；`page_size` 设上限 |
| UP-RBAC-07 | 中 | **必填校验缺失**：`POST /iam/roles` 空 body → `200 {code:0,id}`，落一条 `code` / `name` 皆空的角色；`POST /iam/users` 省略 `email` 撞 `uk_sys_user_tenant_email`（`email` 实为必填且唯一，openapi 却标可选） | 见 §四 | 必填校验 + `400` 业务码 |
| UP-RBAC-08 | 高 | **`tenant_id` 入参被忽略**：平台超管 `POST /iam/users {tenant_id:'t_isp_a'}` 落库仍 `tnt_default`；`POST /iam/roles` / `/iam/policies` 同理（一律落会话租户 `tnt_default`）→ 无法跨租户建号 / 建角色 | 见 §四 | 平台会话可按入参落任意租户；或删掉该字段并在契约里写明「归属由会话决定」 |
| UP-RBAC-09 | 高 | **跨租户授权无拦**：租户管理员 `POST /iam/subject-roles/AssignRole {role_id:'r_platform_admin'}` 给自己的用户回 `200`（可撤销，实测已回收）；且租户会话 `GET /iam/tenants` 回 4 条（跨租户可见） | 见 §四 | 指派校验角色与主体同租户；租户会话只回本租户 |
| UP-RBAC-10 | 中 | **关系表不随主体 / 对象软删清理**：软删用户后 `subject-roles` 行残留（实测一条孤儿）；软删角色后 `role-policies` 与 `subject-roles` 行同样残留（实测 `rpr_isp_a_viewer` / `srr_isp_viewer` 指向已删角色） | 见 §四 | 级联软删关系行，或在读端点过滤已删对象 |

## 三、对两页面的影响

`/system/policy` 与 `/system/permission` 只依赖下面这段「最小可信面」，不把缺陷当契约：

- 可用能力：策略 CRUD、角色 CRUD、关系读写（`role-policies`）、主体授受（`subject-roles`）。
- 不可依赖：任何「身份决定能否操作」的判断（UP-RBAC-01 / 09）、启停（UP-RBAC-03）、跨租户建对象（UP-RBAC-08）、服务端必填校验（UP-RBAC-07）、稳定的失败码（UP-RBAC-04 / 05）。
- 已下线：ABAC 规则段（G4）、授权试算（G5）、权限点目录（G3）—— 三者在新代都**没有端点**，不是「暂时不可用」。
- 页面收敛口径写在 `NMCPS-DESIGN-005` §7.3 / §8.3，本文不重复。

## 四、复现命令

`BASE` = `http://192.168.1.55:8888/api/v1`，`AT` = 平台超管 access token，`TT` = 租户管理员 access token。

```bash
# 登录（种子：admin / Admin@123456；租户管理员需自建后 AssignRole）
AT=$(curl -s -X POST "$BASE/iam/login" -H 'content-type: application/json' \
  -d '{"username":"admin","password":"Admin@123456"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["access_token"])')

# UP-RBAC-01 零角色账号照样读写 IAM 管理端点
# （造号 + 不分配角色 + 登录，然后逐个 GET/POST/DELETE）
curl -s "$BASE/iam/roles?page=1&page_size=100" -H "authorization: Bearer $ZT" | jq '.code, .data.total'
curl -s -X POST "$BASE/iam/roles" -H "authorization: Bearer $ZT" -H 'content-type: application/json' \
  -d '{"code":"probe_zero_role","name":"zero"}' | jq .

# UP-RBAC-02 系统角色可删（慎用：会真的删掉种子角色）
curl -s -X DELETE "$BASE/iam/roles/r_tenant_viewer_isp_a" -H "authorization: Bearer $AT"

# UP-RBAC-03 enabled 写入无效
RID=$(curl -s -X POST "$BASE/iam/roles" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d '{"code":"probe_c4c_r2","name":"R2"}' | jq -r .id)
curl -s -X PUT "$BASE/iam/roles/$RID" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d "{\"id\":\"$RID\",\"name\":\"R2-renamed\",\"enabled\":false}" | jq .
curl -s "$BASE/iam/roles/$RID" -H "authorization: Bearer $AT" | jq '.data.name, .data.enabled'
# 期望：enabled 变 false；实测仍 true（name 生效）

# UP-RBAC-04 400 回原始 SQL
curl -s -X POST "$BASE/iam/policies" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d '{"name":"dup","code":"tenant.viewer","policy_type":"system","document":"[]"}'
curl -s -X POST "$BASE/iam/policies" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d '{"name":"bad","code":"probe_bad_doc","policy_type":"custom","document":"not-json"}'

# UP-RBAC-05 两条失败通道
curl -s -o /dev/null -w '%{http_code}\\n' -X DELETE "$BASE/iam/roles/not-a-uuid" -H "authorization: Bearer $AT"
curl -s -o /dev/null -w '%{http_code}\\n' "$BASE/iam/roles/00000000-0000-0000-0000-000000000000" -H "authorization: Bearer $AT"

# UP-RBAC-06 过滤残缺 + 分页无上限
curl -s "$BASE/iam/policies?page=1&page_size=100&code=tenant.viewer" -H "authorization: Bearer $AT" | jq '.data.total'
curl -s "$BASE/iam/subject-roles?page=1&page_size=1000" -H "authorization: Bearer $AT" | jq '.data.total, (.data.list|length)'

# UP-RBAC-07 必填校验缺失
curl -s -X POST "$BASE/iam/roles" -H "authorization: Bearer $AT" -H 'content-type: application/json' -d '{}' | jq .
curl -s -X POST "$BASE/iam/users" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d '{"username":"probe_no_mail","password":"Probe@123456"}'

# UP-RBAC-08 tenant_id 入参被忽略（超管建号落到 tnt_default）
UID_=$(curl -s -X POST "$BASE/iam/users" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d '{"username":"probe_t2","password":"Probe@123456","email":"probe_t2@example.test","tenant_id":"t_isp_a"}' | jq -r .id)
curl -s "$BASE/iam/users/$UID_" -H "authorization: Bearer $AT" | jq '.data.tenant_id'

# UP-RBAC-09 跨租户指派（用租户管理员会话）
curl -s -X POST "$BASE/iam/subject-roles/AssignRole" -H "authorization: Bearer $TT" -H 'content-type: application/json' \
  -d "{\"subject_type\":\"user\",\"subject_id\":\"<ta-user-id>\",\"role_id\":\"r_platform_admin\"}"
curl -s -X POST "$BASE/iam/subject-roles/RevokeRole" -H "authorization: Bearer $TT" -H 'content-type: application/json' \
  -d "{\"subject_type\":\"user\",\"subject_id\":\"<ta-user-id>\",\"role_id\":\"r_platform_admin\"}"

# UP-RBAC-10 孤儿关系行（对比 users 与 subject-roles 的 subject_id 集合）
curl -s "$BASE/iam/subject-roles?page=1&page_size=100" -H "authorization: Bearer $AT" | jq -r '.data.list[].subject_id' | sort -u > /tmp/sr.txt
curl -s "$BASE/iam/users?page=1&page_size=100" -H "authorization: Bearer $AT" | jq -r '.data.list[].id' | sort -u > /tmp/us.txt
comm -23 /tmp/sr.txt /tmp/us.txt   # 有绑定、但用户已不存在
```

## 五、环境副作用与还原

本轮探测在共享联调实例上留下了两处副作用，**须由上游改库还原**（API 无法自愈）：

| 副作用 | 成因 | 还原方式 |
| :--- | :--- | :--- |
| 种子角色 `r_tenant_viewer_isp_a` 被软删 | `UP-RBAC-02`：删除系统角色回 `200`（探测时误伤） | `UPDATE sys_role SET deleted_at = NULL WHERE id = 'r_tenant_viewer_isp_a';` —— 其 `role-policies`（`rpr_isp_a_viewer`）与 `subject-roles`（`srr_isp_viewer`）行仍在，撤销软删即可复原 |
| 两条孤儿关系行（指向已软删的探针用户 / 角色） | `UP-RBAC-10`：关系表不随软删清理 | 可留作 `UP-RBAC-10` 的现场证据；清理用 `DELETE FROM sys_subject_role_relation WHERE subject_id NOT IN (SELECT id FROM sys_user WHERE deleted_at IS NULL)`（表名以实际上游为准） |

自建探针对象（角色 `probe_c4c_*`、策略 `probe_c4c_pol*`、用户 `probe_c4c_*` / `probe_t2`）均已软删，回收后 `roles` / `policies` / `role-policies` 计数回到种子值 9 / 10 / 10。

## 六、未验证项

- 跨租户**删除**他人角色 / 策略是否被拦：只验证了「读取范围按会话租户过滤」，未对另一租户的对象发起删除 —— 该实例是共享环境，失败形态不可预测，不做破坏性验证。
- `policy_type` 的取值集合：实测 10 条全为 `system`，`custom` 只在自建探针里出现（写入被接受），无法确认上游是否按类型分支。
- `subject_type` 的取值集合：只验证 `user`；`group` / `api_key` 是否支持未探测（`/iam/groups`、`/iam/api-keys` 端点存在但种子为空）。
- `document` 的语义校验：只验证「非法 JSON 被 jsonb 拒绝」，未验证合法但不合 policy 语法的 `document`（如 `Action` 写成字符串）是否被接受。
- 平台会话建对象为何落 `tnt_default`（而不是报「缺少租户」）：可能与超管账号本身挂在默认租户有关，需上游确认。
- `PUT /iam/policies/{id}` 的**真实环境**写回：C4c-1 只用 `check:bff` 的假上游验证了「只发 `name` / `document` / `description` 三项、其余字段不发」的请求形状与成功分支；真实实例上的改名称 + 改描述各手测一次前，勿把「编辑已落库」当作既成事实（`enabled` 仍按 `UP-RBAC-03` 视为无效）。

