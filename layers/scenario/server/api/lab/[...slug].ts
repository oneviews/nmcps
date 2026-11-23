import type { H3Event } from "h3";
import type { LabPrincipal } from "~~/shared/constants/labPermissions";
import type { ApiResponse } from "~~/shared/types/api";
import type { LabNetworkRecord, LabNetworkState } from "~~/shared/types/lab";
import type { LabResourceChange } from "#layers/scenario/server/utils/bff/labLedger";
import type { MininetConfig } from "#layers/scenario/server/utils/bff/mininetConfig";
import type { MininetMatch } from "#layers/scenario/shared/constants/mininetRoutes";
import { defineEventHandler, readRawBody, setResponseHeader, setResponseStatus } from "h3";
import { respondAuth } from "~~/server/utils/bff/auth";
import { hasLabPermissions } from "~~/shared/constants/labPermissions";
import { MININET_MESSAGES } from "~~/shared/constants/upstreamReasons";
import { appendLabAudit, labClientIp, labRequestId } from "#layers/scenario/server/utils/bff/labAudit";
import { authorizeLabSession } from "#layers/scenario/server/utils/bff/labGuard";
import { getActiveLabNetwork, isLabResourceAllowed, listLabNetworks, markLabNetworkState, recordLabResourceChange } from "#layers/scenario/server/utils/bff/labLedger";
import { acquireLabOperation } from "#layers/scenario/server/utils/bff/labLocks";
import { proxyToMininet } from "#layers/scenario/server/utils/bff/mininet";
import { getMininetConfig } from "#layers/scenario/server/utils/bff/mininetConfig";
import { isWriteRoute, resolveMininetRoute } from "#layers/scenario/shared/constants/mininetRoutes";
import { parseLabImportBody } from "#layers/scenario/shared/types/labImport";

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
	if (template === "/start") {
		return "running";
	}
	if (template === "/stop" || template === "/full_reset") {
		return "stopped";
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

		const result = await proxyToMininet<unknown>(event, match, config, {
			network,
			// 写响应对应的是**刚被改动的对象**：新节点按定义还不在写前那份清单里，
			// 出口过滤只核对租户 / 网络标识，清单在成功后由台账自己收敛（见下方）
			ignoreResourceScope: true,
			// 上游 `import_json` 只收 multipart 的 `file` 字段：把已鉴权、已审计的 JSON 包体
			// 重新封装成文件再出站，否则 FastAPI 会判 422（NMCPS-ADR-0022 §五）
			...(route.template === "/import_json" && body !== undefined
				? { upload: { filename: "topology.json", content: body } }
				: body === undefined ? {} : { body })
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
