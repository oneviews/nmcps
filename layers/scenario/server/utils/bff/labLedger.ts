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
