<template>
	<!--
		`SparkStat`（文件 `app/components/Graph/SparkStat.vue`，自动导入名 `GraphSparkStat`）。
		设计基准：NMCPS-DESIGN-001 §七「单值 + 迷你趋势 + 状态色」、NMCPS-ADR-0019 D1（自绘）。
		无数据时传 `value: null` 显示「—」：把「没采到」画成 `0` 是缺陷（DESIGN-007 B4 同理）。
	-->
	<div
		data-testid="spark-stat"
		class="flex min-w-0 items-center gap-3 rounded-lg border border-(--ui-border) bg-(--ui-bg-elevated) px-3 py-2"
	>
		<UIcon v-if="icon" :name="icon" class="size-5 shrink-0" :class="iconClass" />
		<div class="flex min-w-0 flex-col">
			<span class="truncate text-xs text-(--ui-text-muted)">{{ label }}</span>
			<span class="flex items-baseline gap-1 text-lg leading-tight font-semibold">
				{{ value ?? "—" }}
				<span v-if="value !== null && unit" class="text-xs font-normal text-(--ui-text-muted)">{{ unit }}</span>
			</span>
		</div>
		<svg
			v-if="trend.length > 1"
			class="ml-auto h-6 w-16 shrink-0"
			viewBox="0 0 64 24"
			preserveAspectRatio="none"
			aria-hidden="true"
		>
			<polyline
				:points="trendPoints"
				fill="none"
				stroke-width="1.5"
				class="stroke-(--ui-primary)"
			/>
		</svg>
	</div>
</template>

<script setup lang="ts">
	import type { StatusColor } from "~~/app/utils/graph/topologyStatusStyle";

	const props = withDefaults(defineProps<{
		label: string
		/** `null` 表示无数据（渲染「—」，绝不渲染 0） */
		value: string | number | null
		unit?: string
		icon?: string
		color?: StatusColor
		/** 迷你趋势（可选，点位 ≥ 2 才画） */
		trend?: number[]
	}>(), {
		unit: "",
		icon: undefined,
		color: "neutral",
		trend: () => []
	});

	const ICON_COLOR: Record<StatusColor, string> = {
		success: "text-(--ui-success)",
		warning: "text-(--ui-warning)",
		error: "text-(--ui-error)",
		neutral: "text-(--ui-text-muted)"
	};

	const iconClass = computed(() => ICON_COLOR[props.color]);

	/** 归一化到 0..24 的折线点（最小/最大相同则画中线，避免除零） */
	const trendPoints = computed(() => {
		const values = props.trend;
		const min = Math.min(...values);
		const max = Math.max(...values);
		const span = max - min || 1;
		return values
			.map((value, index) => {
				const x = values.length > 1 ? (64 / (values.length - 1)) * index : 0;
				const y = 22 - ((value - min) / span) * 20;
				return `${x.toFixed(1)},${y.toFixed(1)}`;
			})
			.join(" ");
	});
</script>
