<template>
	<LayoutTile
		:title="$t('pages.webview.title')"
		:description="$t('pages.webview.description')"
	>
		<div class="flex flex-col items-center gap-6">
			<UButton variant="subtle" @click="openWindow((new Date).valueOf().toString(), app.repo)">
				{{ $t("pages.webview.createExternal") }}
			</UButton>
			<UButton variant="subtle" @click="openWindow('secondary', '/os')">
				{{ $t("pages.webview.createInternal") }}
			</UButton>
		</div>
	</LayoutTile>
</template>

<script lang="ts" setup>
	definePageMeta({
		name: "pages.webview.title",
		icon: "carbon:application",
		category: "interface",
		description: "pages.webview.description"
	});

	const { app } = useAppConfig();
	const toast = useToast();
	const { t } = useI18n();

	const openWindow = async (id: string, page: string) => {
		const webview = new useTauriWebviewWindowWebviewWindow(id, {
			title: "nmcps webview",
			url: page,
			width: 1280,
			height: 720
		});

		webview.once("tauri://created", () => {
			toast.add({
				title: t("common.success"),
				description: t("pages.webview.created"),
				color: "success"
			});
		});
		webview.once("tauri://error", (error) => {
			toast.add({
				title: t("common.error"),
				description: (error as any).payload,
				color: "error"
			});
		});
	};
</script>
