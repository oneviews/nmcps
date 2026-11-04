---
docId: NMCPS-REC-004
title: "上游 `/api/v1/audit` 缺陷清单（2026-11-02 实测）"
navigation:
  title: "上游 audit 缺陷清单"
description: "记录层缺陷清单：对 http://192.168.1.55:8888/api/v1/audit 的列表、详情、链式校验与导出端点做双身份（超级管理员 / 租户管理员）穷举探测与 swagger 比对，登记 9 项上游缺陷（租户数据范围未文档化且失效令牌同码、category 大小写敏感且未知值被静默忽略、未知查询参数被忽略且 pageSize 无稳定上限、时间参数双格式且非法值不报错、verify 是写操作且断点是整链序号、导出缺必填回 500、导出无详情与删除端点、导出列表时区偏移 8 小时、详情快照字段恒为空），附复现命令、期望行为与对 `/system/log` 的影响。"
excerpt: "上游审计域的 9 项缺陷，附复现与 `/system/log` 的收敛口径。"
keywords:
  - "defect"
  - "audit"
  - "log"
  - "upstream"
  - "iam"
tier: 5
authority: informative
scope:
  - rec.defects.audit
status: superseded
supersededBy: NMCPS-ADR-0018
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-003
  - NMCPS-DESIGN-005
  - NMCPS-ARCH-003
createdAt: "2026-11-02"
updatedAt: "2026-11-02"
icon: "carbon:warning-alt"
tags:
  - "缺陷"
  - "记录层"
  - "IAM"
  - "上游"
  - "审计"
  - "日志"
---

# 上游 `/api/v1/audit` 缺陷清单（NMCPS-REC-004）

> **代际说明（2026-11-04）**：本文的探测对象是**已退役**的旧代 go-zero 网关；该实例已下线，仓库与联调环境统一改为 `http://192.168.1.55:8888/api/v1`。下文复现命令中的主机:端口已按当前实例改写，**但结论只描述旧代** —— 需在新代复测后才可作为落码依据。本文保留作历史，`status` 置 `superseded`。

> **职责**：登记本轮对上游审计（audit）接口的缺陷结论与复现方法，供上游 iam 侧跟踪，并说明它们如何影响 `/system/log` 的落码边界。
> **不在本文**：契约语义以 `NMCPS-ARCH-003`（`layers/content/collections/cn/architecture/1.architecture/iam-architecture.md`）与 `NMCPS-DESIGN-005` §九（`layers/content/collections/cn/architecture/2.domain/system.md`）为唯一权威；本文只记录「与契约不符 / 值得修」的部分及其现状。

## 一、探测范围与方法

- 目标：`http://192.168.1.55:8888/api/v1`，路径前缀 `/audit`、`/audit/{logCode}`、`/audit/verify`、`/audit/export`。
- 方法：① 以 swagger 比对端点清单；② 以**超级管理员**与**租户管理员**两种身份分别做正向、缺参、越权、跨身份、越界取值穷举；③ 记录经 BFF 透传后的实际行为（`GATEWAY_RESOURCES` 白名单 + slug 透传，不改变上游判定）。
- 结论口径：实测可用端点 5 个（`GET /audit`、`GET /audit/{logCode}`、`POST /audit/verify`、`GET|POST /audit/export`）；**导出任务无详情、无删除端点**。探测期 `GET /audit` 的 `total` 由 `1823` 增至 `1827`，差额全部来自 `verify` 自身写入的日志（见 UP-AUD-05）。
- **复核说明（2026-11-02 补测）**：首轮用登录脚本取到的租户管理员令牌在后续调用时已过期，于是四类端点都回 `401 10201`，被误记为「租户管理员整域拒绝」。重新登录并**当场解码 JWT**（`accountLevel: 1`、`tenantId: 1`）后，同一个账号的五类端点全部 `code: 0`，`GET /audit` 的 `total` 为 1709（超级管理员同刻 1893），返回行的 `accountId` 全为本租户账号。结论：**审计域对租户管理员可用，范围由上游按租户过滤**；UP-AUD-01 已按此更正，页面也不再按身份拦请求。

## 二、上游缺陷（9 项）

编号 `UP-AUD-0x` 是本文与 `NMCPS-DESIGN-005` §9.1～§9.5 及代码注释之间的稳定引用。

