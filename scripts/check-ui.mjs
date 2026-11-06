// scripts/check-ui.mjs
// 无头浏览器自查：用 Playwright 打开页面并断言关键交互/视觉/布局点。
//
// 基准地址：默认**自建** —— 拉起假上游（scripts/lib/bff-harness.mjs）+ `.output/server/index.mjs`，
// 端口自动分配，跑完即关；因此先 `pnpm build:server`。
// 需要测已有实例时用 CHECK_UI_BASE_URL 覆盖（此时不再拉起进程，改用下面两个变量登录）——
// 该实例必须自己配好 `NUXT_BFF_UPSTREAM_BASE`，否则登录与「上游就绪」用例必然失败。
// 环境变量：CHECK_UI_BASE_URL、CHECK_UI_ACCOUNT、CHECK_UI_PASSWORD、CHECK_UI_SCREENSHOT（截图输出路径）。
import { chromium } from "playwright";
import { closeUpstream, freePort, HOST, METRIC_UPSTREAM_FAILURE, startBff, startSimulator, startUpstream, stopBff } from "./lib/bff-harness.mjs";

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

// 1. 根路径：没有落地页（NMCPS-ADR-0016）—— 冷启动 302 到登录页，站内跳转由全局守卫分流
const rootResponse = await fetch(`${BASE_URL}/`, { redirect: "manual" });
const rootLocation = rootResponse.headers.get("location");
log(
	"/ 未登录访问直接 302 到 /auth/login",
	rootResponse.status >= 300 && rootResponse.status < 400 && rootLocation === "/auth/login",
	`status=${rootResponse.status} location=${rootLocation ?? "无"}`
);

const rootPage = new URL(page.url());
const rootText = await page.evaluate(() => document.body.textContent ?? "");
log(
	"/ 落地后呈现登录页（下载落地页已移除）",
	rootPage.pathname === "/auth/login" && rootText.includes("登录 NMCPS"),
	`${rootPage.pathname}${rootPage.search}`
);

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

const guardProbe = await guardOf("/os");
log("未登录访问平台探针页同样被拦截", guardProbe.path === "/auth/login" && guardProbe.redirect === "/os", guardProbe.landing);

// `/auth/**` 在守卫白名单里，改密页只能自己判登录态：未登录直接进也要回登录页并带回跳
const guardChange = await guardOf("/auth/change-password");
log("未登录访问改密页被送回登录页并带回跳目标", guardChange.path === "/auth/login" && guardChange.redirect === "/auth/change-password", guardChange.landing);

// 下载中心在系统管理下，同样受守卫保护（NMCPS-ADR-0016）
const guardDownload = await guardOf("/system/download");
log("未登录访问下载中心被送回登录页并带回跳目标", guardDownload.path === "/auth/login" && guardDownload.redirect === "/system/download", guardDownload.landing);

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
	password: document.querySelector("input[type='password']")?.value ?? ""
}));

const prefill = await readCredentials();
log("登录页默认预填超级管理员种子账号", prefill.account === "admin" && prefill.password === "Admin@123456", `${prefill.account} / ${prefill.password ? "****" : "空"}`);

// 3.2 一键切换演示身份：账号 / 口令整体回填（新代无租户编码，NMCPS-ADR-0018 §4.1）
await page.getByRole("button", { name: "租户管理员" }).click();
await page.waitForTimeout(200);
const tenantPrefill = await readCredentials();
log("切换演示身份回填租户管理员种子账号", tenantPrefill.account === "tenantadmin" && tenantPrefill.password === "Tenant@123456", `${tenantPrefill.account} / ${tenantPrefill.password ? "****" : "空"}`);

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

// 3.3 空表单校验：预填后表单不再为空，须先清空两个字段再提交
for (const selector of ["input[autocomplete='username']", "input[type='password']"])
	await page.locator(selector).fill("");

await page.locator("button[type='submit']").first().click();
await page.waitForTimeout(400);
const validationText = await page.evaluate(() => document.body.textContent ?? "");
log("空提交显示内联校验提示", validationText.includes("请输入用户名") && validationText.includes("请输入密码"), validationText.includes("请输入用户名") ? "已提示" : "无提示");

// 4. 登录（假上游签发 token → BFF 落 cookie）；登录页的 `redirect` 应被兑现
await page.goto(`${BASE_URL}/auth/login?redirect=/dashboard/overview`, { waitUntil: "networkidle" });
await page.locator("input[autocomplete='username']").fill(ACCOUNT);
await page.locator("input[type='password']").fill(PASSWORD);
await page.locator("button[type='submit']").first().click();
await page.waitForURL((url) => url.pathname === "/dashboard/overview", { timeout: 20_000 }).catch(() => {});
const afterLogin = new URL(page.url());
log("登录成功后按 redirect 回到目标页", afterLogin.pathname === "/dashboard/overview", `${afterLogin.pathname}${afterLogin.search}`);

// 4.2 自助改密：新代登录不再带 `mustResetPassword`（NMCPS-ADR-0018 缺口 G2），登录后直接进看板；
//     改密走 `/auth/change-password`，改完强制重登。MFA 绑定流程随上游缺口 G8 一并下线，不再覆盖。
if (upstreamPort) {
	const changeContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
	const changePage = await changeContext.newPage();
	await changePage.goto(`${BASE_URL}/auth/login`, { waitUntil: "networkidle" });
	await changePage.locator("input[autocomplete='username']").fill("reset-user");
	await changePage.locator("input[type='password']").fill(PASSWORD);
	await changePage.locator("button[type='submit']").first().click();
	await changePage.waitForURL((url) => url.pathname === "/dashboard/overview", { timeout: 20_000 }).catch(() => {});
	const changeLanding = new URL(changePage.url()).pathname;
	log("登录不再被强制改密拦截（新代无 mustResetPassword）", changeLanding === "/dashboard/overview", changeLanding);

	await changePage.goto(`${BASE_URL}/auth/change-password`, { waitUntil: "networkidle" });

	const changeText = await changePage.evaluate(() => document.body.textContent ?? "");
	const hasFields = await changePage.locator("input[autocomplete='current-password']").count() === 1
		&& await changePage.locator("input[autocomplete='new-password']").count() === 2;
	log("改密页一屏给齐当前密码 / 新密码 / 确认新密码", hasFields && changeText.includes("设置新密码"), `fields=${hasFields}`);

	// 密码管理器归属：只有密码框、没有「用户名」时，浏览器会把新口令记成一条新账号，
	// 用户下次自动填充就填进去一条永远登不进去的记录。字段隐藏、只读、不进 Tab 序。
	const usernameHint = changePage.locator("input[autocomplete='username']");
	await usernameHint.first().waitFor({ timeout: 5_000 }).catch(() => {});
	const usernameHintCount = await usernameHint.count();
	const usernameHintValue = usernameHintCount ? await usernameHint.first().inputValue() : "";
	const usernameHintVisible = usernameHintCount ? await usernameHint.first().isVisible() : false;
	log(
		"改密页带隐藏 autocomplete=username（密码管理器记到对账号）",
		usernameHintCount === 1 && !usernameHintVisible && usernameHintValue === "reset-user",
		`count=${usernameHintCount} visible=${usernameHintVisible} value=${usernameHintValue}`
	);

	// 提交报文必须自带旧口令、且**不得**带 `firstReset`：上游该字段会跳过旧口令校验（UP-AUTH-02），
	// 前端一旦图省事传上去，改密就退化成「谁拿到会话谁就能改」。
	const passwordBodies = [];
	changePage.on("request", (req) => {
		if (req.method() === "POST" && req.url().includes("/api/auth/password")) {
			try {
				passwordBodies.push(req.postDataJSON());
			} catch {
				passwordBodies.push(null);
			}
		}
	});

	/** 填三格并提交，返回页面文案：校验态与报错态都靠它读 */
	async function submitChange(oldPassword, newPassword, confirmPassword) {
		await changePage.locator("input[autocomplete='current-password']").fill(oldPassword);
		await changePage.locator("input[autocomplete='new-password']").nth(0).fill(newPassword);
		await changePage.locator("input[autocomplete='new-password']").nth(1).fill(confirmPassword);
		await changePage.locator("button[type='submit']").first().click();
		await changePage.waitForTimeout(400);
		return changePage.evaluate(() => document.body.textContent ?? "");
	}

	// 表单校验也得进守卫：拦不住就会把「自己改自己」的坏报文送到上游
	const sameText = await submitChange(PASSWORD, PASSWORD, PASSWORD);
	log("新密码与当前密码相同时内联拦下", sameText.includes("新密码不能与当前密码相同"));

	const mismatchText = await submitChange(PASSWORD, "NewP@ssw0rd!", "NewP@ssw0rd?");
	log("两次新密码不一致时内联拦下", mismatchText.includes("两次输入的新密码不一致"));

	const shortText = await submitChange(PASSWORD, "Short7!", "Short7!");
	log("新密码不足 8 位时内联拦下", shortText.includes("新密码至少 8 位"));

	// 旧口令错是真的打到上游（实测 `200 + 10003`，BFF 还原为 400）：必须点名「当前密码不正确」，不能回落通用失败
	const wrongOldText = await submitChange("Wrong@12345", "NewP@ssw0rd!", "NewP@ssw0rd!");
	const stillOnChange = new URL(changePage.url()).pathname === "/auth/change-password";
	log("旧口令错误时点名「当前密码不正确」且停在改密页", wrongOldText.includes("当前密码不正确") && stillOnChange, `stay=${stillOnChange}`);

	const NEW_PASSWORD = "NewP@ssw0rd!";
	await submitChange(PASSWORD, NEW_PASSWORD, NEW_PASSWORD);
	await changePage.waitForURL((url) => url.pathname === "/auth/login", { timeout: 20_000 }).catch(() => {});
	const afterChange = new URL(changePage.url()).pathname;
	log("改密成功后强制重登（回登录页）", afterChange === "/auth/login", afterChange);

	const lastBody = passwordBodies.at(-1);
	log(
		"改密请求带 snake_case 旧口令且全程不带 firstReset",
		lastBody?.old_password === PASSWORD && passwordBodies.every((body) => body && body.firstReset === undefined),
		passwordBodies.length ? `${passwordBodies.length} 次提交 / keys=${Object.keys(lastBody ?? {}).join(",")}` : "未捕获请求"
	);
	// 交叉验证：三个校验态若没真拦住，报文数会变成 5 —— 这条把「内联提示」与「不发请求」绑一起
	log("三个内联校验态都没有发出请求", passwordBodies.length === 2, `requests=${passwordBodies.length}`);

	const changeToast = await changePage.evaluate(() => document.body.textContent ?? "");
	log("改密成功后提示用新密码重登", changeToast.includes("密码已修改"), changeToast.includes("密码已修改") ? "已提示" : "无提示");

	// 改密必须真的落库：假上游此前把 `mustResetPassword` 钉死成 `true`、也不改口令，
	// 「重登不再被弹回」与「旧口令失效」这两条根本写不出来（2026-10-31 评审发现），现在补上。
	await changePage.locator("input[autocomplete='username']").fill("reset-user");
	await changePage.locator("input[type='password']").fill(NEW_PASSWORD);
	await changePage.locator("button[type='submit']").first().click();
	await changePage.waitForURL((url) => url.pathname === "/dashboard/overview", { timeout: 20_000 }).catch(() => {});
	const reLoginLanding = new URL(changePage.url()).pathname;
	log("改密后用新口令重登不再被弹回改密页", reLoginLanding === "/dashboard/overview", reLoginLanding);
	await changeContext.close();

	// 旧口令必须在上游就失效（`200 + 10003` → BFF 401）→ 登录页点名「账号或密码错误」且停在登录页，
	// 不能出现「改完密码旧口令还能用」这种最坏结果。
	const staleContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
	const stalePage = await staleContext.newPage();
	await stalePage.goto(`${BASE_URL}/auth/login`, { waitUntil: "networkidle" });
	await stalePage.locator("input[autocomplete='username']").fill("reset-user");
	await stalePage.locator("input[type='password']").fill(PASSWORD);
	await stalePage.locator("button[type='submit']").first().click();
	await stalePage.waitForTimeout(1_500);
	const staleLanding = new URL(stalePage.url()).pathname;
	const staleText = await stalePage.evaluate(() => document.body.textContent ?? "");
	log(
		"改密后旧口令登录被拒（10003）",
		staleLanding === "/auth/login" && staleText.includes("账号或密码错误"),
		`${staleLanding} / ${staleText.includes("账号或密码错误") ? "已提示" : "未提示"}`
	);
	await staleContext.close();
}

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

// 2.5 预留工具栏（AppToolbar）：本页没有注入任何动作、也非 `topbar` 模式 → 整条收起（NMCPS-ARCH-006 §4.4）
const toolbarStyle = await page.evaluate(() => {
	const el = document.querySelector("[data-toolbar='page']");
	if (!el) return null;
	const s = getComputedStyle(el);
	const rect = el.getBoundingClientRect();
	return {
		height: Math.round(rect.height),
		backdropFilter: s.backdropFilter,
		borderBottomWidth: s.borderBottomWidth
	};
});
if (!toolbarStyle) {
	log("预留工具栏(data-toolbar='page') 存在", false, "未找到 [data-toolbar='page']");
} else {
	log(
		"没有页面动作时预留工具栏整条收起（§4.4）",
		toolbarStyle.height === 0 && toolbarStyle.backdropFilter === "none" && toolbarStyle.borderBottomWidth === "0px",
		`h=${toolbarStyle.height} backdrop=${toolbarStyle.backdropFilter} border-b=${toolbarStyle.borderBottomWidth}`
	);
}

