<template>
	<!--
		链路详情 / 编辑（NMCPS-ADR-0022 W13，复刻旧 `LinkStats.vue` 的双击入口）。

		事实 = 页面台账里的 `options`（`GET /links` 原样）+ `GET /api/mininet/links/stats/{src}/{dst}` 的
		双向 tx/rx；读数读不到只降级那一块。编辑走会话 PATCH（`lab:operate`，
		`NMCPS-ADR-0029` M1.2），属性全空时**不发请求** —— 上游对空 `options` 只清台账、
		不回收已生效的 tc，弹窗里写明这一点。
	-->
	<UModal
		v-model:open="open"
		data-testid="lab-link-detail"
		:title="link ? t('pages.scenario-simulator.linkDetail.title', { from: link.source, to: link.target }) : ''"
		:description="t('pages.scenario-simulator.linkDetail.hint')"
		:dismissible="!submitting"
		:ui="{ content: 'max-w-xl', footer: 'justify-end' }"
	>
		<template #body>
			<div v-if="link" data-testid="lab-link-detail-body" class="space-y-4">
				<div data-testid="lab-link-detail-stats" class="space-y-2 rounded border border-(--ui-border) p-2">
					<h3 class="text-xs font-medium">
						{{ t("pages.scenario-simulator.linkDetail.stats") }}
					</h3>
					<p v-if="statsLoading" class="text-[11px] text-(--ui-text-muted)">
						{{ t("pages.scenario-simulator.linkDetail.statsLoading") }}
					</p>
					<p v-else-if="statsError" class="text-[11px] text-(--ui-text-warning)">
						{{ t("pages.scenario-simulator.linkDetail.statsUnavailable", { message: statsError }) }}
					</p>
					<table v-else-if="stats.rows.length" class="w-full text-left text-[11px]">
						<thead class="text-(--ui-text-muted)">
							<tr>
								<th class="font-normal">
									{{ t("pages.scenario-simulator.linkDetail.intf") }}
								</th>
								<th class="font-normal">
									TX
								</th>
								<th class="font-normal">
									RX
								</th>
							</tr>
						</thead>
						<tbody>
							<tr v-for="row in stats.rows" :key="row.name">
								<td class="font-mono">
									{{ row.name }}
								</td>
								<td class="font-mono">
									{{ row.txBytes === null ? "—" : row.txBytes }}
								</td>
								<td class="font-mono">
									{{ row.rxBytes === null ? "—" : row.rxBytes }}
								</td>
							</tr>
						</tbody>
					</table>
					<p v-else class="text-[11px] text-(--ui-text-muted)">
						{{ t("pages.scenario-simulator.linkDetail.statsEmpty") }}
					</p>
				</div>

				<!-- 只读原因（NMCPS-ADR-0022 W13 收尾）：没有 `lab:operate` 就只有读数，说清缺什么 -->
				<UAlert
					v-if="!operate"
					data-testid="lab-link-detail-readonly"
					color="neutral"
					variant="subtle"
					icon="carbon:information"
					:title="t('pages.scenario-simulator.linkDetail.readOnly')"
					:description="t('pages.scenario-simulator.linkDetail.readOnlySession')"
				/>

				<div v-if="operate" class="space-y-2 border-t border-(--ui-border) pt-3">
					<div class="grid grid-cols-2 gap-2">
						<UFormField
							:label="t('pages.scenario-simulator.linkDetail.bw')"
							:error="fieldError === 'bwInvalid' ? t('pages.scenario-simulator.linkDetail.errors.bwInvalid') : undefined"
						>
							<UInput v-model="draft.bw" data-testid="lab-link-detail-bw" size="sm" class="w-full" />
						</UFormField>
						<UFormField
							:label="t('pages.scenario-simulator.linkDetail.delay')"
							:error="fieldError === 'delayInvalid' ? t('pages.scenario-simulator.linkDetail.errors.delayInvalid') : undefined"
						>
							<UInput v-model="draft.delay" data-testid="lab-link-detail-delay" size="sm" class="w-full" />
						</UFormField>
						<UFormField
							:label="t('pages.scenario-simulator.linkDetail.jitter')"
							:error="fieldError === 'jitterInvalid' ? t('pages.scenario-simulator.linkDetail.errors.jitterInvalid') : undefined"
						>
							<UInput v-model="draft.jitter" data-testid="lab-link-detail-jitter" size="sm" class="w-full" />
						</UFormField>
						<UFormField
							:label="t('pages.scenario-simulator.linkDetail.loss')"
							:error="fieldError === 'lossInvalid' ? t('pages.scenario-simulator.linkDetail.errors.lossInvalid') : undefined"
						>
							<UInput v-model="draft.loss" data-testid="lab-link-detail-loss" size="sm" class="w-full" />
						</UFormField>
					</div>
					<!--
						`max_queue_size` / `use_htb` 只有 1.x 通道能改（会话 PATCH 对它们回 400，
						`NMCPS-ADR-0029` §3）：台账里有值就原样展示，不给必然失败的输入框。
					-->
					<p
						v-if="legacyOptions"
						data-testid="lab-link-detail-legacy"
						class="text-[11px] text-(--ui-text-muted)"
					>
						{{ t("pages.scenario-simulator.linkDetail.legacyOnly", { values: legacyOptions }) }}
					</p>
					<p class="text-[11px] text-(--ui-text-muted)">
						{{ t("pages.scenario-simulator.linkDetail.clearHint") }}
					</p>
				</div>

				<UAlert
					v-if="error"
					data-testid="lab-link-detail-error"
					color="error"
					variant="subtle"
					icon="carbon:warning-alt"
					:title="t('pages.scenario-simulator.linkDetail.failed')"
					:description="error"
				/>
			</div>
		</template>

		<template #footer>
			<UButton
				color="neutral"
				variant="ghost"
				:label="t('pages.scenario-simulator.linkDetail.close')"
				:disabled="submitting"
				@click="open = false"
			/>
			<UButton
				v-if="operate"
				data-testid="lab-link-detail-submit"
				color="primary"
				icon="carbon:save"
				:label="t('pages.scenario-simulator.linkDetail.save')"
				:loading="submitting"
				@click="submit"
			/>
		</template>
	</UModal>
