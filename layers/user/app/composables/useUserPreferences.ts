// layers/user/app/composables/useUserPreferences.ts
// 用户偏好全局状态：偏好设置抽屉开关（Header 按钮与 Slideover 共享）。
import type { Ref } from "vue";

export interface UserPreferencesState {
	/** 偏好设置抽屉开关（Header 按钮与 Slideover 共享） */
	isPreferencesOpen: Ref<boolean>
}

export function useUserPreferences(): UserPreferencesState {
	const isPreferencesOpen = useState<boolean>("user-preferences-open", () => false);

	return { isPreferencesOpen };
}
