// layers/system/app/composables/useTenants.ts
// 租户列表（`GET /api/iam/tenants`）：`/system/user` 用它把用户行上的 `tenant_id` 翻成租户名。
//
// 设计基准：NMCPS-ADR-0018 §4.2（`GET /tenant` → `GET /iam/tenants`）。
// 与旧代用途的差别：以前这里给建号表单供「所属租户」候选（旧代 `POST /account` 要求显式
// `tenantId`）；新代 `POST /iam/users` 没有 `tenant_id`，归属改由部门携带（`useDepartments`），
// 因此本 composable 现在只服务于**展示**（租户名翻译）。
import type { IamTenant, IamTenantListResult } from "~~/shared/types/tenant";

/** 上游 `page_size` 上限，与用户列表保持同一夹取口径 */
const MAX_PAGE_SIZE = 100;

export function useTenants() {
	const api = useApi();

	/** 拉全量租户（当前环境 3 个，一次请求足够；将来变多也先按 100 条取首页） */
	async function list(): Promise<IamTenant[]> {
		const result = await api.get<IamTenantListResult>("/api/iam/tenants", {
			query: { page: 1, page_size: MAX_PAGE_SIZE }
		});

		return result.list ?? [];
	}

	return { list };
}
