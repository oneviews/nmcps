// layers/system/app/composables/useAuditExport.ts
// 审计导出数据面：`GET /api/audit/export`（任务列表）+ `POST /api/audit/export`（创建任务）。
//
// 设计基准：NMCPS-DESIGN-005 §9.1（layers/content/collections/cn/architecture/2.domain/system.md）
// 上游缺陷：NMCPS-REC-004
//   - 没有 `GET /api/audit/export/{code}`（`404`）：任务进度只能靠列表回读（UP-AUD-07）；
//   - 没有删除端点：任务一旦创建不可回收（UP-AUD-07）；
//   - 缺必填回 `500 10509` 而不是 `400 10101`（UP-AUD-06）→ 表单本地先拦。
import type {
	AuditExportJob,
	AuditExportListResult,
	AuditExportPayload
} from "~~/shared/types/audit";
import { AUDIT_MAX_PAGE_SIZE } from "~~/shared/types/audit";

export function useAuditExport() {
	const api = useApi();

	/** 任务列表：上游只认 `page` / `pageSize`，没有按状态或名称过滤的参数 */
	function listJobs(page = 1, pageSize = 20): Promise<AuditExportListResult> {
		return api.get<AuditExportListResult>("/api/audit/export", {
			query: {
				page: Math.max(1, Math.trunc(page) || 1),
				pageSize: Math.min(AUDIT_MAX_PAGE_SIZE, Math.max(1, Math.trunc(pageSize) || 20))
			}
		});
	}

	/** 创建任务：`exportName` / `startTime` / `endTime` 必填；返回任务本体（`downloadUrl` 此时恒为空串） */
	function create(payload: AuditExportPayload): Promise<AuditExportJob> {
		return api.post<AuditExportJob>("/api/audit/export", {
			exportName: payload.exportName.trim(),
			startTime: payload.startTime,
			endTime: payload.endTime,
			accountId: payload.accountId || undefined,
			category: payload.category || undefined,
			deviceCode: payload.deviceCode || undefined
		});
	}

	return { listJobs, create };
}
