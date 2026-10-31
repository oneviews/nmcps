import type { H3Event } from "h3";
import type { ApiResponse, ValidationError } from "~~/shared/types/api";
import { readRawBody } from "h3";
import { z } from "zod";
import { respondAuth } from "./auth";

/**
 * `/api/auth/*` 的入参契约（zod 前置校验）。
 *
 * 目的之一是**挡住上游 500**：`/api/v1/auth/login` 收到空 body 时返回
 * `500 { code: 10509 }`（见 NMCPS-ADR-0011），BFF 必须先校验再转发，
 * 缺字段一律 400 `bff_invalid_body`。
 */

export const authLoginSchema = z.object({
	accountName: z.string().trim().min(1).max(64),
	password: z.string().min(1).max(128),
	tenantCode: z.string().trim().min(1).max(64).optional(),
	mfaCode: z.string().trim().min(4).max(16).optional()
});

export const authRefreshSchema = z.object({
	/** Web 端由 BFF 从 cookie 取；桌面端显式提交 */
	refreshToken: z.string().trim().min(1).optional()
});

export const authPasswordSchema = z.object({
	newPassword: z.string().min(8).max(128),
	oldPassword: z.string().min(1).max(128).optional(),
	firstReset: z.boolean().optional()
});

export const authMfaBindSchema = z.object({
	/** 1 = TOTP（默认），2 = 生物识别（预留） */
	mfaType: z.number().int().min(1).max(9).optional()
});

export const authMfaConfirmSchema = z.object({
	mfaCode: z.string().trim().min(1).max(16)
});

function toValidationErrors(error: z.ZodError): ValidationError[] {
	return error.issues.map((issue) => ({
		loc: issue.path.map((part) => (typeof part === "number" ? part : String(part))),
		msg: issue.message,
		type: issue.code
	}));
}

export type ParsedAuthBody<T>
	= | { ok: true, data: T }
		| { ok: false, response: ApiResponse<never> };

/**
 * 读取并校验 JSON body。
 *
 * - 空 body → 视为 `{}`（登录等必填端点会因缺失字段返回 400，刷新端点则由 cookie 兜底）；
 * - 非法 JSON → 400 `bff_invalid_body`（不把脏报文送上游）；
 * - 校验失败 → 400 `bff_invalid_body` + `error_detail`（字段级定位，表单可内联提示）。
 */
export async function parseAuthBody<S extends z.ZodTypeAny>(
	event: H3Event,
	schema: S
): Promise<ParsedAuthBody<z.infer<S>>> {
	let raw: Record<string, unknown> = {};

	try {
		const text = (await readRawBody(event, "utf8")) ?? "";
		const trimmed = typeof text === "string" ? text.trim() : "";

		if (trimmed) {
			const parsed: unknown = JSON.parse(trimmed);
			raw = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
		}
	} catch {
		return { ok: false, response: respondAuth(event, 400, "bff_invalid_body") };
	}

	const result = schema.safeParse(raw);

	if (!result.success) {
		return {
			ok: false,
			response: respondAuth(event, 400, "bff_invalid_body", { details: toValidationErrors(result.error) })
		};
	}

	return { ok: true, data: result.data as z.infer<S> };
}
