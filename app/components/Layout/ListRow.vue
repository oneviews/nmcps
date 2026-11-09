<template>
	<!--
		列表栏行（NMCPS-ARCH-006 §3.6）：主标识一行 + 次级信息一行，选中态走 `.list-row-selected`。
		全站六个 listbox（`/system/{user,policy,permission,log}`、`/topology/{device,link}-metrics`）
		只挂这一份 `<li role="option">` —— 各抄一份的副本迟早漏掉一项（选中底色 / `tabindex` /
		键盘绑定），新增列表栏直接用它，页面只传文案与 `@select`。
	-->
	<li
		ref="rowRef"
		role="option"
		:aria-selected="selected"
		:tabindex="tabindex"
		:title="title"
		class="cursor-pointer border-s-2 px-3 py-2 outline-none transition-colors hover:bg-elevated focus-visible:bg-elevated focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
		:class="selected ? 'list-row-selected' : 'border-transparent'"
		@click="emit('select')"
		@keydown.enter.prevent="emit('select')"
		@keydown.space.prevent="emit('select')"
	>
		<div class="flex min-w-0 items-center justify-between gap-2">
			<p class="truncate text-sm font-medium">
				{{ label }}
			</p>
			<!-- 状态徽标：行内是内容，永远 `sm`（工具栏读数的 `md` 口径见 `Layout/ToolbarBadge.vue`） -->
			<slot name="badge" />
		</div>
		<!--
			次级信息只允许一行：多段用 ` · ` 在同一行内分隔（§3.6）。
			需要混排（IP 等宽、编号等宽）时用 `#subtitle` 插槽，否则传 `subtitle` 纯文本。
		-->
		<p class="truncate text-xs text-(--ui-text-muted)" :class="monoSubtitle ? 'font-mono' : ''">
			<slot name="subtitle">
				{{ subtitle }}
			</slot>
		</p>
	</li>
</template>

<script setup lang="ts">
	withDefaults(defineProps<{
		/** 主标识（一行，超长截断；完整值走 `title`） */
		label: string
		/** 次级信息纯文本；需要混排时改用 `#subtitle` 插槽 */
		subtitle?: string
		/** 次级信息整行等宽（编号 / 接口名一类的行） */
		monoSubtitle?: boolean
		/** 是否选中：决定 `.list-row-selected` 与 `aria-selected` */
		selected?: boolean
		/** roving tabindex：当前行或首行 `0`，其余 `-1` */
		tabindex?: number
		/** 悬停提示，通常是「主标识 · 记录标识」 */
		title?: string
	}>(), {
		subtitle: "",
		monoSubtitle: false,
		selected: false,
		tabindex: -1
	});

	const emit = defineEmits<{
		/** 点选或 `Enter` / `Space`：选中这条记录（写操作一律在右栏工具栏） */
		select: []
	}>();

	const rowRef = ref<HTMLElement | null>(null);

	/**
	 * 键盘导航（`↑/↓/Home/End`）要把焦点搬到目标行，但页面拿不到这里的 `<li>`，
	 * 因此只暴露 `focus()`：页面把组件实例存进 `rowElements`，不碰 DOM 结构。
	 */
	defineExpose({
		focus: (): void => rowRef.value?.focus()
	});
</script>
