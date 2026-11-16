<template>
	<!--
		删除确认（NMCPS-ADR-0022 W2 / NMCPS-DESIGN-001 §3.7）：节点与链路共用一个弹窗。
		文案里**必须写出被删对象的 id**（仿真侧没有回收站，删了就是删了），
		并说明连带后果：删节点会带走它的全部链路（上游 `net.delNode()`）。
	-->
	<UModal
		v-model:open="open"
		:title="isLink ? t('pages.scenario-simulator.remove.linkTitle') : t('pages.scenario-simulator.remove.nodeTitle')"
		:description="summary"
		:dismissible="!submitting"
		:ui="{ footer: 'justify-end' }"
	>
		<template #body>
			<div class="space-y-3">
				<UAlert
					color="warning"
					variant="subtle"
					icon="carbon:warning-alt"
					:title="t('pages.scenario-simulator.remove.irreversible')"
					:description="isLink ? t('pages.scenario-simulator.remove.linkBody') : t('pages.scenario-simulator.remove.nodeBody')"
				/>
				<UAlert
					v-if="error"
					data-testid="lab-remove-error"
					color="error"
					variant="subtle"
					icon="carbon:warning-alt"
					:title="t('pages.scenario-simulator.remove.failed')"
					:description="error"
				/>
			</div>
		</template>

		<template #footer>
			<UButton
				color="neutral"
				variant="ghost"
				:label="t('pages.scenario-simulator.remove.cancel')"
				:disabled="submitting"
				@click="open = false"
			/>
			<UButton
				data-testid="lab-remove-confirm"
				color="error"
				:label="t('pages.scenario-simulator.remove.submit')"
				:loading="submitting"
				@click="emit('confirm')"
			/>
		</template>
	</UModal>
</template>

<script setup lang="ts">
	import type { LabRemoveTarget } from "#layers/scenario/shared/types/labNodes";

	/**
	 * 删除节点 / 链路的确认弹窗。
	 *
	 * 两个目标形态合成一个组件：文案不同、请求不同，但「不可撤销 + 写出 id」的语义相同，
	 * 各写一份只会让两份文案渐渐走样。
	 */
	const props = defineProps<{
		target: LabRemoveTarget | null
		submitting?: boolean
		error?: string
	}>();

	const emit = defineEmits<{ confirm: [] }>();

	const open = defineModel<boolean>("open", { required: true });

	const { t } = useI18n();

	const isLink = computed(() => props.target?.kind === "link");
	const summary = computed(() => {
		if (!props.target)
			return undefined;
		return props.target.kind === "link"
			? t("pages.scenario-simulator.remove.linkSummary", { source: props.target.source ?? "", target: props.target.target ?? "" })
			: t("pages.scenario-simulator.remove.nodeSummary", { id: props.target.id ?? "" });
	});
</script>
