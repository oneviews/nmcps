// layers/system/app/utils/auditError.ts
// 审计日志（`/system/log`）的错误码 → i18n 键映射（新代 `audit/*`）。
//
// 设计基准：NMCPS-DESIGN-005 §9.4（layers/content/collections/cn/architecture/2.domain/system.md）
// 实测口径（2026-11-04，`192.168.1.55:8888`；新代把业务错误塞进 **HTTP 200 + `code≠0`**，
// BFF 保留业务码，客户端据此分类）：
//   - `40401` 目标不存在：三个详情端点都回这个码，`message` 分别点名
//     「操作日志不存在」/「安全审计日志不存在」/「归档记录不存在」；
//   - `10007` 令牌无效 / 过期（旧代的 `10201` 在新代是「密码错误」语义，别再复用）；
//   - `40001` 字段校验失败。
//
// 返回 `undefined` 表示「不是已登记的业务码」：调用方回落到上游原文，不吞信息。
export function auditErrorKey(error: unknown): string | undefined {
	if (!(error instanceof ApiError))
		return undefined;

	const hint = upstreamHintKey(error);
	if (hint)
		return hint;

	switch (error.code) {
		// 未认证 / 令牌失效（新代 10007；旧代的 10201 语义已变，不再当作鉴权失败）
		case 10007:
		case 401:
			return "pages.system-log.errors.forbidden";
		// 目标不存在：三个详情端点共用 40401，实体名在 message 里
		case 40401:
		case 404:
			return "pages.system-log.errors.notFound";
		// 字段校验失败（时间边界 / 分页参数）
		case 40001:
		case 400:
			return "pages.system-log.errors.invalidParam";
		// 上游内部错误
		case 500:
		case 10509:
			return "pages.system-log.errors.internal";
		// 网络层失败（ApiError 用 0 表示非信封错误）
		case 0:
			return "pages.system-log.errors.network";
		default:
			return undefined;
	}
}
