<template>
	<!--
		`TrendChart`（文件 `app/components/Graph/TrendChart.vue`，自动导入名 `GraphTrendChart`）。
		设计基准：NMCPS-DESIGN-001 §七「SVG 折线 + 面积填充，> 2,000 点按像素列聚合（保留极值）」、
		NMCPS-ADR-0019 D1（自绘，不引入图表库）。
		本组件只画坐标，不取数、不管空态文案（`emptyText` 由页面按 i18n 传入）：
		点位 < 2 时画空态而不是一条 0 值直线（NMCPS-CONTRACT-002 §6.8 S1）。
	-->
	<div data-testid="trend-chart" class="flex w-full flex-col gap-1">
		<svg
			v-if="linePoints"
			:viewBox="`0 0 ${VIEW_W} ${VIEW_H}`"
			class="h-24 w-full"
			preserveAspectRatio="none"
			role="img"
			:aria-label="label"
		>
			<path data-testid="trend-area" :d="areaPath" class="fill-(--ui-primary)/12" />
			<polyline
				data-testid="trend-line"
				:points="linePoints"
				fill="none"
				stroke-width="1.5"
				stroke-linejoin="round"
				stroke-linecap="round"
				vector-effect="non-scaling-stroke"
				class="stroke-(--ui-primary)"
			/>
		</svg>
		<p v-else data-testid="trend-chart-empty" class="py-6 text-center text-xs text-(--ui-text-muted)">
			{{ emptyText }}
		</p>

		<div v-if="linePoints && extent" class="flex justify-between text-xs text-(--ui-text-muted)">
			<span>{{ format(extent.min) }}</span>
			<span>{{ format(extent.max) }}</span>
		</div>
	</div>
</template>

<script setup lang="ts">
	import type { MetricSeriesPoint } from "~~/app/utils/chart/metricSeries";
	import { downsampleSeries, seriesExtent } from "~~/app/utils/chart/metricSeries";

	const props = withDefaults(defineProps<{
		/** 已归一（升序 / 去重）的点列；`t` 为毫秒 */
		points: MetricSeriesPoint[]
		/** 无障碍标签（页面按 i18n 传入，如「10.0.0.1 的 if_in_octets 趋势」） */
		label: string
		/** 无点位时的文案（页面按 i18n 传入） */
		emptyText: string
		/** 纵轴小数位：来自目录条目的单位口径，缺失就按 1 位 */
		digits?: number
		/** 像素列宽（降采样阈值 2 × columns；点数少时原样画） */
		columns?: number
	}>(), {
		digits: 1,
		// 必须写字面量：`defineProps` 会被编译器提升到 `const VIEW_W` 之前（用常量会踩 TDZ）
		columns: 320
	});
	/** 逻辑画布尺寸（等比拉伸，线宽靠 `vector-effect` 保持 1.5px） */
	const VIEW_W = 320;
	const VIEW_H = 96;
	/** 上下留白：极值点不贴在边框上 */
	const PAD = 6;

	const plotPoints = computed(() => downsampleSeries(props.points, props.columns));
	const extent = computed(() => seriesExtent(plotPoints.value));

	/** 点列 → SVG 坐标（时间线性映射到宽度；值域拉满 0..H，min === max 时取中线避免除零） */
	const coords = computed(() => {
		const points = plotPoints.value;
		const range = extent.value;
		const first = points[0];
		const last = points[points.length - 1];
		if (!range || !first || !last || points.length < 2)
			return [];

		const t0 = first.t;
		const tSpan = last.t - t0 || 1;
		const vSpan = range.max - range.min || 1;

		return points.map((point) => ({
			x: ((point.t - t0) / tSpan) * VIEW_W,
			y: VIEW_H - PAD - ((point.v - range.min) / vSpan) * (VIEW_H - PAD * 2)
		}));
	});

	const linePoints = computed(() => (coords.value.length < 2
		? ""
		: coords.value.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ")));

	const areaPath = computed(() => {
		const path = coords.value;
		const first = path[0];
		const last = path[path.length - 1];
		if (!first || !last || path.length < 2)
			return "";

		const head = `M ${first.x.toFixed(1)},${first.y.toFixed(1)}`;
		const body = path.slice(1).map((point) => `L ${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
		const tail = `L ${last.x.toFixed(1)},${VIEW_H} L ${first.x.toFixed(1)},${VIEW_H} Z`;
		return `${head} ${body} ${tail}`;
	});

	function format(value: number): string {
		return Number.isFinite(value) ? value.toFixed(props.digits) : "—";
	}
</script>
