<template>
	<!--
		`TopologyCanvas`（文件 `app/components/Graph/TopologyCanvas.vue`，自动导入名 `GraphTopologyCanvas`）。
		设计基准：NMCPS-DESIGN-001 §七、NMCPS-ADR-0019 D1 —— SVG 自绘 + 纯函数注入布局，
		本组件不取数、不轮询、不自起 rAF；拖拽 / 缩放来自 `useGraphInteraction()`，
		节点手动位移只做「几何 + 增量」合成，位移表的读写权在页面（§6.9）。
	-->
	<div class="relative h-full min-h-0 w-full">
		<svg
			ref="svg"
			data-testid="topology-canvas"
			:viewBox="`0 0 ${width} ${height}`"
			class="h-full w-full cursor-grab touch-none select-none"
			:class="dragging ? 'cursor-grabbing' : ''"
			role="img"
			:aria-label="label"
			@wheel="onWheel"
			@pointerdown="onPointerDown"
			@pointermove="onPointerMove"
			@pointerup="onPointerUp"
			@pointercancel="onPointerUp"
			@pointerleave="onPointerUp"
		>
			<g :transform="transform">
				<!-- 链路先画：节点永远盖在线上，避免端点被截断 -->
				<!--
					链路可点：点中后页面在详情栏展示该链路的事实（`linkFactsOf()`，§6.11）。
					`<title>` 是给鼠标悬停的原生提示 —— SVG 自带的无障碍语义，不加浮层、不加弹出库。
				-->
				<path
					v-for="(link, index) in links"
					:key="`${link.source}-${link.target}-${index}`"
					data-testid="topology-link"
					:data-link-key="topologyLinkKey(link, index)"
					:d="linkPath(link)"
					fill="none"
					stroke-width="1.5"
					stroke-linecap="round"
					:class="[
						linkStrokeClass(normalizeLinkStatus(link.status)),
						selectedLinkKey && selectedLinkKey === topologyLinkKey(link, index) ? 'stroke-(--ui-primary)' : '',
					]"
					@pointerdown.stop
					@click.stop="emit('selectLink', topologyLinkKey(link, index))"
				>
					<title v-if="linkTitle?.(link)">{{ linkTitle(link) }}</title>
				</path>

				<g
					v-for="item in viewNodes"
					:key="item.id"
					data-testid="topology-node"
					:data-node-id="item.id"
					class="cursor-pointer outline-none"
					:class="draggingId === item.id ? 'cursor-grabbing' : ''"
					role="button"
					tabindex="0"
					:aria-label="nodeAriaLabel(item)"
					@click.stop="emit('select', item.id)"
					@keydown.enter.prevent="emit('select', item.id)"
					@keydown.space.prevent="emit('select', item.id)"
					@pointerdown.stop="onNodePointerDown($event, item.id)"
					@pointermove.stop="onNodePointerMove"
					@pointerup.stop="onNodePointerUp"
					@pointercancel.stop="onNodePointerUp"
				>
					<!-- 仿真标记：虚线外环，不改节点自身的状态色（现网状态与仿真状态是两件事） -->
					<circle
						v-if="markers?.[item.id]"
						:cx="item.x"
						:cy="item.y"
						r="20"
						fill="none"
						stroke-width="1.5"
						stroke-dasharray="4 3"
						class="stroke-(--ui-info)"
					/>
					<circle
						:cx="item.x"
						:cy="item.y"
						r="13"
						stroke-width="2"
						:class="[
							nodeFillClass(normalizeNodeStatus(item.node.status)),
							selectedId === item.id ? 'stroke-(--ui-primary)' : 'stroke-(--ui-bg)/80',
						]"
					/>
					<text
						:x="item.x"
						:y="item.y + 30"
						text-anchor="middle"
						class="fill-(--ui-text-muted) text-[11px]"
					>
						{{ item.label }}
					</text>
				</g>
			</g>
		</svg>

		<!-- 视口控制：键盘与无滚轮设备可达，数值同时也是一处可读的当前缩放 -->
		<div class="absolute right-2 bottom-2 flex items-center gap-1">
			<UButton
				data-testid="topology-zoom-out"
				size="xs"
				color="neutral"
				variant="subtle"
				icon="carbon:subtract"
				:aria-label="$t('pages.topology-monitor.zoomOut')"
				@click="zoomOut"
			/>
			<UBadge data-testid="topology-zoom" size="sm" variant="subtle" color="neutral">
				{{ zoomPercent }}%
			</UBadge>
			<UButton
				data-testid="topology-zoom-in"
				size="xs"
				color="neutral"
				variant="subtle"
				icon="carbon:add"
				:aria-label="$t('pages.topology-monitor.zoomIn')"
				@click="zoomIn"
			/>
			<UButton
				data-testid="topology-zoom-reset"
				size="xs"
				color="neutral"
				variant="subtle"
				icon="carbon:reset"
				:aria-label="$t('pages.topology-monitor.zoomReset')"
				@click="reset"
			/>
		</div>
	</div>