| 编号 | 严重度 | 现象 | 复现 | 期望 |
| :--- | :--- | :--- | :--- | :--- |
| UP-AUD-01 | 低 | **租户数据范围未文档化，且「失效令牌」与「越权」共用 `401 10201`**：换用**新签发**令牌后，租户管理员对五类端点全部 `code: 0`，`GET /audit` 的 `total` 比超级管理员少（同一时刻 1893 vs 1709），行内 `accountId` 只落在本租户 —— 范围由上游隐式过滤，swagger 未声明；而令牌过期时回的是 `401 10201`（`未认证或登录态已失效`），与「无权限」无法区分。首轮据此记成「租户管理员整域拒绝」，实为过期令牌伪影，已更正（见 §一 复核说明） | 用过期令牌与新令牌分别请求 `GET /audit?page=1&pageSize=2`，比对 `code` / `total` / 行内 `accountId` | swagger 声明「租户管理员只返回本租户数据」；令牌失效用独立错误码（如 `10202`），不要与权限拒绝共用 `401 10201` |
| UP-AUD-02 | 中 | **`category` 是自由字符串且大小写敏感**：`category=session` 收窄到 79 条，`category=SESSION` / `auth` / 空串等未知值**静默忽略**并返回全量 1823 条 | `GET /audit?category=session` 与 `?category=SESSION` 比对 `total` | 枚举校验，非法值回 `400 10101`，不要静默降级为「不过滤」 |
| UP-AUD-03 | 中 | **查询参数与分页上限不稳定**：`result` / `keyword` 等未登记参数被静默忽略（实测两者都返回全量）；`pageSize=0` 回 20 条却回显 `0`；`pageSize=200` 真给 200 条，`pageSize=500` 只给 20 条却回显 `500`——**没有可依赖的上限** | `GET /audit?pageSize=0`、`200`、`500`，以及 `?result=2`、`?keyword=x`，比对 `len` 与回显 | 明确 `pageSize` 上限并在超出时回 `400 10101`；未知参数要么生效要么报错 |
| UP-AUD-04 | 中 | **时间参数双格式、非法值不报错、单端窗口不校验**：`startTime` / `endTime` 同时接受 `YYYY-MM-DD HH:MM:SS` 与 RFC3339（同区间结果一致，均 381 条），非法格式被静默忽略（回全量 1823）；`verify` 只给单项时间、或窗口内没有条目时都回 `checkedCount=0` 且 `intact: true`（2026-11-02 补测：`2026-11-02 00:00:00` 至 `00:00:01` 的零条窗口同样回 `intact: true`） | `?startTime=2026-11-01 00:00:00&endTime=…` 与 RFC3339 比对；`POST /audit/verify` 只传 `startTime`，以及传一个零条窗口 | 统一一种格式并在非法时回 `400 10101`；单端窗口要么补齐另一端，要么回「参数不完整」而不是「校验 0 条即完好」；零条窗口不要回 `intact: true` |
| UP-AUD-05 | 中 | **`verify` 是写操作，且断点不可定位到条目**：每调一次 `POST /audit/verify` 就**新增一条审计日志**（探测期 `total` 1823 → 1824 → 1827，列表里出现多条 `POST /api/v1/audit/verify` 成功记录），幂等性与「只读校验」的直觉都不成立；`brokenAtLogId` 是**整链序号**（实测 `18`），既不是 `logCode` 也不是当前结果集偏移 | 连续两次 `POST /audit/verify` 后比对 `GET /audit?pageSize=5` 的最新若干条 | 校验要么只读、要么显式标注「会写一条审计」；`brokenAtLogId` 改回 `logCode`（或同时返回 `logCode` + 序号） |
| UP-AUD-06 | 中 | **导出缺必填回 `500 10509`**：`POST /audit/export` 缺 `startTime` / `endTime` / `exportName` 任一，回 `500 系统内部错误` 而不是 `400 10101`，调用方无法把它和上游故障区分开 | `POST /audit/export` 只带 `exportName` | 缺必填回 `400 10101` 并指明字段 |
| UP-AUD-07 | 中 | **导出任务没有详情与删除端点**：`GET /audit/export/{code}` 实测 `404`；也没有 `DELETE`，任务一旦创建不可回收、进度只能靠列表回读（`status` 是未文档化的裸数字，`downloadUrl` 产出前为空串）；另有路由瑕疵：`GET /audit/`（空路径段）回落成**列表**而不是 `404` | `GET /audit/export/EXP…`、`DELETE /audit/export/EXP…`、`GET /audit/` | 补详情（进度 / 失败原因）与删除；空路径段回 `404` |
| UP-AUD-08 | 低 | **导出列表时区偏移 8 小时**：同一 `exportCode` 的 `createdAt`，创建响应回本地时（`…T03:17:06+08:00`），列表回读比它晚 8 小时（本地时被再按 UTC → 本地转换一次） | 创建任务后立刻 `GET /audit/export` 比对同一条的 `createdAt` | 统一时区与格式（RFC3339 带偏移即可），不要在读路径上再偏移一次 |
| UP-AUD-09 | 低 | **详情快照字段恒为空串**：`sourceService` / `beforeSnapshot` / `afterSnapshot` / `detailJson` 在已探测样本中全为空串，只有 `prevHash` 有值 | `GET /audit/{logCode}` 逐字段查空串 | 要么写入快照，要么从契约里去掉这四个字段 |

