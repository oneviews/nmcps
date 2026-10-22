<template>
	<UContainer class="relative overflow-hidden min-h-screen">
		<div class="grid place-content-center gap-y-8 py-16">
			<SvgoLogo :filled="true" :font-controlled="false" class="mx-auto size-40" />

			<div class="flex flex-col items-center gap-y-3">
				<h1 class="animate-pulse text-3xl sm:text-4xl text-pretty font-bold font-heading md:mb-5">
					{{ app.name.toUpperCase() }}
				</h1>
				<p class="leading-7 text-pretty">
					Powered by
				</p>

				<div class="flex flex-wrap justify-center gap-1 md:gap-3">
					<UButton
						variant="ghost"
						size="xl"
						:to="app.nuxtSite"
						target="_blank"
						external
					>
						Nuxt 4
					</UButton>
					<UButton
						variant="ghost"
						size="xl"
						:to="app.nuxtUiSite"
						target="_blank"
						external
					>
						NuxtUI 4
					</UButton>
					<UButton
						variant="ghost"
						size="xl"
						:to="app.tauriSite"
						target="_blank"
						external
					>
						Tauri 2
					</UButton>
				</div>
			</div>

			<div class="mx-auto w-full max-w-md">
				<UCard>
					<template #header>
						<div class="flex items-center gap-2">
							<UIcon name="lucide:download" class="size-5 text-(--ui-primary)" />
							<h2 class="text-lg font-semibold">
								下载 {{ app.name }}
							</h2>
						</div>
					</template>

					<div class="flex flex-col gap-y-4">
						<p v-if="currentAsset" class="text-sm text-(--ui-text-muted)">
							检测到您正在使用
							<span class="font-semibold text-(--ui-text)">
								{{ currentAsset.label }}
							</span>
						</p>
						<p v-else class="text-sm text-(--ui-text-muted)">
							当前系统暂未提供安装包，请在下方选择其他平台
						</p>

						<template v-if="currentAsset">
							<UButton
								v-for="file in currentAsset.files"
								:key="file.file"
								:href="file.url"
								external
								:size="currentAsset.files.length > 1 ? 'lg' : 'xl'"
								block
								:icon="currentAsset.icon"
							>
								下载 {{ currentAsset.label }} 版（{{ file.label }}）
							</UButton>
						</template>

						<p class="text-sm text-(--ui-text-muted)">
							版本 {{ downloads.version }}
						</p>

						<div class="border-t border-(--ui-border) pt-4">
							<p class="text-sm text-(--ui-text-muted) mb-2">
								其他平台
							</p>
							<div class="flex flex-wrap gap-2">
								<UButton
									v-for="asset in otherAssets"
									:key="asset.label"
									:href="asset.url"
									external
									variant="soft"
									size="sm"
									:icon="asset.icon"
								>
									{{ asset.label }}
								</UButton>
							</div>
						</div>
					</div>
				</UCard>
			</div>

			<div class="flex justify-center">
				<UButton
					:to="app.repo"
					external
				>
					Star on GitHub
				</UButton>
			</div>
		</div>

		<div class="fixed bottom-6 text-sm absolute-center-h">
			<div class="flex items-center gap-1 text-(--ui-text-muted)">
				<p class="text-sm">
					Made by
				</p>
				<ULink :to="app.repo" external target="_blank">
					{{ app.author }}
				</ULink>
			</div>
		</div>
	</UContainer>
</template>

<script lang="ts" setup>
	const { app, downloads } = useAppConfig();
	const { os } = useOS();

	const getAsset = (name: string) => {
		const asset = (downloads.assets as Record<string, { label: string, icon: string, files: { label: string, file: string }[] } | undefined>)[name];
		if (!asset) return null;
		return {
			...asset,
			files: asset.files.map((file) => ({ ...file, url: `${downloads.basePath}/${file.file}` }))
		};
	};

	const currentAsset = computed(() => getAsset(os));

	const otherAssets = computed(() => {
		return Object.entries(downloads.assets)
			.filter(([key]) => key !== os)
			.map(([, asset]) => ({
				label: asset.label,
				icon: asset.icon,
				url: `${downloads.basePath}/${asset.files[0]?.file ?? ""}`
			}));
	});

	definePageMeta({
		layout: "home"
	});
</script>
