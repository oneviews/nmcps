// layers/scenario/server/utils/bff/labWsRelay.ts
// `/mininet-ws/<kind>` 的通用中继：验票 → 连上游 → 双向 / 单向透传 → 记会话时长。
//
// 为什么只有一份实现：四条通道（抓包 / 终端 / 日志 / 监控）的危险动作全在**签票前**
// （会话 + 权限位 + 台账 + 审计，见 `POST /api/mininet/ws-ticket`）。升级之后能做的只剩
// 「拿票里的 `kind` / `target` 去连上游」—— 把这段复制四份，只会让四条通道的校验各自漂移。
// 每条通道的差异全部集中在 `LAB_WS_UPSTREAMS`（上游路径 / 权限位 / target 语义）与
// `labWsUpstreamPath()`（终端拼路径段、监控拼查询串）。
//
// 依据 NMCPS-ADR-0022 D6（layers/content/collections/cn/records/adr/adr-0022.md）。

import type { LabWsClaims } from "#layers/scenario/server/utils/bff/labWsTickets";
import type { LabWsKind } from "#layers/scenario/shared/constants/labWs";
import { randomUUID } from "node:crypto";
import { defineWebSocketHandler } from "h3";
import { getBffConfig } from "~~/server/utils/bff/config";
import { MININET_MESSAGES } from "~~/shared/constants/upstreamReasons";
import { appendLabAudit } from "#layers/scenario/server/utils/bff/labAudit";
import { signedLabWsPath } from "#layers/scenario/server/utils/bff/labWsAuth";
import { consumeLabWsTicket } from "#layers/scenario/server/utils/bff/labWsTickets";
import { getMininetConfig } from "#layers/scenario/server/utils/bff/mininetConfig";
import {
	LAB_WS_PATHS,
	LAB_WS_UPSTREAMS,
	labWsUpstreamPath
} from "#layers/scenario/shared/constants/labWs";

/** 单帧上限：终端输入是**键盘**，不是文件传输；超过就断开，不把大帧塞进上游 PTY */
const MAX_CLIENT_FRAME_BYTES = 64 * 1024;

interface LabWsSession {
	claims: LabWsClaims
	requestId: string
	startedAt: number
	socket: WebSocket
	closed: boolean
	/**
	 * 连上游还没 OPEN 时收到的上行帧（终端敲得比建连快是常态）。
	 * 直接按 readyState 丢掉会让「先敲一句再连上」的命令悄无声息地消失；
	 * 这里只留最后一小段，超过上限就按丢弃处理（终端不是可靠信道）。
	 */
	pending: string[]
}

/** 待发上行的帧数上限：终端一次输入量极小，超过说明调用方不是键盘 */
const MAX_PENDING_FRAMES = 32;

/** 按 peer 记会话：`close` 钩子拿不到 upgrade 上下文，只能靠这张表回连上游 socket */
const sessions = new WeakMap<object, LabWsSession>();

/** `http(s)://host/base` → `ws(s)://host/base/path` */
function toUpstreamSocketUrl(baseUrl: string, path: string): string {
	return `${baseUrl.replace(/^http/i, "ws")}${path}`;
}

/**
 * 审计里的 `network_id`：票面只签了通道 `target`，没有网络 id。
 * 抓包的目标就是网络（空串＝整网），其余通道落到固定值 `network`——审计仍能回答
 * 「哪个租户、哪个人、开了哪种通道、连的是哪个节点」，不伪造一个网络 id。
 */
function networkIdOf(kind: LabWsKind, claims: LabWsClaims): string {
	return LAB_WS_UPSTREAMS[kind].targetKind === "network" ? claims.target || "network" : "network";
}

