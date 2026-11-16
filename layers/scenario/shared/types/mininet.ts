// layers/scenario/shared/types/mininet.ts
// Mininet 实验通道（BFF `/api/lab/**`）的能力位。
//
// 设计基准：NMCPS-ADR-0020（layers/content/collections/cn/records/adr/adr-0020.md）。
// 这里只描述 BFF 自产的能力信息，不复制 Mininet 实体；实体类型随
// `packages/mininet-client` 落地（阶段 B）。

/**
 * `GET /api/lab/channel`：通道能力位（不是上游资源的透传）。
 *
 * 页面按 `capabilities` 渲染：未授权的动作不出现，不依赖「先渲染再等 403」。
 */
export interface MininetChannelInfo {
	/** 会话租户在 `runtimeConfig.mininet.instances` 中有实例 ⇒ 通道已启用（`false` 不是错误） */
	configured: boolean
	/** 没有任何写能力位时为 `true`（只读会话） */
	readOnly: boolean
	/** 至少拥有一条写端点所需权限位（NMCPS-ADR-0022 D3） */
	writeEnabled: boolean
	/** 按动作分组的权限位，与 `LAB_PERMISSIONS` 一一对应 */
	capabilities: MininetChannelCapabilities
	/** 白名单登记端点数（查询 + 写） */
	endpointCount: number
	/** 单次出站超时（毫秒），页面用于解释 504 */
	timeoutMs: number
	/** 就绪探针路径（拼在 baseUrl 之后；仅供排查，不回 baseUrl） */
	readinessPath: string
}

/** 能力位分组：字段名是动作语义，值来自 `labPermissionsOf()` 的计算结果 */
export interface MininetChannelCapabilities {
	read: boolean
	create: boolean
	operate: boolean
	delete: boolean
	terminal: boolean
	sniffer: boolean
}
