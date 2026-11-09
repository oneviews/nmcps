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
					每条线画三层：一条**外延环**（只在强调 / 聚焦时出现，与本体同一个 `d`）、一条
					看得见的线、一条 14px 的**透明命中区**（1.5px 的细线不可能点得准）。
					可见那层才是 `topology-link`：粗细读带宽、虚线读介质与状态、强调只加外延，本体不动
					（口径全在 `app/utils/graph/topologyLinkStyle.ts`，本组件只上样式）。
				-->
				<g v-for="(link, index) in links" :key="`${link.source}-${link.target}-${index}`">
					<!--
						强调的外延环：与本体**同一个 `d`**，只是更宽 + 低不透明度
						（§6.15.2 第 2 条「选中只加外延、不加粗」）。画在本体下面，本体那一条因此
						永远清晰；不透明度压在画布底色上，「同色相、低饱和」是叠出来的，不新增色相。
						与选中设备直连的那几条（`incident`）改用**选中设备的层色**：这一圈就是
						「为什么这条线亮着」的答案，颜色去认它亮的是谁（2026-11-09 用户裁决）；
						本体仍是一支灰 —— 颜色只出现在叠出来的那一层，连接关系的色义不受影响。
						键盘焦点也走这一圈（`focus` 档），焦点环保持灰：焦点说的是「光标在这」，
						与「连着哪台设备」是两件事。
					-->
					<path
						v-if="linkHaloLevelOf(link, index) !== 'none'"
						data-testid="topology-link-halo"
						:data-link-halo-emphasis="linkHaloLevelOf(link, index)"
						:data-link-halo-tint="linkHaloTintOf(link, index)"
						:d="linkPath(link)"
						fill="none"
						:stroke-width="linkHaloWidthOf(link, haloStyleOf(linkHaloLevelOf(link, index)))"
						:stroke-opacity="linkHaloOpacityOf(haloStyleOf(linkHaloLevelOf(link, index)))"
						:stroke-dasharray="linkDashPatternOf(link)"
						stroke-linecap="round"
						:class="linkHaloClass(link, index)"
					/>
					<path
						data-testid="topology-link"
						:data-link-key="topologyLinkKey(link, index)"
						:data-link-emphasized="linkEmphasisOf(link, index) !== 'none'"
						:data-link-emphasis="linkEmphasisOf(link, index)"
						:d="linkPath(link)"
						fill="none"
						:stroke-width="linkStrokeWidthOf(link)"
						stroke-linecap="round"
						:stroke-dasharray="linkDashPatternOf(link)"
						:class="linkBodyClass(link, index)"
						@pointerdown.stop
						@click.stop="emit('selectLink', topologyLinkKey(link, index))"
					>
						<title v-if="linkTitle?.(link)">{{ linkTitle(link) }}</title>
					</path>
					<!--
						命中区：14px 宽的透明描边，鼠标好点。连线也是**可聚焦控件**（2026-11-08 要求 B）
						—— 与节点同一套键盘口径：`role="button"` + `Enter` / `Space` 选中，
						`aria-pressed` 报选中态，`focus` / `blur` 驱动上面那圈外延环当焦点指示。
					-->
					<path
						data-testid="topology-link-hit"
						:data-link-hit-key="topologyLinkKey(link, index)"
						:d="linkPath(link)"
						fill="none"
						stroke="transparent"
						stroke-width="14"
						stroke-linecap="round"
						class="cursor-pointer outline-none"
						role="button"
						tabindex="0"
						:aria-label="linkAriaLabel(link)"
						:aria-pressed="linkEmphasisOf(link, index) === 'selected'"
						@focus="focusedLinkKey = topologyLinkKey(link, index)"
						@blur="clearFocus(topologyLinkKey(link, index))"
						@keydown.enter.prevent="emit('selectLink', topologyLinkKey(link, index))"
						@keydown.space.prevent="emit('selectLink', topologyLinkKey(link, index))"
						@pointerdown.stop
						@click.stop="emit('selectLink', topologyLinkKey(link, index))"
					/>
				</g>

				<g
					v-for="item in viewNodes"
					:key="item.id"
					data-testid="topology-node"
					:data-node-id="item.id"
					:data-node-emphasized="emphasizedNode(item.id)"
					class="cursor-pointer outline-none"
					:class="draggingId === item.id ? 'cursor-grabbing' : ''"
					role="button"
					tabindex="0"
					:aria-label="nodeAriaLabel(item)"
					@click.stop="emit('select', item.id)"
					@dblclick.stop="toggleCollapseOf(item.id)"
					@keydown.enter.prevent="emit('select', item.id)"
					@keydown.space.prevent="emit('select', item.id)"
					@pointerdown.stop="onNodePointerDown($event, item.id)"
					@pointermove.stop="onNodePointerMove"
					@pointerup.stop="onNodePointerUp"
					@pointercancel.stop="onNodePointerUp"
				>
					<!--
						仿真标记：虚线外环（半径随节点半径放大），不改节点的层色与状态圆点
						（现网状态与仿真状态是两件事）。
					-->
					<circle
						v-if="markers?.[item.id]"
						:cx="item.x"
						:cy="item.y"
						:r="nodeRadius(item) + 7"
						fill="none"
						stroke-width="1.5"
						stroke-dasharray="4 3"
						class="stroke-(--ui-info)"
					/>
					<!--
						节点本体（复刻 1.0 的视觉语言，§七）：
						· 外圈**恒为层色**（边界红 / 核心品红 / 汇聚橙 / 接入蓝 / 终端绿）+ 极淡中性填充；
						· 状态语义**只由中心圆点承载** —— 状态改的只是圆点颜色，不改外圈；
						· 半径随角色递减（核心最大、终端最小），一处定义在 `topologyRoleStyle.ts`；
						· **选中只加粗外圈（2 → 3），绝不换色**（2026-11-09 用户裁决）：换色会让
						「外圈色 = 层级」失效，而粗细在节点上只有这一处用处（全图恒 2，没有第二层语义），
						加粗不抢占任何读数 —— 与连线「粗细读带宽」的取舍不同。
						旧实现把「状态色」填满整个圆：36 台设备全绿，层级完全看不出来（1.0 的
						用户裁决是「不要改变外圈颜色」）。
					-->
					<!--
						外延环：与本体**同一支层色**，靠低不透明度压在画布底色上得到「同色相、低饱和」的一圈。
						选中一档（半径 +2 / 环宽 4px / 50%）贴在圆边上说清「点中的是哪一台」，一跳邻居一档
						（半径 +3 / 环宽 2px / 22%）只是轻声提示；选中档的环是**紧贴**而不是外扩一圈，
						因为它作用在「更粗的本体环」外面，再散开就成了两圈互不相干的圆。
					-->
					<circle
						v-if="nodeHaloLevelOf(item) !== 'none'"
						data-testid="topology-node-halo"
						:data-halo-emphasis="nodeHaloLevelOf(item)"
						:cx="item.x"
						:cy="item.y"
						:r="nodeRadius(item) + nodeHaloGap(item)"
						fill="none"
						:stroke-width="nodeHaloWidth(item)"
						:stroke-opacity="nodeHaloOpacity(item)"
						:class="roleStrokeClass(item.role)"
					/>
					<circle
						data-testid="topology-node-shape"
						:data-node-role="item.role"
						:data-node-tier="item.tier"
						:cx="item.x"
						:cy="item.y"
						:r="nodeRadius(item)"
						:stroke-width="nodeStrokeWidth(item)"
						class="fill-(--ui-bg-elevated)"
						:class="roleStrokeClass(item.role)"
					/>
					<!-- 中心状态圆点：状态语义的唯一载体（1.0 `statusDotNode`，§七） -->
					<circle
						data-testid="topology-node-dot"
						:data-node-status="normalizeNodeStatus(item.node.status)"
						:cx="item.x"
						:cy="item.y"
						:r="statusDotRadius(item.role)"
						class="stroke-none"
						:class="nodeFillClass(normalizeNodeStatus(item.node.status))"
					/>
					<!--
						名称标签（§七）：满行时布局层已算好「错行」计划（`labelShift`），画布只按计划落位。
						位置 = **节点 + 布局给的单位方向 × (半径 + 间距 + 错行档高)**，字号 10px、居中锚点 ——
						每一台的标签都与自己的圆保持同一个间距（径向扇里朝背离圆心的一侧，层级树里朝下方），
						不会落到相邻节点身上（方向由 `topologyLayout.ts` 的 `labelDirDx/Dy` 给出）。
						文本恒为全名 —— **不截断、不出省略号**（2026-11-09 用户裁决：半截名字认错设备），
						所以也不需要 `<title>` 再补一份全名；全名在 `aria-label` 里。
					-->
					<text
						v-if="labelsVisible"
						data-testid="topology-node-label"
						:data-label-shift="item.labelShift"
						:data-label-dir="`${item.labelDirDx},${item.labelDirDy}`"
						:x="labelAnchor(item).x"
						:y="labelAnchor(item).y"
						text-anchor="middle"
						dominant-baseline="middle"
						class="fill-(--ui-text-muted) text-[10px]"
					>
						{{ item.label }}
					</text>

					<!--
						告警角标（§6.1）：firing 事件数 + 最高严重度色。只在能 join 到本节点时出现
						（`alarmIndexOf()` 已按画布节点 id 过滤，这里不再判断 target_type）。
					-->
					<g v-if="alarmOf(item)" data-testid="topology-node-alarm" :data-alarm-count="alarmOf(item)?.count">
						<circle
							:cx="item.x + alarmOffset(item)"
							:cy="item.y - alarmOffset(item)"
							r="6.5"
							stroke-width="1.5"
							class="stroke-(--ui-bg)"
							:class="alarmOf(item)?.fillClass"
						/>
						<text
							:x="item.x + alarmOffset(item)"
							:y="item.y - alarmOffset(item) + 3"
							text-anchor="middle"
							class="fill-(--ui-bg) text-[8px] font-semibold"
						>
							{{ alarmBadgeText(alarmOf(item)?.count ?? 0) }}
						</text>
					</g>

					<!--
						收起 / 展开下级（§6.15，G6 v5 `collapse-expand` 实际案例的等价实现）：
						· 只有**确实有下级**的节点才有这枚角标（`childCounts[id] > 0`）；
						· 展开态画「-」（可收起），收起态画「+N」（N = 收起后被遮住的台数，含传递），与 G6 案例里 `collapsed: true` 的元素仍留在图上的语义一致；
						· 角标可点、可 `Enter`，双击节点是同一个动作（G6 的默认触发就是双击）。
					-->
					<g
						v-if="childCountOf(item.id) > 0"
						data-testid="topology-node-collapse"
						:data-node-id="item.id"
						:data-collapsed="isCollapsed(item.id)"
						:data-hidden-count="childCountOf(item.id)"
						role="button"
						tabindex="0"
						class="cursor-pointer"
						:aria-label="collapseLabelOf(item.id)"
						@click.stop="emit('toggleCollapse', item.id)"
						@keydown.enter.prevent.stop="emit('toggleCollapse', item.id)"
						@keydown.space.prevent.stop="emit('toggleCollapse', item.id)"
						@pointerdown.stop
						@dblclick.stop
					>
						<circle
							:cx="item.x - alarmOffset(item)"
							:cy="item.y + alarmOffset(item)"
							r="6.5"
							stroke-width="1.5"
							class="fill-(--ui-bg-elevated) stroke-(--ui-text-muted)"
						/>
						<text
							:x="item.x - alarmOffset(item)"
							:y="item.y + alarmOffset(item) + 3"
							text-anchor="middle"
							class="fill-(--ui-text) text-[8px] font-semibold"
						>
							{{ isCollapsed(item.id) ? `+${childCountOf(item.id)}` : "-" }}
						</text>
					</g>
				</g>
			</g>
		</svg>
	</div>