// 2.6 大屏模式：内容卡片（圆角 + 边框）与 header 有间隔；工具栏收起后内容贴合卡片顶部
const contentCard = await page.evaluate(() => {
	const el = document.querySelector("[data-layout-metrics='content']");
	if (!el) return null;
	const s = getComputedStyle(el);
	const toolbar = document.querySelector("[data-toolbar='page']");
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

// 7.1 平台能力探针只在 Tauri 宿主暴露入口（NMCPS-ARCH-005 §六）：
// 浏览器是主自查环境，入口必须消失；直访仍可打开，但只能看到降级提示。
const platformGroupVisible = await page.evaluate(() => {
	const sidebar = document.querySelector("[data-layout-metrics='sidebar']");
	return (sidebar?.textContent ?? "").includes("平台能力");
});
log("浏览器侧栏不显示「平台能力」分组", !platformGroupVisible, platformGroupVisible ? "仍显示" : "未显示");

await page.goto(`${BASE_URL}/os`, { waitUntil: "networkidle" });
const osProbeText = await page.evaluate(() => document.body.textContent ?? "");
log(
	"浏览器直访 /os 只显示降级提示",
	osProbeText.includes("浏览器中不可用"),
	osProbeText.includes("浏览器中不可用") ? "已提示" : `未见提示：${osProbeText.slice(0, 120)}`
);

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

// 7.2 下载中心（NMCPS-ADR-0016）：落地页迁入「系统管理 → 下载中心」，侧栏有入口，按平台给默认安装包
await page.goto(`${BASE_URL}/system/download`, { waitUntil: "networkidle" });
// 侧栏是手风琴：只有当前路由所在分组展开，所以先落到该页再找入口
const downloadNav = await page.evaluate(() => Array.from(document.querySelectorAll("[data-layout-metrics='sidebar'] a[href]"))
	.some((a) => (a.getAttribute("href") ?? "") === "/system/download"));
log("侧栏出现「下载中心」入口", downloadNav, downloadNav ? "/system/download" : "无入口");

const downloadPage = await page.evaluate(() => {
	const text = document.body.textContent ?? "";
	const links = Array.from(document.querySelectorAll("a[href]")).map((a) => a.getAttribute("href") ?? "");
	return {
		hasHeading: text.includes("下载中心"),
		release: links.filter((href) => href.startsWith("https://github.com/oneviews/nmcps/releases/download/"))
	};
});
// 自查浏览器 UA 是 Linux（Playwright chromium 默认），主按钮应指向该平台主推格式
const primaryDownload = downloadPage.release.find((href) => href.endsWith("nmcps_2.0.0_amd64.deb"));
log(
	"下载中心按平台给出主安装包（Linux → .deb）",
	downloadPage.hasHeading && !!primaryDownload,
	primaryDownload ?? `未见主安装包：${downloadPage.release.join(" / ") || "无链接"}`
);
log(
	"下载中心列出其他平台安装包（Windows / macOS / Android）",
	downloadPage.release.filter((href) => href !== primaryDownload).length === 3,
	`${downloadPage.release.length} 个 Release 链接`
);

// 7.3 用户管理两栏（NMCPS-ARCH-006 §3 / NMCPS-ADR-0017）：`?id` 选择契约 + 两栏 / 覆盖式两种形态。
// 只在自建模式跑：用例依赖假上游的固定用户集（u_alice / u_bob / u_carol）与可控的窄视口。
if (upstreamPort) {
	const readUserPage = () => page.evaluate(() => {
		const root = document.querySelector("[data-split='user']");
		return {
			shape: root?.getAttribute("data-split-shape") ?? null,
			search: location.search,
			rows: Array.from(root?.querySelectorAll("[role='option']") ?? []).map((el) => ({
				// 行 `title` 形如「Alice · u_alice」：取末段作为记录标识
				code: (el.getAttribute("title") ?? "").split("·").pop()?.trim() ?? "",
				selected: el.getAttribute("aria-selected") === "true"
			})),
			panes: Array.from(root?.querySelectorAll("[data-pane]") ?? []).map((el) => ({
				pane: el.getAttribute("data-pane"),
				visible: el.checkVisibility?.() ?? false
			})),
			overflow: document.documentElement.scrollWidth > window.innerWidth,
			text: root?.textContent ?? ""
		};
	});

	const openUserPage = async (search = "") => {
		await page.goto(`${BASE_URL}/system/user${search}`, { waitUntil: "networkidle" });
		await page.waitForTimeout(400);
		return readUserPage();
	};

	// 3.1 默认选中：两栏形态落第一行，`?id` 用 `replace` 写入（点选是「查看」，不污染历史）
	const firstLoad = await openUserPage();
	log(
		"用户管理两栏形态默认选中第一行并 `replace` `?id`",
		firstLoad.shape === "two" && firstLoad.search.includes("id=u_alice") && firstLoad.rows[0]?.selected === true,
		`shape=${firstLoad.shape} url="${firstLoad.search}" 选中首行=${firstLoad.rows[0]?.selected ?? "无行"}`
	);

	// 3.2 深链：`?id` 直接命中当前页行 —— 不重新拉列表、也不发详情请求（命中判定只在 `rows` 里做）
	const deepLink = await openUserPage("?id=u_bob");
	const deepRow = deepLink.rows.find((row) => row.code === "u_bob");
	log(
		"深链 `?id` 命中列表行并渲染右栏详情",
		deepLink.shape === "two" && deepRow?.selected === true && deepLink.text.includes("u_bob") && deepLink.text.includes("Bob"),
		`url="${deepLink.search}" 命中=${deepRow?.selected ?? "无此行"}`
	);

	// 3.3 `?id` 不在当前结果内：只出空态提示，不清 URL、不静默翻页去捞、不发详情请求
	const detailRequests = [];
	const recordDetailRequest = (request) => {
		if (/^\/api\/iam\/users\/[^/]+$/.test(new URL(request.url()).pathname))
			detailRequests.push(request.url());
	};
	page.on("request", recordDetailRequest);
	const missing = await openUserPage("?id=u_missing");
	page.off("request", recordDetailRequest);
	log(
		"`?id` 不在当前结果内时给出空态提示且保留 URL",
		missing.search.includes("id=u_missing")
		&& missing.text.includes("不在当前结果内")
		&& missing.text.includes("u_missing")
		&& detailRequests.length === 0,
		`url="${missing.search}" 详情请求=${detailRequests.length}`
	);

	// 3.4 `?id=new`：新建是右栏的一个视图态，不再套一层弹窗（ARCH-006 §3.2 禁止项）
	const creating = await openUserPage("?id=new");
	const createDialogs = await page.locator("[role='dialog']").count();
	log(
		"`?id=new` 落右栏内联建号态（不弹窗）",
		creating.search.includes("id=new")
		&& creating.text.includes("新建用户")
		&& creating.text.includes("用户名")
		&& createDialogs === 0,
		`弹窗=${createDialogs} 表单=${creating.text.includes("用户名")}`
	);

	// 3.4.1 建号表单的字段集对齐新代 `POST /iam/users`（NMCPS-ADR-0018 §4.2）：
	// 只有「所属部门」一个下拉（部门自带租户）；等级（G1）与租户两个旧代字段必须彻底消失 ——
	// 它们在新代请求体里不存在，留着只会让人填了也传不上去。
	const formSelects = page.locator("[data-split='user'] form [role='combobox']");
	const formSelectCount = await formSelects.count();
	const formLabels = await page.evaluate(() =>
		Array.from(document.querySelectorAll("[data-split='user'] form label"))
			.map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim()));
	const hasDepartment = formLabels.some((label) => label.includes("所属部门"));
	const hasLegacyFields = formLabels.some((label) => /等级|所属租户/.test(label));
	log(
		"建号表单只剩「所属部门」一个下拉（等级 / 租户随旧代退役）",
		formSelectCount === 1 && hasDepartment && !hasLegacyFields,
		`下拉=${formSelectCount} 字段=[${formLabels.join(" / ")}]`
	);

	// 3.4.2 真建一次号：假上游按实测口径回 `{ code, message, id }`（没有 `data`），
	// 页面用 keyword 回读新记录再 `replace` `?id` —— 建成并选中说明这条链路成立。
	const createInputs = page.locator("[data-split='user'] form input");
	await createInputs.nth(0).fill("uicheck-ops");
	await createInputs.nth(1).fill("联调建号");
	await createInputs.nth(2).fill("uicheck-ops@nms.local");
	await createInputs.nth(3).fill("Check@123456");
	await page.getByRole("button", { name: "创建", exact: true }).click();
	await page.waitForTimeout(1500);
	const afterCreate = await readUserPage();
	const createdRow = afterCreate.rows.find((row) => row.code === "u_uicheck-ops");
	log(
		"新建用户成功并选中新记录（`id` 回读 + `?id` replace）",
		createdRow?.selected === true && afterCreate.search.includes("id=u_uicheck-ops"),
		`url="${afterCreate.search}" 新行=${createdRow ? "已出现" : "未见"}`
	);

	// 3.5 形态切换：容器窄了落覆盖式，点选 `push` 一条历史，浏览器返回回列表
	await page.setViewportSize({ width: 480, height: 900 });
	const overlayList = await openUserPage();
	const visiblePanes = (state) => state.panes.filter((pane) => pane.visible).map((pane) => pane.pane).join(",");
	log(
		"窄容器落覆盖式且首屏停在列表（不自动选中）",
		overlayList.shape === "overlay" && !overlayList.search.includes("id=") && visiblePanes(overlayList) === "list",
		`shape=${overlayList.shape} url="${overlayList.search}" 可见=${visiblePanes(overlayList)}`
	);

	await page.locator("[data-split='user'] [role='option']").first().click();
	await page.waitForTimeout(400);
	const overlayDetail = await readUserPage();
	log(
		"覆盖式点选写入 `?id` 并显示详情面板",
		overlayDetail.search.includes("id=u_alice") && visiblePanes(overlayDetail) === "detail",
		`url="${overlayDetail.search}" 可见=${visiblePanes(overlayDetail)}`
	);

	await page.goBack();
	await page.waitForTimeout(500);
	const overlayBack = await readUserPage();
	log(
		"覆盖式下浏览器返回回到列表（点选走 `push`）",
		!overlayBack.search.includes("id=") && visiblePanes(overlayBack) === "list",
		`url="${overlayBack.search}" 可见=${visiblePanes(overlayBack)}`
	);

	// 3.6 六个宽度：形态单调、面板可见性正确、320px 无横向溢出
	const widthStates = [];
	for (const width of [320, 768, 1024, 1366, 1440, 1920]) {
		await page.setViewportSize({ width, height: 900 });
		widthStates.push({ width, ...(await openUserPage()) });
	}

	const firstTwo = widthStates.find((state) => state.shape === "two");
	const monotonic = !!firstTwo && widthStates.filter((state) => state.width >= firstTwo.width).every((state) => state.shape === "two");
	log(
		"两栏 / 覆盖式按容器宽度切换且单调（窄了不回退）",
		widthStates[0]?.shape === "overlay" && widthStates.at(-1)?.shape === "two" && monotonic,
		widthStates.map((state) => `${state.width}:${state.shape}`).join(" ")
	);

	const paneVisibleOk = widthStates.every((state) => state.shape === "two"
		? state.panes.filter((pane) => pane.visible).length === 2
		: state.panes.filter((pane) => pane.visible).length === 1);
	log("两栏形态双 `[data-pane]` 同显，覆盖式只显当前面板", paneVisibleOk, widthStates.map((state) => `${state.width}:${visiblePanes(state)}`).join(" "));

	const narrowest = widthStates.find((state) => state.width === 320);
	log("320px 宽度下用户管理页无横向溢出", !!narrowest && !narrowest.overflow, `overflow=${narrowest?.overflow}`);

	// 3.7 工具栏单层（NMCPS-ARCH-006 §4）：动作全在内容页预留工具栏里，栏内不再有第二条
	await page.setViewportSize({ width: 1440, height: 900 });
	await openUserPage();
	const toolbarState = await page.evaluate(() => {
		const bar = document.querySelector("[data-toolbar='page']");
		const left = document.querySelector("#app-toolbar-left");
		const right = document.querySelector("#app-toolbar-right");
		const rect = bar?.getBoundingClientRect();
		return {
			height: rect ? Math.round(rect.height) : 0,
			leftButtons: Array.from(left?.querySelectorAll("button") ?? []).map((el) => el.getAttribute("aria-label") ?? ""),
			leftInputs: left?.querySelectorAll("input").length ?? 0,
			rightText: (right?.textContent ?? "").replace(/\s+/g, " ").trim(),
			paneBars: document.querySelectorAll("[data-split='user'] [data-toolbar], [data-split='user'] [data-pane] > div.min-h-\\(--app-toolbar-h\\)").length
		};
	});
	log(
		"操作用户管理页时动作落在预留工具栏（左区搜索 / 筛选 / 刷新，右区新建与禁用）",
		toolbarState.height >= 44
		&& toolbarState.leftInputs === 1
		&& toolbarState.leftButtons.includes("筛选条件")
		&& toolbarState.leftButtons.includes("刷新")
		&& toolbarState.rightText.includes("新建用户")
		&& toolbarState.rightText.includes("禁用"),
		`h=${toolbarState.height} 左区按钮=${toolbarState.leftButtons.join("/")} 右区="${toolbarState.rightText}"`
	);
	log("用户管理页只有一层工具栏（栏内不再起 header）", toolbarState.paneBars === 0, `栏内工具栏=${toolbarState.paneBars}`);

	// 3.7b 工具栏左右留白与栏内内容对齐（NMCPS-ARCH-006 §4.1）：两侧 12px，别按 header 的 lg:px-8 撑成 32px
	const toolbarPadding = await page.evaluate(() => {
		const bar = document.querySelector("[data-toolbar='page']");
		const left = document.querySelector("#app-toolbar-left");
		const right = document.querySelector("#app-toolbar-right");
		const row = document.querySelector("[data-split='user'] [role='option']");
		const pane = row?.closest("[data-pane]");
		if (!bar || !left || !right) {
			return null;
		}
		const barRect = bar.getBoundingClientRect();
		// 行首内容坐标 = 行盒子左缘 + 行内左边距 + 左边框（行本身带 `px-3`，量盒子会恒等于 0）
		const rowContentLeft = row && pane
			? Math.round(row.getBoundingClientRect().left + Number.parseFloat(getComputedStyle(row).paddingLeft) + Number.parseFloat(getComputedStyle(row).borderLeftWidth) - pane.getBoundingClientRect().left)
			: null;
		return {
			leftInset: Math.round(left.getBoundingClientRect().left - barRect.left),
			rightInset: Math.round(barRect.right - right.getBoundingClientRect().right),
			rowInset: rowContentLeft
		};
	});
	log(
		"工具栏左右留白 12px 且与栏内内容对齐（§4.1）",
		!!toolbarPadding
		&& Math.abs(toolbarPadding.leftInset - 12) <= 2
		&& Math.abs(toolbarPadding.rightInset - 12) <= 2
		&& (toolbarPadding.rowInset === null || Math.abs(toolbarPadding.leftInset - toolbarPadding.rowInset) <= 2),
		toolbarPadding
			? `左=${toolbarPadding.leftInset}px 右=${toolbarPadding.rightInset}px 列表行首=${toolbarPadding.rowInset}px`
			: "未取到测量值"
	);

	// 3.7c 切换布局模式后工具栏动作不丢（NMCPS-ARCH-006 §4.3）：挂载点必须单一渲染点，
	// 否则模式切换会销毁旧挂载点，页面 `Teleport` 的内容留在已脱离文档的子树里（侧栏模式实测过）
	await page.getByRole("button", { name: "偏好设置" }).click();
	await page.waitForTimeout(400);
	await page.getByText("侧栏", { exact: true }).click();
	await page.waitForTimeout(500);
	await page.keyboard.press("Escape");
	await page.waitForTimeout(600);
	const sidebarBar = await page.evaluate(() => {
		const bar = document.querySelector("[data-toolbar='page']");
		const left = document.querySelector("#app-toolbar-left");
		const right = document.querySelector("#app-toolbar-right");
		return {
			mode: document.querySelector("[data-layout-mode]")?.getAttribute("data-layout-mode") ?? null,
			bars: document.querySelectorAll("[data-toolbar='page']").length,
			height: bar ? Math.round(bar.getBoundingClientRect().height) : 0,
			leftKids: left?.childElementCount ?? 0,
			rightText: (right?.textContent ?? "").replace(/\s+/g, " ").trim()
		};
	});
	log(
		"切到侧栏模式后工具栏动作仍在（挂载点未被重建）",
		sidebarBar.mode === "sidebar"
		&& sidebarBar.bars === 1
		&& sidebarBar.height >= 44
		&& sidebarBar.leftKids > 0
		&& sidebarBar.rightText.includes("新建用户"),
		`mode=${sidebarBar.mode} 条数=${sidebarBar.bars} h=${sidebarBar.height} 左区子节点=${sidebarBar.leftKids} 右区="${sidebarBar.rightText}"`
	);

	// 切回大屏（默认模式），后续用例按默认口径跑
	await page.getByRole("button", { name: "偏好设置" }).click();
	await page.waitForTimeout(400);
	await page.getByText("大屏", { exact: true }).click();
	await page.waitForTimeout(500);
	await page.keyboard.press("Escape");
	await page.waitForTimeout(600);

	// 3.7d 顶栏模式（NMCPS-ARCH-006 §4.1 / §5.1 / §7 第 14 行）：工具栏与页头共用限宽容器并同居中，
	// 但内边距仍是 12px —— 与页头 `lg:px-8`（32px）的 20px 差是「工具栏对齐内容、不对齐页头」的有意保留。
	// 视口要开到 1920 才看得出「居中」：默认 `wide` 限宽 1440px，1440 视口下两边都撑满，量不出区别。
	// 布局模式只存 `useState`、不落持久化，所以这一段不能 `openUserPage()`（整页重载会退回默认大屏）。
	await page.setViewportSize({ width: 1920, height: 900 });
	await page.getByRole("button", { name: "偏好设置" }).click();
	await page.waitForTimeout(400);
	await page.getByText("顶栏", { exact: true }).click();
	await page.waitForTimeout(500);
	await page.keyboard.press("Escape");
	await page.waitForTimeout(600);

	const topbarMetrics = await page.evaluate(() => {
		const headerContainer = document.querySelector("header [data-slot='container']");
		const bar = document.querySelector("[data-toolbar='page']");
		const barContainer = bar?.firstElementChild;
		// 左区起点取容纳「面包屑 + `#app-toolbar-left`」的那个 flex 盒：
		// `topbar` 模式下面包屑排在挂载点前面，量挂载点会把面包屑宽度算成内边距。
		const leftGroup = barContainer?.firstElementChild;
		const scroll = document.querySelector("[data-layout-scroll]");
		const box = (el) => el
			? { left: Math.round(el.getBoundingClientRect().left), width: Math.round(el.getBoundingClientRect().width) }
			: null;
		return {
			mode: document.querySelector("[data-layout-mode]")?.getAttribute("data-layout-mode") ?? null,
			bars: document.querySelectorAll("[data-toolbar='page']").length,
			headerContainer: box(headerContainer),
			barContainer: box(barContainer),
			headerInset: headerContainer ? Math.round(Number.parseFloat(getComputedStyle(headerContainer).paddingLeft)) : null,
			barInset: barContainer && leftGroup ? Math.round(leftGroup.getBoundingClientRect().left - barContainer.getBoundingClientRect().left) : null,
			contentInset: barContainer && scroll ? Math.round(scroll.getBoundingClientRect().left - barContainer.getBoundingClientRect().left) : null
		};
	});
	log(
		"顶栏模式工具栏与页头限宽容器同宽同居中",
		topbarMetrics.mode === "topbar"
		&& topbarMetrics.bars === 1
		&& !!topbarMetrics.headerContainer
		&& !!topbarMetrics.barContainer
		&& Math.abs(topbarMetrics.headerContainer.left - topbarMetrics.barContainer.left) <= 1
		&& Math.abs(topbarMetrics.headerContainer.width - topbarMetrics.barContainer.width) <= 1,
		`mode=${topbarMetrics.mode} 页头容器=${topbarMetrics.headerContainer?.left}/${topbarMetrics.headerContainer?.width} 工具栏容器=${topbarMetrics.barContainer?.left}/${topbarMetrics.barContainer?.width}`
	);
	log(
		"顶栏模式工具栏内边距仍 12px（页头 lg:px-8 为 32px，20px 差为有意保留）",
		topbarMetrics.barInset === 12
		&& topbarMetrics.headerInset === 32
		&& topbarMetrics.headerInset - topbarMetrics.barInset === 20
		&& topbarMetrics.contentInset === 0,
		`工具栏=${topbarMetrics.barInset}px 页头=${topbarMetrics.headerInset}px 与内容左缘=+${topbarMetrics.contentInset}px`
	);

	const readBreadcrumb = () => page.evaluate(() => {
		const nav = document.querySelector("[data-toolbar='page'] nav");
		const segments = Array.from(nav?.querySelectorAll("li") ?? [])
			.map((li) => {
				const anchor = li.querySelector("a");
				const button = li.querySelector("button");
				return {
					text: (li.textContent ?? "").replace(/\s+/g, " ").trim(),
					href: anchor?.getAttribute("href") ?? null,
					tag: anchor ? "a" : button ? "button" : "span"
				};
			})
			.filter((seg) => seg.text.length > 0);
		const record = nav?.querySelector("button");
		return {
			segments,
			items: segments.map((seg) => seg.text),
			recordText: record ? (record.textContent ?? "").replace(/\s+/g, " ").trim() : null,
			search: `${location.pathname}${location.search}`
		};
	});

	const breadcrumbWithRecord = await readBreadcrumb();
	await page.locator("[data-toolbar='page'] nav button").click();
	await page.waitForTimeout(500);
	const breadcrumbCleared = await readBreadcrumb();
	log(
		"顶栏模式面包屑在选中记录后多出一段，点击记录段清除选择",
		breadcrumbWithRecord.items.length >= 2
		&& breadcrumbWithRecord.recordText?.includes("Alice") === true
		&& breadcrumbCleared.recordText === null
		&& breadcrumbCleared.items.length === breadcrumbWithRecord.items.length - 1
		&& !breadcrumbCleared.search.includes("id="),
		`选中时=[${breadcrumbWithRecord.items.join(" / ")}] 记录段="${breadcrumbWithRecord.recordText}"；点击后=[${breadcrumbCleared.items.join(" / ")}] url="${breadcrumbCleared.search}"`
	);

	// 路由段的结构（§5.1 表格「中间段可跳转；末段不可点」）：两段都来自路由表，父段不是路由本身的 path，
	// 而是 `defaultChildPath()` —— 根路由 `/system` 没有页面，链接必须落到它的默认子页 `/system/user`，
	// 否则点父段会 404。这条只写在 `useNavigation` 的注释里，现在钉成断言。
	const renderSegment = (seg) => `${seg.text}(${seg.tag}${seg.href ? ` → ${seg.href}` : ""})`;
	const routeSegs = breadcrumbCleared.segments;
	log(
		"面包屑路由段按路由层级生成：父段可点且指向默认子页，当前页无链接（§5.1）",
		routeSegs.length === 2
		&& routeSegs[0].text.includes("系统管理")
		&& routeSegs[0].tag === "a"
		&& routeSegs[0].href === "/system/user"
		&& routeSegs[1].text.includes("用户管理")
		&& routeSegs[1].href === null,
		`[${routeSegs.map(renderSegment).join(" / ")}]`
	);
	// 记录段只在末位追加，且**不改动**前面的路由段（文字与 href 都不变）：这才能说明两段来源不同、
	// 不是一个页面手写的数组（§5.1 开头「禁止合并为一个由页面手写的数组」）。
	log(
		"记录段只在末位追加：路由段文字与链接不变，记录段是按钮且无 href（§5.1）",
		breadcrumbWithRecord.segments.length === 3
		&& routeSegs.length === breadcrumbCleared.segments.length
		&& breadcrumbWithRecord.segments.slice(0, 2).every((seg, i) => seg.text === routeSegs[i].text && seg.href === routeSegs[i].href)
		&& breadcrumbWithRecord.segments[2].tag === "button"
		&& breadcrumbWithRecord.segments[2].href === null,
		`路由段=[${routeSegs.map(renderSegment).join(" / ")}] 记录态=[${breadcrumbWithRecord.segments.map(renderSegment).join(" / ")}]`
	);

	// 切回大屏（默认模式）再继续，后续用例都按默认口径
	await page.getByRole("button", { name: "偏好设置" }).click();
	await page.waitForTimeout(400);
	await page.getByText("大屏", { exact: true }).click();
	await page.waitForTimeout(500);
	await page.keyboard.press("Escape");
	await page.waitForTimeout(600);

	// 3.7e 无动作页（`/dashboard/overview`）的其余模式（NMCPS-ARCH-006 §4.4 / §7 第 15 行）：
	// `mobile` 与 `bigscreen` 一样整条收起；`topbar` 是**例外** —— 面包屑常驻左区最左，
	// 收起就没地方放它，所以留一条 49px，但左区挂载点必须为空（否则等于给空页面白留一条）。
	await page.goto(`${BASE_URL}/dashboard/overview`, { waitUntil: "networkidle" });
	await page.waitForTimeout(400);
	const readBarState = () => page.evaluate(() => {
		const el = document.querySelector("[data-toolbar='page']");
		if (!el) return null;
		const s = getComputedStyle(el);
		const nav = el.querySelector("nav");
		return {
			mode: document.querySelector("[data-layout-mode]")?.getAttribute("data-layout-mode") ?? null,
			height: Math.round(el.getBoundingClientRect().height),
			backdropFilter: s.backdropFilter,
			borderBottomWidth: s.borderBottomWidth,
			segments: Array.from(nav?.querySelectorAll("li") ?? [])
				.map((li) => (li.textContent ?? "").replace(/\s+/g, " ").trim())
				.filter((text) => text.length > 0),
			leftKids: document.querySelector("#app-toolbar-left")?.childElementCount ?? -1
		};
	});

	await page.getByRole("button", { name: "偏好设置" }).click();
	await page.waitForTimeout(400);
	await page.getByText("顶栏", { exact: true }).click();
	await page.waitForTimeout(500);
	await page.keyboard.press("Escape");
	await page.waitForTimeout(600);
	const topbarEmptyPage = await readBarState();
	log(
		"无动作页在顶栏模式不收起：只留面包屑，左区挂载点为空（§4.4）",
		topbarEmptyPage?.mode === "topbar"
		&& topbarEmptyPage.height >= 44
		&& topbarEmptyPage.segments.length >= 1
		&& topbarEmptyPage.leftKids === 0,
		`mode=${topbarEmptyPage?.mode} h=${topbarEmptyPage?.height} 面包屑=[${topbarEmptyPage?.segments.join(" / ")}] 左区子节点=${topbarEmptyPage?.leftKids}`
	);

	await page.getByRole("button", { name: "偏好设置" }).click();
	await page.waitForTimeout(400);
	await page.getByText("手机", { exact: true }).click();
	await page.waitForTimeout(500);
	await page.keyboard.press("Escape");
	await page.waitForTimeout(600);
	const mobileEmptyPage = await readBarState();
	log(
		"无动作页在手机模式同样整条收起（§4.4）",
		mobileEmptyPage?.mode === "mobile"
		&& mobileEmptyPage.height === 0
		&& mobileEmptyPage.backdropFilter === "none"
		&& mobileEmptyPage.borderBottomWidth === "0px",
		`mode=${mobileEmptyPage?.mode} h=${mobileEmptyPage?.height} backdrop=${mobileEmptyPage?.backdropFilter} border-b=${mobileEmptyPage?.borderBottomWidth}`
	);

	// 切回大屏（默认模式），后续用例都按默认口径
	await page.getByRole("button", { name: "偏好设置" }).click();
	await page.waitForTimeout(400);
	await page.getByText("大屏", { exact: true }).click();
	await page.waitForTimeout(500);
	await page.keyboard.press("Escape");
	await page.waitForTimeout(600);

	// 3.8 覆盖式：同一层工具栏跟随当前面板（列表态给集合域动作，详情态给「返回」）
	await page.setViewportSize({ width: 480, height: 900 });
	await openUserPage();
	const overlayListBar = await page.evaluate(() => ({
		inputs: document.querySelector("#app-toolbar-left")?.querySelectorAll("input").length ?? 0,
		buttons: Array.from(document.querySelector("#app-toolbar-left")?.querySelectorAll("button") ?? []).map((el) => el.getAttribute("aria-label") ?? "")
	}));
	await page.locator("[data-split='user'] [role='option']").first().click();
	await page.waitForTimeout(400);
	const overlayDetailBar = await page.evaluate(() => ({
		inputs: document.querySelector("#app-toolbar-left")?.querySelectorAll("input").length ?? 0,
		buttons: Array.from(document.querySelector("#app-toolbar-left")?.querySelectorAll("button") ?? []).map((el) => el.getAttribute("aria-label") ?? ""),
		rightText: (document.querySelector("#app-toolbar-right")?.textContent ?? "").replace(/\s+/g, " ").trim()
	}));
	log(
		"覆盖式工具栏跟随当前面板（列表态搜索 / 详情态返回）",
		overlayListBar.inputs === 1
		&& overlayListBar.buttons.includes("筛选条件")
		&& overlayDetailBar.inputs === 0
		&& overlayDetailBar.buttons.includes("返回列表")
		&& overlayDetailBar.rightText.includes("禁用"),
		`列表态 input=${overlayListBar.inputs} 按钮=${overlayListBar.buttons.join("/")}；详情态 input=${overlayDetailBar.inputs} 按钮=${overlayDetailBar.buttons.join("/")} 右区="${overlayDetailBar.rightText}"`
	);
	await page.goBack();
	await page.waitForTimeout(400);

	await page.setViewportSize({ width: 1440, height: 900 });
}
// 7.3b 策略管理两栏（NMCPS-DESIGN-005 §7 / NMCPS-ADR-0018 §4.3）：新代 `iam/policies` 的
// 服务端分页 / 服务端 `keyword` / 文档只读预览。断言只盯「页面依赖的契约」，不测样式：
// 旧代是「全量拉取 + 客户端过滤 + 客户端分页」，任何一条回退都会在这里变红。
// 依赖假上游的三条策略（`pol_platform_full` / `pol_tenant_reader` / `pol_role_reader_isp_a`，
// 见 `scripts/lib/bff-harness.mjs`；最后一条的删除固定回 `200 {code:400}`，验 UP-RBAC-05）。
if (upstreamPort) {
	const readPolicyPage = () => page.evaluate(() => {
		const root = document.querySelector("[data-split='policy']");
		return {
			shape: root?.getAttribute("data-split-shape") ?? null,
			search: location.search,
			rows: Array.from(root?.querySelectorAll("[role='option']") ?? []).map((el) => ({
				code: (el.getAttribute("title") ?? "").split("·").pop()?.trim() ?? "",
				selected: el.getAttribute("aria-selected") === "true"
			})),
			text: root?.textContent ?? ""
		};
	});

	const policyRequests = [];
	const recordPolicyRequest = (request) => {
		const url = new URL(request.url());
		if (url.pathname === "/api/iam/policies")
			policyRequests.push(url.searchParams);
	};
	page.on("request", recordPolicyRequest);

	await page.goto(`${BASE_URL}/system/policy`, { waitUntil: "networkidle" });
	await page.waitForTimeout(600);
	const firstPolicy = await readPolicyPage();
	const firstPolicyQuery = policyRequests.at(-1);

	log(
		"策略页默认选中首行，列表走服务端分页（page_size=15，且不请求被忽略的 code / policy_type / enabled）",
		firstPolicy.shape === "two"
		&& firstPolicy.search.includes("id=pol_platform_full")
		&& firstPolicyQuery?.get("page_size") === "15"
		&& !firstPolicyQuery?.has("code")
		&& !firstPolicyQuery?.has("policy_type")
		&& !firstPolicyQuery?.has("enabled"),
		`url="${firstPolicy.search}" 参数=${firstPolicyQuery ? Array.from(firstPolicyQuery.keys()).join("/") : "无请求"}`
	);

	// `document` 上游给的是 **JSON 字符串**：页面要缩进展示，不能原样吞成一行
	log(
		"策略文档按 JSON 格式化预览（不把字符串原样摊在一行）",
		firstPolicy.text.includes("\"Action\": [") && firstPolicy.text.includes("Effect"),
		`含缩进=${firstPolicy.text.includes("\"Action\": [")}`
	);

	// 搜索走服务端 `keyword`（旧代没有这个参数，只能在客户端过滤）
	policyRequests.length = 0;
	await page.locator("#app-toolbar-left input").first().fill("isp.role");
	await page.waitForTimeout(900);
	const searchedPolicy = await readPolicyPage();
	const keywordPolicyQuery = policyRequests.at(-1);
	log(
		"策略搜索走服务端 keyword（结果收敛到 1 条）",
		keywordPolicyQuery?.get("keyword") === "isp.role"
		&& searchedPolicy.rows.length === 1
		&& searchedPolicy.rows[0]?.code === "isp.role.readonly",
		`keyword=${keywordPolicyQuery?.get("keyword") ?? "无"} 行=${searchedPolicy.rows.length}`
	);

	// 新建：右栏内联表单（D3，不套弹窗）；建成后 `?id` 换成真实主键（composable 用 code 回读）。
	// 先把搜索清掉：否则新建后列表仍按上一个 keyword 过滤，新行会「建成了但看不见」。
	await page.locator("#app-toolbar-left input").first().fill("");
	await page.waitForTimeout(900);
	await page.getByRole("button", { name: "新建策略", exact: true }).click();
	await page.waitForTimeout(400);
	const policyFormDialogs = await page.locator("[role='dialog']").count();
	const policyInputs = page.locator("[data-split='policy'] form input");
	await policyInputs.nth(0).fill("UI 自查策略");
	await policyInputs.nth(1).fill("uicheck.policy");
	await policyInputs.nth(2).fill("custom");
	await page.locator("[data-split='policy'] form textarea").fill("[]");
	await page.getByRole("button", { name: "创建", exact: true }).click();
	await page.waitForTimeout(1600);
	const afterPolicyCreate = await readPolicyPage();
	log(
		"新建策略落右栏内联表单，建成后选中新记录（`id` 回读 + `?id` replace）",
		policyFormDialogs === 0
		&& afterPolicyCreate.search.includes("id=pol_uicheck.policy")
		&& afterPolicyCreate.rows.some((row) => row.code === "uicheck.policy"),
		`弹窗=${policyFormDialogs} url="${afterPolicyCreate.search}"`
	);

	// 删除失败通道：上游回 `200 {code:400}`（UP-RBAC-05）时页面必须报错，不能当成删成功
	await page.goto(`${BASE_URL}/system/policy?id=pol_role_reader_isp_a`, { waitUntil: "networkidle" });
	await page.waitForTimeout(500);
	await page.getByRole("button", { name: "删除策略", exact: true }).click();
	await page.waitForTimeout(400);
	await page.locator("[role='dialog']").getByRole("button", { name: "删除", exact: true }).click();
	await page.waitForTimeout(1200);
	const deleteFailureDialogs = await page.locator("[role='dialog']").count();
	const deleteFailureText = await page.evaluate(() => document.body.textContent ?? "");
	log(
		"删除被上游拒绝（200 + code 400）时报错并保留弹窗（不静默成功）",
		deleteFailureDialogs > 0 && deleteFailureText.includes("删除失败：策略不存在或当前会话无权访问"),
		`弹窗=${deleteFailureDialogs} 含失败文案=${deleteFailureText.includes("删除失败")}`
	);

	await page.keyboard.press("Escape");
	await page.waitForTimeout(300);
	page.off("request", recordPolicyRequest);
}

// 7.3c 权限管理两栏（NMCPS-DESIGN-005 §8 / NMCPS-ADR-0018 §4.3）：新代 `iam/roles` +
// `role-policies` + `subject-roles`。断言只盯「页面依赖的契约」：
// 旧代是「权限点 × 角色」（`/role/{code}/permission`），矩阵来源、写通道、成员来源全部换了，
// 任何一条回退都会在这里变红。依赖假上游的三条角色 / 三条关系（见 `scripts/lib/bff-harness.mjs`，
// 其中 `r_tenant_viewer_isp_a` 的删除固定回 `200 {code:400}`，验 UP-RBAC-05；
// `rp-orphan` / `sr-orphan` 验 UP-RBAC-10 的孤儿过滤）。
if (upstreamPort) {
	const readPermissionPage = () => page.evaluate(() => {
		const root = document.querySelector("[data-split='permission']");
		return {
			shape: root?.getAttribute("data-split-shape") ?? null,
			search: location.search,
			rows: Array.from(root?.querySelectorAll("[role='option']") ?? []).map((el) => ({
				code: (el.getAttribute("title") ?? "").split("·").pop()?.trim() ?? "",
				selected: el.getAttribute("aria-selected") === "true"
			})),
			policies: Array.from(root?.querySelectorAll("[data-policy-code]") ?? []).map((el) => ({
				code: el.getAttribute("data-policy-code") ?? "",
				granted: el.querySelector("[role='switch']")?.getAttribute("aria-checked") === "true"
			})),
			text: root?.textContent ?? ""
		};
	});

	const permissionRequests = [];
	const recordPermissionRequest = (request) => {
		const url = new URL(request.url());
		if (url.pathname.startsWith("/api/iam/role") || url.pathname.startsWith("/api/iam/subject-roles"))
			permissionRequests.push({ path: url.pathname, method: request.method(), params: url.searchParams, body: request.postData() });
	};
	page.on("request", recordPermissionRequest);

	await page.goto(`${BASE_URL}/system/permission`, { waitUntil: "networkidle" });
	await page.waitForTimeout(700);
	const firstPermission = await readPermissionPage();
	const firstRoleQuery = permissionRequests.find((item) => item.path === "/api/iam/roles" && item.params.has("page"));

	log(
		"权限页默认选中首行，角色列表走服务端分页（page_size=15，且不请求被忽略的 enabled / tenant_id）",
		firstPermission.shape === "two"
		&& firstPermission.search.includes("id=r_platform_admin")
		&& firstRoleQuery?.params.get("page_size") === "15"
		&& !firstRoleQuery?.params.has("enabled")
		&& !firstRoleQuery?.params.has("tenant_id"),
		`url="${firstPermission.search}" 参数=${firstRoleQuery ? Array.from(firstRoleQuery.params.keys()).join("/") : "无请求"}`
	);

	// 授权矩阵 = 策略目录（`iam/policies`）× 关系行（`role-policies`），不是权限点开关。
	// 目录里此时有 3 条种子 + 本节前面新建的 1 条策略（同一个假上游跑完整个自查），因此只断言下界。
	const grantedCodes = firstPermission.policies.filter((item) => item.granted).map((item) => item.code);
	log(
		"授权矩阵按策略目录渲染，已挂载状态来自 role-policies（平台角色只挂 1 条）",
		firstPermission.policies.length >= 3
		&& grantedCodes.length === 1
		&& grantedCodes[0] === "platform.full_access"
		&& permissionRequests.some((item) => item.path === "/api/iam/role-policies" && item.params.get("role_id") === "r_platform_admin"),
		`策略=${firstPermission.policies.length} 已挂=${grantedCodes.join("/") || "无"}`
	);

	// 孤儿关系行（UP-RBAC-10）与成员区都挂在 `r_tenant_admin` 上：换角色重读一次。
	// `rp-orphan` 指向已删策略、`sr-orphan` 指向已删用户，两者都只报数量、不渲染幽灵条目。
	permissionRequests.length = 0;
	await page.goto(`${BASE_URL}/system/permission?id=r_tenant_admin`, { waitUntil: "networkidle" });
	await page.waitForTimeout(700);
	const tenantPermission = await readPermissionPage();
	const tenantGranted = tenantPermission.policies.filter((item) => item.granted).map((item) => item.code);

	log(
		"换角色后矩阵按 role_id 重取（租户管理员角色挂的是 tenant.readonly）",
		tenantGranted.length === 1 && tenantGranted[0] === "tenant.readonly",
		`已挂=${tenantGranted.join("/") || "无"}`
	);

	log(
		"指向已删策略的孤儿关系行只报数量、不渲染幽灵条目",
		tenantPermission.policies.every((item) => item.code !== "pol_deleted_elsewhere")
		&& tenantPermission.text.includes("已不存在的策略"),
		`含孤儿提示=${tenantPermission.text.includes("已不存在的策略")}`
	);

	log(
		"已分配用户按 role_id 过滤并屏蔽已删用户（u_ghost 不出现）",
		tenantPermission.text.includes("u_alice")
		&& tenantPermission.text.includes("u_bob")
		&& !tenantPermission.text.includes("u_ghost")
		&& tenantPermission.text.includes("已删除的用户"),
		`含 alice=${tenantPermission.text.includes("u_alice")} 含 ghost=${tenantPermission.text.includes("u_ghost")}`
	);

	page.off("request", recordPermissionRequest);
}

// 7.4 审计日志工具栏（NMCPS-DESIGN-005 §9.3 第 2 条 / NMCPS-ARCH-006 §4.1）：
// 时间范围与日志族常驻左区、其余标识类筛选留浮层，且两个常驻控件必须真的改写请求参数 ——
// 只断言「控件在那儿」会把「摆了个假的」也算通过。依赖假上游的三族假数据
// （op-0001… / sec-0001… / arc-0001…，见 `scripts/lib/bff-harness.mjs`）。
// 新代口径（NMCPS-ADR-0018 §三）：三族各一个端点，时间边界是 **epoch 毫秒整数**；
// 旧代是单端点 + `category` + `startTime` 字面值，参数名全部变了。
if (upstreamPort) {
	const auditRequests = [];
	const recordAuditRequest = (request) => {
		const url = new URL(request.url());
		if (url.pathname.startsWith("/api/audit"))
			auditRequests.push({ path: url.pathname, params: url.searchParams });
	};
	page.on("request", recordAuditRequest);

	/** 最近一次**列表**请求：详情请求不带 `page`，用参数区分，避免把详情当列表读 */
	const lastListRequest = () => auditRequests.filter((item) => item.params.has("page")).at(-1);

	await page.goto(`${BASE_URL}/system/log`, { waitUntil: "networkidle" });
	await page.waitForTimeout(400);

	const auditToolbar = await page.evaluate(() => {
		const left = document.querySelector("#app-toolbar-left");
		return {
			text: (left?.textContent ?? "").replace(/\s+/g, " ").trim(),
			ariaLabels: Array.from(left?.querySelectorAll("button") ?? []).map((el) => el.getAttribute("aria-label") ?? ""),
			comboboxes: left?.querySelectorAll("[role='combobox']").length ?? 0,
			datetimeInputs: left?.querySelectorAll("input[type='datetime-local']").length ?? 0,
			width: left ? Math.round(left.getBoundingClientRect().width) : 0
		};
	});
	log(
		"审计日志工具栏左区常驻时间范围按钮与日志族下拉",
		auditToolbar.text.includes("全部时间")
		&& auditToolbar.ariaLabels.includes("时间范围")
		&& auditToolbar.comboboxes === 1
		&& auditToolbar.datetimeInputs === 0,
		`文案="${auditToolbar.text}" 按钮=${auditToolbar.ariaLabels.join("/")} combobox=${auditToolbar.comboboxes} datetime=${auditToolbar.datetimeInputs}`
	);

	// 两个常驻控件进左区后不能把左区撑爆（§4.1 的 45% 预算）：1440 视口下内容盒 ≈1166px
	const leftRatio = await page.evaluate(() => {
		const left = document.querySelector("#app-toolbar-left");
		const row = document.querySelector("[data-toolbar='page']");
		if (!left || !row)
			return null;
		return Math.round((left.getBoundingClientRect().width / row.getBoundingClientRect().width) * 100);
	});
	log("常驻筛选控件不超左区宽度预算（≤45% 内容盒）", leftRatio !== null && leftRatio <= 45, `${leftRatio}%`);

	// 列表：假上游 3 条操作日志 → 行标题取 `operation`（族不同字段不同，模板只走一个分支）
	const auditRows = await page.evaluate(() => {
		const rowsEls = Array.from(document.querySelectorAll("[role='option']"));
		return {
			count: rowsEls.length,
			titles: rowsEls.map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim())
		};
	});
	log(
		"操作日志列表按端点渲染（3 行、标题取 operation）",
		auditRows.count === 3 && auditRows.titles.some((title) => title.includes("POST /api/v1/iam/users")),
		`${auditRows.count} 行 / 首行="${auditRows.titles[0] ?? "无"}"`
	);

	// 详情：点第二行必须打**族详情端点**（`/api/audit/operation-logs/{id}`，旧代是 `/audit/{logCode}`），
	// 且字段按已登记清单渲染（`detail.username` = 操作账号）。点第二行而不是第一行：
	// 两栏形态默认自动选中第一行，点它不会触发新的详情请求，断言会假通过。
	auditRequests.length = 0;
	await page.locator("[role='option']").nth(1).click();
	await page.waitForTimeout(500);
	const detailRequest = auditRequests.find((item) => /^\/api\/audit\/operation-logs\/[^/]+$/.test(item.path));
	const detailBody = await page.evaluate(() => (document.body.textContent ?? "").replace(/\s+/g, " "));
	log(
		"选中行走族详情端点并渲染已登记字段",
		!!detailRequest
		&& detailRequest.path === "/api/audit/operation-logs/op-0002"
		&& detailBody.includes("操作账号")
		&& detailBody.includes("op-0002"),
		detailRequest ? detailRequest.path : "没有详情请求"
	);

	// 浮层：操作日志族有 4 个标识类筛选（关键字 / 操作账号 / 所属模块 / 状态）；
	// 时间与族名已常驻左区，浮层里不得重复出现
	await page.locator("#app-toolbar-left button[aria-label='筛选条件']").click();
	await page.waitForTimeout(300);
	const filterPopover = await page.evaluate(() => {
		const panels = Array.from(document.querySelectorAll("[data-slot='content']"))
			.filter((el) => el.checkVisibility?.() ?? false);
		const content = panels.find((el) => el.querySelector("input")) ?? panels.at(-1);
		return {
			placeholders: Array.from(content?.querySelectorAll("input") ?? []).map((el) => el.getAttribute("placeholder") ?? ""),
			datetimeInputs: content?.querySelectorAll("input[type='datetime-local']").length ?? 0,
			kindCombobox: !!content?.querySelector("[aria-label='日志族']"),
			comboboxes: content?.querySelectorAll("[role='combobox']").length ?? 0
		};
	});
	log(
		"筛选浮层只留标识类筛选（不再重复时间 / 日志族）",
		filterPopover.datetimeInputs === 0
		&& !filterPopover.kindCombobox
		&& filterPopover.comboboxes === 0
		&& filterPopover.placeholders.includes("关键字")
		&& filterPopover.placeholders.includes("操作账号")
		&& filterPopover.placeholders.length === 4,
		`datetime=${filterPopover.datetimeInputs} 族下拉=${filterPopover.kindCombobox} 下拉数=${filterPopover.comboboxes} 输入框=${filterPopover.placeholders.join("/")}`
	);
	await page.keyboard.press("Escape");
	await page.waitForTimeout(200);

	// 时间快捷项：「近 24 小时」→ 请求带 created_from / created_to（epoch 毫秒整数，间隔 24h）
	auditRequests.length = 0;
	await page.locator("#app-toolbar-left button[aria-label='时间范围']").click();
	await page.waitForTimeout(300);
	await page.getByRole("button", { name: "近 24 小时" }).first().click();
	await page.waitForTimeout(800);
	await page.keyboard.press("Escape");
	await page.waitForTimeout(200);
	const ranged = lastListRequest();
	const rangedSpan = ranged
		? Number(ranged.params.get("created_to")) - Number(ranged.params.get("created_from"))
		: Number.NaN;
	log(
		"时间范围快捷项改写 created_from / created_to（epoch 毫秒）",
		/^\d{10,}$/.test(ranged?.params.get("created_from") ?? "")
		&& /^\d{10,}$/.test(ranged?.params.get("created_to") ?? "")
		&& Math.abs(rangedSpan - 86_400_000) <= 60_000,
		ranged
			? `created_from=${ranged.params.get("created_from")} created_to=${ranged.params.get("created_to")} 间隔=${Math.round(rangedSpan / 60000)}min`
			: "没有列表请求"
	);

	const rangeLabelText = await page.evaluate(() => (document.querySelector("#app-toolbar-left")?.textContent ?? "").replace(/\s+/g, " ").trim());
	log("时间范围按钮文案回显当前窗口", rangeLabelText.includes("近 24 小时"), rangeLabelText);

	// 日历选日：点第一天 → 起点当天 `00:00:00`（本地时）的 epoch；再点第二天 → 终点 `23:59:59`。
	// 整天窗口含首尾两端，少这 59 秒就漏掉当天最后半分钟；取当月 1 号 / 2 号，双月视图首屏一定渲染它们。
	const now = new Date();
	const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
	const [firstDay, secondDay] = [`${monthPrefix}-01`, `${monthPrefix}-02`];
	/** `datetime-local` 字面值 → 页面应发出的 epoch 毫秒（两边同一台机器、同一时区） */
	const epochOf = (literal) => String(Date.parse(literal));
	auditRequests.length = 0;
	await page.locator("#app-toolbar-left button[aria-label='时间范围']").click();
	await page.waitForTimeout(300);
	await page.locator(`[data-slot='cellTrigger'][data-value='${firstDay}']`).first().click();
	await page.waitForTimeout(700);
	const dayOnly = lastListRequest();
	await page.locator(`[data-slot='cellTrigger'][data-value='${secondDay}']`).first().click();
	await page.waitForTimeout(700);
	await page.keyboard.press("Escape");
	await page.waitForTimeout(200);
	const dayRange = lastListRequest();
	log(
		"日历选整天改写 created_from / created_to（含首尾两端）",
		dayOnly?.params.get("created_from") === epochOf(`${firstDay}T00:00:00`)
		&& !dayOnly.params.get("created_to")
		&& dayRange?.params.get("created_from") === epochOf(`${firstDay}T00:00:00`)
		&& dayRange?.params.get("created_to") === epochOf(`${secondDay}T23:59:59`),
		`首点=${dayOnly?.params.get("created_from") ?? "无"}→${dayOnly?.params.get("created_to") ?? "空"} 收尾=${dayRange?.params.get("created_from") ?? "无"}→${dayRange?.params.get("created_to") ?? "空"}`
	);

	// 日志族：切到「安全日志」→ 换端点 `/api/audit/security-logs`，时间参数换成 logged_from / logged_to
	// （两族的筛选参数不同源，这一步就是「切族真的换了契约」的证据）
	auditRequests.length = 0;
	await page.locator("#app-toolbar-left [role='combobox']").first().click();
	await page.waitForTimeout(300);
	await page.getByRole("option", { name: "安全日志" }).first().click();
	await page.waitForTimeout(900);
	const switched = auditRequests
		.filter((item) => item.path === "/api/audit/security-logs" && item.params.has("page"))
		.at(-1);
	log(
		"日志族下拉切换端点与时间参数（security-logs + logged_from / logged_to）",
		!!switched
		&& switched.params.get("logged_from") === epochOf(`${firstDay}T00:00:00`)
		&& switched.params.get("logged_to") === epochOf(`${secondDay}T23:59:59`),
		switched
			? `${switched.path} logged_from=${switched.params.get("logged_from")} logged_to=${switched.params.get("logged_to")}`
			: "没有 security-logs 请求"
	);

	// 归档族：`/audit/archive/records` **没有时间条件** → 范围控件收起、请求里不出现时间参数
	auditRequests.length = 0;
	await page.locator("#app-toolbar-left [role='combobox']").first().click();
	await page.waitForTimeout(300);
	await page.getByRole("option", { name: "归档记录" }).first().click();
	await page.waitForTimeout(900);
	const archiveList = auditRequests
		.filter((item) => item.path === "/api/audit/archive/records" && item.params.has("page"))
		.at(-1);
	const archiveToolbar = await page.evaluate(() => ({
		ariaLabels: Array.from(document.querySelector("#app-toolbar-left")?.querySelectorAll("button") ?? []).map((el) => el.getAttribute("aria-label") ?? "")
	}));
	log(
		"归档族不设时间条件（收起范围控件、请求不带时间参数）",
		!!archiveList
		&& !archiveList.params.has("created_from")
		&& !archiveList.params.has("logged_from")
		&& !archiveToolbar.ariaLabels.includes("时间范围"),
		archiveList
			? `${archiveList.path} 参数=${Array.from(archiveList.params.keys()).join("/")}`
			: "没有归档请求"
	);

	// 窄视口：时间范围退成图标（文案进 `aria-label`），左区仍放得下（§4.4 不换行、§3.3 无横向滚动）
	await page.setViewportSize({ width: 320, height: 900 });
	await page.goto(`${BASE_URL}/system/log`, { waitUntil: "networkidle" });
	await page.waitForTimeout(600);
	const narrowAudit = await page.evaluate(() => ({
		overflow: document.documentElement.scrollWidth > window.innerWidth,
		leftText: (document.querySelector("#app-toolbar-left")?.textContent ?? "").replace(/\s+/g, " ").trim(),
		comboboxes: document.querySelector("#app-toolbar-left")?.querySelectorAll("[role='combobox']").length ?? 0
	}));
	log(
		"320px 下审计日志左区收成图标且无横向溢出",
		!narrowAudit.overflow && !narrowAudit.leftText.includes("全部时间") && narrowAudit.comboboxes === 1,
		`overflow=${narrowAudit.overflow} 左区="${narrowAudit.leftText}" combobox=${narrowAudit.comboboxes}`
	);
	await page.setViewportSize({ width: 1440, height: 900 });

	page.off("request", recordAuditRequest);
}

