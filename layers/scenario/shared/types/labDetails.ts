// layers/scenario/shared/types/labDetails.ts
// 节点 / 链路详情弹窗（NMCPS-ADR-0022 W13）的**纯数据**层：草稿预填、就地校验、请求体组装、读数归一。
//
// 约束：
// - 零 IO / 零 Vue：页面与自检脚本都直接调这里，组件不自己拼一份请求体。
// - 只拦「确定错」的输入（IP 形状、延迟单位、丢包区间），语义合法性仍归上游 ——
//   表单不复制一份上游规则，否则两边迟早不一致（与 `labNodes.ts` 同一口径）。
// - 「不发请求」是一个显式结果：链路属性全空时 `labLinkOptionsOf()` 回 `undefined`，
//   上游对空 `options` 只清台账、不回收已生效的 tc，给一个看起来生效的按钮更糟。
// - 请求体形状由 `NMCPS-ADR-0029`（`records/adr/adr-0029.md`）冻结：节点 / 链路属性都走会话 PATCH 的
//   `attributes` / `options`，键名用页面侧驼峰名（上游 `NODE_ATTRIBUTE_FIELDS` 归一）。

/** 就地报错的键后缀：`pages.scenario-simulator.nodeDetail.errors.<key>` */
export type LabDetailFieldError
	= | "ipInvalid"
		| "routeInvalid"
		| "interfaceInvalid"
		| "routeLineInvalid"
		| "bwInvalid"
		| "delayInvalid"
		| "jitterInvalid"
		| "lossInvalid";

type RawRecord = Record<string, unknown>;

function asRecord(value: unknown): RawRecord | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : undefined;
}