</template>

<script setup lang="ts">
	import type {
		LabDetailFieldError,
		LabLinkDraft,
		LabLinkLiveStats
	} from "#layers/scenario/shared/types/labDetails";
	import {
		labLinkDraftOf,
		labLinkOptionsOf,
		labLinkStatsOf,
		labLinkUpdateError
	} from "#layers/scenario/shared/types/labDetails";

	/**
	 * 链路详情弹窗（`NMCPS-ADR-0022` W13 / `NMCPS-ADR-0029` M1.2）。
	 *
	 * 编辑只覆盖会话通道的四个可更新键（`bw` / `delay` / `jitter` / `loss`），请求体由
	 * `labLinkOptionsOf()` 组装：只带填过的属性，全空回 `undefined` → 这里不发请求。
	 * `max_queue_size` / `use_htb` 是 1.x 专用参数，只按台账原样展示。
	 */
	const props = defineProps<{
		link: { source: string, target: string, options: Record<string, unknown> } | null
		/** `lab:operate`：没有它就只有 tx/rx 读数 */
		operate: boolean
		submitting?: boolean
		error?: string
	}>();

	const emit = defineEmits<{ submit: [payload: { src: string, dst: string, options: Record<string, unknown> }] }>();

	const open = defineModel<boolean>("open", { required: true });
	const api = useApi();
	const { t } = useI18n();

	const draft = ref<LabLinkDraft>(labLinkDraftOf(null));
	const fieldError = ref<LabDetailFieldError>();
	const stats = ref<LabLinkLiveStats>(labLinkStatsOf(null));
	const statsError = ref<string>();
	const statsLoading = ref(false);

	const linkKey = computed(() => (props.link ? `${props.link.source}|${props.link.target}` : ""));

	/** 台账里仍留着的 1.x 专用参数（只读展示，会话通道不接收） */
	const legacyOptions = computed(() => {
		const source = props.link?.options ?? {};
		const parts: string[] = [];
		if (source.max_queue_size !== undefined)
			parts.push(`max_queue_size=${String(source.max_queue_size)}`);
		if (source.use_htb !== undefined)
			parts.push(`use_htb=${String(source.use_htb)}`);
		return parts.join(", ");
	});

	/** 每次打开（或换了链路）都重新起草稿，并读一次 tx/rx */
	watch([open, linkKey], ([value]) => {
		if (!value || !props.link)
			return;
		draft.value = labLinkDraftOf(props.link.options);
		fieldError.value = undefined;
		void loadStats();
	}, { immediate: true });

	watch(draft, () => {
		fieldError.value = undefined;
	}, { deep: true });

	async function loadStats(): Promise<void> {
		const link = props.link;
		stats.value = labLinkStatsOf(null);
		statsError.value = undefined;
		if (!link)
			return;
		statsLoading.value = true;
		try {
			const payload = await api.get<unknown>(
				`/api/mininet/links/stats/${encodeURIComponent(link.source)}/${encodeURIComponent(link.target)}`
			);
			stats.value = labLinkStatsOf(payload);
		} catch (caught) {
			// 网络没起 / 链路已删：读数降级成一行说明，编辑面照常
			statsError.value = caught instanceof Error ? caught.message : String(caught);
		} finally {
			statsLoading.value = false;
		}
	}

	function submit(): void {
		const link = props.link;
		if (!link || !props.operate)
			return;
		const failure = labLinkUpdateError(draft.value);
		fieldError.value = failure;
		if (failure)
			return;
		const options = labLinkOptionsOf(draft.value);
		// 全空 = 没改：不发一个只会清台账的请求（调用方也就不会出现「成功」的假象）
		if (!options)
			return;
		emit("submit", { src: link.source, dst: link.target, options });
	}
</script>