补充观察（非缺陷，但页面必须知晓）：

- **列表项就是详情的前 12 个字段**（`logCode` / `category` / `accountId` / `deviceCode` / `sessionId` / `traceId` / `action` / `resource` / `result` / `clientIp` / `eventTime` / `logHash`）；详情多出 `sourceService` / `beforeSnapshot` / `afterSnapshot` / `detailJson` / `prevHash` 五个。
- **`accountId=0` 与空串一律被当「未提供」**：与 `category` 的「未知值静默忽略」同族，页面因此只发非空参数。
- **反向区间返回空集**（`start > end` → `total=0`，`200`）：上游不报错，页面在本地先拦。
- **`result` 实测只有 `1`（成功）/ `2`（失败）**，其余取值无样本 → 页面不猜语义。
- **`eventTime` 带偏移**（`2026-11-02T03:15:09+08:00`）：页面只做格式裁剪，不做时区换算。

## 三、对 `/system/log` 落码的影响

| 缺陷 | 页面处置 |
| :--- | :--- |
| UP-AUD-01 | 两种身份都照常取数（不再按身份拦请求）：范围由上游按租户过滤，页面只在详情栏顶部用身份说明讲清「你看的是全平台 / 本租户」；`401 10201` 仍落到「登录态失效」文案，并提示重新登录而不是「加载失败」 |
| UP-AUD-02 | 类别筛选只提供 `session` / `api` 两项（下拉，不做自由输入）；其余取值原样展示为「未知类别」并带出原值 |
| UP-AUD-03 | 不提供 `result` / `keyword` 筛选（不摆不生效的控件）；`pageSize` 客户端先夹到 `100`，分页选项只给 20 / 50 / 100 |
| UP-AUD-04 | 时间筛选统一发 `YYYY-MM-DD HH:MM:SS`（不带偏移，浏览器本地时原样发出）；反向区间本地拦下；`verify` 必须两端齐全才能提交 |
| UP-AUD-05 | 校验做成**显式按钮**（不是打开页面就自动跑），成功后重新拉列表，并在提示里说明「本次校验自身也写入了一条日志」；断点只写「第 N 条」，不尝试映射到列表行；结果文案始终带「共校验 N 条」，`checkedCount = 0` 时按中性提示渲染并明说「空窗口的完整不代表链没问题」（UP-AUD-04） |
| UP-AUD-06 | 导出表单本地先校验三个必填（`exportName` / `startTime` / `endTime`），不让上游的 `500 10509` 充当表单错误 |
| UP-AUD-07 | 导出弹窗只做「创建 + 列表回读 + 手动刷新」，不做进度条与自动轮询（没有进度字段可读）；不提供删除；`status` 以裸数字展示，不猜「生成中 / 已完成」 |
| UP-AUD-08 | 导出列表的 `createdAt` 原样展示，不做时区换算（换算只会把两处的偏差藏起来） |
| UP-AUD-09 | `sourceService` / 快照 / `detailJson` 只在**非空**时渲染；全空时不摆空壳「快照」区块 |

客户端收敛**不是安全边界**：BFF 只做白名单透传，越权判定仍在上游，缺陷须由上游修。

## 四、复现命令（可直接粘贴）

