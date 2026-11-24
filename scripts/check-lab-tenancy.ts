// scripts/check-lab-tenancy.ts
// 仿真网络权限矩阵自查（NMCPS-ADR-0021 P0）。
//
// 运行：pnpm check:lab-tenancy
// 该脚本只验证 shared/constants/labPermissions.ts 的纯函数；不启动 Nitro，也不访问上游。
import type { LabPrincipal, LabRoleGrant } from "../shared/constants/labPermissions.ts";
import assert from "node:assert/strict";
import process from "node:process";
import { MININET_ROUTES } from "../layers/scenario/shared/constants/mininetRoutes.ts";
import {
	canAccessLabNetwork,
	canSeeLabNetwork,
	hasLabPermission,
	LAB_PERMISSIONS,
	LAB_ROLE_CODES,
	labPermissionsOf
} from "../shared/constants/labPermissions.ts";

let pass = 0;
let fail = 0;

function check(name: string, fn: () => void): void {
	try {
		fn();
		pass++;
		console.log(`  ✅ ${name}`);
	} catch (error) {
		fail++;
		const message = error instanceof Error ? error.message : String(error);
		console.log(`  ❌ ${name}\n     ${message}`);
	}
}

function principal(tenantId: string | null, roles: LabRoleGrant[] = []): LabPrincipal {
	return { subjectId: "u_test", tenantId, roles };
}

console.log("仿真网络权限矩阵（NMCPS-ADR-0021）\n");

check("租户普通用户默认拥有 lab:read", () => {
	const user = principal("t_a");
	assert.equal(hasLabPermission(user, LAB_PERMISSIONS.READ), true);
});

check("租户普通用户没有 lab:create / lab:operate / lab:delete", () => {
	const user = principal("t_a");
	assert.equal(hasLabPermission(user, LAB_PERMISSIONS.CREATE), false);
	assert.equal(hasLabPermission(user, LAB_PERMISSIONS.OPERATE), false);
	assert.equal(hasLabPermission(user, LAB_PERMISSIONS.DELETE), false);
});

check("租户普通用户没有 terminal / sniffer", () => {
	const user = principal("t_a");
	assert.equal(hasLabPermission(user, LAB_PERMISSIONS.TERMINAL), false);
	assert.equal(hasLabPermission(user, LAB_PERMISSIONS.SNIFFER), false);
});

check("同租户 tenant_admin 获得 create / operate / delete", () => {
	const admin = principal("t_a", [{ code: LAB_ROLE_CODES.TENANT_ADMIN, tenantId: "t_a" }]);
	assert.equal(hasLabPermission(admin, LAB_PERMISSIONS.CREATE), true);
	assert.equal(hasLabPermission(admin, LAB_PERMISSIONS.OPERATE), true);
	assert.equal(hasLabPermission(admin, LAB_PERMISSIONS.DELETE), true);
});

check("tenant_admin 不隐含 terminal / sniffer", () => {
	const admin = principal("t_a", [{ code: LAB_ROLE_CODES.TENANT_ADMIN, tenantId: "t_a" }]);
	assert.equal(hasLabPermission(admin, LAB_PERMISSIONS.TERMINAL), false);
	assert.equal(hasLabPermission(admin, LAB_PERMISSIONS.SNIFFER), false);
});

check("跨租户 tenant_admin 角色被丢弃（UP-RBAC-09）", () => {
	const user = principal("t_a", [{ code: LAB_ROLE_CODES.TENANT_ADMIN, tenantId: "t_b" }]);
	assert.equal(hasLabPermission(user, LAB_PERMISSIONS.CREATE), false);
	assert.equal(hasLabPermission(user, LAB_PERMISSIONS.READ), true);
});

check("platform_admin 角色绑到租户用户时不授予任何额外权限", () => {
	const user = principal("t_a", [{ code: LAB_ROLE_CODES.PLATFORM_ADMIN, tenantId: null }]);
	assert.equal(hasLabPermission(user, LAB_PERMISSIONS.CREATE), false);
	assert.equal(hasLabPermission(user, LAB_PERMISSIONS.OPERATE), false);
	assert.deepEqual([...labPermissionsOf(user)], [LAB_PERMISSIONS.READ]);
});

check("平台主体默认没有 lab:read", () => {
	const platform = principal(null, [{ code: LAB_ROLE_CODES.PLATFORM_ADMIN, tenantId: null }]);
	assert.equal(hasLabPermission(platform, LAB_PERMISSIONS.READ), false);
	assert.equal(labPermissionsOf(platform).size, 0);
});

check("平台主体即使带 runtime 角色也没有运行态权限", () => {
	const platform = principal(null, [{ code: LAB_ROLE_CODES.TENANT_ADMIN, tenantId: "t_a" }]);
	assert.equal(hasLabPermission(platform, LAB_PERMISSIONS.READ), false);
	assert.equal(hasLabPermission(platform, LAB_PERMISSIONS.CREATE), false);
});

