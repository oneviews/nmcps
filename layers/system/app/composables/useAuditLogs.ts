// layers/system/app/composables/useAuditLogs.ts
// 审计日志数据面（`/system/log`）：只封装 2026-11-02 实测可用的三个端点。
//
// 设计基准：NMCPS-DESIGN-005 §9.1（layers/content/collections/cn/architecture/2.domain/system.md）
// 上游缺陷：NMCPS-REC-004（layers/content/collections/cn/records/defects/audit-upstream-defects.md）
//   - 失效令牌与越权共用 `401 10201`（UP-AUD-01）→ 两种身份都照常请求，错误统一提示重新登录；
//   - `result` / `keyword` 等未知查询参数被静默忽略（UP-AUD-03）→ 这里不提供这些参数；
//   - `pageSize` 无稳定上限（`500` 回 20 条却回显 500，UP-AUD-03）→ 客户端先夹到 100。
//
// 鉴权口径：BFF 只做白名单透传（`GATEWAY_RESOURCES` 含 `audit`），越权判定全在上游。
import type {
	AuditListQuery,
	AuditListResult,
	AuditLogDetail,
	AuditVerifyPayload,
	AuditVerifyResult
} from "~~/shared/types/audit";
import { AUDIT_MAX_PAGE_SIZE } from "~~/shared/types/audit";

export function useAuditLogs() {
	const api = useApi();

	/**
	 * 列表：空串参数一律不发。
	 *
	 * 上游对「零值 / 空串」的处理并不统一（`accountId=0` 与 `category=""` 都被当「未提供」，
	 * 未知 `category` 更是直接返回全量，UP-AUD-02 / 03），因此筛选值由调用方保证非空。
	 */
	function list(query: AuditListQuery): Promise<AuditListResult> {
		const page = Math.max(1, Math.trunc(query.page) || 1);
		const pageSize = Math.min(AUDIT_MAX_PAGE_SIZE, Math.max(1, Math.trunc(query.pageSize) || 20));

		return api.get<AuditListResult>("/api/audit", {
			query: {
				page,
				pageSize,
				accountId: query.accountId || undefined,
				deviceCode: query.deviceCode || undefined,
				sessionId: query.sessionId || undefined,
				category: query.category || undefined,
				traceId: query.traceId || undefined,
				startTime: query.startTime || undefined,
				endTime: query.endTime || undefined
			}
		});
	}

	/** 详情：路径段是 `logCode`（`AUD…`），不是数值 ID；不存在时上游回 `404 10301` */
	function get(logCode: string): Promise<AuditLogDetail> {
		return api.get<AuditLogDetail>(`/api/audit/${encodeURIComponent(logCode)}`);
	}

	/**
	 * 校验哈希链：`{ intact, checkedCount, brokenAtLogId }`。
	 *
	 * 注意这是**写操作**：`verify` 自身会新增一条 `api` 类审计日志（实测每次调用 +1 条），
	 * 所以它不是「纯查询」，页面对入口做加载态与结果说明，不静默轮询。
	 */
	function verify(payload: AuditVerifyPayload = {}): Promise<AuditVerifyResult> {
		return api.post<AuditVerifyResult>("/api/audit/verify", {
			startTime: payload.startTime || undefined,
			endTime: payload.endTime || undefined
		});
	}

	return { list, get, verify };
}
