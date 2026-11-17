// layers/scenario/shared/types/labImport.ts
// 拓扑导入的**纯函数**（NMCPS-ADR-0022 W4）。
//
// 上游 `POST /api/mininet/import_json` 收的是 multipart 的 `file` 字段，正文认两种形状：
// - 图形状 `{ nodes: [{ id, type }], edges: [{ from, to }] }`（Vis / NetworkX 常见导出）；
// - 台账形状 `{ controllers, switches, hosts, routers, nats, links }`（即 `export_json` 的产物）。
//
// BFF 侧把客户端的 JSON 包体重新封装成 1 MB 以内的文件（`[...slug].ts` → `upload`），
// 页面侧用本模块**先在本地判形状**：形状不对时零请求就地报错，不把 400 当用户体验。
//
// 约束：纯数据 + 纯函数（无 IO / 无 Nuxt 别名），页面与 BFF 共用同一份口径。

export interface LabImportNodeRef {
	id: string
	type?: string
}

export interface LabImportLinkRef {
	source: string
	target: string
}

export interface LabImportTopology {
	nodes: LabImportNodeRef[]
	links: LabImportLinkRef[]
}

/** 就地报错的三种原因：空文件 / 不是合法 JSON / 既不是图形状也不是台账形状 */
export type LabImportError = "empty" | "invalidJson" | "shapeInvalid";

export type LabImportParseResult
	= | { ok: true, topology: LabImportTopology, payload: Record<string, unknown> }
		| { ok: false, error: LabImportError };

/** 台账形状里承载节点的五个集合（顺序即上游建节点的顺序，这里只用来判形状） */
const NODE_COLLECTIONS = ["controllers", "switches", "hosts", "routers", "nats"] as const;
/** 控制器与交换机的连线是**关联**而不是链路（上游导入时单独走 `associate_switch`） */
const CONTROLLER_TYPES = new Set(["controller", "ctl", "c"]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: undefined;
}

function idOf(value: unknown): string | undefined {
	const record = asRecord(value);
	const candidates = [record?.id, record?.name];
	const hit = candidates.find((item): item is string => typeof item === "string" && item.trim().length > 0);
	return hit?.trim();
}

function typeOf(value: unknown): string | undefined {
	const record = asRecord(value);
	const hit = record?.type;
	return typeof hit === "string" && hit.trim() ? hit.trim().toLowerCase() : undefined;
}

function isController(node: LabImportNodeRef | undefined): boolean {
	return node?.type !== undefined && CONTROLLER_TYPES.has(node.type);
}

/** 台账形状的 `links`：既接受 `["a","b"]` 二元组，也接受 `{ src, dst }` 对象 */
function linkOf(value: unknown): LabImportLinkRef | undefined {
	if (Array.isArray(value)) {
		const [source, target] = value;
		return typeof source === "string" && typeof target === "string" && source && target
			? { source, target }
			: undefined;
	}

	const record = asRecord(value);
	const source = record?.src;
	const target = record?.dst;
	return typeof source === "string" && typeof target === "string" && source && target
		? { source, target }
		: undefined;
}

function edgeOf(value: unknown): LabImportLinkRef | undefined {
	const record = asRecord(value);
	const source = record?.from;
	const target = record?.to;
	return typeof source === "string" && typeof target === "string" && source && target
		? { source, target }
		: undefined;
}

/**
 * 解析一份导出的拓扑文本。
 *
 * 两种形状都归一成 `{ nodes, links }`：`nodes` 供台账资源清单收敛（导入是**追加**，不是替换 ——
 * 上游 `import_json` 只 `create_*`，不删既有节点），`links` 供清单里的链路键。
 * controller 与 switch 之间的 `edge` 不是链路，落库时被上游当成 `associate_switch`，这里同样跳过。
 */
export function parseLabImport(text: string): LabImportParseResult {
	if (!text.trim()) {
		return { ok: false, error: "empty" };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return { ok: false, error: "invalidJson" };
	}

	const payload = asRecord(parsed);
	if (!payload) {
		return { ok: false, error: "shapeInvalid" };
	}

	// ── 图形状：`nodes` + `edges` ──
	if (Array.isArray(payload.nodes) && Array.isArray(payload.edges)) {
		const nodes = payload.nodes
			.map((item): LabImportNodeRef | undefined => {
				const id = idOf(item);
				return id ? { id, ...(typeOf(item) ? { type: typeOf(item) } : {}) } : undefined;
			})
			.filter((item): item is LabImportNodeRef => item !== undefined);
		const byId = new Map(nodes.map((node) => [node.id, node]));
		const links = payload.edges
			.map(edgeOf)
			.filter((link): link is LabImportLinkRef => link !== undefined)
			.filter((link) => !isController(byId.get(link.source)) && !isController(byId.get(link.target)));

		return { ok: true, topology: { nodes, links }, payload };
	}

	// ── 台账形状：`export_json` 的产物，五个节点集合 + `links` ──
	const collections = NODE_COLLECTIONS.filter((key) => Array.isArray(payload[key]));
	if (collections.length === 0) {
		return { ok: false, error: "shapeInvalid" };
	}

	const nodes: LabImportNodeRef[] = [];
	for (const key of collections) {
		for (const item of payload[key] as unknown[]) {
			const id = idOf(item);
			if (!id) {
				continue;
			}
			// 集合名就是类型：`controllers` 里的条目即便没写 `type` 也按控制器处理
			const declared = typeOf(item) ?? (key === "controllers" ? "controller" : undefined);
			nodes.push({ id, ...(declared ? { type: declared } : {}) });
		}
	}

	const byId = new Map(nodes.map((node) => [node.id, node]));
	const links = (Array.isArray(payload.links) ? payload.links : [])
		.map(linkOf)
		.filter((link): link is LabImportLinkRef => link !== undefined)
		.filter((link) => !isController(byId.get(link.source)) && !isController(byId.get(link.target)));

	return { ok: true, topology: { nodes, links }, payload };
}

/** BFF 写路径用：请求体已经是原始 JSON 文本，直接复用同一份解析 */
export function parseLabImportBody(raw: string | undefined): LabImportTopology | undefined {
	if (!raw) {
		return undefined;
	}
	const parsed = parseLabImport(raw);
	return parsed.ok ? parsed.topology : undefined;
}
