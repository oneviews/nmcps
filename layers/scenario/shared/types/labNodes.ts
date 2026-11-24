// layers/scenario/shared/types/labNodes.ts
// 拓扑编辑的**纯数据 + 纯函数**：五类节点的写端点映射、表单草稿 → 上游请求体、草稿校验。
//
// 设计基准：
// - NMCPS-ADR-0022 D2（写端点按权限位分档；本文件只管「发什么」，权限位在 BFF 判定）；
// - `services/mininet-api/mininet_gui_backend/schema.py`（`Host` / `Switch` / `Router` / `Nat` /
//   `Controller` 的必填字段是唯一事实源，草稿 → 请求体的映射按它对齐）。
//
// 不做的事：不发请求、不读能力位、不拼 BFF 路径之外的东西 —— 页面负责调用，
// `MININET_ROUTES` 负责出站白名单。

/** 可创建的节点类型（与上游 `POST /api/mininet/*` 一一对应） */
export const LAB_NODE_KINDS = ["host", "switch", "router", "nat", "controller"] as const;

export type LabNodeKind = (typeof LAB_NODE_KINDS)[number];

/** 类型 → BFF 集合端点（`lab:create` 分档里的七条中与建节点相关的五条） */
export const LAB_NODE_COLLECTIONS: Record<LabNodeKind, string> = {
	host: "/api/mininet/hosts",
	switch: "/api/mininet/switches",
	router: "/api/mininet/routers",
	nat: "/api/mininet/nats",
	controller: "/api/mininet/controllers"
};

/** 上游 `Switch.switch_type` 的合法取值（`format_switch()` 的分支） */
export const LAB_SWITCH_TYPES = ["ovskernel", "ovs", "ovsbridge", "user"] as const;

export type LabSwitchType = (typeof LAB_SWITCH_TYPES)[number];

/** 上游 `Switch.of_version` 的合法取值（`update_switch_openflow_version` 的白名单） */
export const LAB_OPENFLOW_VERSIONS = ["OpenFlow10", "OpenFlow11", "OpenFlow12", "OpenFlow13", "OpenFlow14", "OpenFlow15"] as const;

/** 名称前缀：新节点的默认名（`h1` / `sw1` / `r1` / `nat1` / `c0`） */
export const LAB_NODE_PREFIXES: Record<LabNodeKind, string> = {
	host: "h",
	switch: "sw",
	router: "r",
	nat: "nat",
	controller: "c"
};

/** 删除目标：节点或链路（确认弹窗与页面共用） */
export interface LabRemoveTarget {
	kind: "node" | "link"
	/** 节点 id（`kind = node`） */
	id?: string
	/** 链路两端（`kind = link`） */
	source?: string
	target?: string
}

/** 新建节点落在画布上的默认坐标（`x` / `y` 与上游台账同口径） */
export interface LabNodeOrigin {
	x: number
	y: number
}

/** 表单草稿（组件持有；`label` 留空时取 `name`） */
export interface LabNodeDraft {
	name: string
	label: string
	ip: string
	mac: string
	ports: number
	switchType: LabSwitchType
	controllerPort: number
}

/** 名称 / 标识允许的字符：与上游 `_INTERFACE_NAME_RE` 同口径，避免建出删不掉的节点 */
const SAFE_NAME_RE = /^[\w.-]+$/;
/** 宽松 IPv4 / CIDR：真正的合法性由上游 `_normalize_interface_ip()` 判定，这里只拦明显的手滑 */
const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?$/;
/** MAC：允许空（建节点时按序号生成），非空则必须是 6 段十六进制 */
const MAC_RE = /^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$/i;

/** 草稿校验的失败原因：返回 i18n 的**键后缀**，由组件拼成完整键 */
export type LabNodeDraftError = "nameRequired" | "nameInvalid" | "nameTaken" | "ipRequired" | "ipInvalid" | "macInvalid" | "portsInvalid" | "portInvalid";

