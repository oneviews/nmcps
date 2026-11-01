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

// 4.2 MFA 账号：上游以 `401 20203` 拒绝本次登录 → 登录页必须展开动态口令输入框，补码后成功。
//     回归守卫：登录页曾只认 `20205`，MFA 已启用的账号因此永远看不到输入框（NMCPS-REC-001 REPO-02）。
//     仅在自建假上游模式跑：外部实例没有 `mfa-user` 这个探测账号。
if (upstreamPort) {
	const mfaContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
	const mfaPage = await mfaContext.newPage();
	await mfaPage.goto(`${BASE_URL}/auth/login`, { waitUntil: "networkidle" });
	await mfaPage.locator("input[autocomplete='username']").fill("mfa-user");
	await mfaPage.locator("input[type='password']").fill(PASSWORD);
	await mfaPage.locator("button[type='submit']").first().click();

	const otp = mfaPage.locator("input[autocomplete='one-time-code']");
	await otp.waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
	const otpVisible = await otp.isVisible().catch(() => false);
	const mfaText = await mfaPage.evaluate(() => document.body.textContent ?? "");
	log("上游 20203 时展开动态口令输入框并给出提示", otpVisible && mfaText.includes("需要动态口令"), `otp=${otpVisible}`);

	await otp.fill("123456");
	await mfaPage.locator("button[type='submit']").first().click();
	await mfaPage.waitForURL((url) => url.pathname === "/dashboard/overview", { timeout: 20_000 }).catch(() => {});
	const mfaLanding = new URL(mfaPage.url()).pathname;
	log("补齐动态口令后登录成功", mfaLanding === "/dashboard/overview", mfaLanding);
	await mfaContext.close();
}

// 4.3 强制改密：上游 `mustResetPassword: true` 不拦接口（纯前端约定），客户端必须把人送去
//     专用改密页 `/auth/change-password`，改完强制重登 —— 否则初始口令能一直用下去。
//     回归守卫：登录页此前只把标志塞进 ref 后立刻跳看板，警告永远不显示。
if (upstreamPort) {
	const changeContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
	const changePage = await changeContext.newPage();
	await changePage.goto(`${BASE_URL}/auth/login`, { waitUntil: "networkidle" });
	await changePage.locator("input[autocomplete='username']").fill("reset-user");
	await changePage.locator("input[type='password']").fill(PASSWORD);
	await changePage.locator("button[type='submit']").first().click();
	await changePage.waitForURL((url) => url.pathname === "/auth/change-password", { timeout: 20_000 }).catch(() => {});
	const changeLanding = new URL(changePage.url()).pathname;
	log("mustResetPassword 登录后落到专用改密页", changeLanding === "/auth/change-password", changeLanding);

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

	// 旧口令错是真的打到上游（`400 20201`）：必须点名「当前密码不正确」，不能回落通用失败
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
		"改密请求带旧口令且全程不带 firstReset",
		lastBody?.oldPassword === PASSWORD && passwordBodies.every((body) => body && body.firstReset === undefined),
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

	// 旧口令必须在上游就失效（`401 20201`）→ 登录页点名「账号或密码错误」且停在登录页，
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
		"改密后旧口令登录被拒（401 20201）",
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
// 只在自建模式跑：用例依赖假上游的固定账号集（ACC-1001…）与可控的窄视口。
if (upstreamPort) {
	const readUserPage = () => page.evaluate(() => {
		const root = document.querySelector("[data-split='user']");
		return {
			shape: root?.getAttribute("data-split-shape") ?? null,
			search: location.search,
			rows: Array.from(root?.querySelectorAll("[role='option']") ?? []).map((el) => ({
				// 行 `title` 形如「Alice · ACC-1001」：取末段作为记录标识
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
		firstLoad.shape === "two" && firstLoad.search.includes("id=ACC-1001") && firstLoad.rows[0]?.selected === true,
		`shape=${firstLoad.shape} url="${firstLoad.search}" 选中首行=${firstLoad.rows[0]?.selected ?? "无行"}`
	);

	// 3.2 深链：`?id` 直接命中当前页行 —— 不重新拉列表、也不发详情请求（命中判定只在 `rows` 里做）
	const deepLink = await openUserPage("?id=ACC-1002");
	const deepRow = deepLink.rows.find((row) => row.code === "ACC-1002");
	log(
		"深链 `?id` 命中列表行并渲染右栏详情",
		deepLink.shape === "two" && deepRow?.selected === true && deepLink.text.includes("ACC-1002") && deepLink.text.includes("Bob"),
		`url="${deepLink.search}" 命中=${deepRow?.selected ?? "无此行"}`
	);

	// 3.3 `?id` 不在当前结果内：只出空态提示，不清 URL、不静默翻页去捞、不发详情请求
	const detailRequests = [];
	const recordDetailRequest = (request) => {
		if (/^\/api\/account\/[^/]+$/.test(new URL(request.url()).pathname))
			detailRequests.push(request.url());
	};
	page.on("request", recordDetailRequest);
	const missing = await openUserPage("?id=ACC-9999");
	page.off("request", recordDetailRequest);
	log(
		"`?id` 不在当前结果内时给出空态提示且保留 URL",
		missing.search.includes("id=ACC-9999")
		&& missing.text.includes("不在当前结果内")
		&& missing.text.includes("ACC-9999")
		&& detailRequests.length === 0,
		`url="${missing.search}" 详情请求=${detailRequests.length}`
	);

	// 3.4 `?id=new`：新建是右栏的一个视图态，不再套一层弹窗（ARCH-006 §3.2 禁止项）
	const creating = await openUserPage("?id=new");
	const createDialogs = await page.locator("[role='dialog']").count();
	log(
		"`?id=new` 落右栏内联建号态（不弹窗）",
		creating.search.includes("id=new")
		&& creating.text.includes("新建账号")
		&& creating.text.includes("账号名")
		&& createDialogs === 0,
		`弹窗=${createDialogs} 表单=${creating.text.includes("账号名")}`
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
		overlayDetail.search.includes("id=ACC-1001") && visiblePanes(overlayDetail) === "detail",
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
		&& toolbarState.rightText.includes("新建账号")
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
		&& sidebarBar.rightText.includes("新建账号"),
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
		const items = Array.from(nav?.querySelectorAll("li") ?? [])
			.map((li) => (li.textContent ?? "").replace(/\s+/g, " ").trim())
			.filter((text) => text.length > 0);
		const record = nav?.querySelector("button");
		return {
			items,
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

// 11. Tauri 宿主模拟（NMCPS-ARCH-005 §7）：真实桌面壳（`pnpm tauri:dev`）需要图形环境，无头 CI 跑不起来，
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
