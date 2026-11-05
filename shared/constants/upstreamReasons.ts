// shared/constants/upstreamReasons.ts
// 上游不可用状态的**唯一词汇表**：`GET /ready` 的 `upstream.reason` 与 BFF 在 API 层回给
// 前端的 `bff_upstream_*` message 都在这里定义，server 与前端只引用常量，杜绝字符串漂移。
//
// 设计基准：NMCPS-ADR-0010（layers/content/collections/cn/records/adr/adr-0010.md）、
// NMCPS-ARCH-003 §7.7（layers/content/collections/cn/architecture/1.architecture/iam-architecture.md）。
//
// 约束：纯数据（无 IO / 无 Nuxt 别名），Nuxt 侧与 TypeScript 脚本共用。
// 说明：`scripts/check-bff.mjs` / `scripts/check-ui.mjs` 是纯 node ESM，不 import 本文件，
// 而是按**线上字符串**断言 —— 取值一旦改动，契约用例立刻变红，这本身就是防漂移的守卫。

/** `/ready` 的 `upstream.reason`（无原因即 ready） */
export const UPSTREAM_REASONS = {
	missing: "upstream_missing",
	unreachable: "upstream_unreachable",
	timeout: "upstream_timeout",
	unhealthy: "upstream_unhealthy"
} as const;

export type UpstreamReason = (typeof UPSTREAM_REASONS)[keyof typeof UPSTREAM_REASONS];

/** BFF 出站失败时回给前端的 `message`（前端据此给可执行提示） */
export const BFF_UPSTREAM_MESSAGES = {
	/** 运维未配置 `NUXT_BFF_UPSTREAM_BASE` */
	missing: "bff_upstream_missing",
	/** 上游不可达（DNS / 连接被拒 / 掉线） */
	unreachable: "bff_upstream_unreachable",
	/** 上游在超时窗口内没有响应 */
	timeout: "bff_upstream_timeout",
	/** 配置的上游基址不合法（拼接失败） */
	baseInvalid: "bff_upstream_base_invalid"
} as const;

export type BffUpstreamMessage = (typeof BFF_UPSTREAM_MESSAGES)[keyof typeof BFF_UPSTREAM_MESSAGES];

/**
 * 仿真平台（第二上游）的失败词汇表：与主上游分开命名，前端不必靠状态码猜是哪条腿断了。
 *
 * 依据 NMCPS-ARCH-002 §6.5（layers/content/collections/cn/architecture/1.architecture/datasource-architecture.md）：
 * 未配 `baseUrl` 与「未配主上游」同口径（503），但 message 不同 —— 通道未启用不是错误。
 */
export const SIMULATOR_MESSAGES = {
	/** 运维未配置 `NUXT_SIMULATOR_BASE_URL`（通道未启用，页面退化为只读静态拓扑） */
	notConfigured: "simulator_not_configured",
	/** 仿真平台不可达（DNS / 连接被拒 / 掉线） */
	unreachable: "simulator_unreachable",
	/** 仿真平台在超时窗口内没有响应 */
	timeout: "simulator_timeout",
	/** `allowWrite: false` 时的写端点（直接 405，不触达上游） */
	writeDisabled: "simulator_write_disabled",
	/** 配置的基址不合法（拼接失败） */
	baseInvalid: "simulator_base_invalid"
} as const;

export type SimulatorMessage = (typeof SIMULATOR_MESSAGES)[keyof typeof SIMULATOR_MESSAGES];