</template>

<script setup lang="ts">
	import type { SimulatorNodeMarker } from "~~/app/utils/graph/simulatorOverlay";
	import type { PositionedTopologyNode } from "~~/app/utils/graph/topologyLayout";
	import type { NodeOffset, NodeOffsetMap, Point2D } from "~~/app/utils/graph/topologyNodeOffsets";
	import type { TopologyGraphLink } from "~~/shared/types/topology";
	import { applyNodeOffsets } from "~~/app/utils/graph/topologyNodeOffsets";
	import { normalizeLinkStatus, normalizeNodeStatus, topologyLinkKey } from "~~/app/utils/graph/topologyNormalize";
	import { linkStrokeClass, nodeFillClass } from "~~/app/utils/graph/topologyStatusStyle";

	const props = defineProps<{
		nodes: PositionedTopologyNode[]
		links: TopologyGraphLink[]
		width: number
		height: number
		selectedId?: string | null
		/** 选中链路的 key（`topologyLinkKey()`）：页面据此高亮，跨轮询按 key 认人 */
		selectedLinkKey?: string | null
		/** 链路悬停提示文本（页面按 `linkFactsOf()` 拼，画布只管渲染成 SVG `<title>`） */
		linkTitle?: (link: TopologyGraphLink) => string
		/** 节点 id → 仿真标记（8001 运行态对齐结果） */
		markers?: Record<string, SimulatorNodeMarker>
		/** 节点手动位移层（§6.9）：几何坐标 + 增量 = 最终落点，本组件只合成、不改表 */
		offsets?: NodeOffsetMap
		/** 无障碍名称（`<svg>` 的 `aria-label`）：屏幕阅读器念的就是这一句 */
		label: string
	}>();

	const emit = defineEmits<{
		select: [id: string]
		/** 点中一条链路（§6.11）：页面在详情栏展示该链路事实 */
		selectLink: [key: string]
		/** 拖拽结束：`offset` 是**累计**增量（相对几何坐标），页面交给 `setNodeOffset()` 去重 / 落表 */
		offsetChange: [id: string, offset: NodeOffset]
		/** 视口是否已偏离初始状态（缩放 / 平移）：「恢复默认配置」的禁用态要诚实反映它 */
		viewportChange: [dirty: boolean]
	}>();

	const {
		scale,
		offsetX,
		offsetY,
		dragging,
		transform,
		zoomPercent,
		zoomIn,
		zoomOut,
		reset,
		onWheel,
		onPointerDown,
		onPointerMove,
		onPointerUp
	} = useGraphInteraction();

	const { t } = useI18n();

	const svg = ref<SVGSVGElement | null>(null);

	/**
	 * 进行中的节点拖拽（`null` = 没在拖）。
	 * 起点与基准都按 **viewBox 用户单位**记：位移层与几何坐标同口径，缩放 / 平移不会把增量算歪。
	 */
	const drag = ref<{ id: string, pointerId: number, start: Point2D, base: NodeOffset } | null>(null);
	/** 拖拽中的实时增量（松手前不改位移表：页面只收到一次 `offsetChange`） */
	const liveOffset = ref<{ id: string, offset: NodeOffset } | null>(null);

	const draggingId = computed(() => (drag.value && liveOffset.value ? drag.value.id : null));

	/** 位移表 ∪ 拖拽中的实时增量（后者覆盖前者） */
	const effectiveOffsets = computed<NodeOffsetMap>(() => {
		const live = liveOffset.value;
		if (!live)
			return props.offsets ?? {};
		return { ...(props.offsets ?? {}), [live.id]: live.offset };
	});

	/** 渲染真值：几何坐标 + 位移增量（链路端点也读这张表，所以连线自动跟着节点走） */
	const viewNodes = computed(() => applyNodeOffsets(props.nodes, effectiveOffsets.value));

	/** id → 坐标，链路端点查表；两端任一缺失时不画（裁剪后残留的悬空边） */
	const points = computed(() => {
		const map = new Map<string, PositionedTopologyNode>();
		for (const item of viewNodes.value)
			map.set(item.id, item);
		return map;
	});

	/** 屏幕坐标 → viewBox 用户单位：`getScreenCTM()` 只含 `viewBox` 映射，不含 `<g>` 的缩放平移 */
	function toUserPoint(event: PointerEvent): Point2D {
		const element = svg.value;
		const ctm = element?.getScreenCTM();
		if (!element || !ctm)
			return { x: event.clientX, y: event.clientY };
		const point = element.createSVGPoint();
		point.x = event.clientX;
		point.y = event.clientY;
		const mapped = point.matrixTransform(ctm.inverse());
		return { x: mapped.x, y: mapped.y };
	}

	/**
	 * 节点按下：**抢在 `<svg>` 的平移之前**接管（模板里 `.stop`），并记住该节点已有的位移。
	 * 不接管的话拖节点会变成拖画布 —— 位移层永远收不到落点。
	 */
	function onNodePointerDown(event: PointerEvent, id: string): void {
		if (event.button !== 0)
			return;
		drag.value = {
			id,
			pointerId: event.pointerId,
			start: toUserPoint(event),
			base: props.offsets?.[id] ?? { dx: 0, dy: 0 }
		};
		(event.currentTarget as Element | null)?.setPointerCapture?.(event.pointerId);
	}

	function onNodePointerMove(event: PointerEvent): void {
		const state = drag.value;
		if (!state || state.pointerId !== event.pointerId)
			return;
		const current = toUserPoint(event);
		liveOffset.value = {
			id: state.id,
			offset: { dx: state.base.dx + current.x - state.start.x, dy: state.base.dy + current.y - state.start.y }
		};
	}

	function onNodePointerUp(event: PointerEvent): void {
		const state = drag.value;
		if (!state || state.pointerId !== event.pointerId)
			return;
		(event.currentTarget as Element | null)?.releasePointerCapture?.(event.pointerId);
		const offset = liveOffset.value?.offset;
		drag.value = null;
		liveOffset.value = null;
		// 抖动容差由 `setNodeOffset()` 兜底（几乎没动 ⇒ 等同删除该条目）
		if (offset)
			emit("offsetChange", state.id, offset);
	}

	/** 视口偏离初始状态（缩放 ≠ 100% 或平移 ≠ 0）：页面据此点亮「恢复默认配置」 */
	const viewportDirty = computed(() => scale.value !== 1 || offsetX.value !== 0 || offsetY.value !== 0);
	watch(viewportDirty, (dirty) => emit("viewportChange", dirty));

	/** 视口复位（「恢复默认配置」的第三部分；位移 / 旋转角在页面层清） */
	defineExpose({ resetViewport: reset });

	/** 三次贝塞尔：同层水平直连，跨层加一段弧，避免多条线重叠成一条 */
	function linkPath(link: TopologyGraphLink): string {
		const from = points.value.get(link.source);
		const to = points.value.get(link.target);
		if (!from || !to)
			return "";
		if (from.y === to.y)
			return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
		const midX = (from.x + to.x) / 2;
		return `M ${from.x} ${from.y} C ${midX} ${from.y} ${midX} ${to.y} ${to.x} ${to.y}`;
	}

	function nodeAriaLabel(item: PositionedTopologyNode): string {
		const status = normalizeNodeStatus(item.node.status);
		return `${item.label} · ${t(`pages.topology-monitor.status.${status}`)}`;
	}
</script>
