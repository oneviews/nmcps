// shared/constants/demoAccounts.ts
// 演示种子账号（登录页默认预填的**唯一事实源**）。
//
// 设计基准：
//   - NMCPS-ADR-0013（layers/content/collections/cn/records/adr/adr-0013.md）：登录页命名统一为 login + 演示种子账号预填
//   - NMCPS-ARCH-003（layers/content/collections/cn/architecture/1.architecture/iam-architecture.md）§7.7：预填范围与身份口径
//
// 约束：
//   ① 页面不硬编码账号口令 —— 一律消费 `DEMO_ACCOUNTS`；
//   ② 仅演示用途：口令取自上游 IAM 种子数据，真实部署前须核对种子脚本，或移除预填；
//   ③ `tenantCode` 空串 = 不填租户（超级管理员 `tenantId` 恒为 0，见 AUTH_ACCOUNT_LEVEL）。

import { AUTH_ACCOUNT_LEVEL } from "../types/auth";

export interface DemoAccount {
	/** 稳定标识（UI 选中态用，不进 i18n） */
	id: "superAdmin" | "tenantAdmin"
	/** 身份标签的 i18n 键（`auth.demo.*`） */
	labelKey: string
	/** 上游账号等级：0 = 超级管理员，1 = 租户管理员 */
	accountLevel: number
	accountName: string
	password: string
	/** 租户编码；空串表示不填 */
	tenantCode: string
}

/** 超级管理员（`tenantId` 恒为 0 → 不填租户编码） */
const SUPER_ADMIN_ACCOUNT: DemoAccount = {
	id: "superAdmin",
	labelKey: "auth.demo.superAdmin",
	accountLevel: AUTH_ACCOUNT_LEVEL.SUPER_ADMIN,
	accountName: "admin",
	password: "Admin@123456",
	tenantCode: ""
};

/**
 * 租户管理员
 *
 * 种子事实（用户给定 + 2026-10-31 对 `http://192.168.1.55:10000/api/v1` 实测）：
 * 账号 `tenantadmin`、口令 `Tenant@123456`；`GET /api/v1/account` 确认其 `accountLevel: 1`、
 * `displayName: 默认租户管理员`。种子本身不含租户编码 —— 上游按账号解析租户，
 * `POST /api/v1/auth/login` 不带 `tenantCode` 亦返回 `code: 0`（内置默认租户 code 为 `default`，
 * 需要显式走多租户时才填）。
 */
const TENANT_ADMIN_ACCOUNT: DemoAccount = {
	id: "tenantAdmin",
	labelKey: "auth.demo.tenantAdmin",
	accountLevel: AUTH_ACCOUNT_LEVEL.TENANT_ADMIN,
	accountName: "tenantadmin",
	password: "Tenant@123456",
	tenantCode: ""
};

/** 登录页「演示身份」按钮顺序即本数组顺序 */
export const DEMO_ACCOUNTS: readonly DemoAccount[] = [SUPER_ADMIN_ACCOUNT, TENANT_ADMIN_ACCOUNT];

/** 登录页初始预填值（超级管理员） */
export const DEFAULT_DEMO_ACCOUNT: DemoAccount = SUPER_ADMIN_ACCOUNT;
