<template>
	<!--
		工具栏右区的页签条（NMCPS-ARCH-006 §4.4）：`variant` / `size` / `content` 写死在这里，
		页面不传 —— 口径只有一处，「这一页是不是页签型」不影响页签长什么样。
		`pill`：当前页是主色块，与工具栏里的 `sm` 按钮同一视觉语汇；`link` 的选中标记是一枚
		`rounded-full` 指示条，在 49px 工具栏里与旁边的方角按钮对不上。
		其余 props（`items` / `v-model` / `data-testid` / `class`）原样透传给 `UTabs`。
	-->
	<UTabs
		v-bind="$attrs"
		:content="false"
		variant="pill"
		size="sm"
	/>
</template>

<script setup lang="ts">
	defineOptions({ inheritAttrs: false });
</script>
