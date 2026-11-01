// app/composables/usePaneResize.ts
// 两栏布局左栏（列表栏）宽度拖拽：pointer events + rAF 合帧 + 松手后防抖写 localStorage + 键盘可达。
//
// 契约（NMCPS-ADR-0017 D1 / NMCPS-ARCH-006 §3.1）：
// - 宽度上限同时受 `--split-list-max-w`（28rem）与「右栏 ≥ 32rem」约束，取更小者；
// - 不允许拖到 0：下限 `--split-list-min-w`（18rem）；
// - 双击分隔条复位默认 22rem；
// - 按「页面 id + 栏名」记忆（例如 `user-list`），不记忆折叠态（本基准没有折叠动作）。
import type { MaybeRefOrGetter, Ref } from "vue";

/** localStorage 键前缀：与约定的 `<页面>-<栏名>` 组合，避免与其他偏好键冲撞 */
const STORAGE_PREFIX = "nmcps:pane:";
/** 松手后写 localStorage 的防抖时长（ms），避免拖拽过程每帧一次磁盘写 */
const SAVE_DEBOUNCE_MS = 300;
/** 分隔条占用宽度（px）：拖拽上限要扣掉它，否则右栏会低于 32rem */
const SEPARATOR_PX = 5;

export interface PaneResizeOptions {
	/** 承载 `--split-list-w` 的容器（`Layout/Split.vue` 根节点） */
	container: Ref<HTMLElement | null>
	/** 稳定 id（按页面 + 栏名，例如 `user-list`） */
	id: string
	/** 默认宽度（rem），双击分隔条复位到此值 */
	defaultWidth?: MaybeRefOrGetter<number>
	/** 可拖拽区间下限（rem） */
	minWidth?: MaybeRefOrGetter<number>
	/** 可拖拽区间上限（rem，仍会与「容器宽 - 右栏最小宽」取更小者） */
	maxWidth?: MaybeRefOrGetter<number>
	/** 右栏最小宽（rem） */
	detailMinWidth?: MaybeRefOrGetter<number>
	/** 是否允许拖拽（覆盖式形态下为 false） */
	enabled?: MaybeRefOrGetter<boolean>
}

export interface PaneResizeState {
	/** 当前左栏宽（rem，保留两位小数） */
	listWidth: Ref<number>
	/** 是否正在拖拽（分隔条高亮用） */
	isResizing: Ref<boolean>
	/** 分隔条 pointerdown 处理（内部 setPointerCapture） */
	onPointerDown: (event: PointerEvent) => void
	/** 分隔条键盘处理（←/→ 调 1rem，Home / Enter 复位） */
	onKeydown: (event: KeyboardEvent) => void
	/** 复位到默认宽度并落盘（双击分隔条） */
	reset: () => void
	/** 容器尺寸变化后重新夹紧当前宽度 */
	sync: () => void
}

/** 根字号（px）：`html` 的 font-size 随 `--app-font-scale` 缩放，rem ↔ px 必须实时读 */
export function rootFontSize(): number {
	if (!import.meta.client) {
		return 16;
	}
	const size = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
	return Number.isFinite(size) && size > 0 ? size : 16;
}

/** 读 CSS 常量（`--split-detail-min-w` 等）并折算成 rem，读不到时用兜底值 */
export function readRemVar(element: HTMLElement | null, name: string, fallback: number): number {
	if (!import.meta.client || !element) {
		return fallback;
	}
	const raw = getComputedStyle(element).getPropertyValue(name).trim();
	const value = Number.parseFloat(raw);
	if (!Number.isFinite(value) || value <= 0) {
		return fallback;
	}
	return raw.endsWith("rem") ? value : value / rootFontSize();
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}

