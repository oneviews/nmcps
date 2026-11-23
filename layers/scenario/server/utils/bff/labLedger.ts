import type { H3Event } from "h3";
import type { LabPrincipal } from "~~/shared/constants/labPermissions";
import type {
	LabEngine,
	LabNetworkRecord,
	LabNetworkResources,
	LabNetworkState,
	LabNetworkSummary
} from "~~/shared/types/lab";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { useRuntimeConfig } from "nitropack/runtime";
import { canSeeLabNetwork } from "~~/shared/constants/labPermissions";

/**
 * BFF 仿真网络台账（NMCPS-ADR-0021 P2）。
 *
 * 存储：默认 `.data/lab-ledger.json`，可用 `NUXT_LAB_LEDGER_FILE` 覆盖；测试 / 首次启动可用
 * `NUXT_LAB_LEDGER_SEED`（JSON 数组或 `{ networks: [] }`）。文件不存在时读 seed，文件存在即
 * **只信文件** —— 避免“删了记录又被 seed 复活”。
 *
 * 读写边界：
 * - 解析失败、字段非法、租户不匹配一律视为不可见（失败关闭）；
 * - 外部路由只接受 `id`；`upstream_id` 不参与鉴权，也不出现在 API 出参；
 * - 写操作串行化并先写临时文件再 `rename`，避免半截 JSON。
 */

const LEDGER_VERSION = 1;
const DEFAULT_LEDGER_FILE = ".data/lab-ledger.json";
const ENGINES: readonly LabEngine[] = ["mininet", "simulator"];
const STATES: readonly LabNetworkState[] = ["creating", "running", "stopped", "error"];

interface LabLedgerFile {
	version: 1
	networks: LabNetworkRecord[]
}

interface LabLedgerConfig {
	file: string
	seed: unknown
}

function configOf(event: H3Event): LabLedgerConfig {
	const runtime = useRuntimeConfig(event);
	const lab = (runtime.lab ?? {}) as Record<string, unknown>;
	const file = typeof lab.ledgerFile === "string" && lab.ledgerFile.trim()
		? lab.ledgerFile.trim()
		: DEFAULT_LEDGER_FILE;

	// `NUXT_LAB_LEDGER_SEED` 是 JSON 字面量：Nuxt 的运行时环境覆盖会先用 destr 解析，
	// 因此这里可能已经是数组 / `{ networks: [] }` 而不是字符串 —— 两种形态都必须接受。
	return { file: resolve(process.cwd(), file), seed: lab.ledgerSeed };
}

function nonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringList(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}

	return value
		.map((item) => nonEmptyString(item))
		.filter((item): item is string => item !== undefined);
}

function parseResources(value: unknown): LabNetworkResources | undefined {
	const record = value && typeof value === "object" ? value as Record<string, unknown> : undefined;
	if (!record) {
		return undefined;
	}

	const nodes = stringList(record.nodes);
	const links = stringList(record.links);
	return nodes || links ? { ...(nodes ? { nodes } : {}), ...(links ? { links } : {}) } : undefined;
}

function parseRecord(value: unknown): LabNetworkRecord | undefined {
	const record = value && typeof value === "object" ? value as Record<string, unknown> : undefined;
	if (!record) {
		return undefined;
	}

	const id = nonEmptyString(record.id);
	const tenantId = nonEmptyString(record.tenant_id);
	const engine = nonEmptyString(record.engine) as LabEngine | undefined;
	const upstreamId = nonEmptyString(record.upstream_id);
	const state = nonEmptyString(record.state) as LabNetworkState | undefined;
	const createdBy = nonEmptyString(record.created_by) ?? "unknown";
	const createdAt = nonEmptyString(record.created_at);
	const updatedAt = nonEmptyString(record.updated_at);

	if (!id || !tenantId || !engine || !upstreamId || !state || !createdAt || !updatedAt) {
		return undefined;
	}
	if (!ENGINES.includes(engine) || !STATES.includes(state)) {
		return undefined;
	}

	const resources = parseResources(record.resources);
	return {
		id,
		tenant_id: tenantId,
		engine,
		upstream_id: upstreamId,
		state,
		created_by: createdBy,
		created_at: createdAt,
		updated_at: updatedAt,
		...(resources ? { resources } : {})
	};
}

