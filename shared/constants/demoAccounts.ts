// shared/constants/demoAccounts.ts
// 演示种子账号（登录页默认预填的**唯一事实源**）。
//
// 设计基准：
//   - NMCPS-ADR-0013（layers/content/collections/cn/records/adr/adr-0013.md）：登录页命名统一为 login + 演示种子账号预填
//   - NMCPS-ADR-0018（layers/content/collections/cn/records/adr/adr-0018.md）§4.1：新代 `POST /iam/login` 入参 `username`
//   - NMCPS-ARCH-003（layers/content/collections/cn/architecture/1.architecture/iam-architecture.md）§7.7：预填范围与身份口径
//
// 约束：
//   ① 页面不硬编码账号口令 —— 一律消费 `DEMO_ACCOUNTS`；
//   ② 仅演示用途：口令取自上游 IAM 种子数据，真实部署前须核对种子脚本，或移除预填；
//   ③ 新代登录不接受 `tenantCode` / `accountLevel`（上游按账号归属解析租户），故演示身份只剩「账号 + 口令」。

export interface DemoAccount {
	/** 稳定标识（UI 选中态用，不进 i18n） */
	id: "superAdmin" | "tenantAdmin" | "labOperator"
	/** 身份标签的 i18n 键（`auth.demo.*`） */
	labelKey: string
	/** 登录名（新代字段名 `username`） */
	username: string
	password: string
}

/** 平台管理员（`user_info.tenant_id` 为 `null`） */
const SUPER_ADMIN_ACCOUNT: DemoAccount = {
	id: "superAdmin",
	labelKey: "auth.demo.superAdmin",
	username: "admin",
	password: "Admin@123456"
};

/**
 * 租户管理员
 *
 * 种子事实：账号 `tenantadmin`、默认口令 `admin_2026`（2026-11-16 按需求方要求更新；
 * 此前登记为 `Tenant@123456`，见 `NMCPS-ADR-0013` 的默认口令更新条）。
 * 代际说明（2026-11-04）：新代登录走 `POST /api/v1/iam/login`（入参 `username`，无 `tenantCode`），
 * 身份字段改由 `data.user_info` 返回；预填机制与登录流程不受代际切换影响。
 */
const TENANT_ADMIN_ACCOUNT: DemoAccount = {
	id: "tenantAdmin",
	labelKey: "auth.demo.tenantAdmin",
	username: "tenantadmin",
	password: "admin_2026"
};

/**
 * 实验台操作员（演示环境专用）
 *
 * 账号 `alice` / 口令 `p@ssw0rd`：**2026-11-18 已在真实 IAM 建号**（`POST /api/iam/users`，
 * 部门 `dept_default_ops` → 租户 `tnt_default`，id `a6541d3f-7880-4bb9-8917-5338d78e6925`），
 * 因此它现在能真登录、拿到 `lab:read` + `lab:terminal`（`lab_terminal` 关系已由上游修复后的
 * `AssignRole` 写对租户，2026-11-18 复测通过：真连 `h1` 拿到 `root@h1:…$`）；`lab:create` /
 * `lab:operate` / `lab:delete` / `lab:sniffer` 仍为 false —— `lab_sniffer` 角色在真实 IAM 里
 * 还没建，所以「连通」对这条账号依旧不出现。写能力位仍只能在假上游旁路
 * （`scripts/lib/bff-harness.mjs` 自造 `r_lab_terminal`）里验证。
 *
 * 约束：这条账号是真实种子数据之外的手工建号，换上游实例（`NUXT_BFF_UPSTREAM_BASE`）时
 * 未必存在，所以它仍只在演示开关 `NUXT_PUBLIC_DEMO_LAB_OPERATOR=true` 时出现
 * （`demoAccountsFor()`），缺省不渲染、不预填。
 */
export const LAB_OPERATOR_ACCOUNT: DemoAccount = {
	id: "labOperator",
	labelKey: "auth.demo.labOperator",
	username: "alice",
	password: "p@ssw0rd"
};

/** 登录页「演示身份」按钮顺序即本数组顺序 */
export const DEMO_ACCOUNTS: readonly DemoAccount[] = [SUPER_ADMIN_ACCOUNT, TENANT_ADMIN_ACCOUNT, LAB_OPERATOR_ACCOUNT];

/**
 * 登录页初始预填值（平台管理员）
 *
 * 生产默认值：真实 IAM 只有 `admin` / `tenantadmin` 两个种子账号。实验台操作员只在演示开关
 * 打开时由 `defaultDemoAccountFor(true)` 顶上（见 `NMCPS-ADR-0013` 的预填口径）。
 */
export const DEFAULT_DEMO_ACCOUNT: DemoAccount = SUPER_ADMIN_ACCOUNT;

/**
 * 演示身份按钮清单：实验台操作员随演示开关出现。
 *
 * 关掉开关时既不预填也不渲染该按钮 —— 让用户点一个真实 IAM 里登不进去的账号，
 * 只会把「本地演示账号」当成「生产账号坏了」。
 */
export function demoAccountsFor(labOperator: boolean): readonly DemoAccount[] {
	return labOperator ? DEMO_ACCOUNTS : DEMO_ACCOUNTS.filter((account) => account.id !== "labOperator");
}

/** 初始预填账号：演示开关打开时预填 `alice`（直达实验台），否则平台管理员 */
export function defaultDemoAccountFor(labOperator: boolean): DemoAccount {
	return labOperator ? LAB_OPERATOR_ACCOUNT : DEFAULT_DEMO_ACCOUNT;
}
