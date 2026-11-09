// app/utils/metric/metricLedger.ts
// 指标台账（`/metric/device` / `/metric/link`）的**纯函数**归一内核（`NMCPS-CONTRACT-002` §九）。
// 零 I/O：请求在 `layers/topology/app/composables/useMetricLedger.ts`，这里只把 wire 事实收成
// 「左栏能直接渲染的一行」。
//
// 三条口径（§九，改之前先改契约）：
//   ① 主键缺失的条目丢弃：设备靠 `device_code`、链路靠 `identity.link_id` —— 没有主键既拼不出
//      `?id`，也拼不出后续请求，留着只会变成点了没反应的行；
//   ② `null` = 不可判定（契约禁 0 / 空串伪造），这里显式保留 `null`，展示层显示 `—`；
//   ③ 链路**没有 `mgmt_ip`**：链路级时序缺口（`NMCPS-DESIGN-001` §6.6）用 `deviceIpIndex()`
//      经 `/metric/device` 反查 source 端设备的 IP，反查不到就不出折线，绝不猜一个 IP。
import type { MetricDeviceFact, MetricLinkEndpoint, MetricLinkFact } from "~~/shared/types/metric";

/** 一个协议计数器的展示项：`field` 是上游 schema 原样键名（属数据，不翻译），值缺即 `null` */
export interface MetricCounterView {
	field: string
	value: number | null
}

/** LLDP 本机端口（展示用） */
export interface MetricLldpPortView {
	portNum: string
	portId: string
	portDesc: string
}

/** LLDP 邻居（展示用；`localPortNum` 与 `ports[].portNum` 同域，可反查本机端口名） */
export interface MetricLldpNeighborView {
	sysName: string
	chassisId: string
	localPortNum: string
	portId: string
	portDesc: string
	/** 对端管理地址（`man_addr`，实测 110 条邻居里多数有）：属数据，原样 */
	manAddr: string
	/** 对端系统描述（`sys_desc`，实测是 Linux 发行版串）：属数据，原样 */
	sysDesc: string
}

/** 无线关联客户端（展示用） */
export interface MetricRadioAssocView {
	index: string
	staName: string
	staMac: string
	rssiDbm: number | null
	txRateMbps: number | null
	status: string
}

/** MLO 多链路（展示用）：逐条从链路，字段原样（`status` 是上游数值字符串） */
export interface MetricRadioMultilinkView {
	index: string
	band: number | null
	channel: number | null
	bssid: string
	rssiDbm: number | null
	txRateMbps: number | null
	status: string
}

/** 射频事实（展示用）：`radio` 整块为 `null` ⇒ 非无线设备（不是失败） */
export interface MetricRadioView {
	/** `radio.role`（上游数值枚举，原样） */
	role: number | null
	ssid: string
	channel: number | null
	band: number | null
	mode: number | null
	/** `bss_type` / `power_mgmt_mode`：上游数值枚举，原样 */
	bssType: number | null
	powerMgmtMode: number | null
	frequencyMhz: number | null
	bandwidthMhz: number | null
	txPowerDbm: number | null
	noiseDbm: number | null
	interferenceLevel: number | null
	assocCount: number | null
	supportedRatesTxMbps: number | null
	supportedRatesRxMbps: number | null
	operationalRates: number[]
	associations: MetricRadioAssocView[]
	multilinks: MetricRadioMultilinkView[]
	/** 对端 AP（终端报的是它关联的那个 AP）：名称与 MAC 原样 */
	peerApName: string
	peerApMac: string
}

/** 硬件实体（展示用；`admin_status` / `oper_status` 是上游数值枚举，原样） */
export interface MetricHwEntityView {
	index: string
	boardName: string
	modelName: string
	adminStatus: number | null
	operStatus: number | null
}

