<template>
	<!--
		节点面板（复刻 1.0 `Side.vue` 的 palette，NMCPS-ADR-0022 W7）。

		1.0 把五个节点类型做成「图标 + 名称」的拖源，排在最左的侧栏里；2.0 一度把它塞进工具栏
		的 `UPopover`，于是要「先点开菜单、再拖出来」—— 菜单一收起，拖源就跟着被拆掉。这里
		把它放回拓扑图右侧的纵列：图标常驻、点一下用默认落点新增、拖到画布上用放手位置。

		位置由父级容器决定（`absolute`），本组件只管这一列的外观与交互；落点换算与表单仍归
		页面（`TopologyCanvas` 的 `canvasDrop` + `NodeFormModal`），不在这里算第二份。
	-->
	<div
		data-testid="mininet-node-palette"
		class="pointer-events-auto absolute top-1/2 right-2 z-10 max-h-[calc(100%-1rem)] -translate-y-1/2 overflow-y-auto rounded-lg border border-(--ui-border) bg-(--ui-bg-elevated) shadow-sm"
		:title="hint"
	>
		<div class="flex flex-col items-center gap-1 p-1">
			<UButton
				data-testid="mininet-node-palette-toggle"
				size="xs"
				color="neutral"
				variant="ghost"
				class="size-7 justify-center"
				:icon="open ? 'carbon:chevron-right' : 'carbon:chevron-left'"
				:aria-label="open
					? $t('pages.scenario-simulator.palette.collapse')
					: $t('pages.scenario-simulator.palette.expand')"
				@click="open = !open"
			/>
			<div v-if="open" class="px-1 text-[10px] font-medium tracking-wide text-(--ui-text-muted)">
				{{ $t("pages.scenario-simulator.palette.title") }}
			</div>
			<div class="flex flex-col items-center gap-1">
				<!--
					拖源是这层 div；按钮上也显式 `draggable` —— 按下的若是表单控件，Chrome 只在
					被按元素自己可拖时才启动拖放，只靠祖先会拖不动。
				-->
				<div
					v-for="kind in kinds"
					:key="kind"
					:data-testid="`mininet-add-kind-${kind}`"
					:data-kind="kind"
					draggable="true"
					class="flex w-14 cursor-grab flex-col items-center gap-0.5 rounded-md p-0.5 transition-colors hover:bg-(--ui-bg-muted) active:cursor-grabbing"
					@dragstart="emit('dragstart', $event, kind)"
					@dragend="emit('dragend')"
					@click="emit('pick', kind)"
				>
					<UButton
						size="xs"
						color="neutral"
						variant="ghost"
						class="size-10 justify-center"
						draggable="true"
						tabindex="-1"
						:icon="icons[kind]"
						:aria-label="labelOf(kind)"
					/>
					<span v-if="open" class="text-[10px] leading-3 whitespace-nowrap">
						{{ labelOf(kind) }}
					</span>
				</div>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
	import type { LabNodeKind } from "#layers/scenario/shared/types/labNodes";

	defineProps<{
		kinds: readonly LabNodeKind[]
		icons: Record<LabNodeKind, string>
		hint: string
	}>();

	const emit = defineEmits<{
		pick: [kind: LabNodeKind]
		dragstart: [event: DragEvent, kind: LabNodeKind]
		dragend: []
	}>();

	const { t } = useI18n();

	/** 展开时是「图标 + 名称」纵列，收起时只留图标（1.0 的 collapsed 侧栏同款） */
	const open = ref(true);

	function labelOf(kind: LabNodeKind): string {
		return t(`pages.scenario-simulator.kinds.${kind}`);
	}
</script>
