// layers/system/app/composables/useAccounts.ts
// 用户管理数据面（`/system/user`）：只封装 2026-11-01 实测存在的三个端点。
//
// 设计基准：NMCPS-DESIGN-005 §六（layers/content/collections/cn/architecture/2.domain/system.md）
// 上游缺陷：NMCPS-REC-002（layers/content/collections/cn/records/defects/account-upstream-defects.md）
//   - 没有 `PUT /account/{code}`：改资料做不了，`displayName` 建号后不可变；
//   - 没有 `DELETE /account/{code}`：删除语义由 `PUT .../status { status: 2 }` 承接；
//   - 列表缺 `tenantId`：超级管理员页面无法按租户归属分组。
//
// 鉴权口径：BFF 只做白名单透传，越权判定全在上游（租户管理员越级建号是 UP-ACC-01）。
// 因此这里不做任何「假装客户端能拦住」的假设，收敛只发生在表单可选项上。
import type {
	AccountCreatePayload,
	AccountListQuery,
	AccountListResult,
	AccountOkResult,
	AccountStatus,
	AccountSummary
} from "~~/shared/types/account";

/** 上游 `pageSize` 有上限，超出会被静默截断，客户端先夹一次再说 */
const MAX_PAGE_SIZE = 100;

export function useAccounts() {
	const api = useApi();

	/** 列表：空串 / `undefined` 参数一律不发（上游对空串不过滤但会多算一次参数） */
	function list(query: AccountListQuery): Promise<AccountListResult> {
		const page = Math.max(1, Math.trunc(query.page) || 1);
		const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(query.pageSize) || 20));
		const keyword = query.keyword?.trim();

		return api.get<AccountListResult>("/api/account", {
			query: {
				page,
				pageSize,
				keyword: keyword || undefined,
				// `0` 是超级管理员等级：作为过滤值上游会当「未提供」（UP-ACC-02），页面也不提供该选项
				accountLevel: query.accountLevel || undefined,
				status: query.status || undefined
			}
		});
	}

	/** 建号：返回新建账号；`accountName` 重复 `10302`、弱口令 `20101`、缺参 `10509` */
	function create(payload: AccountCreatePayload): Promise<AccountSummary> {
		return api.post<AccountSummary>("/api/account", payload);
	}

	/** 改状态：唯一可写的账号变更；`accountCode` 是路径段（`ACC…`），不是 `accountId` */
	function updateStatus(accountCode: string, status: AccountStatus): Promise<AccountOkResult> {
		return api.put<AccountOkResult>(`/api/account/${encodeURIComponent(accountCode)}/status`, { status });
	}

	return { list, create, updateStatus };
}
