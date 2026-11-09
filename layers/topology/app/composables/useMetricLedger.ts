// layers/topology/app/composables/useMetricLedger.ts
// 指标台账取数（`NMCPS-CONTRACT-002` §九）：`/metric/device` 与 `/metric/link` 分页拉取。
//
// 为什么单独一层而不复用列表页的 `useCrudList`：台账是**只读事实表**（没有新建 / 编辑 / 删除），
// 两栏页只关心「翻页 + 当前页事实 + 错误重试」，引入写通道反而要为它准备一堆永远不调用的状态。
//
// 语义（与 `NMCPS-ARCH-006` §3.4 列表失败口径一致）：失败保留上一次成功的行并给 `error`，
// 页面据 `rows.length > 0 && error` 显示「可能不是最新」，而不是把已经看到的行清空成空态。
import type { MetricLedgerData } from "~~/shared/types/metric";

/** 台账端点：设备事实 / 链路事实（§九） */
export type MetricLedgerEndpoint = "/api/metric/device" | "/api/metric/link";

/** 失败信息：`message` 是上游原话（数据，不翻译） */
export interface MetricLedgerError {
	code: number
	message: string
}

/** 台账每页条数：50 条足够一屏滚动，也不至于让左栏一次渲染上千行 */
const LEDGER_PAGE_SIZE = 50;

export interface MetricLedgerOptions {
	/** 每页条数（默认 50）；链路页的 `device_code → mgmt_ip` 索引一次取 200 条 */
	pageSize?: number
}

export function useMetricLedger<TFact>(endpoint: MetricLedgerEndpoint, options: MetricLedgerOptions = {}) {
	const api = useApi();

	/** 当前页原始事实（归一成行在页面里做：设备与链路的行形状不同） */
	const facts = ref<TFact[]>([]) as Ref<TFact[]>;
	const page = ref(1);
	const pageSize = ref(options.pageSize ?? LEDGER_PAGE_SIZE);
	/** 命中总数（信封 `total`，不是本页条数） */
	const total = ref(0);
	const loading = ref(false);
	const error = ref<MetricLedgerError | null>(null);

	/** 请求序号：连点翻页时只有最后一次响应能落盘 */
	let sequence = 0;

	const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));

	async function load(): Promise<void> {
		const token = ++sequence;
		loading.value = true;

		try {
			const data = await api.get<MetricLedgerData<TFact>>(endpoint, {
				query: { page: page.value, page_size: pageSize.value }
			});
			if (token !== sequence)
				return;

			facts.value = data?.list ?? [];
			total.value = typeof data?.total === "number" ? data.total : facts.value.length;
			error.value = null;
		} catch (raw) {
			if (token !== sequence)
				return;

			const { code, message } = raw as Partial<MetricLedgerError>;
			error.value = { code: code ?? 0, message: message ?? "api_network_error" };
		} finally {
			if (token === sequence)
				loading.value = false;
		}
	}

	/**
	 * 取**指定页**且不改当前页状态（深链解析用，`metricDeepLink.resolveDeepLink()`）。
	 *
	 * 为什么不复用 `load()`：那会把用户看到的页码挪走。这里也不碰 `sequence` —— 用户正在翻页时
	 * 扫描不应该把那次请求判成过期。失败返回 `null`（扫描就此停止，见 `resolveDeepLink()` 的约定）。
	 */
	async function fetchPage(target: number): Promise<TFact[] | null> {
		try {
			const data = await api.get<MetricLedgerData<TFact>>(endpoint, {
				query: { page: target, page_size: pageSize.value }
			});
			return data?.list ?? [];
		} catch {
			return null;
		}
	}

	/** 翻页 / 改页大小都重取；`?id` 不参与请求键（`NMCPS-ARCH-006` §5.2） */
	watch([page, pageSize], () => void load());
	onMounted(() => void load());

	return {
		facts,
		page,
		pageSize,
		total,
		pageCount,
		loading,
		error,
		reload: load,
		/** 深链解析专用：按页取事实，不动当前页 */
		fetchPage
	};
}
