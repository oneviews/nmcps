<template>
	<!--
		一张「字段 → 值」卡片（1.0 遥测详情区的卡片样式：标题 + 逐行 左名右值）。

		值一律是**已格式化好的字符串**：格式化规则住在 `~~/app/utils/metric/metricFormat`，
		`null` 在那里就已经变成 `—`，所以本组件不会、也无权把缺失值渲染成 0。
	-->
	<UCard :ui="{ root: 'min-w-0', body: 'px-3 py-2 sm:px-4 sm:py-3' }">
		<template #header>
			<div class="flex items-center justify-between gap-2">
				<h3 class="text-sm font-semibold">
					{{ title }}
				</h3>
				<slot name="actions" />
			</div>
		</template>

		<dl v-if="rows.length" class="flex flex-col divide-y divide-(--ui-border)">
			<div v-for="row in rows" :key="row.label" class="flex items-baseline justify-between gap-3 py-1.5">
				<dt class="min-w-0 shrink-0 text-xs text-(--ui-text-muted)">
					{{ row.label }}
				</dt>
				<dd
					class="min-w-0 truncate text-right text-xs"
					:class="row.mono === false ? '' : 'font-mono'"
					:title="row.value"
					:data-testid="row.testid"
				>
					{{ row.value }}
				</dd>
			</div>
		</dl>
		<p v-else class="text-xs text-(--ui-text-muted)">
			{{ emptyText }}
		</p>

		<slot />
	</UCard>
</template>

<script setup lang="ts">
	/** 一行：`value` 是**已格式化**的字符串（缺失已由 `metricFormat` 归成 `—`） */
	interface FactRow {
		label: string
		value: string
		/** 等宽字体的例外：中文说明 / 状态词用 `false`（形状不像数字就不冒充数字） */
		mono?: boolean
		/** `check:ui` 断言钩子（只给关键行挂，避免满屏 testid） */
		testid?: string
	}

	withDefaults(defineProps<{
		title: string
		rows: FactRow[]
		/** 一条都没有时的一句话（默认就是一个破折号，与「不可判定」同形） */
		emptyText?: string
	}>(), { emptyText: "—" });
</script>
