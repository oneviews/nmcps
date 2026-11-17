// layers/scenario/shared/types/labFlows.ts
// 流表编辑的**纯数据 + 纯函数**：草稿校验、草稿 → 上游请求体、`dump-flows` 原文 → 可删行。
//
// 设计基准：
// - NMCPS-ADR-0022 W2b（流表写入归 `lab:operate`，端点 `POST /flows`、
//   `DELETE /flows`（按 `match` 批量 / 留空清整表）与 `DELETE /flows/{switch_id}/{flow_id}`）；
// - `services/mininet-api/mininet_gui_backend/flow_rules.py`（`FlowRuleCreate` 的字段与
//   `actions` / `match` 归一规则是唯一事实源）；
// - `api.py::delete_flow_by_id()` 用「`dump-flows` 里**含 `actions=` 的行**的 1 基序号」
//   定位单条流 —— 页面侧的行号必须按同一口径数，否则删掉的是另一条流。
//
// 不做的事：不发请求、不读能力位、不解析流表语义（`actions=` / `match` 原样透传，
// 合法性由上游 `ovs-ofctl` 判定）。

/** 加流表单草稿：三个字段都收字符串（`UInput` 原生值），校验时才归一 */
export interface LabFlowDraft {
	/** 匹配域，例如 `ip,nw_dst=10.0.0.9`；留空 = 通配 */
	match: string
	/** 动作，例如 `output:2`；允许用户把 `actions=` 前缀一起粘进来 */
	actions: string
	/**
	 * 优先级；留空 = 交给上游默认。
	 *
	 * 声明成 `string` 是 `UInput` 的类型契约，但 `type="number"` 的输入在运行时会把
	 * v-model 交回 **number** —— 所以校验 / 发送一律走 `labFlowPriorityOf()`，不直接 `.trim()`
	 * （否则抛 TypeError，点击后静默不写，check:ui 11.4 抓到过）。
	 */
	priority: string
}

/** 失败原因：返回 i18n 键后缀，由页面拼成 `flows.errors.<suffix>` */
export type LabFlowDraftError = "actionsRequired" | "matchInvalid" | "priorityInvalid";

/** `FlowRuleCreate.priority` 的上界（`le=65535`） */
export const LAB_FLOW_PRIORITY_MAX = 65_535;

/** 空草稿：切换选中交换机时重置，避免把上一台交换机的规则带过去 */
export function labFlowDraftOf(): LabFlowDraft {
	return { match: "", actions: "", priority: "" };
}

/**
 * 动作归一：与上游 `normalize_actions()` 同口径 —— 去掉 `actions=` 前缀与空白，
 * 归一后为空即视为「没填」。
 */
export function labFlowActionsOf(raw: string): string {
	const value = raw.trim();
	const stripped = value.toLowerCase().startsWith("actions=") ? value.slice("actions=".length).trim() : value;
	return stripped;
}

/**
 * 优先级归一：`UInput type="number"` 在运行时交回的是 number（类型声明只写 `string`），
 * 两种都按字符串处理，绝不直接 `.trim()`。
 */
function labFlowPriorityOf(raw: string | number): string {
	return String(raw ?? "").trim();
}

/** 草稿校验：动作必填、`match` 不许夹带 `actions=`、优先级是 0-65535 的整数 */
export function labFlowDraftError(draft: LabFlowDraft): LabFlowDraftError | undefined {
	if (!labFlowActionsOf(String(draft.actions ?? "")))
		return "actionsRequired";
	if (String(draft.match ?? "").toLowerCase().includes("actions="))
		return "matchInvalid";

	const priority = labFlowPriorityOf(draft.priority);
	if (priority && (!/^\d{1,5}$/.test(priority) || Number(priority) > LAB_FLOW_PRIORITY_MAX))
		return "priorityInvalid";

	return undefined;
}

/**
 * 草稿 → 上游请求体（`FlowRuleCreate`）。
 * `match` / `priority` 留空时**不发送**：上游对缺省字段走 `None`，发 `""` 会被校验器当成空串处理，
 * 两者语义相同但没有必要多带一个字段。
 */
export function labFlowPayloadOf(switchId: string, draft: LabFlowDraft): Record<string, unknown> {
	const payload: Record<string, unknown> = {
		switch: switchId,
		actions: labFlowActionsOf(String(draft.actions ?? ""))
	};

	const match = String(draft.match ?? "").trim();
	if (match)
		payload.match = match;

	const priority = labFlowPriorityOf(draft.priority);
	if (priority)
		payload.priority = Number(priority);

	return payload;
}

/**
 * 清流（批量 `DELETE /flows`）的匹配域归一：与 `FlowRuleDelete.normalize_match()` 同口径 ——
 * 去空白，留空即「整表」。夹带 `actions=` 由 `labFlowClearError()` 拦下（上游会 422）。
 */
export function labFlowClearMatchOf(raw: string | number): string {
	return String(raw ?? "").trim();
}

/**
 * 清流草稿校验：只拦一条 —— 匹配域夹带 `actions=`。
 *
 * 与 `labFlowDraftError()` 的区别在于 **`match` 留空是合法的**（= 清空整表），
 * 所以不能复用加流那套（那里动作必填）。
 */
export function labFlowClearError(raw: string | number): LabFlowDraftError | undefined {
	if (labFlowClearMatchOf(raw).toLowerCase().includes("actions="))
		return "matchInvalid";
	return undefined;
}

/**
 * 清流请求体（`FlowRuleDelete`）：`switch` 必带，`match` 留空则**不发** ——
 * 上游 `build_flow_match()` 得到 `None`，即 `ovs-ofctl del-flows <switch>` 清整表；
 * 带了 `match` 就只删命中项，语义由上游决定，页面不另发明。
 */
export function labFlowClearPayloadOf(switchId: string, match: string | number): Record<string, unknown> {
	const payload: Record<string, unknown> = { switch: switchId };

	const normalized = labFlowClearMatchOf(match);
	if (normalized)
		payload.match = normalized;

	return payload;
}

/** 流表里的一行：`id` 只对含 `actions=` 的行给出（= 上游删单条流的 1 基序号） */
export interface LabFlowRow {
	id?: number
	text: string
}

/**
 * `dump-flows` 原文 → 行。序号口径必须与 `api.py::delete_flow_by_id()` 完全一致：
 * 先按换行切分、只保留**含 `actions=`** 的行参与计数，空行不计入。
 */
export function labFlowRowsOf(text: string): LabFlowRow[] {
	const rows: LabFlowRow[] = [];
	let counter = 0;

	for (const raw of text.split("\n")) {
		const line = raw.trimEnd();
		if (!line)
			continue;
		if (line.includes("actions="))
			rows.push({ id: ++counter, text: line });
		else
			rows.push({ text: line });
	}

	return rows;
}
