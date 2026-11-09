<template>
	<!--
		三列对比表：行名 | 左侧值 | 右侧值（1.0 「端口对 / 端点对比 / 流量方向」共用的形状）。

		用途（同一份 DOM，三种语义）：
			· 端口对 / 端点对比：左 = source 端，右 = target 端；
			· 流量方向：左 = 入向（source → target），右 = 出向（target → source）。
		值全是**已格式化**字符串；缺失已是 `—`（`~~/app/utils/metric/metricFormat`），本组件不加任何默认值。
	-->
	<UCard :ui="{ root: 'min-w-0', body: 'p-0 sm:p-0' }">
		<template #header>
			<div class="flex items-center justify-between gap-2">
				<h3 class="text-sm font-semibold">
					{{ title }}
				</h3>
				<slot name="actions" />
			</div>
		</template>

		<table class="w-full text-xs" :data-testid="testid">
			<thead>
				<tr class="border-b border-(--ui-border) text-(--ui-text-muted)">
					<th class="px-3 py-2 text-left font-medium">
						{{ $t("pages.telemetry.compareField") }}
					</th>
					<th class="px-3 py-2 text-right font-medium">
						{{ leftTitle }}
					</th>
					<th class="px-3 py-2 text-right font-medium">
						{{ rightTitle }}
					</th>
				</tr>
			</thead>
			<tbody>
				<tr v-for="row in rows" :key="row.label" class="border-b border-(--ui-border) last:border-b-0">
					<th class="px-3 py-1.5 text-left font-normal text-(--ui-text-muted)">
						{{ row.label }}
					</th>
					<td class="truncate px-3 py-1.5 text-right font-mono" :title="row.left">
						{{ row.left }}
					</td>
					<td class="truncate px-3 py-1.5 text-right font-mono" :title="row.right">
						{{ row.right }}
					</td>
				</tr>
			</tbody>
		</table>

		<p v-if="note" class="border-t border-(--ui-border) px-3 py-2 text-xs text-(--ui-text-muted)">
			{{ note }}
		</p>
		<slot />
	</UCard>
</template>

<script setup lang="ts">
	/**
	 * 行：`left` / `right` 是**已格式化**字符串（缺失 = `—`）。
	 * 结构类型不导出（`<script setup>` 不允许 ES 导出），调用方按形状直接传数组。
	 */
	interface CompareRow {
		label: string
		left: string
		right: string
	}

	defineProps<{
		title: string
		leftTitle: string
		rightTitle: string
		rows: CompareRow[]
		/** 表下一句话（口径说明 / 缺口提示） */
		note?: string
		/** `check:ui` 断言钩子 */
		testid?: string
	}>();
</script>
