<template>
	<UButton
		:label="nextLabel"
		icon="carbon:translate"
		color="neutral"
		variant="ghost"
		class="rounded-full"
		@click="toggleLocale"
	/>
</template>

<script setup lang="ts">
	const { locale, setLocale } = useI18n();

	// 语言选择持久化：Cookie 记住用户选择，刷新不丢失
	const localeCookie = useCookie<string>("locale", {
		default: () => "cn",
		maxAge: 60 * 60 * 24 * 365,
		sameSite: "lax"
	});

	// 显示「目标语言」：当前 cn → 显示 EN（点击切英文）；当前 en → 显示中文
	const nextLocale = computed(() => (locale.value === "cn" ? "en" : "cn"));
	const nextLabel = computed(() => (nextLocale.value === "cn" ? "中文" : "EN"));

	function toggleLocale(): void {
		const next = nextLocale.value;
		setLocale(next);
		localeCookie.value = next;
	}
</script>
