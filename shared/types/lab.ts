// shared/types/lab.ts
// 仿真网络资源台账（BFF 自产契约，NMCPS-ADR-0021 P2）。
//
// 外部只认 BFF 生成的 `id`；`upstream_id` 是引擎内部标识，**不参与鉴权**。
// 台账只记录网络边界与（可选的）资源清单，不复制 Mininet / 仿真平台实体：
// 节点、链路事实仍以各自上游为准，台账负责回答「这个租户有没有这张网、这些 ID 属不属于它」。

/** 运行引擎：Mininet 实验床 / 仿真平台 */
export type LabEngine = "mininet" | "simulator";

/** 网络生命周期（P2 只读阶段只会出现 running / stopped） */
export type LabNetworkState = "creating" | "running" | "stopped" | "error";

/**
 * 资源清单（可缺省）。
 *
 * 缺省表示「以租户实例为边界」：Mininet 后端一台机器只跑一张网，租户实例本身即隔离单位。
 * 一旦显式给出，列表出口会丢弃清单外的节点/链路，路径参数也会先过这张清单再出站。
 */
export interface LabNetworkResources {
	nodes?: string[]
	/** 链路键：`src--dst`（无向，比较时按字典序归一） */
	links?: string[]
}

/** 台账记录（server-only；API 出参用 `LabNetworkSummary`） */
export interface LabNetworkRecord {
	/** BFF 生成的稳定 ID，外部路由只接受它 */
	id: string
	tenant_id: string
	engine: LabEngine
	/** 引擎内部 ID / 实例键（Mininet 后端没有网络 ID，用实例键；仿真平台用 sim id） */
	upstream_id: string
	state: LabNetworkState
	created_by: string
	created_at: string
	updated_at: string
	resources?: LabNetworkResources
}

/** `GET /api/lab/networks` 的出参：不含 upstream_id / 资源明细 */
export interface LabNetworkSummary {
	id: string
	engine: LabEngine
	state: LabNetworkState
	created_by: string
	created_at: string
	updated_at: string
	node_count: number | null
	link_count: number | null
}

/**
 * `POST /api/lab/networks/{id}/sync` 的出参（NMCPS-ADR-0023）。
 *
 * 对账把台账清单整体重写成上游事实；`adopted` / `dropped` 是两个差集，
 * 让页面能说清“这次多接管了什么、清掉了什么”，而不是只回 `{ ok: true }`。
 * `links` 与台账同口径：无向归一的 `a--b`。
 */
export interface LabNetworkSyncResult {
	network: LabNetworkSummary
	nodes: string[]
	links: string[]
	adopted: {
		nodes: string[]
		links: string[]
	}
	dropped: {
		nodes: string[]
		links: string[]
	}
}
