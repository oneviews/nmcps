<template>
	<Html class="overflow-x-hidden">
		<Body class="font-sans antialiased">
			<UApp>
				<NuxtLayout>
					<NuxtPage />
				</NuxtLayout>
				<UserPreferencesSlideover />
			</UApp>
		</Body>
	</Html>
</template>

<script setup lang="ts">
	// 语言持久化恢复：客户端初始化时读取 Cookie 保存的语言选择并恢复
	// （与 Site/LanguageSwitch.vue 的 localeCookie 单一事实源同步）
	const { setLocale } = useI18n();
	const localeCookie = useCookie<string>("locale");

	if (localeCookie.value === "cn" || localeCookie.value === "en") {
		setLocale(localeCookie.value);
	}
</script>