/** 设备台账的一行（左栏渲染 + 右栏详情共用；详情只读，不再回查 `MetricDeviceFact`） */
export interface MetricDeviceRow {
	/** `device_code`（`?id` 用） */
	id: string
	/** 展示名：`sys_name` 兜 `device_code` */
	name: string
	/** 管理 IP；空串 = 上游没给，页面据此说明「取不到时序」而不是发一个空 `mgmt_ip` 请求 */
	mgmtIp: string
	role: string
	vendor: string
	/** 型号（`model`；上游可能不给） */
	model: string
	status: string
	/** 运行时长（秒）；`null` = 不可判定 */
	uptimeSec: number | null
	cpu: number | null
	mem: number | null
	/** 温度（℃，`health.temperature_c`）；`null` = 不可判定 */
	temperatureC: number | null
	/** 端口汇总：`up` / `down` / `total`，缺一个就是 `null`（不拼 0/0） */
	portsUp: number | null
	portsDown: number | null
	portsTotal: number | null
	/** 端口汇总的补充维度（实测上游给）：`unknown` / `wired` / `wireless` */
	portsUnknown: number | null
	portsWired: number | null
	portsWireless: number | null
	/** 设备流量（`traffic`）；一期速率类可能恒 `null`，展示层显示 `—` 且不写 0 */
	trafficInBps: number | null
	trafficOutBps: number | null
	trafficTotalBps: number | null
	trafficInOctetsTotal: number | null
	trafficOutOctetsTotal: number | null
	// ── 系统信息（`sys_*`；全部原样，不翻译、不裁剪）─────────────────────────
	sysDescr: string
	sysObjectId: string
	sysContact: string
	sysLocation: string
	/** 启用的服务位图：上游数值，原样展示 */
	sysServices: number | null
	// ── 硬件 / 转发面（`hw`；键恒在、值可能全 null）────────────────────────
	hwEntityCount: number | null
	hwVlanCount: number | null
	hwRouteCount: number | null
	hwFdbCount: number | null
	hwMstpStatus: string
	// ── 邻居（`neighbors[]` + `neighbor_summary`）──────────────────────────
	/** 邻居名称清单（原样，不排序 / 不去重） */
	neighbors: string[]
	/** 邻居总数：`neighbor_summary.total` 优先；没有 summary 时用清单长度；两者都缺 ⇒ `null`（不写 0） */
	neighborTotal: number | null
	neighborRouter: number | null
	neighborL3Switch: number | null
	neighborL2Switch: number | null
	neighborAp: number | null
	neighborSta: number | null
	// ── 协议栈计数器（`protocol`；顺序固定，值缺即 null）───────────────────
	protocolIp: MetricCounterView[]
	protocolIcmp: MetricCounterView[]
	protocolTcp: MetricCounterView[]
	protocolUdp: MetricCounterView[]
	// ── LLDP（`lldp`；整块 null = 该设备没上报，不是失败）─────────────────
	lldpPresent: boolean
	lldpChassisId: string
	lldpSysDesc: string
	/** 本机管理地址（`lldp.man_addr`） */
	lldpManAddr: string
	lldpPorts: MetricLldpPortView[]
	lldpNeighbors: MetricLldpNeighborView[]
	/** 硬件实体清单（`hw.entities[]`；实测只有交换机报，空数组是真实回答） */
	hwEntities: MetricHwEntityView[]
	// ── 射频（`radio`；null = 非无线设备）────────────────────────────────
	radio: MetricRadioView | null
	// ── 探针侧质量（`device_quality`）────────────────────────────────────
	qualityLatencyUs: number | null
	qualityJitterUs: number | null
	qualityLossRatioPpm: number | null
	qualityMetricAgeSec: number | null
	qualityMetricValid: number | null
	qualityPeerCount: number | null
	// ── 归属与采集（`sim` / `jobs` / `anchor_job`）────────────────────────
	simSessionId: string
	simScenarioName: string
	jobs: string[]
	anchorJob: string
	/** 置位的质量标记键（`quality` 里值为 `true` 的键，原样不翻译） */
	qualityKeys: string[]
}

/** 链路单侧端点的展示视图（右栏「端点对比」Tab 用；原样透出 `identity.{source,target}`） */
export interface MetricLinkEndpointView {
	deviceCode: string
	deviceRole: string
	interfaceId: string
	interfaceName: string
	ifIndex: number | null
	/** `ifAlias`（实测全 null）、`ifMtu`、`ifPhysAddress`、`ifType`：原样，缺即空串 / `null` */
	ifAlias: string
	ifMtu: number | null
	ifPhysAddress: string
	ifType: number | null
	/** `ifSpeedBps`：上游是 bps，展示层按量级格式化（与 `capacityMbps` 不是同一字段） */
	ifSpeedBps: number | null
	medium: string
	adminStatus: number | null
	operStatus: number | null
	capacityMbps: number | null
	rssiDbm: number | null
	txRateMbps: number | null
}

