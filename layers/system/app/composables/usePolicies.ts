// layers/system/app/composables/usePolicies.ts
// 策略数据面（`/system/policy`）：ABAC 规则巡检 + 授权试算。
//
// 设计基准：NMCPS-DESIGN-005 §七（layers/content/collections/cn/architecture/2.domain/system.md）
// 上游缺陷：NMCPS-REC-003（layers/content/collections/cn/records/defects/policy-upstream-defects.md）
//   - `PUT` / `PATCH` / `DELETE /abac/rule/{id}` **不存在**（实测 `404`，swagger 也没有登记）：
//     规则一旦创建既不能改也不能删，`status` 只能由上游改库 → 本页只做只读巡检，不提供创建入口（UP-POL-01）；
//   - `conditionDsl` 不做语法校验（写错也 `200`），且 `ruleCode` 重复回 `409 10302`（UP-POL-02）；
//   - `GET /abac/rule` 没有 `keyword` 参数：搜索只能在客户端做（UP-POL-04 的邻接现象，非缺陷）；
//   - `clientIp` / `deviceCode` / `resourceTags` / `accountLevel` 上游接受但实测不参与判定（UP-POL-06），
//     因此试算只发必填的三个字段，不假装能改上下文。
//
// 鉴权口径：超级管理员调本域任一端点回 `401 10201`（UP-POL-08），页面据此展示「当前身份无策略域」提示。
import type { AbacRule, AbacRuleListResult, AccessDryrunPayload, AccessDryrunResult } from "~~/shared/types/policy";

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

	/** 授权试算：纯计算端点，不落库；`path` 要带 `/api/v1` 前缀才算命中 RBAC */
	function dryrun(payload: AccessDryrunPayload): Promise<AccessDryrunResult> {
		return api.post<AccessDryrunResult>("/api/access/dryrun", payload);
	}

	return { listRules, dryrun };
}

/** 规则展示顺序：优先级升序（上游语义「越小越先匹配」），同优先级按 `ruleId` 稳定排序 */
export function byAbacPriority(rules: AbacRule[]): AbacRule[] {
	return [...rules].sort((a, b) => (a.priority - b.priority) || (a.ruleId - b.ruleId));
}
