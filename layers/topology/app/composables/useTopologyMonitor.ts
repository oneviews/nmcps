// layers/topology/app/composables/useTopologyMonitor.ts
// `/topology/monitor` 的取数内核（NMCPS-DESIGN-001 §6.1 / §6.2 / §6.4）：
//   · 8888 主数据源：`GET /api/topology/graph`（拓扑结构，缺失即错误态 + 重试）；
//   · 8001 第二数据源：`GET /api/sim/api/network/runtime-inventory` 与 `/stats`（仿真运行态，
//     可选通道：未配置 / 不可达只降级仿真区块，**不**把整页变成错误）。
//
// 两路数据的失败语义刻意不同：主上游失败 → 页面级错误；仿真通道失败 → 只读降级 + 一行说明
// （DESIGN-001 §八「不允许把可选上游的抖动升级成整页错误」）。
import type { SimulatorNodeMarker } from "~~/app/utils/graph/simulatorOverlay";
import type { SimulatorNetworkStats, SimulatorRuntimeInventory } from "~~/shared/types/simulator";
import type { TopologyGraph } from "~~/shared/types/topology";
import { buildSimulatorIndex, simulatorMarkerOf } from "~~/app/utils/graph/simulatorOverlay";
import { layoutTopology } from "~~/app/utils/graph/topologyLayout";
import { normalizeNodeStatus, topologyLinksOf, topologyNodeIp } from "~~/app/utils/graph/topologyNormalize";
import { SIMULATOR_MESSAGES } from "~~/shared/constants/upstreamReasons";

/** 仿真通道三态 + loading：`disabled` 是「未配置」，不是错误 */
export type SimulatorChannelState = "loading" | "disabled" | "unreachable" | "ok";

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
	const loading = ref(false);
	const refreshing = ref(false);
	const graphError = ref<TopologyGraphError | null>(null);
	const simState = ref<SimulatorChannelState>("loading");
	/** 仿真通道的原始原因（`simulator_not_configured` / `simulator_unreachable`…） */
	const simReason = ref<string>("");
	const selectedId = ref<string | null>(null);
	const lastLoadedAt = ref<Date | null>(null);

	let timer: ReturnType<typeof setInterval> | undefined;

	/** 归一链路 + 布局（纯函数，同一份数据恒得同一张图） */
	const layout = computed(() => layoutTopology(graph.value?.nodes ?? [], topologyLinksOf(graph.value)));

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
			graph.value = await api.get<TopologyGraph>("/api/topology/graph", {
				query: { include_status: true, include_virtual: false }
			});
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
		inventory,
		stats,
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
		/** 页头展示用计数（空图时都是 0，页面据此走空态） */
		nodeCount: computed(() => graph.value?.nodes?.length ?? 0),
		linkCount: computed(() => topologyLinksOf(graph.value).length),
		comboCount: computed(() => graph.value?.combos?.length ?? 0)
	};
}
