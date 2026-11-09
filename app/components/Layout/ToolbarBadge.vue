<template>
	<!--
		工具栏里的读数徽标（NMCPS-ARCH-006 §4.4）：尺寸写死 `md`，页面不传 `size`。
		`sm`（`text-[10px]`）与旁边 `sm` 按钮的 `text-sm` 差两档，读数值会缩成一条虚线；
		`md`（`text-xs`）在不撑破 49px 的前提下与按钮同高。
		栏内（详情卡 / 列表行）的徽标仍是 `sm` —— 那是内容，不是工具栏读数。
		其余 props（`color` / `variant` / `label` / `icon` / `data-testid`）原样透传给 `UBadge`。
	-->
	<UBadge v-bind="$attrs" size="md">
		<slot />
	</UBadge>
</template>

<script setup lang="ts">
	defineOptions({ inheritAttrs: false });
</script>
