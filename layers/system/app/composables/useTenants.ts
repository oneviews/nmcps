// layers/system/app/composables/useTenants.ts
// 租户列表（`GET /api/tenant`）：只为 `/system/user` 建号时的「所属租户」下拉供数。
//
// 设计基准：NMCPS-DESIGN-005 §6.1 / §6.3（layers/content/collections/cn/architecture/2.domain/system.md）
// 缺陷背景：NMCPS-REC-002 UP-ACC-07（建号 `tenantId` 必填，且只有 `/tenant` 能给出取值）。
// 口径：页面上只有超级管理员需要它；租户管理员的租户由上游按令牌推断，不发这个请求。
import type { TenantListResult, TenantSummary } from "~~/shared/types/tenant";

/** 上游 `pageSize` 上限，与账号列表保持同一夹取口径 */
const MAX_PAGE_SIZE = 100;

export function useTenants() {
	const api = useApi();

	/** 拉全量租户（当前环境只有 `default`，一次请求足够；将来变多也先按 100 条取首页） */
	async function list(): Promise<TenantSummary[]> {
		const result = await api.get<TenantListResult>("/api/tenant", {
			query: { page: 1, pageSize: MAX_PAGE_SIZE }
		});

		return result.list ?? [];
	}

	return { list };
}
