// layers/system/app/composables/useAuditLogs.ts
// 审计日志数据面（`/system/log`）：新代 `audit` 命名空间的三条读路径。
//
// 设计基准：NMCPS-DESIGN-005 §9.1（layers/content/collections/cn/architecture/2.domain/system.md）
//
// 代际：旧代是一个 `GET /api/audit?category=…`，新代按日志族拆成两个列表端点
// （`/audit/operation-logs`、`/audit/security-logs`），各带自己的详情端点与筛选参数
// （NMCPS-ADR-0018 §三）。旧代的 `verify`（哈希链校验）与 `export`（导出任务）在新代
// **没有对应端点**（缺口 G6 / G7），改由归档链路承担 —— 见 `useAuditArchive.ts`。
//
// 实测约束（2026-11-04）：
//   - 空结果上游给 `data.list: null`；BFF 出口已归一为 `[]`，composable 再兜一次；
//   - 详情不存在时上游回 **HTTP 200 + `code: 40401`**（不是 404），由 `apiGuard` 抛出 ApiError；
//   - 分页字段是 `page_size`（旧代 `pageSize`），时间边界是 epoch 毫秒整数。
//
// 鉴权口径：BFF 只做白名单透传（`GATEWAY_RESOURCES` 含 `audit`），越权判定全在上游。
import type {
	AuditOperationLog,
	AuditOperationLogQuery,
	AuditPaged,
	AuditSecurityLog,
	AuditSecurityLogQuery
} from "~~/shared/types/audit";
import { AUDIT_MAX_PAGE_SIZE } from "~~/shared/types/audit";

/** 把入参里的空串 / `undefined` 清掉：上游对空串的处理没有明确定义，别发出去 */
function compact<T extends Record<string, unknown>>(source: T): Record<string, unknown> {
	const output: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(source)) {
		if (value === undefined || value === null || value === "")
			continue;
		output[key] = value;
	}
	return output;
}

/** 夹住分页参数：`page ≥ 1`、`1 ≤ page_size ≤ AUDIT_MAX_PAGE_SIZE` */
function paging(query: { page: number, page_size: number }): { page: number, page_size: number } {
	return {
		page: Math.max(1, Math.trunc(query.page) || 1),
		page_size: Math.min(AUDIT_MAX_PAGE_SIZE, Math.max(1, Math.trunc(query.page_size) || 15))
	};
}

export function useAuditLogs() {
	const api = useApi();

	/** 操作日志列表：只放 openapi 列出的参数，空值不发 */
	function listOperationLogs(query: AuditOperationLogQuery): Promise<AuditPaged<AuditOperationLog>> {
		const { page, page_size, ...filters } = query;
		return api.get<AuditPaged<AuditOperationLog>>("/api/audit/operation-logs", {
			query: { ...paging({ page, page_size }), ...compact(filters) }
		});
	}

	/** 操作日志详情：路径段是 UUID；不存在时上游回 `code: 40401` */
	function getOperationLog(id: string): Promise<AuditOperationLog> {
		return api.get<AuditOperationLog>(`/api/audit/operation-logs/${encodeURIComponent(id)}`);
	}

	/** 安全日志列表：参数与操作日志不同源（`subject_*` / `auth_decision` / `logged_*`） */
	function listSecurityLogs(query: AuditSecurityLogQuery): Promise<AuditPaged<AuditSecurityLog>> {
		const { page, page_size, ...filters } = query;
		return api.get<AuditPaged<AuditSecurityLog>>("/api/audit/security-logs", {
			query: { ...paging({ page, page_size }), ...compact(filters) }
		});
	}

	/** 安全日志详情：不存在时上游回 `code: 40401`（`安全审计日志不存在`） */
	function getSecurityLog(id: string): Promise<AuditSecurityLog> {
		return api.get<AuditSecurityLog>(`/api/audit/security-logs/${encodeURIComponent(id)}`);
	}

	return { listOperationLogs, getOperationLog, listSecurityLogs, getSecurityLog };
}
