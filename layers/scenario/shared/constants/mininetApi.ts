// layers/scenario/shared/constants/mininetApi.ts
// 仿真后端的**契约标记**与 WebSocket 签名参数名（BFF ↔ `services/mininet-api`）。
//
// 为什么要有契约标记：2.0 的引擎面（`/api/simulation/**` + 会话）与 1.x 的
// `/api/mininet/**` 不是同一版 API。握手（`GET /api/mininet/version`）只看**主版本**是否一致 ——
// 补丁版本差异（多了几个端点）不阻断，主版本不一致必须当场可见，而不是等第一条写请求 404。
//
// 依据：`docs/ai/simulation-parity.md` §4.4 / M0。

/** 本 BFF 期望的上游契约（后端 `GET /api/version` 的 `api_contract`） */
export const LAB_API_CONTRACT = "2.0";

/** WebSocket 入口凭据的时间戳参数（后端 `mininet_gui_backend/auth.py` 同名） */
export const LAB_WS_SIGNATURE_TS_PARAM = "lab_ts";

/** WebSocket 入口凭据的 HMAC 参数 */
export const LAB_WS_SIGNATURE_PARAM = "lab_sig";

/** 主版本一致即兼容（`"2.0"` ↔ `"2.1"` 兼容，`"1.x"` 不兼容） */
export function isLabApiCompatible(contract: unknown): boolean {
	if (typeof contract !== "string") {
		return false;
	}

	const expected = LAB_API_CONTRACT.split(".")[0];
	return contract.trim().split(".")[0] === expected;
}