// 7.5 列表栏尾部（NMCPS-ARCH-006 §3.8）：三条实测问题的回归守卫 ——
// ① 尾高固定 49px（`--app-list-footer-h`）且在滚动区之外；
// ② 每页默认 15 条，四个列表页都在尾部提供选择器（此前只有 /system/log 有一个，还藏在筛选浮层里）；
// ③ 选中行底色与未选中行在浅 / 深两模式都能分辨（此前 `bg-elevated/60` 叠在白面板上几乎同色）。
if (upstreamPort) {
	const LIST_PAGES = ["/system/user", "/system/policy", "/system/permission", "/system/log"];
	const footers = [];
	const auditPageSizes = [];
	const recordPageSize = (request) => {
		const url = new URL(request.url());
		if (url.pathname === "/api/audit/operation-logs")
			auditPageSizes.push(url.searchParams.get("page_size"));
	};
	page.on("request", recordPageSize);

	for (const path of LIST_PAGES) {
		await page.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle" });
		await page.waitForTimeout(400);
		const measured = await page.evaluate(() => {
			const footer = document.querySelector("[data-list-footer]");
			const rect = footer?.getBoundingClientRect();
			return {
				height: rect ? Math.round(rect.height) : 0,
				// 尾部的每页条数选择器（`USelect` 渲染成 `[role='combobox']`）：必须正好一个
				selectors: footer?.querySelectorAll(":scope > div [role='combobox']").length ?? 0
			};
		});
		footers.push([path, measured]);
	}

	log(
		"列表栏尾部高 49px、四个列表页各有一处每页条数选择器",
		footers.every(([, f]) => f.height === 49) && footers.every(([, f]) => f.selectors === 1),
		`${footers.map(([path, f]) => `${path}=${f.height}px/${f.selectors}个`).join(" ")}`
	);

	// 默认 15 条：`/system/log` 首次列表请求必须带 page_size=15（默认值漂回 20 就红）
	log(
		"列表默认每页 15 条（请求带 page_size=15）",
		auditPageSizes.length > 0 && auditPageSizes[0] === "15",
		`首个 page_size=${auditPageSizes[0] ?? "无请求"}`
	);

	// 选中行底色：读计算样式，浅色与深色各测一次（`dark` 类切换会立即换掉 --ui-bg-* 变量）
	const readRowFill = () => page.evaluate(() => {
		const rowsEls = Array.from(document.querySelectorAll("[role='option']"));
		const selected = rowsEls.find((el) => el.getAttribute("aria-selected") === "true");
		const other = rowsEls.find((el) => el.getAttribute("aria-selected") !== "true");
		const fill = (el) => (el ? getComputedStyle(el).backgroundColor : "");
		return { rows: rowsEls.length, selected: fill(selected), other: fill(other) };
	});
	const isOpaque = (color) => !!color && color !== "transparent" && !/rgba\([^)]*,\s*0\)$/.test(color);

	const lightFill = await readRowFill();
	await page.evaluate(() => document.documentElement.classList.add("dark"));
	await page.waitForTimeout(300);
	const darkFill = await readRowFill();
	await page.evaluate(() => document.documentElement.classList.remove("dark"));
	await page.waitForTimeout(200);

	log(
		"选中行底色在浅 / 深两模式都可辨（≠ 未选中行）",
		lightFill.rows > 1
		&& isOpaque(lightFill.selected) && lightFill.selected !== lightFill.other
		&& isOpaque(darkFill.selected) && darkFill.selected !== darkFill.other,
		`浅=${lightFill.selected}/${lightFill.other} 深=${darkFill.selected}/${darkFill.other}`
	);

	page.off("request", recordPageSize);
}