function textOf(value: unknown): string {
	if (typeof value === "string")
		return value.trim();
	return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

const OCTET = /^(?:\d{1,3}\.){3}\d{1,3}$/;

function isIpv4(value: string): boolean {
	const [address] = value.split("/", 1);
	if (!address || !OCTET.test(address))
		return false;
	return address.split(".").every((part) => Number(part) <= 255);
}

/** `10.0.0.2` / `10.0.0.2/24` 都算合法；前缀位数只做范围检查（0–32） */
function isIpv4WithPrefix(value: string): boolean {
	if (!isIpv4(value))
		return false;
	const prefix = value.split("/")[1];
	return prefix === undefined || (/^\d{1,2}$/.test(prefix) && Number(prefix) <= 32);
}

/* ── 主机（PATCH /sessions/{id}/nodes/{node_id} 的 attributes）────────── */

export interface LabHostDraft {
	ip: string
	/** 默认路由的两种写法（对应上游 `default_route_type`） */
	routeType: "dev" | "ip"
	routeValue: string
}

/**
 * 预填：`ip` 直接取台账值；默认路由从 `default_route`（形如
 * `default via 10.0.0.254 dev h1-eth0`）里认出是「走网关」还是「走设备」，
 * 认不出就留空 —— 空 = 本次不改默认路由。
 */
export function labHostDraftOf(raw: RawRecord | null | undefined): LabHostDraft {
	const source = asRecord(raw) ?? {};
	const route = textOf(source.default_route);
	if (route.includes(" via "))
		return { ip: textOf(source.ip), routeType: "ip", routeValue: route.split(" via ")[1]?.trim().split(/\s+/)[0] ?? "" };
	if (route.includes(" dev "))
		return { ip: textOf(source.ip), routeType: "dev", routeValue: route.split(" dev ")[1]?.trim().split(/\s+/)[0] ?? "" };
	return { ip: textOf(source.ip), routeType: "dev", routeValue: "" };
}

export function labHostUpdateError(draft: LabHostDraft): LabDetailFieldError | undefined {
	if (!isIpv4WithPrefix(draft.ip.trim()))
		return "ipInvalid";
	const route = draft.routeValue.trim();
	if (!route)
		return undefined;
	if (draft.routeType === "ip")
		return isIpv4(route) ? undefined : "routeInvalid";
	return /^[\w.:-]+$/.test(route) ? undefined : "routeInvalid";
}

/**
 * 会话 PATCH 的 `attributes`（`NMCPS-ADR-0029` D1）：请求键用页面侧的驼峰名，
 * 上游按 `NODE_ATTRIBUTE_FIELDS` 归一成台账键。路由留空时**不**碰默认路由
 * （空串在台账里是「删除默认路由」，与「没改」是两件事）。
 */
export function labHostAttributesOf(draft: LabHostDraft): RawRecord {
	const attributes: RawRecord = { ip: draft.ip.trim() };
	const route = draft.routeValue.trim();
	if (!route)
		return attributes;
	// 上游 `setDefaultRoute()` 吃的是一整条路由参数：走网关要带 `via`，走设备直接给接口名
	attributes.defaultRoute = draft.routeType === "ip" ? `via ${route}` : route;
	return attributes;
}

/* ── 路由器（PATCH /sessions/{id}/nodes/{node_id} 的 attributes）────────── */

export interface LabRouterDraft {
	ip: string
	/** 一行一个 `接口=IP/前缀`（上游 `interface_ips` 是对象，这里用文本承载） */
	interfaceIps: string
	/** 一行一条静态路由（原样交给上游 `routes`） */
	routes: string
	proxyArp: boolean
	ipForward: boolean
}

export function labRouterDraftOf(raw: RawRecord | null | undefined): LabRouterDraft {
	const source = asRecord(raw) ?? {};
	const interfaceIps = asRecord(source.interface_ips) ?? {};
	const routes = Array.isArray(source.routes) ? source.routes.map((line) => textOf(line)).filter(Boolean) : [];
	return {
		ip: textOf(source.ip),
		interfaceIps: Object.entries(interfaceIps)
			.map(([name, value]) => `${name}=${textOf(value)}`)
			.join("\n"),
		routes: routes.join("\n"),
		proxyArp: source.proxy_arp !== false,
		ipForward: source.ip_forward !== false
	};
}

/** `eth0=10.0.0.1/24`：名字不带空白，右边必须是 IP（前缀可选） */
function interfaceLinesOf(value: string): [string, string][] | undefined {
	const lines = value.split("\n").map((line) => line.trim()).filter(Boolean);
	const entries: [string, string][] = [];
	for (const line of lines) {
		const index = line.indexOf("=");
		if (index <= 0)
			return undefined;
		const name = line.slice(0, index).trim();
		const ip = line.slice(index + 1).trim();
		if (!/^[\w.:-]+$/.test(name) || !isIpv4WithPrefix(ip))
			return undefined;
		entries.push([name, ip]);
	}
	return entries;
}

function routeLinesOf(value: string): string[] {
	return value.split("\n").map((line) => line.trim()).filter(Boolean);
}

/** 静态路由的宽松形状：`default …` 或 `网段/前缀 …`（其余交给上游 `_normalize_route`） */
function isRouteLine(value: string): boolean {
	const head = value.split(/\s+/)[0] ?? "";
	return head === "default" || isIpv4WithPrefix(head);
}

export function labRouterUpdateError(draft: LabRouterDraft): LabDetailFieldError | undefined {
	if (draft.ip.trim() && !isIpv4WithPrefix(draft.ip.trim()))
		return "ipInvalid";
	if (draft.interfaceIps.trim() && interfaceLinesOf(draft.interfaceIps) === undefined)
		return "interfaceInvalid";
	if (routeLinesOf(draft.routes).some((line) => !isRouteLine(line)))
		return "routeLineInvalid";
	return undefined;
}

/** 路由器：会话 `attributes`（键名与 `labHostAttributesOf` 同口径） */
export function labRouterAttributesOf(draft: LabRouterDraft): RawRecord {
	const attributes: RawRecord = {
		routes: routeLinesOf(draft.routes),
		proxyArp: draft.proxyArp,
		ipForward: draft.ipForward
	};
	const ip = draft.ip.trim();
	if (ip)
		attributes.ip = ip;
	const entries = interfaceLinesOf(draft.interfaceIps);
	// 接口 IP 为空 = 不改：上游对未启动的网络会回 404，没必要为了「没改」去撞它
	if (entries?.length)
		attributes.interfaceIps = Object.fromEntries(entries);
	return attributes;
}

/* ── 链路（PATCH /sessions/{id}/links/{link_id} 的 options）─────────────── */

export interface LabLinkDraft {
	bw: string
	delay: string
	jitter: string
	loss: string
}

/**
 * 只认 `NMCPS-ADR-0029` §3 的四个可更新键。
 *
 * `max_queue_size` / `use_htb` 是 1.x 专用参数（会话 PATCH 对它俩回 400），因此不进草稿 ——
 * 弹窗只把台账里已有的值当**只读事实**展示，不给一个按下去必然失败的输入框。
 */
export function labLinkDraftOf(options: RawRecord | null | undefined): LabLinkDraft {
	const source = asRecord(options) ?? {};
	return {
		bw: textOf(source.bw),
		delay: textOf(source.delay),
		jitter: textOf(source.jitter),
		loss: textOf(source.loss)
	};
}

/** `10ms` / `1s` / `500us` / 裸数字（上游会把裸数字补成 `ms`） */
function isDelay(value: string): boolean {
	return /^\d+(?:\.\d+)?(?:ms|us|s)?$/.test(value);
}

function numberOf(value: string): number | undefined {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

export function labLinkUpdateError(draft: LabLinkDraft): LabDetailFieldError | undefined {
	if (draft.bw.trim() && (numberOf(draft.bw) ?? 0) <= 0)
		return "bwInvalid";
	if (draft.delay.trim() && !isDelay(draft.delay.trim()))
		return "delayInvalid";
	if (draft.jitter.trim() && !isDelay(draft.jitter.trim()))
		return "jitterInvalid";
	if (draft.loss.trim()) {
		const loss = numberOf(draft.loss);
		if (loss === undefined || loss < 0 || loss > 100)
			return "lossInvalid";
	}
	return undefined;
}

/**
 * 会话链路 PATCH 的 `options`：只带填过的属性；全空回 `undefined`（调用方因此不发请求）。
 *
 * 显式 `{}` 与「没改」是两件事：前者会清空台账属性且不回收已下发的 tc
 * （`NMCPS-ADR-0029` §5），所以清空不从这里发。
 */
export function labLinkOptionsOf(draft: LabLinkDraft): RawRecord | undefined {
	const options: RawRecord = {};
	const bw = numberOf(draft.bw);
	if (draft.bw.trim() && bw !== undefined)
		options.bw = bw;
	const delay = draft.delay.trim();
	if (delay)
		options.delay = /^\d+(?:\.\d+)?$/.test(delay) ? Number(delay) : delay;
	const jitter = draft.jitter.trim();
	if (jitter)
		options.jitter = /^\d+(?:\.\d+)?$/.test(jitter) ? Number(jitter) : jitter;
	const loss = numberOf(draft.loss);
	if (draft.loss.trim() && loss !== undefined)
		options.loss = loss;

	return Object.keys(options).length ? options : undefined;
}

/* ── 读数归一（GET /stats/{id}、GET /links/stats/{src}/{dst}）──────────── */

export interface LabArpRow {
	ip: string
	mac: string
	intf: string
}

export interface LabNodeLiveStats {
	defaultRoute: string
	interfaces: string[]
	arpRows: LabArpRow[]
	flowCount: number
}

export function labNodeStatsOf(payload: unknown): LabNodeLiveStats {
	const source = asRecord(payload) ?? {};
	const arpRows = Array.isArray(source.arp_table)
		? source.arp_table.flatMap((row) => {
			const record = asRecord(row);
			const ip = textOf(record?.ip);
			if (!record || !ip)
				return [];
			return [{ ip, mac: textOf(record.mac), intf: textOf(record.interface) }];
		})
		: [];
	return {
		defaultRoute: textOf(source.default_route),
		interfaces: Array.isArray(source.interfaces) ? source.interfaces.map((item) => textOf(item)).filter(Boolean) : [],
		arpRows,
		flowCount: Array.isArray(source.flow_table) ? source.flow_table.length : 0
	};
}

export interface LabLinkStatRow {
	name: string
	txBytes: number | null
	rxBytes: number | null
}

export interface LabLinkLiveStats {
	rows: LabLinkStatRow[]
	options: RawRecord
	timestamp: string
}

function counterOf(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function labLinkStatsOf(payload: unknown): LabLinkLiveStats {
	const source = asRecord(payload) ?? {};
	const rows = Array.isArray(source.intfs)
		? source.intfs.flatMap((item) => {
			const record = asRecord(item);
			const name = textOf(record?.name);
			if (!record || !name)
				return [];
			return [{ name, txBytes: counterOf(record.tx_bytes), rxBytes: counterOf(record.rx_bytes) }];
		})
		: [];
	return {
		rows,
		options: asRecord(source.options) ?? {},
		timestamp: textOf(source.timestamp)
	};
}