check("lab_terminal 仅授予 terminal，不授予 operate", () => {
	const user = principal("t_a", [{ code: LAB_ROLE_CODES.LAB_TERMINAL, tenantId: "t_a" }]);
	assert.equal(hasLabPermission(user, LAB_PERMISSIONS.TERMINAL), true);
	assert.equal(hasLabPermission(user, LAB_PERMISSIONS.OPERATE), false);
});

check("lab_sniffer 仅授予 sniffer，不授予 operate", () => {
	const user = principal("t_a", [{ code: LAB_ROLE_CODES.LAB_SNIFFER, tenantId: "t_a" }]);
	assert.equal(hasLabPermission(user, LAB_PERMISSIONS.SNIFFER), true);
	assert.equal(hasLabPermission(user, LAB_PERMISSIONS.OPERATE), false);
});

check("未知角色编码被忽略", () => {
	const user = principal("t_a", [{ code: "some_future_role", tenantId: "t_a" }]);
	assert.deepEqual([...labPermissionsOf(user)], [LAB_PERMISSIONS.READ]);
});

check("同租户网络可见", () => {
	assert.equal(canSeeLabNetwork(principal("t_a"), "t_a"), true);
});

check("跨租户网络不可见（统一 404 的判定基础）", () => {
	assert.equal(canSeeLabNetwork(principal("t_a"), "t_b"), false);
});

check("跨租户资源即使有 read 也不可访问", () => {
	const user = principal("t_a", [{ code: LAB_ROLE_CODES.TENANT_ADMIN, tenantId: "t_a" }]);
	assert.equal(canAccessLabNetwork(user, "t_b", LAB_PERMISSIONS.READ), false);
	assert.equal(canAccessLabNetwork(user, "t_b", LAB_PERMISSIONS.CREATE), false);
});

check("同租户资源按权限位判定", () => {
	const admin = principal("t_a", [{ code: LAB_ROLE_CODES.TENANT_ADMIN, tenantId: "t_a" }]);
	assert.equal(canAccessLabNetwork(admin, "t_a", LAB_PERMISSIONS.READ), true);
	assert.equal(canAccessLabNetwork(admin, "t_a", LAB_PERMISSIONS.CREATE), true);
	assert.equal(canAccessLabNetwork(admin, "t_a", LAB_PERMISSIONS.TERMINAL), false);
});

check("无角色的租户主体仍可读取本租户网络", () => {
	assert.equal(canAccessLabNetwork(principal("t_a"), "t_a", LAB_PERMISSIONS.READ), true);
	assert.equal(canAccessLabNetwork(principal("t_a"), "t_a", LAB_PERMISSIONS.CREATE), false);
});

// ── 白名单权限位与矩阵一致（NMCPS-ADR-0022 D1/D2） ──
const whitelistPermissions = [...new Set(MININET_ROUTES.flatMap((route) => route.permissions))].sort();
const matrixPermissions = Object.values(LAB_PERMISSIONS).sort();

check("白名单权限位都来自权限矩阵，且 HTTP 端点不使用 lab:terminal", () => {
	assert.equal(whitelistPermissions.every((permission) => matrixPermissions.includes(permission)), true);
	// terminal 只由 `/mininet-ws/*` 的票使用，没有任何 HTTP 端点可以只凭它放行
	assert.equal(whitelistPermissions.includes(LAB_PERMISSIONS.TERMINAL), false);
});

check("查询端点一律 lab:read，写端点一律不含 lab:read", () => {
	for (const route of MININET_ROUTES) {
		if (route.method === "GET") {
			assert.deepEqual([...route.permissions], [LAB_PERMISSIONS.READ]);
		} else {
			assert.equal(route.permissions.includes(LAB_PERMISSIONS.READ), false);
		}
	}
});

check("写端点 36 条、查询端点 21 条（覆盖上游全部写动词）", () => {
	assert.equal(MININET_ROUTES.filter((route) => route.method !== "GET").length, 36);
	assert.equal(MININET_ROUTES.filter((route) => route.method === "GET").length, 21);
});

check("破坏性重建需要 lab:delete + lab:create 双权限", () => {
	for (const template of ["/full_reset", "/import_json"]) {
		const route = MININET_ROUTES.find((item) => item.template === template && item.method === "POST");
		assert.ok(route, `缺少写端点 ${template}`);
		assert.deepEqual([...route!.permissions].sort(), [LAB_PERMISSIONS.CREATE, LAB_PERMISSIONS.DELETE].sort());
	}
});

check("抓包启停只认 lab:sniffer（不被 lab:operate 隐含）", () => {
	for (const template of ["/sniffer/start", "/sniffer/stop"]) {
		const route = MININET_ROUTES.find((item) => item.template === template);
		assert.deepEqual([...(route?.permissions ?? [])], [LAB_PERMISSIONS.SNIFFER]);
	}
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exitCode = fail > 0 ? 1 : 0;