function parseNetworks(value: unknown): LabNetworkRecord[] {
	const source = Array.isArray(value)
		? value
		: value && typeof value === "object" && Array.isArray((value as { networks?: unknown }).networks)
			? (value as { networks: unknown[] }).networks
			: [];

	return source
		.map((item) => parseRecord(item))
		.filter((item): item is LabNetworkRecord => item !== undefined);
}

async function readFileRecords(file: string): Promise<LabNetworkRecord[] | undefined> {
	try {
		const raw = await readFile(file, "utf8");
		if (!raw.trim()) {
			return [];
		}
		return parseNetworks(JSON.parse(raw));
	} catch (error) {
		const code = (error as { code?: string }).code;
		if (code === "ENOENT") {
			return undefined;
		}

		// 损坏的台账不能“假装为空”之外的任何东西：失败关闭比读到半份数据安全
		console.warn("[lab-ledger] unable to read ledger; treating it as empty", code ?? "parse_error");
		return [];
	}
}

async function loadRecords(event: H3Event, config: LabLedgerConfig): Promise<LabNetworkRecord[]> {
	const stored = await readFileRecords(config.file);
	if (stored !== undefined) {
		return stored;
	}

	if (!config.seed) {
		return [];
	}

	try {
		const parsed = typeof config.seed === "string" ? JSON.parse(config.seed) : config.seed;
		return parseNetworks(parsed);
	} catch {
		console.warn("[lab-ledger] NUXT_LAB_LEDGER_SEED is not valid JSON; treating it as empty");
		return [];
	}
}

async function writeRecords(config: LabLedgerConfig, records: LabNetworkRecord[]): Promise<void> {
	const body: LabLedgerFile = { version: LEDGER_VERSION, networks: records };
	const temp = `${config.file}.${process.pid}.${randomUUID()}.tmp`;

	await mkdir(dirname(config.file), { recursive: true });
	await writeFile(temp, `${JSON.stringify(body, null, "\t")}\n`, "utf8");
	await rename(temp, config.file);
}

let writeChain: Promise<unknown> = Promise.resolve();

function enqueueWrite<T>(job: () => Promise<T>): Promise<T> {
	const next = writeChain.then(job, job);
	writeChain = next.then(() => undefined, () => undefined);
	return next;
}

/**
 * 当前主体可见的台账记录；`engine` 缺省＝全部引擎。
 *
 * 入参是已认证主体而不是裸租户字符串：可见性判定必须走 `canSeeLabNetwork()`，
 * 否则容易出现“调用方先把 tenantId 填成空串 / 别人租户”的旁路。
 */
export async function listLabNetworks(
	event: H3Event,
	principal: LabPrincipal,
	engine?: LabEngine
): Promise<LabNetworkRecord[]> {
	const records = await loadRecords(event, configOf(event));
	return records
		.filter((record) => canSeeLabNetwork(principal, record.tenant_id))
		.filter((record) => engine === undefined || record.engine === engine)
		.sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}

/** 按 BFF id 查台账；跨租户与不存在共用 `undefined`（D4） */
export async function getLabNetwork(
	event: H3Event,
	principal: LabPrincipal,
	networkId: string,
	engine?: LabEngine
): Promise<LabNetworkRecord | undefined> {
	const records = await listLabNetworks(event, principal, engine);
	return records.find((record) => record.id === networkId);
}

/**
 * 当前租户某引擎的活动网络。
 *
 * Mininet 一台实例只跑一张网，因此按 `updated_at` 取最近一条；P3 若允许多网并存，
 * 调用方必须显式带 `id`，不得继续依赖这个简化选择。
 */
export async function getActiveLabNetwork(
	event: H3Event,
	principal: LabPrincipal,
	engine: LabEngine
): Promise<LabNetworkRecord | undefined> {
	const records = await listLabNetworks(event, principal, engine);
	return records.find((record) => record.state === "running") ?? records[0];
}

