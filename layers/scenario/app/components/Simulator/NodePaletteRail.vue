<template>
	<!--
		节点面板（复刻 1.0 `Side.vue` 的 palette，NMCPS-ADR-0022 W7）。

		1.0 把五个节点类型做成「图标 + 名称」的拖源，排在最左的侧栏里；2.0 一度把它塞进工具栏
		的 `UPopover`，于是要「先点开菜单、再拖出来」—— 菜单一收起，拖源就跟着被拆掉。这里
		把它放回画布**左侧**的纵列（W9 后从右侧移过来，W10 又从「叠在画布上」改成画布外面
		的独立一列）：图标常驻、点一下用默认落点新增、拖到画布上用放手位置。栏顶插槽（运行
		控制 + 「生成拓扑」，由页面传入）—— 1.0 的 `Side.vue` 里建网动作也在 palette 之上。

		本组件不再自带 `absolute` 定位：父级是 flex 行，这一列 `self-stretch` 撑满画布高度、
		内容从顶部开始（W10 的口径「占据整个容器高度、靠上摆放」）；落点换算与表单仍归页面
		（`TopologyCanvas` 的 `canvasDrop` + `NodeFormModal`），不在这里算第二份。

		整列**透明**（W11）：不铺底色、不描边、不投影 —— 它就是画布左侧的一条图标列，不是
		一张卡片。因此列内也只剩一条分割线（页面放在「生成拓扑」上方），其余靠间距分组。
		图标按钮全部带 `UTooltip`：列一透明，按钮就只剩图标，说明只能挂在悬浮提示上。
	-->
	<div
		data-testid="mininet-node-palette"
		class="flex w-[72px] shrink-0 flex-col self-stretch overflow-hidden"
	>
		<!--
			栏顶插槽：页面把运行控制与「生成拓扑」放进来。它固定在列顶（不随下面的类型
			列表滚动）；这里不画分割线 —— 需要的那一条由页面自己放在「生成拓扑」上方。
		-->
		<div v-if="$slots.top" class="flex w-full shrink-0 flex-col items-center gap-1 p-1">
			<slot name="top" />
		</div>
		<div class="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto p-1">
			<UTooltip
				v-if="kinds.length"
				:text="open
					? $t('pages.scenario-simulator.palette.collapse')
					: $t('pages.scenario-simulator.palette.expand')"
			>
				<UButton
					data-testid="mininet-node-palette-toggle"
					size="xs"
					color="neutral"
					variant="ghost"
					class="size-7 justify-center"
					:icon="open ? 'carbon:chevron-left' : 'carbon:chevron-right'"
					:aria-label="open
						? $t('pages.scenario-simulator.palette.collapse')
						: $t('pages.scenario-simulator.palette.expand')"
					@click="open = !open"
				/>
			</UTooltip>
			<div v-if="open && kinds.length" class="px-1 text-[10px] font-medium tracking-wide text-(--ui-text-muted)">
				{{ $t("pages.scenario-simulator.palette.title") }}
			</div>
			<div class="flex flex-col items-center gap-1">
				<!--
					拖源是这层 div；按钮上也显式 `draggable` —— 按下的若是表单控件，Chrome 只在
					被按元素自己可拖时才启动拖放，只靠祖先会拖不动。悬浮提示挂在按钮上（拖源
					仍是外层 div），提示文案 = 类型名 + 面板说明。
				-->
				<div
					v-for="kind in kinds"
					:key="kind"
					:data-testid="`mininet-add-kind-${kind}`"
					:data-kind="kind"
					draggable="true"
					class="flex w-16 cursor-grab flex-col items-center gap-0.5 rounded-md p-0.5 transition-colors hover:bg-(--ui-bg-muted) active:cursor-grabbing"
					@dragstart="emit('dragstart', $event, kind)"
					@dragend="emit('dragend')"
					@click="emit('pick', kind)"
				>
					<UTooltip :text="$t('pages.scenario-simulator.palette.kindHint', { kind: labelOf(kind), hint })">
						<UButton
							size="md"
							color="neutral"
							variant="ghost"
							class="size-12 justify-center"
							:ui="{ leadingIcon: 'size-6' }"
							draggable="true"
							tabindex="-1"
							:icon="icons[kind]"
							:aria-label="labelOf(kind)"
						/>
					</UTooltip>
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