// 8. 自助安全设置（NMCPS-ARCH-003 §7.5）：已登录后两个表单可操作
await page.goto(`${BASE_URL}/user/security`, { waitUntil: "networkidle" });
const securityPage = await page.evaluate(() => {
	const text = document.body.textContent ?? "";
	const inputs = Array.from(document.querySelectorAll("input"));

	return {
		text,
		hasMfaCard: text.includes("两步验证（TOTP）"),
		hasPasswordCard: text.includes("修改登录口令"),
		mfaOffline: !!document.querySelector("[data-testid='mfa-unavailable']") && text.includes("暂无多因子端点"),
		guideVisible: text.includes("请先登录"),
		passwordInputs: inputs.filter((el) => el.getAttribute("type") === "password"),
		passwordInputsDisabled: inputs
			.filter((el) => el.getAttribute("type") === "password")
			.some((el) => el.hasAttribute("disabled"))
	};
});
log("安全设置页含两步验证（已下线）与改密两个区块", securityPage.hasMfaCard && securityPage.hasPasswordCard, `mfa=${securityPage.hasMfaCard} password=${securityPage.hasPasswordCard}`);
log("已登录后不再展示登录引导", !securityPage.guideVisible, securityPage.guideVisible ? "仍显示引导" : "未显示");
log("两步验证区块标明上游无端点（G8）", securityPage.mfaOffline, securityPage.mfaOffline ? "已标注" : "未标注");
log("已登录时改密表单可操作", securityPage.passwordInputs.length === 3 && !securityPage.passwordInputsDisabled, `inputs=${securityPage.passwordInputs.length}`);

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

