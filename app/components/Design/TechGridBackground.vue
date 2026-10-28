<template>
	<div
		ref="rootRef"
		class="pointer-events-none absolute inset-0 overflow-hidden"
		:class="layer === 'inline' ? 'z-0' : '-z-10'"
		aria-hidden="true"
	>
		<!-- 网格线：双轴 1px 渐变，径向蒙版由中心向外淡出（纯 CSS，可独立关闭） -->
		<div v-if="grid" class="tech-grid" :style="{ '--tech-grid-tone': opacity }" />
		<!-- 粒子网络：canvas 全屏铺满（持续开销，可独立关闭） -->
		<canvas v-if="particles" ref="canvasRef" class="tech-net" />
		<!-- 扫描线：CRT 质感的水平细纹（可独立关闭） -->
		<div v-if="scanlines" class="tech-scanlines" />
	</div>
</template>

<script setup lang="ts">
// 深空赛博网格背景：全屏氛围层（网格线 + 扫描线 + 粒子网络 canvas）。
// 纯 CSS + Canvas 2D，无第三方动画库：
//   - 网格线：CSS 背景 linear-gradient 双轴 1px，radial mask 由中心向外淡出；
//   - 扫描线：repeating-linear-gradient 3px 周期，模拟 CRT 屏幕；
//   - 粒子网络：canvas requestAnimationFrame 驱动，近邻连线 + 鼠标斥力，数量随视口面积自适应；
//   - prefers-reduced-motion：停止粒子动画（保留静态首帧）。

	const props = withDefaults(defineProps<{
		/** 粒子密度系数：越大越密（默认 22000 面积/颗粒） */
		density?: number
		/** 相邻连线的最大距离（px） */
		linkDistance?: number
		/** 粒子数上限（防止大屏粒子爆炸；O(n²) 连线与之平方相关） */
		maxParticles?: number
		/** 整体不透明度（0~1）；全局背景建议 ≤ 0.35 以免透过卡片干扰阅读 */
		opacity?: number
		/** 可视性门控：滚出视口 / 被遮挡时暂停 rAF（IntersectionObserver 主动停帧） */
		pauseWhenHidden?: boolean
		/** 是否渲染网格层（纯 CSS，零开销） */
		grid?: boolean
		/** 是否渲染扫描线层（纯 CSS，零开销） */
		scanlines?: boolean
		/** 是否渲染粒子层（canvas，持续开销）；false 时不创建 canvas/rAF/Observer */
		particles?: boolean
		/** 层级策略：'page' 根层 -z-10；'inline' 根层 z-0（卡片/画布内部垫底） */
		layer?: "page" | "inline"
	}>(), {
		density: 22000,
		linkDistance: 130,
		maxParticles: 90,
		opacity: 1,
		pauseWhenHidden: true,
		grid: true,
		scanlines: true,
		particles: true,
		layer: "page"
	});

	interface Particle {
		x: number
		y: number
		vx: number
		vy: number
		r: number
	}

	const canvasRef = ref<HTMLCanvasElement | null>(null);
	const reduceMotion = ref<boolean>(false);

	// 主题化配色：静态层（网格/扫描线）由 CSS `.dark` 选择器切主题；
	// canvas 粒子（画在 canvas 内，CSS 无法着色）走 JS 调色板（onMounted 后才有 canvas）。
	const colorMode = useColorMode();
	const isDark = computed(() => colorMode.value === "dark");

	interface ParticlePalette {
		dot: string
		link: (alpha: number) => string
	}

	/** 粒子/连线调色板：深=青色霓虹；浅=sky-600 冷蓝 */
	const particlePalette = computed<ParticlePalette>(() => isDark.value
		? {
			dot: "rgba(0, 229, 255, 0.85)",
			link: (alpha) => `rgba(0, 229, 255, ${alpha})`
		}
		: {
			dot: "rgba(2, 132, 199, 0.5)",
			link: (alpha) => `rgba(2, 132, 199, ${alpha})`
		});

	/** 连线最大 alpha（浅色下压低，避免白底上出现「蛛网」感） */
	const linkMaxAlpha = computed(() => (isDark.value ? 0.4 : 0.22));

	let ctx: CanvasRenderingContext2D | null = null;
	let frameId: number | null = null;
	let particles: Particle[] = [];
	let width = 0;
	let height = 0;
	const mouse = { x: -9e3, y: -9e3 };

	// —— 可视性门控 ——
	let visible = true;
	let observer: IntersectionObserver | null = null;
	const rootRef = ref<HTMLDivElement | null>(null);

	function resizeCanvas(): void {
		const canvas = canvasRef.value;
		if (!canvas)
			return;
		width = canvas.width = window.innerWidth;
		height = canvas.height = window.innerHeight;

		const count = Math.min(props.maxParticles, Math.floor((width * height) / props.density));
		particles = Array.from({ length: count }, () => ({
			x: Math.random() * width,
			y: Math.random() * height,
			vx: (Math.random() - 0.5) * 0.35,
			vy: (Math.random() - 0.5) * 0.35,
			r: Math.random() * 1.6 + 0.6
		}));
	}

	function draw(): void {
		if (!ctx)
			return;
		// 不可见时不再排下一帧（由 IntersectionObserver 在重新可见时恢复）
		if (!visible) {
			frameId = null;
			return;
		}
		ctx.clearRect(0, 0, width, height);
		// 粒子/连线的基础可见度已内建在各自颜色里，本参数作为整体倍率
		ctx.globalAlpha = props.opacity;

		const palette = particlePalette.value;
		const linkMax = linkMaxAlpha.value;

		for (const p of particles) {
			p.x += p.vx;
			p.y += p.vy;
			if (p.x < 0 || p.x > width)
				p.vx *= -1;
			if (p.y < 0 || p.y > height)
				p.vy *= -1;

			const dx = p.x - mouse.x;
			const dy = p.y - mouse.y;
			const dist = Math.hypot(dx, dy);
			if (dist < 120 && dist > 0.001) {
				p.x += (dx / dist) * 0.8;
				p.y += (dy / dist) * 0.8;
			}

			ctx.beginPath();
			ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
			ctx.fillStyle = palette.dot;
			ctx.fill();
		}

		for (let i = 0; i < particles.length; i++) {
			for (let j = i + 1; j < particles.length; j++) {
				const a = particles[i];
				const b = particles[j];
				if (!a || !b)
					continue;
				const d = Math.hypot(a.x - b.x, a.y - b.y);
				if (d < props.linkDistance) {
					ctx.beginPath();
					ctx.moveTo(a.x, a.y);
					ctx.lineTo(b.x, b.y);
					ctx.strokeStyle = palette.link((1 - d / props.linkDistance) * linkMax);
					ctx.lineWidth = 1;
					ctx.stroke();
				}
			}
		}

		frameId = requestAnimationFrame(draw);
	}

	/** 启动/恢复动画循环（幂等） */
	function startLoop(): void {
		if (reduceMotion.value || frameId !== null)
			return;
		frameId = requestAnimationFrame(draw);
	}

	/** 停止动画循环 */
	function stopLoop(): void {
		if (frameId !== null) {
			cancelAnimationFrame(frameId);
			frameId = null;
		}
	}

	/** 初始化 canvas 上下文与粒子（幂等） */
	function setupCanvas(): boolean {
		const canvas = canvasRef.value;
		if (!canvas)
			return false;
		ctx = canvas.getContext("2d");
		resizeCanvas();
		reduceMotion.value = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		return true;
	}

	/** 绑定可视性门控（幂等） */
	function bindObserver(): void {
		if (!props.pauseWhenHidden || typeof IntersectionObserver === "undefined" || !rootRef.value)
			return;
		if (observer)
			return;
		observer = new IntersectionObserver((entries) => {
			const entry = entries[0];
			if (!entry)
				return;
			const nowVisible = entry.isIntersecting;
			if (nowVisible === visible)
				return;
			visible = nowVisible;
			if (nowVisible)
				startLoop();
			else
				stopLoop();
		}, { threshold: 0 });
		observer.observe(rootRef.value);
	}

	function onPointerMove(event: MouseEvent): void {
		mouse.x = event.clientX;
		mouse.y = event.clientY;
	}

	onMounted(() => {
		if (!props.particles)
			return;
		if (!setupCanvas())
			return;

		if (reduceMotion.value) {
			visible = true;
			draw();
			stopLoop();
			return;
		}

		window.addEventListener("resize", resizeCanvas);
		window.addEventListener("mousemove", onPointerMove);
		bindObserver();
		startLoop();
	});

	// 关键：particles 由偏好开关动态切换；onMounted 只跑一次，
	// 若用户「后开」粒子，canvas 虽由 v-if 出现但 rAF 循环不会启动。
	watch(() => props.particles, async (on) => {
		if (!on) {
			stopLoop();
			return;
		}
		await nextTick();
		if (!setupCanvas())
			return;
		if (reduceMotion.value) {
			visible = true;
			draw();
			stopLoop();
			return;
		}
		window.addEventListener("resize", resizeCanvas);
		window.addEventListener("mousemove", onPointerMove);
		bindObserver();
		startLoop();
	});

	onBeforeUnmount(() => {
		stopLoop();
		observer?.disconnect();
		observer = null;
		window.removeEventListener("resize", resizeCanvas);
		window.removeEventListener("mousemove", onPointerMove);
	});
