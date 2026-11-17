import type { LabNetworkRecord } from "~~/shared/types/lab";
import { normalizedLabLinkKey } from "./labLedger";

/**
 * 列表出口过滤（NMCPS-ADR-0021 P2）。
 *
 * 上游返回的形状不统一：Mininet 的 hosts/switches/routers 是「id → 对象」字典，
 * links 是数组，interfaces 是 `{ nodes: [] }`。这里只处理这三种已知形状，其余响应
 * （探针、单对象读数）原样放行 —— 不做递归改写，避免把业务字段误当资源列表剪掉。
 *
 * 丢弃规则按优先级：
 * 1. 显式 `tenant_id` 与当前租户不同；
 * 2. 显式 `network_id` / `sim_id` 既不是 BFF id 也不是 upstream id；
 * 3. 台账登记了资源清单，而条目的节点 / 链路不在清单内。
 */
export interface LabEgressScope {
	network: LabNetworkRecord
	/**
	 * 只核对租户 / 网络标识，不套资源清单。
	 *
	 * 写端点的响应对应的是**刚被这次请求改动的对象**：新节点按定义还不在（写前读到的）
	 * 清单里，若照常判就会把一次成功的建节点回成 404。清单在写成功之后由台账自己收敛
	 * （`recordLabResourceChange()`），读路径仍然按最新清单过滤。
	 */
	ignoreResources?: boolean
}

export interface LabEgressResult<T = unknown> {
	/** 单对象被判定为不可见时为 `undefined`（调用方必须回 404，不能把别人的对象当空值） */
	value: T | undefined
	dropped: number
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: undefined;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}

function explicitMismatch(record: Record<string, unknown>, scope: LabEgressScope): boolean {
	const tenantId = asString(record.tenant_id) ?? asString(record.tenantId);
	if (tenantId && tenantId !== scope.network.tenant_id) {
		return true;
	}

	const networkId = asString(record.network_id) ?? asString(record.networkId);
	if (networkId && networkId !== scope.network.id && networkId !== scope.network.upstream_id) {
		return true;
	}

	const simId = asString(record.sim_id) ?? asString(record.simId);
	return !!simId && simId !== scope.network.id && simId !== scope.network.upstream_id;
}

function nodeIdOf(record: Record<string, unknown>, fallback?: string): string | undefined {
	return asString(record.id) ?? asString(record.name) ?? asString(record.node_id) ?? fallback;
}

function linkEndpointsOf(record: Record<string, unknown>): [string, string] | undefined {
	const source = record.from;
	const target = record.to;
	if (typeof source === "string" && typeof target === "string") {
		return [source, target];
	}

	const identity = asRecord(record.identity);
	const identitySource = asRecord(identity?.source);
	const identityTarget = asRecord(identity?.target);
	const sourceId = asString(identitySource?.device_code) ?? asString(identitySource?.id);
	const targetId = asString(identityTarget?.device_code) ?? asString(identityTarget?.id);
	return sourceId && targetId ? [sourceId, targetId] : undefined;
}

function itemAllowed(
	record: Record<string, unknown>,
	scope: LabEgressScope,
	fallbackId?: string
): boolean {
	if (explicitMismatch(record, scope)) {
		return false;
	}

	const resources = scope.ignoreResources ? undefined : scope.network.resources;
	if (!resources) {
		return true;
	}

	const nodeIds = resources.nodes ? new Set(resources.nodes) : undefined;
	const linkKeys = resources.links
		? new Set(resources.links.map((key) => {
			const [left, right] = key.split("--");
			return left && right ? normalizedLabLinkKey(left, right) : key;
		}))
		: undefined;

	const endpoints = linkEndpointsOf(record);
	if (endpoints) {
		if (nodeIds && (!nodeIds.has(endpoints[0]) || !nodeIds.has(endpoints[1]))) {
			return false;
		}
		if (linkKeys && !linkKeys.has(normalizedLabLinkKey(endpoints[0], endpoints[1]))) {
			return false;
		}
		return true;
	}

	const nodeId = nodeIdOf(record, fallbackId);
	return !(nodeIds && nodeId && !nodeIds.has(nodeId));
}

function isNodeMap(value: Record<string, unknown>): boolean {
	const entries = Object.entries(value);
	if (!entries.length) {
		return false;
	}

	return entries.every(([, item]) => {
		const record = asRecord(item);
		return !!record && (
			typeof record.id === "string"
			|| typeof record.name === "string"
			|| typeof record.type === "string"
		);
	});
}

export function filterLabPayload<T>(payload: T, scope: LabEgressScope): LabEgressResult<T> {
	if (Array.isArray(payload)) {
		let dropped = 0;
		const value = payload.filter((item) => {
			const record = asRecord(item);
			if (!record) {
				return true;
			}
			const allowed = itemAllowed(record, scope);
			if (!allowed) {
				dropped += 1;
			}
			return allowed;
		});

		return { value: value as T, dropped };
	}

	const record = asRecord(payload);
	if (!record) {
		return { value: payload, dropped: 0 };
	}

	let dropped = 0;

	if (Array.isArray(record.nodes)) {
		const nodes = record.nodes.filter((item) => {
			const node = asRecord(item);
			if (!node || itemAllowed(node, scope)) {
				return true;
			}
			dropped += 1;
			return false;
		});

		if (dropped > 0) {
			return { value: { ...record, nodes } as T, dropped };
		}
	}

	if (isNodeMap(record)) {
		const entries = Object.entries(record).filter(([key, item]) => {
			const node = asRecord(item);
			if (!node || itemAllowed(node, scope, key)) {
				return true;
			}
			dropped += 1;
			return false;
		});

		if (dropped > 0) {
			return { value: Object.fromEntries(entries) as T, dropped };
		}
	}

	if (!itemAllowed(record, scope)) {
		return { value: undefined, dropped: dropped + 1 };
	}

	return { value: payload, dropped };
}