// 11. 拓扑监控（NMCPS-DESIGN-001 §九 A1~A9）：页面接两条通道 —— 8888 `/api/topology/graph`
// 与 8001 `/api/sim/api/network/runtime-inventory`。本段锁四件事：画得出来、空拓扑走空态、
// 主上游掉线只降级不白屏、仿真通道未配置时页面照常只读且 `/ready` 不变红。
// A4 / A5 依赖假上游的 `__control/topology-*` 与 `__control/down`，外部实例模式无法构造，故只在自建模式跑。
{
	await page.goto(`${BASE_URL}/topology/monitor`, { waitUntil: "networkidle" });
	await page.waitForTimeout(600);

	const topoPath = new URL(page.url()).pathname;
	const topoText = await page.evaluate(() => document.body.textContent ?? "");
	log(
		"A1 /topology/monitor 可达且标题来自 i18n",
		topoPath === "/topology/monitor" && topoText.includes("拓扑监测"),
		`${topoPath} / ${topoText.includes("拓扑监测") ? "标题已渲染" : "未见标题"}`
	);

	const shapes = await page.evaluate(() => {
		const svg = document.querySelector("[data-testid='topology-canvas']");
		return svg
			? { circles: svg.querySelectorAll("circle").length, paths: svg.querySelectorAll("path").length }
			: null;
	});
	log(
		"A2 拓扑渲染出 canvas（节点 circle + 链路 path > 0）",
		!!shapes && shapes.circles > 0 && shapes.paths > 0,
		shapes ? `circles=${shapes.circles} paths=${shapes.paths}` : "未找到 [data-testid='topology-canvas']"
	);

	// A6：自建实例没有 `NUXT_SIMULATOR_BASE_URL` → 拓扑照常渲染，仿真动作整体 disabled 且有降级说明
	const simProbe = await page.evaluate(() => ({
		canvas: !!document.querySelector("[data-testid='topology-canvas']"),
		actions: Array.from(document.querySelectorAll("[data-testid='sim-action']")).map((el) => el.hasAttribute("disabled")),
		degraded: !!document.querySelector("[data-testid='sim-degraded']"),
		text: document.body.textContent ?? ""
	}));
	log("A6 仿真未配置时拓扑照常渲染", simProbe.canvas, simProbe.canvas ? "canvas 存在" : "canvas 缺失");
	log(
		"A6 仿真未配置时动作按钮全部 disabled",
		simProbe.actions.length === 2 && simProbe.actions.every(Boolean),
		`buttons=${simProbe.actions.length} disabled=${simProbe.actions.filter(Boolean).length}`
	);
	log(
		"仿真未配置时给出「未启用」降级说明",
		simProbe.degraded && simProbe.text.includes("仿真控制未启用"),
		simProbe.degraded ? "已提示" : "无降级条"
	);

	// A7：写端点在 `allowWrite=false`（默认）时被拒，且不触达上游。自建实例连仿真平台都没配，
	// 通道在 `baseUrl` 这一步就短路成 503 `simulator_not_configured`（处理顺序：路径白名单 → 通道
	// 是否启用 → 写权限），所以这里只能断言「默认配置下写不出去」；精确的 405 断言放在 11.1 的
	// 「通道已配置」实例里，两者合起来才是完整的写入口语义。
	const writeResponse = await page.request.post(`${BASE_URL}/api/sim/api/network/links/l1/down`, { data: {} }).catch(() => null);
	const writeJson = writeResponse ? await writeResponse.json().catch(() => null) : null;
	const writeBlocked = (writeResponse?.status() === 405 && writeJson?.message === "simulator_write_disabled")
		|| (writeResponse?.status() === 503 && writeJson?.message === "simulator_not_configured");
	log(
		"A7 默认配置下写端点被拒（405 写关闭 / 503 通道未启用）",
		writeBlocked,
		writeResponse ? `${writeResponse.status()} ${writeJson?.message ?? ""}` : "请求失败"
	);

	// A8：仿真未配置 / 写被拒都不许把就绪探针拉红
	const readyResponse = await page.request.get(`${BASE_URL}/ready`).catch(() => null);
	const readyJson = readyResponse ? await readyResponse.json().catch(() => null) : null;
	log(
		"A8 仿真通道不可用不影响 /ready",
		readyResponse?.status() === 200 && readyJson?.upstream?.configured === true,
		readyResponse ? `${readyResponse.status()} configured=${readyJson?.upstream?.configured}` : "无响应"
	);

	if (upstreamPort) {
		// A3：选中节点 → 详情栏出 `TrendChart`，指标请求带该节点的**管理 IP**（不是节点 id）。
		// 请求监听器要挂在点击之前：趋势是「选中即取」，挂晚了只能看到空清单。
		const trendRequests = [];
		const recordTrend = (request) => {
			if (request.url().includes("/api/metric/"))
				trendRequests.push(request.url());
		};
		page.on("request", recordTrend);

		const clickedNode = await page.evaluate(() => {
			const node = Array.from(document.querySelectorAll("[data-testid='topology-node']"))
				.find((el) => el.getAttribute("data-node-id") === "10.0.0.2");
			node?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			return node?.getAttribute("data-node-id") ?? null;
		});
		await page.waitForTimeout(800);

		const trendProbe = await page.evaluate(() => ({
			chart: !!document.querySelector("[data-testid='trend-chart']"),
			lines: document.querySelectorAll("[data-testid='trend-line']").length,
			text: document.body.textContent ?? ""
		}));
		page.off("request", recordTrend);

		// 编码断言的不是「随便抓一个名字」：假上游把 `up` / `scrape_*` 放在清单最前面，
		// 出现 `if_in_octets` 说明真的跳过了采集器自监控命名空间（CONTRACT-002 §三）。
		log(
			"A3 选中节点后详情栏出现 TrendChart（按目录选编码，跳过 collector）",
			clickedNode === "10.0.0.2" && trendProbe.chart && trendProbe.lines === 1 && trendProbe.text.includes("if_in_octets"),
			`node=${clickedNode} chart=${trendProbe.chart} lines=${trendProbe.lines}`
		);

		const datapointRequest = trendRequests.find((url) => url.includes("/api/metric/datapoint")) ?? "";
		log(
			"A3 指标请求带该节点管理 IP",
			datapointRequest.includes("mgmt_ip=10.0.0.2") && datapointRequest.includes("metric_code=if_in_octets"),
			datapointRequest ? datapointRequest.split("?")[1]?.slice(0, 120) ?? "" : "未见 /api/metric/datapoint 请求"
		);

		// 假上游的序列里夹了空串与 `NaN` 两个非法点：它们必须被丢弃并计数，绝不能被当成 0 画进来
		// （CONTRACT-002 §6.3 ②：丢弃 + 计数，不补 0、不插值）。
		log(
			"A3 非法采样点被丢弃并计数（不补 0）",
			trendProbe.text.includes("已忽略 2 个非法采样点"),
			trendProbe.text.includes("已忽略 2 个非法采样点") ? "计数 2" : `未见丢弃提示：${trendProbe.text.slice(0, 100)}`
		);

		// A4：上游回空节点集 → 空态而不是空白画布
		await fetch(`http://${HOST}:${upstreamPort}/__control/topology-empty`);
		await page.reload({ waitUntil: "networkidle" });
		await page.waitForTimeout(400);
		const emptyProbe = await page.evaluate(() => ({
			empty: !!document.querySelector("[data-testid='topology-empty']"),
			canvas: !!document.querySelector("[data-testid='topology-canvas']"),
			text: document.body.textContent ?? ""
		}));
		log(
			"A4 空拓扑渲染空态而非空白画布",
			emptyProbe.empty && !emptyProbe.canvas && emptyProbe.text.includes("暂无拓扑数据"),
			`empty=${emptyProbe.empty} canvas=${emptyProbe.canvas}`
		);
		await fetch(`http://${HOST}:${upstreamPort}/__control/topology-full`);

		// A5：8888 掉线 → 页面级错误态 + 重试按钮，页面不白屏；恢复后重试能回到拓扑。
		// 这里**不整页 reload**：掉线时重载会让会话探测也失败、被守卫送回登录页，
		// 断言的就不是拓扑页的错误态了。改为点工具栏「刷新拓扑」走同一条取数路径。
		await fetch(`http://${HOST}:${upstreamPort}/__control/down`);
		await page.getByRole("button", { name: "刷新拓扑" }).click();
		await page.waitForTimeout(1500);
		const downProbe = await page.evaluate(() => ({
			error: !!document.querySelector("[data-testid='topology-error']"),
			text: document.body.textContent ?? ""
		}));
		log(
			"A5 主上游掉线出错误态 + 重试（不白屏）",
			downProbe.error && downProbe.text.includes("加载拓扑失败") && downProbe.text.includes("重试"),
			`error=${downProbe.error}`
		);

		await fetch(`http://${HOST}:${upstreamPort}/__control/up`);
		await page.getByRole("button", { name: "重试" }).first().click();
		await page.waitForTimeout(1500);
		const recovered = await page.evaluate(() => !!document.querySelector("[data-testid='topology-canvas']"));
		log("A5 上游恢复后点重试可回到拓扑", recovered, recovered ? "已恢复" : "仍无 canvas");

		// A10：`/topology/device-metrics` —— 左栏台账行数与信封 `total` 一致、默认选中第一条、
		// 指标选择器**只列目录判为 `numeric` 的条目**（假上游把 `sys_name` 标成 `string`，
		// 把 `up` / `scrape_*` 放在名字清单最前：一个都不许出现在选项里）。
		const metricRequests = [];
		const recordMetric = (request) => {
			if (request.url().includes("/api/metric/"))
				metricRequests.push(request.url());
		};
		page.on("request", recordMetric);

		await page.goto(`${BASE_URL}/topology/device-metrics`, { waitUntil: "networkidle" });
		await page.waitForTimeout(1200);

		const deviceProbe = await page.evaluate(() => ({
			rows: document.querySelectorAll("[data-testid='metric-device-row']").length,
			selected: document.querySelector("[data-testid='metric-device-row'][aria-selected='true']")?.getAttribute("data-device-id") ?? "",
			chart: !!document.querySelector("[data-testid='trend-chart']"),
			text: document.body.textContent ?? ""
		}));
		log(
			"A10 设备台账渲染 + 默认选中第一条（计数来自信封 total）",
			deviceProbe.rows === 3 && deviceProbe.selected === "DEV-CORE-1" && deviceProbe.text.includes("共 3 台设备"),
			`rows=${deviceProbe.rows} selected=${deviceProbe.selected || "无"}`
		);
		log(
			"A10 选中设备后按 mgmt_ip 出 TrendChart",
			deviceProbe.chart && metricRequests.some((url) => url.includes("/api/metric/datapoint") && url.includes("mgmt_ip=10.0.0.2")),
			deviceProbe.chart ? "已出图" : "无 [data-testid='trend-chart']"
		);

		const definitionCalls = metricRequests.filter((url) => url.includes("/api/metric/definition")).length;
		log("A10 指标目录一次会话只取一次", definitionCalls === 1, `/api/metric/definition 命中 ${definitionCalls} 次`);

		// 选择器内容：真打开下拉读选项文案，而不是「页面上出现了某个字符串」
		await page.locator("[data-testid='metric-picker']").click();
		await page.waitForTimeout(400);
		const pickerOptions = await page.evaluate(() =>
			Array.from(document.querySelectorAll("[role='option']")).map((el) => el.textContent?.trim() ?? ""));
		await page.keyboard.press("Escape");
		await page.waitForTimeout(200);
		const pickerClean = pickerOptions.length > 0
			&& pickerOptions.some((item) => item.includes("Interface in octets"))
			&& pickerOptions.some((item) => item.includes("CPU utilization"))
			&& pickerOptions.every((item) => !item.includes("System name") && !item.includes("Scrape duration") && item !== "Up");
		log(
			"A10 指标选择器只列 numeric（sys_name / collector 全部缺席）",
			pickerClean,
			pickerOptions.length ? pickerOptions.join(" | ") : "下拉没有选项"
		);

		// A11：换指标 → `/api/metric/datapoint` 换 `metric_code`，且 `gauge` 上不出现速率开关
		// （§6.5：类型未定就不摆一个点了没反应的开关）。
		metricRequests.length = 0;
		await page.locator("[data-testid='metric-picker']").click();
		await page.waitForTimeout(300);
		await page.getByRole("option", { name: /CPU utilization/ }).first().click();
		await page.waitForTimeout(1200);
		const switched = metricRequests.filter((url) => url.includes("/api/metric/datapoint")).at(-1) ?? "";
		const rateSwitch = await page.evaluate(() => !!document.querySelector("[data-testid='metric-rate']"));
		log(
			"A11 切换指标改写 metric_code（仍是同一台设备的 mgmt_ip）",
			switched.includes("metric_code=cpu_util_pct") && switched.includes("mgmt_ip=10.0.0.2"),
			switched ? switched.split("?")[1]?.slice(0, 120) ?? "" : "未见 /api/metric/datapoint 请求"
		);
		log("A11 gauge 指标不显示速率开关", rateSwitch === false, rateSwitch ? "仍显示速率开关" : "已隐藏");

		// A12：`/topology/link-metrics` —— 台账当前值来自 `/metric/link`；链路没有 `mgmt_ip`，
		// 折线取 **source 端设备** 的 IP（靠 `/metric/device` 建 `device_code → mgmt_ip` 索引），
		// source 端没 IP 时只说明原因、不发请求。
		metricRequests.length = 0;
		await page.goto(`${BASE_URL}/topology/link-metrics`, { waitUntil: "networkidle" });
		await page.waitForTimeout(1200);

		const linkProbe = await page.evaluate(() => ({
			rows: document.querySelectorAll("[data-testid='metric-link-row']").length,
			selected: document.querySelector("[data-testid='metric-link-row'][aria-selected='true']")?.getAttribute("data-link-id") ?? "",
			chart: !!document.querySelector("[data-testid='trend-chart']"),
			seriesIfIndex: document.querySelector("[data-testid='metric-trend']")?.getAttribute("data-series-if-index") ?? "",
			seriesCount: document.querySelector("[data-testid='metric-trend']")?.getAttribute("data-series-count") ?? "",
			text: document.body.textContent ?? ""
		}));
		log(
			"A12 链路台账渲染当前值（利用率 / 时延来自 /metric/link）",
			linkProbe.rows === 2
			&& linkProbe.text.includes("共 2 条链路")
			&& linkProbe.text.includes("32.5%")
			&& linkProbe.text.includes("1.2 ms"),
			`rows=${linkProbe.rows} selected=${linkProbe.selected || "无"}`
		);

		const linkIndex = metricRequests.find((url) => url.includes("/api/metric/device") && url.includes("page_size=200")) ?? "";
		const linkDatapoint = metricRequests.filter((url) => url.includes("/api/metric/datapoint")).at(-1) ?? "";
		log(
			"A12 链路折线取 source 端设备 IP（device_code → mgmt_ip 反查）",
			linkProbe.selected === "LNK-0001"
			&& !!linkIndex
			&& linkProbe.chart
			&& linkDatapoint.includes("mgmt_ip=10.0.0.2")
			&& linkProbe.text.includes("这条折线来自 source 端的该端口"),
			linkDatapoint ? linkDatapoint.split("?")[1]?.slice(0, 120) ?? "" : "未见 /api/metric/datapoint 请求"
		);
		// CONTRACT-002 §6.9：折线只取 source 端该端口（假上游造了 ifIndex 101/102 × 双 job），
		// 命中的组键必须是 101，且跨 job 已合并成 2 条同源序列 —— 取 results[0] 或混画都会露馅。
		log(
			"A12 折线命中 source 端 ifIndex（两端口不混画、跨 job 取均值）",
			linkProbe.seriesIfIndex === "101" && linkProbe.seriesCount === "2",
			`ifIndex=${linkProbe.seriesIfIndex || "无"} series=${linkProbe.seriesCount || "无"}`
		);

		// 设备级指标（无 `ifIndex` 标签）在链路页必须如实标注，而不是冒充端口序列
		await page.locator("[data-testid='metric-picker']").click();
		await page.waitForTimeout(300);
		await page.getByRole("option", { name: /CPU utilization/ }).first().click();
		await page.waitForTimeout(1200);
		const deviceLevelProbe = await page.evaluate(() => ({
			note: !!document.querySelector("[data-testid='metric-device-level-note']"),
			seriesIfIndex: document.querySelector("[data-testid='metric-trend']")?.getAttribute("data-series-if-index") ?? ""
		}));
		log(
			"A12 设备级指标标注为设备级（不冒充端口序列）",
			deviceLevelProbe.note && deviceLevelProbe.seriesIfIndex === "",
			`note=${deviceLevelProbe.note} ifIndex=${deviceLevelProbe.seriesIfIndex || "无"}`
		);

		// source 端没有 mgmt_ip（假上游的 DEV-AP-1）→ 只给一句原因，不发明请求
		metricRequests.length = 0;
		await page.locator("[data-link-id='LNK-0002']").click();
		await page.waitForTimeout(900);
		const noIpProbe = await page.evaluate(() => ({
			notice: !!document.querySelector("[data-testid='metric-no-ip']"),
			chart: !!document.querySelector("[data-testid='trend-chart']")
		}));
		const noIpRequests = metricRequests.filter((url) => url.includes("/api/metric/datapoint")).length;
		log(
			"A12 source 端缺 mgmt_ip 时只说明原因、不发取数请求",
			noIpProbe.notice && !noIpProbe.chart && noIpRequests === 0,
			`notice=${noIpProbe.notice} chart=${noIpProbe.chart} datapoint=${noIpRequests}`
		);

		// A13：上游**回了信封但业务失败**（HTTP 200 + `code !== 0`，§6.7）—— 页面必须逐字给出上游原话
		// 并给重试，且不能把失败画成「该时间窗内无采集数据」（空态是「没数据」，失败是「取不到」，两回事）。
		// 这里用 `__control/metric-error` 而不是 `__control/down`：后者断的是网络错误下的 stale 分支。
		await fetch(`http://${HOST}:${upstreamPort}/__control/metric-error`);
		// 整页重开而不是在原地切链路：切链路会复用同一个面板实例，上一台设备留下的点会走到 stale 分支，
		// 断言的就不是「纯失败态」了。
		await page.goto(`${BASE_URL}/topology/link-metrics`, { waitUntil: "networkidle" });
		await page.waitForTimeout(1_200);

		const failProbe = await page.evaluate(() => {
			const box = document.querySelector("[data-testid='metric-trend-error']");
			return {
				box: !!box,
				text: box?.textContent ?? "",
				chart: !!document.querySelector("[data-testid='metric-trend']"),
				page: document.body.textContent ?? ""
			};
		});
		log(
			"A13 上游 code !== 0 时逐字展示原话 + 重试（不降级成空态）",
			failProbe.box
			&& failProbe.text.includes(METRIC_UPSTREAM_FAILURE)
			&& failProbe.text.includes("重试")
			&& !failProbe.chart
			&& !failProbe.page.includes("该时间窗内无采集数据"),
			`box=${failProbe.box} chart=${failProbe.chart} 原话=${failProbe.text.includes(METRIC_UPSTREAM_FAILURE)}`
		);

		// A13 的反向：上游恢复后点「重试」必须真的拿到数据 —— 否则「重试」只是个摆设
		await fetch(`http://${HOST}:${upstreamPort}/__control/metric-ok`);
		await page.locator("[data-testid='metric-trend-error']").getByRole("button", { name: "重试" }).click();
		await page.waitForTimeout(1_500);
		const retryProbe = await page.evaluate(() => ({
			box: !!document.querySelector("[data-testid='metric-trend-error']"),
			chart: !!document.querySelector("[data-testid='trend-chart']"),
			seriesIfIndex: document.querySelector("[data-testid='metric-trend']")?.getAttribute("data-series-if-index") ?? ""
		}));
		log(
			"A13 上游恢复后点重试能拿到数据（错误态消失）",
			!retryProbe.box && retryProbe.chart && retryProbe.seriesIfIndex === "101",
			`box=${retryProbe.box} chart=${retryProbe.chart} ifIndex=${retryProbe.seriesIfIndex || "无"}`
		);

		page.off("request", recordMetric);
	}
}

