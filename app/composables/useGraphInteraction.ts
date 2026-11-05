// app/composables/useGraphInteraction.ts
// 图交互**唯一实现**：拖拽平移 + 滚轮 / 按钮缩放（无 rAF 常驻循环，仅事件驱动）。
//
// 设计基准：NMCPS-DESIGN-001 §七（「拖拽 / 缩放 / 框选命中测试由本 composable 统一提供」，
// 页面不得自建 canvas 或自起 `requestAnimationFrame`）。命中测试本身交给 SVG：节点是真实的
// `<circle>` / `<g>`，点击事件由渲染组件转发，本文件只负责视口变换。
import { computed, ref } from "vue";

/** 缩放上下限：低于 0.4 节点文字不可读，高于 3 只会放大到像素化 */
const MIN_SCALE = 0.4;
const MAX_SCALE = 3;
/** 每次按钮缩放倍率 */
const ZOOM_STEP = 1.25;

export function useGraphInteraction() {
	const scale = ref(1);
	const offsetX = ref(0);
	const offsetY = ref(0);
	const dragging = ref(false);

	/** 拖拽起点（指针位移 + 当时的偏移） */
	let origin = { x: 0, y: 0, offsetX: 0, offsetY: 0 };

	const transform = computed(() => `translate(${offsetX.value} ${offsetY.value}) scale(${scale.value})`);
	const zoomPercent = computed(() => Math.round(scale.value * 100));

	function clamp(value: number): number {
		return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
	}

	/** 以视口中心为锚点缩放：按钮 / 键盘路径用它，指针路径用 `zoomAt` */
	function zoomBy(factor: number): void {
		scale.value = clamp(scale.value * factor);
	}

	function zoomIn(): void {
		zoomBy(ZOOM_STEP);
	}

	function zoomOut(): void {
		zoomBy(1 / ZOOM_STEP);
	}

	function reset(): void {
		scale.value = 1;
		offsetX.value = 0;
		offsetY.value = 0;
	}

	/** 指针锚点缩放：`clientPoint` 相对 SVG 视口，缩放后该点下的图形保持不动 */
	function zoomAt(factor: number, clientPoint: { x: number, y: number }): void {
		const next = clamp(scale.value * factor);
		if (next === scale.value)
			return;
		const ratio = next / scale.value;
		offsetX.value = clientPoint.x - (clientPoint.x - offsetX.value) * ratio;
		offsetY.value = clientPoint.y - (clientPoint.y - offsetY.value) * ratio;
		scale.value = next;
	}

	function onWheel(event: WheelEvent): void {
		// 浏览器默认会把滚轮升级成整页滚动，图内缩放必须自己吃掉
		event.preventDefault();
		const target = event.currentTarget as Element | null;
		const rect = target?.getBoundingClientRect();
		const point = rect
			? { x: event.clientX - rect.left, y: event.clientY - rect.top }
			: { x: 0, y: 0 };
		zoomAt(event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, point);
	}

	function onPointerDown(event: PointerEvent): void {
		// 只处理主键：右键 / 中键留给浏览器菜单与别的交互
		if (event.button !== 0)
			return;
		dragging.value = true;
		origin = { x: event.clientX, y: event.clientY, offsetX: offsetX.value, offsetY: offsetY.value };
		(event.currentTarget as Element | null)?.setPointerCapture?.(event.pointerId);
	}

	function onPointerMove(event: PointerEvent): void {
		if (!dragging.value)
			return;
		offsetX.value = origin.offsetX + (event.clientX - origin.x);
		offsetY.value = origin.offsetY + (event.clientY - origin.y);
	}

	function onPointerUp(event: PointerEvent): void {
		if (!dragging.value)
			return;
		dragging.value = false;
		(event.currentTarget as Element | null)?.releasePointerCapture?.(event.pointerId);
	}

	return {
		scale,
		offsetX,
		offsetY,
		dragging,
		transform,
		zoomPercent,
		zoomIn,
		zoomOut,
		reset,
		onWheel,
		onPointerDown,
		onPointerMove,
		onPointerUp
	};
}
