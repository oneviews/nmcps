// app/composables/useRecordContext.ts
// 面包屑「记录段」通道（NMCPS-ARCH-006 §5.1 / §5.3）。
//
// 两段来源不同，禁止合并成一个由页面手写的数组：
//   - 路由段：`useNavigation().breadcrumb` 由路由表 `meta.sort` / `meta.name` 推导，页面不得改写；
//   - 记录段：页面声明的「当前选中记录」展示名，只追加在末位，无 `to`，点击 = 清除选择。
//
// 页面侧只需 `useRecordContext(label)` 绑定一次响应式来源，标签随 `pending → loaded` 自动更新
// （加载中显示编号、加载完成显示展示名），**不要**为此手写 watch 重注入。
// 工具栏侧（`AppToolbar`）不传参读取。
//
// 为什么用 `useState` 而不是 provide/inject：布局层是页面的祖先，provide 只能向下流，
// 跨不到工具栏；又因为 `usePageToolbar` 的模块级 `shallowRef` 已被 ARCH-006 §4.3 判为反模式
// （多写入者），这里用带 `path` 守卫的 app 级 state，切页后旧记录名不会挂在新页面上。
//
// 设计基准：NMCPS-ARCH-006（layers/content/collections/cn/architecture/1.architecture/ui-architecture.md）
import type { ComputedRef, MaybeRefOrGetter, Ref } from "vue";

interface RecordContextState {
	/** 写入时所在的路由路径：只有同位路由才把这段记录名挂到面包屑上 */
	path: string
	label: string
}

const STATE_KEY = "record-context-label";
const CLEAR_KEY = "record-context-clear-requests";

export interface RecordContext {
	/** 记录段文案：只在写入它的那条路由上生效，切页即视为不存在 */
	recordLabel: ComputedRef<string | undefined>
	/** 「清除选择」请求计数：记录段被点击时 +1，页面 `watch` 它去清 URL（§5.1：记录段点击 = 清除选择） */
	clearRequests: Ref<number>
	/** 请求清除选择（由工具栏的记录段按钮调用） */
	clearRecord: () => void
}

/**
 * @param label 页面侧的「当前记录标签」响应式来源；不传表示只读取（工具栏 / 面包屑渲染方）
 */
export function useRecordContext(label?: MaybeRefOrGetter<string | undefined>): RecordContext {
	const route = useRoute();
	const state = useState<RecordContextState | null>(STATE_KEY, () => null);
	const clearRequests = useState<number>(CLEAR_KEY, () => 0);

	const recordLabel = computed(() =>
		state.value && state.value.path === route.path ? state.value.label : undefined);

	/** 绑定时的路径：页面卸载时只在「仍然属于自己」的情况下清空，避免把下一张页面写进去的记录名抹掉 */
	const boundPath = route.path;

	if (label !== undefined) {
		watchEffect(() => {
			const text = toValue(label)?.trim();
			state.value = text ? { path: boundPath, label: text } : null;
		});

		onScopeDispose(() => {
			if (state.value?.path === boundPath)
				state.value = null;
		});
	}

	function clearRecord(): void {
		state.value = null;
		clearRequests.value += 1;
	}

	return { recordLabel, clearRequests, clearRecord };
}
