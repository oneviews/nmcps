<template>
	<UHeader>
		<template #title>
			<NuxtLink to="/" class="group/logo">
				<SvgoLogo :font-controlled="false" class="opacity-70 group-hover/logo:opacity-100 transition-opacity size-6" />
			</NuxtLink>
		</template>
		<UNavigationMenu
			:items="pages"
			variant="link"
			:ui="{
				viewportWrapper: 'w-2xl absolute-center-h',
				list: 'gap-x-3',
			}"
		/>
		<template #body>
			<UNavigationMenu
				:items="pages"
				orientation="vertical"
				variant="link"
			/>
		</template>
		<template #right>
			<UBadge v-if="tauriVersion" variant="subtle">
				Tauri v{{ tauriVersion }}
			</UBadge>
			<UButton
				icon="lucide:refresh-cw"
				color="neutral"
				variant="ghost"
				class="rounded-full"
				:loading="checking"
				aria-label="检查更新"
				@click="checkForUpdates"
			/>
			<SiteColorModeButton />
		</template>
	</UHeader>
</template>

<script lang="ts" setup>
	import { isTauri } from "@tauri-apps/api/core";

	const { pages } = usePages();
	const { checking, checkForUpdates } = useUpdater();
	const tauriVersion = isTauri() ? await useTauriAppGetTauriVersion() : null;
</script>
