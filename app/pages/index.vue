<template>
	<UContainer class="relative overflow-hidden min-h-screen">
		<div class="grid place-content-center gap-y-8 py-16">
			<div class="flex flex-col items-center gap-y-3 text-center">
				<SvgoLogo :filled="true" :font-controlled="false" class="mx-auto size-40" />

				<h1 class="animate-pulse motion-reduce:animate-none text-3xl sm:text-4xl text-pretty font-bold font-heading md:mb-5">
					{{ app.name.toUpperCase() }}
				</h1>
				<p class="leading-7 text-pretty">
					{{ $t("pages.index.poweredBy") }}
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
							<UIcon name="carbon:download" class="size-5 text-(--ui-primary)" />
							<h2 class="text-lg font-semibold">
								{{ $t("pages.index.download") }} {{ app.name }}
							</h2>
						</div>
					</template>

					<div class="flex flex-col gap-y-4">
						<p v-if="currentAsset" class="text-sm text-(--ui-text-muted)">
							{{ $t("pages.index.detectedUsing") }}
							<span class="font-semibold text-(--ui-text)">
								{{ currentAsset.label }}
							</span>
						</p>
						<p v-else class="text-sm text-(--ui-text-muted)">
							{{ $t("pages.index.noPackage") }}
						</p>

						<template v-if="currentAsset">
							<UButton
								:href="primaryFile?.url"
								external
								size="xl"
								block
								:icon="currentAsset.icon"
							>
								{{ $t("pages.index.downloadVersion", { label: currentAsset.label }) }}
							</UButton>

							<UDropdownMenu
								v-if="currentAsset.files.length > 1"
								:items="formatItems"
							>
								<UButton
									variant="soft"
									block
									size="sm"
									color="neutral"
									trailing-icon="carbon:chevron-down"
								>
									{{ $t("pages.index.otherFormats", { count: currentAsset.files.length - 1 }) }}
								</UButton>
							</UDropdownMenu>
						</template>

						<div class="flex flex-wrap items-center gap-2 text-sm text-(--ui-text-muted)">
							<span>{{ $t("pages.index.version", { version: downloads.version }) }}</span>
							<UBadge v-if="primaryFile" variant="subtle" color="neutral" size="sm">
								{{ primaryFile.label }}
							</UBadge>
						</div>

						<div v-if="otherAssets.length" class="border-t border-(--ui-border) pt-4">
							<p class="text-sm text-(--ui-text-muted) mb-2">
								{{ $t("pages.index.otherPlatforms") }}
							</p>
							<div class="flex flex-wrap gap-2">
								<UButton
									v-for="asset in otherAssets"
									:key="asset.key"
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
					{{ $t("pages.index.starOnGithub") }}
				</UButton>
			</div>
		</div>

		<div class="fixed bottom-6 text-sm absolute-center-h">
			<div class="flex items-center gap-1 text-(--ui-text-muted)">
				<p class="text-sm">
					{{ $t("pages.index.madeBy") }}
				</p>
				<ULink :to="app.repo" external target="_blank">
					{{ app.author }}
				</ULink>
			</div>
		</div>
	</UContainer>
</template>

<script lang="ts" setup>
	definePageMeta({
		layout: "home"
	});

	interface DownloadAsset {
		label: string
		icon: string
		files: { label: string, file: string }[]
	}

	const { app, downloads } = useAppConfig();
	const { os } = useOS();

	const assets = downloads.assets as Record<string, DownloadAsset>;
	// GitHub Release 的 basePath 若带尾斜杠，拼出的链接会出现 `//`（部分 CDN 会 404）
	const basePath = downloads.basePath.replace(/\/+$/, "");

	const assetUrl = (file: string) => `${basePath}/${encodeURIComponent(file)}`;

	const getAsset = (name: string) => {
		const asset = assets[name];
		if (!asset)
			return null;

		return {
			...asset,
			files: asset.files.map((file) => ({ ...file, url: assetUrl(file.file) }))
		};
	};

	const currentAsset = computed(() => getAsset(os));

	/** 主下载按钮对应的安装包（各平台 files[0] 即该平台主推格式） */
	const primaryFile = computed(() => currentAsset.value?.files[0]);

	const formatItems = computed(() => (currentAsset.value?.files ?? [])
		// 主按钮已经指向 files[0]，下拉只列其余格式，保证「其他格式（n）」与列表条数一致
		.slice(1)
		.map((file) => ({
			label: file.label,
			icon: "carbon:download",
			href: file.url,
			external: true
		})));

	const otherAssets = computed(() => Object.entries(assets)
		.filter(([key, asset]) => key !== os && asset.files.length > 0)
		.map(([key, asset]) => ({
			key,
			label: asset.label,
			icon: asset.icon,
			url: assetUrl(asset.files[0]?.file ?? "")
		})));
</script>