// 11.1 仿真通道**已配置**的对照面（只有自建模式能拉起假仿真平台）：另起一个带
// `NUXT_SIMULATOR_BASE_URL` 的 BFF，断言「仿真中」标记真的落到对齐的节点上（虚线外环 2 个）、
// 未配置时的降级条消失。这条是 A6 的反向证明 —— 只测「未配置」等于没测过通道接通。
if (upstreamPort) {
	const simPort = await freePort();
	const simulatorServer = await startSimulator(simPort);
	const simBffPort = await freePort();
	const simBffBase = `http://${HOST}:${simBffPort}`;
	const simBff = await startBff(simBffPort, {
		NUXT_BFF_UPSTREAM_BASE: `http://${HOST}:${upstreamPort}`,
		NUXT_SIMULATOR_BASE_URL: `http://${HOST}:${simPort}`
	});

	try {
		const simContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
		const simPage = await simContext.newPage();
		// 记下「页面打开之前」的请求数：后面的「页面零写请求」只数这一段之后的新增
		const simLogBeforePage = simulatorServer.log.length;
		await simPage.goto(`${simBffBase}/auth/login`, { waitUntil: "networkidle" });
		await simPage.locator("input[autocomplete='username']").fill(ACCOUNT);
		await simPage.locator("input[type='password']").fill(PASSWORD);
		await simPage.locator("button[type='submit']").first().click();
		await simPage.waitForURL((url) => url.pathname !== "/auth/login", { timeout: 20_000 }).catch(() => {});
		await simPage.goto(`${simBffBase}/topology/monitor`, { waitUntil: "networkidle" });
		await simPage.waitForTimeout(800);

		const probe = await simPage.evaluate(() => ({
			degraded: !!document.querySelector("[data-testid='sim-degraded']"),
			markers: document.querySelectorAll("[data-testid='topology-canvas'] circle[stroke-dasharray]").length,
			text: document.body.textContent ?? ""
		}));
		log(
			"仿真通道已配置时按管理 IP 对齐并叠加「仿真中」标记",
			!probe.degraded && probe.markers === 2,
			`markers=${probe.markers} degraded=${probe.degraded}`
		);
		log(
			"仿真通道已配置时不再显示降级条",
			!probe.text.includes("仿真控制未启用"),
			probe.text.includes("仿真控制未启用") ? "仍提示未启用" : "无降级提示"
		);

		// A9 的「没开写」一半：能力位如实回报「已配置、未开写」，且响应体里没有上游地址 ——
		// 页面据此把按钮置灰，而不是让用户点了再收 405。地址泄露是安全问题，这里按原文搜端口号。
		const channelOff = await simPage.request.get(`${simBffBase}/api/sim/channel`).catch(() => null);
		const channelOffJson = channelOff ? await channelOff.json().catch(() => null) : null;
		const channelOffRaw = channelOff ? await channelOff.text().catch(() => "") : "";
		log(
			"能力探针回「已配置 + 未开写」且不泄露上游地址",
			channelOff?.status() === 200
			&& channelOffJson?.data?.configured === true
			&& channelOffJson?.data?.writeEnabled === false
			&& !channelOffRaw.includes(String(simPort)),
			channelOff
				? `${channelOff.status()} configured=${channelOffJson?.data?.configured} writeEnabled=${channelOffJson?.data?.writeEnabled} 泄露端口=${channelOffRaw.includes(String(simPort))}`
				: "请求失败"
		);

		// 未开写时页面连一条写请求都不该发（BFF 的 405 只是绕过前端时的第二道闸）
		const pageWriteHits = simulatorServer.log
			.slice(simLogBeforePage)
			.filter((entry) => entry.method !== "GET")
			.length;
		log(
			"未开写时页面零写请求（按钮置灰不靠 405 兜底）",
			pageWriteHits === 0,
			`页面期间写请求共 ${pageWriteHits} 次`
		);

		// A7 的精确面：通道已配置、`NUXT_SIMULATOR_ALLOW_WRITE` 仍是默认 false → 必须 405
		// `simulator_write_disabled`，且这个被拒的写请求**不**出现在假仿真平台的请求日志里。
		const writeHitsBefore = simulatorServer.log.length;
		const writeOff = await simPage.request.post(`${simBffBase}/api/sim/api/network/links/l1/down`, { data: {} }).catch(() => null);
		const writeOffJson = writeOff ? await writeOff.json().catch(() => null) : null;
		log(
			"仿真通道已配置时写端点仍 405 simulator_write_disabled",
			writeOff?.status() === 405 && writeOffJson?.message === "simulator_write_disabled",
			writeOff ? `${writeOff.status()} ${writeOffJson?.message ?? ""}` : "请求失败"
		);
		// 只数写请求：页面每 30s 仍会轮询只读端点，用「非 GET」判断才不会误报。
		const writesReachedUpstream = simulatorServer.log
			.slice(writeHitsBefore)
			.filter((entry) => entry.method !== "GET")
			.length;
		log(
			"被 405 拦下的写请求不触达仿真平台",
			writesReachedUpstream === 0,
			`写请求命中共 ${writesReachedUpstream} 次`
		);
		await simContext.close();
	} finally {
		await stopBff(simBff);
		await closeUpstream(simulatorServer);
	}
}

