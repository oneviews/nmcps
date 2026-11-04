// layers/system/app/composables/usePolicies.ts
// 策略数据面（`/system/policy`）：新代 `iam/policies` 的列表 / 详情 / 建 / 改 / 删。
//
// 设计基准：NMCPS-DESIGN-005 §七（layers/content/collections/cn/architecture/2.domain/system.md）、
// NMCPS-ADR-0018 §4.3（旧代 `/abac/rule` → 新代 `iam/policies`）。
// 上游缺陷：NMCPS-REC-005（layers/content/collections/cn/records/defects/iam-policy-upstream-defects.md）
//   - 列表只认 `page` / `page_size` / `keyword`，`code` / `policy_type` / `enabled` 传了被静默忽略（UP-RBAC-06）；
//   - 建策略把新主键放在**信封顶层**（`{ code, message, id }`，没有 `data`），因此建完要按 `code` 回读；
//   - `PUT` 的 `enabled` 被忽略（UP-RBAC-03）→ 这里只写 `name` / `document` / `description`；
//   - `DELETE` 失败走 **HTTP 200 + `code: 400`**（UP-RBAC-05），由 `useApi` 的 `code === 0` 判定成失败。
//
// 鉴权口径：新代没有业务级鉴权（UP-RBAC-01），BFF 只做白名单透传；
// 可见范围由**会话租户**决定，因此这里不做任何「客户端先拦一道」的假设。
import type {
	IamPolicy,
	IamPolicyCreatePayload,
	IamPolicyListQuery,
	IamPolicyListResult,
	IamPolicyUpdatePayload
} from "~~/shared/types/policy";

/** 上游 `page_size` 无显式上限（UP-RBAC-06），客户端仍夹一次，避免一次拉回整库 */
const MAX_PAGE_SIZE = 100;

export function usePolicies() {
	const api = useApi();

	/** 列表：空串 / `undefined` 参数一律不发（上游对空串不过滤） */
	function list(query: IamPolicyListQuery): Promise<IamPolicyListResult> {
		const page = Math.max(1, Math.trunc(query.page) || 1);
		const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(query.page_size) || 15));
		const keyword = query.keyword?.trim();

		return api.get<IamPolicyListResult>("/api/iam/policies", {
			query: {
				page,
				page_size: pageSize,
				keyword: keyword || undefined
			}
		});
	}

	/** 详情：不存在时上游回 `400` + 纯文本 `记录不存在`（不是 envelope） */
	function get(id: string): Promise<IamPolicy> {
		return api.get<IamPolicy>(`/api/iam/policies/${encodeURIComponent(id)}`);
	}

	/**
	 * 建策略：上游把新主键放在信封顶层（`{ code, message, id }`），`useApi` 解包后拿不到 id，
	 * 因此用 `keyword` 精确回读刚建好的那一行（`code` 同租户唯一，命中即是它）。
	 *
	 * 回读不到（列表尚未反映）时返回 `undefined`，由页面回落到整表刷新。
	 */
	async function create(payload: IamPolicyCreatePayload): Promise<IamPolicy | undefined> {
		const code = payload.code.trim();

		await api.post<unknown>("/api/iam/policies", {
			name: payload.name.trim(),
			code,
			policy_type: payload.policy_type.trim(),
			document: payload.document,
			description: payload.description?.trim() || undefined
		});

		const result = await list({ page: 1, page_size: 5, keyword: code });
		return result.list.find((item) => item.code === code);
	}

	/**
	 * 改策略：只发实测生效的三个字段。
	 *
	 * `document` 必须带上**当前值**：本页不提供文档编辑（NMCPS-DESIGN-005 §7.2），
	 * 原样回传既满足上游语义，也不会把文档写坏。
	 */
	function update(payload: IamPolicyUpdatePayload): Promise<void> {
		const { id, ...rest } = payload;

		return api.put<void>(`/api/iam/policies/${encodeURIComponent(id)}`, {
			id,
			name: rest.name?.trim(),
			document: rest.document,
			description: rest.description?.trim()
		});
	}

	/** 删策略：系统策略同样可删（UP-RBAC-02），因此这里不做任何客户端的「保护」拦阻 */
	function remove(id: string): Promise<void> {
		return api.del<void>(`/api/iam/policies/${encodeURIComponent(id)}`);
	}

	return { list, get, create, update, remove };
}
