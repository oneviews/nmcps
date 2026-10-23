<template>
	<URadioGroup
		v-model="modelValue"
		:items="items"
		variant="table"
		orientation="horizontal"
		:ui="{ item: 'flex-1' }"
	>
		<template #label="{ item }">
			<div v-if="showIcon" class="flex items-center gap-2">
				<UIcon v-if="item.icon" :name="item.icon" class="size-4 shrink-0 text-dimmed" />
				<span>{{ item.label }}</span>
			</div>
			<span v-else>{{ item.label }}</span>
		</template>
	</URadioGroup>
</template>

<script setup lang="ts" generic="T extends string">
	// 偏好面板统一的横向卡片单选组：封装 URadioGroup 及 icon+label 插槽模板。
	import type { PreferenceOption } from "../../composables/useUserPreferenceOptions";

	withDefaults(defineProps<{
		items: PreferenceOption<string>[]
		/** 是否在选项前渲染图标（如圆角档位仅需文本时传 false） */
		showIcon?: boolean
	}>(), {
		showIcon: true
	});

	const modelValue = defineModel<T>();
</script>
