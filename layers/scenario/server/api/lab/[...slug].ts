import type { H3Event } from "h3";
import type { LabPrincipal } from "~~/shared/constants/labPermissions";
import type { ApiResponse } from "~~/shared/types/api";
import type { LabNetworkRecord } from "~~/shared/types/lab";
import type { MininetConfig } from "#layers/scenario/server/utils/bff/mininetConfig";
import type { MininetMatch } from "#layers/scenario/shared/constants/mininetRoutes";
import { defineEventHandler, readRawBody, setResponseHeader, setResponseStatus } from "h3";
import { respondAuth } from "~~/server/utils/bff/auth";
import { hasLabPermissions } from "~~/shared/constants/labPermissions";
import { MININET_MESSAGES } from "~~/shared/constants/upstreamReasons";
import { appendLabAudit, labClientIp, labRequestId } from "#layers/scenario/server/utils/bff/labAudit";
import { authorizeLabSession } from "#layers/scenario/server/utils/bff/labGuard";
import { getActiveLabNetwork, isLabResourceAllowed, listLabNetworks } from "#layers/scenario/server/utils/bff/labLedger";
import { acquireLabOperation } from "#layers/scenario/server/utils/bff/labLocks";
import { proxyToMininet } from "#layers/scenario/server/utils/bff/mininet";
import { getMininetConfig } from "#layers/scenario/server/utils/bff/mininetConfig";
import { isWriteRoute, resolveMininetRoute } from "#layers/scenario/shared/constants/mininetRoutes";

/** 服务探针不属于租户网络：没有台账也必须能判断“实验床在不在” */
const NETWORK_FREE_ROUTES = new Set(["/health", "/version", "/ryu/apps"]);

/** 写请求体上限：拓扑导入是唯一的大包场景，超过即 400，不落盘也不透传 */
const WRITE_BODY_LIMIT = 1024 * 1024;

/** 会改变「有没有网」的端点：命中时先检查同租户是否已有运行中网络 */
const NETWORK_CREATING_ROUTES = new Set(["/start", "/import_json"]);

/**
 * Mininet 实验通道：`/api/lab/**` → 第三上游（默认 `127.0.0.1:8000`）。
 *
 * 与 `server/api/[...slug].ts`（主网关）和 `server/api/sim/**`（仿真平台）并列、互不重叠：
 * - 路径先过 `MININET_ROUTES` 逐端点白名单（模板匹配，非前缀放行）→ 未命中 404、动词不符 405；
 * - 判定顺序固定：会话（401/503）→ 路径（400/404/405）→ 权限位（403）→ 台账（404）→ 审计 → 加锁 → 出站；
 * - 写操作先写审计再执行（失败回 503），同一网络只允许一个在途写（409）；
 * - 出站不携带 authorization / cookie，请求体只转发已鉴权、已审计后的 JSON。
 *
 * 依据 NMCPS-ADR-0020 / NMCPS-ADR-0021 / NMCPS-ADR-0022。
 */
