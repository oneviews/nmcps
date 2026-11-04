<template>
	<UPopover :content="{ align: 'start' }" :modal="true">
		<UButton
			size="sm"
			color="neutral"
			variant="ghost"
			icon="carbon:time"
			class="group data-[state=open]:bg-elevated"
			:aria-label="$t('pages.system-log.filter.range.label')"
		>
			<span v-if="!compact" class="truncate">{{ props.label }}</span>

			<template v-if="!compact" #trailing>
				<UIcon
					name="carbon:chevron-down"
					class="size-4 shrink-0 text-dimmed transition-transform duration-200 group-data-[state=open]:rotate-180"
				/>
			</template>
		</UButton>

		<template #content>
			<div class="flex flex-col divide-y divide-default sm:flex-row sm:divide-x sm:divide-y-0">
				<!-- 快捷项列：窄屏隐藏（日历已占满），命中项用底色标出 -->
				<div class="hidden flex-col justify-center sm:flex">
					<UButton
						v-for="item in presetItems"
						:key="item.value"
						:label="item.label"
						color="neutral"
						variant="ghost"
						class="justify-start rounded-none px-4"
						:class="value.preset === item.value ? 'bg-elevated' : 'hover:bg-elevated/50'"
						truncate
						@click="selectPreset(item.value)"
					/>
				</div>

				<!-- 浮层宽度由内容决定：这里不能用 `w-0 flex-1`，否则两月视图会被压成 0 宽并互相重叠 -->
				<div class="min-w-0">
					<UCalendar
						v-model="calendarRange"
						class="p-2"
						:number-of-months="compact ? 1 : 2"
						range
					/>

					<!-- 精确到秒的补手：日历只能选「整天」，日内窗口靠这两个输入 -->
					<div class="grid gap-2 border-t border-default p-2 sm:grid-cols-2">
						<UFormField :label="$t('pages.system-log.filter.start')" size="sm">
							<UInput
								:model-value="value.start"
								type="datetime-local"
								size="sm"
								step="1"
								class="w-full"
								@update:model-value="setBoundary('start', $event)"
							/>
						</UFormField>

						<UFormField :label="$t('pages.system-log.filter.end')" size="sm">
							<UInput
								:model-value="value.end"
								type="datetime-local"
								size="sm"
								step="1"
								class="w-full"
								@update:model-value="setBoundary('end', $event)"
							/>
						</UFormField>
					</div>

					<UAlert
						v-if="reversed"
						class="m-2"
						color="warning"
						variant="subtle"
						icon="carbon:warning-alt"
						:description="$t('pages.system-log.filter.reversed')"
					/>
				</div>
			</div>
		</template>
	</UPopover>
</template>

<script setup lang="ts">
	import type { AuditRangePreset, AuditRangeValue } from "~~/layers/system/app/utils/auditDisplay";
	import { CalendarDate } from "@internationalized/date";

	/**
	 * 工具栏左区的时间范围控件（`NMCPS-DESIGN-005` §9.3 第 2 条）。
	 *
	 * 结构照 Nuxt UI dashboard 模板的 `HomeDateRangePicker`：触发按钮 = 图标 + 当前窗口摘要 +
	 * 会旋转的 chevron；浮层 = 左侧快捷项列 | 右侧 `UCalendar range` 日历，两段用 `divide-x` 分开。
	 * 差异只在本域语义上：
	 *
	 * - 快捷项不是「近 N 天」而是本页真实用的 `AUDIT_RANGE_PRESETS`（含 15 分钟 / 1 小时这种日内窗口，
	 *   日历选不出这种精度），点击后窗口按**本地时字面值**算（`auditQuickRange()`），不做时区换算；
	 * - 日历选「整日」→ 起点 `00:00:00`、终点 `23:59:59`（`auditDayBound()`；点一天 = 从那天起，
	 *   点第二天才收尾），日历下方保留两个 `datetime-local` 精确输入，日内区间仍可手填；
	 * - 三种入口（快捷项 / 日历 / 手填）都只改 `v-model` 里的 `start` / `end` / `preset`，
	 *   取值仍由页面既有的 `watch` 落地 —— 这里不自己发请求、不维护第二份状态。
	 */
	const props = defineProps<{
		/** 触发按钮上的文案：页面按当前窗口摘要生成，浮层收起时也必须一眼看出窗口（§9.3） */
		label: string
	}>();

	const value = defineModel<AuditRangeValue>({ required: true });

	const { t } = useI18n();

	/** 窄视口只留图标（文案进 `aria-label`），日历也从双月收成单月，否则浮层比屏幕还宽 */
	const compact = useMediaQuery("(max-width: 767px)");

	const presetItems = computed(() =>
		AUDIT_RANGE_PRESETS.map((preset) => ({
			value: preset,
			label: t(`pages.system-log.filter.range.${preset}`)
		}))
	);

	const reversed = computed(() => auditRangeReversed(value.value.start, value.value.end));

	/** `datetime-local` 值 → 日历用的 `CalendarDate`（只取日期段，本地时原样） */
	function toCalendarDate(input: string): CalendarDate | undefined {
		const matched = /^(\d{4})-(\d{2})-(\d{2})/.exec(input);
		if (!matched)
			return undefined;

		return new CalendarDate(Number(matched[1]), Number(matched[2]), Number(matched[3]));
	}

	/**
	 * 日历模型：读 = 从 `start` / `end` 反推日期；写 = 落成整天窗口（`00:00:00` … `23:59:59`）。
	 *
	 * 只点了第一天时 `end` 留空，而不是像参考实现那样补 `new Date()`：一来补「此刻」等于
	 * 静默把用户选的那天切掉半截，二来 reka 的区间选择一旦拿到**完整**区间就会把下一次点击
	 * 当成「重新开始」，留空才能继续点第二天收尾。
	 */
	const calendarRange = computed({
		get: () => ({
			start: toCalendarDate(value.value.start),
			end: toCalendarDate(value.value.end)
		}),
		set: (next: { start?: CalendarDate | null, end?: CalendarDate | null }) => {
			if (!next.start) {
				value.value = { start: "", end: "", preset: "all" };
				return;
			}

			value.value = {
				start: auditDayBound(next.start.toString(), "start"),
				end: next.end ? auditDayBound(next.end.toString(), "end") : "",
				preset: "custom"
			};
		}
	});

	/** 点快捷项：一次写全三个字段，页面 watcher 同一 tick 只触发一次请求 */
	function selectPreset(preset: AuditRangePreset): void {
		const { start, end } = auditQuickRange(preset);
		value.value = { start, end, preset };
	}

	/** 手填 `datetime-local`：值即上游要的字面窗口，命中项退化为 `custom` */
	function setBoundary(edge: "start" | "end", next: string | number | undefined): void {
		const text = typeof next === "string" ? next : "";
		value.value = edge === "start"
			? { ...value.value, start: text, preset: "custom" }
			: { ...value.value, end: text, preset: "custom" };
	}
</script>
