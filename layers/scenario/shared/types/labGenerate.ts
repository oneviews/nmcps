// layers/scenario/shared/types/labGenerate.ts
// 「生成拓扑」的**纯数据 + 纯函数**：三种预置形状（Single / Linear / Tree）→
// 节点创建顺序 + 链路清单 + 坐标。
//
// 行为来源：旧 Vite 前端的 `Side.vue`「生成拓扑」按钮 + `TopologyForm.vue` 表单 +
// `NetworkGraph.vue` 的 `createSingleTopo()` / `createLinearTopo()` / `createTreeTopo()`
// （NMCPS-ADR-0022 §六 的复刻清单）。2.0 只复刻**行为**：不复制旧组件源码与样式，
// 布局坐标沿用旧算法，请求体仍与 `labNodePayloadOf()` 同源（同一批字段名）。
//
// 不做的事：不发请求、不读能力位、不碰台账 —— 页面负责串行执行并重读台账。
// 串行是硬要求：上游单个 `app.net`，BFF 对同一网络只允许一个在途写操作
// （NMCPS-ADR-0022 D5），并发 `Promise.all` 会直接拿 409。

import type { LabNodeKind, LabSwitchType } from "./labNodes";
import { LAB_NODE_PREFIXES } from "./labNodes";

/** 预置形状：与旧 `TopologyForm.vue` 的三个选项一一对应 */
export const LAB_TOPOLOGY_SHAPES = ["single", "linear", "tree"] as const;

export type LabTopologyShape = (typeof LAB_TOPOLOGY_SHAPES)[number];

/** 一次生成最多涉及的节点数：挡住「扇出 6 × 4 层」这类把后端拖死的输入 */
export const LAB_GENERATE_MAX_NODES = 32;

/**
 * 表单草稿。四个数量字段按形状取用，语义与旧表单一致：
 * - `single`：`hosts` = 主机数（挂在唯一交换机下）
 * - `linear`：`switches` = 交换机数，`hostsPerSwitch` = 每台交换机的主机数
 * - `tree`：`layers` = 层数，`fanout` = 每层扇出
 */
export interface LabGenerateDraft {
	shape: LabTopologyShape
	hosts: number
	switches: number
	hostsPerSwitch: number
	layers: number
	fanout: number
	/** 关联的控制器 id（空串 = 不关联）；必须是台账里已存在的控制器 */
	controller: string
}

/** 生成计划的失败原因：返回 i18n 的**键后缀**，由组件拼成完整键 */
export type LabGenerateError = "countInvalid" | "tooLarge";

/** 生成计划的一项节点：`kind` 决定端点（`LAB_NODE_COLLECTIONS`），`payload` 就是请求体 */
export interface LabGenerateNode {
	kind: Extract<LabNodeKind, "host" | "switch">
	payload: Record<string, unknown>
}

/** 生成计划的一条链路（`POST /api/lab/links` 的 `{src, dst}`） */
export interface LabGenerateLink {
	src: string
	dst: string
}

export interface LabGeneratePlan {
	/** 创建顺序：交换机在前、主机在后、链路最后（上游 `POST /links` 要求两端已存在） */
	nodes: LabGenerateNode[]
	links: LabGenerateLink[]
}

/** 生成计划需要的现场信息（来自台账与「设置」） */
export interface LabGenerateContext {
	/** 画布上已有的节点 id：用于错开名字，杜绝「静默 updated」 */
	existingIds: readonly string[]
	/** 下一个主机序号（现有主机数 + 1） */
	hostSequence: number
	/** 下一个交换机序号（现有交换机数 + 1） */
	switchSequence: number
	/** 默认交换机类型（「设置」里的偏好；缺省 `ovskernel`） */
	switchType: LabSwitchType
	/** 默认 OpenFlow 版本（`null` = 跟随上游默认） */
	ofVersion: string | null
	/** 默认链路属性（`LinkOptions`；`undefined` = 普通链路） */
	linkOptions?: Record<string, number>
}

/** 新草稿：缺省 Single + 2 台主机，与旧表单打开时的观感一致（旧版数量为空，这里给可见的默认值） */
export function labGenerateDraftOf(): LabGenerateDraft {
	return {
		shape: "single",
		hosts: 2,
		switches: 2,
		hostsPerSwitch: 2,
		layers: 2,
		fanout: 2,
		controller: ""
	};
}

/** 该形状实际会建多少节点（校验上限与弹窗摘要共用同一口径） */
export function labGenerateNodeCount(draft: LabGenerateDraft): number {
	if (draft.shape === "single")
		return 1 + draft.hosts;
	if (draft.shape === "linear")
		return draft.switches + draft.switches * draft.hostsPerSwitch;
	// Tree：depth 层是主机、其余层是交换机（与旧 `createTreeTopo()` 同构）
	let total = 0;
	for (let depth = 0; depth <= draft.layers; depth++)
		total += draft.fanout ** depth;
	return total;
}

/**
 * 草稿校验：数量必须 ≥ 1，且总节点数不超过上限。
 *
 * 只拦「确定错」的输入；上游仍会自己校验控制器是否存在（`POST /switches` 对不存在的
 * `controller` 回 400），这一层不复制上游规则。
 */