export default defineEventHandler(async (event): Promise<ApiResponse<unknown>> => {
	const authorization = await authorizeLabSession(event);
	if (!authorization.ok) {
		return authorization.response;
	}

	const resolution = resolveMininetRoute(event.context.params?.slug, event.method);

	if ("rejection" in resolution) {
		const { status, message } = resolution.rejection;
		setResponseStatus(event, status);
		setResponseHeader(event, "content-type", "application/json; charset=utf-8");
		setResponseHeader(event, "cache-control", "no-store");

		return {
			code: status,
			status: "warning",
			message,
			timestamp: new Date().toISOString()
		};
	}

	const route = resolution.route;
	const principal = authorization.principal;

	// 权限位判定放在路径解析之后：未登记路径必须先回 404/405，不能伪装成“权限不足”
	if (!hasLabPermissions(principal, route.permissions)) {
		return respondAuth<never>(event, 403, "lab_permission_denied");
	}

	// `tenantId` 在读权限判定中必为非空；`?? ""` 只是让类型收敛，且空串同样查不到实例（失败关闭）
	const tenantId = principal.tenantId ?? "";
	const config = getMininetConfig(event, tenantId);

	// 先判实例：未配置是 P1 的 503，优先级高于 P2 的“台账无记录”
	if (!config.baseUrl || NETWORK_FREE_ROUTES.has(route.template)) {
		return await proxyToMininet(event, resolution, config);
	}

	const network = await getActiveLabNetwork(event, principal, "mininet");
	if (!network) {
		return respondAuth<never>(event, 404, MININET_MESSAGES.resourceNotFound);
	}

	if (!isLabResourceAllowed(network, resolution.params)) {
		return respondAuth<never>(event, 404, MININET_MESSAGES.resourceNotFound);
	}

	if (!isWriteRoute(route)) {
		return await proxyToMininet<unknown>(event, resolution, config, { network });
	}

	return await handleWrite(event, resolution, config, network, principal, tenantId);
});

/**
 * 写端点：先判「是否允许再建网」，再取锁、写审计、读请求体，最后出站。
 *
 * 审计与锁的释放都用 `finally` 收口：抢到锁但审计失败时必须解锁，
 * 否则同一个网络会被一条从未执行的写操作永久占住。
 */
async function handleWrite(
	event: H3Event,
	match: MininetMatch,
	config: MininetConfig,
	network: LabNetworkRecord,
	principal: LabPrincipal,
	tenantId: string
): Promise<ApiResponse<unknown>> {
	const route = match.route;
	const action = `${route.method.toLowerCase()} ${route.template}`;
	const requestId = labRequestId(event);
	const auditBase = {
		tenant_id: tenantId,
		actor_id: principal.subjectId,
		engine: "mininet" as const,
		network_id: network.id,
		permission: route.permissions.join(","),
		method: route.method,
		path: route.upstream,
		request_id: requestId,
		client_ip: labClientIp(event)
	};

	// 单网络门禁：同租户已有别的运行中网络时，不允许再建 / 再导入（NMCPS-ADR-0021 D6）
	if (NETWORK_CREATING_ROUTES.has(route.template)) {
		const networks = await listLabNetworks(event, principal, "mininet");
		const running = networks.find((item) => item.state === "running" && item.id !== network.id);
		if (running) {
			return respondAuth<never>(event, 409, MININET_MESSAGES.networkAlreadyRunning);
		}
	}

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
		// 先审计后执行：写盘失败即拒绝，绝不「先做后补」
		const audited = await appendLabAudit(event, { ...auditBase, action, result: "allowed" });
		if (!audited) {
			return respondAuth<never>(event, 503, MININET_MESSAGES.auditUnavailable);
		}

		const raw = await readRawBody(event, "utf8");
		let body: string | undefined;

		if (raw !== undefined && raw !== "") {
			if (raw.length > WRITE_BODY_LIMIT) {
				await appendLabAudit(event, {
					...auditBase,
					action,
					result: "denied",
					reason: MININET_MESSAGES.bodyInvalid
				});
				return respondAuth<never>(event, 400, MININET_MESSAGES.bodyInvalid);
			}

			try {
				JSON.parse(raw);
			} catch {
				await appendLabAudit(event, {
					...auditBase,
					action,
					result: "denied",
					reason: MININET_MESSAGES.bodyInvalid
				});
				return respondAuth<never>(event, 400, MININET_MESSAGES.bodyInvalid);
			}

			body = raw;
		}

		const result = await proxyToMininet<unknown>(event, match, config, {
			network,
			...(body === undefined ? {} : { body })
		});

		await appendLabAudit(event, {
			...auditBase,
			action,
			result: result.code === 0 ? "succeeded" : "failed",
			...(result.code === 0 ? {} : { reason: result.message })
		});

		return result;
	} finally {
		acquired.lock.release();
	}
}
