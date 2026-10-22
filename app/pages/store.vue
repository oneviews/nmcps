<template>
	<LayoutTile
		title="Store"
		description="Persistent key-value store. Allows you to handle state to a file which can be saved and loaded on demand including between app restarts."
	>
		<div class="space-y-6 md:space-y-8">
			<UForm :state="inputState" :schema="schema" class="flex flex-col gap-y-4 items-end" @submit="setStoreValue">
				<UFormField label="Store value" name="value">
					<UInput v-model="inputState.value" variant="subtle" size="lg" />
				</UFormField>

				<UButton type="submit" size="lg">
					Set value
				</UButton>
			</UForm>

			<UForm :state="outputState" class="flex flex-col gap-y-4 items-end">
				<UFormField label="Store content" name="content">
					<UTextarea v-model="outputState.content" variant="subtle" size="lg" :rows="8" readonly />
				</UFormField>
			</UForm>
		</div>
	</LayoutTile>
</template>

<script lang="ts" setup>
	import { isTauri } from "@tauri-apps/api/core";

	definePageMeta({
		name: "Store",
		icon: "lucide:database",
		category: "storage",
		description: "Handle file creation in the file system"
	});

	const schema = z.object({
		value: z.string({
			error: "Store key is required"
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
	const store = isTauri()
		? await useTauriStoreLoad("store.bin", {
			defaults: {},
			autoSave: false
		})
		: null;

	const getStoreValue = async () => {
		if (!store) {
			outputState.value.content = "Unavailable in browser";
			return;
		}

		try {
			outputState.value.content = await store.get<string>("myData") || "";
		} catch (error) {
			toast.add({
				title: "Error",
				description: String(error),
				color: "error"
			});
			outputState.value.content = JSON.stringify(error, null, 4);
		}
	};

	await getStoreValue();

	const setStoreValue = async () => {
		if (!store) {
			toast.add({
				title: "Error",
				description: "Store is unavailable in browser",
				color: "error"
			});
			return;
		}

		try {
			await store.set("myData", inputState.value!.value);
			await getStoreValue();
			toast.add({
				title: "Success",
				description: "Store value retieved",
				color: "success"
			});
		} catch (error) {
			toast.add({
				title: "Error",
				description: String(error),
				color: "error"
			});
			outputState.value.content = JSON.stringify(error, null, 4);
		} finally {
			inputState.value.value = undefined;
		}
	};
</script>
