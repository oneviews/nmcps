// layers/system/app/utils/accountError.ts
// 用户管理（`/system/user`）的错误码 → i18n 键映射与展示口径。
//
// 设计基准：NMCPS-DESIGN-005 §6.4（layers/content/collections/cn/architecture/2.domain/system.md）
// 缺陷背景：NMCPS-REC-002（缺参 / 越界等级上游报 `500 10509`，见 UP-ACC-03）。
import { ACCOUNT_CREATABLE_MAX_LEVEL, ACCOUNT_LEVEL, ACCOUNT_STATUS } from "~~/shared/types/account";

/** 可内联到表单字段的业务码 → 目标字段（其余错误只做整体提示） */
export function accountErrorField(error: unknown): "accountName" | "accountLevel" | "password" | undefined {
	if (!(error instanceof ApiError))
		return undefined;

	switch (error.code) {
		case 10302:
			return "accountName";
		case 20101:
			return "password";
		// 等级越权 / 层级不符：上游口径已按「只能向下管控」收紧（NMCPS-REC-002 UP-ACC-01 / UP-ACC-08）
		case 20102:
		case 20103:
			return "accountLevel";
		default:
			return undefined;
	}
}

/**
 * 上游业务码 → i18n 键。
 *
 * 返回 `undefined` 表示「不是已登记的业务码」：调用方应回落到上游原文（不吞信息），
 * 而不是一律显示「操作失败」。运维类失败（未配置 / 掉线 / 超时）沿用 `upstreamHintKey()`。
 */
export function accountErrorKey(error: unknown): string | undefined {
	if (!(error instanceof ApiError))
		return undefined;

	const hint = upstreamHintKey(error);
	if (hint)
		return hint;

	switch (error.code) {
		// 账号名唯一（实测重复建号）
		case 10302:
			return "pages.system-user.errors.duplicateName";
		// 口令复杂度 / 历史重复
		case 20101:
			return "pages.system-user.errors.weakPassword";
		// 等级与归属层不匹配（实测提交 `accountLevel: 4`）
		case 20102:
			return "pages.system-user.errors.layerMismatch";
		// 只能向下管控：同级或更高等级（实测租户管理员建 `0` / `1`）
		case 20103:
			return "pages.system-user.errors.escalation";
		// 参数不合法：状态或等级越界
		case 10101:
			return "pages.system-user.errors.invalidParam";
		// 目标不存在 / 跨租户（实测租户管理员改他租户状态）
		case 10301:
			return "pages.system-user.errors.notFound";
		// 未认证 / 域拒绝（实测超级管理员调 /account/role）
		case 10201:
			return "pages.system-user.errors.forbidden";
		// 上游内部错误：缺必填、等级越界（UP-ACC-03）
		case 10509:
			return "pages.system-user.errors.internal";
		// 网络层失败（ApiError 用 0 表示非信封错误）
		case 0:
			return "pages.system-user.errors.network";
		default:
			return undefined;
	}
}

/** 账号等级 → i18n 键：`0` / `1` 有语义，`2`–`3` 是租户层下级账号，`4` 是系统开通的服务账号 */
export function accountLevelKey(level: number): string {
	if (level === ACCOUNT_LEVEL.SUPER_ADMIN)
		return "pages.system-user.level.superAdmin";
	if (level === ACCOUNT_LEVEL.TENANT_ADMIN)
		return "pages.system-user.level.tenantAdmin";
	// 2026-11-03 复测：上游把 1–3 归为「租户层」，4 归「服务账号由系统自动开通」
	if (level > ACCOUNT_LEVEL.TENANT_ADMIN && level <= ACCOUNT_CREATABLE_MAX_LEVEL)
		return "pages.system-user.level.subordinate";
	if (level === ACCOUNT_CREATABLE_MAX_LEVEL + 1)
		return "pages.system-user.level.service";

	return "pages.system-user.level.undefined";
}

/** 账号状态 → i18n 键（`0` / `5` 等未登记值走 `unknown`，不猜语义） */
export function accountStatusKey(status: number): string {
	switch (status) {
		case ACCOUNT_STATUS.ENABLED:
			return "pages.system-user.status.enabled";
		case ACCOUNT_STATUS.DISABLED:
			return "pages.system-user.status.disabled";
		case ACCOUNT_STATUS.LOCKED:
			return "pages.system-user.status.locked";
		case ACCOUNT_STATUS.PENDING:
			return "pages.system-user.status.pending";
		default:
			return "pages.system-user.status.unknown";
	}
}

/** 状态 → Nuxt UI badge 颜色（启用绿、禁用中性、锁定红、待激活黄） */
export function accountStatusColor(status: number): "success" | "neutral" | "error" | "warning" {
	switch (status) {
		case ACCOUNT_STATUS.ENABLED:
			return "success";
		case ACCOUNT_STATUS.LOCKED:
			return "error";
		case ACCOUNT_STATUS.PENDING:
			return "warning";
		default:
			return "neutral";
	}
}

/** 等级 → badge 颜色：超级管理员为强调色，其余中性 */
export function accountLevelColor(level: number): "primary" | "neutral" {
	return level === ACCOUNT_LEVEL.SUPER_ADMIN ? "primary" : "neutral";
}
