<template>
	<LayoutTile
		:title="$t('pages.notifications.title')"
		:description="$t('pages.notifications.description')"
	>
		<UForm :state="inputState" :schema="schema" class="flex flex-col gap-y-4 items-end" @submit="createNotification">
			<UFormField :label="$t('pages.notifications.notificationTitle')" name="notificationTitle">
				<UInput v-model="inputState.notificationTitle" variant="subtle" size="lg" />
			</UFormField>

			<UFormField :label="$t('pages.notifications.notificationBody')" name="notificationBody">
				<UInput v-model="inputState.notificationBody" variant="subtle" size="lg" />
			</UFormField>

			<UButton type="submit" size="lg">
				{{ $t("pages.notifications.send") }}
			</UButton>
		</UForm>
	</LayoutTile>
</template>

<script lang="ts" setup>
	definePageMeta({
		name: "pages.notifications.title",
		icon: "carbon:chat",
		category: "interface",
		description: "pages.notifications.description",
		sort: 4,
		group: "platform",
		tauriOnly: true
	});

	const { t } = useI18n();

	const schema = z.object({
		notificationTitle: z.string({
			error: t("pages.notifications.titleRequired")
		}).nonempty(),
		notificationBody: z.string().optional()
	});

	type Schema = zInfer<typeof schema>;

	const inputState = ref<Partial<Schema>>({
		notificationTitle: undefined,
		notificationBody: undefined
	});

	const toast = useToast();
	const { notify } = usePlatformNotify();

	const createNotification = async () => {
		const result = await notify(inputState.value.notificationTitle!, inputState.value.notificationBody);

		if (result !== "sent") {
			toast.add({
				title: t("common.error"),
				description: t(result === "denied" ? "pages.notifications.missingPermission" : "common.unavailableInBrowser"),
				color: "error"
			});

			return;
		}

		inputState.value.notificationTitle = inputState.value.notificationBody = undefined;
	};
</script>
