// layers/scenario/shared/types/labPreferences.ts
// 实验台偏好（复刻旧 `NetworkGraph.vue`「文件 → 设置」弹窗里仍未被他处覆盖的两项：
// 默认 OpenFlow 版本与默认链路属性）。
//
// 旧弹窗的其余字段在 2.0 已有归属，不再重复一份：
// - 语言 / 主题 → 全局布局（`AppHeader`）；
// - 显示主机 / 控制器 / 主机 IP / 名称 → 工具栏「视图」菜单；
// - 默认交换机类型 → 新增节点表单的默认值，这里也一并作为偏好。
//
// 本文件只做「数据形状 + 归一化」，读写 localStorage 由页面负责（纯函数便于断言）。

import type { LabSwitchType } from "./labNodes";
import { LAB_OPENFLOW_VERSIONS, LAB_SWITCH_TYPES } from "./labNodes";

/** localStorage 键：只在实验台页面读写，不参与 SSR（页面是 client-only 用法） */
export const LAB_PREFERENCES_KEY = "nmcps:lab:preferences";

/** 链路默认属性：空值表示「不设置」，与上游 `LinkOptions` 的可空字段一一对应 */
export interface LabLinkDefaults {
	/** 带宽（Mbit） */
	bw: number | null
	/** 延迟（毫秒，整数发给上游后由它加 `ms`） */
	delay: number | null
	/** 抖动（毫秒） */
	jitter: number | null
	/** 丢包率（百分比） */
	loss: number | null
}

export interface LabPreferences {
	switchType: LabSwitchType
	/** `"auto"` = 跟随上游默认（建交换机时不带 `of_version`） */
	openflow: string
	link: LabLinkDefaults
}

/** 缺省偏好：与新增节点表单此前的硬编码默认值一致（ovskernel / 跟随默认 / 无链路属性） */
export function labPreferencesOf(): LabPreferences {
	return {
		switchType: LAB_SWITCH_TYPES[0],
		openflow: "auto",
		link: { bw: null, delay: null, jitter: null, loss: null }
	};
}

function numberOrNull(value: unknown): number | null {
	// 数字输入被清空时 `v-model.number` 给的是空串：那表示「不设置」，
	// 不能落成 0（带宽 0 在上游是「限速到零」，不是「不限制」）
	if (value === null || value === undefined || value === "")
		return null;
	const parsed = typeof value === "number" ? value : Number(value);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * 归一化任意来源（localStorage 的 JSON 字符串 / 已解析对象 / 损坏内容）。
 *
 * 越界值一律回落成 `null` / 默认项，而不是抛错：偏好是「方便」而不是「事实」，
 * 读到脏数据时页面应当照常可用。
 */
export function labPreferencesFrom(raw: unknown): LabPreferences {
	let value: unknown = raw;
	if (typeof raw === "string") {
		try {
			value = JSON.parse(raw);
		} catch {
			return labPreferencesOf();
		}
	}
	if (!value || typeof value !== "object")
		return labPreferencesOf();

	const source = value as Partial<LabPreferences> & { link?: Partial<LabLinkDefaults> };
	const base = labPreferencesOf();
	const switchType = LAB_SWITCH_TYPES.find((item) => item === source.switchType) ?? base.switchType;
	const openflow = source.openflow === "auto"
		|| (LAB_OPENFLOW_VERSIONS as readonly string[]).includes(String(source.openflow))
		? String(source.openflow)
		: base.openflow;

	return {
		switchType,
		openflow,
		link: {
			bw: numberOrNull(source.link?.bw),
			delay: numberOrNull(source.link?.delay),
			jitter: numberOrNull(source.link?.jitter),
			loss: numberOrNull(source.link?.loss)
		}
	};
}

/** 建交换机时要带的 `of_version`：`"auto"` → `null`（上游按默认处理） */
export function labPreferencesOpenflow(prefs: LabPreferences): string | null {
	return prefs.openflow === "auto" ? null : prefs.openflow;
}

/**
 * 建链路时要带的 `options`：全部为空时返回 `undefined`。
 *
 * 一旦带上 `options`，上游会用 `TCLink` 建链（需要 `tc` 权限）；默认全空，
 * 因此「什么都不设」与改动前的行为完全一致。
 */
export function labPreferencesLinkOptions(prefs: LabPreferences): Record<string, number> | undefined {
	const options: Record<string, number> = {};
	for (const [key, value] of Object.entries(prefs.link)) {
		if (typeof value === "number" && Number.isFinite(value))
			options[key] = value;
	}
	return Object.keys(options).length ? options : undefined;
}