export function usePaneResize(options: PaneResizeOptions): PaneResizeState {
	const {
		container,
		id,
		defaultWidth = 22,
		minWidth = 18,
		maxWidth = 28,
		detailMinWidth = 32,
		enabled = true
	} = options;

	const storageKey = `${STORAGE_PREFIX}${id}`;
	const listWidth = ref(toValue(defaultWidth));
	const isResizing = ref(false);

	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	let frame: number | null = null;
	let startX = 0;
	let startWidthPx = 0;
	let pendingX = 0;

	/** 动态上限（rem）：容器宽 - 右栏最小宽 - 分隔条，且不超过静态上限 */
	function upperBound(): number {
		const max = toValue(maxWidth);
		const element = container.value;
		if (!element || !import.meta.client) {
			return max;
		}
		const elementWidth = element.clientWidth;
		if (elementWidth <= 0) {
			return max;
		}
		const available = (elementWidth - SEPARATOR_PX) / rootFontSize() - toValue(detailMinWidth);
		return Math.min(max, Math.max(toValue(minWidth), available));
	}

	function clamp(width: number): number {
		return round(Math.min(upperBound(), Math.max(toValue(minWidth), width)));
	}

	/** 把宽度写到容器 CSS 变量（不触发 Vue 重渲染；只有 aria 值走响应式） */
	function apply(width: number, persist = false): void {
		listWidth.value = clamp(width);
		container.value?.style.setProperty("--split-list-w", `${listWidth.value}rem`);
		if (persist) {
			scheduleSave();
		}
	}

	function scheduleSave(): void {
		if (saveTimer) {
			clearTimeout(saveTimer);
		}
		saveTimer = setTimeout(() => {
			saveTimer = null;
			if (!import.meta.client) {
				return;
			}
			try {
				localStorage.setItem(storageKey, String(listWidth.value));
			} catch {
				// 隐私模式 / 配额耗尽：宽度只是偏好，读写失败不打断交互
			}
		}, SAVE_DEBOUNCE_MS);
	}

	function restore(): void {
		if (!import.meta.client) {
			return;
		}
		let stored = Number.NaN;
		try {
			stored = Number.parseFloat(localStorage.getItem(storageKey) ?? "");
		} catch {
			stored = Number.NaN;
		}
		apply(Number.isFinite(stored) && stored > 0 ? stored : toValue(defaultWidth));
	}

	function onPointerMove(event: PointerEvent): void {
		if (!isResizing.value) {
			return;
		}
		pendingX = event.clientX;
		// rAF 合帧：pointermove 最高可达 240Hz，逐事件改样式会造成布局抖动
		frame ??= requestAnimationFrame(() => {
			frame = null;
			const deltaRem = (pendingX - startX) / rootFontSize();
			apply(startWidthPx / rootFontSize() + deltaRem);
		});
	}

	function stopResize(event: PointerEvent): void {
		if (!isResizing.value) {
			return;
		}
		isResizing.value = false;
		if (frame !== null) {
			cancelAnimationFrame(frame);
			frame = null;
		}
		const target = event.currentTarget as HTMLElement | null;
		if (target?.hasPointerCapture?.(event.pointerId)) {
			target.releasePointerCapture(event.pointerId);
		}
		window.removeEventListener("pointermove", onPointerMove);
		window.removeEventListener("pointerup", stopResize);
		window.removeEventListener("pointercancel", stopResize);
		scheduleSave();
	}

	function onPointerDown(event: PointerEvent): void {
		if (!toValue(enabled) || event.button !== 0) {
			return;
		}
		event.preventDefault();
		isResizing.value = true;
		startX = event.clientX;
		pendingX = event.clientX;
		startWidthPx = listWidth.value * rootFontSize();
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		window.addEventListener("pointermove", onPointerMove);
		window.addEventListener("pointerup", stopResize);
		window.addEventListener("pointercancel", stopResize);
	}

	function onKeydown(event: KeyboardEvent): void {
		if (!toValue(enabled)) {
			return;
		}
		const stepRem = 1;
		const actions: Record<string, () => void> = {
			ArrowLeft: () => apply(listWidth.value - stepRem, true),
			ArrowRight: () => apply(listWidth.value + stepRem, true),
			Home: () => apply(toValue(defaultWidth), true),
			Enter: () => apply(toValue(defaultWidth), true)
		};
		const action = actions[event.key];
		if (!action) {
			return;
		}
		event.preventDefault();
		action();
	}

	function reset(): void {
		apply(toValue(defaultWidth), true);
	}

	function sync(): void {
		apply(listWidth.value);
	}

	restore();

	// 覆盖式 ↔ 两栏切换（容器宽跨过 56rem）时，把记忆宽度重新夹回合法区间
	watch(() => toValue(enabled), (value) => {
		if (value) {
			sync();
		}
	});

	onScopeDispose(() => {
		if (saveTimer) {
			clearTimeout(saveTimer);
			saveTimer = null;
		}
		if (frame !== null) {
			cancelAnimationFrame(frame);
			frame = null;
		}
		window.removeEventListener("pointermove", onPointerMove);
		window.removeEventListener("pointerup", stopResize);
		window.removeEventListener("pointercancel", stopResize);
	});

	return {
		listWidth,
		isResizing,
		onPointerDown,
		onKeydown,
		reset,
		sync
	};
}
