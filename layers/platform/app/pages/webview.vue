<template>
	<LayoutTile
		:title="$t('pages.webview.title')"
		:description="$t('pages.webview.description')"
	>
		<div class="flex flex-col items-center gap-6">
			<UButton variant="subtle" @click="openExternal">
				{{ $t("pages.webview.createExternal") }}
			</UButton>
			<UButton variant="subtle" :disabled="!canOpenWindow" @click="createWindow">
				{{ $t("pages.webview.createInternal") }}
			</UButton>
			<UAlert
				v-if="!canOpenWindow"
				color="neutral"
				variant="subtle"
				icon="carbon:warning-alt"
				:title="$t('pages.webview.desktopOnly')"
			/>
		</div>
	</LayoutTile>
</template>

<script lang="ts" setup>
	definePageMeta({
		name: "pages.webview.title",
		icon: "carbon:application",
		category: "interface",
		description: "pages.webview.description",
		sort: 5,
		group: "platform",
		tauriOnly: true
	});

	const { app } = useAppConfig();
	const toast = useToast();
	const { t } = useI18n();
	const { canOpenWindow, openWindow } = usePlatformWindow();
	const { open } = useExternalLink();

	const openExternal = () => open(app.repo);

	const createWindow = async () => {
		const result = await openWindow("secondary", "/os");

		if (result === "created") {
			toast.add({
				title: t("common.success"),
				description: t("pages.webview.created"),
				color: "success"
			});

			return;
		}

		toast.add({
			title: t("common.error"),
			description: t(result === "unsupported" ? "pages.webview.desktopOnly" : "pages.webview.failed"),
			color: "error"
		});
	};
</script>
