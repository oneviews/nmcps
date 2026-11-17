// layers/scenario/server/utils/bff/labWsTickets.ts
// `/lab-ws/*` 的一次性短时票（NMCPS-ADR-0022 D6）。
//
// 票面 = `base64url("v1|kind|target|sub|tid|exp|jti") + "." + base64url(HMAC-SHA256(secret, "lab-ws." + body))`
//
// 四条必须同时成立才放行（缺一条都回 401 `lab_ws_ticket_invalid`）：
// 1. 签名对得上（当前密钥或轮换前的上一把）；
// 2. 未过期（TTL 60 秒，服务端给 `exp`，客户端不能续期）；
// 3. `kind` / `target` 与升级请求完全一致（`sub` / `tid` 只来自会话，不接受查询参数）；
// 4. `jti` 未用过（一次性：重放回 401）。
//
// 为什么不是 JWT：这里只需要「BFF 自己签、BFF 自己验」的短票，额外算法声明 / 头部解析
// 只会多出可被误用的解析面。HMAC + 定长字段足够，且失败一律失败关闭。

import type { LabWsKind } from "#layers/scenario/shared/constants/labWs";
import { Buffer } from "node:buffer";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { LAB_WS_TICKET_TTL_SECONDS } from "#layers/scenario/shared/constants/labWs";

const VERSION = "v1";
const MIN_SECRET_BYTES = 32;
/** 域分隔前缀：同一把密钥签的会话 cookie 不能当票用，反之亦然 */
const SIGNING_PREFIX = "lab-ws";

/** 票据失败原因（调用方只回一个 401 码，原因留在这里做诊断） */
export type LabWsTicketFailure = "not_configured" | "invalid" | "expired" | "binding_mismatch" | "replayed";

export interface LabWsClaims {
	kind: LabWsKind
	/** 通道目标：`sniffer` 为空串（整网）；`terminal` 将会是节点 id */
	target: string
	/** 会话主体（IAM user id） */
	sub: string
	/** 会话租户 */
	tid: string
	/** 过期时刻（秒） */
	exp: number
	/** 一次性标识 */
	jti: string
}

export type LabWsVerifyResult
	= | { ok: true, claims: LabWsClaims }
		| { ok: false, reason: LabWsTicketFailure };

function usableSecrets(secrets: readonly string[]): string[] {
	return secrets.filter((secret) => Buffer.byteLength(secret, "utf8") >= MIN_SECRET_BYTES);
}

function signatureOf(body: string, secret: string): string {
	return createHmac("sha256", secret).update(`${SIGNING_PREFIX}.${body}`).digest("base64url");
}

function fieldInvalid(value: string): boolean {
	// `|` 是字段分隔符：出现即拒绝签名，否则可以拼出一个「字段数不变、语义被挪位」的票
	return value.includes("|");
}

/**
 * 已用 `jti` 表：内存 + 过期即清。
 *
 * 单进程部署下足够；多实例需要把 `jti` 落台账（NMCPS-ADR-0022 备注），
 * 在那之前不能假装它是分布式的。清理放在每次判定里，避免无界增长。
 */
const usedTickets = new Map<string, number>();

function pruneUsed(now: number): void {
	for (const [jti, exp] of usedTickets) {
		if (exp < now)
			usedTickets.delete(jti);
	}
}

/** 标记 `jti` 已用；返回 `false` 表示这是重放 */
function markUsed(jti: string, exp: number, now: number): boolean {
	pruneUsed(now);
	if (usedTickets.has(jti))
		return false;
	usedTickets.set(jti, exp);
	return true;
}

/** 仅供自检复位进程内状态（不对外出口） */
export function resetLabWsTicketsForTests(): void {
	usedTickets.clear();
}

/**
 * 签一张票。`secret` 不足 32 字节返回 `undefined`（调用方回 503，不签发弱票据）。
 */
export function signLabWsTicket(options: {
	secret: string
	kind: LabWsKind
	target: string
	sub: string
	tid: string
	now?: number
	ttlSeconds?: number
}): { ticket: string, expiresAt: string, exp: number } | undefined {
	if (usableSecrets([options.secret]).length === 0)
		return undefined;

	const { kind, target, sub, tid } = options;
	if (!sub || !tid || [kind, target, sub, tid].some((value) => fieldInvalid(value)))
		return undefined;

	const now = options.now ?? Math.floor(Date.now() / 1000);
	const ttl = options.ttlSeconds ?? LAB_WS_TICKET_TTL_SECONDS;
	const exp = now + ttl;
	const jti = randomUUID();
	const body = Buffer.from([VERSION, kind, target, sub, tid, String(exp), jti].join("|"), "utf8").toString("base64url");

	return {
		ticket: `${body}.${signatureOf(body, options.secret)}`,
		expiresAt: new Date(exp * 1000).toISOString(),
		exp
	};
}

function matchesSignature(body: string, signature: string, secrets: readonly string[]): boolean {
	const actual = Buffer.from(signature, "base64url");
	return secrets.some((secret) => {
		const expected = Buffer.from(signatureOf(body, secret), "base64url");
		return expected.length === actual.length && timingSafeEqual(expected, actual);
	});
}

function claimsOf(body: string): { kind: string, target: string, sub: string, tid: string, exp: number, jti: string } | undefined {
	let decoded: string;
	try {
		decoded = Buffer.from(body, "base64url").toString("utf8");
	} catch {
		return undefined;
	}

	const parts = decoded.split("|");
	if (parts.length !== 7 || parts[0] !== VERSION)
		return undefined;

	const [, kind, target, sub, tid, rawExp, jti] = parts as [string, string, string, string, string, string, string];
	const exp = Number(rawExp);
	if (!kind || !sub || !tid || !Number.isFinite(exp) || !jti)
		return undefined;

	return { kind, target, sub, tid, exp, jti };
}

/**
 * 校验并**消费**一张票（一次性：校验通过即标记 `jti`）。
 *
 * `expected.target` 传 `undefined` 表示该通道不校验目标；传 `""` 表示必须是空目标。
 * 升级请求只能提供 `ticket`，`sub` / `tid` 一律取票面 —— 查询串改不动它们。
 */
export function consumeLabWsTicket(
	secrets: readonly string[],
	ticket: string,
	expected: { kind: LabWsKind, target?: string },
	now: number = Math.floor(Date.now() / 1000)
): LabWsVerifyResult {
	const usable = usableSecrets(secrets);
	if (!usable.length)
		return { ok: false, reason: "not_configured" };

	const parts = ticket.split(".");
	if (parts.length !== 2 || !parts[0] || !parts[1])
		return { ok: false, reason: "invalid" };

	const [body, signature] = parts as [string, string];
	if (!matchesSignature(body, signature, usable))
		return { ok: false, reason: "invalid" };

	const claims = claimsOf(body);
	if (!claims)
		return { ok: false, reason: "invalid" };

	if (claims.exp < now)
		return { ok: false, reason: "expired" };

	if (claims.kind !== expected.kind)
		return { ok: false, reason: "binding_mismatch" };

	if (expected.target !== undefined && claims.target !== expected.target)
		return { ok: false, reason: "binding_mismatch" };

	if (!markUsed(claims.jti, claims.exp, now))
		return { ok: false, reason: "replayed" };

	return {
		ok: true,
		claims: {
			kind: claims.kind as LabWsKind,
			target: claims.target,
			sub: claims.sub,
			tid: claims.tid,
			exp: claims.exp,
			jti: claims.jti
		}
	};
}
