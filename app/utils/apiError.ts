// app/utils/apiError.ts
// 上游侧失败的**统一文案映射**：未配置 / 掉线 / 超时都给可执行的修复指引，
// 而不是把 `bff_upstream_*` 原样抛给用户（那会被读成「口令错误」这类本地问题）。
//
// 设计基准：NMCPS-ARCH-003 §7.7（layers/content/collections/cn/architecture/1.architecture/iam-architecture.md）。
// 词汇表：shared/constants/upstreamReasons.ts（与 server 共用，禁止手写字符串）。
import { BFF_UPSTREAM_MESSAGES } from "~~/shared/constants/upstreamReasons";

/**
 * 上游侧失败 → i18n 键；不是上游问题（业务码 / 凭据错误）时返回 `undefined`，
 * 交给调用方继续映射自己的业务码。
 */
export function upstreamHintKey(error: unknown): string | undefined {
	if (!(error instanceof ApiError))
		return undefined;

	switch (error.message) {
		case BFF_UPSTREAM_MESSAGES.missing:
			return "auth.bffUpstreamMissing";
		case BFF_UPSTREAM_MESSAGES.unreachable:
		case BFF_UPSTREAM_MESSAGES.timeout:
			return "auth.bffUpstreamUnavailable";
		default:
			return undefined;
	}
}
