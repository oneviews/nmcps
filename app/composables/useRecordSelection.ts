// app/composables/useRecordSelection.ts
// 记录选择契约（NMCPS-ARCH-006 §5.2 / NMCPS-ADR-0017 D2）：当前选中记录的唯一事实源是 URL query `?id=<记录标识>`。
//
// 只做三件事：
//   1) 读 `?id`，并**只在列表当前页 `rows` 里**做命中判定（上游没有详情端点的域，列表结果是唯一可靠来源）；
//   2) 写 `?id`：两栏形态 `replace`（点选是「查看」，不该污染浏览器历史）、覆盖式 `push`（系统返回键要能回列表）；
//   3) 两栏形态的默认选中（与列表展示顺序同源，只执行一次）。
//
// 两条硬约束（改之前先改 ARCH-006 §5.2）：
//   - `?id` **不参与**任何列表请求键：深链与筛选是两件事，改选中不得触发重新拉列表；
//   - `?id` 不在当前 `rows` 时**不发详情请求**、不静默翻页去捞 —— 只把 `isMissing` 交给页面渲染空态，
//     因为静默翻页会让筛选状态与 URL 不一致。
//
// 设计基准：NMCPS-ARCH-006（layers/content/collections/cn/architecture/1.architecture/ui-architecture.md）
import type { ComputedRef, MaybeRefOrGetter } from "vue";

export interface RecordSelectionOptions<T> {
	/** 列表当前页数据（响应式）：命中判定的唯一来源 */
	rows: MaybeRefOrGetter<T[] | undefined>
	/** 记录标识：写入 `?id`（如 `accountCode`） */
	getId: (record: T) => string
	/** 记录展示名（面包屑记录段 / 详情标题）；缺省回落 `getId` */
	getLabel?: (record: T) => string
	/** 列表是否在加载：决定「`?id` 不在当前 rows」这句空态是否可以说出口 */
	isLoading?: MaybeRefOrGetter<boolean>
	/** 覆盖式形态（`true` → `push`）：由页面把 `Layout/Split.vue` 的形态传进来 */
	isOverlay?: MaybeRefOrGetter<boolean>
	/** URL 参数名，默认 `id` */
	queryKey?: string
	/** 两栏形态自动落选中；默认关 —— 单栏页没有右栏可看，开了只剩面包屑在变 */
	autoSelect?: MaybeRefOrGetter<boolean>
	/** 默认选中项：必须与列表展示顺序同源（同一 `sortKey`）；缺省取 `rows[0]` */
	defaultRecord?: (rows: T[]) => T | undefined
	/**
	 * 「新建」占位标识（如 `new`）：与 `?id` 命中同一比较，命中时进入 create 态，
	 * 不参与 `rows` 命中判定、也不触发「不在当前结果内」空态（NMCPS-ADR-0017 D6）。
	 */
	createId?: string
}

export interface RecordSelection<T> {
	/** URL 里的记录标识（未选中为 `undefined`） */
	selectedId: ComputedRef<string | undefined>
	/** 命中 `rows` 的当前记录；不在 `rows` 里就是 `undefined`（不发起详情请求） */
	selected: ComputedRef<T | undefined>
	/** `?id` 有值但不在当前 `rows`（且列表已加载完）：右栏空态「不在当前筛选 / 分页结果内」 */
	isMissing: ComputedRef<boolean>
	/** `?id` 命中 `createId`：右栏落 `create` 态（表单为空，未落库） */
	isCreating: ComputedRef<boolean>
	/** 面包屑记录段文案：加载中显示编号，加载完成显示展示名 */
	label: ComputedRef<string | undefined>
	/** 选中一条记录（两栏 `replace` / 覆盖式 `push`） */
	select: (record: T) => void
	/** 直接写标识（`create` 成功后把占位标识换成真实标识） */
	set: (id: string | undefined) => void
	/** 清除选择（面包屑记录段点击 / 覆盖式「返回列表」） */
	clear: () => void
}

export function useRecordSelection<T>(options: RecordSelectionOptions<T>): RecordSelection<T> {
	const route = useRoute();
	const router = useRouter();

	const queryKey = options.queryKey ?? "id";

	/** `?id` 只接受单值字符串：数组 / 空串一律当「未选中」 */
	const selectedId = computed<string | undefined>(() => {
		const raw = route.query[queryKey];
		const value = Array.isArray(raw) ? raw[0] : raw;

		return typeof value === "string" && value.trim() ? value.trim() : undefined;
	});

	const rows = computed<T[]>(() => toValue(options.rows) ?? []);
	const isLoading = computed(() => toValue(options.isLoading) ?? false);
	const isOverlay = computed(() => toValue(options.isOverlay) ?? false);

	const selected = computed<T | undefined>(() => {
		const id = selectedId.value;

		return id ? rows.value.find((record) => options.getId(record) === id) : undefined;
	});

	const labelOf = (record: T): string => options.getLabel?.(record) ?? options.getId(record);

	/**
	 * 列表至少完整加载过一次才允许说「不在当前结果内」：
	 * 首屏 `loading` 从 `false` 起步，没有这个门槛，深链会在数据到达前闪一下空态。
	 */
	const listSettled = ref(false);
	/** 是否见过一次 `loading = true`：没有这个标志，首屏 `false` 会被误判成「已加载完」 */
	const sawLoading = ref(false);

	watch(isLoading, (value) => {
		if (value) {
			sawLoading.value = true;
			return;
		}

		if (sawLoading.value)
			listSettled.value = true;
	});

	watchEffect(() => {
		if (rows.value.length > 0)
			listSettled.value = true;
	});

	/** `?id` 命中 `createId` → create 态：既不是命中记录，也不是「记录丢失」 */
	const isCreating = computed(() => !!options.createId && selectedId.value === options.createId);

	const isMissing = computed(() =>
		!!selectedId.value
		&& !isCreating.value
		&& !selected.value
		&& !isLoading.value
		&& listSettled.value
	);

	const label = computed(() => (selected.value ? labelOf(selected.value) : selectedId.value));

	/** 写 `?id`：保留其余 query 与 hash，形态决定 `replace` / `push` */
	function set(id: string | undefined): void {
		const next = { ...route.query };

		if (id)
			next[queryKey] = id;
		else
			delete next[queryKey];

		const location = { path: route.path, query: next, hash: route.hash };

		// 同一个标识不重复写：覆盖式下重复 push 会往历史里塞一条无意义的「当前页」
		if (id !== selectedId.value) {
			if (isOverlay.value)
				void router.push(location);
			else
				void router.replace(location);
		}
	}

	function select(record: T): void {
		set(options.getId(record));
	}

	function clear(): void {
		set(undefined);
	}

	/**
	 * 默认选中：两栏形态落第一条，只执行一次（`settled` 标志）。
	 * 深链优先：带 `?id` 进来时同样标记已执行，之后用户主动清除选择不会再自动选中。
	 */
	const settled = ref(false);

	watchEffect(() => {
		if (settled.value || !toValue(options.autoSelect) || isOverlay.value)
			return;
		if (isLoading.value || rows.value.length === 0)
			return;

		settled.value = true;

		if (selectedId.value)
			return;

		const first = options.defaultRecord?.(rows.value) ?? rows.value[0];
		if (first)
			select(first);
	});

	return { selectedId, selected, isMissing, isCreating, label, select, set, clear };
}
