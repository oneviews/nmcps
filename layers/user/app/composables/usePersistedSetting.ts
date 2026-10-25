// layers/user/app/composables/usePersistedSetting.ts
// 通用「Cookie 持久化 + 类型守卫」偏好设置。
// 消除 useColorTheme / useFontScale / useVisualStyle 重复的 useCookie + isXxx 校验 + computed 样板。
import type { WritableComputedRef } from "vue";

export interface PersistedSettingOptions<T> {
	/** Cookie 名 */
	key: string
	/** 默认值（Cookie 值非法时回退） */
	default: T
	/** 类型守卫：校验 Cookie 值是否合法 */
	validate: (value: unknown) => value is T
	/** 设置时的副作用（写 CSS 变量 / appConfig 等） */
	onSet?: (value: T) => void
	/** Cookie 有效期（秒），默认 1 年 */
	maxAge?: number
}

export function usePersistedSetting<T>(options: PersistedSettingOptions<T>): WritableComputedRef<T> {
	const { key, default: defaultValue, validate, onSet, maxAge = 60 * 60 * 24 * 365 } = options;

	const cookie = useCookie<T>(key, {
		default: () => defaultValue,
		maxAge,
		sameSite: "lax"
	});

	return computed<T>({
		get: () => (validate(cookie.value) ? cookie.value : defaultValue),
		set: (value) => {
			cookie.value = value;
			onSet?.(value);
		}
	});
}
