<template>
	<UDashboardToolbar
		data-toolbar="page"
		class="app-toolbar sticky z-10"
		:class="[toolbarStickyTop, isEmpty ? 'h-0 min-h-0 overflow-hidden border-b-0 bg-transparent backdrop-blur-none' : '']"
		:ui="{ root: 'bg-default/50 backdrop-blur-sm px-0 sm:px-0 min-h-(--app-toolbar-h)' }"
	>
		<!-- 顶栏模式：条全宽（背景/边框占满），内部容器限宽与 header 对齐 -->
		<!--
			左右内边距 12px（§4.1）：与栏内内容（栏内 `p-3`、页面级 Alert 的 `mx-3`）对齐，
			原先沿用 UHeader 的 `px-4 sm:px-6 lg:px-8` 会让动作离内容 32px、看起来"两头留白"。
		-->
		<div
			class="flex w-full items-center justify-between gap-1.5 px-3"
			:class="isTopbarMode ? `${topbarMaxWidthClass} mx-auto` : ''"
		>
			<div class="flex min-w-0 items-center gap-1.5">
				<!--
					顶栏模式：面包屑 = 路由段（useNavigation）+ 记录段（末位，无 to，点击 = 清除选择）
					NMCPS-ARCH-006 §5.1：两段来源不同，记录段只追加在末位，不构造三级路径
				-->
				<UBreadcrumb v-if="isTopbarMode" :items="breadcrumbItems" class="min-w-0">
					<template #record-label="{ item }">
						<button
							type="button"
							class="-mx-1 inline-flex max-w-40 items-center gap-1 truncate rounded px-1 text-left hover:text-(--ui-text-highlighted) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
							:title="$t('layout.recordClear')"
							:aria-label="$t('layout.recordClear')"
							@click="clearRecord"
						>
							<span class="truncate">{{ (item as BreadcrumbItem).label }}</span>
							<UIcon name="carbon:close" class="size-3.5 shrink-0 opacity-60" />
						</button>
					</template>
				</UBreadcrumb>

				<!--
					内容页工具栏挂载点（NMCPS-ARCH-006 §4）：全页只有这一层，
					页面用 <Teleport to="#app-toolbar-left"> / <Teleport to="#app-toolbar-right"> 注入。
					左区 = 面包屑（topbar 模式）+ 集合域动作；右区 = 记录域 / 提交域动作与主 CTA。
					两个挂载点常驻 DOM，供下方 MutationObserver 判空——无面包屑且无注入时整条收起。
				-->
				<div id="app-toolbar-left" class="flex min-w-0 items-center gap-1.5" />
			</div>
			<!-- 右区：与左区同一行、同一限宽容器内（`topbar` 模式下与 header 对齐） -->
			<div id="app-toolbar-right" class="flex shrink-0 items-center gap-1.5" />
		</div>
	</UDashboardToolbar>
</template>

<script setup lang="ts">
	import type { BreadcrumbItem } from "@nuxt/ui";

	const { toolbarStickyTop, isTopbarMode, topbarMaxWidthClass } = useLayoutMode();
	const { breadcrumb } = useNavigation();
	const { recordLabel, clearRecord } = useRecordContext();

	/** 记录段只追加在末位；`slot: "record"` 让它渲染成按钮（无 `to`，点击清除选择） */
	const breadcrumbItems = computed<BreadcrumbItem[]>(() => (recordLabel.value
		? [...breadcrumb.value, { label: recordLabel.value, slot: "record" }]
		: breadcrumb.value));

	/**
	 * 判空靠观测（NMCPS-ARCH-006 §4.3）：`Teleport` 注入的内容不是本组件的响应式子节点，
	 * `$slots` / `computed` 都看不见它，因此只能对两个挂载点开 `MutationObserver`。
	 * 无面包屑且无动作时整条收起（§4.4），不再每页白占一个 49px；挂载点仍留在 DOM 里，
	 * 页面加载后注入动作即恢复（先收起再展开，允许一帧位移）。
	 */
	const hasPageActions = ref(false);
	let observer: MutationObserver | null = null;

	const mountPoints = (): HTMLElement[] => [
		document.getElementById("app-toolbar-left"),
		document.getElementById("app-toolbar-right")
	].filter((element): element is HTMLElement => element !== null);

	function syncPageActions(): void {
		hasPageActions.value = mountPoints().some((element) => element.childElementCount > 0);
	}

	onMounted(() => {
		syncPageActions();
		observer = new MutationObserver(syncPageActions);
		mountPoints().forEach((element) => observer?.observe(element, { childList: true }));
	});

	onBeforeUnmount(() => {
		observer?.disconnect();
		observer = null;
	});

	/** 面包屑（`topbar` 模式）常驻左侧，判空必须排除它 */
	const isEmpty = computed(() => !isTopbarMode.value && !hasPageActions.value);
</script>
