// layers/system/app/utils/policyError.ts
// 策略 / 授权两页（`/system/policy`、`/system/permission`）的失败形态 → i18n 键映射。
//
// 设计基准：NMCPS-DESIGN-005 §7.4 / §8.4（layers/content/collections/cn/architecture/2.domain/system.md）
// 缺陷背景：NMCPS-REC-005（layers/content/collections/cn/records/defects/iam-policy-upstream-defects.md）。
//
// C4c 之后两页都走 `iam/*`：**几乎没有业务码**，失败靠「HTTP 状态 + 响应形态」区分，
// 甚至会把原始 PostgreSQL 错误文本直接回给客户端（UP-RBAC-04）。旧代 `/role` / `/permission`
// 的业务码映射（`10201` / `40303` / `20103` / `10509` …）已随端点退役整组删除（C4c code cut 2）。

/** 两页各自的 i18n 命名空间（`errors.*` 挂在下面） */
export type PolicyErrorNamespace = "pages.system-policy" | "pages.system-permission";

/**
 * 失败 → i18n 键（新代 `iam/*` 口径）。
 *
 * 返回 `undefined` 表示「没有登记过的形态」：调用方回落到上游原文（不吞信息），
 * 运维类失败（未配置 / 掉线 / 超时）沿用 `upstreamHintKey()`。
 *
 * 判定顺序有意义：上游会用 `400` 同时承载「目标不存在」「唯一键冲突」「jsonb 解析失败」，
 * 只有报文里的 `SQLSTATE` / 中文短语能区分它们（UP-RBAC-04 / UP-RBAC-05）。
 *
 * **原始 SQL 文本不得展示给用户**：命中 `SQLSTATE` 时一律换成页面文案，
 * 表名 / 约束名只留在 `NMCPS-REC-005` 里。
 */
export function policyErrorKey(error: unknown, namespace: PolicyErrorNamespace): string | undefined {
	if (!(error instanceof ApiError))
		return undefined;

	const hint = upstreamHintKey(error);
	if (hint)
		return hint;

	const message = error.message ?? "";

	// 上游把 PG 错误原样透出：`ERROR: duplicate key value violates unique constraint "uk_…" (SQLSTATE 23505)`
	// 建对象（`code` 重复）与挂策略（重复挂载）走同一个码，文案按页面区分。
	if (message.includes("SQLSTATE 23505"))
		return `${namespace}.errors.duplicateCode`;
	if (message.includes("SQLSTATE 22P02"))
		return `${namespace}.errors.invalidDocument`;
	// `23503`：外键目标已不存在（挂策略时策略被删、分配角色时角色被删）
	if (message.includes("SQLSTATE 23503"))
		return `${namespace}.errors.missingRelation`;

	// `400` 纯文本 `记录不存在`：详情 / 更新 / 删除的目标已不在（可能被他人删除）
	if (message.includes("记录不存在"))
		return `${namespace}.errors.notFound`;

	// `200 {code:400,message:"资源不存在或无权访问"}`：删除失败但 transport 仍是 200（UP-RBAC-05）
	if (message.includes("资源不存在") || message.includes("无权访问"))
		return `${namespace}.errors.deleteRejected`;

	switch (error.code) {
		case 400:
			return `${namespace}.errors.invalidParam`;
		case 401:
		case 40101:
		case 10007:
			return `${namespace}.errors.sessionInvalid`;
		case 0:
			return `${namespace}.errors.network`;
		default:
			return undefined;
	}
}
