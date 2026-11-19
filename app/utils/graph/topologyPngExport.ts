// app/utils/graph/topologyPngExport.ts
// 「文件 → 导出拓扑 PNG」的浏览器侧实现（复刻旧 `NetworkGraph.vue` 的
// `exportTopologyAsPng()`：旧版直接从 vis-network 的 `<canvas>` 取 `toDataURL`）。
//
// 2.0 的画布是 SVG，不能直接 `toDataURL`，因此走「序列化 → `<img>` → `<canvas>`」：
// 1. 克隆 SVG，把每个元素的**计算样式**（fill / stroke / 字号 / 透明度…）内联成
//    `style` 属性 —— 画布的配色来自 Tailwind class，脱离文档后在 `<img>` 里没有 CSS，
//    不内联就会导出一张只剩黑线或全透明的图；
// 2. 补 `width` / `height` 与 `xmlns`，`XMLSerializer` 成字符串；
// 3. `Image` 解码 → `canvas` 按 `scale` 放大绘制 → `toBlob("image/png")`。
//
// 只在浏览器调用（页面是实验台，依赖 Mininet 的部分本就 client-only）。

/** 需要内联的样式属性：覆盖画布实际使用的全部着色 / 排版来源 */
const INLINE_PROPERTIES = [
	"fill",
	"fill-opacity",
	"stroke",
	"stroke-width",
	"stroke-dasharray",
	"stroke-opacity",
	"stroke-linecap",
	"stroke-linejoin",
	"opacity",
	"font-size",
	"font-family",
	"font-weight",
	"text-anchor",
	"dominant-baseline",
	"visibility"
] as const;

export interface TopologyPngOptions {
	/** 输出倍率（缺省 2：视网膜屏下文字不糊） */
	scale?: number
	/** 背景色（缺省取 `body` 的实际背景，导出图不会透出棋盘格） */
	background?: string
}

function svgSize(svg: SVGSVGElement): { width: number, height: number } {
	const viewBox = svg.viewBox?.baseVal;
	if (viewBox && viewBox.width > 0 && viewBox.height > 0)
		return { width: viewBox.width, height: viewBox.height };

	const rect = svg.getBoundingClientRect();
	return {
		width: Math.max(1, Math.round(rect.width || 960)),
		height: Math.max(1, Math.round(rect.height || 640))
	};
}

/** 把源树的计算样式逐项写到克隆树的 `style` 上（两棵树结构一一对应） */
function inlineComputedStyles(source: SVGSVGElement, clone: SVGSVGElement): void {
	const sourceNodes = [source, ...source.querySelectorAll("*")];
	const cloneNodes = [clone, ...clone.querySelectorAll("*")];
	const limit = Math.min(sourceNodes.length, cloneNodes.length);

	for (let index = 0; index < limit; index++) {
		const from = sourceNodes[index];
		const to = cloneNodes[index];
		if (!from || !to)
			continue;
		const computed = getComputedStyle(from);
		let style = "";
		for (const property of INLINE_PROPERTIES) {
			const value = computed.getPropertyValue(property);
			if (value)
				style += `${property}:${value};`;
		}
		to.setAttribute("style", style);
	}
}

/** 背景色：跟随当前主题（与画布容器同色），取不到时用白色 */
function backgroundColor(): string {
	const body = getComputedStyle(document.body).backgroundColor;
	return body && body !== "rgba(0, 0, 0, 0)" ? body : "#ffffff";
}

/**
 * 把画布 SVG 导出成 PNG Blob。
 *
 * 失败（SVG 不可序列化 / `Image` 解码失败 / canvas 被污染）时 reject 原始错误，
 * 由页面把原话写进 toast —— 这里不造「导出失败」的自定义文案。
 */
export async function topologyPngBlobOf(
	svg: SVGSVGElement,
	options: TopologyPngOptions = {}
): Promise<Blob> {
	const scale = Math.max(1, options.scale ?? 2);
	const { width, height } = svgSize(svg);

	const clone = svg.cloneNode(true) as SVGSVGElement;
	inlineComputedStyles(svg, clone);
	clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
	clone.setAttribute("width", String(width));
	clone.setAttribute("height", String(height));

	const markup = new XMLSerializer().serializeToString(clone);
	const source = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));

	try {
		const image = new Image();
		image.decoding = "async";
		await new Promise<void>((resolve, reject) => {
			image.onload = () => resolve();
			image.onerror = () => reject(new Error("topology_png_decode_failed"));
			image.src = source;
		});

		const canvas = document.createElement("canvas");
		canvas.width = Math.round(width * scale);
		canvas.height = Math.round(height * scale);
		const context = canvas.getContext("2d");
		if (!context)
			throw new Error("topology_png_context_unavailable");

		context.fillStyle = options.background ?? backgroundColor();
		context.fillRect(0, 0, canvas.width, canvas.height);
		context.drawImage(image, 0, 0, canvas.width, canvas.height);

		return await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob((blob) => {
				if (blob)
					resolve(blob);
				else
					reject(new Error("topology_png_encode_failed"));
			}, "image/png");
		});
	} finally {
		URL.revokeObjectURL(source);
	}
}

/** 导出文件名：带时间戳，连续导出不会互相覆盖 */
export function topologyPngFilename(now: Date = new Date()): string {
	const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
	return `lab-topology-${stamp}.png`;
}
