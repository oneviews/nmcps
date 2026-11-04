// shared/constants/paging.ts
// 列表栏每页条数的**唯一来源**（NMCPS-ARCH-006 §3.8）。
//
// 设计基准：NMCPS-ARCH-006（layers/content/collections/cn/architecture/1.architecture/ui-architecture.md）
//
// 为什么单独抽常量：四个列表页（/system/user、/system/policy、/system/permission、/system/log）
// 各写一份 `ref(20)` + 一份选项数组，实测已经漂移成「三页 20、一页没有入口」。
// 选项上限 100 与取数层的夹取一致（`AUDIT_MAX_PAGE_SIZE` / `MAX_PAGE_SIZE`），再大只会被上游截断。
//
// 约束：纯数据，无 Nuxt 别名、无副作用。

/** 默认每页条数（用户口径：15 条一屏） */
export const DEFAULT_PAGE_SIZE = 15;

/** 每页条数选项：默认值必须在此列表内，否则选择器会显示空值 */
export const PAGE_SIZE_OPTIONS = [15, 30, 50, 100] as const;

/** `USelect` 用的 `{ label, value }` 形态（文案由调用方按 locale 生成） */
export function pageSizeItems(label: (size: number) => string): { label: string, value: number }[] {
	return PAGE_SIZE_OPTIONS.map((size) => ({ label: label(size), value: size }));
}
