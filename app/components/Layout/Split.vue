<template>
	<!--
		数据表单页两栏骨架（NMCPS-ARCH-006 §3 / NMCPS-ADR-0017 D1）。
		页面只填 `#list` / `#list-footer` / `#detail` 三个插槽，不自建栅格；
		工具栏不在这里 —— 全页只有内容页预留的那一层，页面用 `Teleport` 注入
		`#app-toolbar-left` / `#app-toolbar-right`（§4）；栏内不再起 header，
		记录标题是右栏的内容标题，覆盖式的「返回」由页面注入左区。
	-->
	<div
		ref="root"
		class="@container relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
		:data-split="id"
		:data-split-shape="shape"
	>
		<!-- 左栏：数据列表栏 -->
		<section
			v-show="!isOverlay || activePane === 'list'"
			data-pane="list"
			class="@container/list flex min-h-0 min-w-0 flex-col border-(--ui-border)"
			:class="isOverlay ? 'w-full flex-1' : 'shrink-0 border-e'"
			:style="isOverlay ? undefined : { width: 'var(--split-list-w)' }"
		>
			<div class="min-h-0 flex-1 overflow-y-auto overflow-x-clip">
				<slot name="list" />
			</div>
			<!--
				可选 footer（计数 + 每页条数 + 分页，NMCPS-ARCH-006 §3.8 / NMCPS-ADR-0017 D2）：
				在滚动区之外，翻页时不跟着滚走；高度只读 `--app-list-footer-h`（49px），不写死 px。
			-->
			<div
				v-if="$slots['list-footer']"
				data-list-footer
				class="h-(--app-list-footer-h) shrink-0 border-t border-(--ui-border)"
			>
				<slot name="list-footer" />
			</div>
		</section>

		<!-- 分隔条：只在两栏形态渲染；键盘可达（←/→ 调 1rem，Home / Enter 复位） -->
		<div
			v-if="!isOverlay"
			role="separator"
			aria-orientation="vertical"
			:aria-label="t('split.resize')"
			:aria-valuemin="listMin"
			:aria-valuemax="listMax"
			:aria-valuenow="listWidth"
			:title="t('split.resizeHint')"
			:tabindex="0"
			class="group relative z-10 w-[5px] shrink-0 cursor-col-resize select-none outline-none focus-visible:bg-primary/20"
			:class="isResizing ? 'bg-primary/30' : ''"
			@pointerdown="onPointerDown"
			@keydown="onKeydown"
			@dblclick="reset"
		>
			<span
				class="absolute inset-y-0 start-1/2 w-px -translate-x-1/2 bg-(--ui-border) transition-colors group-hover:bg-primary/60"
			/>
		</div>

		<!-- 右栏：数据详情栏 -->
		<section
			v-show="!isOverlay || activePane === 'detail'"
			data-pane="detail"
			class="flex min-h-0 min-w-0 flex-1 flex-col"
		>
			<div class="min-h-0 flex-1 overflow-y-auto overflow-x-clip">
				<slot name="detail" />
			</div>
		</section>
	</div>
</template>

<script setup lang="ts">
	const props = withDefaults(defineProps<{
		/** 稳定标识（按页面命名，例如 `user`）：用于左栏宽度的 localStorage 记忆键 `<id>-list` */
		id: string
		/** 是否有选中记录：覆盖式形态据此决定显示列表页还是详情页 */
		hasSelection?: boolean
		/** 左栏默认宽度（rem），双击分隔条复位到此值 */
		defaultWidth?: number
	}>(), {
		hasSelection: false,
		defaultWidth: 22
	});

	const emit = defineEmits<{
		/** 形态变化外抛：页面据此决定工具栏内容（两栏 = 集合 + 记录同屏；覆盖式跟随当前面板） */
		"update:shape": [value: "two" | "overlay"]
	}>();

	const { t } = useI18n();
	const { isMobile } = useLayoutMode();

	const root = ref<HTMLElement | null>(null);
	/** 容器宽度（px，ResizeObserver 实测；0 = 尚未测量） */
	const containerWidth = ref(0);
	/** 根字号（px），随 `--app-font-scale` 缩放，rem 门槛折算必须实时读 */
	const rootPx = ref(16);
	/** CSS 常量（单一来源）：两栏门槛 / 左栏可拖拽区间 / 右栏最小宽 */
	const splitMin = ref(56);
	const listMin = ref(18);
	const listMax = ref(28);
	const detailMin = ref(32);

	/** 两栏门槛只读容器宽（不是视口宽）；`isMobile` 优先，与 NMCPS-ADR-0017 D1 判定顺序一致 */
	const isOverlay = computed(() =>
		isMobile.value
		|| (containerWidth.value > 0 && containerWidth.value < splitMin.value * rootPx.value));

	const shape = computed<"two" | "overlay">(() => (isOverlay.value ? "overlay" : "two"));
	/** 覆盖式下当前显示的面板：有选中即详情（返回 = 清空 `?id`） */
	const activePane = computed<"list" | "detail">(() => (props.hasSelection ? "detail" : "list"));

	const { listWidth, isResizing, onPointerDown, onKeydown, reset, sync } = usePaneResize({
		container: root,
		id: `${props.id}-list`,
		defaultWidth: () => props.defaultWidth,
		minWidth: () => listMin.value,
		maxWidth: () => listMax.value,
		detailMinWidth: () => detailMin.value,
		enabled: () => !isOverlay.value
	});

	/** 测量容器宽与 CSS 常量，并把记忆宽度夹回合法区间 */
	function measure(): void {
		const element = root.value;
		if (!element) {
			return;
		}
		rootPx.value = rootFontSize();
		splitMin.value = readRemVar(element, "--split-min-w", 56);
		listMin.value = readRemVar(element, "--split-list-min-w", 18);
		listMax.value = readRemVar(element, "--split-list-max-w", 28);
		detailMin.value = readRemVar(element, "--split-detail-min-w", 32);
		containerWidth.value = element.clientWidth;
		sync();
	}

	let observer: ResizeObserver | null = null;

	onMounted(() => {
		measure();
		observer = new ResizeObserver(() => measure());
		if (root.value) {
			observer.observe(root.value);
		}
	});

	onBeforeUnmount(() => {
		observer?.disconnect();
		observer = null;
	});

	watch(shape, (value) => {
		emit("update:shape", value);
	}, { immediate: true });

	defineExpose({ shape, isOverlay });
</script>
