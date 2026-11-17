// layers/scenario/server/utils/bff/labReconcile.ts
// 台账资源清单 ← 上游事实的对账读取（NMCPS-ADR-0023）。
//
// 清单只在**经 BFF 的写**之后收敛（`recordLabResourceChange()`），旧前端退役前
// 仍可直连上游、运维脚本也能直接调 Mininet，这类写在台账里不留痕迹：上游多出来的
// 节点被出口过滤隐藏，上游已删掉的 id 变成永远查不到的幽灵。
//
// 这里只负责「读上游现在有什么」：不写台账、不鉴权、不审计（调用方负责），
// 也不经过 `filterLabPayload()` —— 要重写的正是那份旧清单，用旧清单过滤只会把漂移吞掉。
// 任一类读取失败即整体失败：把「读不到」当成「没有」会写出空清单。

import type { H3Event } from "h3";
import type { LabNetworkResources } from "~~/shared/types/lab";
import type { MininetConfig } from "./mininetConfig";
import { normalizedLabLinkKey } from "./labLedger";
import { fetchMininetJson } from "./mininet";

/**
 * 节点类上游端点（真实出站路径，与 `MININET_ROUTES[].upstream` 同口径）：
 * `{ id: {...} }` 或 `[{ id | name }]` 两种形状都要认。
 */
const NODE_COLLECTIONS = [
	"/api/mininet/hosts",
	"/api/mininet/switches",
	"/api/mininet/routers",
	"/api/mininet/nats",
	"/api/mininet/controllers"
] as const;

/** 链路集合（`fetchMininetJson` 收的是完整上游路径，不含 BFF 前缀转换） */
const LINKS_COLLECTION = "/api/mininet/links";

export type LabReconcileResult
	= | { ok: true, resources: LabNetworkResources }
		| { ok: false, status: number, message: string };

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: undefined;
}

function trimmedStringOf(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** 数组元素取 `id` / `name`；字典取键（上游 `app.hosts` 等都以节点名为键） */
function nodeIdsOf(payload: unknown): string[] {
	if (Array.isArray(payload)) {
		return payload
			.map((item) => {
				const record = asRecord(item);
				return record ? trimmedStringOf(record.id) ?? trimmedStringOf(record.name) : undefined;
			})
			.filter((id): id is string => !!id);
	}

	const record = asRecord(payload);
	if (!record) {
		return [];
	}

	// 少数端点会包一层 `{ nodes: [...] }`；其余一律以键为节点 id
	if (Array.isArray(record.nodes)) {
		return nodeIdsOf(record.nodes);
	}

	return Object.keys(record);
}

/**
 * 链路归一：真后端的 `/links` 已把接口侧名字反解成 `{ from, to }`，
 * 旧形状 `{ identity: { source, target } }` 也认（升级期的兼容，不额外剪枝）。
 */
function linkKeysOf(payload: unknown, target: Set<string>): string[] {
	const wrapper = asRecord(payload);
	const list: unknown[] = Array.isArray(payload)
		? payload
		: Array.isArray(wrapper?.links) ? wrapper.links as unknown[] : [];

	for (const item of list) {
		const record = asRecord(item);
		if (!record) {
			continue;
		}

		const identity = asRecord(record.identity);
		const source = trimmedStringOf(record.from) ?? trimmedStringOf(identity?.source);
		const destination = trimmedStringOf(record.to) ?? trimmedStringOf(identity?.target);

		if (source && destination && source !== destination) {
			target.add(normalizedLabLinkKey(source, destination));
		}
	}

	return [...target];
}

/**
 * 读上游此刻的节点与链路清单。
 *
 * 六次读取（五类节点 + 链路）全部成功才回 `ok`：任一次失败原样带出状态码与 message，
 * 调用方据此回上游错误且**不写台账**。全部成功但为空是合法事实，回空清单。
 */
export async function readUpstreamLabResources(
	event: H3Event,
	config: MininetConfig
): Promise<LabReconcileResult> {
	const nodes = new Set<string>();

	for (const path of NODE_COLLECTIONS) {
		const result = await fetchMininetJson(event, config, path);
		if (!result.ok) {
			return result;
		}

		for (const id of nodeIdsOf(result.data)) {
			nodes.add(id);
		}
	}

	const linksResult = await fetchMininetJson(event, config, LINKS_COLLECTION);
	if (!linksResult.ok) {
		return linksResult;
	}

	const links = linkKeysOf(linksResult.data, new Set<string>());

	return {
		ok: true,
		resources: {
			nodes: [...nodes].sort(),
			links: links.sort()
		}
	};
}

/** 已登记清单 vs 对账结果的差集，供出参与页面文案使用 */
export function diffLabResources(
	previous: LabNetworkResources | undefined,
	next: LabNetworkResources
): { adopted: { nodes: string[], links: string[] }, dropped: { nodes: string[], links: string[] } } {
	const beforeNodes = new Set(previous?.nodes ?? []);
	const beforeLinks = new Set(previous?.links ?? []);
	const afterNodes = new Set(next.nodes ?? []);
	const afterLinks = new Set(next.links ?? []);

	return {
		adopted: {
			nodes: [...afterNodes].filter((id) => !beforeNodes.has(id)).sort(),
			links: [...afterLinks].filter((key) => !beforeLinks.has(key)).sort()
		},
		dropped: {
			nodes: [...beforeNodes].filter((id) => !afterNodes.has(id)).sort(),
			links: [...beforeLinks].filter((key) => !afterLinks.has(key)).sort()
		}
	};
}