/** 该类型是否需要 IP / MAC（`Nat` 两者可空，`Switch` / `Controller` 不填 MAC） */
export function labNodeUsesIp(kind: LabNodeKind): boolean {
	return kind === "host" || kind === "router" || kind === "controller";
}

export function labNodeUsesMac(kind: LabNodeKind): boolean {
	return kind === "host" || kind === "router";
}

/** 新节点的默认草稿：名字与 IP 只保证「看起来合理」，重名由 `labNodeDraftError()` 拦 */
export function labNodeDraftOf(kind: LabNodeKind, index: number): LabNodeDraft {
	const ordinal = Math.max(1, index);
	return {
		name: `${LAB_NODE_PREFIXES[kind]}${ordinal}`,
		label: "",
		ip: kind === "controller" ? "127.0.0.1" : `10.0.0.${ordinal}`,
		mac: `00:00:00:00:00:${ordinal.toString(16).padStart(2, "0").slice(-2)}`,
		ports: 4,
		switchType: LAB_SWITCH_TYPES[0],
		controllerPort: 6653
	};
}

/**
 * 草稿校验。`existing` 是画布上已有的节点 id（含五类），用于拦重名 ——
 * 上游会静默 `updated`，页面看起来「新增成功」但对象被覆盖，必须在提交前拦住。
 */
export function labNodeDraftError(
	kind: LabNodeKind,
	draft: LabNodeDraft,
	existing: readonly string[]
): LabNodeDraftError | undefined {
	const name = draft.name.trim();

	if (!name)
		return "nameRequired";
	if (!SAFE_NAME_RE.test(name))
		return "nameInvalid";
	if (existing.some((id) => id === name))
		return "nameTaken";
	if (labNodeUsesIp(kind) && !IPV4_RE.test(draft.ip.trim()))
		return draft.ip.trim() ? "ipInvalid" : "ipRequired";
	if (labNodeUsesMac(kind) && draft.mac.trim() && !MAC_RE.test(draft.mac.trim()))
		return "macInvalid";
	if (kind === "switch" && (!Number.isInteger(draft.ports) || draft.ports < 1))
		return "portsInvalid";
	if (kind === "controller" && (!Number.isInteger(draft.controllerPort) || draft.controllerPort < 1 || draft.controllerPort > 65_535))
		return "portInvalid";

	return undefined;
}

/**
 * 草稿 → 上游请求体。
 *
 * 字段与 `schema.py` 对齐：`Host` / `Router` 要 `ip` + `mac`，`Switch` 要 `ports` +
 * `controller`（可空）+ `switch_type`，`Nat` 的 `ip` / `mac` 可空，`Controller` 要
 * `remote` + `ip` + `port`。`type` 取语义名（`host` / `switch` / …）：上游节点的
 * `node.type` 由 `add_*_to_net()` 自己写（`sw` / `router` …），请求体里的 `type` 只做留痕。
 */
export function labNodePayloadOf(
	kind: LabNodeKind,
	draft: LabNodeDraft,
	origin: LabNodeOrigin
): Record<string, unknown> {
	const name = draft.name.trim();
	const base = {
		id: name,
		type: kind,
		name,
		label: draft.label.trim() || name,
		x: origin.x,
		y: origin.y
	};

	if (kind === "host") {
		return { ...base, ip: draft.ip.trim(), mac: draft.mac.trim() || "00:00:00:00:00:00" };
	}
	if (kind === "router") {
		return { ...base, ip: draft.ip.trim(), mac: draft.mac.trim() || "00:00:00:00:00:00" };
	}
	if (kind === "switch") {
		return { ...base, ports: draft.ports, controller: null, switch_type: draft.switchType };
	}
	if (kind === "nat") {
		return { ...base, ip: draft.ip.trim() || null, mac: draft.mac.trim() || null };
	}
	return {
		...base,
		controller_type: "remote",
		remote: true,
		ip: draft.ip.trim() || "127.0.0.1",
		port: draft.controllerPort,
		ryu_app: null
	};
}
