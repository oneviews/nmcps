import type { ApiResponse } from "~~/shared/types/api";
import type { LabNetworkSyncResult } from "~~/shared/types/lab";
import { defineEventHandler, getRouterParam, readRawBody, setResponseHeader, setResponseStatus } from "h3";
import { respondAuth } from "~~/server/utils/bff/auth";
import { LAB_PERMISSIONS } from "~~/shared/constants/labPermissions";
import { MININET_MESSAGES } from "~~/shared/constants/upstreamReasons";
import { appendLabAudit, labClientIp, labRequestId } from "#layers/scenario/server/utils/bff/labAudit";
import { authorizeLabAll } from "#layers/scenario/server/utils/bff/labGuard";
import { getLabNetwork, toLabNetworkSummary, upsertLabNetwork } from "#layers/scenario/server/utils/bff/labLedger";
import { acquireLabOperation } from "#layers/scenario/server/utils/bff/labLocks";
import { diffLabResources, readUpstreamLabResources } from "#layers/scenario/server/utils/bff/labReconcile";
import { getMininetConfig } from "#layers/scenario/server/utils/bff/mininetConfig";

/** 确认字段只有 `{ confirm: "<network_id>" }`，小到不需要 1MB 的上限 */
const CONFIRM_BODY_LIMIT = 4096;

function confirmValueOf(raw: string | undefined): string | undefined {
	if (!raw) {
		return undefined;
	}

	try {
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return undefined;
		}
		const value = (parsed as Record<string, unknown>).confirm;
		return typeof value === "string" && value.trim() ? value.trim() : undefined;
	} catch {
		return undefined;
	}
}

/**
 * 台账清单 ← 上游事实的对账（NMCPS-ADR-0023）：`POST /api/mininet/networks/{id}/sync`。
 *
 * 这条路由**只改台账**：读上游五类节点与链路，把 `resources` 整体重写成上游此刻的事实
 * （并集收敛会永久留下上游已删掉的幽灵 id）。因此它不在 `MININET_ROUTES` 里，也不转发
 * 任何上游写。
 *
 * 判定顺序：会话（401/503）→ 双权限位（403）→ 台账（404）→ 实例（503）→ 锁（409）
 * → 审计 → 确认值（400）→ 读上游 → 写台账。任一类读取失败即原样回上游状态且**不落盘**。
 */
export default defineEventHandler(async (event): Promise<ApiResponse<LabNetworkSyncResult> | ApiResponse<never>> => {
	const authorization = await authorizeLabAll(event, [LAB_PERMISSIONS.CREATE, LAB_PERMISSIONS.DELETE]);
	if (!authorization.ok) {
		return authorization.response;
	}

	const principal = authorization.principal;
	const networkId = getRouterParam(event, "id")?.trim();
	if (!networkId) {
		return respondAuth<never>(event, 400, "bff_path_invalid");
	}

	// 跨租户与不存在共用 404：不能让调用方用状态码探测别人的网络 id（NMCPS-ADR-0021 D4）
	const network = await getLabNetwork(event, principal, networkId, "mininet");
	if (!network) {
		return respondAuth<never>(event, 404, MININET_MESSAGES.resourceNotFound);
	}

	const tenantId = principal.tenantId ?? "";
	const config = getMininetConfig(event, tenantId);
	if (!config.baseUrl) {
		return respondAuth<never>(
			event,
			503,
			config.tenantScoped ? MININET_MESSAGES.tenantRuntimeUnavailable : MININET_MESSAGES.notConfigured
		);
	}

	const action = "post /api/mininet/networks/{id}/sync";
	const requestId = labRequestId(event);
	const auditBase = {
		tenant_id: tenantId,
		actor_id: principal.subjectId,
		engine: "mininet" as const,
		network_id: network.id,
		permission: [LAB_PERMISSIONS.CREATE, LAB_PERMISSIONS.DELETE].join(","),
		method: "POST",
		path: "/api/mininet/networks/{id}/sync",
		request_id: requestId,
		client_ip: labClientIp(event)
	};

	const acquired = acquireLabOperation(tenantId, network.id, action);
	if ("conflict" in acquired) {
		await appendLabAudit(event, {
			...auditBase,
			action,
			result: "denied",
			reason: MININET_MESSAGES.operationInProgress
		});
		return respondAuth<never>(event, 409, MININET_MESSAGES.operationInProgress);
	}

	try {
		// 先审计后执行：写盘失败即拒绝，不允许「先做后补」（NMCPS-ADR-0022 D4）
		const audited = await appendLabAudit(event, { ...auditBase, action, result: "allowed" });
		if (!audited) {
			return respondAuth<never>(event, 503, MININET_MESSAGES.auditUnavailable);
		}

		const raw = await readRawBody(event, "utf8");
		if (raw !== undefined && raw.length > CONFIRM_BODY_LIMIT) {
			await appendLabAudit(event, {
				...auditBase,
				action,
				result: "denied",
				reason: MININET_MESSAGES.bodyInvalid
			});
			return respondAuth<never>(event, 400, MININET_MESSAGES.bodyInvalid);
		}

		// 逐字确认：对账会把清单之外的节点纳入租户边界，等价于一次接管（ADR-0023 D4）
		if (confirmValueOf(raw) !== network.id) {
			await appendLabAudit(event, {
				...auditBase,
				action,
				result: "denied",
				reason: MININET_MESSAGES.confirmRequired
			});
			return respondAuth<never>(event, 400, MININET_MESSAGES.confirmRequired);
		}

		const upstream = await readUpstreamLabResources(event, config);
		if (!upstream.ok) {
			await appendLabAudit(event, {
				...auditBase,
				action,
				result: "failed",
				reason: upstream.message
			});
			return respondAuth<never>(event, upstream.status, upstream.message);
		}

		const resources = upstream.resources;
		const change = diffLabResources(network.resources, resources);

		let updated: typeof network;
		try {
			updated = await upsertLabNetwork(event, {
				...network,
				resources,
				updated_at: new Date().toISOString()
			});
		} catch (error) {
			console.error("[lab] reconcile write failed", network.id, error);
			await appendLabAudit(event, {
				...auditBase,
				action,
				result: "failed",
				reason: MININET_MESSAGES.ledgerWriteFailed
			});
			return respondAuth<never>(event, 500, MININET_MESSAGES.ledgerWriteFailed);
		}

		await appendLabAudit(event, { ...auditBase, action, result: "succeeded" });

		setResponseStatus(event, 200);
		setResponseHeader(event, "content-type", "application/json; charset=utf-8");
		setResponseHeader(event, "cache-control", "no-store");

		return {
			code: 0,
			status: "success",
			message: "success",
			data: {
				network: toLabNetworkSummary(updated),
				nodes: resources.nodes ?? [],
				links: resources.links ?? [],
				...change
			},
			timestamp: new Date().toISOString()
		};
	} finally {
		acquired.lock.release();
	}
});
