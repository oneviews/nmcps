<template>
	<LayoutTile
		:title="$t('pages.file.title')"
		:description="$t('pages.file.description')"
	>
		<div class="space-y-4">
			<UAlert color="neutral" variant="subtle" icon="carbon:folder" :title="scopeHint" />
			<UForm :state="inputState" :schema="schema" class="flex flex-col gap-y-4 items-end" @submit="createFile">
				<UFormField :label="$t('pages.file.fileName')" name="fileName">
					<UInput v-model="inputState.fileName" variant="subtle" size="lg" />
				</UFormField>

				<UFormField :label="$t('pages.file.fileContent')" name="fileContent">
					<UTextarea v-model="inputState.fileContent" variant="subtle" size="lg" :rows="10" />
				</UFormField>

				<UButton type="submit" size="lg">
					{{ $t("pages.file.create") }}
				</UButton>
			</UForm>
		</div>
	</LayoutTile>
</template>

<script lang="ts" setup>
	definePageMeta({
		name: "pages.file.title",
		icon: "carbon:document",
		category: "storage",
		description: "pages.file.description",
		sort: 2,
		group: "platform",
		tauriOnly: true
	});

	const { t } = useI18n();

	const schema = z.object({
		fileName: z.string({
			error: t("pages.file.fileNameRequired")
		}).nonempty().regex(/^[\w,\s-]+\.[A-Z0-9]+$/i, {
			message: t("pages.file.invalidFilename")
		}),
		fileContent: z.string({
			error: t("pages.file.fileContentRequired")
		}).nonempty()
	});

	type Schema = zInfer<typeof schema>;

	const inputState = ref<Partial<Schema>>({
		fileName: undefined,
		fileContent: undefined
	});

	const toast = useToast();
	const { scope, createTextFile } = usePlatformFile();

	/** 落点说明：移动端的 `Document` 是应用私有目录，不能承诺「系统文档目录」 */
	const scopeHint = computed(() =>
		scope === "browser"
			? t("common.unavailableInBrowser")
			: t(scope === "app-private" ? "pages.file.scopeMobile" : "pages.file.scopeDesktop")
	);

	const createFile = async () => {
		try {
			const result = await createTextFile(inputState.value.fileName!, inputState.value.fileContent!);

			if (result === "exists") {
				toast.add({
					title: t("common.error"),
					description: t("pages.file.alreadyExists"),
					color: "error"
				});

				return;
			}

			if (result === "unavailable") {
				toast.add({
					title: t("common.error"),
					description: t("common.unavailableInBrowser"),
					color: "error"
				});

				return;
			}

			toast.add({
				title: t("common.success"),
				description: t("pages.file.created"),
				color: "success"
			});
			inputState.value.fileName = inputState.value.fileContent = undefined;
		} catch (err) {
			toast.add({
				title: t("common.error"),
				description: String(err),
				color: "error"
			});
		}
	};
</script>
