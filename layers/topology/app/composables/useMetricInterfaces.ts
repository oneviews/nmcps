// layers/topology/app/composables/useMetricInterfaces.ts
// 「接口列表」Tab 的取数内核（`NMCPS-CONTRACT-002` §6.9 的接口维度）。
//
// 端口**清单**来自 `/metric/device` 的 `lldp.ports`（有标识、无计数，见 `MetricDeviceLldp`），
// 但逐端口的**值**没有清单端点（没有 `topology/?subResources=device`，`interface_summary` 只有
// 计数），所以逐端口的行只能从 `/metric/datapoint` 的 `results` 里按 `ifIndex` 标签分组派生：
// 同一指标在不同 `ifIndex` 上是不同物理端口，这是上游给出的唯一端口取值维度。
//
// 三处刻意的克制：
//   · **不按名字猜 in / out**：哪条指标是入向、哪条是出向由用户在选择器里指定（候选来自该设备
//     自己的 `/metric/name` + 目录 join），命名约定不是契约事实；
//   · 两个方向都没选 ⇒ `rows` 为空且**不发数据点请求**（空 `metric_code` 是非法入参），
//     但候选清单照取，否则选择器无项可选；
//   · 同设备重取失败保留旧行（§6.7：清空等于把抖动升级成「没数据」），只在 `stale` 上标记。
import type { MetricInterfaceValue } from "~~/app/utils/chart/metricSeries";
import type { MetricCatalogItem, MetricDatapointData, MetricNameData, RawMetricItem } from "~~/shared/types/metric";
import { groupSeriesByInterface } from "~~/app/utils/chart/metricSeries";
import { buildMetricCatalog, selectableMetrics, toDefinitionMap } from "~~/app/utils/metric/metricCatalog";
import { metricCatalogDefinitions } from "~~/layers/topology/app/composables/useMetricSeries";

/** 时间窗与步长跟 `useMetricSeries` 同口径（近 1 小时 / 60s 一点）：两个面板的「当前值」才可比 */
const WINDOW_MS = 60 * 60 * 1000;
const STEP_SECONDS = 60;

/** 逐端口一行：同一 `ifIndex` 的入向 / 出向各一列 */
export interface MetricInterfaceRow {
	/** `ifIndex` 字符串；`""` = 所选指标没有接口维度（设备级），页面如实标注而不是当成端口 0 */
	ifIndex: string
	inbound: MetricInterfaceValue | null
	outbound: MetricInterfaceValue | null
}

export interface MetricInterfaceError {
	code: number
	message: string
}

/** 端口索引排序：两边都是纯数字就按数值（`2 < 10`），非数字键排后面，设备级 `""` 由调用方另放 */
function numericIndexOrder(a: string, b: string): number {
	const na = Number(a);
	const nb = Number(b);
	const fa = a !== "" && Number.isFinite(na);
	const fb = b !== "" && Number.isFinite(nb);

	if (fa && fb)
		return na - nb;
	if (fa !== fb)
		return fa ? -1 : 1;

	return a.localeCompare(b, "en");
}

/**
 * `ip` / 两个编码任一变化就重取。`ip` 为空（台账没给 `mgmt_ip`）⇒ 清空并停在这里，
 * 页面据此说明「这一屏为什么是空的」，而不是显示一个空白表格。
 */
