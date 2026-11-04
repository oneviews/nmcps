// layers/system/app/composables/useAccounts.ts
// 用户管理数据面（`/system/user`）：`iam/users` 的列表 / 建号 / 更新 / 删除。
//
// 设计基准：NMCPS-DESIGN-005 §六（layers/content/collections/cn/architecture/2.domain/system.md）、
// NMCPS-ADR-0018 §4.2（`/account` → `iam/users`）。
// 2026-11-04 实测（`192.168.1.55:8888`）：
//   - 列表 `data:{ list, page, page_size, total }`，空结果是 `list: null`（BFF 出口已归一为 `[]`）；
//   - 主键是 `id`（`u_…`），旧代 `accountCode` 与 `accountName` 分别由 `id` / `username` 取代；
//   - 建号 `POST /iam/users` 只收 `department_id`（**没有** `tenant_id`），归属由部门携带；
//   - `PUT` / `DELETE /iam/users/{id}` 都在：旧代缺口 `UP-ACC-04`（无改资料 / 无删号）双向闭环。
//
// 鉴权口径：BFF 只做白名单透传，越权判定全在上游。因此这里不做任何「假装客户端能拦住」的假设。
import type {
	IamUser,
	IamUserCreatePayload,
	IamUserListQuery,
	IamUserListResult,
	IamUserUpdatePayload
} from "~~/shared/types/account";

/** 上游 `page_size` 有上限，超出会被静默截断，客户端先夹一次再说 */
const MAX_PAGE_SIZE = 100;

export function useAccounts() {
	const api = useApi();

	/** 列表：空串 / `undefined` 参数一律不发（上游对空串不过滤，但没必要多发参数） */
	function list(query: IamUserListQuery): Promise<IamUserListResult> {
		const page = Math.max(1, Math.trunc(query.page) || 1);
		const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(query.page_size) || 20));
		const keyword = query.keyword?.trim();

		return api.get<IamUserListResult>("/api/iam/users", {
			query: {
				page,
				page_size: pageSize,
				keyword: keyword || undefined,
				status: query.status || undefined,
				department_id: query.department_id || undefined
			}
		});
	}

	/**
	 * 建号：上游 `iam_IdResp` 把新主键放在信封顶层（`{ code, message, id }`），`data` 为空，
	 * 因此 `useApi` 解包后拿不到 id —— 这里用 `keyword` 精确定位刚建好的那一行再返回。
	 *
	 * `username` 上游唯一，所以「列表里 username 完全相同」就是新建记录本身；
	 * 万一列表还没反映出来（异步索引等），返回 `undefined`，由页面回落到整表刷新。
	 */
	async function create(payload: IamUserCreatePayload): Promise<IamUser | undefined> {
		const username = payload.username.trim();

		await api.post<unknown>("/api/iam/users", {
			username,
			password: payload.password,
			email: payload.email?.trim() || undefined,
			display_name: payload.display_name?.trim() || undefined,
			department_id: payload.department_id || undefined
		});

		const result = await list({ page: 1, page_size: 5, keyword: username });
		return result.list.find((item) => item.username === username);
	}

	/**
	 * 更新：新代唯一可写的账号端点，同时承接「改资料」与「改状态」。
	 *
	 * 上游 `iam_UpdateUserReq` 的 `id` 是**必填**（路径段之外还要在体里出现），因此原样带上。
	 */
	function update(payload: IamUserUpdatePayload): Promise<void> {
		const { id, ...rest } = payload;

		return api.put<void>(`/api/iam/users/${encodeURIComponent(id)}`, { id, ...rest });
	}

	/** 改状态：`active` ↔ `disabled` 的薄封装（锁定由上游在失败登录时置位，页面不写） */
	function updateStatus(id: string, status: string): Promise<void> {
		return update({ id, status: status as IamUserUpdatePayload["status"] });
	}

	/** 删号：新代 `DELETE /iam/users/{id}`（软删 `deleted_at`），旧代缺口 `UP-ACC-04` 闭环 */
	function remove(id: string): Promise<void> {
		return api.del<void>(`/api/iam/users/${encodeURIComponent(id)}`);
	}

	return { list, create, update, updateStatus, remove };
}
