<template>
	<LayoutTile
		:title="$t('pages.store.title')"
		:description="$t('pages.store.description')"
	>
		<div class="space-y-6 md:space-y-8">
			<UForm :state="inputState" :schema="schema" class="flex flex-col gap-y-4 items-end" @submit="setStoreValue">
				<UFormField :label="$t('pages.store.storeValue')" name="value">
					<UInput v-model="inputState.value" variant="subtle" size="lg" />
				</UFormField>

				<UButton type="submit" size="lg">
					{{ $t("pages.store.setValue") }}
				</UButton>
			</UForm>

			<UForm :state="outputState" class="flex flex-col gap-y-4 items-end">
				<UFormField :label="$t('pages.store.storeContent')" name="content">
					<UTextarea v-model="outputState.content" variant="subtle" size="lg" :rows="8" readonly />
				</UFormField>
			</UForm>
		</div>
	</LayoutTile>
</template>

<script lang="ts" setup>
	definePageMeta({
		name: "pages.store.title",
		icon: "carbon:data-base",
		category: "storage",
		description: "pages.store.description",
		sort: 3,
		group: "platform",
		tauriOnly: true
	});

	const { t } = useI18n();

	const schema = z.object({
		value: z.string({
			error: t("pages.store.keyRequired")
		}).nonempty()
	});

	type Schema = zInfer<typeof schema>;

	const inputState = ref<Partial<Schema>>({
		value: undefined
	});
	const outputState = ref({
		content: ""
	});

	const toast = useToast();
	const { store } = usePlatformStore();

	const getStoreValue = async () => {
		const target = await store();

		if (!target) {
			outputState.value.content = t("common.unavailableInBrowser");
			return;
		}

		try {
			outputState.value.content = await target.get<string>("myData") || "";
		} catch (error) {
			toast.add({
				title: t("common.error"),
				description: String(error),
				color: "error"
			});
			outputState.value.content = JSON.stringify(error, null, 4);
		}
	};

	await getStoreValue();

	const setStoreValue = async () => {
		const target = await store();

		if (!target) {
			toast.add({
				title: t("common.error"),
				description: t("pages.store.storeUnavailable"),
				color: "error"
			});
			return;
		}

		try {
			await target.set("myData", inputState.value!.value);
			await getStoreValue();
			toast.add({
				title: t("common.success"),
				description: t("pages.store.valueRetrieved"),
				color: "success"
			});
		} catch (error) {
			toast.add({
				title: t("common.error"),
				description: String(error),
				color: "error"
			});
			outputState.value.content = JSON.stringify(error, null, 4);
		} finally {
			inputState.value.value = undefined;
		}
	};
</script>
