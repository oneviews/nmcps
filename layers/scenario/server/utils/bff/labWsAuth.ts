// layers/scenario/server/utils/bff/labWsAuth.ts
// `/mininet-ws/*` 连上游时的入口凭据：HMAC 签名查询串。
//
// 为什么不是请求头：Node 内置的 `WebSocket`（undici）**不提供设置请求头的能力**，
// 而 BFF 又不引第二个 WS 客户端实现。把 `LAB_API_TOKEN` 直接写进查询串会进 access log，
// 所以带的是 `lab_ts` + `lab_sig = HMAC-SHA256(token, "<path>\n<ts>")`：
// 绑定路径、120 秒窗口，泄露一条 URL 也换不到别的通道（后端 `auth.py` 同算法）。
//
// 未配置 token 时不签名（后端此时只信任回环，签名本身没有意义）。

import { createHmac } from "node:crypto";
import {
	LAB_WS_SIGNATURE_PARAM,
	LAB_WS_SIGNATURE_TS_PARAM
} from "#layers/scenario/shared/constants/mininetApi";

/** 与后端 `ws_signature()` 逐字节一致；`path` 只含路径，不含查询串 */
export function labWsSignature(token: string, path: string, ts: string): string {
	return createHmac("sha256", token).update(`${path}\n${ts}`).digest("hex");
}

/**
 * 给上游路径追加签名参数。`path` 可以是 `/api/mininet/monitor?target=h1`
 * （签名只覆盖 `path` 部分，查询串原样保留）。
 */
export function signedLabWsPath(path: string, token: string, nowMs: number = Date.now()): string {
	if (!token) {
		return path;
	}

	const ts = String(Math.floor(nowMs / 1000));
	const signature = labWsSignature(token, path.split("?")[0] ?? path, ts);
	const separator = path.includes("?") ? "&" : "?";
	return `${path}${separator}${LAB_WS_SIGNATURE_TS_PARAM}=${ts}&${LAB_WS_SIGNATURE_PARAM}=${signature}`;
}
