// layers/scenario/shared/types/mininet.ts
// Mininet 实验通道（BFF `/api/lab/**`）的能力位。
//
// 设计基准：NMCPS-ADR-0020（layers/content/collections/cn/records/adr/adr-0020.md）。
// 这里只描述 BFF 自产的能力信息，不复制 Mininet 实体；实体类型随
// `packages/mininet-client` 落地（阶段 B）。

/** `GET /api/lab/channel`：通道能力位（不是上游资源的透传） */
export interface MininetChannelInfo {
	/** 会话租户在 `runtimeConfig.mininet.instances` 中有实例 ⇒ 通道已启用（`false` 不是错误） */
	configured: boolean
	/** 当前只开放查询；写操作没有入口，不是“被开关挡住” */
	readOnly: true
	/** 与 `readOnly` 同义，给沿用仿真通道字段名的页面复用 */
	writeEnabled: false
	/** 白名单登记端点数（只读） */
	endpointCount: number
	/** 单次出站超时（毫秒），页面用于解释 504 */
	timeoutMs: number
	/** 就绪探针路径（拼在 baseUrl 之后；仅供排查，不回 baseUrl） */
	readinessPath: string
}
