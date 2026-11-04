// layers/system/app/composables/useAuditArchive.ts
// 审计归档数据面：`GET /api/audit/archive/records`（批次列表）、`GET /{id}`（详情）、
// `POST /api/audit/archive/run`（立刻跑一次归档）。
//
// 设计基准：NMCPS-DESIGN-005 §9.1 / §9.3（layers/content/collections/cn/architecture/2.domain/system.md）
//
// 为什么会有这条链路：新代**没有导出端点**（旧代 `GET|POST /audit/export`，缺口 G7），
// 归档取代了「把一段日志搬走」这件事。`POST /audit/archive/run` 是**写操作**：
// 它按上游保留期把过期行搬到归档表，并留下一条批次记录（实测返回
// `data: { sys_operation_log: 0, sys_audit_log: 0 }` —— 表名 → 本批次行数）。
//
// 实测约束（2026-11-04）：
//   - 归档记录的字段集合已核对（见 `AuditArchiveRecord`），列表与详情同形；
//   - 未知 id 回 **HTTP 200 + `code: 40401`**（`归档记录不存在`）；
//   - 空列表同样是 `data.list: null`，BFF 出口归一为 `[]`。
import type {
	AuditArchiveQuery,
	AuditArchiveRecord,
	AuditPaged,
	AuditRunArchivePayload,
	AuditRunArchiveResult
} from "~~/shared/types/audit";
import { AUDIT_MAX_PAGE_SIZE } from "~~/shared/types/audit";

export function useAuditArchive() {
	const api = useApi();

	/** 批次列表：上游只认 `page` / `page_size` / `table_name` / `status`，没有时间条件 */
	function listRecords(query: AuditArchiveQuery): Promise<AuditPaged<AuditArchiveRecord>> {
		return api.get<AuditPaged<AuditArchiveRecord>>("/api/audit/archive/records", {
			query: {
				page: Math.max(1, Math.trunc(query.page) || 1),
				page_size: Math.min(AUDIT_MAX_PAGE_SIZE, Math.max(1, Math.trunc(query.page_size) || 15)),
				table_name: query.table_name || undefined,
				status: query.status || undefined
			}
		});
	}

	/** 批次详情：与列表项同形；不存在时 `code: 40401` */
	function getRecord(id: string): Promise<AuditArchiveRecord> {
		return api.get<AuditArchiveRecord>(`/api/audit/archive/records/${encodeURIComponent(id)}`);
	}

	/**
	 * 立刻跑一次归档（写操作，不可撤销）。
	 *
	 * 不传 `table_name` = 两张表都归档；返回体是「表名 → 行数」，页面照实回显，
	 * 不把 `0` 说成失败（空库实测就是 0）。
	 */
	function run(payload: AuditRunArchivePayload = {}): Promise<AuditRunArchiveResult> {
		return api.post<AuditRunArchiveResult>("/api/audit/archive/run", {
			table_name: payload.table_name || undefined
		});
	}

	return { listRecords, getRecord, run };
}