/**
 * 链路台账的一行（左栏渲染 + 右栏详情共用；当前值来自 `/metric/link` 的 `metrics`）。
 *
 * 字段按 **2026-11-08 实测 47 条**登记：`in_errors` / `in_discards` / `in_ucast_pkts` /
 * `out_qlen` / `probe_peer` / `rtt_mdev_us` / `*_age_sec` 都是真实字段，不能当成「2.0 没有端点」。
 */
export interface MetricLinkRow {
	/** `identity.link_id`（`?id` 用） */
	id: string
	/** 两端展示名：`interface_name` 兜 `interface_id` 兜 `device_code` */
	sourceLabel: string
	targetLabel: string
	/** 两端 `device_code`（source 端用于反查 `mgmt_ip`） */
	sourceCode: string
	targetCode: string
	/**
	 * 两端 `if_index`（`NMCPS-CONTRACT-002` §6.9 的接口维度）：链路折线按 source 端这个索引过滤，
	 * `null` = 上游没给 ⇒ 页面只出当前值、不出折线（不猜索引）。
	 */
	sourceIfIndex: number | null
	targetIfIndex: number | null
	/** 两端端点明细（`identity.endpoints` 原样；字段缺失即空串 / `null`） */
	source: MetricLinkEndpointView
	target: MetricLinkEndpointView
	/** 发现方式（`identity.discovery`）与 SSID（无线链路才有） */
	discovery: string
	ssid: string
	medium: string
	status: string
	graphStatus: string
	/** 图谱介质键（实测 `eth100m`）：与 `medium` 不是一个词表 */
	graphMedium: string
	usagePercent: number | null
	latencyMs: number | null
	jitterMs: number | null
	packetLossPercent: number | null
	errorRatePercent: number | null
	rxPowerDbm: number | null
	trafficInMbps: number | null
	trafficOutMbps: number | null
	bandwidthMbps: number | null
	// ── 报文与错误计数（实测逐条都在；不可判定才是 null）─────────────────
	inErrors: number | null
	outErrors: number | null
	inDiscards: number | null
	outDiscards: number | null
	inUcastPkts: number | null
	outUcastPkts: number | null
	inNucastPkts: number | null
	outNucastPkts: number | null
	inUnknownProtos: number | null
	outQlen: number | null
	// ── 探针侧与新鲜度（实测有值；`redundancyState` / `realIfIndex` 实测恒 null）
	probePeer: string
	probeDir: number | null
	rttMdevUs: number | null
	latencyAgeSec: number | null
	jitterAgeSec: number | null
	lossAgeSec: number | null
	rateAgeSec: number | null
	metricValid: number | null
	realIfIndex: number | null
	redundancyState: string
	/** 参与的采集作业（`jobs[]`，原样） */
	jobs: string[]
	/** 置位的质量标记键（`quality` 里值为 `true` 的键，原样不翻译） */
	qualityKeys: string[]
}

