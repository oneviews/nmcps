// layers/scenario/shared/types/mininet.ts
// Mininet 实验通道（BFF `/api/mininet/**`）的能力位。
//
// 设计基准：NMCPS-ADR-0020（layers/content/collections/cn/records/adr/adr-0020.md）。
// 这里只描述 BFF 自产的能力信息，不复制 Mininet 实体；实体类型随
// `packages/mininet-client` 落地（阶段 B）。

/**
 * `GET /api/mininet/channel`：通道能力位（不是上游资源的透传）。
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
	/**
	 * 台账里已绑定的 2.0 会话 id（`NMCPS-ADR-0029` M1.2）；`null` = 还没有会话。
	 *
	 * 页面拿它拼 `/api/mininet/sessions/{id}/nodes|links`。只由 `POST /api/mininet/sessions`
	 * 落库（BFF 写回台账 `session_id`），1.x 入口不产生会话 —— 所以 `null` 只说明「这一层
	 * 还没建」，不代表网络不可见：上游的会话只是给现有全局 `app.net` 起个名字。
	 */
	sessionId: string | null
}

/** 能力位分组：字段名是动作语义，值来自 `labPermissionsOf()` 的计算结果 */
export interface MininetChannelCapabilities {
	read: boolean
	create: boolean
	operate: boolean
	delete: boolean
	terminal: boolean
	sniffer: boolean
	/** SNMP 凭据写面（`NMCPS-ADR-0028` §6 D10）：开通 / 轮换 / 吊销，独立授权 */
	snmp: boolean
}

/**
 * `GET /api/mininet/version`：与实验后端的握手结果（M0 远程化）。
 *
 * 为什么不塞进 `/api/mininet/channel`：capability 探针刻意**不触达上游**（NMCPS-ADR-0020），
 * 握手要发一次 `GET /api/version`。两件事分开，探针在没有上游时仍然能回能力位。
 */
export interface MininetVersionInfo {
	/** 上游确实回了 `GET /api/version` */
	reachable: boolean
	/** 后端版本（`services/mininet-api` 的 `__version__`） */
	version: string | null
	/** 宿主 Mininet 版本（不可用时为 null） */
	mininetVersion: string | null
	/** 上游契约标记；旧后端没有这个字段时为 null */
	apiContract: string | null
	/** 主版本与 `LAB_API_CONTRACT` 一致 */
	compatible: boolean
	/** BFF 期望的契约（`LAB_API_CONTRACT`），排查时不必翻文档 */
	expectedContract: string
	/** 出站是否带入口凭据（token 由服务端配置，值不回传） */
	tokenConfigured: boolean
}
