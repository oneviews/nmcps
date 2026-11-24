import type { H3Event } from "h3";
import type { ApiResponse } from "~~/shared/types/api";
import { defineEventHandler, setResponseHeader, setResponseStatus } from "h3";
import { MININET_MESSAGES } from "~~/shared/constants/upstreamReasons";
import { authorizeLab } from "#layers/scenario/server/utils/bff/labGuard";
import { getActiveLabNetwork } from "#layers/scenario/server/utils/bff/labLedger";
import { fetchMininetBinary, fetchMininetText } from "#layers/scenario/server/utils/bff/mininet";
import { getMininetConfig } from "#layers/scenario/server/utils/bff/mininetConfig";
import { LAB_EXPORT_UPSTREAMS, labExportFilename, parseLabExportKind } from "#layers/scenario/shared/constants/mininetRoutes";

/**
 * 导出通道：`GET /api/mininet/export/{json|script|pcap}`（NMCPS-ADR-0022 §五 / W5）。
 *
 * 为什么不复用 `server/api/mininet/[...slug].ts`：那条通道的出口恒为 `ApiResponse` JSON 信封，
 * 导出内容会被二次编码成一个字符串，`Content-Disposition` 也无处安放 —— 浏览器另存下来的
 * `.json` 里是 `{"code":0,"data":"{\"hosts\":[...]}"}`，`wget` 之后同样不可用；pcap 更糟，
 * 二进制过一遍 JSON 字符串就直接报废。
 *
 * 四条约束：
 * 1. 权限位**逐种类**不同：`json` / `script` 是 `lab:read`（不改变上游状态），
 *    `pcap` 是 `lab:sniffer`（文件里是全网流量原文，NMCPS-ADR-0021 D3）；
 * 2. 文件名由 BFF 生成（`lab-<network_id>-<timestamp>.<ext>`），不信任上游响应头；
 * 3. 失败仍回 JSON 信封（页面按 `ApiError` 处理），不把错误文本存成文件；
 * 4. 文本与二进制分开取：pcap 走 `arrayBuffer`，不按 UTF-8 解码（见 `fetchMininetBinary`）。
 *
 * 静态路由优先于 `[...slug]` 的 catch-all（与 `/api/mininet/channel` 同一条机制）。
 */
export default defineEventHandler(async (event): Promise<string | Uint8Array | ApiResponse<never>> => {
	const kind = parseLabExportKind(event.context.params?.kind);

	// 未登记的种类是路径问题（400），不是权限问题：判定顺序与 `[...slug].ts` 一致。
	// 先判种类再判权限：`lab:sniffer` 只该被已登记的 pcap 通道要求，不能让 `export/xml`
	// 因为「没有抓包权限」而回 403 —— 那会把路径写错伪装成权限不足。
	if (!kind) {
		return fail(event, 400, "bff_path_invalid");
	}

	const spec = LAB_EXPORT_UPSTREAMS[kind];
	const authorization = await authorizeLab(event, spec.permission);
	if (!authorization.ok) {
		return authorization.response;
	}

	const principal = authorization.principal;

	const network = await getActiveLabNetwork(event, principal, "mininet");
	if (!network) {
		return fail(event, 404, MININET_MESSAGES.resourceNotFound);
	}

	const config = getMininetConfig(event, principal.tenantId ?? "");
	const result = spec.binary
		? await fetchMininetBinary(event, config, spec.upstream)
		: await fetchMininetText(event, config, spec.upstream);

	if (!result.ok) {
		return fail(event, result.status, result.message);
	}

	setResponseStatus(event, 200);
	setResponseHeader(event, "content-type", spec.contentType);
	setResponseHeader(event, "cache-control", "no-store");
	setResponseHeader(event, "content-disposition", `attachment; filename="${labExportFilename(network.id, kind)}"`);

	return "text" in result ? result.text : result.bytes;
});

/** 失败一律回 JSON 信封：下载请求的调用方（`useApi().download()`）也按这一种形态解错 */
function fail(event: H3Event, status: number, message: string): ApiResponse<never> {
	setResponseStatus(event, status);
	setResponseHeader(event, "content-type", "application/json; charset=utf-8");
	setResponseHeader(event, "cache-control", "no-store");

	return {
		code: status,
		status: status >= 500 ? "error" : "warning",
		message,
		timestamp: new Date().toISOString()
	};
}