export function createLabWsRelay(kind: LabWsKind) {
	const entry = LAB_WS_UPSTREAMS[kind];
	const path = LAB_WS_PATHS[kind];

	async function audit(session: LabWsSession, result: "allowed" | "succeeded", reason: string, durationMs?: number): Promise<void> {
		await appendLabAudit(undefined, {
			tenant_id: session.claims.tid,
			actor_id: session.claims.sub,
			engine: "mininet",
			network_id: networkIdOf(kind, session.claims),
			action: `ws_${kind}`,
			result,
			permission: entry.permission,
			path: entry.upstream,
			reason,
			request_id: session.requestId,
			...(durationMs === undefined ? {} : { duration_ms: durationMs })
		});
	}

	return defineWebSocketHandler({
		/**
		 * 升级前验票。失败**不建连**：回 401 + `lab_ws_ticket_invalid`，
		 * 不复用 HTTP 的 `ApiResponse` 信封（这里只有 `Request` / `Response`）。
		 */
		upgrade(request) {
			const url = new URL(request.url);
			if (url.pathname !== path)
				return new Response(null, { status: 404 });

			const config = getBffConfig();
			// `target` 必须与票面一致：票里签的是哪个节点 / 网络，连的就是哪个
			const result = consumeLabWsTicket(
				[config.sessionSecret, config.sessionSecretPrevious],
				url.searchParams.get("ticket") ?? "",
				{ kind, target: url.searchParams.get("target") ?? "" }
			);

			if (!result.ok) {
				return new Response(JSON.stringify({
					code: 401,
					status: "warning",
					message: MININET_MESSAGES.wsTicketInvalid,
					timestamp: new Date().toISOString()
				}), {
					status: 401,
					headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
				});
			}

			const context = request.context as Record<string, unknown>;
			context.labWsClaims = result.claims;
			context.labWsRequestId = request.headers.get("x-request-id")?.trim() || randomUUID();
		},
		open(peer) {
			const context = peer.context as Record<string, unknown>;
			const claims = context.labWsClaims as LabWsClaims | undefined;
			const requestId = typeof context.labWsRequestId === "string" ? context.labWsRequestId : randomUUID();

			if (!claims) {
				peer.close(1011, MININET_MESSAGES.wsTicketInvalid);
				return;
			}

			const config = getMininetConfig(undefined, claims.tid);
			if (!config.baseUrl) {
				peer.close(1011, MININET_MESSAGES.tenantRuntimeUnavailable);
				return;
			}

			// Node ≥22 自带 WebSocket；没有就不假装能连（不引入第二个 WS 客户端实现）
			if (typeof WebSocket === "undefined") {
				peer.close(1011, MININET_MESSAGES.unreachable);
				return;
			}

			// 上游入口凭据（M0 远程化）：token 已配置时带 HMAC 签名查询串；
			// Node 的 WebSocket 不能设请求头，这与后端 `auth.py` 是同一套方案。
			const upstreamPath = signedLabWsPath(labWsUpstreamPath(kind, claims.target), config.token);
			const socket = new WebSocket(toUpstreamSocketUrl(config.baseUrl, upstreamPath));
			const session: LabWsSession = { claims, requestId, startedAt: Date.now(), socket, closed: false, pending: [] };
			sessions.set(peer, session);

			socket.addEventListener("open", () => {
				for (const text of session.pending.splice(0))
					socket.send(text);
			});

			socket.addEventListener("message", (event) => {
				// 四条通道的中继都是文本帧（终端输出 / 日志行 / 监控 JSON）；二进制帧不转发
				if (typeof event.data === "string" && !session.closed)
					peer.send(event.data);
			});

			socket.addEventListener("close", () => {
				if (!session.closed)
					peer.close(1000, "upstream_closed");
			});

			socket.addEventListener("error", () => {
				if (!session.closed)
					peer.close(1011, MININET_MESSAGES.unreachable);
			});

			void audit(session, "allowed", claims.target || "network");
		},
		message(peer, message) {
			const session = sessions.get(peer as unknown as object);
			// 只有终端需要上行：抓包 / 日志 / 监控的下行通道不转发任何客户端帧
			if (!session || session.closed || !entry.clientToUpstream)
				return;

			const text = message.text();
			if (text.length > MAX_CLIENT_FRAME_BYTES) {
				peer.close(1009, "message_too_large");
				return;
			}

			// 上游还在握手：先排队，`open` 时补发（终端敲得比建连快是常态）
			if (session.socket.readyState === WebSocket.CONNECTING) {
				if (session.pending.length < MAX_PENDING_FRAMES)
					session.pending.push(text);
				return;
			}

			if (session.socket.readyState !== WebSocket.OPEN)
				return;

			session.socket.send(text);
		},
		close(peer) {
			const session = sessions.get(peer as unknown as object);
			if (!session)
				return;

			session.closed = true;
			sessions.delete(peer as unknown as object);

			try {
				session.socket.close();
			} catch {
				// 上游已经断开：关不上不是错误
			}

			// 只记时长与目标：终端输入 / 日志正文一律不入审计
			void audit(session, "succeeded", "close", Date.now() - session.startedAt);
		}
	});
}
