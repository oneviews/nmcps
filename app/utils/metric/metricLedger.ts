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

/** 设备台账的一行（左栏渲染用） */
export interface MetricDeviceRow {
	/** `device_code`（`?id` 用） */
	id: string
	/** 展示名：`sys_name` 兜 `device_code` */
	name: string
	/** 管理 IP；空串 = 上游没给，页面据此说明「取不到时序」而不是发一个空 `mgmt_ip` 请求 */
	mgmtIp: string
	role: string
	vendor: string
	status: string
	cpu: number | null
	mem: number | null
	/** 端口汇总：`up` / `total`，缺一个就是 `null`（不拼 0/0） */
	portsUp: number | null
	portsTotal: number | null
}

/** 链路台账的一行（左栏渲染用；当前值来自 `/metric/link` 的 `metrics`） */
export interface MetricLinkRow {
	/** `identity.link_id`（`?id` 用） */
	id: string
	/** 两端展示名：`interface_name` 兜 `interface_id` 兜 `device_code` */
	sourceLabel: string
	targetLabel: string
	/** 两端 `device_code`（source 端用于反查 `mgmt_ip`） */
	sourceCode: string
	targetCode: string
	medium: string
	status: string
	usagePercent: number | null
	latencyMs: number | null
	packetLossPercent: number | null
	bandwidthMbps: number | null
}

/** 只采信有限数字：`null` / 缺字段 / `NaN` 一律落 `null`（不补 0） */
function finiteOrNull(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function textOf(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
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

		rows.set(id, {
			id,
			name: textOf(fact.sys_name) || id,
			mgmtIp: textOf(fact.mgmt_ip),
			role: textOf(fact.role),
			vendor: textOf(fact.vendor),
			status: textOf(fact.status),
			cpu: finiteOrNull(fact.health?.cpu_percent),
			mem: finiteOrNull(fact.health?.mem_percent),
			portsUp: finiteOrNull(summary?.up),
			portsTotal: finiteOrNull(summary?.total)
		});
	}

	return [...rows.values()];
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
			medium: textOf(metrics?.medium),
			status: textOf(metrics?.status),
			usagePercent: finiteOrNull(metrics?.bandwidth_usage_percent),
			latencyMs: finiteOrNull(metrics?.latency_ms),
			packetLossPercent: finiteOrNull(metrics?.packet_loss_percent),
			bandwidthMbps: finiteOrNull(metrics?.bandwidth_mbps)
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
