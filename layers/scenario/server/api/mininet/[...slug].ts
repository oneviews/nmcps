import type { H3Event } from "h3";
import type { LabPrincipal } from "~~/shared/constants/labPermissions";
import type { ApiResponse } from "~~/shared/types/api";
import type { LabNetworkRecord, LabNetworkState } from "~~/shared/types/lab";
import type { LabResourceChange } from "#layers/scenario/server/utils/bff/labLedger";
import type { MininetConfig } from "#layers/scenario/server/utils/bff/mininetConfig";
import type { MininetMatch, MininetRoute } from "#layers/scenario/shared/constants/mininetRoutes";
import { defineEventHandler, readRawBody, setResponseHeader, setResponseStatus } from "h3";
import { respondAuth } from "~~/server/utils/bff/auth";
import { hasLabPermissions } from "~~/shared/constants/labPermissions";
import { MININET_MESSAGES } from "~~/shared/constants/upstreamReasons";
import { appendLabAudit, labClientIp, labRequestId } from "#layers/scenario/server/utils/bff/labAudit";
import { authorizeLabSession } from "#layers/scenario/server/utils/bff/labGuard";
import { bindLabNetworkSession, getActiveLabNetwork, isLabResourceAllowed, listLabNetworks, markLabNetworkState, recordLabResourceChange } from "#layers/scenario/server/utils/bff/labLedger";
import { acquireLabOperation } from "#layers/scenario/server/utils/bff/labLocks";
import { proxyToMininet } from "#layers/scenario/server/utils/bff/mininet";
import { getMininetConfig } from "#layers/scenario/server/utils/bff/mininetConfig";
import { isSimulationRoute, isWriteRoute, resolveMininetRoute } from "#layers/scenario/shared/constants/mininetRoutes";
import { parseLabImportBody } from "#layers/scenario/shared/types/labImport";

/** 服务探针不属于租户网络：没有台账也必须能判断“实验床在不在” */
const NETWORK_FREE_ROUTES = new Set(["/health", "/version", "/ryu/apps"]);

/** 写请求体上限：拓扑导入是唯一的大包场景，超过即 400，不落盘也不透传 */
const WRITE_BODY_LIMIT = 1024 * 1024;

/** 会改变「有没有网」的端点：命中时先检查同租户是否已有运行中网络 */
const NETWORK_CREATING_ROUTES = new Set(["/start", "/import_json", "/sessions/{session_id}/start"]);

/**
 * Mininet 实验通道：`/api/mininet/**` → 第三上游（默认 `127.0.0.1:8000`）。
 *
 * 与 `server/api/[...slug].ts`（主网关）并列：8001 仿真平台的 `/api/sim/**` 已于 2026-11-25 退役
 * （`NMCPS-ADR-0027` §4 R8），本通道是唯一的实验面入口。
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

	// 2.0 会话入口（NMCPS-DESIGN-008 M1）：会话归属由台账的 `session_id` 判定。
	// - 创建会话：一张网只绑一个会话（要换就先 DELETE），已绑定直接 409、不触达上游；
	// - 其余会话路径：`{session_id}` 必须是绑定的那一个，不一致一律 404（与「不存在」同口径，
	//   不泄露别人的会话 id）；未绑定（`undefined`）时同样 404 —— 没绑过就没有会话可操作。
	if (isSimulationRoute(route)) {
		if (route.template === "/sessions" && route.method === "POST" && network.session_id) {
			return respondAuth<never>(event, 409, MININET_MESSAGES.sessionExists);
		}
		if (route.template !== "/sessions" && network.session_id !== resolution.params.session_id) {
			return respondAuth<never>(event, 404, MININET_MESSAGES.resourceNotFound);
		}
	}

	if (!isWriteRoute(route)) {
		const result = await proxyToMininet<unknown>(event, resolution, config, { network });
		// 会话列表是实例级读数：只回本网绑定的那一条，不把同实例别人的会话透出去
		return isSimulationRoute(route) ? scopeSessionList(result, route, network) : result;
	}

	return await handleWrite(event, resolution, config, network, principal, tenantId);
});

/**
 * `GET /api/mininet/sessions` 的出口过滤：上游回的是整台实例的会话表，只保留台账绑定的那一条。
 *
 * 不套 `filterLabPayload()`：会话对象里没有 `id/name/type` 那种节点形状，硬套会被
 * `isNodeMap()` 当成未知结构原样放行 —— 那等于把同实例别人的会话 id 透给页面。
 */
