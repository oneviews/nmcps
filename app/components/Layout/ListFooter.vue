<template>
	<!--
		列表栏尾部（NMCPS-ARCH-006 §3.8）：计数 + 每页条数 + 分页，一条 49px 高的固定行。
		高度由骨架（Layout/Split.vue 的 `#list-footer`，`--app-list-footer-h`）给定，这里只铺满 `h-full`；
		栏宽 < 20rem 时先收起计数文字（容器查询），条数选择器与分页始终保留。

		每页条数是**列表呈现**而不是筛选：它只影响一次取多少条，不改变命中的记录集，
		所以永远待在这里，不进工具栏、也不进筛选浮层（四页共用同一处，避免再度漂移）。
	-->
	<div class="flex h-full items-center justify-between gap-2 px-3">
		<span class="min-w-0 flex-1 truncate text-xs text-(--ui-text-muted) @max-[20rem]/list:hidden">
			<slot />
		</span>
		<div class="flex shrink-0 items-center gap-2">
			<USelect
				:model-value="pageSize"
				:items="items"
				size="xs"
				class="w-[5.5rem] shrink-0"
				:aria-label="t('common.listFooter.pageSize')"
				@update:model-value="onPageSizeChange"
			/>
			<UPagination
				v-model:page="page"
				size="xs"
				:sibling-count="1"
				:total="total"
				:items-per-page="pageSize"
				:disabled="disabled"
			/>
		</div>
	</div>
</template>

<script setup lang="ts">
	import { pageSizeItems } from "~~/shared/constants/paging";

	withDefaults(defineProps<{
		/** 命中总数（不是当前页条数） */
		total: number
		/** 取数中：分页器禁用，避免连点翻页打乱偏移 */
		disabled?: boolean
	}>(), {
		disabled: false
	});

	/**
	 * 当前页 / 每页条数：状态留在父页（它才知道怎么重新取数）。
	 * 换条数由父页 `watch(pageSize)` 走「重置到第一页」的同一条路径，组件自己不动 `page`。
	 */
	const page = defineModel<number>("page", { required: true });
	const pageSize = defineModel<number>("pageSize", { required: true });

	const { t } = useI18n();

	/** 选项文案带单位：闭合态直接读成「15 条/页」，不再额外摆一个静态标签 */
	const items = computed(() => pageSizeItems((size) => t("common.listFooter.pageSizeOption", { size })));

	function onPageSizeChange(value: unknown): void {
		const next = Number(value);
		if (!Number.isFinite(next) || next <= 0 || next === pageSize.value)
			return;

		pageSize.value = next;
	}
</script>
