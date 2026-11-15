# Lab 边界约定

Mininet 是**有状态、特权、单实例**的实验床，不是普通只读数据源。合并进 nmcps2 后必须保留这层边界。

## 当前事实

- `services/mininet-api` 的 `app.net` 是进程内全局拓扑，同一时间只有一张网络。
- 后端没有登录态；CORS 当前为 `*`，不能直接暴露公网。
- 终端、抓包、`reset`、`full_reset` 属于高权限操作。
- 拓扑、节点位置、运行状态都归后端所有，前端不是事实源。

## 阶段一约束

- 后端只监听 `127.0.0.1` 或受控内网。
- 不新增浏览器直连 `:8000` 的代码。
- 旧 Vite 前端只作行为参考，不再扩展功能。
- 先完成 BFF 通道和只读页面，再开放写操作。

## 已落地的只读通道（NMCPS-ADR-0020）

- 浏览器入口只有 `/api/lab/**`；上游基址在 `runtimeConfig.mininet.instances`（`NUXT_MININET_INSTANCES`，租户 → 实例 JSON）。未配置实例的租户回 `503 tenant_runtime_unavailable`，不会回退全局 `baseUrl`。
- `layers/scenario/shared/constants/mininetRoutes.ts` 只登记 17 个 GET 查询端点；写操作没有条目，不是被开关挡住。
- BFF 出站不读 `nmcps_at`、不转 `Bearer`、不转发 cookie；只带 `accept` / `user-agent` / `x-request-id`。
- `GET /api/lab/channel` 返回 `configured` / `readOnly: true` / `writeEnabled: false` / `endpointCount`，不回传上游地址。
- 导出（文本 / pcap）、四个 WebSocket、终端、抓包启停与所有写操作均未开放。
- `pnpm build:server && pnpm check:lab-bff` 验证 51 项通道契约（含台账租户隔离、资源清单、401/403/503 与上游零命中）。

## 已落地的鉴权（NMCPS-ADR-0021 P1）

- 登录 / 刷新签发 `nmcps_sess`：HMAC-SHA256、`HttpOnly`、`SameSite=Lax`、`Path=/`，载荷含 `sub` / `tid` / `iat` / `exp` / `ath`。
- `ath` 是访问令牌的 SHA-256；会话与凭据必须同源，错配一律 401。
- 密钥来自 `NUXT_BFF_SESSION_SECRET`（至少 32 字节），轮换窗口用 `NUXT_BFF_SESSION_SECRET_PREVIOUS` 验证旧 cookie；缺密钥回 `503 bff_auth_not_configured`。
- `/api/lab/**` 先解析 IAM `subject-roles → roles/{id}`，租户角色必须满足 `role.tenant_id === 会话 tid`；查询失败回 `503 bff_role_resolution_failed`，不降级成 `tenant_user`。
- 平台管理员（`tid === null`）回 `403 lab_permission_denied`，没有运行态权限。
- 主网关已剥离客户端 `x-tenant-id`；租户只来自签名会话，不来自请求头 / 查询 / body。
- 桌面端（`x-nmcps-client: desktop`）当前只在响应体拿 tokens，不落签名会话；在补充桌面会话承载前，`/api/lab/**` 对桌面端返回 401。
- `/api/sim/**` 仍保持原只读通道，尚未接入租户实例与签名会话；在 P3 写操作开放前必须补齐。

## 已裁决：每租户独立实例（NMCPS-ADR-0021）

- **隔离级别 A**：每个租户独立 Mininet 实例 / 容器 / 网络命名空间，不共享 `app.net`；单实例只能叫「global lease」，不得宣称隔离。
- **租户来源**：只从 BFF 签名会话取，`x-tenant-id`、请求体与查询参数一律不参与归属；P1 前不开放写操作。
- **权限矩阵**：`shared/constants/labPermissions.ts` 是唯一真源。租户普通用户默认 `lab:read`，租户管理员额外 `lab:create` / `lab:operate` / `lab:delete`；`lab:terminal` 与 `lab:sniffer` 必须单独授权。
- **角色校验**：租户角色必须满足 `role.tenant_id === 会话 tenant_id`（UP-RBAC-09）；平台管理员默认没有运行态访问权。
- **资源边界**：BFF 台账记录 `tenant_id` / `engine` / `upstream_id`，上游 `sim_id`、节点 ID、链路 ID 都不是权限凭据；跨租户统一 404。
- **单网络**：同一租户同一引擎同时最多一张运行中网络，第二次创建 / 启动回 `409`。
- **审计**：创建、启动、停止、重置、删除、终端、抓包全部留痕；高风险动作审计失败即拒绝。

## 后续必须拍板

1. **WebSocket 鉴权**：BFF 签发短时 ticket，反代校验后转发。
2. **平台管理员支持会话**：若需要排障，另立 ADR 定义授权人、时限与范围（当前默认拒绝）。
3. **每租户实例编排**：容器 / 命名空间 / 配额的创建与销毁在部署面，BFF 只消费注册表。
4. **数据归属**：实验拓扑只导出/导入，不覆盖生产拓扑。
5. **审计落地**：审计存储、保留期与查询入口。
