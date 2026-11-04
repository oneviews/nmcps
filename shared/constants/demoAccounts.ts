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
	id: "superAdmin" | "tenantAdmin"
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
 * 种子事实（用户给定 + 实测）：账号 `tenantadmin`、口令 `Tenant@123456`。
 * 代际说明（2026-11-04）：新代登录走 `POST /api/v1/iam/login`（入参 `username`，无 `tenantCode`），
 * 身份字段改由 `data.user_info` 返回；口令本身未变，仍可用于登录预填。
 */
const TENANT_ADMIN_ACCOUNT: DemoAccount = {
	id: "tenantAdmin",
	labelKey: "auth.demo.tenantAdmin",
	username: "tenantadmin",
	password: "Tenant@123456"
};

/** 登录页「演示身份」按钮顺序即本数组顺序 */
export const DEMO_ACCOUNTS: readonly DemoAccount[] = [SUPER_ADMIN_ACCOUNT, TENANT_ADMIN_ACCOUNT];

/** 登录页初始预填值（超级管理员） */
export const DEFAULT_DEMO_ACCOUNT: DemoAccount = SUPER_ADMIN_ACCOUNT;