/** 只采信有限数字：`null` / 缺字段 / `NaN` 一律落 `null`（不补 0） */
function finiteOrNull(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function textOf(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

/** 字符串数组原样：非数组 / 空项丢弃（不补占位） */
function textList(value: unknown): string[] {
	if (!Array.isArray(value))
		return [];

	return value.map((item) => textOf(item)).filter((item) => item.length > 0);
}

/**
 * 协议计数器成表：`fields` 是展示顺序（上游 schema 原样键名），逐项取有限数字，缺即 `null`。
 * 顺序写死在代码里 —— 上游键顺序不稳定，表格列顺序不该随 JSON 抖动。
 */
function counterRows(fields: string[], source: object | null | undefined): MetricCounterView[] {
	const record = (source ?? {}) as Record<string, unknown>;
	return fields.map((field) => ({ field, value: finiteOrNull(record[field]) }));
}

const IP_FIELDS = [
	"in_receives",
	"in_hdr_errors",
	"in_addr_errors",
	"forw_datagrams",
	"in_unknown_protos",
	"in_discards",
	"in_delivers",
	"out_requests",
	"out_discards",
	"out_no_routes",
	"routing_discards"
];

const ICMP_FIELDS = [
	"in_msgs",
	"in_errors",
	"in_dest_unreachs",
	"in_time_excds",
	"out_msgs",
	"out_errors",
	"out_dest_unreachs",
	"out_time_excds"
];

const TCP_FIELDS = [
	"active_opens",
	"passive_opens",
	"attempt_fails",
	"estab_resets",
	"curr_estab",
	"in_segs",
	"out_segs",
	"retrans_segs",
	"in_errs",
	"out_rsts"
];

const UDP_FIELDS = ["in_datagrams", "no_ports", "in_errors", "out_datagrams"];

/** 射频事实（展示用）；整块缺失 ⇒ `null`（非无线设备），不是「取不到」 */
function radioViewOf(radio: MetricDeviceFact["radio"]): MetricRadioView | null {
	if (!radio)
		return null;

	const associations = Array.isArray(radio.associations)
		? radio.associations.map((item) => ({
			index: textOf(item?.index),
			staName: textOf(item?.sta_name),
			staMac: textOf(item?.sta_mac),
			rssiDbm: finiteOrNull(item?.rssi_dbm),
			txRateMbps: finiteOrNull(item?.tx_rate_mbps),
			status: textOf(item?.status)
		}))
		: [];

	/** MLO 多链路：实测只有终端报（9 台共 15 条）；空数组 = 这台设备没有从链路（真实回答） */
	const multilinks = Array.isArray(radio.multilinks)
		? radio.multilinks.map((item) => ({
			index: textOf(item?.index),
			band: finiteOrNull(item?.band),
			channel: finiteOrNull(item?.channel),
			bssid: textOf(item?.bssid),
			rssiDbm: finiteOrNull(item?.rssi_dbm),
			txRateMbps: finiteOrNull(item?.tx_rate_mbps),
			status: textOf(item?.status)
		}))
		: [];

	const rates = Array.isArray(radio.operational_rates_mbps)
		? radio.operational_rates_mbps.filter((rate): rate is number => typeof rate === "number" && Number.isFinite(rate))
		: [];

	return {
		role: finiteOrNull(radio.role),
		ssid: textOf(radio.ssid),
		channel: finiteOrNull(radio.channel),
		band: finiteOrNull(radio.band),
		mode: finiteOrNull(radio.mode),
		bssType: finiteOrNull(radio.bss_type),
		powerMgmtMode: finiteOrNull(radio.power_mgmt_mode),
		frequencyMhz: finiteOrNull(radio.frequency_mhz),
		bandwidthMhz: finiteOrNull(radio.bandwidth_mhz),
		txPowerDbm: finiteOrNull(radio.tx_power_dbm),
		noiseDbm: finiteOrNull(radio.noise_dbm),
		interferenceLevel: finiteOrNull(radio.interference_level),
		assocCount: finiteOrNull(radio.assoc_count),
		supportedRatesTxMbps: finiteOrNull(radio.supported_rates_tx_mbps),
		supportedRatesRxMbps: finiteOrNull(radio.supported_rates_rx_mbps),
		operationalRates: rates,
		associations,
		multilinks,
		peerApName: textOf(radio.peer_ap_name),
		peerApMac: textOf(radio.peer_ap_mac)
	};
}

/** 硬件实体清单（`hw.entities[]`）：非数组 ⇒ 空；逐项原样，缺字段留空串 / `null` */
function hwEntityViewsOf(entities: unknown): MetricHwEntityView[] {
	if (!Array.isArray(entities))
		return [];

	return entities.map((item) => {
		const entity = (item ?? {}) as Record<string, unknown>;
		return {
			index: textOf(entity.index),
			boardName: textOf(entity.board_name),
			modelName: textOf(entity.model_name),
			adminStatus: finiteOrNull(entity.admin_status),
			operStatus: finiteOrNull(entity.oper_status)
		};
	});
}

/**
 * 设备事实 → 左栏行；`device_code` 缺失的条目直接丢弃（§九 ①）。
 * 同名条目按 `device_code` 去重（上游分页重叠时后者覆盖前者）。
 */
export function normalizeMetricDevices(facts: MetricDeviceFact[] | null | undefined): MetricDeviceRow[] {
	const rows = new Map<string, MetricDeviceRow>();

	for (const fact of facts ?? []) {
		const id = textOf(fact.device_code);
		if (!id)
			continue;

		const summary = fact.interface_summary;
		const traffic = fact.traffic;
		const hw = fact.hw;
		const neighborSummary = fact.neighbor_summary;
		const protocol = fact.protocol;
		const lldp = fact.lldp;
		const deviceQuality = fact.device_quality;
		const sim = fact.sim;
		const neighborNames = textList(fact.neighbors);

		rows.set(id, {
			id,
			name: textOf(fact.sys_name) || id,
			mgmtIp: textOf(fact.mgmt_ip),
			role: textOf(fact.role),
			vendor: textOf(fact.vendor),
			model: textOf(fact.model),
			status: textOf(fact.status),
			uptimeSec: finiteOrNull(fact.uptime_sec),
			cpu: finiteOrNull(fact.health?.cpu_percent),
			mem: finiteOrNull(fact.health?.mem_percent),
			temperatureC: finiteOrNull(fact.health?.temperature_c),
			portsUp: finiteOrNull(summary?.up),
			portsDown: finiteOrNull(summary?.down),
			portsTotal: finiteOrNull(summary?.total),
			portsUnknown: finiteOrNull(summary?.unknown),
			portsWired: finiteOrNull(summary?.wired),
			portsWireless: finiteOrNull(summary?.wireless),
			trafficInBps: finiteOrNull(traffic?.in_bps),
			trafficOutBps: finiteOrNull(traffic?.out_bps),
			trafficTotalBps: finiteOrNull(traffic?.total_bps),
			trafficInOctetsTotal: finiteOrNull(traffic?.in_octets_total),
			trafficOutOctetsTotal: finiteOrNull(traffic?.out_octets_total),
			sysDescr: textOf(fact.sys_descr),
			sysObjectId: textOf(fact.sys_object_id),
			sysContact: textOf(fact.sys_contact),
			sysLocation: textOf(fact.sys_location),
			sysServices: finiteOrNull(fact.sys_services),
			hwEntityCount: Array.isArray(hw?.entities) ? hw.entities.length : null,
			hwVlanCount: finiteOrNull(hw?.vlan_count),
			hwRouteCount: finiteOrNull(hw?.route_count),
			hwFdbCount: finiteOrNull(hw?.fdb_count),
			hwMstpStatus: textOf(hw?.mstp_status),
			neighbors: neighborNames,
			neighborTotal: finiteOrNull(neighborSummary?.total) ?? (Array.isArray(fact.neighbors) ? neighborNames.length : null),
			neighborRouter: finiteOrNull(neighborSummary?.router),
			neighborL3Switch: finiteOrNull(neighborSummary?.l3_switch),
			neighborL2Switch: finiteOrNull(neighborSummary?.l2_switch),
			neighborAp: finiteOrNull(neighborSummary?.ap),
			neighborSta: finiteOrNull(neighborSummary?.sta),
			protocolIp: counterRows(IP_FIELDS, protocol?.ip),
			protocolIcmp: counterRows(ICMP_FIELDS, protocol?.icmp),
			protocolTcp: counterRows(TCP_FIELDS, protocol?.tcp),
			protocolUdp: counterRows(UDP_FIELDS, protocol?.udp),
			lldpPresent: !!lldp,
			lldpChassisId: textOf(lldp?.chassis_id),
			lldpSysDesc: textOf(lldp?.sys_desc),
			lldpManAddr: textOf(lldp?.man_addr),
			hwEntities: hwEntityViewsOf(hw?.entities),
			lldpPorts: Array.isArray(lldp?.ports)
				? lldp.ports.map((port) => ({
					portNum: textOf(port?.port_num),
					portId: textOf(port?.port_id),
					portDesc: textOf(port?.port_desc)
				}))
				: [],
			lldpNeighbors: Array.isArray(lldp?.neighbors)
				? lldp.neighbors.map((neighbor) => ({
					sysName: textOf(neighbor?.sys_name),
					chassisId: textOf(neighbor?.chassis_id),
					localPortNum: textOf(neighbor?.local_port_num),
					portId: textOf(neighbor?.port_id),
					portDesc: textOf(neighbor?.port_desc),
					manAddr: textOf(neighbor?.man_addr),
					sysDesc: textOf(neighbor?.sys_desc)
				}))
				: [],
			radio: radioViewOf(fact.radio),
			qualityLatencyUs: finiteOrNull(deviceQuality?.device_latency_us),
			qualityJitterUs: finiteOrNull(deviceQuality?.device_jitter_us),
			qualityLossRatioPpm: finiteOrNull(deviceQuality?.device_loss_ratio_ppm),
			qualityMetricAgeSec: finiteOrNull(deviceQuality?.metric_age_sec),
			qualityMetricValid: finiteOrNull(deviceQuality?.metric_valid),
			qualityPeerCount: finiteOrNull(deviceQuality?.peer_count),
			simSessionId: textOf(sim?.session_id),
			simScenarioName: textOf(sim?.scenario_name),
			jobs: textList(fact.jobs),
			anchorJob: textOf(fact.anchor_job),
			qualityKeys: qualityKeysOf(fact.quality)
		});
	}

	return [...rows.values()];
}

/** 单侧端点 → 展示视图（缺字段留空串 / `null`，不回填任何猜测值） */
function endpointView(endpoint: MetricLinkEndpoint | undefined): MetricLinkEndpointView {
	return {
		deviceCode: textOf(endpoint?.device_code),
		deviceRole: textOf(endpoint?.device_role),
		interfaceId: textOf(endpoint?.interface_id),
		interfaceName: textOf(endpoint?.interface_name),
		ifIndex: finiteOrNull(endpoint?.if_index),
		ifAlias: textOf(endpoint?.if_alias),
		ifMtu: finiteOrNull(endpoint?.if_mtu),
		ifPhysAddress: textOf(endpoint?.if_phys_address),
		ifType: finiteOrNull(endpoint?.if_type),
		ifSpeedBps: finiteOrNull(endpoint?.if_speed_bps),
		medium: textOf(endpoint?.medium),
		adminStatus: finiteOrNull(endpoint?.admin_status),
		operStatus: finiteOrNull(endpoint?.oper_status),
		capacityMbps: finiteOrNull(endpoint?.capacity_mbps),
		rssiDbm: finiteOrNull(endpoint?.rssi_dbm),
		txRateMbps: finiteOrNull(endpoint?.tx_rate_mbps)
	};
}

/** 置位的质量标记键（值恒 `true` 才算置位；契约只声明「只读」，取值语义不在这里猜） */
function qualityKeysOf(quality: Record<string, boolean> | null | undefined): string[] {
	if (!quality)
		return [];

	return Object.keys(quality).filter((key) => quality[key] === true);
}

/** 链路端点展示名：端口名优先，退到 `interface_id`，最后用设备编码（都不是就空串） */
function endpointLabel(endpoint: MetricLinkEndpoint | undefined): string {
	if (!endpoint)
		return "";

	return textOf(endpoint.interface_name) || textOf(endpoint.interface_id) || textOf(endpoint.device_code);
}

/** 链路事实 → 左栏行；`identity.link_id` 缺失的条目丢弃（§九 ①） */
export function normalizeMetricLinks(facts: MetricLinkFact[] | null | undefined): MetricLinkRow[] {
	const rows = new Map<string, MetricLinkRow>();

	for (const fact of facts ?? []) {
		const id = textOf(fact.identity?.link_id);
		if (!id)
			continue;

		const metrics = fact.metrics;

		rows.set(id, {
			id,
			sourceLabel: endpointLabel(fact.identity?.source),
			targetLabel: endpointLabel(fact.identity?.target),
			sourceCode: textOf(fact.identity?.source?.device_code),
			targetCode: textOf(fact.identity?.target?.device_code),
			sourceIfIndex: finiteOrNull(fact.identity?.source?.if_index),
			targetIfIndex: finiteOrNull(fact.identity?.target?.if_index),
			source: endpointView(fact.identity?.source),
			target: endpointView(fact.identity?.target),
			discovery: textOf(fact.identity?.discovery),
			ssid: textOf(fact.identity?.ssid),
			medium: textOf(metrics?.medium),
			status: textOf(metrics?.status),
			graphStatus: textOf(metrics?.graph_status),
			graphMedium: textOf(metrics?.graph_medium),
			usagePercent: finiteOrNull(metrics?.bandwidth_usage_percent),
			latencyMs: finiteOrNull(metrics?.latency_ms),
			jitterMs: finiteOrNull(metrics?.jitter_ms),
			packetLossPercent: finiteOrNull(metrics?.packet_loss_percent),
			errorRatePercent: finiteOrNull(metrics?.error_rate_percent),
			rxPowerDbm: finiteOrNull(metrics?.rx_power_dbm),
			trafficInMbps: finiteOrNull(metrics?.traffic_in_mbps),
			trafficOutMbps: finiteOrNull(metrics?.traffic_out_mbps),
			bandwidthMbps: finiteOrNull(metrics?.bandwidth_mbps),
			inErrors: finiteOrNull(metrics?.in_errors),
			outErrors: finiteOrNull(metrics?.out_errors),
			inDiscards: finiteOrNull(metrics?.in_discards),
			outDiscards: finiteOrNull(metrics?.out_discards),
			inUcastPkts: finiteOrNull(metrics?.in_ucast_pkts),
			outUcastPkts: finiteOrNull(metrics?.out_ucast_pkts),
			inNucastPkts: finiteOrNull(metrics?.in_nucast_pkts),
			outNucastPkts: finiteOrNull(metrics?.out_nucast_pkts),
			inUnknownProtos: finiteOrNull(metrics?.in_unknown_protos),
			outQlen: finiteOrNull(metrics?.out_qlen),
			probePeer: textOf(metrics?.probe_peer),
			probeDir: finiteOrNull(metrics?.probe_dir),
			rttMdevUs: finiteOrNull(metrics?.rtt_mdev_us),
			latencyAgeSec: finiteOrNull(metrics?.latency_age_sec),
			jitterAgeSec: finiteOrNull(metrics?.jitter_age_sec),
			lossAgeSec: finiteOrNull(metrics?.loss_age_sec),
			rateAgeSec: finiteOrNull(metrics?.rate_age_sec),
			metricValid: finiteOrNull(metrics?.metric_valid),
			realIfIndex: finiteOrNull(metrics?.real_if_index),
			redundancyState: textOf(metrics?.redundancy_state),
			jobs: textList(fact.jobs),
			qualityKeys: qualityKeysOf(fact.quality)
		});
	}

	return [...rows.values()];
}

/**
 * `device_code → mgmt_ip` 映射：链路页拿 source 端 `device_code` 换 `/metric/name` 的入参。
 * 没有 IP 的设备不进表 —— 落一个空串进去，只会让调用方以为「查到了但取不到」。
 */
export function deviceIpIndex(facts: MetricDeviceFact[] | null | undefined): Map<string, string> {
	const index = new Map<string, string>();

	for (const fact of facts ?? []) {
		const code = textOf(fact.device_code);
		const ip = textOf(fact.mgmt_ip);
		if (code && ip)
			index.set(code, ip);
	}

	return index;
}

/**
 * `device_code → 设备展示名`（`sys_name` 兜 `device_code`）。
 *
 * 链路台账（`/metric/link`）两端只给 `device_code` + `interface_name`，人看得懂的名字要回
 * `/metric/device` 反查一次 —— 链路页本来就要取这份台账建 IP 索引，这里只是把同一个 `code`
 * 的另一个字段（`sys_name`）也收进来。查不到就退回 `device_code`：名字缺失时宁可显示标识，
 * 也不编一个人读的名字（`NMCPS-DESIGN-001` §6.6）。
 */
export function deviceNameIndex(facts: MetricDeviceFact[] | null | undefined): Map<string, string> {
	const index = new Map<string, string>();

	for (const fact of facts ?? []) {
		const code = textOf(fact.device_code);
		if (code)
			index.set(code, textOf(fact.sys_name) || code);
	}

	return index;
}
