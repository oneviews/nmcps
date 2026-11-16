// layers/scenario/server/utils/bff/labLocks.ts
// 实验网络写操作的进程内互斥（NMCPS-ADR-0022 D5）。
//
// `app.net` 是进程内全局拓扑：两个并发写（例如同时 pingall 与 delete_node）会互相踩，
// 前端按钮禁用不能替代服务端串行化。这里只做「同一网络同时一个写」的最小实现：
// 冲突立即回 `409 lab_operation_in_progress`，不排队、不覆盖。
//
// 边界：锁只在 BFF 单实例内有效（与 ADR-0021 D1 的每租户实例一致）；
// 部署成多副本时必须换成台账 / 外部锁，否则 409 会失真。

const inflight = new Map<string, { action: string, startedAt: number }>();

export interface LabOperationLock {
	/** 释放锁；重复调用安全 */
	release: () => void
}

export interface LabOperationConflict {
	action: string
	startedAt: number
}

/**
 * 尝试占用 `tenant:network` 的写锁。
 *
 * 返回 `{ release }` 表示成功；返回 `{ conflict }` 表示已有在途操作，
 * 调用方应回 `409 lab_operation_in_progress` 并且**不触达上游**。
 */
export function acquireLabOperation(
	tenantId: string,
	networkId: string,
	action: string
): { lock: LabOperationLock } | { conflict: LabOperationConflict } {
	const key = `${tenantId}:${networkId}`;
	const existing = inflight.get(key);

	if (existing) {
		return { conflict: existing };
	}

	const entry = { action, startedAt: Date.now() };
	inflight.set(key, entry);

	let released = false;
	return {
		lock: {
			release: () => {
				if (released) {
					return;
				}
				released = true;
				// 只删自己那一条：避免上一个操作的延迟释放清掉后来的锁
				if (inflight.get(key) === entry) {
					inflight.delete(key);
				}
			}
		}
	};
}

/** 仅供自查脚本与单测观察进程内状态 */
export function inflightLabOperations(): Record<string, LabOperationConflict> {
	return Object.fromEntries([...inflight.entries()].map(([key, value]) => [key, value]));
}
