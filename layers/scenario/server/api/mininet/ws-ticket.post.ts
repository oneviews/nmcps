import type { ApiResponse } from "~~/shared/types/api";
import type { LabWsTicket } from "#layers/scenario/shared/types/labWs";
import { Buffer } from "node:buffer";
import { defineEventHandler, readRawBody } from "h3";
import { respondAuth } from "~~/server/utils/bff/auth";
import { getBffConfig } from "~~/server/utils/bff/config";
import { hasLabPermission } from "~~/shared/constants/labPermissions";
import { MININET_MESSAGES } from "~~/shared/constants/upstreamReasons";
import { appendLabAudit, labClientIp, labRequestId } from "#layers/scenario/server/utils/bff/labAudit";
import { authorizeLabSession } from "#layers/scenario/server/utils/bff/labGuard";
import { getActiveLabNetwork } from "#layers/scenario/server/utils/bff/labLedger";
import { signLabWsTicket } from "#layers/scenario/server/utils/bff/labWsTickets";
import { getMininetConfig } from "#layers/scenario/server/utils/bff/mininetConfig";
import { isLabWsKind, LAB_WS_UPSTREAMS, labWsTargetError, labWsTargetParts, labWsTicketUrl } from "#layers/scenario/shared/constants/labWs";

/**
 * 换取一次性 WebSocket 票：`POST /api/mininet/ws-ticket { kind, target? }`。
 *
 * 判定顺序固定为：会话（401/503）→ 请求体 / 种类（400）→ 权限位（403）→ 实例（503）→
 * 台账（404）→ 审计（503）→ 签票。
 *
 * 为什么票要单独签：升级请求带不了 `Authorization` / cookie 之外的凭据，也不能在升级后
 * 再「补一次权限检查」—— 浏览器已经连上了。票把「BFF 放行过」这件事绑定到
 * `kind` / `target` / `sub` / `tid` 上，一次性且 60 秒过期，浏览器拿不到上游地址。
 *
 * 依据 NMCPS-ADR-0022 D6（layers/content/collections/cn/records/adr/adr-0022.md）。
 */

/** 请求体上限：只有 `{ kind, target }` 两个短字段 */
const BODY_LIMIT = 4096;

function parseBody(raw: string | undefined): { kind?: unknown, target?: unknown } | undefined {
	if (!raw || !raw.trim())
		return {};

	try {
		const parsed: unknown = JSON.parse(raw);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? parsed as { kind?: unknown, target?: unknown }
			: undefined;
	} catch {
		return undefined;
	}
}

export default defineEventHandler(async (event): Promise<ApiResponse<LabWsTicket> | ApiResponse<never>> => {
	const authorization = await authorizeLabSession(event);
	if (!authorization.ok) {
		return authorization.response;
	}

	const principal = authorization.principal;
	const rawBody = await readRawBody(event);
	if (typeof rawBody === "string" && Buffer.byteLength(rawBody, "utf8") > BODY_LIMIT) {
		return respondAuth<never>(event, 400, MININET_MESSAGES.bodyInvalid);
	}

	const body = parseBody(rawBody);
	if (!body) {
		return respondAuth<never>(event, 400, MININET_MESSAGES.bodyInvalid);
	}

	// 未登记 / 未实现的种类在判权限之前回 400：票不能签给「还不存在的通道」
	if (!isLabWsKind(body.kind)) {
		return respondAuth<never>(event, 400, MININET_MESSAGES.wsKindInvalid);
	}

	const kind = body.kind;
	const entry = LAB_WS_UPSTREAMS[kind];

	if (!hasLabPermission(principal, entry.permission)) {
		return respondAuth<never>(event, 403, "lab_permission_denied");
	}

	const target = typeof body.target === "string" ? body.target.trim() : "";
	// 形状先判：缺目标、目标带分隔符（`|` / `/`）或 `monitor` 不是 `<node>:<intf>` 都回 400
	const targetError = labWsTargetError(kind, target);
	if (targetError) {
		return respondAuth<never>(event, 400, MININET_MESSAGES.bodyInvalid);
	}

	const tenantId = principal.tenantId ?? "";
	const config = getMininetConfig(event, tenantId);
	if (!config.baseUrl) {
		return respondAuth<never>(event, 503, config.tenantScoped
			? MININET_MESSAGES.tenantRuntimeUnavailable
			: MININET_MESSAGES.notConfigured);
	}

	/*
	 * 台账先于签票：没有可见网络就没有可连的通道，回 404 而不是签一张注定连不上的票。
	 * `target` 只接受**本网**的 network id —— 别的租户的 id 与不存在共用 404（D4）。
	 *
	 * 节点类通道（终端 / 监控）再按资源清单收窄：清单**登记了** `nodes` 时，
	 * 清单外的节点一律 404（与列表出口同一套资源级过滤）；清单未登记表示这张网没有
	 * 收窄信息，节点存在性交给上游（它的 `get(node_id)` 对不存在的节点直接回错误帧）。
	 */
	const network = await getActiveLabNetwork(event, principal, "mininet");
	if (!network) {
		return respondAuth<never>(event, 404, MININET_MESSAGES.resourceNotFound);
	}

	const { node } = labWsTargetParts(kind, target);
	const scopedNodes = network.resources?.nodes;
	const targetAllowed = entry.targetKind === "network"
		? !target || target === network.id
		: entry.targetKind === "none"
			? true
			: !Array.isArray(scopedNodes) || scopedNodes.includes(node);

	if (!targetAllowed) {
		return respondAuth<never>(event, 404, MININET_MESSAGES.resourceNotFound);
	}

	const signed = signLabWsTicket({
		secret: getBffConfig(event).sessionSecret,
		kind,
		target,
		sub: principal.subjectId,
		tid: tenantId
	});
	if (!signed) {
		// 密钥不足 32 字节：会话本身已经过不了 `authorizeLabSession`，这里只是兜底
		return respondAuth<never>(event, 503, "bff_auth_not_configured");
	}

	// 先审计后签票：通道是高危能力（终端 / 抓包），审计写不进去就不该放行
	const audited = await appendLabAudit(event, {
		tenant_id: tenantId,
		actor_id: principal.subjectId,
		engine: "mininet",
		network_id: network.id,
		action: `ws_ticket_${kind}`,
		result: "allowed",
		permission: entry.permission,
		method: "POST",
		path: "/api/mininet/ws-ticket",
		reason: target || "network",
		request_id: labRequestId(event),
		client_ip: labClientIp(event)
	});
	if (!audited) {
		return respondAuth<never>(event, 503, MININET_MESSAGES.auditUnavailable);
	}

	return respondAuth<LabWsTicket>(event, 200, "success", {
		data: {
			kind,
			ticket: signed.ticket,
			expiresAt: signed.expiresAt,
			url: labWsTicketUrl(kind, signed.ticket, target)
		}
	});
});
