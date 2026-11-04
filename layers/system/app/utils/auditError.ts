// layers/system/app/utils/auditError.ts
// 审计日志（`/system/log`）的错误码 → i18n 键映射。
//
// 设计基准：NMCPS-DESIGN-005 §9.4（layers/content/collections/cn/architecture/2.domain/system.md）
// 缺陷背景：NMCPS-REC-004 —— 失效令牌与越权共用 `401 10201`（UP-AUD-01）、
// 导出缺必填回 `500 10509`（UP-AUD-06）、详情不存在回 `404 10301`。
//
// 返回 `undefined` 表示「不是已登记的业务码」：调用方回落到上游原文，不吞信息。

export function auditErrorKey(error: unknown): string | undefined {
	if (!(error instanceof ApiError))
		return undefined;

	const hint = upstreamHintKey(error);
	if (hint)
		return hint;

	switch (error.code) {
		// 未认证 / 登录态失效：上游用 401 10201 统一表示，与「无权限」不可区分（UP-AUD-01）
		case 10201:
			return "pages.system-log.errors.forbidden";
		// 目标不存在：`GET /audit/{logCode}` 用未知代码实测 404（UP-AUD-01 同族：码义是「不存在」）
		case 10301:
			return "pages.system-log.errors.notFound";
		// 参数不合法
		case 10101:
			return "pages.system-log.errors.invalidParam";
		// 上游内部错误：导出缺必填也走这里（UP-AUD-06）
		case 10509:
			return "pages.system-log.errors.internal";
		// 网络层失败（ApiError 用 0 表示非信封错误）
		case 0:
			return "pages.system-log.errors.network";
		default:
			return undefined;
	}
}
