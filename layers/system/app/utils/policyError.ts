// layers/system/app/utils/policyError.ts
// 策略 / 权限两页（`/system/policy`、`/system/permission`）的错误码 → i18n 键映射与展示口径。
//
// 设计基准：NMCPS-DESIGN-005 §7.4 / §8.4（layers/content/collections/cn/architecture/2.domain/system.md）
// 缺陷背景：NMCPS-REC-003（内置角色只读 `40305`、缺参 `500 10509`、无规则生命周期端点）。
import { PERMISSION_RESOURCE_TYPE, POLICY_STATUS } from "~~/shared/types/policy";

/** 两页各自的 i18n 命名空间（`errors.*` 与枚举标签都挂在下面） */
export type PolicyErrorNamespace = "pages.system-policy" | "pages.system-permission";

/**
 * 上游业务码 → i18n 键。
 *
 * 返回 `undefined` 表示「不是已登记的业务码」：调用方回落到上游原文（不吞信息），
 * 运维类失败（未配置 / 掉线 / 超时）沿用 `upstreamHintKey()`。
 *
 * 已登记码来自 2026-11-01 实测：
 * - `10201` 未认证 / 域拒绝（超级管理员调策略域端点）
 * - `10301` 目标不存在（角色编码打错 / 已删除）
 * - `10302` 资源冲突（`roleCode` 重复）
 * - `20103` 只能向下管控（建同级或更高等级的角色）
 * - `40303` 内置角色禁止删除
 * - `40305` / `40307` 内置角色为共享只读模板，不可修改授权（授权回 `40307`、撤销回 `40305`，同一条文案）
 * - `40308` 角色级别越界（仅允许 L0–L4）
 * - `10509` 系统内部错误（缺必填字段）
 */
export function policyErrorKey(error: unknown, namespace: PolicyErrorNamespace): string | undefined {
	if (!(error instanceof ApiError))
		return undefined;

	const hint = upstreamHintKey(error);
	if (hint)
		return hint;

	switch (error.code) {
		case 10201:
			return `${namespace}.errors.forbidden`;
		case 10301:
			return `${namespace}.errors.notFound`;
		case 10302:
			return `${namespace}.errors.duplicateCode`;
		case 20103:
			return `${namespace}.errors.escalation`;
		case 40303:
			return `${namespace}.errors.builtinDelete`;
		case 40305:
		case 40307:
			return `${namespace}.errors.builtinLocked`;
		case 40308:
			return `${namespace}.errors.levelOutOfRange`;
		case 10101:
			return `${namespace}.errors.invalidParam`;
		case 10509:
			return `${namespace}.errors.internal`;
		case 0:
			return `${namespace}.errors.network`;
		default:
			return undefined;
	}
}

/** 权限点资源类型 → i18n 键（`1`–`8` 之外的取值走 `unknown`，不猜语义） */
export function resourceTypeKey(resourceType: number): string {
	switch (resourceType) {
		case PERMISSION_RESOURCE_TYPE.TENANT:
			return "pages.system-permission.resourceType.tenant";
		case PERMISSION_RESOURCE_TYPE.DEVICE_GROUP:
			return "pages.system-permission.resourceType.deviceGroup";
		case PERMISSION_RESOURCE_TYPE.DEVICE:
			return "pages.system-permission.resourceType.device";
		case PERMISSION_RESOURCE_TYPE.API:
			return "pages.system-permission.resourceType.api";
		case PERMISSION_RESOURCE_TYPE.METRIC:
			return "pages.system-permission.resourceType.metric";
		case PERMISSION_RESOURCE_TYPE.MIB:
			return "pages.system-permission.resourceType.mib";
		case PERMISSION_RESOURCE_TYPE.ALERT:
			return "pages.system-permission.resourceType.alert";
		case PERMISSION_RESOURCE_TYPE.FIELD:
			return "pages.system-permission.resourceType.field";
		default:
			return "pages.system-permission.resourceType.unknown";
	}
}

/**
 * 权限点 / 规则状态 → i18n 键。
 *
 * 只登记实测的 `1`（生效）/ `2`（停用）；其余取值走 `unknown` —— 上游接受任意整数，
 * 把 `3` 说成「已删除」是编故事。
 */
export function policyStatusKey(status: number, namespace: PolicyErrorNamespace): string {
	if (status === POLICY_STATUS.ENABLED)
		return `${namespace}.status.enabled`;
	if (status === POLICY_STATUS.DISABLED)
		return `${namespace}.status.disabled`;

	return `${namespace}.status.unknown`;
}

/** 状态 → badge 颜色：生效绿、停用中性、未登记黄（提示需要人工确认） */
export function policyStatusColor(status: number): "success" | "neutral" | "warning" {
	if (status === POLICY_STATUS.ENABLED)
		return "success";
	if (status === POLICY_STATUS.DISABLED)
		return "neutral";

	return "warning";
}
