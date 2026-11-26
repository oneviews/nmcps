/**
 * SNMP 采集面 / 凭据面的读模型（`NMCPS-ADR-0028` §3 与 §6）。
 *
 * 上游 `GET /api/mininet/snmp/state` 回的可读事实分成三块：采集面开关与端口、
 * 一份凭据的**元数据**（D9：永远不含密文）、每个节点的 agent 状态。这里只做
 * 形状归一 —— 页面不该自己 `payload.onboarded === true` 地猜字段，也不该把
 * 「读不到」当成「没开通」。
 *
 * 密文只从 `POST …/onboard` / `POST …/rotate` 的响应里来一次（D9），因此
 * 单独一个 `LabSnmpCredentialReveal`，不混进 `LabSnmpState` —— 混进去会诱使
 * 后续某次刷新把明文存回状态里。
 */

/** 单个节点上 agent 的读数；`status` 是三态（`running` / `stopped` / `unavailable`） */
export interface LabSnmpNodeState {
	id: string
	type: string | null
	ip: string | null
	pid: number | null
	port: number | null
	status: string
	error: string | null
}

/** `GET /api/mininet/snmp/state` 的读模型（字段名与上游下划线别名一一对应） */
export interface LabSnmpState {
	/** `LAB_SNMP_ENABLED` 是否打开：关着时三个写端点都会回 409 */
	enabled: boolean
	/** 本实例当前是否真有 agent 进程在跑 */
	running: boolean
	port: number | null
	/** 未开通时是部署默认串；开通后上游把这里置 `null`（D9） */
	community: string | null
	communitySource: string | null
	onboarded: boolean
	credentialVersion: number | null
	credentialCreatedAt: string | null
	credentialRotatedAt: string | null
	/** 凭据文件不可用时的错误码；采集仍按部署默认串继续 */
	credentialError: string | null
	startedAt: number | null
	error: string | null
	nodes: LabSnmpNodeState[]
}

/** 开通 / 轮换响应里**一次性**出现的密文与凭据元数据 */
export interface LabSnmpCredentialReveal {
	community: string
	onboarded: boolean
	credentialVersion: number | null
	createdAt: string | null
	rotatedAt: string | null
}

function recordOf(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

function textOf(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}

function numberOrNull(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nodeStateOf(value: unknown): LabSnmpNodeState | null {
	const record = recordOf(value);
	const id = textOf(record?.id);
	if (!record || !id)
		return null;

	return {
		id,
		type: textOf(record.type),
		ip: textOf(record.ip),
		pid: numberOrNull(record.pid),
		port: numberOrNull(record.port),
		status: textOf(record.status) ?? "unavailable",
		error: textOf(record.error)
	};
}

/**
 * 归一 `GET /snmp/state` 的响应体；认不出形状回 `null`（页面据此显示「未知」，
 * 而不是回落成「未开通」—— 后者会让人对着已开通的网再点一次开通）。
 */
export function labSnmpStateOf(payload: unknown): LabSnmpState | null {
	const record = recordOf(payload);
	if (!record || typeof record.enabled !== "boolean" || typeof record.onboarded !== "boolean")
		return null;

	const nodes = Array.isArray(record.nodes)
		? record.nodes.map(nodeStateOf).filter((node): node is LabSnmpNodeState => node !== null)
		: [];

	return {
		enabled: record.enabled,
		running: record.running === true,
		port: numberOrNull(record.port),
		community: textOf(record.community),
		communitySource: textOf(record.community_source),
		onboarded: record.onboarded,
		credentialVersion: numberOrNull(record.credential_version),
		credentialCreatedAt: textOf(record.credential_created_at),
		credentialRotatedAt: textOf(record.credential_rotated_at),
		credentialError: textOf(record.credential_error),
		startedAt: numberOrNull(record.started_at),
		error: textOf(record.error),
		nodes
	};
}

/**
 * 归一开通 / 轮换响应；没有可展示的密文就直接判失败 —— 弹窗的全部价值就是
 * 那一次「出示」，拿不到密文时给一个「成功」提示等于骗运维去 NMS 里填空串。
 */
export function labSnmpRevealOf(payload: unknown): LabSnmpCredentialReveal | null {
	const record = recordOf(payload);
	const community = textOf(record?.community);
	if (!record || !community)
		return null;

	return {
		community,
		onboarded: record.onboarded === true,
		credentialVersion: numberOrNull(record.credential_version),
		createdAt: textOf(record.created_at),
		rotatedAt: textOf(record.rotated_at)
	};
}
