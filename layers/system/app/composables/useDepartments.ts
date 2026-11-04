// layers/system/app/composables/useDepartments.ts
// 部门列表（`GET /api/iam/departments`）：`/system/user` 建号时的「所属部门」下拉供数。
//
// 设计基准：NMCPS-ADR-0018 §4.2 —— 新代把归属维度从「租户」下移到「部门」：`POST /iam/users`
// 只收 `department_id`，租户由部门携带，因此部门是建号表单里唯一能表达归属的候选来源。
// 口径：一次性取首页 100 条（当前环境部门数远小于此），失败不阻断列表 —— 表单会因无候选而提交不了。
import type { IamDepartment, IamDepartmentListResult } from "~~/shared/types/department";

/** 与用户列表保持同一夹取口径 */
const MAX_PAGE_SIZE = 100;

export function useDepartments() {
	const api = useApi();

	/** 拉部门候选（当前环境部门数很少，一次请求足够） */
	async function list(): Promise<IamDepartment[]> {
		const result = await api.get<IamDepartmentListResult>("/api/iam/departments", {
			query: { page: 1, page_size: MAX_PAGE_SIZE }
		});

		return result.list ?? [];
	}

	return { list };
}