</template>

<script setup lang="ts">
	import type { SimulatorNodeMarker } from "~~/app/utils/graph/simulatorOverlay";
	import type { TopologyAlarmIndex } from "~~/app/utils/graph/topologyAlarms";
	import type { PositionedTopologyNode } from "~~/app/utils/graph/topologyLayout";
	import type { LinkEmphasis } from "~~/app/utils/graph/topologyLinkStyle";
	import type { NodeOffset, NodeOffsetMap, Point2D } from "~~/app/utils/graph/topologyNodeOffsets";
	import type { TopologyNodeRole } from "~~/app/utils/graph/topologyRoleStyle";
	import type { TopologyGraphLink } from "~~/shared/types/topology";
	import { alarmBadgeFillClass, alarmBadgeText } from "~~/app/utils/graph/topologyAlarms";
	import { LABEL_GAP, LABEL_LINE_HEIGHT } from "~~/app/utils/graph/topologyLabelLayout";
	import { linkDashPatternOf, linkHaloOpacityOf, linkHaloWidthOf, linkStrokeWidthOf } from "~~/app/utils/graph/topologyLinkStyle";
	import { applyNodeOffsets } from "~~/app/utils/graph/topologyNodeOffsets";

	import { normalizeLinkStatus, normalizeNodeStatus, topologyLinkKey } from "~~/app/utils/graph/topologyNormalize";
	import { nodeRadiusOf, roleStrokeClass, statusDotRadius } from "~~/app/utils/graph/topologyRoleStyle";
	import { linkStrokeClass, nodeFillClass } from "~~/app/utils/graph/topologyStatusStyle";

	const props = defineProps<{
		nodes: PositionedTopologyNode[]
		links: TopologyGraphLink[]
		width: number
		height: number
		selectedId?: string | null
		/** 选中链路的 key（`topologyLinkKey()`）：页面据此高亮，跨轮询按 key 认人 */
		selectedLinkKey?: string | null
		/**
		 * 选中节点的**关联链路** key 集合（`highlightOf()` 的结果，§6.15）：
		 * 选中一台设备时，与它直连的边一起被点名 —— 只用来上样式，判定在纯函数里。
		 */
		highlightLinkKeys?: ReadonlySet<string>
		/** 选中节点的**一跳邻居** id 集合（外圈加粗；不含选中节点自己） */
		highlightNodeIds?: ReadonlySet<string>
		/** 当前被收起的节点 id（这些节点的下级已从布局输入里摘掉，角标显示 `+N`） */
		collapsedIds?: readonly string[]
		/** 节点 id → 收起后会遮住的台数（含传递）；`0` / 缺省 = 没有下级，不出展开角标 */
		childCounts?: Record<string, number>
		/** 链路悬停提示文本（页面按 `linkFactsOf()` 拼，画布只管渲染成 SVG `<title>`） */
		linkTitle?: (link: TopologyGraphLink) => string
		/** 节点 id → 仿真标记（8001 运行态对齐结果） */
		markers?: Record<string, SimulatorNodeMarker>
		/** 节点 id → 告警角标读数（`alarmIndexOf()` 的结果；缺省 = 不画角标） */
		alarms?: TopologyAlarmIndex
		/** 节点手动位移层（§6.9）：几何坐标 + 增量 = 最终落点，本组件只合成、不改表 */
		offsets?: NodeOffsetMap
		/** 是否渲染节点名称（页面「显示名称」开关；缺省渲染 —— 关掉后只剩节点 + 状态圆点） */
		showLabels?: boolean
		/** 无障碍名称（`<svg>` 的 `aria-label`）：屏幕阅读器念的就是这一句 */
		label: string
	}>();

	const emit = defineEmits<{
		select: [id: string]
		/** 点中一条链路（§6.11）：页面在详情栏展示该链路事实 */
		selectLink: [key: string]
		/** 收起 / 展开一个节点的下级（§6.15）：双击节点或点角标触发，状态由页面持有 */
		toggleCollapse: [id: string]
		/** 拖拽结束：`offset` 是**累计**增量（相对几何坐标），页面交给 `setNodeOffset()` 去重 / 落表 */
		offsetChange: [id: string, offset: NodeOffset]
		/** 视口是否已偏离初始状态（缩放 / 平移）：「恢复默认配置」的禁用态要诚实反映它 */
		viewportChange: [dirty: boolean]
		/**
		 * 当前缩放百分比：缩放控件已上移到画布右上（与旋转控件同一排，§6.15），
		 * 控件由页面渲染，读数因此必须从画布里传出去。
		 */
		zoomChange: [percent: number]
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

	/** 缩放读数交给页面（缩放控件在页面右上那一排，§6.15）：挂载时先报一次初值 */
	watch(zoomPercent, (value) => emit("zoomChange", value), { immediate: true });

	/**
	 * 视口复位（「恢复默认配置」的第三部分；位移 / 旋转角在页面层清）。
	 * 缩放按钮也一并暴露：控件由页面渲染，但状态仍归 `useGraphInteraction()` 独家所有。
	 */
	defineExpose({ resetViewport: reset, zoomIn, zoomOut });

	/**
	 * 链路的强调档位（§6.15 要求 2 / §6.15.2）：
	 * `selected` = 被点中的那条；`incident` = 与选中节点直连；`none` = 其余。
	 *
	 * `incident` **不改本体的颜色与粗细** —— 画布上的灰是「连接关系」的唯一色义、粗细是带宽的唯一
	 * 读数，关联强调因此搬到一条叠在同一个 `d` 上的外延环（`linkHaloLevelOf()`）。
	 * `selected` 是唯一例外：本体换成 `primary`（2026-11-09 用户裁决「选中链路要用主色」），
	 * 外延环同时收窄成一圈柔光（`HALO_BUMP.selected`）—— 主色已经把「就是这条」说清了。
	 */
	function linkEmphasisOf(link: TopologyGraphLink, index: number): LinkEmphasis {
		const key = topologyLinkKey(link, index);
		if (props.selectedLinkKey === key)
			return "selected";
		return props.highlightLinkKeys?.has(key) ? "incident" : "none";
	}

	/** 连线本体描边类：被点中的那条用主色，其余一律走「状态 → 中性灰」那支 */
	function linkBodyClass(link: TopologyGraphLink, index: number): string {
		if (linkEmphasisOf(link, index) === "selected")
			return "stroke-(--ui-primary)";
		return linkStrokeClass(normalizeLinkStatus(link.status));
	}

	/** 键盘焦点落在哪条连线（`null` = 焦点不在连线上）：焦点环复用「关联」那一档的宽度 */
	const focusedLinkKey = ref<string | null>(null);

	function clearFocus(key: string): void {
		if (focusedLinkKey.value === key)
			focusedLinkKey.value = null;
	}

	/** 外延环的档位：`selected` / `incident` / `focus`（仅键盘焦点）/ `none` */
	type LinkHaloLevel = LinkEmphasis | "focus";

	function linkHaloLevelOf(link: TopologyGraphLink, index: number): LinkHaloLevel {
		const emphasis = linkEmphasisOf(link, index);
		// 「选中」最优先：它是当前项本身
		if (emphasis === "selected")
			return emphasis;
		// 焦点优先于「关联」：一台设备恒被选中（右栏没有空态），与它直连的那几条线一进图就带着关联环，
		// 若让关联压住焦点，键盘用户 Tab 到这几条线上时画布上**一点变化都没有** —— 焦点指示就此消失。
		// 两档宽度与不透明度相同（`haloStyleOf()`），差别只在「焦点环保持灰、不染层色」。
		if (focusedLinkKey.value === topologyLinkKey(link, index))
			return "focus";
		return emphasis;
	}

	/** 焦点是「这条线现在是当前项」，与「关联」同义 —— 借用同一档的宽度与不透明度 */
	function haloStyleOf(level: LinkHaloLevel): LinkEmphasis {
		return level === "focus" ? "incident" : level;
	}

	/**
	 * 选中节点的角色（邻居连线的外延环按它的层色染色；没选中 / 选中项不在画布上时为 `null`）。
	 *
	 * 只认选中项**自己**的层色、不认邻居的：一圈线只能有一个颜色，它要回答的是「这条线为什么
	 * 亮着」，答案是「它连着被点中的那一台」—— 用邻居的颜色会把「谁被点中」说反。
	 */
	const selectedRole = computed<TopologyNodeRole | null>(() => {
		if (!props.selectedId)
			return null;
		return viewNodes.value.find((item) => item.id === props.selectedId)?.role ?? null;
	});

	/**
	 * 外延环是否染成选中设备的层色：只有「与选中设备直连」那一档（`incident`）染，
	 * `selected`（被点中的那条线）与 `focus`（键盘焦点）不染层色 —— 前者已经是主色本体，
	 * 颜色在这里再叠层色只会说反「谁被点中」。
	 */
	function linkHaloTintOf(link: TopologyGraphLink, index: number): TopologyNodeRole | "" {
		return linkHaloLevelOf(link, index) === "incident" ? selectedRole.value ?? "" : "";
	}

	/** 外延环的描边类：邻居连线用选中设备的层色，选中那条用主色柔光，其余沿用本体那支灰 */
	function linkHaloClass(link: TopologyGraphLink, index: number): string {
		if (linkHaloLevelOf(link, index) === "selected")
			return "stroke-(--ui-primary)";
		const tint = linkHaloTintOf(link, index);
		return tint ? roleStrokeClass(tint) : linkStrokeClass(normalizeLinkStatus(link.status));
	}

	/** 连线的无障碍名称：悬停提示的全量事实 + 「回车能做什么」 */
	function linkAriaLabel(link: TopologyGraphLink): string {
		const title = props.linkTitle?.(link) ?? "";
		return t("pages.topology-monitor.link.selectAria", { title });
	}

	/** 节点是否是选中节点的**一跳邻居**（外延环，层色不变 —— 换行不换设备类别，换邻居也不换） */
	function emphasizedNode(id: string): boolean {
		return props.highlightNodeIds?.has(id) ?? false;
	}

	/**
	 * 节点外延环的档位（§6.15.2 第 2 条）：`selected` 说清「点中的是哪一台」，
	 * `neighbor` 只轻声提示一跳邻居。选中档同时把本体环加粗一档（`nodeStrokeWidth()`），
	 * 邻居档不加粗 —— 变粗只属于「点中的那一台」。
	 */
	function nodeHaloLevelOf(item: PositionedTopologyNode): "none" | "neighbor" | "selected" {
		if (props.selectedId === item.id)
			return "selected";
		return emphasizedNode(item.id) ? "neighbor" : "none";
	}

	/**
	 * 外延环的几何 / 透明度（半径增量、环宽、不透明度）。
	 *
	 * 选中档**收紧**（+2 而不是 +5）：本体此时已经加粗到 3px，环再外扩一圈会读成两个不相干的圆；
	 * 贴着圆边（`r + 2`）才是「这台被圈住了」。不透明度 50% 保证它在浅色底上也压得住。
	 */
	const NODE_HALO: Record<"neighbor" | "selected", { gap: number, width: number, opacity: number }> = {
		neighbor: { gap: 3, width: 2, opacity: 0.22 },
		selected: { gap: 2, width: 4, opacity: 0.5 }
	};

	/** 节点本体环宽：选中 3，其余 2（全图只有这一处读粗细，不与任何语义冲突） */
	function nodeStrokeWidth(item: PositionedTopologyNode): number {
		return nodeHaloLevelOf(item) === "selected" ? 3 : 2;
	}

	function nodeHaloGap(item: PositionedTopologyNode): number {
		const level = nodeHaloLevelOf(item);
		return level === "none" ? 0 : NODE_HALO[level].gap;
	}

	function nodeHaloWidth(item: PositionedTopologyNode): number {
		const level = nodeHaloLevelOf(item);
		return level === "none" ? 0 : NODE_HALO[level].width;
	}

	function nodeHaloOpacity(item: PositionedTopologyNode): number {
		const level = nodeHaloLevelOf(item);
		return level === "none" ? 0 : NODE_HALO[level].opacity;
	}

	/** 收起后会遮住的台数（`0` = 没有下级，不出展开角标） */
	function childCountOf(id: string): number {
		return props.childCounts?.[id] ?? 0;
	}

	function isCollapsed(id: string): boolean {
		return (props.collapsedIds ?? []).includes(id);
	}

	/** 双击节点 = 收起 / 展开它的下级（G6 `collapse-expand` 的默认触发就是双击，§6.15） */
	function toggleCollapseOf(id: string): void {
		if (childCountOf(id) === 0)
			return;
		emit("toggleCollapse", id);
	}

	/** 角标的无障碍名称：说清「按下去会发生什么」与「会消失几台」 */
	function collapseLabelOf(id: string): string {
		const count = childCountOf(id);
		return isCollapsed(id)
			? t("pages.topology-monitor.collapse.expandAria", { count })
			: t("pages.topology-monitor.collapse.collapseAria", { count });
	}

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

	/**
	 * 节点告警角标读数：`null` = 这台设备没有 firing 告警（模板据此决定画不画角标）。
	 * 颜色在这里一次算好，模板不再对 `alarms` 做二次索引（`strict` 下会报「可能 undefined」）。
	 */
	function alarmOf(item: PositionedTopologyNode): { count: number, fillClass: string } | null {
		const alarm = props.alarms?.[item.id];
		return alarm ? { count: alarm.count, fillClass: alarmBadgeFillClass(alarm.severity) } : null;
	}

	function nodeAriaLabel(item: PositionedTopologyNode): string {
		const status = normalizeNodeStatus(item.node.status);
		const role = t(`pages.topology-monitor.roles.${item.role}`);
		const base = `${item.label} · ${role} · ${t(`pages.topology-monitor.status.${status}`)}`;
		const alarm = props.alarms?.[item.id];
		return alarm ? `${base} · ${t("pages.topology-monitor.alarms.badgeAria", { count: alarm.count })}` : base;
	}

	/** 节点半径（按层级角色，§七）：外圈 / 仿真环 / 标签偏移三处共用同一个值 */
	function nodeRadius(item: PositionedTopologyNode): number {
		return nodeRadiusOf(item.role);
	}

	/** 名称是否渲染（缺省开）：关掉后塔型只剩节点与状态圆点，窄屏更容易看出层级 */
	const labelsVisible = computed(() => props.showLabels !== false);

	/**
	 * 名称锚点：**节点 + 布局给的单位方向 × (半径 + `LABEL_GAP` + 错行档高)**，居中放置文本
	 * （`dominant-baseline="middle"` + `text-anchor="middle"` ⇒ `x/y` 就是文字中心）。
	 *
	 * 为什么方向由布局层给：径向扇的节点沿弧排开，`y + r + 14` 这种「一律写在下方」会让标签
	 * 压到**下一个节点**上（20 台样本里 9 个标签压节点）。方向 = 背离圆心，标签就落在各自
	 * 半径外侧的空白处；层级树给的是 `(0, 1)`，与旧行为同向，只是间距统一成一个数。
	 */
	function labelAnchor(item: PositionedTopologyNode): Point2D {
		const distance = nodeRadius(item) + LABEL_GAP + item.labelShift * LABEL_LINE_HEIGHT;
		return {
			x: Math.round((item.x + item.labelDirDx * distance) * 10) / 10,
			y: Math.round((item.y + item.labelDirDy * distance) * 10) / 10
		};
	}

	/** 告警角标压在节点右上角：随节点半径外移，节点大时不会被本体盖住 */
	function alarmOffset(item: PositionedTopologyNode): number {
		return Math.round(nodeRadius(item) * 0.85);
	}
</script>