// 11.2 写入口（NMCPS-DESIGN-001 §九 A9）：再起一个带 `NUXT_SIMULATOR_ALLOW_WRITE=true` 的 BFF。
// 11.1 证明「没开写时一步也走不出去」，这里证明「开了写之后按钮真的能按下、按下真的到达上游」——
// 两条合起来才是完整的写入口语义：能力位 → 二次确认 → 上游实收 → 成功提示。
if (upstreamPort) {
	const writeSimPort = await freePort();
	const writeSimulator = await startSimulator(writeSimPort);
	const writeBffPort = await freePort();
	const writeBffBase = `http://${HOST}:${writeBffPort}`;
	const writeBff = await startBff(writeBffPort, {
		NUXT_BFF_UPSTREAM_BASE: `http://${HOST}:${upstreamPort}`,
		NUXT_SIMULATOR_BASE_URL: `http://${HOST}:${writeSimPort}`,
		NUXT_SIMULATOR_ALLOW_WRITE: "true"
	});

	try {
		const channelOnResponse = await fetch(`${writeBffBase}/api/sim/channel`).catch(() => null);
		const channelOnBody = channelOnResponse ? await channelOnResponse.json().catch(() => null) : null;
		log(
			"开启写开关后能力探针回 writeEnabled=true",
			channelOnResponse?.status === 200 && channelOnBody?.data?.writeEnabled === true,
			`${channelOnResponse?.status ?? 0} writeEnabled=${channelOnBody?.data?.writeEnabled}`
		);

		/** 两个写入口按钮当前的 `disabled` 状态（顺序与 DOM 一致） */
		const simActionStates = (page) => page.evaluate(() =>
			Array.from(document.querySelectorAll("[data-testid='sim-action']")).map((el) => el.hasAttribute("disabled"))
		);

		const writeContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
		const writePage = await writeContext.newPage();
		await writePage.goto(`${writeBffBase}/auth/login`, { waitUntil: "networkidle" });
		await writePage.locator("input[autocomplete='username']").fill(ACCOUNT);
		await writePage.locator("input[type='password']").fill(PASSWORD);
		await writePage.locator("button[type='submit']").first().click();
		await writePage.waitForURL((url) => url.pathname !== "/auth/login", { timeout: 20_000 }).catch(() => {});
		await writePage.goto(`${writeBffBase}/topology/monitor`, { waitUntil: "networkidle" });
		await writePage.waitForTimeout(800);

		const idleActions = await simActionStates(writePage);
		log(
			"A9 开了写但没选节点时按钮仍 disabled",
			idleActions.length === 2 && idleActions.every(Boolean),
			`buttons=${idleActions.length} disabled=${idleActions.filter(Boolean).length}`
		);

		// 选一个「仿真中」的节点：虚线外环就是 8001 运行态对齐的结果（`circle[stroke-dasharray]`）。
		// 用派发 click 而不是坐标点击：SVG 的命中测试会受缩放 / 拖拽层影响，派发事件测的是同一条处理链。
		await writePage.evaluate(() => {
			const node = Array.from(document.querySelectorAll("[data-testid='topology-node']"))
				.find((el) => el.querySelector("circle[stroke-dasharray]"));
			node?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		await writePage.waitForTimeout(300);

		const selectedActions = await simActionStates(writePage);
		log(
			"A9 选中仿真节点后写按钮可点",
			selectedActions.length === 2 && selectedActions.every((disabled) => disabled === false),
			`buttons=${selectedActions.length} disabled=${selectedActions.filter(Boolean).length}`
		);

		const writeHitsBefore = writeSimulator.log.length;
		await writePage.locator("[data-testid='sim-action'][data-action='restart']").click();
		const confirmVisible = await writePage.locator("[data-testid='sim-confirm']").isVisible().catch(() => false);
		// UModal 的根是 DialogRoot（无 DOM），`data-testid` 传不进去 —— 只按 ARIA 角色取整张弹窗，
		// 这样标题（动作）、正文（目标）与按钮（提交）一起进断言，缺一样就红。
		const confirmText = confirmVisible
			? await writePage.locator("[role='dialog']").first().evaluate((el) => el.textContent ?? "").catch(() => "")
			: "";
		log(
			"A9 点按钮先弹二次确认（写明动作与目标）",
			confirmVisible
			&& confirmText.includes("确认下发仿真动作")
			&& confirmText.includes("重启节点")
			&& confirmText.includes("核心路由器-1"),
			confirmVisible ? `弹窗文案：${confirmText.replace(/\s+/g, " ").slice(0, 100)}` : "未出现确认弹窗"
		);

		// 未确认前上游不该收到任何东西：二次确认不是装饰
		const writesBeforeConfirm = writeSimulator.log.slice(writeHitsBefore).filter((entry) => entry.method !== "GET").length;
		log(
			"A9 确认前不触达上游",
			writesBeforeConfirm === 0,
			`确认前写请求 ${writesBeforeConfirm} 次`
		);

		await writePage.locator("[data-testid='sim-confirm']").click();
		await writePage.waitForTimeout(1000);

		const writeHits = writeSimulator.log.slice(writeHitsBefore).filter((entry) => entry.method !== "GET");
		const writeHit = writeHits[0];
		log(
			"A9 确认后写请求真的到达仿真平台（方法与路径原样）",
			writeHits.length === 1
			&& writeHit?.method === "POST"
			&& /^\/api\/network\/nodes\/[^/]+\/restart$/.test(writeHit?.path ?? ""),
			writeHit ? `${writeHit.method} ${writeHit.path}（共 ${writeHits.length} 次）` : `写请求 ${writeHits.length} 次`
		);

		const afterWriteText = await writePage.evaluate(() => document.body.textContent ?? "");
		log(
			"A9 成功后给出成功提示并关掉弹窗",
			afterWriteText.includes("重启已下发")
			&& (await writePage.locator("[data-testid='sim-confirm']").isVisible().catch(() => false)) === false,
			afterWriteText.includes("重启已下发") ? "已提示「重启已下发」" : `未见成功提示：${afterWriteText.slice(0, 80)}`
		);

		await writeContext.close();
	} finally {
		await stopBff(writeBff);
		await closeUpstream(writeSimulator);
	}
}

// 但 `isTauri()` 只读 `globalThis.isTauri`；注入这一位 + 一个最小 IPC 桩，就能走到与桌面壳同一份运行时分支：
// 侧栏应出现「平台能力」分组，分组下正好 5 个探针入口。桌面模式下 BFF 不回写 cookie（令牌走
// `tauri-plugin-store`），所以这里另起一个带 `NUXT_PUBLIC_BFF_BASE` 的实例，并把桩 store 落 sessionStorage，
// 否则刷新即掉登录态。只在自建模式跑：外部实例的 bffBase 不归我们控制。
if (upstreamPort) {
	const tauriPort = await freePort();
	const tauriBase = `http://${HOST}:${tauriPort}`;
	const tauriBff = await startBff(tauriPort, {
		NUXT_BFF_UPSTREAM_BASE: `http://${HOST}:${upstreamPort}`,
		NUXT_PUBLIC_BFF_BASE: tauriBase
	});
	const tauriContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
	await tauriContext.addInitScript(() => {
		// `@tauri-apps/api` 的 isTauri() 只认这一位
		window.isTauri = true;
		const PREFIX = "nmcps-stub-store:";
		const readKey = (key) => {
			const raw = sessionStorage.getItem(PREFIX + key);
			return raw === null ? [null, false] : [JSON.parse(raw), true];
		};
		// 只覆盖产品代码用到的命令：store（令牌仓）、updater（静默检查）、os（平台探针）
		window.__TAURI_INTERNALS__ = {
			invoke: async (cmd, args = {}) => {
				switch (cmd) {
					case "plugin:store|load": return 1;
					case "plugin:store|get": return readKey(args.key);
					case "plugin:store|has": return readKey(args.key)[1];
					case "plugin:store|set":
						sessionStorage.setItem(PREFIX + args.key, JSON.stringify(args.value));
						return null;
					case "plugin:store|delete":
						sessionStorage.removeItem(PREFIX + args.key);
						return null;
					case "plugin:os|platform": return "linux";
					case "plugin:os|version": return "0.0.0-stub";
					case "plugin:os|arch": return "x86_64";
					case "plugin:os|locale": return "zh-CN";
					// 更新器无新版本，窗口 / 通知等探针在无头环境一律按「未支持」降级
					default: return null;
				}
			},
			transformCallback: () => 1,
			convertFileSrc: (path) => path
		};
	});

	const tauriPage = await tauriContext.newPage();
	await tauriPage.goto(`${tauriBase}/auth/login`, { waitUntil: "networkidle" });
	await tauriPage.locator("input[autocomplete='username']").fill(ACCOUNT);
	await tauriPage.locator("input[type='password']").fill(PASSWORD);
	await tauriPage.locator("button[type='submit']").first().click();
	await tauriPage.waitForURL((url) => url.pathname !== "/auth/login", { timeout: 20_000 }).catch(() => {});
	await tauriPage.goto(`${tauriBase}/dashboard/overview`, { waitUntil: "networkidle" });

	const sidebarText = await tauriPage.evaluate(() =>
		document.querySelector("[data-layout-metrics='sidebar']")?.textContent ?? ""
	);
	log("Tauri 宿主侧栏出现「平台能力」分组", sidebarText.includes("平台能力"), sidebarText.includes("平台能力") ? "已显示" : `未见分组：${sidebarText.slice(0, 160)}`);

	// 无 `to` 的分组父项是折叠触发器：展开后再核对 5 个探针入口
	await tauriPage.getByText("平台能力", { exact: true }).first().click();
	await tauriPage.waitForTimeout(300);
	const probeHrefs = await tauriPage.evaluate(() =>
		Array.from(document.querySelectorAll("[data-layout-metrics='sidebar'] a[href]"))
			.map((a) => a.getAttribute("href") ?? "")
	);
	const expectedHrefs = ["/os", "/file", "/store", "/notifications", "/webview"];
	const missingHrefs = expectedHrefs.filter((href) => !probeHrefs.includes(href));
	log("「平台能力」分组含 5 个探针入口", missingHrefs.length === 0, missingHrefs.length ? `缺 ${missingHrefs.join(" ")}` : expectedHrefs.join(" "));

	await tauriContext.close();
	await stopBff(tauriBff);
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
