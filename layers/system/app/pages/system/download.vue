<template>
	<LayoutTile
		:title="$t('pages.system-download.title')"
		:description="$t('pages.system-download.description')"
	>
		<UCard :ui="{ root: 'rounded-lg' }">
			<template #header>
				<div class="flex items-center gap-2">
					<UIcon name="carbon:download" class="size-5 text-(--ui-primary)" />
					<h2 class="text-lg font-semibold">
						{{ $t("pages.system-download.download") }} {{ app.name }}
					</h2>
				</div>
			</template>

			<div class="flex flex-col gap-y-4">
				<p v-if="currentAsset" class="text-sm text-(--ui-text-muted)">
					{{ $t("pages.system-download.detectedUsing") }}
					<span class="font-semibold text-(--ui-text)">
						{{ currentAsset.label }}
					</span>
				</p>
				<p v-else class="text-sm text-(--ui-text-muted)">
					{{ $t("pages.system-download.noPackage") }}
				</p>

				<template v-if="currentAsset">
					<UButton
						:href="primaryFile?.url"
						external
						size="xl"
						block
						:icon="currentAsset.icon"
					>
						{{ $t("pages.system-download.downloadFor", { label: currentAsset.label }) }}
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
							{{ $t("pages.system-download.otherFormats", { count: currentAsset.files.length - 1 }) }}
						</UButton>
					</UDropdownMenu>
				</template>

				<div class="flex flex-wrap items-center gap-2 text-sm text-(--ui-text-muted)">
					<span>{{ $t("pages.system-download.version", { version: downloads.version }) }}</span>
					<UBadge v-if="primaryFile" variant="subtle" color="neutral" size="sm">
						{{ primaryFile.label }}
					</UBadge>
				</div>

				<div v-if="otherAssets.length" class="border-t border-(--ui-border) pt-4">
					<p class="mb-2 text-sm text-(--ui-text-muted)">
						{{ $t("pages.system-download.otherPlatforms") }}
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

			<template #footer>
				<div class="flex flex-wrap items-center gap-2">
					<UButton
						:to="downloads.releaseUrl"
						external
						variant="soft"
						size="sm"
						icon="carbon:logo-github"
						:label="$t('pages.system-download.allReleases')"
					/>
					<UButton
						:to="app.repo"
						external
						variant="ghost"
						size="sm"
						icon="carbon:star"
						:label="$t('pages.system-download.starOnGithub')"
					/>
				</div>
			</template>
		</UCard>
	</LayoutTile>
</template>

<script lang="ts" setup>
	definePageMeta({ sort: 5, icon: "carbon:download" });

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
