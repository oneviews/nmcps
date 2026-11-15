import type { H3Event } from "h3";
import type { AuthUser } from "~~/shared/types/auth";
import { Buffer } from "node:buffer";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { deleteCookie, getCookie, getRequestProtocol, setCookie } from "h3";
import { getBffConfig } from "./config";

/**
 * BFF 签名会话 cookie（`nmcps_sess`）。
 *
 * 设计基准：NMCPS-ADR-0021 §4.1。
 *
 * - 解决“这个浏览器登录的是谁、属于哪个租户”，不替代 `nmcps_at` 访问令牌；
 * - 载荷 `{ sub, tid, iat, exp, ath }`：`ath` 是访问令牌的 SHA-256，把会话与凭据绑死，
 *   避免“拿 A 的会话 cookie + B 的访问令牌”拼出跨主体请求；
 * - HMAC-SHA256，至少 32 字节密钥；支持 `sessionSecretPrevious` 双密钥验证窗口；
 * - 校验失败 / 过期 / 缺密钥一律失败关闭，绝不回退到未签名的 `nmcps_ui`。
 */

export const LAB_SESSION_COOKIE = "nmcps_sess";

const VERSION = "v1";
const SESSION_PATH = "/";
const MIN_SECRET_BYTES = 32;
const CLOCK_SKEW_SECONDS = 60;

export interface LabSessionPayload {
	/** 用户 ID（IAM `user_info.id`） */
	sub: string
	/** 租户 ID；平台用户为 `null` */
	tid: string | null
	/** 签发时间（秒） */
	iat: number
	/** 过期时间（秒） */
	exp: number
	/** 访问令牌 SHA-256（hex），用于绑定会话与凭据 */
	ath: string
}

export type LabSessionFailure = "not_configured" | "missing" | "invalid" | "expired";

export type LabSessionResult
	= | { ok: true, payload: LabSessionPayload }
		| { ok: false, reason: LabSessionFailure };

