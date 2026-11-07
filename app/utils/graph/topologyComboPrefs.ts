// app/utils/graph/topologyComboPrefs.ts
// 区域分组折叠的**本地持久化**（纯函数 + 注入存储，零全局状态）。
//
// 设计基准：NMCPS-DESIGN-001 §6.11（折叠只改视图输入）；「刷新页面后折叠状态还在」是 1.0 的既有
// 行为，2.0 不能在重载后把用户的视图改动悄悄丢掉。
//
// 三条约束：
//   ① 存储只在浏览器侧可读：调用方先判断 `import.meta.client`，本文件不探测 `window`（便于 node 侧单测）；
//   ② 读失败一律当作「没有折叠任何分组」：`localStorage` 被禁用 / 内容被别的手改坏时，页面照常出图，
//      最多是折叠状态丢失，绝不让它升级成页面错误；
//   ③ 写失败静默：隐私模式下 `setItem` 会抛 `QuotaExceededError`，那只是「记不住」，不是功能坏了。
import type { TopologyCombo } from "~~/shared/types/topology";

/** 存储键（带域前缀，避免与其它页面的 localStorage 撞名） */
export const COLLAPSED_COMBOS_STORAGE_KEY = "nmcps:topology:collapsed-combos";

/** 存储读写的最小接口（`localStorage` 满足它；测试里塞一个假对象即可） */
export interface ComboStorage {
	getItem: (key: string) => string | null
	setItem: (key: string, value: string) => void
}

/**
 * 解析存量值：JSON 字符串数组，逐项要求非空字符串；去重保序，其余一律丢弃。
 * 任何解析异常都回落成空数组（口径 ②）。
 */
export function parseCollapsedCombos(raw: string | null | undefined): string[] {
	if (!raw)
		return [];

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return [];
	}

	if (!Array.isArray(parsed))
		return [];

	const seen = new Set<string>();
	for (const item of parsed) {
		if (typeof item !== "string")
			continue;
		const id = item.trim();
		if (id)
			seen.add(id);
	}

	return [...seen];
}

/** 读折叠集合：存储不可用 / 内容损坏都返回空数组 */
export function readCollapsedCombos(storage: ComboStorage | null | undefined): string[] {
	if (!storage)
		return [];
	try {
		return parseCollapsedCombos(storage.getItem(COLLAPSED_COMBOS_STORAGE_KEY));
	} catch {
		return [];
	}
}

/** 写折叠集合：写失败静默（口径 ③） */
export function writeCollapsedCombos(storage: ComboStorage | null | undefined, ids: readonly string[]): void {
	if (!storage)
		return;
	try {
		storage.setItem(COLLAPSED_COMBOS_STORAGE_KEY, JSON.stringify([...ids]));
	} catch {
		// 「记不住」不是功能故障：不需要提示，也不需要降级
	}
}

/**
 * 修剪：只保留**当前仍存在**的 combo id。
 *
 * 上游删掉一个分组后，存量里的这个 id 再也不会命中任何节点：留着它会让「已收起 N 台」的角标
 * 与真实的折叠集合对不上（角标数节点，存量数 id）。下一轮图到了顺手清掉。
 */
export function pruneCollapsedCombos(ids: readonly string[], combos: readonly TopologyCombo[] | null | undefined): string[] {
	if (ids.length === 0)
		return [];
	const known = new Set((combos ?? []).map((combo) => combo.id));
	return ids.filter((id) => known.has(id));
}