```bash
BASE=http://192.168.1.55:8888/api/v1
AT=$(curl -s -X POST "$BASE/auth/login" -H 'content-type: application/json' \
  -d '{"accountName":"admin","password":"<pwd>"}' | jq -r .data.accessToken)

# UP-AUD-01 租户管理员可用（范围按租户过滤）；过期令牌与越权同为 401 10201
TA=$(curl -s -X POST "$BASE/auth/login" -H 'content-type: application/json' \
  -d '{"accountName":"tenantadmin","password":"<pwd>"}' | jq -r .data.accessToken)
python3 -c "import base64,json,sys;t=sys.argv[1].split('.')[1];t+='='*(-len(t)%4);print(json.loads(base64.urlsafe_b64decode(t))['accountLevel'])" "$TA"  # 1
curl -s "$BASE/audit?page=1&pageSize=2" -H "authorization: Bearer $TA" | jq '{code, total: .data.total, accountIds: [.data.list[].accountId]}'
curl -s "$BASE/audit?page=1&pageSize=2" -H "authorization: Bearer $AT" | jq '{code, total: .data.total}'
# 过期令牌：回 401 10201，与「无权限」不可区分
curl -s "$BASE/audit?page=1&pageSize=2" -H "authorization: Bearer $EXPIRED_TA" | jq '.code'

# UP-AUD-02 category 大小写敏感 + 未知值静默忽略
curl -s "$BASE/audit?page=1&pageSize=3&category=session" -H "authorization: Bearer $AT" | jq .data.total   # 79
curl -s "$BASE/audit?page=1&pageSize=3&category=SESSION" -H "authorization: Bearer $AT" | jq .data.total   # 1823

# UP-AUD-03 pageSize 无稳定上限 + 未知参数被忽略
for ps in 0 200 500 1000; do
  curl -s "$BASE/audit?page=1&pageSize=$ps" -H "authorization: Bearer $AT" \
    | jq -c "{pageSize: .data.pageSize, len: (.data.list | length)}"
done
curl -s "$BASE/audit?page=1&pageSize=3&keyword=x" -H "authorization: Bearer $AT" | jq .data.total

# UP-AUD-04 时间双格式等价 / 非法格式被忽略 / 单端 verify 校验 0 条
curl -s "$BASE/audit?page=1&pageSize=3&startTime=2026-11-01%2000:00:00&endTime=2026-11-02%2000:00:00" \
  -H "authorization: Bearer $AT" | jq .data.total
curl -s -X POST "$BASE/audit/verify" -H "authorization: Bearer $AT" \
  -H 'content-type: application/json' -d '{"startTime":"2026-11-01 00:00:00"}' | jq .data

# UP-AUD-05 verify 会写日志 + 断点是整链序号
before=$(curl -s "$BASE/audit?page=1&pageSize=1" -H "authorization: Bearer $AT" | jq .data.total)
curl -s -X POST "$BASE/audit/verify" -H "authorization: Bearer $AT" -H 'content-type: application/json' -d '{}' | jq .data
after=$(curl -s "$BASE/audit?page=1&pageSize=1" -H "authorization: Bearer $AT" | jq .data.total)
echo "$before -> $after"

# UP-AUD-06 导出缺必填回 500 10509
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$BASE/audit/export" \
  -H "authorization: Bearer $AT" -H 'content-type: application/json' -d '{"exportName":"probe"}'

# UP-AUD-07 导出无详情 / 无删除；空路径段回落列表
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/audit/export/EXP0000000000" -H "authorization: Bearer $AT"
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE "$BASE/audit/export/EXP0000000000" -H "authorization: Bearer $AT"
curl -s "$BASE/audit/" -H "authorization: Bearer $AT" | jq 'has("data") and (.data | has("list"))'

# UP-AUD-08 同一 exportCode 的 createdAt 差 8 小时
curl -s -X POST "$BASE/audit/export" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d '{"exportName":"probe7","startTime":"2026-11-01 00:00:00","endTime":"2026-11-02 00:00:00"}' | jq .data.createdAt
curl -s "$BASE/audit/export?page=1&pageSize=5" -H "authorization: Bearer $AT" | jq '.data.list[0].createdAt'
```

## 五、闭环状态

| 项 | 状态 |
| :--- | :--- |
| UP-AUD-01 | **已更正**（首轮结论撤回：过期令牌伪影；现记「租户范围未文档化 + 失效令牌同码」，属上游文档 / 错误码问题） |
| UP-AUD-02～UP-AUD-09 | **未闭环**（上游 iam 侧待修），`/system/log` 已按第三节收敛 |
| `/system/log` | 按「最小可信面」落码（列表 / 详情 / 校验 / 导出四个能力），不把缺口当契约 |
| BFF 白名单 | `audit` 已纳入 `GATEWAY_RESOURCES`，透传不改判定 |
| 文档同步 | `NMCPS-DESIGN-005` §九（cn/en）、本文、`doc-map`（cn/en）、`shared/constants/docIds.ts` 同步更新 |

## 六、未验证项

- 导出任务的 `status` 取值域：实测只见到 `1`，`downloadUrl` / `objectKey` / `totalRecords` 未观察到产出后的形态 —— 页面因此只做「有 `downloadUrl` 才给下载按钮」的降级逻辑。
- 链式校验的判定算法（`logHash` / `prevHash` 如何串联、断链后是否继续校验）：只探到「当前链在序号 18 处已断」，未探到修复后的表现。
- `intact: false` 在真实数据下是既有状态（探测环境的历史链已断），非页面或本轮探测造成；页面只负责如实呈现。补测另见其反面：零条窗口回 `intact: true` / `checkedCount: 0`（UP-AUD-04），页面因此按「校验 0 条」的中性提示渲染而不是成功绿。
- 移动端 / 桌面端窗口内表现：本页只在浏览器与 `check:ui` 的桩环境下验证，未上真机。