function nowSeconds(): number {
	return Math.floor(Date.now() / 1000);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function toStringOrNull(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isNonEmpty(value: string | null): value is string {
	return typeof value === "string" && value.length > 0;
}

/** 只接受长度足够的密钥；短密钥等同于未配置（失败关闭） */
function usableSecrets(secrets: readonly string[]): string[] {
	return secrets.filter((secret) => Buffer.byteLength(secret, "utf8") >= MIN_SECRET_BYTES);
}

function verificationSecretsOf(event: H3Event): string[] {
	const config = getBffConfig(event);
	return usableSecrets([config.sessionSecret, config.sessionSecretPrevious]);
}

function sign(body: string, secret: string): string {
	return createHmac("sha256", secret).update(`${VERSION}.${body}`).digest("base64url");
}

function isSessionPayload(value: unknown, now: number): value is LabSessionPayload {
	const record = asRecord(value);
	if (!record) {
		return false;
	}

	const sub = toStringOrNull(record.sub);
	const tid = record.tid === null ? null : toStringOrNull(record.tid);
	const iat = Number(record.iat);
	const exp = Number(record.exp);
	const ath = toStringOrNull(record.ath);

	return isNonEmpty(sub)
		&& (record.tid === null || isNonEmpty(tid))
		&& Number.isFinite(iat)
		&& Number.isFinite(exp)
		&& exp > iat
		&& iat <= now + CLOCK_SKEW_SECONDS
		&& typeof ath === "string"
		&& /^[a-f0-9]{64}$/.test(ath);
}

/**
 * 签发 token（纯函数，便于脚本断言）。
 *
 * 调用方负责保证 `payload` 已包含有效 `sub` / `exp` / `ath`；这里只做机械签名。
 */
export function createLabSessionToken(payload: LabSessionPayload, secret: string): string {
	const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
	return `${VERSION}.${body}.${sign(body, secret)}`;
}

/**
 * 校验 token（纯函数，便于脚本断言）。
 *
 * 依次尝试当前密钥与上一把密钥：轮换窗口内旧 cookie 仍可验证。
 */
export function verifyLabSessionToken(
	raw: string,
	secrets: readonly string[],
	now: number = nowSeconds()
): LabSessionResult {
	const usable = usableSecrets(secrets);
	if (!usable.length) {
		return { ok: false, reason: "not_configured" };
	}

	const parts = raw.split(".");
	if (parts.length !== 3 || parts[0] !== VERSION) {
		return { ok: false, reason: "invalid" };
	}

	const [, body, signature] = parts;
	const actual = Buffer.from(signature ?? "", "base64url");
	let matched = false;

	for (const secret of usable) {
		const expected = Buffer.from(sign(body ?? "", secret), "base64url");
		// length 不等时 timingSafeEqual 会抛错；先比长度，再常量时间比较
		if (expected.length === actual.length && timingSafeEqual(expected, actual)) {
			matched = true;
			break;
		}
	}

	if (!matched) {
		return { ok: false, reason: "invalid" };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(Buffer.from(body ?? "", "base64url").toString("utf8"));
	} catch {
		return { ok: false, reason: "invalid" };
	}

	if (!isSessionPayload(parsed, now)) {
		return { ok: false, reason: "invalid" };
	}

	if (parsed.exp <= now) {
		return { ok: false, reason: "expired" };
	}

	return { ok: true, payload: parsed };
}

/** 访问令牌指纹：只存哈希，不把令牌写进会话 cookie */
export function hashAccessToken(token: string): string {
	return createHash("sha256").update(token, "utf8").digest("hex");
}

function isSecureRequest(event: H3Event): boolean {
	return getRequestProtocol(event, { xForwardedProto: true }) === "https";
}

/**
 * 登录 / 刷新时落签名会话。
 *
 * 缺少密钥或用户 ID 时返回 `false`，**不抛错**：登录本身不应因为实验通道未配置而失败；
 * `/api/lab/**` 随后会用 `503 bff_auth_not_configured` 明确拒绝。
 */
export function issueLabSessionCookie(
	event: H3Event,
	user: AuthUser,
	accessToken: string,
	ttlMs: number
): boolean {
	const config = getBffConfig(event);
	// 只允许用**当前**密钥签发；previous 仅参与验证，避免轮换配置写反时继续产出旧代 cookie
	const current = usableSecrets([config.sessionSecret]);

	if (!current.length || !user.id || !accessToken) {
		return false;
	}

	const issuedAt = nowSeconds();
	const maxAge = Math.max(60, Math.floor(ttlMs / 1000));
	const payload: LabSessionPayload = {
		sub: user.id,
		tid: user.tenantId,
		iat: issuedAt,
		exp: issuedAt + maxAge,
		ath: hashAccessToken(accessToken)
	};

	setCookie(event, config.sessionCookieName, createLabSessionToken(payload, current[0]!), {
		httpOnly: true,
		sameSite: "lax",
		secure: isSecureRequest(event),
		path: SESSION_PATH,
		maxAge
	});

	return true;
}

/** 读取并校验签名会话；任何异常都收敛成失败原因 */
export function readLabSession(event: H3Event): LabSessionResult {
	const config = getBffConfig(event);

	// 当前密钥是“已配置”的唯一判据；只有 previous 等于未配置（previous 只验证不签发）
	if (!usableSecrets([config.sessionSecret]).length) {
		return { ok: false, reason: "not_configured" };
	}

	const raw = getCookie(event, config.sessionCookieName);
	if (!raw) {
		return { ok: false, reason: "missing" };
	}

	return verifyLabSessionToken(raw, verificationSecretsOf(event));
}

export function clearLabSessionCookie(event: H3Event): void {
	const config = getBffConfig(event);
	deleteCookie(event, config.sessionCookieName, { path: SESSION_PATH });
}
