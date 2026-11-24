# IAM 缺陷报告：AssignRole 写入的关系行对读路径永久不可见

- 报告日期：2026-11-18
- 报障方：实验台前端 / BFF（本仓 `nmcps2`）
- 归属：**上游 IAM 服务**（网关 `http://192.168.1.55:8888/api/v1`，源码不在本仓）
- 严重级别：高 —— 任何「运行期给账号补角色」的操作都不生效，且返回 `success`

## 1. 现象

实验台按能力位渲染（`NMCPS-ADR-0021`）：页面先读 `GET /api/mininet/channel` 的 `capabilities`，没有 `lab:terminal` 就不渲染 Webshell 标签。

真实账号 `alice`（subject `a6541d3f-7880-4bb9-8917-5338d78e6925`，租户 `tnt_default`）已通过 `POST /api/iam/subject-roles/AssignRole` 分配角色 `lab_terminal`，接口回 `success`，但：

```
GET /api/mininet/channel            → capabilities.terminal = false
GET /iam/subject-roles?subject_id=a6541d3f-…   → {"list": null, "total": 0}
```

角色本体是存在的，且租户正确：

```
GET /iam/roles/f1f011d8-d5b0-43b6-9467-2cf8d8d57b67
→ {"id":"f1f011d8-…","tenant_id":"tnt_default","code":"lab_terminal","name":"实验台终端","enabled":true}
```

对照：种子账号 `tenantadmin` 的关系行能读到，权限也正常：

```
GET /iam/subject-roles?subject_id=u_tenant_admin
→ {"list":[{"id":"srr_tenant_admin","tenant_id":"tnt_default","subject_type":"user",
            "subject_id":"u_tenant_admin","role_id":"r_tenant_admin"}], "total":1}
```

差别只有一条：**种子关系行带 `tenant_id = "tnt_default"`，而运行期新分配的行的 `tenant_id` 是 NULL。**

## 2. 复现（4 步，实测于 2026-11-18 03:xx–04:xx）

全程用 `tenantadmin`（同租户管理员）的 access token，base 为 `http://192.168.1.55:8888/api/v1`。

**① 全量关系表里没有 alice 的行**

```
GET /iam/subject-roles?page=1&page_size=200
→ total = 17，17 行全部带 tenant_id="tnt_default"，没有 subject_id = a6541d3f-…
```

**② 重复分配同一条关系 → 唯一约束命中，证明库里其实有这一行**

```
POST /iam/subject-roles/AssignRole
{"subject_type":"user","subject_id":"a6541d3f-…","role_id":"f1f011d8-…"}
→ HTTP 400
  ERROR: duplicate key value violates unique constraint "uk_sys_srr_global_subject_role" (SQLSTATE 23505)
```

**③ 换一个干净账号，写入返回 success，但读不到**

```
POST /iam/subject-roles/AssignRole
{"subject_type":"user","subject_id":"u_bj_01","role_id":"f1f011d8-…"}
→ HTTP 200 {"code":0,"message":"success"}

GET /iam/subject-roles?subject_id=u_bj_01
→ total = 1（只有原来那条 r_tenant_operator，新增的 lab_terminal 不在）

GET /iam/subject-roles?page=1&page_size=200
→ total 仍然是 17（写前 17，写后 17）
```

**④ 反向操作能删掉它，进一步证明行已落库**

```
POST /iam/subject-roles/RevokeRole  {"subject_id":"u_bj_01","role_id":"f1f011d8-…"}
→ HTTP 200 {"code":0,"message":"success"}
```

（复现后已用同一调用撤销，`u_bj_01` 恢复原状，全量仍是 17 行。）

## 3. 根因

`AssignRole` 插入 `sys_subject_role_relation` 时**不写 `tenant_id`**（落 NULL），而所有列表读路径都按调用方上下文的 `tenant_id = <tid>` 过滤。NULL 不等于任何 tid，于是：

- 写：成功 → 行在表里（唯一约束与 Revoke 都能命中）
- 读：任何租户上下文（含同租户管理员）都看不到
- 种子数据带 `tenant_id`，所以老账号一切正常 —— 只有**运行期新分配**的角色 100% 失效

这也是为什么现象看起来「有时好有时坏」：不是间歇，而是「种子数据 / 运行期写入」两类行的差别。

## 4. 建议修法

**首选（改写入端，一行完成）**：`AssignRole` 落库时把 `tenant_id` 写成 `role.tenant_id`；若调用方带租户上下文，再校验二者一致（不一致回 403 或 400），避免跨租户挂关系。平台上分配的角色（`role.tenant_id` 为 NULL）保持 NULL，与本仓 BFF 的判定一致（`NMCPS-ADR-0021 §4.2`，平台角色不授予运行态权限）。

**备选（改读取端）**：读路径对 `tenant_id IS NULL` 的行按「平台级关系」处理 —— 仅平台会话可见。不要把它无条件并入所有租户，否则等于绕过租户隔离（`UP-RBAC-09`）。

**数据修复**：给已有脏行回填

```sql
UPDATE sys_subject_role_relation r
   SET tenant_id = ro.tenant_id
  FROM sys_role ro
 WHERE r.role_id = ro.id
   AND r.tenant_id IS NULL;
```

