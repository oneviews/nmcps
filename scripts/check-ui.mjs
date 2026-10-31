// scripts/check-ui.mjs
// 无头浏览器自查：用 Playwright 打开页面并断言关键交互/视觉/布局点。
//
// 基准地址：默认**自建** —— 拉起假上游（scripts/lib/bff-harness.mjs）+ `.output/server/index.mjs`，
// 端口自动分配，跑完即关；因此先 `pnpm build:server`。
// 需要测已有实例时用 CHECK_UI_BASE_URL 覆盖（此时不再拉起进程，改用下面两个变量登录）——
// 该实例必须自己配好 `NUXT_BFF_UPSTREAM_BASE`，否则登录与「上游就绪」用例必然失败。
// 环境变量：CHECK_UI_BASE_URL、CHECK_UI_ACCOUNT、CHECK_UI_PASSWORD、CHECK_UI_SCREENSHOT（截图输出路径）。
import { chromium } from "playwright";
import { closeUpstream, freePort, HOST, startBff, startUpstream, stopBff } from "./lib/bff-harness.mjs";

const ACCOUNT = process.env.CHECK_UI_ACCOUNT ?? "alice";
const PASSWORD = process.env.CHECK_UI_PASSWORD ?? "p@ssw0rd";
const SHOT_PATH = process.env.CHECK_UI_SCREENSHOT ?? "/tmp/ui-check.png";

/** 自建环境：假上游 + 构建产物（没有 CHECK_UI_BASE_URL 时） */
let upstreamServer = null;
let bffChild = null;
/** 假上游端口：外部实例模式下为 null（此时无法控制「运行中掉线」） */
let upstreamPort = null;
let BASE_URL = process.env.CHECK_UI_BASE_URL?.replace(/\/+$/, "");

if (!BASE_URL) {
	upstreamPort = await freePort();
	upstreamServer = await startUpstream(upstreamPort);
	const port = await freePort();
	bffChild = await startBff(port, { NUXT_BFF_UPSTREAM_BASE: `http://${HOST}:${upstreamPort}` });
	BASE_URL = `http://${HOST}:${port}`;
}

// 绕过环境里的 HTTP 代理（直连被测服务）
const BASE_HOST = new URL(BASE_URL).hostname;
const NO_PROXY_HOSTS = `${BASE_HOST},192.168.1.90,127.0.0.1,localhost`;
process.env.NO_PROXY = process.env.NO_PROXY || NO_PROXY_HOSTS;
process.env.no_proxy = process.env.no_proxy || NO_PROXY_HOSTS;