/** 新增或替换一条台账记录（P3 创建/启停使用；P2 只读路径不调用） */
export async function upsertLabNetwork(event: H3Event, record: LabNetworkRecord): Promise<LabNetworkRecord> {
	const parsed = parseRecord(record);
	if (!parsed) {
		throw new TypeError("invalid_lab_network_record");
	}

	const config = configOf(event);
	return await enqueueWrite(async () => {
		const records = await loadRecords(event, config);
		const index = records.findIndex((item) => item.id === parsed.id);

		if (index >= 0) {
			if (records[index]?.tenant_id !== parsed.tenant_id) {
				throw new Error("lab_network_tenant_mismatch");
			}
			records[index] = parsed;
		} else {
			records.push(parsed);
		}

		await writeRecords(config, records);
		return parsed;
	});
}

/** 删除台账记录（跨租户静默不命中，调用方仍回 404） */
export async function deleteLabNetwork(event: H3Event, tenantId: string, networkId: string): Promise<boolean> {
	const config = configOf(event);
	return await enqueueWrite(async () => {
		const records = await loadRecords(event, config);
		const remaining = records.filter((record) => !(record.id === networkId && record.tenant_id === tenantId));
		if (remaining.length === records.length) {
			return false;
		}

		await writeRecords(config, remaining);
		return true;
	});
}

/** 资源清单归一化：链路键无向，比较前按字典序排列 */
export function normalizedLabLinkKey(left: string, right: string): string {
	return [left, right].sort().join("--");
}

/**
 * 一次写操作对资源清单的影响（NMCPS-ADR-0021 P2 清单 / NMCPS-ADR-0022 写路径）。
 *
 * `removeNodes` 会连带移除这些节点上的链路：上游删节点时链路由实例自己消失，
 * 清单里留下悬空链路键只会让下一次过滤看起来“过期”。
 */
export interface LabResourceChange {
	addNodes?: string[]
	removeNodes?: string[]
	addLinks?: Array<{ source: string, target: string }>
	removeLinks?: Array<{ source: string, target: string }>
	/**
	 * 整表重建（`POST /full_reset`，NMCPS-ADR-0022 W5）：上游会清掉全部节点与链路，
	 * 清单必须整体清空 —— 增量式「删掉已知的那些」会在上游已多出节点时留下悬空 id。
	 * 置位时其余字段一律忽略。
	 */
	reset?: boolean
}

/** 链路键归一：台账里可能存成 `b--a`，比较前按字典序排 */
function normalizeLinkKey(key: string): string {
	const [left, right] = key.split("--");
	return left && right ? normalizedLabLinkKey(left, right) : key;
}

function sameEntries(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((item) => right.includes(item));
}

/**
 * 写操作成功后把资源清单收敛到上游事实：新建的节点 / 链路进清单，删掉的出清单。
 *
 * 为什么必须做：台账一旦登记了 `resources`，清单就是租户边界，列表出口与路径参数都按它判。
 * 只读清单会在第一次写之后立刻过期 —— 新建的节点落在清单外，下一次 `GET /hosts` 会被
 * 出口过滤丢掉（画布看不到新节点），单对象写响应（上游 `POST /switches` 回的就是交换机本身）
 * 甚至会被判成 404 `lab_resource_not_found`。
 *
 * 只在记录**已经有清单**时维护，且只维护清单里已经出现的字段：没有 `resources` 表示
 * 「以租户实例为边界」，凭空造一张清单会把实例里既有节点一次全判成“清单外”；
 * 只登记了 `links` 的记录同理，不该因为一次建节点就凭空多出一份 `nodes` 白名单。
 */
