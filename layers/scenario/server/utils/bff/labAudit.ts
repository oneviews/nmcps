// layers/scenario/server/utils/bff/labAudit.ts
// 写操作审计 outbox（NMCPS-ADR-0022 D4，落实 NMCPS-ADR-0021 D9）。
//
// 约定：
// - **先审计后执行**：动作放行时先落一条 `allowed`，执行完再落 `succeeded` / `failed`；
//   第一条写盘失败即拒绝（`503 audit_unavailable`），不允许「先做后补」。
// - 只追加 JSONL，按天分片；默认 `.data/audit/lab-audit-<YYYY-MM-DD>.jsonl`，
//   可用 `NUXT_LAB_AUDIT_FILE` 覆盖（测试用）。
// - 不写敏感载荷：终端输入、抓包内容、请求体一律不入审计。

import type { H3Event } from "h3";
import { createHash } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { getRequestIP } from "h3";
import { useRuntimeConfig } from "nitropack/runtime";

/** 审计结果：放行记录 / 执行结果分两条写，便于回放「允许了但失败了」 */
export type LabAuditResult = "allowed" | "denied" | "succeeded" | "failed";

export interface LabAuditEntry {
	tenant_id: string
	actor_id: string
	engine: "mininet" | "simulator"
	network_id: string
	action: string
	result: LabAuditResult
	permission?: string
	method?: string
	/** 上游路径模板（不含查询串与真实参数值） */
	path?: string
	reason?: string
	request_id?: string
	client_ip?: string
	/** WebSocket 会话时长（毫秒）：只在通道关闭时记一次，不含内容 */
	duration_ms?: number
}

const DEFAULT_AUDIT_DIR = ".data/audit";

function auditDirOf(event: H3Event | undefined): string {
	const runtime = useRuntimeConfig(event);
	const lab = (runtime.lab ?? {}) as Record<string, unknown>;
	const configured = typeof lab.auditFile === "string" && lab.auditFile.trim()
		? lab.auditFile.trim()
		: join(DEFAULT_AUDIT_DIR, "lab-audit.jsonl");

	return resolve(process.cwd(), configured);
}

/** 按天分片：`lab-audit-2026-11-16.jsonl`；配置成目录时同样按天分片 */
function auditFileOf(event: H3Event | undefined): string {
	const base = auditDirOf(event);
	const day = new Date().toISOString().slice(0, 10);
	return base.endsWith(".jsonl")
		? base.replace(/\.jsonl$/, `-${day}.jsonl`)
		: join(base, `lab-audit-${day}.jsonl`);
}

/** 客户端 IP 只用于审计；日志展示时由部署策略脱敏 */
export function labClientIp(event: H3Event): string | undefined {
	try {
		return getRequestIP(event, { xForwardedFor: false }) ?? undefined;
	} catch {
		return undefined;
	}
}

/** 稳定的 request_id：优先透传上游 / 客户端给的那个，否则按事件生成 */
export function labRequestId(event: H3Event): string {
	const header = event.node.req.headers["x-request-id"];
	if (typeof header === "string" && header.trim()) {
		return header.trim();
	}

	return createHash("sha256")
		.update(`${event.method}:${event.path}:${Date.now()}:${Math.random()}`)
		.digest("hex")
		.slice(0, 16);
}

/**
 * 追加一条审计记录。
 *
 * 返回 `false` 表示写盘失败：调用方必须据此拒绝高风险动作（503 `audit_unavailable`），
 * 不得把失败当作“审计可选”。
 *
 * `event` 可为 `undefined`（`/lab-ws/*` 的升级 / 关闭阶段没有 H3Event）：此时不记
 * `client_ip`，`request_id` 由调用方自己给。
 */
export async function appendLabAudit(event: H3Event | undefined, entry: LabAuditEntry): Promise<boolean> {
	const file = auditFileOf(event);

	try {
		await mkdir(dirname(file), { recursive: true });
		await appendFile(file, `${JSON.stringify({ ...entry, created_at: new Date().toISOString() })}\n`, "utf8");
		return true;
	} catch (error) {
		console.error("[lab] audit append failed", file, error);
		return false;
	}
}
