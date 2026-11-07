// layers/topology/app/composables/useTopologyMonitor.ts
// `/topology/monitor` 的取数内核（NMCPS-DESIGN-001 §6.1 / §6.2 / §6.4）：
//   · 8888 主数据源：`GET /api/topology/graph`（拓扑结构，缺失即错误态 + 重试）；
//   · 8001 第二数据源：`GET /api/sim/api/network/runtime-inventory` 与 `/stats`（仿真运行态，
//     可选通道：未配置 / 不可达只降级仿真区块，**不**把整页变成错误）。
//
// 两路数据的失败语义刻意不同：主上游失败 → 页面级错误；仿真通道失败 → 只读降级 + 一行说明
// （DESIGN-001 §八「不允许把可选上游的抖动升级成整页错误」）。
import type { SimulatorNodeMarker } from "~~/app/utils/graph/simulatorOverlay";
import type { TopologyLayoutMode } from "~~/app/utils/graph/topologyLayout";
import type { NodeOffset, NodeOffsetMap } from "~~/app/utils/graph/topologyNodeOffsets";
import type { SimulatorChannelInfo, SimulatorNetworkStats, SimulatorRuntimeInventory } from "~~/shared/types/simulator";
import type { TopologyGraph } from "~~/shared/types/topology";
import { buildSimulatorIndex, simulatorMarkerOf } from "~~/app/utils/graph/simulatorOverlay";
import { layoutTopology, RADIAL_ROTATE_DEG, TOPOLOGY_ROTATE_MAX, TOPOLOGY_ROTATE_MIN } from "~~/app/utils/graph/topologyLayout";
import { clearNodeOffsets, countNodeOffsets, setNodeOffset } from "~~/app/utils/graph/topologyNodeOffsets";
import { normalizeNodeStatus, normalizeTopologyGraph, topologyLinksOf, topologyNodeIp } from "~~/app/utils/graph/topologyNormalize";
import { SIMULATOR_MESSAGES } from "~~/shared/constants/upstreamReasons";

/** 仿真通道三态 + loading：`disabled` 是「未配置」，不是错误 */
export type SimulatorChannelState = "loading" | "disabled" | "unreachable" | "ok";

/** 页面开放的节点动作（NMCPS-DESIGN-001 §6.2 写入口范围表；端点由 `SIMULATOR_ROUTES` 白名单兜底） */
export const SIMULATOR_NODE_ACTIONS = ["restart", "stop"] as const;
export type SimulatorNodeAction = (typeof SIMULATOR_NODE_ACTIONS)[number];

/** 动作结果：失败时 `message` 是 BFF/上游原话（数据，不翻译），由页面决定提示口径 */
export interface SimulatorActionResult {
	ok: boolean
	action: SimulatorNodeAction
	/** 失败原因（成功时为空串） */
	message: string
}

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
	/** 正在下发的动作（按钮 `loading` 与重复提交的门闩） */
	const acting = ref<SimulatorNodeAction | null>(null);
	/** 2D 布局形态（§6.8）：默认分层网格，与 1.0 的默认 radial 不同 —— 2.0 的径向扇是可选视图 */
	const layoutMode = ref<TopologyLayoutMode>("layered");
	/** 径向扇整体旋转（度，视觉逆时针为正；仅 `radial` 布局读取） */
	const rotationDeg = ref<number>(RADIAL_ROTATE_DEG);
	/**
	 * 节点手动位移（§6.9，1.0 v0.36 用户规格）：**独立增量层**，几何坐标仍由 `layoutTopology()` 唯一产生。
	 * 放在这里而不是画布组件里，是因为「恢复默认配置」要知道有没有可复位的位移，
	 * 而且它必须与旋转角 / 视口同源受 `useTopologyMonitor()` 管理。
	 */
	const nodeOffsets = ref<NodeOffsetMap>(clearNodeOffsets());

	let timer: ReturnType<typeof setInterval> | undefined;

	/** 归一链路 + 布局（纯函数，同一份数据 + 同一组选项恒得同一张图） */
	const layout = computed(() => layoutTopology(
		graph.value?.nodes ?? [],
		topologyLinksOf(graph.value),
		{ mode: layoutMode.value, rotateDeg: rotationDeg.value }
	));

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

	function selectNode(id: string | null): void {
		selectedId.value = id && id !== selectedId.value ? id : null;
	}

	/** 主上游：失败进 `graphError`（页面级错误态 + 重试），成功即清空 */
	async function loadGraph(): Promise<void> {
		try {
			// 线格式 → 读模型只在这里做一次（§6.10）：上游是 `{ id, data: { tier, status, … } }` 的
			// 两层形状，不拍平则 `tier` / 名称 / 状态 / 指标全部落空 —— 分层布局会把全部节点排成一条水平线。
			graph.value = normalizeTopologyGraph(await api.get<TopologyGraph>("/api/topology/graph", {
				query: { include_status: true, include_virtual: false }
			}));
			graphError.value = null;
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

		await Promise.all([loadGraph(), loadSimulator()]);
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
		/** 页头展示用计数（空图时都是 0，页面据此走空态） */
		nodeCount: computed(() => graph.value?.nodes?.length ?? 0),
		linkCount: computed(() => topologyLinksOf(graph.value).length),
		comboCount: computed(() => graph.value?.combos?.length ?? 0)
	};
}
