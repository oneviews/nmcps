// shared/constants/labPermissions.ts
// 仿真网络（`/api/lab/**` + `/api/sim/**`）的权限矩阵 —— 纯函数，无 IO、无框架依赖。
//
// 设计基准：NMCPS-ADR-0021（layers/content/collections/cn/records/adr/adr-0021.md）
//   - D3：权限位与角色基线；
//   - D4：跨租户统一 404，因此这里只回答「能不能看」，不区分「不存在」和「别人的」；
//   - D5：平台管理员默认没有运行态权限；
//   - D8：角色解析失败必须失败关闭，不能把失败当成 `tenant_user`。
//
// 该文件是 BFF 守卫与页面能力位的唯一真源；后续 `/api/lab/**` / `/api/sim/**`
// 的鉴权实现必须调用这里的 `hasLabPermission()`，不得各自维护一份角色表。

/** 仿真网络权限位（字符串值与 ADR-0021 §4.3 一致） */
export const LAB_PERMISSIONS = {
	READ: "lab:read",
	CREATE: "lab:create",
	OPERATE: "lab:operate",
	DELETE: "lab:delete",
	TERMINAL: "lab:terminal",
	SNIFFER: "lab:sniffer"
} as const;

export type LabPermission = (typeof LAB_PERMISSIONS)[keyof typeof LAB_PERMISSIONS];

/** IAM 角色编码；只有编码不够，租户角色还必须匹配 `role.tenant_id`（UP-RBAC-09） */
export const LAB_ROLE_CODES = {
	TENANT_ADMIN: "tenant_admin",
	LAB_TERMINAL: "lab_terminal",
	LAB_SNIFFER: "lab_sniffer",
	PLATFORM_ADMIN: "platform_admin"
} as const;

export type LabRoleCode = (typeof LAB_ROLE_CODES)[keyof typeof LAB_ROLE_CODES];

/**
 * 角色授权输入。
 *
 * `tenantId` 为 `null` 表示平台角色；平台角色永远不会授予运行态权限（D5）。
 * `code` 用 `string` 而不是联合类型：上游可能返回未知角色，未知编码必须被忽略而不是报错。
 */
export interface LabRoleGrant {
	code: string
	tenantId: string | null
}

/** 已认证主体；`tenantId` 为 `null` 表示平台用户 */
export interface LabPrincipal {
	subjectId: string
	tenantId: string | null
	roles: readonly LabRoleGrant[]
}

/** 租户普通用户的默认权限（D3） */
export const LAB_TENANT_DEFAULT_PERMISSIONS: readonly LabPermission[] = [
	LAB_PERMISSIONS.READ
];

/** 租户管理员的默认权限；终端 / 抓包不在此列，必须单独授权 */
export const LAB_TENANT_ADMIN_PERMISSIONS: readonly LabPermission[] = [
	LAB_PERMISSIONS.READ,
	LAB_PERMISSIONS.CREATE,
	LAB_PERMISSIONS.OPERATE,
	LAB_PERMISSIONS.DELETE
];

function isNonEmpty(value: string | null): value is string {
	return typeof value === "string" && value.length > 0;
}

/** 是否为带租户的普通主体；平台用户（`tenantId: null`）不进入运行态 */
export function hasLabTenantScope(principal: LabPrincipal): boolean {
	return isNonEmpty(principal.tenantId);
}

/**
 * 计算主体在仿真域拥有的权限位。
 *
 * - 有租户 → 至少拥有 `lab:read`（D3 的租户普通用户默认值）；
 * - `tenant_admin` 仅在 `role.tenantId === principal.tenantId` 时生效；
 * - `lab_terminal` / `lab_sniffer` 只授予各自权限位，不隐含操作权限；
 * - `platform_admin` 与未知角色一律不授予任何权限；
 * - 平台主体（`tenantId: null`）返回空集合（D5）。
 */
export function labPermissionsOf(principal: LabPrincipal): ReadonlySet<LabPermission> {
	const permissions = new Set<LabPermission>();

	if (!hasLabTenantScope(principal)) {
		return permissions;
	}

	permissions.add(LAB_PERMISSIONS.READ);

	for (const role of principal.roles) {
		// 跨租户绑定（UP-RBAC-09）与平台角色都在这里被丢弃
		if (role.tenantId !== principal.tenantId) {
			continue;
		}

		switch (role.code) {
			case LAB_ROLE_CODES.TENANT_ADMIN:
				for (const permission of LAB_TENANT_ADMIN_PERMISSIONS) {
					permissions.add(permission);
				}
				break;
			case LAB_ROLE_CODES.LAB_TERMINAL:
				permissions.add(LAB_PERMISSIONS.TERMINAL);
				break;
			case LAB_ROLE_CODES.LAB_SNIFFER:
				permissions.add(LAB_PERMISSIONS.SNIFFER);
				break;
			default:
				// 未知角色 / platform_admin：不授予运行态权限
				break;
		}
	}

	return permissions;
}

/** 单权限位判定；调用方必须先把「无会话 / 角色解析失败」处理成 401 / 503 */
export function hasLabPermission(principal: LabPrincipal, permission: LabPermission): boolean {
	return labPermissionsOf(principal).has(permission);
}

/**
 * 多权限位判定：**全部满足**才为真（`full_reset` / `import_json` 的双权限，NMCPS-ADR-0022 D2）。
 *
 * 空列表按「无需权限」为真 —— 调用方不应拿它当「放行一切」的捷径，白名单里每条端点都带权限位，
 * `check:lab-tenancy` 断言这一点。角色集合只算一次，避免逐位重复 `labPermissionsOf()`。
 */
export function hasLabPermissions(
	principal: LabPrincipal,
	permissions: readonly LabPermission[]
): boolean {
	if (!permissions.length)
		return true;

	const granted = labPermissionsOf(principal);
	return permissions.every((permission) => granted.has(permission));
}

/** 资源可见性：只允许同租户；跨租户与不存在共用 404 语义（D4） */
export function canSeeLabNetwork(principal: LabPrincipal, networkTenantId: string): boolean {
	return hasLabTenantScope(principal) && principal.tenantId === networkTenantId;
}

/** 资源级权限：先判定租户归属，再判定权限位 */
export function canAccessLabNetwork(
	principal: LabPrincipal,
	networkTenantId: string,
	permission: LabPermission
): boolean {
	return canSeeLabNetwork(principal, networkTenantId) && hasLabPermission(principal, permission);
}
