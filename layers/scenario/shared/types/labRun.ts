// layers/scenario/shared/types/labRun.ts
// 运行控制的**纯数据 + 纯函数**：运行态读数归一、iperf 草稿校验、草稿 → 上游请求体、结果文本化。
//
// 设计基准（NMCPS-ADR-0022 W3）：
// - `POST /start`：建网并启动全部节点（`lab:create`；上游已启动回 400 "network already started"）；
// - `POST /stop`：停网、`mn -c`，再按台账重建**未启动**的拓扑对象（`lab:operate`）；
// - `POST /pingall`：全网可达性探测，上游回**一整段文本**（未启动 400 / 在途 409）；
// - `POST /iperf`：两台 host 之间的吞吐测试，请求体是 `IperfRequest`
//   （未启动 400 / 同一台 host 400 / 在途 409）。
//
// 不做的事：不发请求、不读能力位、不解释 ping / iperf 的输出语义 ——
// 上游原文逐字展示，页面只负责摆位置。
// 事实源：`services/mininet-api/mininet_gui_backend/api.py` 的 `IperfRequest` 与四个处理函数。

/** iperf 表单草稿：字段都收 `UInput` / `USelect` 的原生值，校验时才归一 */
export interface LabIperfDraft {
	/** 客户端 host id */
	client: string
	/** 服务端 host id */
	server: string
	/** `TCP` / `UDP`（上游 `l4_type`，缺省 `TCP`） */
	l4Type: LabIperfL4Type
	/**
	 * 测试秒数；留空 = 用上游默认（5 秒）。
	 *
	 * 声明成 `string` 是 `UInput` 的类型契约，但 `type="number"` 在运行时交回 **number** ——
	 * 与 `LabFlowDraft.priority` 同一个坑，归一统一走 `labIperfSecondsOf()`，不直接 `.trim()`。
	 */
	seconds: string
}

/** 失败原因：返回 i18n 键后缀，由页面拼成 `run.errors.<suffix>` */
export type LabIperfDraftError = "clientRequired" | "serverRequired" | "sameEndpoint" | "secondsInvalid";

/** 上游 `IperfRequest.l4_type` 的取值（其余值 py 侧不拦，但 UI 只给这两个） */
export const LAB_IPERF_L4_TYPES = ["TCP", "UDP"] as const;

/** 草稿里 `l4_type` 的类型：与 `USelect` 的 items 推断一致（`string` 会被 v-model 判成不兼容） */
export type LabIperfL4Type = (typeof LAB_IPERF_L4_TYPES)[number];

/** 秒数上界：比这更长的吞吐测试会一直占住 Mininet 单实例，取值只是防手滑 */
export const LAB_IPERF_SECONDS_MAX = 3600;

/** 空草稿：切换网络 / 重跑前重置 */
export function labIperfDraftOf(): LabIperfDraft {
	return { client: "", server: "", l4Type: "TCP", seconds: "" };
}

/**
 * 运行态读数（`GET /api/mininet/start` → 上游 `app.net.is_started`）归一。
 *
 * 只认布尔：读不到 / 形状不符一律 `null`（= 未知），**不猜「应该没启动」** ——
 * 猜错会让「启动」按钮对着一个已在跑的网络发请求，收一句 400 当失败。
 */
export function labRunStateOf(payload: unknown): boolean | null {
	return typeof payload === "boolean" ? payload : null;
}

/** 秒数归一：留空 = `undefined`（上游默认），否则必须是 1..3600 的十进制整数 */
function labIperfSecondsOf(raw: string | number): number | undefined {
	const value = String(raw ?? "").trim();
	if (!value)
		return undefined;
	// 只收十进制数字：`1e3` / `5.0` / `+5` 是打错的表现，静默换算成 1000 比报错更难查
	if (!/^\d+$/.test(value))
		return undefined;
	const seconds = Number(value);
	if (seconds < 1 || seconds > LAB_IPERF_SECONDS_MAX)
		return undefined;
	return seconds;
}

/**
 * 草稿校验：两台 host 必填、不能是同一台（上游 `client == server` 回 400）、
 * 填了秒数就必须是 1..3600 的整数。
 *
 * 其余（host 是否存在、是否真在运行）交给上游 —— 本地拿台账猜一遍只会得到第二套规则。
 */
export function labIperfDraftError(draft: LabIperfDraft): LabIperfDraftError | undefined {
	const client = String(draft.client ?? "").trim();
	const server = String(draft.server ?? "").trim();
	if (!client)
		return "clientRequired";
	if (!server)
		return "serverRequired";
	if (client === server)
		return "sameEndpoint";

	const seconds = String(draft.seconds ?? "").trim();
	if (seconds && labIperfSecondsOf(draft.seconds) === undefined)
		return "secondsInvalid";

	return undefined;
}

/**
 * 草稿 → 上游请求体（`IperfRequest`）：`seconds` 留空则**不发**，让上游用它自己的默认；
 * `l4_type` 总发（上游缺省也是 `TCP`，显式发能避免「表单显示 UDP、实际跑 TCP」）。
 */
export function labIperfPayloadOf(draft: LabIperfDraft): Record<string, unknown> {
	const payload: Record<string, unknown> = {
		client: String(draft.client ?? "").trim(),
		server: String(draft.server ?? "").trim(),
		l4_type: String(draft.l4Type ?? "").trim() || "TCP"
	};

	const seconds = labIperfSecondsOf(draft.seconds);
	if (seconds !== undefined)
		payload.seconds = seconds;

	return payload;
}

/**
 * `pingall` 响应的文本化：上游 `run_pingall()` 返回 `"\n".join([...])`，
 * 经 FastAPI 序列化成**一个 JSON 字符串**（带换行）。数组形态（假上游 / 未来变更）按行拼。
 * 空串 = 没有可显示的内容，页面据此不渲染结果块。
 */
export function labRunOutputOf(payload: unknown): string {
	if (typeof payload === "string")
		return payload.trim();
	if (Array.isArray(payload))
		return payload.map((line) => String(line)).join("\n").trim();
	return "";
}

/** iperf 结果：上游回 `{ client, server }`（`iperf()` 返回非二元组时回 `{ result }`） */
export interface LabIperfResult {
	client: string
	server: string
}

/** 结果两侧各可以是字符串或对象（Mininet 的 `iperf()` 原样回传），统一转成可显示文本 */
function labIperfSideOf(value: unknown): string {
	if (typeof value === "string")
		return value.trim();
	if (value === undefined || value === null)
		return "";
	return JSON.stringify(value);
}

/**
 * iperf 响应 → 可显示的两段文本。
 *
 * 上游在 `iperf()` 没回二元组时给 `{ result: … }`：那一段塞进 client 侧，
 * server 侧留空 —— 总比丢掉整段结果、只显示「成功」要好。
 */
export function labIperfResultOf(payload: unknown): LabIperfResult | null {
	if (!payload || typeof payload !== "object" || Array.isArray(payload))
		return null;

	const record = payload as Record<string, unknown>;
	if (!("client" in record) && !("server" in record) && !("result" in record))
		return null;

	return {
		client: labIperfSideOf(record.client ?? record.result),
		server: labIperfSideOf(record.server)
	};
}
