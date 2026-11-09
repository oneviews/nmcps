import type { SimulatorLinkMarker, SimulatorNodeMarker } from "~~/app/utils/graph/simulatorOverlay";
import type { TopologyAlarmIndex } from "~~/app/utils/graph/topologyAlarms";
import type { ComboStorage } from "~~/app/utils/graph/topologyComboPrefs";
import type { TopologyLayoutMode } from "~~/app/utils/graph/topologyLayout";
import type { TopologyNeighborRow } from "~~/app/utils/graph/topologyNeighbors";
import type { NodeOffset, NodeOffsetMap } from "~~/app/utils/graph/topologyNodeOffsets";
// layers/topology/app/composables/useTopologyMonitor.ts
// `/topology/monitor` 的取数内核（NMCPS-DESIGN-001 §6.1 / §6.2 / §6.4）：
//   · 8888 主数据源：`GET /api/topology/graph`（拓扑结构，缺失即错误态 + 重试）；
//   · 8001 第二数据源：`GET /api/sim/api/network/runtime-inventory` 与 `/stats`（仿真运行态，
//     可选通道：未配置 / 不可达只降级仿真区块，**不**把整页变成错误）。
//
// 两路数据的失败语义刻意不同：主上游失败 → 页面级错误；仿真通道失败 → 只读降级 + 一行说明
// （DESIGN-001 §八「不允许把可选上游的抖动升级成整页错误」）。
import type { AlarmEvent, AlarmEventPage } from "~~/shared/types/alarm";
import type { SimulatorChannelInfo, SimulatorLldpNeighbor, SimulatorLldpNeighbors, SimulatorNetworkStats, SimulatorRuntimeInventory } from "~~/shared/types/simulator";
import type { TopologyGraph } from "~~/shared/types/topology";
import { buildSimulatorIndex, buildSimulatorLinkIndex, simulatorLinkOf, simulatorMarkerOf } from "~~/app/utils/graph/simulatorOverlay";
import { alarmIndexOf, normalizeAlarmEvents } from "~~/app/utils/graph/topologyAlarms";
import { childIndex, collapsePlanOf } from "~~/app/utils/graph/topologyCollapse";
import { pruneCollapsedCombos, readCollapsedCombos, writeCollapsedCombos } from "~~/app/utils/graph/topologyComboPrefs";
import { layoutTopology, RADIAL_ROTATE_DEG, TOPOLOGY_ROTATE_MAX, TOPOLOGY_ROTATE_MIN } from "~~/app/utils/graph/topologyLayout";
import { neighborCanvasCount, neighborRowsOf } from "~~/app/utils/graph/topologyNeighbors";
import { clearNodeOffsets, countNodeOffsets, setNodeOffset } from "~~/app/utils/graph/topologyNodeOffsets";
import { normalizeNodeStatus, normalizeTopologyGraph, topologyLinksOf, topologyNodeIp } from "~~/app/utils/graph/topologyNormalize";
import { SIMULATOR_MESSAGES } from "~~/shared/constants/upstreamReasons";

/** 仿真通道三态 + loading：`disabled` 是「未配置」，不是错误 */
export type SimulatorChannelState = "loading" | "disabled" | "unreachable" | "ok";

/** 页面开放的节点动作（NMCPS-DESIGN-001 §6.2 写入口范围表；端点由 `SIMULATOR_ROUTES` 白名单兜底） */
export const SIMULATOR_NODE_ACTIONS = ["restart", "stop"] as const;
export type SimulatorNodeAction = (typeof SIMULATOR_NODE_ACTIONS)[number];

/**
 * 页面开放的**链路**动作（§6.2 写入口范围表，2026-11-07 随链路选择一起开放）。
 *
 * 只开三个：`up` / `down` / `toggle` 改的是「这条链路通不通」，语义单一、结果可立刻在画布上看到；
 * `disable` / `power` / `reconfigure` 与 `PATCH tc|radio` 属其它域的参数化改动（传输 / 频谱），
 * 本页不设入口 —— 不开放的动作不出现在工具栏上，而不是亮着按钮点了没反应。
 */
export const SIMULATOR_LINK_ACTIONS = ["down", "up", "toggle"] as const;
export type SimulatorLinkAction = (typeof SIMULATOR_LINK_ACTIONS)[number];

/** 动作并集：`acting` 记的是「正在下发哪一个」（节点与链路共用一把门闩，避免并发写同一台仿真） */
export type SimulatorAction = SimulatorNodeAction | SimulatorLinkAction;

/** 动作结果：失败时 `message` 是 BFF/上游原话（数据，不翻译），由页面决定提示口径 */
export interface SimulatorActionResult {
	ok: boolean
	action: SimulatorAction
	/** 失败原因（成功时为空串） */
	message: string
}

/** 告警通道状态（与仿真通道分开：告警不可用时只摘角标，拓扑照常画） */
export type AlarmChannelState = "loading" | "ok" | "error";

/**
 * 邻接通道状态（§6.14）：`idle` = 没有可查的对象（未选中 / 该节点不在仿真运行态里）。
 *
 * `idle` 与 `ok`（空数组）**不是**一回事：前者是「没有这份数据」，后者是「上游明确说没有邻居」。
 */
export type NeighborChannelState = "idle" | "loading" | "ok" | "error";

