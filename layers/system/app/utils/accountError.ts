// layers/system/app/utils/accountError.ts
// 用户管理（`/system/user`）的错误码 → i18n 键映射与展示口径（新代 `iam/users`）。
//
// 设计基准：NMCPS-DESIGN-005 §6.4（layers/content/collections/cn/architecture/2.domain/system.md）
// 实测口径（2026-11-04，`192.168.1.55:8888`；新代 iam 把业务错误塞进 **HTTP 200 + `code≠0`**，
// BFF 保留业务码，客户端据此分类）：
//   - `10002` 用户已存在（重复 `username`）；
//   - `40001` 字段校验失败，`message` 点名具体字段（「用户名不能为空」/「密码长度应为 6-128 字符」）；
//   - `PUT /users/{id}` 目标不存在 → **HTTP 400 + 纯文本「记录不存在」**（非信封）。
//
// 与旧代的差别：不再有 `20102` / `20103`（等级越界 / 向上管控）——等级模型（`accountLevel`）
// 在新代不存在（缺口 G1），等级相关的错误键随之作废。
import { IAM_USER_STATUS } from "~~/shared/types/account";

/** 可内联到表单字段的业务码 → 目标字段（其余错误只做整体提示） */
export function accountErrorField(error: unknown): "username" | "password" | undefined {
	if (!(error instanceof ApiError))
		return undefined;

	if (error.code === 10002)
		return "username";

	// `40001` 是「字段校验失败」的总码，字段名只在 message 里：按上游原文定位，不猜
	if (error.code === 40001) {
		if (/密码|password/i.test(error.message))
			return "password";
		if (/用户名|帐号|账号|username/i.test(error.message))
			return "username";
	}

	return undefined;
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
		// 用户名唯一（实测重复建号）
		case 10002:
			return "pages.system-user.errors.duplicateName";
		// 目标不存在：`PUT|DELETE /users/{id}` 回 HTTP 400 +「记录不存在」
		case 10301:
		case 404:
			return "pages.system-user.errors.notFound";
		// 未认证 / 域拒绝
		case 10201:
		case 40101:
		case 403:
			return "pages.system-user.errors.forbidden";
		// 上游内部错误
		case 500:
		case 10509:
			return "pages.system-user.errors.internal";
		// 网络层失败（ApiError 用 0 表示非信封错误）
		case 0:
			return "pages.system-user.errors.network";
		default:
			return undefined;
	}
}

/** 用户状态 → i18n 键（未登记值走 `unknown`，不猜语义） */
export function accountStatusKey(status: string): string {
	switch (status) {
		case IAM_USER_STATUS.ACTIVE:
			return "pages.system-user.status.active";
		case IAM_USER_STATUS.DISABLED:
			return "pages.system-user.status.disabled";
		case IAM_USER_STATUS.LOCKED:
			return "pages.system-user.status.locked";
		default:
			return "pages.system-user.status.unknown";
	}
}

/** 状态 → Nuxt UI badge 颜色（启用绿、禁用中性、锁定红） */
export function accountStatusColor(status: string): "success" | "neutral" | "error" {
	switch (status) {
		case IAM_USER_STATUS.ACTIVE:
			return "success";
		case IAM_USER_STATUS.LOCKED:
			return "error";
		default:
			return "neutral";
	}
}
