<template>
	<!--
		`TopologyCanvas`（文件 `app/components/Graph/TopologyCanvas.vue`，自动导入名 `GraphTopologyCanvas`）。
		设计基准：NMCPS-DESIGN-001 §七、NMCPS-ADR-0019 D1 —— SVG 自绘 + 纯函数注入布局，
		本组件不取数、不轮询、不自起 rAF；拖拽 / 缩放来自 `useGraphInteraction()`。
	-->
	<div class="relative h-full min-h-0 w-full">
		<svg
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
				<path
					v-for="(link, index) in links"
					:key="`${link.source}-${link.target}-${index}`"
					data-testid="topology-link"
					:d="linkPath(link)"
					fill="none"
					stroke-width="1.5"
					stroke-linecap="round"
					:class="linkStrokeClass(normalizeLinkStatus(link.status))"
				/>

				<g
					v-for="item in nodes"
					:key="item.id"
					data-testid="topology-node"
					class="cursor-pointer outline-none"
					role="button"
					tabindex="0"
					:aria-label="nodeAriaLabel(item)"
					@click.stop="emit('select', item.id)"
					@keydown.enter.prevent="emit('select', item.id)"
					@keydown.space.prevent="emit('select', item.id)"
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
				size="xs"
				color="neutral"
				variant="subtle"
				icon="carbon:subtract"
				:aria-label="$t('pages.topology-monitor.zoomOut')"
				@click="zoomOut"
			/>
			<UBadge size="sm" variant="subtle" color="neutral">
				{{ zoomPercent }}%
			</UBadge>
			<UButton
				size="xs"
				color="neutral"
				variant="subtle"
				icon="carbon:add"
				:aria-label="$t('pages.topology-monitor.zoomIn')"
				@click="zoomIn"
			/>
			<UButton
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
	import type { TopologyGraphLink } from "~~/shared/types/topology";
	import { normalizeLinkStatus, normalizeNodeStatus } from "~~/app/utils/graph/topologyNormalize";
	import { linkStrokeClass, nodeFillClass } from "~~/app/utils/graph/topologyStatusStyle";

	const props = defineProps<{
		nodes: PositionedTopologyNode[]
		links: TopologyGraphLink[]
		width: number
		height: number
		selectedId?: string | null
		/** 节点 id → 仿真标记（8001 运行态对齐结果） */
		markers?: Record<string, SimulatorNodeMarker>
		/** 无障碍名称（`<svg>` 的 `aria-label`）：屏幕阅读器念的就是这一句 */
		label: string
	}>();

	const emit = defineEmits<{ select: [id: string] }>();

	const {
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

	/** id → 坐标，链路端点查表；两端任一缺失时不画（裁剪后残留的悬空边） */
	const points = computed(() => {
		const map = new Map<string, PositionedTopologyNode>();
		for (const item of props.nodes)
			map.set(item.id, item);
		return map;
	});

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