export function labGenerateError(draft: LabGenerateDraft): LabGenerateError | undefined {
	const values = draft.shape === "single"
		? [draft.hosts]
		: draft.shape === "linear"
			? [draft.switches, draft.hostsPerSwitch]
			: [draft.layers, draft.fanout];

	if (values.some((value) => !Number.isInteger(value) || value < 1))
		return "countInvalid";
	if (labGenerateNodeCount(draft) > LAB_GENERATE_MAX_NODES)
		return "tooLarge";

	return undefined;
}

/** 名字发生器：从序号起找第一个未被占用的 id，并把它登记进集合 */
function nameAllocator(sequence: number, existing: Set<string>) {
	let next = Math.max(1, sequence);
	return (kind: LabNodeKind): string => {
		let name = `${LAB_NODE_PREFIXES[kind]}${next}`;
		while (existing.has(name)) {
			next++;
			name = `${LAB_NODE_PREFIXES[kind]}${next}`;
		}
		existing.add(name);
		next++;
		return name;
	};
}

/** 交换机端口数：至少容纳它要连的下级，且不小于表单默认的 4 */
function switchPortsOf(children: number): number {
	return Math.max(4, children + 1);
}

/**
 * 生成计划。
 *
 * 坐标复刻旧前端的三套布局（`250 / 150` 基准、主机 `90 / 50` 间距、树按层缩放），
 * 不做「自动避让已有节点」—— 旧版也不做；画布本身有平移归一化，新建的图落在旁边
 * 比打乱已有拓扑更好。
 */
export function labGeneratePlan(draft: LabGenerateDraft, ctx: LabGenerateContext): LabGeneratePlan {
	const existing = new Set(ctx.existingIds);
	// 名字前缀不同，序号各自独立：主机序号不该被交换机吃掉
	const switchNext = nameAllocator(ctx.switchSequence, existing);
	const hostNext = nameAllocator(ctx.hostSequence, existing);

	let hostIp = Math.max(1, ctx.hostSequence);
	const nodes: LabGenerateNode[] = [];
	const links: LabGenerateLink[] = [];

	const controller = draft.controller.trim() ? draft.controller.trim() : null;

	function makeSwitch(x: number, y: number, ports: number): string {
		const name = switchNext("switch");
		nodes.push({
			kind: "switch",
			payload: {
				id: name,
				type: "switch",
				name,
				label: name,
				x,
				y,
				ports,
				controller,
				switch_type: ctx.switchType,
				of_version: ctx.ofVersion
			}
		});
		return name;
	}

	function makeHost(x: number, y: number): string {
		const name = hostNext("host");
		const ordinal = hostIp++;
		nodes.push({
			kind: "host",
			payload: {
				id: name,
				type: "host",
				name,
				label: name,
				x,
				y,
				ip: `10.0.0.${ordinal}`,
				mac: `00:00:00:00:00:${(ordinal % 256).toString(16).padStart(2, "0")}`
			}
		});
		return name;
	}

	function link(src: string, dst: string): void {
		links.push({ src, dst });
	}

	if (draft.shape === "single") {
		// 旧 createSingleTopo()：一台交换机在 (250, 150)，主机横向排在 y=300
		const sw = makeSwitch(250, 150, switchPortsOf(draft.hosts));
		for (let index = 0; index < draft.hosts; index++)
			link(sw, makeHost(200 + index * 90, 300));
	} else if (draft.shape === "linear") {
		// 旧 createLinearTopo()：交换机横向排开，主机在各自交换机下方堆叠，相邻交换机相连
		const switches: string[] = [];
		for (let index = 0; index < draft.switches; index++)
			switches.push(makeSwitch(250 + index * 90, 150, switchPortsOf(draft.hostsPerSwitch + 1)));

		for (const [index, sw] of switches.entries()) {
			for (let host = 0; host < draft.hostsPerSwitch; host++)
				link(sw, makeHost(200 + index * 90, 300 + host * 50));
			const previous = switches[index - 1];
			if (previous)
				link(sw, previous);
		}
	} else {
		// 旧 createTreeTopo()：depth 层是叶子主机，0 层是根交换机；x 按该层节点数均分
		const maxNodes = draft.fanout ** draft.layers;
		const layers: string[][] = [];

		for (let depth = draft.layers; depth >= 0; depth--) {
			const count = draft.fanout ** depth;
			const layer: string[] = [];
			for (let index = 0; index < count; index++) {
				const x = (index + 0.5) * maxNodes * 100 / (count || 1);
				const y = 150 + depth * 150;
				layer.push(depth === draft.layers
					? makeHost(x, y)
					: makeSwitch(x, y, switchPortsOf(draft.fanout)));
			}
			layers[depth] = layer;
		}

		for (let depth = 0; depth < draft.layers; depth++) {
			const parents = layers[depth] ?? [];
			const children = layers[depth + 1] ?? [];
			for (const [index, parent] of parents.entries()) {
				for (let offset = 0; offset < draft.fanout; offset++) {
					const child = children[index * draft.fanout + offset];
					if (child)
						link(parent, child);
				}
			}
		}
	}

	return { nodes, links };
}

/** 链路请求体：默认链路属性只在「设置」里填过时才带上（否则普通 `addLink`） */
export function labGenerateLinkPayloadOf(
	link: LabGenerateLink,
	options?: Record<string, number>
): Record<string, unknown> {
	return options && Object.keys(options).length
		? { src: link.src, dst: link.dst, options }
		: { src: link.src, dst: link.dst };
}