const results = [];
function log(label, ok, detail) {
	results.push({ label, ok, detail });
	console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

// 外部实例模式（CHECK_UI_BASE_URL）：该实例必须自己配好 `NUXT_BFF_UPSTREAM_BASE`，否则登录与
// 「上游就绪」用例会以失败形式误报（2026-10-31 CI 实证）。先探一次，配错就直接停，
// 别让人顺着「登录失败」去翻错方向。
if (process.env.CHECK_UI_BASE_URL) {
	const ready = await fetch(`${BASE_URL}/ready`).catch(() => null);
	const payload = ready ? await ready.json().catch(() => undefined) : undefined;
	const configured = payload?.upstream?.configured === true;
	log("外部实例（CHECK_UI_BASE_URL）已配上游 NUXT_BFF_UPSTREAM_BASE", configured, payload ? `configured=${payload.upstream?.configured} reason=${payload.upstream?.reason ?? "无"}` : "实例无响应");
	if (!configured) {
		console.error(`\n❌ ${BASE_URL} 没有可用上游：登录与「上游就绪」用例会整体误报，先给实例配上 NUXT_BFF_UPSTREAM_BASE 再跑。`);
		process.exit(1);
	}
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

// 收集控制台 + 页面错误
const consoleErrors = [];
const consoleWarns = [];
page.on("console", (msg) => {
	if (msg.type() === "error") consoleErrors.push(msg.text());
	if (msg.type() === "warning") consoleWarns.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });

// 1. 落地页（官网下载页）：平台检测 + 下载链接指向 GitHub Release
const landing = await page.evaluate(() => {
	const links = Array.from(document.querySelectorAll("a[href*='/releases/download/']"))
		.map((a) => a.getAttribute("href"));
	return {
		heading: document.querySelector("h1")?.textContent?.trim() ?? null,
		links,
		body: document.body.textContent ?? ""
	};
});
log("落地页标题 = NMCPS", landing.heading === "NMCPS", landing.heading ?? "未找到 h1");
log("落地页检测到 Linux 平台（默认中文文案）", landing.body.includes("检测到您正在使用") && landing.body.includes("Linux"));
log("落地页主下载链接指向 GitHub Release", !!landing.links[0]?.startsWith("https://github.com/oneviews/nmcps/releases/download/nmcps-v2.0.0/"), landing.links[0] ?? "未找到");
log("落地页下载链接数为 4（主按钮 + 3 个其他平台）", landing.links.length === 4, `${landing.links.length} 个`);

// 2. 登录守卫（NMCPS-ARCH-003 §7.6）：未登录访问业务页面一律送回登录页
async function guardOf(path) {
	await page.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle" });
	const url = new URL(page.url());
	const text = await page.evaluate(() => document.body.textContent ?? "");
	return { landing: `${url.pathname}${url.search}`, path: url.pathname, redirect: url.searchParams.get("redirect"), hasLoginForm: text.includes("登录 NMCPS") };
}

const guardDashboard = await guardOf("/dashboard/overview");
log("未登录访问控制台被送回登录页", guardDashboard.path === "/auth/login" && guardDashboard.hasLoginForm, guardDashboard.landing);

const guardSecurity = await guardOf("/user/security");
log("未登录访问安全设置被送回登录页并带回跳目标", guardSecurity.path === "/auth/login" && guardSecurity.redirect === "/user/security", guardSecurity.landing);

const guardCommands = await guardOf("/commands");
log("未登录访问其他业务页同样被拦截", guardCommands.path === "/auth/login" && guardCommands.redirect === "/commands", guardCommands.landing);

// 3. 登录页：独立布局 + 表单校验 + 导航不暴露入口
const loginPage = await page.evaluate(() => ({
	heading: document.querySelector("h1")?.textContent?.trim() ?? null,
	hasSidebar: !!document.querySelector("[data-layout-metrics='sidebar']"),
	hasHeader: !!document.querySelector("header[data-slot='root']"),
	inputs: Array.from(document.querySelectorAll("input")).map((el) => el.getAttribute("type") ?? "text"),
	submit: Array.from(document.querySelectorAll("button[type='submit']")).map((el) => el.textContent?.trim() ?? "")
}));
log("登录页独立布局（无 header / 侧栏）", !loginPage.hasSidebar && !loginPage.hasHeader && loginPage.heading === "登录 NMCPS", `${loginPage.heading} sidebar=${loginPage.hasSidebar} header=${loginPage.hasHeader}`);
log("登录页含账号 + 密码输入与提交按钮", loginPage.inputs.includes("password") && loginPage.inputs.length >= 2 && loginPage.submit.includes("登录"), `${loginPage.inputs.join(",")} / ${loginPage.submit.join(",")}`);

// 3.1 演示种子账号默认预填（NMCPS-ARCH-003 §7.7）：演示包开箱即可登录
const readCredentials = () => page.evaluate(() => ({
	account: document.querySelector("input[autocomplete='username']")?.value ?? "",
	password: document.querySelector("input[type='password']")?.value ?? "",
	tenantCode: document.querySelector("input[autocomplete='off']")?.value ?? ""
}));

const prefill = await readCredentials();
log("登录页默认预填超级管理员种子账号", prefill.account === "admin" && prefill.password === "Admin@123456" && prefill.tenantCode === "", `${prefill.account} / ${prefill.password ? "****" : "空"} / tenant=${prefill.tenantCode || "空"}`);

// 3.2 一键切换演示身份：账号 / 口令 / 租户编码整体回填
await page.getByRole("button", { name: "租户管理员" }).click();
await page.waitForTimeout(200);
const tenantPrefill = await readCredentials();
log("切换演示身份回填租户管理员种子账号", tenantPrefill.account === "tenantadmin" && tenantPrefill.password === "Tenant@123456" && tenantPrefill.tenantCode === "", `${tenantPrefill.account} / ${tenantPrefill.password ? "****" : "空"} / tenant=${tenantPrefill.tenantCode || "空"}`);

await page.getByRole("button", { name: "超级管理员" }).click();
await page.waitForTimeout(200);

// 3.2.1 上游就绪（假上游已配置）时不得误报「未配置上游」
const upstreamAlertOnReady = await page.evaluate(() => (document.body.textContent ?? "").includes("BFF 未配置上游地址"));
log("上游就绪时登录页不显示上游缺失提示", !upstreamAlertOnReady, upstreamAlertOnReady ? "误报" : "未显示");

// 3.2.2 上游未配置（NMCPS-ARCH-003 §7.7）：登录页要靠 `/ready` 前置成可读提示，
// 而不是等用户提交后只看到一句「登录失败」。这里单独拉一个无上游的 BFF 验证。
{
	const barePort = await freePort();
	const bareBff = await startBff(barePort, { NUXT_BFF_UPSTREAM_BASE: "" });

	try {
		const isolated = await browser.newContext({ viewport: { width: 1280, height: 900 } });
		const bare = await isolated.newPage();
		// 探针结果缓存（30s）：同一会话内重进登录页不该再打 `/ready`
		let readyProbes = 0;
		bare.on("request", (request) => {
			if (new URL(request.url()).pathname === "/ready")
				readyProbes += 1;
		});
		await bare.goto(`http://${HOST}:${barePort}/auth/login`, { waitUntil: "networkidle" });
		await bare.waitForTimeout(600);
		const bareText = await bare.evaluate(() => document.body.textContent ?? "");
		log(
			"上游未配置时登录页给出可执行的修复指引",
			bareText.includes("BFF 未配置上游地址") && bareText.includes("NUXT_BFF_UPSTREAM_BASE"),
			bareText.includes("BFF 未配置上游地址") ? "已提示" : "无提示"
		);

		const probesAfterFirstLoad = readyProbes;
		await bare.reload({ waitUntil: "networkidle" });
		await bare.waitForTimeout(600);
		const reloadedText = await bare.evaluate(() => document.body.textContent ?? "");
		log(
			"探针结果在 TTL 内复用（重进登录页不再打 /ready）",
			probesAfterFirstLoad === 1 && readyProbes === probesAfterFirstLoad && reloadedText.includes("BFF 未配置上游地址"),
			`首次 ${probesAfterFirstLoad} 次 / 刷新后 ${readyProbes} 次`
		);

		// 「重新检测」必须绕过缓存：用户配好 .env 重启 BFF 后不必等 TTL 过期
		const recheck = bare.getByRole("button", { name: "重新检测" });
		const hasRecheck = await recheck.count() > 0;
		if (hasRecheck)
			await recheck.click();
		await bare.waitForTimeout(600);
		log(
			"「重新检测」绕过缓存重新探测",
			hasRecheck && readyProbes === probesAfterFirstLoad + 1,
			hasRecheck ? `/ready 累计 ${readyProbes} 次` : "未找到按钮"
		);
		await isolated.close();
	} finally {
		await stopBff(bareBff);
	}
}

// 3.3 空表单校验：预填后表单不再为空，须先清空三个字段再提交
for (const selector of ["input[autocomplete='username']", "input[type='password']", "input[autocomplete='off']"])
	await page.locator(selector).fill("");

await page.locator("button[type='submit']").first().click();
await page.waitForTimeout(400);
const validationText = await page.evaluate(() => document.body.textContent ?? "");
log("空提交显示内联校验提示", validationText.includes("请输入账号") && validationText.includes("请输入密码"), validationText.includes("请输入账号") ? "已提示" : "无提示");

// 4. 登录（假上游签发 token → BFF 落 cookie）；登录页的 `redirect` 应被兑现
await page.goto(`${BASE_URL}/auth/login?redirect=/dashboard/overview`, { waitUntil: "networkidle" });
await page.locator("input[autocomplete='username']").fill(ACCOUNT);
await page.locator("input[type='password']").fill(PASSWORD);
await page.locator("button[type='submit']").first().click();
await page.waitForURL((url) => url.pathname === "/dashboard/overview", { timeout: 20_000 }).catch(() => {});
const afterLogin = new URL(page.url());
log("登录成功后按 redirect 回到目标页", afterLogin.pathname === "/dashboard/overview", `${afterLogin.pathname}${afterLogin.search}`);

// 4.5 已登录再访问登录页 → 直接回跳，不再展示登录表单
await page.goto(`${BASE_URL}/auth/login`, { waitUntil: "networkidle" });
await page.waitForTimeout(500);
const bounced = new URL(page.url());
log("已登录访问登录页被回跳控制台", bounced.pathname === "/dashboard/overview", `${bounced.pathname}${bounced.search}`);

// 5. 进入控制台页面后检查布局
await page.goto(`${BASE_URL}/dashboard/overview`, { waitUntil: "networkidle" });

// 1. 默认布局模式
const layoutMode = await page.evaluate(() => document.querySelector("[data-layout-mode]")?.getAttribute("data-layout-mode"));
log("默认布局模式 = bigscreen", layoutMode === "bigscreen", layoutMode);

// 2. header：磨砂玻璃 + 阴影 + 底框（UHeader 根元素 header[data-slot='root']）
const headerStyle = await page.evaluate(() => {
	const el = document.querySelector("header[data-slot='root']");
	if (!el) return null;
	const s = getComputedStyle(el);
	return { backdropFilter: s.backdropFilter, boxShadow: s.boxShadow, borderBottomWidth: s.borderBottomWidth };
});
if (!headerStyle) {
	log("header(UHeader) 存在", false, "未找到 header[data-slot='root']");
} else {
	log("header 磨砂玻璃(backdrop-filter)", headerStyle.backdropFilter !== "none", headerStyle.backdropFilter);
	log("header 阴影(box-shadow)", headerStyle.boxShadow !== "none", headerStyle.boxShadow);
	log("header 底框(border-bottom)", headerStyle.borderBottomWidth !== "0px", headerStyle.borderBottomWidth);
}

// 2.5 toolbar：磨砂玻璃
const toolbarStyle = await page.evaluate(() => {
	const el = document.querySelector(".app-toolbar");
	if (!el) return null;
	const s = getComputedStyle(el);
	return { backdropFilter: s.backdropFilter };
});
if (!toolbarStyle) {
	log("toolbar(.app-toolbar) 存在", false, "未找到 toolbar");
} else {
	log("toolbar 磨砂玻璃(backdrop-filter)", toolbarStyle.backdropFilter !== "none", toolbarStyle.backdropFilter);
}

// 2.6 大屏模式：内容卡片（圆角 + 边框）与 header 有间隔；toolbar 位于卡片顶部
const contentCard = await page.evaluate(() => {
	const el = document.querySelector("[data-layout-metrics='content']");
	if (!el) return null;
	const s = getComputedStyle(el);
	const toolbar = document.querySelector(".app-toolbar");
	const header = document.querySelector("header[data-slot='root']");
	const tr = toolbar?.getBoundingClientRect();
	const er = el.getBoundingClientRect();
	const hr = header?.getBoundingClientRect();
	return {
		borderWidth: s.borderTopWidth,
		borderRadius: s.borderRadius,
		gapFromHeader: hr && er ? er.top - hr.bottom : null,
		toolbarAtCardTop: tr && er ? Math.abs(tr.top - er.top) <= 2 : null
	};
});
if (!contentCard) {
	log("内容卡片(大屏模式) 存在", false, "未找到内容卡片");
} else {
	log("内容卡片边框(border)", contentCard.borderWidth !== "0px", contentCard.borderWidth);
	log("内容卡片圆角(border-radius)", contentCard.borderRadius !== "0px", contentCard.borderRadius);
	log("内容卡片与 header 有间隔", contentCard.gapFromHeader !== null && contentCard.gapFromHeader > 0, `${contentCard.gapFromHeader}px`);
	log("toolbar 位于内容页顶部", contentCard.toolbarAtCardTop === true, "toolbar.top ≈ card.top");
}

// 3. 侧栏：磨砂玻璃 + 浮动变体
const sidebarInfo = await page.evaluate(() => {
	const root = document.querySelector("[data-layout-metrics='sidebar']");
	const inner = root?.querySelector("[data-slot='inner']");
	if (!inner) return null;
	const s = getComputedStyle(inner);
	const variant = root?.getAttribute("data-variant");
	return { backdropFilter: s.backdropFilter, borderRadius: s.borderRadius, boxShadow: s.boxShadow, variant };
});
if (!sidebarInfo) {
	log("侧栏(inner) 存在", false, "未找到侧栏");
} else {
	log("侧栏磨砂玻璃(backdrop-filter)", sidebarInfo.backdropFilter !== "none", sidebarInfo.backdropFilter);
	log("侧栏浮动变体", sidebarInfo.variant === "floating", sidebarInfo.variant);
	log("侧栏圆角(border-radius)", sidebarInfo.borderRadius !== "0px", sidebarInfo.borderRadius);
}

// 3.5 菜单分组一键折叠：当前路由所在分组保持展开
const menuToggleBtn = page.getByRole("button", { name: "展开/收起菜单" });
await menuToggleBtn.first().click(); // 第一次：展开全部
await page.waitForTimeout(400);
await menuToggleBtn.first().click(); // 第二次：折叠（当前分组保持展开）
await page.waitForTimeout(400);
const groupState = await page.evaluate(() => {
	const contents = document.querySelectorAll("[data-layout-metrics='sidebar'] [data-slot='content']");
	let open = 0;
	for (const c of contents) {
		if (c.getAttribute("data-state") === "open") open++;
	}
	return { open, total: contents.length };
});
log("菜单折叠后仅当前分组展开", groupState.open === 1 && groupState.total > 1, `open=${groupState.open}/${groupState.total}`);
await menuToggleBtn.first().click(); // 还原：展开全部
await page.waitForTimeout(400);

// 3.6 侧栏搜索：点击搜索按钮打开命令面板
await page.getByRole("button", { name: "搜索" }).first().click();
await page.waitForTimeout(500);
const searchPanel = await page.evaluate(() => ({
	dialogs: document.querySelectorAll("[role='dialog']").length,
	listboxes: document.querySelectorAll("[role='listbox']").length
}));
log("搜索命令面板打开", searchPanel.dialogs > 0 && searchPanel.listboxes > 0, `dialogs=${searchPanel.dialogs} listboxes=${searchPanel.listboxes}`);
await page.keyboard.press("Escape");
await page.waitForTimeout(300);

// 4. 侧栏展开/收起（icon 模式收窄到 4rem）
const widthBefore = await page.evaluate(() => {
	return document.querySelector("[data-layout-metrics='sidebar'] [data-slot='container']")?.getBoundingClientRect().width;
});
await page.getByRole("button", { name: "展开/收起侧边栏" }).first().click();
await page.waitForTimeout(400);
const widthAfter = await page.evaluate(() => {
	return document.querySelector("[data-layout-metrics='sidebar'] [data-slot='container']")?.getBoundingClientRect().width;
});
log("侧栏收起后收窄", widthAfter < widthBefore, `${widthBefore}px -> ${widthAfter}px`);

// 5. 收起态导航：data-collapsed + 搜索/版本隐藏（with-popover-in-items）
const collapsedState = await page.evaluate(() => {
	const sidebar = document.querySelector("[data-layout-metrics='sidebar']");
	const nav = sidebar?.querySelector("[data-collapsed]");
	const searchInput = sidebar?.querySelector("input");
	return {
		dataCollapsed: nav?.getAttribute("data-collapsed"),
		searchVisible: searchInput ? searchInput.offsetParent !== null : false
	};
});
log("收起态 data-collapsed=true", collapsedState.dataCollapsed === "true", collapsedState.dataCollapsed);
log("收起态搜索框隐藏", collapsedState.searchVisible === false, collapsedState.searchVisible ? "仍可见" : "已隐藏");

// 6. 收起态图标居中（link 的 icon 中心对齐 link 中心）
const centering = await page.evaluate(() => {
	const sidebar = document.querySelector("[data-layout-metrics='sidebar']");
	const link = sidebar?.querySelector("[data-slot='link']");
	const icon = link?.querySelector("[data-slot='linkLeadingIcon']");
	if (!link || !icon) return null;
	const lr = link.getBoundingClientRect();
	const ir = icon.getBoundingClientRect();
	return { delta: Math.abs(ir.left + ir.width / 2 - (lr.left + lr.width / 2)) };
});
if (!centering) {
	log("收起态图标居中", false, "未找到图标");
} else {
	log("收起态图标居中", centering.delta < 2, `偏差 ${centering.delta.toFixed(1)}px`);
}

// 截图
await page.screenshot({ path: SHOT_PATH, fullPage: false });
log("截图已保存", true, SHOT_PATH);

// 7. 已登录工作区：导航不暴露登录页 + 用户菜单（账号 / 安全设置 / 退出登录）
const navLinks = await page.evaluate(() => Array.from(document.querySelectorAll("a[href]")).map((a) => a.getAttribute("href") ?? ""));
log("侧栏/页头导航不含登录页", !navLinks.some((href) => href.includes("/auth/")), navLinks.filter((href) => href.includes("/auth/")).join(" / ") || "无");

await page.getByRole("button", { name: "用户菜单" }).first().click();
await page.waitForTimeout(300);
const userMenu = await page.evaluate(() => ({
	items: Array.from(document.querySelectorAll("[role='menuitem']")).map((el) => el.textContent?.trim() ?? ""),
	securityLink: Array.from(document.querySelectorAll("a[href]"))
		.some((a) => (a.getAttribute("href") ?? "") === "/user/security")
}));
log("用户菜单显示当前登录账号", userMenu.items.includes("Alice"), userMenu.items.join(" / ") || "空菜单");
log("用户菜单提供「退出登录」", userMenu.items.includes("退出登录"), userMenu.items.join(" / ") || "空菜单");
log("用户菜单「安全设置」指向 /user/security", userMenu.securityLink, userMenu.securityLink ? "/user/security" : "无入口");
await page.keyboard.press("Escape");
await page.waitForTimeout(200);

// 8. 自助安全设置（NMCPS-ARCH-003 §7.5）：已登录后两个表单可操作
await page.goto(`${BASE_URL}/user/security`, { waitUntil: "networkidle" });
const securityPage = await page.evaluate(() => {
	const text = document.body.textContent ?? "";
	const inputs = Array.from(document.querySelectorAll("input"));

	return {
		text,
		hasMfaCard: text.includes("两步验证（TOTP）"),
		hasPasswordCard: text.includes("修改登录口令"),
		mfaEnabledBadge: text.includes("已启用"),
		guideVisible: text.includes("请先登录"),
		mfaBindDisabled: document.querySelector("[data-testid='mfa-bind']")?.hasAttribute("disabled") ?? false,
		passwordInputs: inputs.filter((el) => el.getAttribute("type") === "password"),
		passwordInputsDisabled: inputs
			.filter((el) => el.getAttribute("type") === "password")
			.some((el) => el.hasAttribute("disabled"))
	};
});
log("安全设置页含两步验证与改密两个区块", securityPage.hasMfaCard && securityPage.hasPasswordCard, `mfa=${securityPage.hasMfaCard} password=${securityPage.hasPasswordCard}`);
log("已登录后不再展示登录引导", !securityPage.guideVisible, securityPage.guideVisible ? "仍显示引导" : "未显示");
log("MFA 状态取自 whoami（已启用）", securityPage.mfaEnabledBadge, securityPage.mfaEnabledBadge ? "已启用" : "未显示");
log("已登录时 MFA 绑定与口令表单可操作", !securityPage.mfaBindDisabled && securityPage.passwordInputs.length === 3 && !securityPage.passwordInputsDisabled, `bind=${securityPage.mfaBindDisabled} inputs=${securityPage.passwordInputs.length}`);

// 9. 控制台错误/告警
log("控制台错误", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | ") || "无");
log("控制台告警", consoleWarns.length === 0, consoleWarns.slice(0, 3).join(" | ") || "无");

// 10. 上游「运行中掉线」：改密必须给修复指引，而不是把 502 抛给用户（NMCPS-ARCH-003 §7.7）
// 只能自建环境构造：外部实例模式拿不到假上游的控制端点。
if (upstreamPort) {
	await fetch(`http://${HOST}:${upstreamPort}/__control/down`);
	await page.getByTestId("old-password").fill(PASSWORD);
	await page.getByTestId("new-password").fill("Newpass@123");
	await page.getByTestId("confirm-password").fill("Newpass@123");
	await page.getByRole("button", { name: "修改口令" }).click();
	await page.waitForTimeout(1_200);

	const toastText = await page.evaluate(() => document.body.textContent ?? "");
	const hintShown = toastText.includes("上游服务暂时不可达");
	log(
		"上游掉线时改密给出修复指引（不把 502 抛给用户）",
		hintShown && !toastText.includes("bff_upstream_unreachable"),
		hintShown ? "已提示" : `未见提示：${toastText.slice(0, 120)}`
	);

	await fetch(`http://${HOST}:${upstreamPort}/__control/up`);
}

await browser.close();

// 收尾：关掉自建的构建产物与假上游（用 CHECK_UI_BASE_URL 指向已有实例时两者为空）
if (bffChild)
	await stopBff(bffChild);
if (upstreamServer)
	await closeUpstream(upstreamServer);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
if (failed.length) {
	console.log("失败项：");
	for (const f of failed) console.log(`  - ${f.label}`);
	process.exitCode = 1;
}
