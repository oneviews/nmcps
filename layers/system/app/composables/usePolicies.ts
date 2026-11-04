// layers/system/app/composables/usePolicies.ts
// 策略数据面（`/system/policy`）：当前只有 ABAC 规则巡检一条读路径。
//
// 设计基准：NMCPS-DESIGN-005 §七（layers/content/collections/cn/architecture/2.domain/system.md）
// 上游缺陷：NMCPS-REC-003（layers/content/collections/cn/records/defects/policy-upstream-defects.md）
//   - `PUT` / `PATCH` / `DELETE /abac/rule/{id}` **不存在**（实测 `404`，swagger 也没有登记）：
//     规则一旦创建既不能改也不能删，`status` 只能由上游改库 → 本页只做只读巡检，不提供创建入口（UP-POL-01）；
//   - `conditionDsl` 不做语法校验（写错也 `200`），且 `ruleCode` 重复回 `409 10302`（UP-POL-02）；
//   - `GET /abac/rule` 没有 `keyword` 参数：搜索只能在客户端做（UP-POL-04 的邻接现象，非缺陷）。
//
// 新代注记：`/abac/rule` 与 `POST /access/dryrun` 在新代**都没有上游**（NMCPS-ADR-0018 缺口 G4 / G5）。
// 试算已随 C4 下线（入口、弹窗、composable 方法、类型一并移除）；ABAC 段整段下线在 C4c。
import type { AbacRule, AbacRuleListResult } from "~~/shared/types/policy";

/** 上游 `pageSize` 有上限，超出会被静默截断，客户端先夹一次再说 */
const MAX_PAGE_SIZE = 100;

export function usePolicies() {
	const api = useApi();

	/** 规则列表：上游只认 `page` / `pageSize`（没有 keyword） */
	function listRules(page = 1, pageSize = 20): Promise<AbacRuleListResult> {
		return api.get<AbacRuleListResult>("/api/abac/rule", {
			query: {
				page: Math.max(1, Math.trunc(page) || 1),
				pageSize: Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(pageSize) || 20))
			}
		});
	}

	return { listRules };
}

/** 规则展示顺序：优先级升序（上游语义「越小越先匹配」），同优先级按 `ruleId` 稳定排序 */
export function byAbacPriority(rules: AbacRule[]): AbacRule[] {
	return [...rules].sort((a, b) => (a.priority - b.priority) || (a.ruleId - b.ruleId));
}
