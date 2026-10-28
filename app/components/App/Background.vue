<template>
	<!-- 整层 pointer-events-none + aria-hidden：纯装饰，不参与文档流、不捕获指针 -->
	<div
		v-if="enabled"
		class="pointer-events-none absolute inset-0 overflow-hidden"
		aria-hidden="true"
	>
		<!-- ① 底雾 / 暗底：浅色 = 冷灰白浅雾底；深色 = 深蓝径向暗底（纯 CSS、零帧开销） -->
		<div class="app-bg-vignette" />

		<!-- ② 网格 + 扫描线 + 粒子：同一组件按开关分层渲染 -->
		<DesignTechGridBackground
			:grid="appearance.grid"
			:scanlines="appearance.grid"
			:particles="appearance.particles"
			:density="40000"
			:max-particles="45"
			:link-distance="110"
			:opacity="tone.particles"
			layer="inline"
		/>
	</div>
</template>

<script setup lang="ts">
// 全局科技感背景组合层（两层递进）：
//   L0 网格 + 扫描线（纯 CSS）—— 每帧开销 0 → 默认开
//   L1 径向底雾渐变          —— 每帧开销 0（纯 CSS）→ 默认开
//   L2 粒子（canvas）        —— 持续 60fps 全屏重绘 → 默认开（可经偏好关闭）
//
// 粒子默认开启的三重护栏：IntersectionObserver 可视性门控 + 降密度 + 低不透明度，
// 同时保留用户开关（偏好 → appearance.particles）按需关闭。

	const { preferences } = useUserPreferences();

	/** 强度档位 → 粒子/网格层不透明度倍率（按「可见优先」重新标定） */
	const INTENSITY = {
		subtle: { grid: 0.6, particles: 0.75 },
		normal: { grid: 1, particles: 1 }
	} as const;

	const appearance = computed(() => preferences.value.appearance);
	const enabled = computed(() => appearance.value.enabled);
	const tone = computed(() => INTENSITY[appearance.value.intensity] ?? INTENSITY.subtle);
</script>

<style scoped>
/* ── 底雾 / 暗底 ────────────────────────────────────────────────────────
   默认（浅色）：冷灰白「浅雾」——顶部略深向边缘全透；深色（`.dark`）：深蓝径向暗底。 */
.app-bg-vignette {
	position: absolute;
	inset: 0;
	background:
		radial-gradient(ellipse 90% 70% at 50% 0%, rgba(203, 213, 225, 0.5) 0%, rgba(226, 232, 240, 0.22) 45%, transparent 78%),
		radial-gradient(ellipse 70% 60% at 50% 100%, rgba(203, 213, 225, 0.32) 0%, transparent 70%);
}

.dark .app-bg-vignette {
	background:
		radial-gradient(ellipse 90% 70% at 50% 0%, rgba(11, 18, 32, 0.85) 0%, rgba(11, 18, 32, 0.35) 45%, transparent 78%),
		radial-gradient(ellipse 70% 60% at 50% 100%, rgba(11, 18, 32, 0.6) 0%, transparent 70%);
}
</style>
