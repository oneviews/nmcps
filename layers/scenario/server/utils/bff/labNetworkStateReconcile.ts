import type { H3Event } from "h3";
import type { LabNetworkRecord, LabNetworkState } from "~~/shared/types/lab";
import { markLabNetworkState } from "./labLedger";
import { fetchMininetJson } from "./mininet";
import { getMininetConfig } from "./mininetConfig";

/**
 * 台账运行态对账（NMCPS-ADR-0026 D4）：`GET /api/lab/networks` 出口前把 `state` 与
 * 上游 `GET /api/mininet/start` 的裸布尔对齐。
 *
 * 为什么必须在读路径上做：`markLabNetworkState()` 只在 `start` / `stop` / `full_reset`
 * **成功之后**写回，而台账初始值来自 seed、进程重启或下游被外部 `mn -c` 清空都不会触发
 * 写回。2026-11-21 复验时 `.data/lab-ledger.json` 是 `state: "running"`，同一时刻上游
 * `GET /api/mininet/start` 回 `false` —— 一张从没启动过的网在页面上显示「运行中」。
 *
 * 边界：
 * - 只纠正 `running` ↔ `stopped`。`creating` / `error` 是上游布尔表达不了的信息，不猜；
 * - 读不到（超时 / 5xx / 非布尔 / 租户没有实例）一律**保持原值**：把「未知」当成
 *   「已停止」与当成「运行中」同样是撒谎；
 * - 每个租户只读一次（一次列表请求里多条记录共用同一份上游事实）；
 * - 写回失败只记日志：列表读不该因为台账写不进去而失败。
 */
const UPSTREAM_RUN_STATE_PATH = "/api/mininet/start";

/** 上游布尔 → 台账 `state` 的纯映射（只有两个方向，其余原值返回） */
export function reconcileLabNetworkStateOf(
	current: LabNetworkState,
	upstreamStarted: boolean | undefined
): LabNetworkState {
	if (upstreamStarted === undefined) {
		return current;
	}
	if (upstreamStarted && current === "stopped") {
		return "running";
	}
	if (!upstreamStarted && current === "running") {
		return "stopped";
	}
	return current;
}

/** 读一次上游运行态；任何失败都回 `undefined`（＝保持台账原值） */
async function readUpstreamStarted(event: H3Event, tenantId: string): Promise<boolean | undefined> {
	const config = getMininetConfig(event, tenantId);
	if (!config.baseUrl) {
		return undefined;
	}

	const result = await fetchMininetJson(event, config, UPSTREAM_RUN_STATE_PATH);
	if (!result.ok || typeof result.data !== "boolean") {
		return undefined;
	}
	return result.data;
}

/**
 * 把一批台账记录与上游运行态对齐，返回对齐后的记录（顺序不变）。
 *
 * 只有真的改判的记录才会写盘（`markLabNetworkState()` 自己也会短路同值写），
 * 因此稳态下列表请求是「一次上游读 + 零写」。
 */
export async function reconcileLabNetworkStates(
	event: H3Event,
	records: LabNetworkRecord[]
): Promise<LabNetworkRecord[]> {
	if (records.length === 0) {
		return records;
	}

	const startedByTenant = new Map<string, boolean | undefined>();
	const reconciled: LabNetworkRecord[] = [];

	for (const record of records) {
		let upstreamStarted = startedByTenant.get(record.tenant_id);
		if (!startedByTenant.has(record.tenant_id)) {
			upstreamStarted = await readUpstreamStarted(event, record.tenant_id);
			startedByTenant.set(record.tenant_id, upstreamStarted);
		}

		const next = reconcileLabNetworkStateOf(record.state, upstreamStarted);
		if (next === record.state) {
			reconciled.push(record);
			continue;
		}

		try {
			reconciled.push(await markLabNetworkState(event, record.id, next) ?? { ...record, state: next });
		} catch (error) {
			console.error("[lab] state reconcile write failed", record.id, error);
			reconciled.push(record);
		}
	}

	return reconciled;
}
