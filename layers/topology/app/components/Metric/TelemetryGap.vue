<template>
	<!--
		「上游无此端点」降级卡片（`NMCPS-CONTRACT-002` §6.3 / `NMCPS-ARCH-006` §3.4：禁止造数）。

		2.0 上游只提供 `/metric/{device,link,name,datapoint,definition}` 与 `/topology/graph`；
		1.0 里靠遥测快照 `td.*` 拼出来的几屏（协议 / 射频 / LLDP / 数据质量 / 报文计数…）在 2.0
		**没有对应端点**。这里不画空表格、不摆 0 占位，只把缺口、所需字段和替代口径写清楚。
	-->
	<UAlert
		color="warning"
		variant="subtle"
		icon="carbon:not-available"
		data-testid="telemetry-gap"
		:data-gap-tab="tab"
		:title="$t('pages.telemetry.gapTitle')"
	>
		<template #description>
			<p>{{ body }}</p>
			<p v-if="fields" class="mt-2 font-mono text-xs opacity-80">
				{{ $t("pages.telemetry.gapFields", { fields }) }}
			</p>
		</template>
	</UAlert>
</template>

<script setup lang="ts">
	defineProps<{
		/** 缺口所属 Tab 键（`protocol` / `radio` / `lldp` / `quality` / `packets` …）：断言与埋点用 */
		tab: string
		/** 缺口说明（含上游端点名，由页面按 Tab 提供） */
		body: string
		/** 这一屏需要的字段清单（原样列出，说明「缺的是什么」，而不是含糊一句「无数据」） */
		fields?: string
	}>();
</script>