</script>

<style scoped>
/* ── 网格线 ─────────────────────────────────────────────────────────────
   默认（浅色）：冷灰蓝 sky-600 细网格；深色（`.dark` 祖先）：青色霓虹。
   `--tech-grid-tone` 是偏好强度倍率。 */
.tech-grid {
	position: absolute;
	inset: 0;
	opacity: calc(var(--tech-grid-tone, 1) * 0.16);
	background-image:
		linear-gradient(rgba(2, 132, 199, 0.5) 1px, transparent 1px),
		linear-gradient(90deg, rgba(2, 132, 199, 0.5) 1px, transparent 1px);
	background-size: 56px 56px;
	mask-image: radial-gradient(ellipse 70% 60% at 50% 45%, black 0%, transparent 75%);
	-webkit-mask-image: radial-gradient(ellipse 70% 60% at 50% 45%, black 0%, transparent 75%);
}

.dark .tech-grid {
	opacity: calc(var(--tech-grid-tone, 1) * 0.1);
	background-image:
		linear-gradient(rgba(0, 229, 255, 0.5) 1px, transparent 1px),
		linear-gradient(90deg, rgba(0, 229, 255, 0.5) 1px, transparent 1px);
}

.tech-net {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
}

/* ── 扫描线 ─────────────────────────────────────────────────────────────
   默认（浅色）：极淡中性灰；深色（`.dark`）：既有 CRT 黑线。 */
.tech-scanlines {
	position: absolute;
	inset: 0;
	opacity: 0.32;
	background: repeating-linear-gradient(
		0deg,
		transparent 0 3px,
		rgba(15, 23, 42, 0.04) 3px 4px
	);
}

.dark .tech-scanlines {
	background: repeating-linear-gradient(
		0deg,
		transparent 0 3px,
		rgba(0, 0, 0, 0.18) 3px 4px
	);
}

@media (prefers-reduced-motion: reduce) {
	.tech-scanlines {
		opacity: 0.18;
	}
}
</style>