回填前先 SELECT 一遍确认影响行数，并排除 `role.tenant_id IS NULL` 的平台角色。

## 5. 顺带发现（不影响本次结论，建议一并修）

1. **错误以纯文本返回**：约束冲突时返回 `HTTP 400 + "ERROR: duplicate key value …"`，不是 `{code,message,data}` 信封。本仓 BFF 按信封解析，这类失败会被降级成 502/503，定位成本很高。
2. **`GET /iam/subject-roles` 忽略 `role_id` 参数**：带 `role_id=…` 仍返回全量 17 行。本仓已知此契约（前端按 `subject_id` 查询后自行过滤），如果短期不打算支持，建议在 OpenAPI 里删掉该参数，避免误用。
3. **`role_id` 同时接受 id 与 code 的错觉**：历史行存 `r_tenant_operator` 这类可读 id，新角色 id 是 uuid；传 role 的 `code`（`lab_terminal`）会触发 `fk_sys_srr_role` 外键错误。建议在接口层显式说明「只收 `sys_role.id`」，或在服务端做一次 code→id 解析。

## 6. 验收标准

修复后应同时满足：

```bash
# ① 写入后立刻可读（同租户管理员）
POST /iam/subject-roles/AssignRole {"subject_type":"user","subject_id":"<alice>","role_id":"<lab_terminal id>"}
GET  /iam/subject-roles?subject_id=<alice>          # total ≥ 1，且行内 tenant_id = tnt_default

# ② 主体自己的租户上下文也能读到
GET  /iam/subject-roles?subject_id=<alice>          # 用 alice 自己的 token，total ≥ 1

# ③ BFF 能力位随之上浮
GET  /api/mininet/channel                               # capabilities.terminal = true
```

## 7. 修复验证（2026-11-18，上游修复后复测）

三条验收全部通过，证据如下（同样用 `tenantadmin` 的 token 打 `http://192.168.1.55:8888/api/v1`）：

**① 写入后同租户管理员立刻可读**

```
GET /iam/subject-roles?subject_id=a6541d3f-7880-4bb9-8917-5338d78e6925
→ 200 {"data":{"list":[{"id":"b7fa1e07-f955-47c6-8168-b26260bfe126",
                        "tenant_id":"tnt_default",
                        "subject_type":"user",
                        "subject_id":"a6541d3f-…",
                        "role_id":"f1f011d8-…",
                        "created_at":"2026-11-18T10:43:26.121525+08:00"}],
        "total":1}}
```

行内 `tenant_id` 由 `NULL` 变成 `tnt_default`，且旧数据已回填：

```
GET /iam/subject-roles?page=1&page_size=200
→ total = 20，`tenant_id` 为空的行 = 0
```

**② 主体自己的上下文也能读到**：alice 的 BFF 会话解析出 `lab_terminal`，`GET /api/mininet/channel` 回
`{"read":true,"create":false,"operate":false,"delete":false,"terminal":true,"sniffer":false}`。

**③ 能力位随之上浮到页面**：右栏标签由 `["日志","监控","网络"]` 变成
`["Webshell","日志","监控","网络"]`；点「Webshell」→ 连接 `h1` 得到真实提示符，
敲 `id` 回车返回 `uid=0(root) gid=0(root) groups=0(root)`。
「连通」仍然不出现 —— `lab_sniffer` 尚未创建，`lab:terminal` 也不推导 `lab:operate`。

顺带确认两条「顺带发现」不影响主链路：本次没有触发约束冲突（旧行已随修复回填，不是靠
`RevokeRole` + 重分配绕过的），`GET /iam/subject-roles` 仍忽略 `role_id`（本次未用到该参数）。

**④ 第二个能力位（`lab_sniffer`）同链路可用**：`POST /iam/roles` 建 `lab_sniffer`
（`bcadd871-d4f2-40f5-9ac6-1c4ad28e096f`，落库 `tenant_id = tnt_default`）后 `AssignRole` 给 alice，
`GET /iam/subject-roles?subject_id=a6541d3f-…` 回 `total: 2`，两行 `tenant_id` 都是 `tnt_default`。
`/api/mininet/channel` 变 `{"read":true,"terminal":true,"sniffer":true,其余 false}`，右栏 5 个标签
（Webshell / 日志 / 监控 / 网络 / 连通）；「连通」里只有抓包读数，**探测按钮不出现**（要 `lab:operate`）。
「工具 → 开始抓包」把 `/api/mininet/sniffer/state` 推到 `{"active":true}`、实时流显示「实时」，
「停止抓包」回到 `{"active":false}`。页面上首次点不动是 `runState` 尚未读回（`null`）导致菜单项
`disabled`，约 1 秒后可用，与权限无关。

## 8. 附件

- 实测原始输出：`/tmp/iam-probe.txt`、`/tmp/iam-probe2.txt` … `/tmp/iam-probe6.txt`（本机临时目录，非仓库内容）
- BFF 侧消费规则（**不需要改**，仅供后端确认对齐）：本仓 `server/utils/bff/iamRoles.ts` + `shared/constants/labPermissions.ts`