export function useMetricInterfaces(
	ip: Ref<string>,
	inboundCode: Ref<string>,
	outboundCode: Ref<string>
) {
	const api = useApi();

	/** 该设备的可选指标（目录里 `selectable` 的条目）：选择器候选，不猜类型 */
	const catalog = ref<MetricCatalogItem[]>([]);
	/** 目录不可用（§8.4）：只提示一句，不当作取数失败 */
	const degraded = ref(false);
	const rows = ref<MetricInterfaceRow[]>([]);
	const loading = ref(false);
	const error = ref<MetricInterfaceError | null>(null);
	/** 同一设备重取失败但旧行还在（§6.7） */
	const stale = ref(false);
	/** 被丢弃的非法点数（`""` / `"NaN"` / `null`；不补 0，只计数） */
	const dropped = ref(0);

	const options = computed(() => selectableMetrics(catalog.value));

	/** 请求序号：快速换指标 / 换设备时，只有最后一次的响应能落盘 */
	let sequence = 0;
	/** 名字清单按设备缓存：换指标不重取清单 */
	let namesFor = "";
	let namesRaw: RawMetricItem[] = [];

	/** 取一条指标近 1 小时窗口内的**全部** `ifIndex` 组（不收敛成「第一组」）。空编码 ⇒ 空数组，不发请求 */
	async function loadGroups(target: string, code: string, token: number): Promise<MetricInterfaceValue[]> {
		if (!code)
			return [];

		const to = new Date();
		const from = new Date(to.getTime() - WINDOW_MS);

		const data = await api.get<MetricDatapointData>("/api/metric/datapoint", {
			query: {
				mode: "range",
				mgmt_ip: target,
				metric_code: code,
				from: from.toISOString(),
				to: to.toISOString(),
				step: STEP_SECONDS
			}
		});

		if (token !== sequence)
			return [];

		return groupSeriesByInterface(data?.results);
	}

	async function load(): Promise<void> {
		const target = ip.value.trim();
		const token = ++sequence;
		const inbound = inboundCode.value.trim();
		const outbound = outboundCode.value.trim();

		if (!target) {
			rows.value = [];
			dropped.value = 0;
			error.value = null;
			stale.value = false;
			loading.value = false;
			catalog.value = [];
			degraded.value = false;
			namesFor = "";
			namesRaw = [];
			return;
		}

		/*
		 * 两个方向都没选：照样把**候选列表**取回来（否则选择器永远是空的、用户根本没有可选的项 ——
		 * 2026-11-08 自查发现：这里原本连目录 / 名字一起跳过，`options` 恒空、两个下拉恒 `disabled`）。
		 * 不发的是**数据点**请求：`loadGroups` 对空编码直接返回，空 `metric_code` 不会出网。
		 */
		loading.value = true;
		error.value = null;

		try {
			const definitions = await metricCatalogDefinitions(api);
			if (token !== sequence)
				return;

			if (namesFor !== target) {
				const names = await api.get<MetricNameData>("/api/metric/name", { query: { mgmt_ip: target } });
				if (token !== sequence)
					return;

				namesFor = target;
				namesRaw = names?.metrics ?? [];
			}

			const built = buildMetricCatalog(namesRaw, definitions ? toDefinitionMap(definitions) : null);
			catalog.value = built.items;
			degraded.value = built.degraded;

			const [inGroups, outGroups] = await Promise.all([
				loadGroups(target, inbound, token),
				loadGroups(target, outbound, token)
			]);
			if (token !== sequence)
				return;

			/** 两个方向按 `ifIndex` 对齐：任一侧有值就出一行，缺的一侧显示 `—`（不补 0） */
			const merged = new Map<string, MetricInterfaceRow>();
			const slot = (key: string): MetricInterfaceRow => {
				const current = merged.get(key);
				if (current)
					return current;

				const created: MetricInterfaceRow = { ifIndex: key, inbound: null, outbound: null };
				merged.set(key, created);
				return created;
			};

			for (const item of inGroups)
				slot(item.ifIndex).inbound = item;

			for (const item of outGroups)
				slot(item.ifIndex).outbound = item;

			/** 端口按数值升序；设备级组（`""`）排在末尾并如实标注，不混进端口序列假装是 `ifIndex = 0` */
			const list = [...merged.values()].sort((a, b) => numericIndexOrder(a.ifIndex, b.ifIndex));
			rows.value = [...list.filter((row) => row.ifIndex !== ""), ...list.filter((row) => row.ifIndex === "")];
			dropped.value = rows.value.reduce((sum, row) => sum + (row.inbound?.dropped ?? 0) + (row.outbound?.dropped ?? 0), 0);
			stale.value = false;
		} catch (raw) {
			if (token !== sequence)
				return;

			const { code, message } = raw as Partial<MetricInterfaceError>;
			error.value = { code: code ?? 0, message: message ?? "api_network_error" };
			stale.value = rows.value.length > 0;

			/** 换设备失败 ⇒ 上一个设备的分组会把新设备的「无数据」扮成有数据，必须清掉 */
			if (namesFor !== target) {
				rows.value = [];
				dropped.value = 0;
			}
		} finally {
			if (token === sequence)
				loading.value = false;
		}
	}

	watch([ip, inboundCode, outboundCode], () => void load(), { immediate: true });

	return {
		/** 选择器候选（目录里可选的那些） */
		options,
		/** 目录不可用（§8.4） */
		degraded,
		rows,
		loading,
		error,
		stale,
		dropped,
		reload: load
	};
}