export async function recordLabResourceChange(
	event: H3Event,
	network: LabNetworkRecord,
	change: LabResourceChange
): Promise<LabNetworkRecord> {
	const resources = network.resources;
	if (!resources) {
		return network;
	}

	const next: LabNetworkResources = { ...resources };

	// 整表重建优先：上游清空后清单里不能再留任何 id / 链路键
	if (change.reset) {
		if (resources.nodes)
			next.nodes = [];
		if (resources.links)
			next.links = [];
	}

	if (!change.reset && resources.nodes) {
		const nodes = new Set(resources.nodes);
		for (const id of change.addNodes ?? []) {
			nodes.add(id);
		}
		for (const id of change.removeNodes ?? []) {
			nodes.delete(id);
		}
		next.nodes = [...nodes];
	}

	if (!change.reset && resources.links) {
		const removed = new Set(change.removeNodes ?? []);
		const links = new Set(resources.links.map((key) => normalizeLinkKey(key)));
		for (const key of [...links]) {
			const [left, right] = key.split("--");
			if ((left && removed.has(left)) || (right && removed.has(right))) {
				links.delete(key);
			}
		}
		for (const link of change.addLinks ?? []) {
			links.add(normalizedLabLinkKey(link.source, link.target));
		}
		for (const link of change.removeLinks ?? []) {
			links.delete(normalizedLabLinkKey(link.source, link.target));
		}
		next.links = [...links];
	}

	const nodesChanged = resources.nodes ? !sameEntries(next.nodes ?? [], resources.nodes) : false;
	const linksChanged = resources.links ? !sameEntries(next.links ?? [], resources.links.map((key) => normalizeLinkKey(key))) : false;
	if (!nodesChanged && !linksChanged) {
		return network;
	}

	return await upsertLabNetwork(event, { ...network, resources: next, updated_at: new Date().toISOString() });
}

/**
 * 台账 `state` 的写回（NMCPS-ADR-0021 D7 的 `state` 字段）。
 *
 * `start` / `stop` / `full_reset` 成功之后，新状态是 BFF 自己知道的确定事实（上游这两条
 * 端点成功即等于状态已切换），不写回的话台账永远停在 seed 那一刻的 `running`：页面的
 * 「网络」徽章与「网络」标签页读的都是这个字段，于是网停了、读数还写着 `running`
 * （2026-11-20 逐条复验实测）。运行态的真源仍是 `GET /api/mininet/start`；这里只是让
 * 台账不撒谎，失败不回滚、也不改判上游结果。
 *
 * 入参是 id 而不是记录：写回要跟 `recordLabResourceChange()` 排在同一条写链上重读
 * 最新记录，拿调用方手里那份旧快照去 upsert 会把刚收敛好的 `resources` 覆盖回去。
 */
export async function markLabNetworkState(
	event: H3Event,
	networkId: string,
	state: LabNetworkState
): Promise<LabNetworkRecord | undefined> {
	const config = configOf(event);
	return await enqueueWrite(async () => {
		const records = await loadRecords(event, config);
		const index = records.findIndex((item) => item.id === networkId);
		const current = records[index];
		if (!current || current.state === state) {
			return current;
		}

		const parsed = parseRecord({ ...current, state, updated_at: new Date().toISOString() });
		if (!parsed) {
			throw new TypeError("invalid_lab_network_record");
		}

		records[index] = parsed;
		await writeRecords(config, records);
		return parsed;
	});
}

/** 路径参数是否属于台账记录的资源清单（未登记清单＝以实例为边界，放行） */
export function isLabResourceAllowed(
	network: LabNetworkRecord,
	params: Record<string, string>
): boolean {
	const resources = network.resources;
	if (!resources) {
		return true;
	}

	const nodeIds = resources.nodes ? new Set(resources.nodes) : undefined;
	const linkKeys = resources.links
		? new Set(resources.links.map((key) => {
			const [left, right] = key.split("--");
			return left && right ? normalizedLabLinkKey(left, right) : key;
		}))
		: undefined;

	for (const key of ["node_id", "switch_id"]) {
		const value = params[key];
		if (value && nodeIds && !nodeIds.has(value)) {
			return false;
		}
	}

	const source = params.src_id;
	const target = params.dst_id;
	if (source && target) {
		if (nodeIds && (!nodeIds.has(source) || !nodeIds.has(target))) {
			return false;
		}
		if (linkKeys && !linkKeys.has(normalizedLabLinkKey(source, target))) {
			return false;
		}
	}

	return true;
}

export function toLabNetworkSummary(record: LabNetworkRecord): LabNetworkSummary {
	return {
		id: record.id,
		engine: record.engine,
		state: record.state,
		created_by: record.created_by,
		created_at: record.created_at,
		updated_at: record.updated_at,
		node_count: record.resources?.nodes?.length ?? null,
		link_count: record.resources?.links?.length ?? null
	};
}