function scopeSessionList<T>(
	body: ApiResponse<T>,
	route: MininetRoute,
	network: LabNetworkRecord
): ApiResponse<T> {
	if (body.code !== 0 || route.template !== "/sessions" || route.method !== "GET") {
		return body;
	}

	const data = body.data as { sessions?: unknown, total?: unknown } | undefined;
	if (!data || !Array.isArray(data.sessions)) {
		return body;
	}

	const sessions = (data.sessions as Array<Record<string, unknown>>).filter((item) => item?.id === network.session_id);
	return { ...body, data: { ...data, sessions, total: sessions.length } as T };
}

/**
 * 会往台账清单里**加节点**的端点：请求体的 `id` / `name` 就是节点 id
 * （`labNodePayloadOf()` 两者写同一个值，与上游 `app.hosts` 的键一致）。
 */
const NODE_CREATE_ROUTES = new Set(["/hosts", "/switches", "/routers", "/nats", "/controllers"]);

function jsonRecordOf(raw: string | undefined): Record<string, unknown> | undefined {
	if (!raw) {
		return undefined;
	}

	try {
		const parsed: unknown = JSON.parse(raw);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? parsed as Record<string, unknown>
			: undefined;
	} catch {
		return undefined;
	}
}

function stringFieldOf(record: Record<string, unknown> | undefined, key: string): string | undefined {
	const value = record?.[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * 破坏性重建的确认闸门（NMCPS-ADR-0022 W5）：`POST /full_reset` 必须带
 * `{ confirm: "<network_id>" }`，值与**台账里这套网的 id** 逐字相等才放行。
 *
 * 为什么不是布尔字段：`{ confirm: true }` 在脚本里很好写、在误发请求时也很容易带 ——
 * 要求写对 id，等于让调用方先读到「我要清的是哪张网」。缺字段、类型不对、值不符统一回
 * 400 `lab_confirm_required`，且不触达上游（意图不明确的删除不该先执行再报错）。
 */
function isFullResetConfirmed(rawBody: string | undefined, networkId: string): boolean {
	return stringFieldOf(jsonRecordOf(rawBody), "confirm") === networkId;
}

/**
 * 写端点 → 资源清单增量（NMCPS-ADR-0021 P2 清单的写路径维护）。
 *
 * 只登记「节点 / 链路集合真的变了」的端点：启动、停止、重置、流表、`pingall` / `iperf`
 * 都不改变集合；`import_json` 是追加（并集收敛），`full_reset` 是整表重建（清空清单）。
 */
function labResourceChangeOf(match: MininetMatch, rawBody: string | undefined): LabResourceChange | undefined {
	const { route, params } = match;
	const payload = jsonRecordOf(rawBody);

	// 2.0 会话入口的节点 / 链路（NMCPS-DESIGN-008 M1）：语义与下面那四条一致，
	// 只是路径里多一层 `{session_id}`、链路用 `src`/`dst`（统一模型）而不是 `from`/`to`
	if (isSimulationRoute(route)) {
		if (route.method === "POST" && route.template === "/sessions/{session_id}/nodes") {
			const id = stringFieldOf(payload, "id") ?? stringFieldOf(payload, "name");
			return id ? { addNodes: [id] } : undefined;
		}

		if (route.method === "DELETE" && route.template === "/sessions/{session_id}/nodes/{node_id}") {
			return params.node_id ? { removeNodes: [params.node_id] } : undefined;
		}

		if (route.method === "POST" && route.template === "/sessions/{session_id}/links") {
			const source = stringFieldOf(payload, "src");
			const target = stringFieldOf(payload, "dst");
			return source && target ? { addLinks: [{ source, target }] } : undefined;
		}

		if (route.method === "DELETE" && route.template === "/sessions/{session_id}/links/{link_id}") {
			const [source, target] = (params.link_id ?? "").split("--");
			return source && target ? { removeLinks: [{ source, target }] } : undefined;
		}

		return undefined;
	}

	if (route.method === "POST" && NODE_CREATE_ROUTES.has(route.template)) {
		const id = stringFieldOf(payload, "id") ?? stringFieldOf(payload, "name");
		return id ? { addNodes: [id] } : undefined;
	}

	// 上游 `create_link` 的请求体是 `{ src, dst, options? }`（也接受二元组，但 BFF 只转 JSON 对象）
	if (route.method === "POST" && route.template === "/links") {
		const source = stringFieldOf(payload, "src");
		const target = stringFieldOf(payload, "dst");
		return source && target ? { addLinks: [{ source, target }] } : undefined;
	}

	if (route.method === "DELETE" && route.template === "/delete_node/{node_id}") {
		return params.node_id ? { removeNodes: [params.node_id] } : undefined;
	}

	if (route.method === "DELETE" && route.template === "/delete_link/{src_id}/{dst_id}") {
		return params.src_id && params.dst_id
			? { removeLinks: [{ source: params.src_id, target: params.dst_id }] }
			: undefined;
	}

	// 导入是**追加**（上游 `import_json` 只 `create_*`，不删既有节点），所以清单按并集收敛；
	// 整表重建（`full_reset`）则连既有节点一起清掉，清单必须整体清空（W5）
	if (route.method === "POST" && route.template === "/import_json") {
		const topology = parseLabImportBody(rawBody);
		if (!topology) {
			return undefined;
		}
		return {
			addNodes: topology.nodes.map((node) => node.id),
			addLinks: topology.links
		};
	}

	// 整表重建：节点与链路都归零，清单整体清空（增量删除会留下上游「自己长出来」的 id）
	if (route.method === "POST" && route.template === "/full_reset") {
		return { reset: true };
	}

	return undefined;
}

/**
 * 写端点 → 台账 `state` 的新值（NMCPS-ADR-0021 D7）。
 *
 * 只有「一成功就等于状态已切换」的三条端点登记在这里：`start` 让网跑起来，`stop` 终止
 * 全部节点进程，`full_reset` 把网清空后按「未启动」重建。增删节点 / 链路、流表、
 * `pingall` / `iperf`、抓包都不改运行态 —— 它们照样可能是「网没起也成功」的写操作，
 * 顺手写 `running` 只会让台账更假。
 */
function labNetworkStateAfterWrite(template: string): LabNetworkState | undefined {
	if (template === "/start" || template === "/sessions/{session_id}/start") {
		return "running";
	}
	// 删会话等于这张网没了（引擎里会话被销毁），台账不能继续写 running
	if (
		template === "/stop"
		|| template === "/full_reset"
		|| template === "/sessions/{session_id}/stop"
		|| template === "/sessions/{session_id}"
	) {
		return "stopped";
	}
	return undefined;
}

/**
 * `POST /api/mininet/sessions` 的出站请求体（NMCPS-DESIGN-008 M1）。
 *
 * 客户端只能选引擎（缺省 `wired`）和名字；`metadata` 由 BFF 写：它把会话绑到**当前租户的
 * 台账网络**上（`network_id`），并记下操作者。上游把 `metadata` 原样存进会话记录，
 * 排障时能回答「这个 sim_xxx 是谁在哪张网上建的」。
 */
function sessionCreateBodyOf(
	rawBody: string | undefined,
	network: LabNetworkRecord,
	tenantId: string,
	principal: LabPrincipal
): Record<string, unknown> {
	const payload = jsonRecordOf(rawBody);
	const engine = stringFieldOf(payload, "engine") ?? "wired";
	const name = stringFieldOf(payload, "name");
	return {
		engine,
		...(name ? { name } : {}),
		metadata: { network_id: network.id, tenant_id: tenantId, actor_id: principal.subjectId }
	};
}

/**
 * 会话写成功后要落进台账的绑定：新建 → 会话 id；删除 → `null`（解绑）。
 *
 * 其余会话写（起停、增删节点 / 链路）不动绑定 —— 它们改的是这张网的内容，不是归属。
 */
function sessionBindingOf(route: MininetRoute, result: ApiResponse<unknown>): string | null | undefined {
	if (!isSimulationRoute(route) || result.code !== 0) {
		return undefined;
	}

	if (route.template === "/sessions" && route.method === "POST") {
		const data = result.data as { id?: unknown } | undefined;
		return typeof data?.id === "string" && data.id.trim() ? data.id.trim() : undefined;
	}

	if (route.method === "DELETE" && route.template === "/sessions/{session_id}") {
		return null;
	}

	return undefined;
}

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

		// 破坏性重建的确认闸门（NMCPS-ADR-0022 W5）：意图不明确就不执行，也不触达上游
		if (route.template === "/full_reset" && !isFullResetConfirmed(body, network.id)) {
			await appendLabAudit(event, {
				...auditBase,
				action,
				result: "denied",
				reason: MININET_MESSAGES.confirmRequired
			});
			return respondAuth<never>(event, 400, MININET_MESSAGES.confirmRequired);
		}

		// 2.0 会话创建（NMCPS-DESIGN-008 M1）：`metadata` 只能由 BFF 写 ——
		// 它记录「这会话是哪张台账网络的」，让客户端自填等于让它选一个归属。
		const outboundBody = route.template === "/sessions" && route.method === "POST"
			? JSON.stringify(sessionCreateBodyOf(body, network, tenantId, principal))
			: body;

		const result = await proxyToMininet<unknown>(event, match, config, {
			network,
			// 写响应对应的是**刚被改动的对象**：新节点按定义还不在写前那份清单里，
			// 出口过滤只核对租户 / 网络标识，清单在成功后由台账自己收敛（见下方）
			ignoreResourceScope: true,
			// 上游 `import_json` 只收 multipart 的 `file` 字段：把已鉴权、已审计的 JSON 包体
			// 重新封装成文件再出站，否则 FastAPI 会判 422（NMCPS-ADR-0022 §五）
			...(route.template === "/import_json" && body !== undefined
				? { upload: { filename: "topology.json", content: body } }
				: outboundBody === undefined ? {} : { body: outboundBody })
		});

		// 清单收敛放在上游成功之后：失败时台账仍描述“改之前”的事实，不会凭空多出一个不存在的节点
		if (result.code === 0) {
			const change = labResourceChangeOf(match, body);
			if (change) {
				try {
					await recordLabResourceChange(event, network, change);
				} catch (error) {
					// 上游已经改了，不能因为台账写失败就回滚或改判成功为失败；但必须留痕 ——
					// 清单落后会让新节点在列表里“消失”，排障时这是第一条线索
					console.warn("[lab] resource list not updated", network.id, error);
				}
			}

			// 运行态同样收口到台账：页面读的是台账 `state`，不写回就永远停在 seed 那一刻
			const nextState = labNetworkStateAfterWrite(route.template);
			if (nextState) {
				try {
					await markLabNetworkState(event, network.id, nextState);
				} catch (error) {
					// 同上：上游已切换，台账落后只影响展示（页面还会读 `GET /start`）
					console.warn("[lab] network state not updated", network.id, error);
				}
			}

			// 会话归属（M1）：新会话写进台账、删掉的会话解绑。写不进去只留痕 ——
			// 上游已经建好 / 删掉了，回滚一次成功的写比台账落后更难查
			const sessionId = sessionBindingOf(route, result);
			if (sessionId !== undefined) {
				try {
					await bindLabNetworkSession(event, network.id, sessionId);
				} catch (error) {
					console.warn("[lab] session binding not updated", network.id, error);
				}
			}
		}

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