/** 告警通道一次取多少条：现网 firing 实测 77 条（2026-11-07），留到 200 给增长空间 */
const ALARM_PAGE_SIZE = 200;

/** 主上游拓扑图的失败信息（BFF 原始 message 属数据，展示时原样给出） */
export interface TopologyGraphError {
	code: number
	message: string
}

/** 轮询周期（DESIGN-001 §6.4：拓扑与指标默认 30s；页面不可见时暂停） */
const POLL_INTERVAL_MS = 30_000;

export function useTopologyMonitor() {
	const api = useApi();

	const graph = ref<TopologyGraph | null>(null);
	const inventory = ref<SimulatorRuntimeInventory | null>(null);
	const stats = ref<SimulatorNetworkStats | null>(null);
	/** 通道能力位（`/api/sim/channel`）：写按钮可不可点只看它，不猜 */
	const channel = ref<SimulatorChannelInfo | null>(null);
	const loading = ref(false);
	const refreshing = ref(false);
	const graphError = ref<TopologyGraphError | null>(null);
	const simState = ref<SimulatorChannelState>("loading");
	/** 仿真通道的原始原因（`simulator_not_configured` / `simulator_unreachable`…） */
	const simReason = ref<string>("");
	const selectedId = ref<string | null>(null);
	const lastLoadedAt = ref<Date | null>(null);
	/** 正在下发的动作（按钮 `loading` 与重复提交的门闩；节点与链路动作共用） */
	const acting = ref<SimulatorAction | null>(null);
	/** 2D 布局形态（§6.8）：默认分层网格，与 1.0 的默认 radial 不同 —— 2.0 的径向扇是可选视图 */
	const layoutMode = ref<TopologyLayoutMode>("radial");
	/** 径向扇整体旋转（度，视觉逆时针为正；仅 `radial` 布局读取） */
	const rotationDeg = ref<number>(RADIAL_ROTATE_DEG);
	/**
	 * 节点手动位移（§6.9，1.0 v0.36 用户规格）：**独立增量层**，几何坐标仍由 `layoutTopology()` 唯一产生。
	 * 放在这里而不是画布组件里，是因为「恢复默认配置」要知道有没有可复位的位移，
	 * 而且它必须与旋转角 / 视口同源受 `useTopologyMonitor()` 管理。
	 */
	const nodeOffsets = ref<NodeOffsetMap>(clearNodeOffsets());

	let timer: ReturnType<typeof setInterval> | undefined;

	/**
	 * 已收起的区域分组（combo id，§6.11）：折叠 = 把该组节点从**布局输入**里摘掉。
	 *
	 * 不做「合成一个簇节点」：簇节点要有几何、层级、事实，全是编出来的 —— 而这里的数据是真的。
	 * 摘掉之后 `layoutTopology()` 的裁剪逻辑自然把两端不全的链路也丢掉，画布不会留悬空边；
	 * 组自身的 `counts` / `children` 仍原样显示在分组卡片上（收起不等于看不见这台设备存在）。
	 */
	const collapsedCombos = ref<string[]>([]);

	/**
	 * 折叠集合的本地持久化（§6.11，2026-11-07 补齐）：刷新后折叠状态还在。
	 *
	 * 为什么在 `onMounted` 里补水而不是 setup 里直读：SSR 侧没有 `localStorage`，setup 期读到空集、
	 * 客户端再读到非空集就会**水合不一致**（`check:ui` 把控制台错误当失败）。挂载后再灌，是纯粹的状态更新。
	 */
	function comboStorage(): ComboStorage | null {
		if (!import.meta.client)
			return null;
		try {
			return window.localStorage;
		} catch {
			// 隐私模式 / 被策略禁用：`window.localStorage` 取值本身就可能抛
			return null;
		}
	}

	/**
	 * 当前聚焦的分组（§6.11「只看这一组」，2026-11-07 新增）：非空时布局只用该组节点。
	 *
	 * 与折叠互补：折叠是「把某组摘掉」，聚焦是「只留某组」。两者同时生效会被折叠压成空图，
	 * 所以聚焦一个分组时先展开它（见 `focusCombo()`）。
	 */
	const focusComboId = ref<string | null>(null);

	/** 聚焦仍指向一个已经消失的分组时自动失效（上游删组后不留空画布） */
	const focusedCombo = computed(() => {
		if (!focusComboId.value)
			return null;
		return (graph.value?.combos ?? []).some((combo) => combo.id === focusComboId.value) ? focusComboId.value : null;
	});

	// ── 收起 / 展开下级（§6.15，G6 v5 `collapse-expand` 的等价实现，2026-11-08）────────────
	//
	// 状态只有一份：被收起的节点 id 数组。**隐藏哪些元素**的规则在纯函数 `collapsePlanOf()` 里
	// （`app/utils/graph/topologyCollapse.ts`）：收起的节点自己留着、它的下级与只连着下级的边摘掉。
	// 为什么不像分组那样持久化：收起的是一棵子树，上游删掉那台设备 / 它已经没有下级时这份偏好在
	// 本会话内自动失效（见下面的 `watch`），落盘只会把失效状态带到下一次会话。
	const collapsedNodes = ref<string[]>([]);

	/** 区域分组折叠 / 聚焦之后的节点集合：收起下级的计数与方向都基于这份「眼前这张图」 */
	const nodesAfterCombos = computed(() => {
		const collapsed = new Set(collapsedCombos.value);
		const focus = focusedCombo.value;
		return (graph.value?.nodes ?? []).filter((node) => {
			if (node.combo && collapsed.has(node.combo))
				return false;
			return !focus || node.combo === focus;
		});
	});

	/** 收起计划：布局、角标读数、失效修剪三处共用同一份结果 */
	const collapsePlan = computed(() => collapsePlanOf(
		nodesAfterCombos.value,
		topologyLinksOf(graph.value),
		collapsedNodes.value
	));

	/** 节点 id → 收起后会遮住的台数（画布角标 `+N` 与详情栏按钮共用） */
	const collapseChildCounts = computed<Record<string, number>>(() => {
		const result: Record<string, number> = {};
		for (const [id, count] of collapsePlan.value.hiddenCounts) {
			if (count > 0)
				result[id] = count;
		}
		return result;
	});

	/** 当前被收起遮住的节点数（画布角标「已收起 N 台」） */
	const collapsedHiddenCount = computed(() => collapsePlan.value.hiddenNodes);

	/** 是否存在可收起的节点（「全部展开」按钮的禁用态） */
	const hasCollapsedNodes = computed(() => collapsedNodes.value.length > 0);

	/**
	 * 收起 / 展开一个节点的下级；没有下级的节点**不做任何事**（它不是可收起对象）。
	 *
	 * 几何按完整集合算（见 `layout`），收起只摘元素不挪人 —— 因此位移增量**不清空**：
	 * 节点留在原地，用户拖过的位置也留在原地（收起不是「重新排版」）。
	 */
	function toggleCollapse(id: string): void {
		if ((collapsePlan.value.childIds.get(id)?.length ?? 0) === 0)
			return;

		collapsedNodes.value = collapsedNodes.value.includes(id)
			? collapsedNodes.value.filter((item) => item !== id)
			: [...collapsedNodes.value, id];

		// 选中项被这次收起藏起来了 ⇒ 落回默认根（右栏不能挂着一台画布上不存在的设备，也不能空着；
		// 「根恒可见」由布局保证：收起只摘它的下级，根自己永远留在画布上）
		if (selectedId.value && !collapsePlan.value.nodes.some((node) => node.id === selectedId.value))
			selectedId.value = defaultSelectionId();
	}

	/** 全部展开（独立动作，画布角标那一枚按钮用；不动旋转角与视口） */
	function expandAllCollapsed(): void {
		if (collapsedNodes.value.length === 0)
			return;
		collapsedNodes.value = [];
	}

	/** 上游一变就修剪：设备没了 / 它已经没有下级时，收起条目不参与任何计算 */
	watch(graph, () => {
		if (collapsedNodes.value.length === 0)
			return;
		const childIds = childIndex(graph.value?.nodes ?? [], topologyLinksOf(graph.value));
		const next = collapsedNodes.value.filter((id) => (childIds.get(id)?.length ?? 0) > 0);
		if (next.length !== collapsedNodes.value.length)
			collapsedNodes.value = next;
	});

	/**
	 * 归一链路 + 布局（纯函数，同一份数据 + 同一组选项恒得同一张图）。
	 *
	 * 两级「看不见」按顺序叠：① 区域分组折叠 / 聚焦（§6.11，按 combo 摘）；② 收起下级
	 * （§6.15，按子树摘）。两者的区别只在**几何从哪来**：
	 *
	 * - ① 是「换范围」，几何按剩下的人重新铺（只看一组时这张图就是那一组）；
	 * - ② 是「收起一棵子树」，几何仍然按**收起前**的完整集合算，收起后直接摘掉那些元素 ——
	 *   于是留下节点的坐标逐点不变，层级（第几层、谁在谁上面）也不会因为收起而跳一下。
	 *   旧实现把子树从布局输入里摘掉后整行重排，收起一个叶子会让整张图挪位，看着像「点了另一张图」。
	 *
	 * 链路一律由裁剪逻辑丢掉两端不全的那些，画布不会留悬空边。
	 */
	const layout = computed(() => {
		const base = layoutTopology(nodesAfterCombos.value, topologyLinksOf(graph.value), {
			mode: layoutMode.value,
			rotateDeg: rotationDeg.value
		});

		// 收起下级：几何已经算好，只决定「画哪几个」（`collapsePlan.nodes` 就是留下的人）
		const visible = new Set(collapsePlan.value.nodes.map((node) => node.id));
		if (visible.size === base.nodes.length)
			return base;

		return {
			...base,
			nodes: base.nodes.filter((node) => visible.has(node.id)),
			links: base.links.filter((link) => visible.has(link.source) && visible.has(link.target))
		};
	});

	/**
	 * 区域分组（§6.11）：每个 combo 的标签、计数与**当前在图上的成员数**。
	 *
	 * `members` 取画布真实成员（`node.combo === id`），`children` 是上游自报清单 —— 两者不一致时
	 * 以上游清单为准展示（它是上游的说法），但折叠影响的是画布，所以 `visible` 只数真实成员。
	 */
	const comboGroups = computed(() => {
		const nodes = graph.value?.nodes ?? [];
		return (graph.value?.combos ?? []).map((combo) => {
			const members = nodes.filter((node) => node.combo === combo.id);
			const counts = combo.counts ?? null;
			return {
				id: combo.id,
				label: combo.label?.trim() || combo.id,
				/** 上游自报的组内分层计数（`distro` / `access` / `terminal`），缺省为 `null` */
				counts,
				/** 上游自报的子节点清单长度（没有清单时为 `null`） */
				declared: combo.children?.length ?? null,
				/** 画布上真实的成员数（折叠影响的就是这些） */
				visible: members.length,
				collapsed: collapsedCombos.value.includes(combo.id)
			};
		});
	});

	/** 当前被折叠遮住的节点数（画布角标与分组卡片共用这一个数） */
	const collapsedNodeCount = computed(() => {
		const collapsed = new Set(collapsedCombos.value);
		if (collapsed.size === 0)
			return 0;
		return (graph.value?.nodes ?? []).filter((node) => node.combo && collapsed.has(node.combo)).length;
	});

	/** 折叠 / 展开一个分组：只改视图输入，不动数据、不发请求 */
	function toggleCombo(id: string): void {
		collapsedCombos.value = collapsedCombos.value.includes(id)
			? collapsedCombos.value.filter((item) => item !== id)
			: [...collapsedCombos.value, id];
		// 位移是叠在几何上的增量：成员一变，同组其它节点的带内位置会重排，旧增量一律作废
		// （与切布局同一条理由 —— 留着会既不在几何位、也不在用户放下的位置）。
		nodeOffsets.value = clearNodeOffsets();
	}

	/** 全部展开（「恢复默认配置」之外的独立动作，分组卡片上的那一枚按钮用） */
	function expandAllCombos(): void {
		if (collapsedCombos.value.length === 0)
			return;
		collapsedCombos.value = [];
		nodeOffsets.value = clearNodeOffsets();
	}

	/**
	 * 聚焦 / 取消聚焦一个分组（§6.11）：`null` = 看全部。
	 *
	 * 聚焦前先把该组从折叠集合里摘掉：否则「只看 A 组」+「A 组已收起」= 一张空图，
	 * 而用户点的是「只看这一组」，不是「看零台设备」。
	 */
	function focusCombo(id: string | null): void {
		const next = id && graph.value?.combos?.some((combo) => combo.id === id) ? id : null;
		focusComboId.value = focusComboId.value === next ? null : next;
		if (focusComboId.value && collapsedCombos.value.includes(focusComboId.value))
			collapsedCombos.value = collapsedCombos.value.filter((item) => item !== focusComboId.value);
		// 成员集合变了，位移增量同样作废（与切布局 / 折叠同一条理由）
		nodeOffsets.value = clearNodeOffsets();
	}

	/** 焦点退到「看全部」（页头清除按钮 / 上游已无该分组时自动调用） */
	function clearComboFocus(): void {
		if (!focusComboId.value)
			return;
		focusComboId.value = null;
		nodeOffsets.value = clearNodeOffsets();
	}

	/**
	 * 折叠集合变化即落盘（只变更、不读取；读取在 `onMounted` 里做一次）。
	 * `deep` 不必要：整个数组是替换式赋值，浅比较就够。
	 */
	watch(collapsedCombos, (ids) => {
		writeCollapsedCombos(comboStorage(), ids);
	});

	/** 旋转控件只在径向扇下有意义：其它布局不读这个角度，控件因此不渲染（不是「渲染但禁用」） */
	const canRotate = computed(() => layoutMode.value === "radial");

	/** 切换布局：只改坐标，不改选中与裁剪结果 */
	function setLayoutMode(mode: TopologyLayoutMode): void {
		if (layoutMode.value === mode)
			return;
		layoutMode.value = mode;
		// 位移是「相对**当前**几何」的增量：换一套几何还叠着旧增量，节点会既不在新几何位、
		// 又不在用户当初放下的位置（层级树尤其明显：整行会被推离画布中心）。
		// 所以切布局 = 清位移层（1.0 语义：位移层只叠在预设几何上，引擎布局天然丢弃）。
		nodeOffsets.value = clearNodeOffsets();
	}

	/** 记录单台节点的拖拽落点（画布 `offsetChange` → 这里；容差见 `topologyNodeOffsets`） */
	function moveNode(id: string, offset: NodeOffset): void {
		nodeOffsets.value = setNodeOffset(nodeOffsets.value, id, offset);
	}

	/** 清空位移表（= 「恢复默认配置」的位移部分） */
	function resetNodeOffsets(): void {
		nodeOffsets.value = clearNodeOffsets();
	}

	/** 位移条目数（供「恢复默认配置」的禁用态判定，与 1.0 的 `offsetsChange` 同源语义） */
	const nodeOffsetCount = computed(() => countNodeOffsets(nodeOffsets.value));

	/** 旋转角写入前钳到 [-90, 90]（滑块 / 步进 / 复位共用一条通道） */
	function rotateTo(deg: number): void {
		rotationDeg.value = Math.max(TOPOLOGY_ROTATE_MIN, Math.min(TOPOLOGY_ROTATE_MAX, deg));
	}

	/** ±步进（按钮）：视觉逆时针为正 */
	function nudgeRotation(delta: number): void {
		rotateTo(rotationDeg.value + delta);
	}

	/** 复位回几何库的默认角（1.0 同源常量，页面不写死数字） */
	function resetRotation(): void {
		rotationDeg.value = RADIAL_ROTATE_DEG;
	}

	/** 节点 id → 仿真标记；通道没起来时为空表，画布因此不带虚线外环 */
	const markers = computed<Record<string, SimulatorNodeMarker>>(() => {
		if (simState.value !== "ok")
			return {};

		const index = buildSimulatorIndex(inventory.value);
		const result: Record<string, SimulatorNodeMarker> = {};
		for (const item of layout.value.nodes) {
			const marker = simulatorMarkerOf(item.node, index);
			if (marker)
				result[item.id] = marker;
		}
		return result;
	});

	const running = computed(() => simState.value === "ok" && inventory.value?.running === true);
	const simNodeCount = computed(() => (simState.value === "ok" ? inventory.value?.nodes?.length ?? 0 : 0));
	const simulatedCount = computed(() => Object.keys(markers.value).length);

	/** 写开关（`allowWrite`）：页面唯一的判断来源；读不到能力位一律按「未开启」处理（默认安全） */
	const writeEnabled = computed(() => channel.value?.writeEnabled === true);
	/** 通道可用 + 写开关打开：两个条件缺一按钮就必须 disabled */
	const canWrite = computed(() => simState.value === "ok" && writeEnabled.value);

	// ── 告警叠加（§6.1，2026-11-07 新增） ────────────────────────────────────────
	//
	// 独立通道：告警读不到只摘角标（`alarmState = "error"`），拓扑与仿真照常渲染 —— 告警是叠加层，
	// 不是拓扑的前置数据（把一张画好的图藏起来只因为告警接口 500，是本末倒置）。
	const alarms = ref<AlarmEvent[]>([]);
	const alarmState = ref<AlarmChannelState>("loading");
	/** 告警通道的原始失败原因（上游原话，数据不翻译） */
	const alarmReason = ref<string>("");

	/** 画布节点 id 集合：只有能 join 到图上节点的事件才进角标（`topologyAlarms.ts` 口径 ①） */
	const nodeIdSet = computed(() => new Set((graph.value?.nodes ?? []).map((node) => node.id)));

	/** 角标读数：节点 id → `{ count, severity, events[] }`，画布与详情栏共用 */
	const alarmIndex = computed<TopologyAlarmIndex>(() => alarmIndexOf(alarms.value, nodeIdSet.value));

	/** 图上节点受影响的个数（页头叠加层的读数：N 台设备有告警） */
	const alarmNodeCount = computed(() => Object.keys(alarmIndex.value).length);

	/** 图上 firing 事件总数（`alarmNodeCount` 是设备数，两者不可互相替代） */
	const alarmFiringCount = computed(() => Object.values(alarmIndex.value).reduce((sum, item) => sum + item.count, 0));

	/** 是否存在任何告警读数（页头叠加开关与空态的判定） */
	const hasAlarms = computed(() => alarmFiringCount.value > 0);

	/**
	 * 拉一次 firing 事件（`status=firing` 由**上游**过滤，见 `shared/types/alarm.ts` ①）。
	 *
	 * 失败时**保留上一轮读数**：一次超时不等于告警清零，把角标全抹掉比显示 30s 前的数据更容易误导人。
	 */
	async function loadAlarms(): Promise<void> {
		try {
			const page = await api.get<AlarmEventPage>("/api/alarm/alarm-events", {
				query: { status: "firing", page: 1, page_size: ALARM_PAGE_SIZE }
			});
			alarms.value = normalizeAlarmEvents(page);
			alarmState.value = "ok";
			alarmReason.value = "";
		} catch (error) {
			const { message } = error as Partial<TopologyGraphError>;
			alarmState.value = "error";
			alarmReason.value = message ?? "api_network_error";
		}
	}

	/** 链路 id（图上的 `source→target`）→ 仿真读数；仿真通道没起来时为空表（链路动作按钮因此置灰） */
	const linkMarkers = computed<Map<string, SimulatorLinkMarker>>(() => {
		if (simState.value !== "ok")
			return new Map();
		return buildSimulatorLinkIndex(inventory.value, buildSimulatorIndex(inventory.value));
	});

	/** 选中链路 → 仿真读数（`undefined` = 这条线不在仿真里，动作按钮置灰并说明原因） */
	function simulatorLinkFor(link: { source: string, target: string } | null | undefined): SimulatorLinkMarker | undefined {
		if (!link || linkMarkers.value.size === 0)
			return undefined;
		return simulatorLinkOf(link, buildSimulatorIndex(inventory.value), linkMarkers.value);
	}

	/** 选中节点（画布点击 → 详情栏）：节点本身 + 归一状态 + 仿真标记 */
	const selected = computed(() => {
		if (!selectedId.value)
			return null;

		const item = layout.value.nodes.find((node) => node.id === selectedId.value);
		if (!item)
			return null;

		return {
			id: item.id,
			label: item.label,
			/** 线格式原始节点：详情栏的 CPU / 内存 / 流量等事实由 `nodeFactsOf()` 从这里读 */
			node: item.node,
			ip: topologyNodeIp(item.node),
			tier: item.tier,
			status: normalizeNodeStatus(item.node.status),
			category: item.node.category ?? "",
			marker: markers.value[item.id]
		};
	});

	/**
	 * 默认选中项 = **这张图的根**，右栏因此永远有内容（2026-11-09 用户裁决「打开就选中根节点，详情栏不允许出现空态」）。
	 *
	 * 「根」在两种布局里是同一个概念、两个来源：
	 * ① 层级树里由 `resolveLayeredRanks()` 选举出来的那一台（`role === "root"`，层号被改写为 `ROOT_TIER`）；
	 * ② 顶端带只有一台时选举不触发（`rootId` 为 `null`），此时「根」就是**最上一档** —— 径向扇里它就是
	 *    扇心 / 圆心（`fans[].apexId` 的口径：tier 最小，并列取度数最大、再按 id 断），层级树里就是塔尖。
	 *    只按 `role === "root"` 找会让径向扇退化成「入参第一台」，那台未必在最里圈 —— 选中一台中圈设备
	 *    再说「这是图的开头」就是编事实。
	 *
	 * 为什么要有默认值：右栏是「当前这台设备」的事实面板，空态只是把画布右侧留白 —— 用户看到的是一张图
	 * 配一块空板，还得先猜点哪里。打开即选中根，右栏立刻有内容，画布上也立刻有一台高亮，等于替用户说出
	 * 「先看总出口」这条默认读法。
	 */
	function defaultSelectionId(): string | null {
		const nodes = layout.value.nodes;
		if (nodes.length === 0)
			return null;

		const elected = nodes.find((node) => node.role === "root");
		if (elected)
			return elected.id;

		const topTier = Math.min(...nodes.map((node) => node.tier));
		const degreeOf = (id: string): number =>
			layout.value.links.filter((link) => link.source === id || link.target === id).length;
		const top = nodes
			.filter((node) => node.tier === topTier)
			.sort((a, b) => degreeOf(b.id) - degreeOf(a.id) || a.id.localeCompare(b.id));
		return top[0]?.id ?? nodes[0]?.id ?? null;
	}

	/**
	 * 选中项**恒非空**（有图就有一台）：重复点同一台不再取消选中，传 `null` 落回默认根。
	 *
	 * 「取消选中」在 2026-11-09 被用户砍掉：右栏是设备事实面板，没有「未选中」这种合法状态，
	 * 真正的「换一个对象」是点另一台设备或点一条链路（链路选中在页面层，见 `selectedLinkKey`）。
	 */
	function selectNode(id: string | null): void {
		selectedId.value = id ?? defaultSelectionId();
	}

	/**
	 * 图一变就校正选中项：布局重算后若当前 id 不在画布上（收起把它藏了 / 上游把它删了），
	 * 立刻落回默认根 —— 右栏不能挂着一台画布上不存在的设备，也不能空着。
	 */
	watch(() => layout.value.nodes.map((node) => node.id).join(","), () => {
		if (!selectedId.value || !layout.value.nodes.some((node) => node.id === selectedId.value))
			selectedId.value = defaultSelectionId();
	}, { immediate: true });

	// ── 邻接发现（LLDP，§6.13 取证 / §6.14 落地，2026-11-07） ────────────────────────
	//
	// 只对**仿真中的选中节点**取数：`neighbors/{node_id}` 的 `node_id` 是仿真侧 id（`n1`），画布 id 是管理
	// IP，两者的桥就是 `runtime-inventory` 的 IP 对齐（`selected.marker.simId`）。四种「画不出邻居」必须
	// 分开说，因为它们不是同一件事：通道未配置 / 节点不在仿真里 / 上游明确回空数组 / 请求失败。
	// 前两种属「没有这份数据」，第三种才是「这台设备确实没有邻居」，第四种只能给原因。
	const neighbors = ref<SimulatorLldpNeighbor[]>([]);
	const neighborState = ref<NeighborChannelState>("idle");
	/** 邻居通道的原始失败原因（上游原话，数据不翻译） */
	const neighborReason = ref<string>("");
	/** 请求序号：切换选中节点后旧响应必须丢弃，否则 A 的邻居会画到 B 头上 */
	let neighborSeq = 0;

	/** 邻接读表：保持上游顺序，`canvasId` 非空即「对端在本图上」 */
	const neighborRows = computed<TopologyNeighborRow[]>(() =>
		neighborRowsOf(neighbors.value, inventory.value?.nodes, nodeIdSet.value)
	);

	/** 画布上的对端台数（与总条数分开报，不合并成一个数字） */
	const neighborCanvasNodeCount = computed(() => neighborCanvasCount(neighborRows.value));

	/**
	 * 拉一次选中节点的邻接。`idle` = 没有活可干（未选中 / 该节点不在仿真运行态里）。
	 *
	 * 失败时**清空上一台的邻居**（不像告警那样保留旧读数）：邻接是逐节点的清单，留着上一台的邻居
	 * 会被读成「这台也有这些邻居」，比一行失败原因更容易误导。
	 */
	async function loadNeighbors(): Promise<void> {
		const simId = selected.value?.marker?.simId ?? "";
		neighborSeq += 1;
		const seq = neighborSeq;

		if (!simId) {
			neighbors.value = [];
			neighborState.value = "idle";
			neighborReason.value = "";
			return;
		}

		neighborState.value = "loading";
		try {
			const payload = await api.get<SimulatorLldpNeighbors>(`/api/sim/api/lldp/neighbors/${encodeURIComponent(simId)}`);
			if (seq !== neighborSeq)
				return;
			// 空数组是上游的**真实回答**（没开采集的节点照实回 `[]`，不是 404），照收
			neighbors.value = payload?.neighbors ?? [];
			neighborState.value = "ok";
			neighborReason.value = "";
		} catch (error) {
			if (seq !== neighborSeq)
				return;
			const { message } = error as Partial<TopologyGraphError>;
			neighbors.value = [];
			neighborState.value = "error";
			neighborReason.value = message ?? "api_network_error";
		}
	}

	// 选中变化 / 运行态补齐（仿真标记晚一轮才到）都要重取：`simId` 是唯一触发键
	watch(() => selected.value?.marker?.simId ?? "", () => void loadNeighbors(), { immediate: true });

	/** 主上游：失败进 `graphError`（页面级错误态 + 重试），成功即清空 */
	async function loadGraph(): Promise<void> {
		try {
			// 线格式 → 读模型只在这里做一次（§6.10）：上游是 `{ id, data: { tier, status, … } }` 的
			// 两层形状，不拍平则 `tier` / 名称 / 状态 / 指标全部落空 —— 分层布局会把全部节点排成一条水平线。
			graph.value = normalizeTopologyGraph(await api.get<TopologyGraph>("/api/topology/graph", {
				query: { include_status: true, include_virtual: false }
			}));
			graphError.value = null;
			// 存量折叠集合修剪：上游删掉的分组 id 留在 `localStorage` 里会让「已收起 N 台」对不上
			const pruned = pruneCollapsedCombos(collapsedCombos.value, graph.value.combos);
			if (pruned.length !== collapsedCombos.value.length)
				collapsedCombos.value = pruned;
		} catch (error) {
			const { code, message } = error as Partial<TopologyGraphError>;
			graphError.value = { code: code ?? 0, message: message ?? "api_network_error" };
		}
	}

	/**
	 * 仿真通道：503 `simulator_not_configured` → `disabled`（未配置），其余失败 → `unreachable`。
	 * 两者都不改 `graphError`：主上游结构照常渲染，仿真区块单独降级。
	 */
	async function loadSimulator(): Promise<void> {
		// 能力位与运行态是两条独立请求：能力位读不到只让写入口关闭，不代表运行态也不可用
		try {
			channel.value = await api.get<SimulatorChannelInfo>("/api/sim/channel");
		} catch {
			channel.value = null;
		}

		try {
			inventory.value = await api.get<SimulatorRuntimeInventory>("/api/sim/api/network/runtime-inventory");
			simState.value = "ok";
			simReason.value = "";
		} catch (error) {
			const { code, message } = error as Partial<TopologyGraphError>;
			simReason.value = message ?? "api_network_error";
			simState.value = code === 503 && message === SIMULATOR_MESSAGES.notConfigured ? "disabled" : "unreachable";
			inventory.value = null;
			stats.value = null;
			return;
		}

		// 统计只用于页头徽标：它失败不影响运行态台账，故单独兜住，不把通道判成不可达
		try {
			stats.value = await api.get<SimulatorNetworkStats>("/api/sim/api/network/stats");
		} catch {
			stats.value = null;
		}
	}

	/** 首屏（带骨架）与轮询（不闪骨架）共用；`silent` 为真时不置 `refreshing` */
	async function refresh(options: { silent?: boolean } = {}): Promise<void> {
		if (!options.silent)
			refreshing.value = true;

		// 三条通道并发、互不阻断：告警失败不影响拓扑，仿真失败不影响告警
		await Promise.all([loadGraph(), loadSimulator(), loadAlarms()]);
		lastLoadedAt.value = new Date();
		refreshing.value = false;
	}

	/**
	 * 下发一个节点动作（重启 / 停止）。
	 *
	 * `simId` 必须是对端仿真节点的 id（`marker.simId`），不是 8888 的节点 id：后者是管理 IP，
	 * 用它拼出来的路径在仿真平台上必然 404。`action` 的取值集合 `SIMULATOR_NODE_ACTIONS`
	 * 与白名单条目一一对应，写错会落到白名单 404 而不是静默成功。
	 *
	 * 成功后就地刷新：动作改的是运行态台账，靠轮询等 30s 才看到变化会让人以为「没生效」。
	 */
	async function performNodeAction(action: SimulatorNodeAction, simId: string): Promise<SimulatorActionResult> {
		if (!writeEnabled.value)
			return { ok: false, action, message: SIMULATOR_MESSAGES.writeDisabled };

		if (acting.value)
			return { ok: false, action, message: "simulator_action_in_flight" };

		acting.value = action;
		try {
			await api.post(`/api/sim/api/network/nodes/${encodeURIComponent(simId)}/${action}`);
			await refresh();
			return { ok: true, action, message: "" };
		} catch (error) {
			const { message } = error as Partial<TopologyGraphError>;
			return { ok: false, action, message: message ?? "api_network_error" };
		} finally {
			acting.value = null;
		}
	}

	/**
	 * 下发一个链路动作（up / down / toggle）。
	 *
	 * `simId` 必须是**仿真侧**链路 id（`simulatorLinkFor(link).simId`），不是图上的 `source→target`：
	 * 拓扑图的链路 id 由两端节点 id 拼成，仿真平台不认识；用错 id 只会得到 404。
	 * 成功后与节点动作同源刷新 —— 画布的链路状态来自运行态台账，不刷新看不到变化。
	 */
	async function performLinkAction(action: SimulatorLinkAction, simId: string): Promise<SimulatorActionResult> {
		if (!writeEnabled.value)
			return { ok: false, action, message: SIMULATOR_MESSAGES.writeDisabled };

		if (acting.value)
			return { ok: false, action, message: "simulator_action_in_flight" };

		acting.value = action;
		try {
			await api.post(`/api/sim/api/network/links/${encodeURIComponent(simId)}/${action}`);
			await refresh();
			return { ok: true, action, message: "" };
		} catch (error) {
			const { message } = error as Partial<TopologyGraphError>;
			return { ok: false, action, message: message ?? "api_network_error" };
		} finally {
			acting.value = null;
		}
	}

	function stopPolling(): void {
		if (timer) {
			clearInterval(timer);
			timer = undefined;
		}
	}

	/** 定时刷新；`visibilityState !== "visible"` 时暂停，恢复可见立刻补一次 */
	function startPolling(): void {
		stopPolling();
		timer = setInterval(() => {
			if (document.visibilityState === "visible")
				void refresh({ silent: true });
		}, POLL_INTERVAL_MS);
	}

	function onVisibilityChange(): void {
		if (document.visibilityState === "visible")
			void refresh({ silent: true });
	}

	onMounted(async () => {
		// 折叠状态补水要在首轮图到达**之前**也行、之后也行：修剪在 `loadGraph()` 里做，
		// 先灌进来才能让第一帧就是用户上次的视图。
		collapsedCombos.value = readCollapsedCombos(comboStorage());
		loading.value = true;
		await refresh();
		loading.value = false;
		startPolling();
		document.addEventListener("visibilitychange", onVisibilityChange);
	});

	onBeforeUnmount(() => {
		stopPolling();
		document.removeEventListener("visibilitychange", onVisibilityChange);
	});

	return {
		graph,
		layout,
		/** 2D 布局形态（§6.8）+ 切换入口 */
		layoutMode,
		setLayoutMode,
		/** 径向扇旋转：角度 / 是否可旋转 / 步进 / 复位 */
		rotationDeg,
		canRotate,
		rotateTo,
		nudgeRotation,
		resetRotation,
		/** 节点手动位移层（§6.9）：表 / 记录 / 清空 / 条目数 */
		nodeOffsets,
		moveNode,
		resetNodeOffsets,
		nodeOffsetCount,
		/** 区域分组折叠（§6.11）：分组卡片 / 折叠开关 / 被遮住的节点数 */
		comboGroups,
		collapsedCombos,
		collapsedNodeCount,
		toggleCombo,
		expandAllCombos,
		/** 收起 / 展开下级（§6.15）：被收起的节点 / 每台的下级台数 / 遮住的台数 / 开关 */
		collapsedNodes,
		collapseChildCounts,
		collapsedHiddenCount,
		hasCollapsedNodes,
		toggleCollapse,
		expandAllCollapsed,
		/** 分组聚焦（§6.11「只看这一组」）：当前焦点 / 切换 / 清除 */
		focusedCombo,
		focusCombo,
		clearComboFocus,
		/** 告警叠加（§6.1）：读数表 / 通道状态 / 设备数 / 事件数 / 是否存在 */
		alarms,
		alarmIndex,
		alarmState,
		alarmReason,
		alarmNodeCount,
		alarmFiringCount,
		hasAlarms,
		loadAlarms,
		/** 邻接发现（§6.13 / §6.14）：读表行 / 通道状态 / 原始原因 / 画布对端数 / 重取 */
		neighbors,
		neighborRows,
		neighborState,
		neighborReason,
		neighborCanvasNodeCount,
		loadNeighbors,
		/** 链路 ↔ 仿真对齐：链路读数表 / 单条查询 */
		linkMarkers,
		simulatorLinkFor,
		inventory,
		stats,
		/** 通道能力位（`configured` / `writeEnabled` / `timeoutMs` / `readinessPath`） */
		channel,
		writeEnabled,
		canWrite,
		acting,
		loading,
		refreshing,
		graphError,
		simState,
		simReason,
		markers,
		running,
		simNodeCount,
		simulatedCount,
		selectedId,
		selected,
		lastLoadedAt,
		selectNode,
		refresh,
		/** 下发节点动作（restart / stop）：`simId` 取 `selected.marker.simId` */
		performNodeAction,
		/** 下发链路动作（up / down / toggle）：`simId` 取 `simulatorLinkFor(link).simId` */
		performLinkAction,
		/** 页面开放的链路动作集合（工具栏按它渲染，不在模板里写死） */
		SIMULATOR_LINK_ACTIONS,
		/** 页头展示用计数（空图时都是 0，页面据此走空态） */
		nodeCount: computed(() => graph.value?.nodes?.length ?? 0),
		linkCount: computed(() => topologyLinksOf(graph.value).length),
		comboCount: computed(() => graph.value?.combos?.length ?? 0)
	};
}
