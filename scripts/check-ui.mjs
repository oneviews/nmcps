// scripts/check-ui.mjs
// 无头浏览器自查：用 Playwright 打开页面并断言关键交互/视觉/布局点。
//
// 基准地址：默认**自建** —— 拉起假上游（scripts/lib/bff-harness.mjs）+ `.output/server/index.mjs`，
// 端口自动分配，跑完即关；因此先 `pnpm build:server`。
// 需要测已有实例时用 CHECK_UI_BASE_URL 覆盖（此时不再拉起进程，改用下面两个变量登录）——
// 该实例必须自己配好 `NUXT_BFF_UPSTREAM_BASE`，否则登录与「上游就绪」用例必然失败。
// 环境变量：CHECK_UI_BASE_URL、CHECK_UI_ACCOUNT、CHECK_UI_PASSWORD、CHECK_UI_SCREENSHOT（截图输出路径）。
import { Buffer } from "node:buffer";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { CATALOG_UPSTREAM_FAILURE, closeUpstream, freePort, HOST, METRIC_UPSTREAM_FAILURE, MININET_TERMINAL_BANNER, startBff, startUpstream, stopBff } from "./lib/bff-harness.mjs";

const ACCOUNT = process.env.CHECK_UI_ACCOUNT ?? "alice";
const PASSWORD = process.env.CHECK_UI_PASSWORD ?? "p@ssw0rd";
const SHOT_PATH = process.env.CHECK_UI_SCREENSHOT ?? "/tmp/ui-check.png";

/** 自建环境：假上游 + 构建产物（没有 CHECK_UI_BASE_URL 时） */
let upstreamServer = null;
let bffChild = null;
/** 假上游端口：外部实例模式下为 null（此时无法控制「运行中掉线」） */
let upstreamPort = null;
let BASE_URL = process.env.CHECK_UI_BASE_URL?.replace(/\/+$/, "");

/**
 * 构建产物新鲜度守卫。
 *
 * 本脚本**不自建** `.output`：它跑的就是构建产物。改了 `layers/scenario/app` 却忘记
 * `pnpm build:server` 时，页面加载的是旧 bundle，新加的 `data-testid` / 文案一律不存在，
 * 失败信息全是「等不到元素」—— 2026-11-16 就因此白跑一轮（235/240），排查方向完全错。
 * 自建模式在拉起服务前先比时间戳：源码比产物新就直接停，把「重跑」变成「先构建」。
 * 外部实例模式（CHECK_UI_BASE_URL）不查 —— 那个实例的构建时间戳不在本机。
 */
const WATCHED_SOURCES = ["app", "layers", "shared", "i18n", "nuxt.config.ts", "package.json"];
const SKIP_DIRS = new Set(["node_modules", ".nuxt", ".output", ".data", "__pycache__", ".venv"]);

/** 目录树里最新的 mtime（毫秒）；读不到就当 0，不让守卫本身失败 */
function newestMtime(target) {
	try {
		const info = statSync(target);
		if (!info.isDirectory())
			return info.mtimeMs;
		let newest = info.mtimeMs;
		for (const entry of readdirSync(target, { withFileTypes: true })) {
			if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".nuxt"))
				continue;
			newest = Math.max(newest, newestMtime(join(target, entry.name)));
		}
		return newest;
	} catch {
		return 0;
	}
}

function assertBuildFresh() {
	const entry = join(process.cwd(), ".output", "server", "index.mjs");
	if (!existsSync(entry)) {
		console.error("\n❌ 自建模式需要构建产物，但 `.output/server/index.mjs` 不存在：先跑 `pnpm build:server`。");
		process.exit(1);
	}

	const built = statSync(entry).mtimeMs;
	const stale = WATCHED_SOURCES
		.map((path) => ({ path, mtime: newestMtime(join(process.cwd(), path)) }))
		.filter((item) => item.mtime > built)
		.sort((left, right) => right.mtime - left.mtime);

	if (stale.length) {
		console.error(`\n❌ 构建产物比源码旧（最新改动在 \`${stale[0].path}\`）：先跑 \`pnpm build:server\`，否则本轮测的是旧 bundle，失败不代表代码有问题。`);
		process.exit(1);
	}
}

if (!BASE_URL) {
	assertBuildFresh();
	upstreamPort = await freePort();
	upstreamServer = await startUpstream(upstreamPort);
	const port = await freePort();
	bffChild = await startBff(port, {
		NUXT_BFF_UPSTREAM_BASE: `http://${HOST}:${upstreamPort}`,
		// 实验端点要读签名会话（`authorizeLabSession`）：缺 secret 时通道探针直接 503
		// `bff_auth_not_configured`，监控页会把「没配实例」误读成「通道不可达」（A34 / A6）。
		NUXT_BFF_SESSION_SECRET: "check-ui-main-session-secret-0123456789abcdef",
		// 本实例要测「实验台操作员」预填与三枚演示身份按钮：显式打开演示开关
		// （缺省 false，见 nuxt.config.ts 的 `public.demoLabOperator`）
		NUXT_PUBLIC_DEMO_LAB_OPERATOR: "true"
	});
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

/**
 * 切到详情区某个 Tab（1.0 版式：页签固定在内容页工具栏右区，内容按 Tab 条件渲染）。
 *
 * 详情页默认停在「概览」，折线只在「图表」页 —— 不切 Tab 就断言 `trend-chart`，
 * 测的其实是「概览页没有图」这种意外。Tab 文案走 i18n（默认 cn），按 `role=tab` 的名字点。
 */
async function openDetailTab(tabLabel) {
	await page.getByRole("tab", { name: tabLabel }).first().click();
	await page.waitForTimeout(1200);
}

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
log("登录页默认预填实验台操作员种子账号（alice，本地演示）", prefill.account === "alice" && prefill.password === "p@ssw0rd", `${prefill.account} / ${prefill.password ? "****" : "空"}`);

// 3.2 一键切换演示身份：账号 / 口令整体回填（新代无租户编码，NMCPS-ADR-0018 §4.1）
await page.getByRole("button", { name: "租户管理员" }).click();
await page.waitForTimeout(200);
const tenantPrefill = await readCredentials();
log("切换演示身份回填租户管理员种子账号", tenantPrefill.account === "tenantadmin" && tenantPrefill.password === "admin_2026", `${tenantPrefill.account} / ${tenantPrefill.password ? "****" : "空"}`);

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

		// 演示开关默认关闭（`NUXT_PUBLIC_DEMO_LAB_OPERATOR` 未设）：真实 IAM 只有两个种子账号，
		// 预填回到平台管理员，且不渲染真实环境里登不进去的「实验台操作员」按钮
		const bareDemo = await bare.evaluate(() => ({
			account: document.querySelector("input[autocomplete='username']")?.value ?? "",
			buttons: [...document.querySelectorAll("button")].map((node) => (node.textContent ?? "").trim())
		}));
		const demoLabels = bareDemo.buttons.filter((label) => ["超级管理员", "租户管理员", "实验台操作员"].includes(label));
		log(
			"演示开关关闭时不提供实验台操作员身份：预填平台管理员、按钮只剩两枚",
			bareDemo.account === "admin"
			&& demoLabels.includes("超级管理员")
			&& demoLabels.includes("租户管理员")
			&& !demoLabels.includes("实验台操作员"),
			`预填=${bareDemo.account} 按钮=${JSON.stringify(demoLabels)}`
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
// ③ 选中行底色与未选中行在浅 / 深两模式都能分辨（此前 `bg-elevated/60` 叠在白面板上几乎同色；
//    现行规则是 `NMCPS-ARCH-006` §3.6 的 `.list-row-selected` —— 主色半透明底 + 左缘主色竖条）。
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
// 与引擎面 `/api/mininet/nodes` + `/links`（`NMCPS-ADR-0027` §4 R8）。本段锁四件事：画得出来、
// 空拓扑走空态、主上游掉线只降级不白屏、租户没有实验实例时页面照常只读且 `/ready` 不变红。
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

	/**
	 * A2：拓扑渲染出画布，且**每台设备圆内都有一枚设备类型的 Carbon 图标**（§七，2026-11-15 加钉）。
	 * 图标由 `<UIcon mode="svg">` 渲染成嵌套 `<svg>`，读数因此落在节点 `<g>` 里的
	 * `[data-testid='topology-node-icon']` 的 `data-node-icon` 上（不是外层 `circle`）。
	 * 默认样本逐台钉死：核心 → 路由、汇聚 → 三层交换、接入 → 二层交换、末梢 AP → `carbon:wifi`、
	 * 终端 → 笔记本（判据表见 `app/utils/graph/topologyNodeIcon.ts`：层数**先看名称**再看 `type`，
	 * 所以 `type: "access"` 的「汇聚交换机-1」仍是三层；AP 只有名称写明「三层」才是
	 * `carbon:router-wifi`，样本里的 `10.0.0.4` 是末梢 AP，因此 `carbon:wifi`）。
	 */
	const canvasProbe = await page.evaluate(() => {
		const svg = document.querySelector("[data-testid='topology-canvas']");
		if (!svg)
			return null;
		const iconEl = (id) => svg.querySelector(`[data-testid='topology-node'][data-node-id='${id}'] [data-testid='topology-node-icon']`);
		const iconEls = Array.from(svg.querySelectorAll("[data-testid='topology-node-icon']"));
		const nodes = svg.querySelectorAll("[data-testid='topology-node']").length;
		const icons = iconEls.map((el) => el.getAttribute("data-node-icon") ?? "");
		/** 图标体真的画出来了吗：合法的 Carbon 名会渲染 `<path>`，非法名只留一个空 `<svg>`（A48 踩过） */
		const core = svg.querySelector("[data-testid='topology-node'][data-node-id='10.0.0.1']");
		const coreGlyph = core?.querySelector("[data-testid='topology-node-icon'] path, [data-testid='topology-node-icon'] circle, [data-testid='topology-node-icon'] rect, [data-testid='topology-node-icon'] line, [data-testid='topology-node-icon'] polygon");
		const coreShape = core?.querySelector("[data-testid='topology-node-shape']");
		return {
			circles: svg.querySelectorAll("circle").length,
			paths: svg.querySelectorAll("path").length,
			nodes,
			icons: icons.length,
			carbon: icons.every((name) => name.startsWith("carbon:")),
			drawn: iconEls.filter((el) => el.childElementCount > 0).length,
			/** 图标颜色必须等于本层层色（Carbon 体用 `currentColor`，`roleTextClass()` 与描边同源） */
			fill: coreGlyph ? getComputedStyle(coreGlyph).fill : "",
			ring: coreShape ? getComputedStyle(coreShape).stroke : "",
			mapping: ["10.0.0.1", "10.0.0.2", "10.0.0.3", "10.0.0.4", "10.0.0.5"].map((id) => iconEl(id)?.getAttribute("data-node-icon") ?? "")
		};
	});
	const expectedIcons = ["carbon:router", "carbon:switch-layer-3", "carbon:switch-layer-2", "carbon:wifi", "carbon:laptop"];
	/**
	 * A2 续（同一条用例，不新增计数）：**名称压过 `type`**。`__control/topology-same-tier` 的 8 台
	 * 设备 `type` 全是 `access`（现网口径），逐台读图标即可证明判据顺序 —— 若 `type` 优先，
	 * 「汇聚交换机-1」会是 `carbon:switch-layer-2`、「核心路由器-1」会是交换机图标（2026-11-15
	 * 用户实测指出）；胖 AP 也必须留在 `carbon:wifi`（它带路由，但不是三层 AP）。
	 * 只在自建模式跑（外部实例没有假上游的控制端点），读不到时该条不加钉。
	 */
	let sameTierIcons = null;
	if (upstreamPort) {
		await fetch(`http://${HOST}:${upstreamPort}/__control/topology-same-tier`);
		await page.reload({ waitUntil: "networkidle" });
		await page.waitForTimeout(600);
		sameTierIcons = await page.evaluate((ids) => {
			const svg = document.querySelector("[data-testid='topology-canvas']");
			if (!svg)
				return null;
			return ids.map((id) => svg.querySelector(`[data-testid='topology-node'][data-node-id='${id}'] [data-testid='topology-node-icon']`)?.getAttribute("data-node-icon") ?? "");
		}, ["10.0.3.1", "10.0.3.2", "10.0.3.3", "10.0.3.4", "10.0.3.10", "10.0.3.21"]);
		// 复位默认样本：后面的断言仍按 6 节点样本读数
		await fetch(`http://${HOST}:${upstreamPort}/__control/topology-default`);
		await page.reload({ waitUntil: "networkidle" });
		await page.waitForTimeout(400);
	}
	const expectedSameTier = ["carbon:router", "carbon:switch-layer-3", "carbon:switch-layer-2", "carbon:switch-layer-2", "carbon:wifi", "carbon:laptop"];
	const sameTierOk = !upstreamPort || (!!sameTierIcons && sameTierIcons.join(",") === expectedSameTier.join(","));
	log(
		"A2 拓扑渲染出 canvas（节点 circle + 链路 path > 0，且每台设备带 Carbon 图标）",
		!!canvasProbe && canvasProbe.circles > 0 && canvasProbe.paths > 0
		&& canvasProbe.nodes > 0 && canvasProbe.icons === canvasProbe.nodes
		&& canvasProbe.carbon && canvasProbe.mapping.join(",") === expectedIcons.join(",")
		&& canvasProbe.drawn === canvasProbe.icons
		&& !!canvasProbe.fill && canvasProbe.fill === canvasProbe.ring
		&& sameTierOk,
		canvasProbe
			? `circles=${canvasProbe.circles} paths=${canvasProbe.paths} icons=${canvasProbe.icons}/${canvasProbe.nodes} drawn=${canvasProbe.drawn} fill=${canvasProbe.fill} ring=${canvasProbe.ring} mapping=${canvasProbe.mapping.join(",")} 名称优先=${sameTierIcons ? sameTierIcons.join(",") : "外部实例未校验"}`
			: "未找到 [data-testid='topology-canvas']"
	);

	// A6：自建实例没有 `NUXT_MININET_INSTANCES` → 拓扑照常渲染。（2026-11-09 起画布上不再有
	// 节点级「停止 / 重启」按钮：那两档改的是整台设备的运行态，与「看拓扑」不是一件事，
	// 用户裁决下线。链路动作仍在链路详情卡里，见后面对 `topology-link-action` 的断言。）
	// 「未配置」不挂页头告警条（2026-11-08 用户裁决）：那是部署形态而不是故障。
	const simProbe = await page.evaluate(() => {
		const alertText = Array.from(document.querySelectorAll("[data-slot='title']"))
			.map((el) => el.textContent?.trim() ?? "")
			.join("|");
		return {
			canvas: !!document.querySelector("[data-testid='topology-canvas']"),
			actions: Array.from(document.querySelectorAll("[data-testid='sim-action']")).length,
			degraded: !!document.querySelector("[data-testid='sim-degraded']"),
			alertText,
			text: document.body.textContent ?? ""
		};
	});
	log("A6 租户没有实验实例时拓扑照常渲染", simProbe.canvas, simProbe.canvas ? "canvas 存在" : "canvas 缺失");
	log(
		"A6 画布不再提供节点停止 / 重启按钮（节点级动作整体下线）",
		simProbe.actions === 0 && !simProbe.text.includes("停止节点") && !simProbe.text.includes("重启节点"),
		`sim-action=${simProbe.actions} 文案残留=${simProbe.text.includes("停止节点") || simProbe.text.includes("重启节点")}`
	);
	log(
		"仿真未配置时不再挂「未启用」告警条（原因留在按钮 tooltip 里）",
		!simProbe.degraded && !simProbe.alertText.includes("实验通道未启用"),
		`alert=${simProbe.degraded} titles=${simProbe.alertText}`
	);

	// A7：默认配置下写端点被拒。自建实例没有 `NUXT_MININET_INSTANCES`：能力探针回
	// `configured: false`（部署形态，不是错误），写路径在「租户没有实例」这一步就被
	// 503 `tenant_runtime_unavailable` 拦下（比 `mininet_not_configured` 更准确：租户作用域
	// 下只查注册表、不回退全局基址）—— 页面零写请求、BFF 也不触达上游。
	// `NMCPS-ADR-0027` R8 之前这里断言的是 `/api/sim` 的 405 / 503；退役后写通道只剩实验面。
	const channelProbe = await page.request.get(`${BASE_URL}/api/mininet/channel`).catch(() => null);
	const channelJson = channelProbe ? await channelProbe.json().catch(() => null) : null;
	const writesBeforeA7 = upstreamServer?.mininetLog.filter((entry) => entry.method !== "GET").length ?? 0;
	const writeResponse = await page.request.patch(`${BASE_URL}/api/mininet/links/h1/h2/state`, { data: { state: "down" } }).catch(() => null);
	const writeJson = writeResponse ? await writeResponse.json().catch(() => null) : null;
	const writesAfterA7 = upstreamServer?.mininetLog.filter((entry) => entry.method !== "GET").length ?? 0;
	log(
		"A7 默认配置下通道未启用（configured:false），写端点被 503 拒绝且不触达上游",
		channelProbe?.status() === 200 && channelJson?.data?.configured === false
		&& writeResponse?.status() === 503 && writeJson?.message === "tenant_runtime_unavailable"
		&& writesAfterA7 === writesBeforeA7,
		`channel=${channelProbe?.status()}/${channelJson?.data?.configured} write=${writeResponse?.status()}/${writeJson?.message} 上游写=${writesAfterA7 - writesBeforeA7}`
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

		const monitorProbe = await page.evaluate(() => {
			const button = document.querySelector("[data-testid='topology-node-metrics']");
			return {
				chart: !!document.querySelector("[data-testid='trend-chart']"),
				error: !!document.querySelector("[data-testid='trend-error']"),
				ip: button?.getAttribute("data-mgmt-ip") ?? "",
				disabled: button?.hasAttribute("disabled") ?? true
			};
		});
		page.off("request", recordTrend);

		log(
			"A3 监控页不再自绘折线：选中节点零指标请求，改为带管理 IP 的深链按钮",
			clickedNode === "10.0.0.2" && !monitorProbe.chart && !monitorProbe.error
			&& trendRequests.length === 0 && monitorProbe.ip === "10.0.0.2" && !monitorProbe.disabled,
			`node=${clickedNode} chart=${monitorProbe.chart} 指标请求=${trendRequests.length} ip=${monitorProbe.ip}`
		);

		// 折线没有消失，只是搬家了：深链按钮是这条能力的唯一入口，点了必须真的到指标页、
		// 真的按**管理 IP**取数、真的画出折线（否则「搬走」就成了「砍掉」）。
		const deepRequests = [];
		const recordDeep = (request) => {
			if (request.url().includes("/api/metric/"))
				deepRequests.push(request.url());
		};
		page.on("request", recordDeep);
		await page.click("[data-testid='topology-node-metrics']");
		await page.waitForURL("**/topology/device-metrics**", { timeout: 15_000 }).catch(() => null);
		await page.waitForTimeout(1_500);
		await openDetailTab("图表");
		const deepProbe = await page.evaluate(() => ({
			path: `${location.pathname}${location.search}`,
			chart: !!document.querySelector("[data-testid='trend-chart']"),
			lines: document.querySelectorAll("[data-testid='trend-line']").length,
			text: document.body.textContent ?? ""
		}));
		page.off("request", recordDeep);
		// 编码断言的不是「随便抓一个名字」：假上游把 `up` / `scrape_*` 放在清单最前面，
		// 出现 `if_in_octets` 说明真的跳过了采集器自监控命名空间（CONTRACT-002 §三）。
		const deepDatapoint = deepRequests.find((url) => url.includes("/api/metric/datapoint")) ?? "";
		log(
			"A3 深链落到设备指标页：按管理 IP 取数并画出折线（跳过 collector 命名空间）",
			deepProbe.path.startsWith("/topology/device-metrics") && deepProbe.chart && deepProbe.lines >= 1
			&& deepDatapoint.includes("mgmt_ip=10.0.0.2") && deepDatapoint.includes("metric_code=if_in_octets"),
			`${deepProbe.path || "未跳转"} chart=${deepProbe.chart} lines=${deepProbe.lines}`
			+ ` ${deepDatapoint ? deepDatapoint.split("?")[1]?.slice(0, 120) ?? "" : "未见 /api/metric/datapoint 请求"}`
		);

		// 假上游的序列里夹了空串与 `NaN` 两个非法点：它们必须被丢弃并计数，绝不能被当成 0 画进来
		// （CONTRACT-002 §6.3 ②：丢弃 + 计数，不补 0、不插值）。
		log(
			"A3 非法采样点被丢弃并计数（不补 0）",
			deepProbe.text.includes("已忽略 2 个非法采样点"),
			deepProbe.text.includes("已忽略 2 个非法采样点") ? "计数 2" : `未见丢弃提示：${deepProbe.text.slice(0, 100)}`
		);

		// 折线搬到指标页之后，本节剩下的断言还在监控页上：先回去，别让后面的节点点击落到指标页的台账上
		await page.goto(`${BASE_URL}/topology/monitor`, { waitUntil: "networkidle" });
		await page.waitForTimeout(800);

		// A21：节点详情的事实层（复刻 1.0 的 CPU / 内存进度条 + 接口·邻居·流量 KPI + 邻居列表）。
		// 假上游刻意给了四种节点（全给 / 只给方向流量 / 1.0 的 `-1` 哨兵 + 真实 0 / 一个都不给），
		// 这里逐个把「已知照实、未知写『—』」钉住 —— 失败时把三个节点的读数原样打出来，别让人猜。
		const factsOf = async (nodeId) => {
			await page.evaluate((id) => {
				const node = Array.from(document.querySelectorAll("[data-testid='topology-node']"))
					.find((el) => el.getAttribute("data-node-id") === id);
				node?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			}, nodeId);
			await page.waitForTimeout(500);
			return page.evaluate(() => {
				const read = (key) => document.querySelector(`[data-testid='topology-fact-${key}']`)?.textContent?.trim() ?? "";
				return {
					cpu: read("cpu"),
					memory: read("memory"),
					interfaces: read("interfaces"),
					neighbors: read("neighbors"),
					traffic: read("traffic"),
					neighborRows: document.querySelectorAll("[data-testid='topology-neighbor']").length,
					bars: document.querySelectorAll("[data-testid='topology-meter']").length
				};
			});
		};
		const summarizeFacts = (probe) => `cpu=${probe.cpu} mem=${probe.memory} if=${probe.interfaces} nb=${probe.neighbors} traffic=${probe.traffic} rows=${probe.neighborRows}`;

		const fullFacts = await factsOf("10.0.0.1");
		log(
			"A21 节点详情展示事实层（CPU / 内存 / 接口 / 邻居 / 流量 + 邻居列表）",
			fullFacts.cpu === "21.5%" && fullFacts.memory === "48%" && fullFacts.interfaces === "24"
			&& fullFacts.neighbors === "2" && fullFacts.traffic.startsWith("12.5") && fullFacts.neighborRows === 2,
			summarizeFacts(fullFacts)
		);

		// 未知（上游一个字段都不给）不许落成 `0%` / `0 Mbps`：两边都要是「—」，进度条一条都不画。
		const unknownFacts = await factsOf("10.0.0.4");
		log(
			"A22 上游没给的事实写「—」而不是 0（不画空进度条）",
			unknownFacts.cpu === "—" && unknownFacts.memory === "—" && unknownFacts.interfaces === "—"
			&& unknownFacts.traffic === "—" && unknownFacts.bars === 0,
			`${summarizeFacts(unknownFacts)} bars=${unknownFacts.bars}`
		);

		// 1.0 的 `-1` 哨兵 = 取不到（按「—」处理），而 `interfaces: 0` 是真实值（照写 0），
		// 旧 Kbps 字段要归一成 Mbps（1500 Kbps → 1.5 Mbps）。三种口径在同一条断言里分开钉。
		const sentinelFacts = await factsOf("10.0.0.3");
		log(
			"A23 1.0 的 -1 哨兵按未知处理，真实 0 与旧 Kbps 字段照实归一",
			sentinelFacts.cpu === "—" && sentinelFacts.memory === "—" && sentinelFacts.interfaces === "0"
			&& sentinelFacts.traffic.startsWith("1.5"),
			summarizeFacts(sentinelFacts)
		);

		// A24 / A25：2D 布局切换与径向扇旋转（§6.8，复刻 1.0 顶栏的布局下拉 + 旋转控件）。
		// 断言的是**几何真的换了**而不是「按钮点了没报错」：读每个节点的 `circle` 中心坐标，
		// 两档布局（径向扇 / 层级树）必须不同、切回来必须逐点一致；层级树再验「父压子女中点」
		// （`汇聚交换机` 落在其下级均值正上方）与「**末层（终端带）居中**」—— 2026-11-09 用户裁决
		// 把居中基准从根层换成末端层，这两条是塔型可读的全部意义。
		const readGeometry = () => page.evaluate(() => {
			const nodes = Array.from(document.querySelectorAll("[data-testid='topology-node']")).map((el) => {
				const circle = el.querySelector("[data-testid='topology-node-shape']");
				return {
					id: el.getAttribute("data-node-id") ?? "",
					x: Number(circle?.getAttribute("cx") ?? NaN),
					y: Number(circle?.getAttribute("cy") ?? NaN)
				};
			});
			const rows = new Map();
			for (const node of nodes) {
				const row = rows.get(node.y) ?? [];
				row.push(node.x);
				rows.set(node.y, row);
			}
			const rowMeans = [...rows.keys()]
				.sort((left, right) => left - right)
				.map((y) => Math.round(rows.get(y).reduce((sum, x) => sum + x, 0) / rows.get(y).length));
			// 画布逻辑尺寸随内容长大（`layoutBox()`：bbox 比基准视口大时取 bbox）⇒ 「居中」要读**当前**
			// `viewBox` 的一半，不能写死 500：20 台样本的末层 14 台铺到 1074px 宽，画布中心就是 537。
			const viewBox = (document.querySelector("[data-testid='topology-canvas']")?.getAttribute("viewBox") ?? "").split(/\s+/).map(Number);
			const canvas = { width: viewBox[2] || 1000, height: viewBox[3] || 660 };
			return {
				layout: document.querySelector("[data-testid='topology-layout-switcher']")?.getAttribute("data-layout") ?? "",
				rotate: !!document.querySelector("[data-testid='topology-rotate']"),
				badge: document.querySelector("[data-testid='topology-rotate'] .tabular-nums")?.textContent?.trim() ?? "",
				nodes,
				// rowMeans 按 y 升序（DOM 顺序 = 节点入参顺序，与层序无关；不排序会把「末层」读成随便一层）
				rowMeans,
				canvas,
				inside: nodes.every((node) => node.x >= 0 && node.x <= canvas.width && node.y >= 0 && node.y <= canvas.height)
			};
		});

		/** 两次读数是否真的换了坐标（任一节点任一分量变化即算） */
		const sameGeometry = (a, b) => a.nodes.length === b.nodes.length
			&& a.nodes.every((node) => {
				const other = b.nodes.find((item) => item.id === node.id);
				return other && other.x === node.x && other.y === node.y;
			});

		/** 通过下拉切到某个布局：点开按钮 → 点标签匹配的菜单项（标签是 i18n 文案，页面默认中文） */
		const switchLayout = async (label) => {
			await page.click("[data-testid='topology-layout-switcher']");
			await page.waitForTimeout(250);
			const items = page.locator("[role='menuitemcheckbox']");
			const count = await items.count();
			for (let index = 0; index < count; index++) {
				const text = (await items.nth(index).textContent() ?? "").trim();
				if (text === label) {
					await items.nth(index).click();
					await page.waitForTimeout(250);
					return true;
				}
			}
			return false;
		};

		const defaultGeometry = await readGeometry();
		const treeClicked = await switchLayout("层级树");
		const treeGeometry = await readGeometry();
		const backClicked = await switchLayout("径向扇");
		const backGeometry = await readGeometry();

		// 「父压子女中点」：默认样本里 10.0.0.4 的下级是 10.0.0.5 / 10.0.0.6，10.0.0.1 的下级是
		// 10.0.0.2 / 10.0.0.3 —— 两处父节点都必须落在子女 x 的中点（±1 容差，圆心是整数坐标）。
		const xOfGeometry = (geometry, id) => geometry.nodes.find((node) => node.id === id)?.x ?? NaN;
		const centredOver = (geometry, parent, children) => {
			const mean = children.reduce((sum, id) => sum + xOfGeometry(geometry, id), 0) / children.length;
			return Math.abs(xOfGeometry(geometry, parent) - mean) <= 1;
		};
		const treeParentsCentred = centredOver(treeGeometry, "10.0.0.4", ["10.0.0.5", "10.0.0.6"])
			&& centredOver(treeGeometry, "10.0.0.1", ["10.0.0.2", "10.0.0.3"]);
		const treeBottomRowMean = treeGeometry.rowMeans.at(-1) ?? NaN;
		const treeCentreX = treeGeometry.canvas.width / 2;

		log(
			"A24 两档布局可切换且真的换了坐标（层级树父压子女中点、末层居中、节点不越画布）",
			defaultGeometry.layout === "radial" && treeClicked && backClicked
			&& treeGeometry.layout === "tree" && backGeometry.layout === "radial"
			&& !sameGeometry(defaultGeometry, treeGeometry)
			&& sameGeometry(backGeometry, defaultGeometry)
			&& defaultGeometry.inside && treeGeometry.inside
			&& treeGeometry.rowMeans.length >= 3
			&& treeParentsCentred && Math.abs(treeBottomRowMean - treeCentreX) <= 1,
			`layout=${defaultGeometry.layout}→${treeGeometry.layout}→${backGeometry.layout}`
			+ ` rows=${treeGeometry.rowMeans.join(",")} bottom-row=${treeBottomRowMean}/${treeCentreX} parents-centred=${treeParentsCentred}`
			+ ` inside=${defaultGeometry.inside}/${treeGeometry.inside}`
		);

		// 旋转控件只在径向扇出现：层级树不读这个角度，摆一个置灰的滑块等于暗示「拖了会有区别」。
		// A25 同时钉住步进 +5°、复位回默认 25°、以及「复位后坐标回到未旋转那一版」。
		// 旋转「复位」小按钮已下线（2026-11-09）：复位旋转角是「恢复默认配置」的第一步，
		// 这里改点 `topology-reset-view`（此刻没有位移 / 缩放，它等价于只复位旋转角）。
		const radialGeometry = backGeometry;
		const rotateBefore = radialGeometry;
		await page.click("[data-testid='topology-rotate-ccw']");
		await page.waitForTimeout(250);
		const rotateAfter = await readGeometry();
		await page.click("[data-testid='topology-reset-view']");
		await page.waitForTimeout(250);
		const rotateReset = await readGeometry();
		await switchLayout("层级树");
		const afterTree = await readGeometry();
		await switchLayout("径向扇");

		log(
			"A25 径向扇旋转：仅 radial 出现控件、步进 +5°、复位回 25°",
			defaultGeometry.rotate && !treeGeometry.rotate && !afterTree.rotate
			&& rotateBefore.badge === "25°"
			&& rotateAfter.badge === "30°" && !sameGeometry(rotateBefore, rotateAfter)
			&& rotateReset.badge === "25°" && sameGeometry(rotateReset, rotateBefore),
			`radial.rotate=${defaultGeometry.rotate} tree.rotate=${treeGeometry.rotate}`
			+ ` badge=${rotateBefore.badge}→${rotateAfter.badge}→${rotateReset.badge}`
			+ ` moved=${!sameGeometry(rotateBefore, rotateAfter)} restored=${sameGeometry(rotateReset, rotateBefore)}`
		);

		// A26：节点拖拽位移保持 + 「恢复默认配置」三合一复位（§6.9，1.0 v0.36 用户规格）。
		// 拖的是**真指针**（pointerdown → 多次 pointermove → pointerup），断言四件事：
		//   ① 落点真的动了（且只有被拖的那台动）；② 30s 轮询 / 手动刷新的重渲染**不弹回**；
		//   ③ 「恢复默认配置」把位移 / 旋转角 / 视角三项一起归零；④ 切布局 = 换几何基准 ⇒ 位移层清空。
		const readViewState = () => page.evaluate(() => {
			const resetButton = document.querySelector("[data-testid='topology-reset-view']");
			return {
				offsets: resetButton?.getAttribute("data-offsets") ?? "",
				zoom: document.querySelector("[data-testid='topology-zoom']")?.textContent?.trim() ?? "",
				resetDisabled: resetButton?.hasAttribute("disabled") === true
			};
		});

		/** 按住节点圆心拖到 (+dx, +dy) 像素处松手（拖的是节点本体 `<circle>`，不是 `<g>` 外框、也不是告警角标） */
		const dragNode = async (id, dx, dy) => {
			const box = await page.locator(`[data-testid='topology-node'][data-node-id='${id}'] [data-testid='topology-node-shape']`).boundingBox();
			if (!box)
				return false;
			const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
			await page.mouse.move(from.x, from.y);
			await page.mouse.down();
			await page.mouse.move(from.x + dx, from.y + dy, { steps: 6 });
			await page.mouse.up();
			await page.waitForTimeout(250);
			return true;
		};

		await switchLayout("径向扇");
		const viewBaseline = await readGeometry();
		const viewBaselineState = await readViewState();
		const dragTargetId = viewBaseline.nodes[0]?.id ?? "";
		const dragged = await dragNode(dragTargetId, 90, 50);
		const afterDrag = await readGeometry();
		const afterDragState = await readViewState();
		const movedIds = afterDrag.nodes
			.filter((node) => {
				const base = viewBaseline.nodes.find((item) => item.id === node.id);
				return !base || base.x !== node.x || base.y !== node.y;
			})
			.map((node) => node.id);

		// 手动刷新 = 一次完整重渲染（轮询走同一条 `refresh()`）：位移必须留在原处，不能弹回几何位。
		await page.click("[data-testid='topology-refresh']");
		await page.waitForTimeout(700);
		const afterRefresh = await readGeometry();

		// 叠加旋转角与缩放，然后一键复位：三项都要回到默认，且坐标逐点等于拖拽前的那一版。
		await page.click("[data-testid='topology-zoom-in']");
		await page.waitForTimeout(150);
		const zoomedState = await readViewState();
		await page.click("[data-testid='topology-rotate-ccw']");
		await page.waitForTimeout(250);
		const rotatedView = await readGeometry();
		await page.click("[data-testid='topology-reset-view']");
		await page.waitForTimeout(300);
		const afterReset = await readGeometry();
		const afterResetState = await readViewState();

		// 切布局 = 换一套几何基准：位移层跟着清空（否则节点既不在新几何位、也不在用户放下的位置）。
		const draggedAgain = await dragNode(dragTargetId, 60, 30);
		const beforeSwitchState = await readViewState();
		await switchLayout("层级树");
		const afterSwitchState = await readViewState();
		await switchLayout("径向扇");

		log(
			"A26 节点拖拽位移保持 + 恢复默认配置（三合一复位，切布局清位移）",
			dragged && draggedAgain
			&& movedIds.length === 1 && movedIds[0] === dragTargetId
			&& afterDragState.offsets === "1" && !afterDragState.resetDisabled
			&& viewBaselineState.offsets === "0" && viewBaselineState.resetDisabled
			&& sameGeometry(afterRefresh, afterDrag)
			&& zoomedState.zoom === "125%" && !zoomedState.resetDisabled
			&& rotatedView.badge === "30°"
			&& sameGeometry(afterReset, viewBaseline) && afterReset.badge === "25°"
			&& afterResetState.zoom === "100%" && afterResetState.offsets === "0" && afterResetState.resetDisabled
			&& beforeSwitchState.offsets === "1"
			&& afterSwitchState.offsets === "0" && afterSwitchState.resetDisabled,
			`drag=${dragged}/${draggedAgain} moved=${movedIds.length}`
			+ ` offsets=${viewBaselineState.offsets}→${afterDragState.offsets}→${afterResetState.offsets}→${afterSwitchState.offsets}`
			+ ` keep=${sameGeometry(afterRefresh, afterDrag)} zoom=${afterResetState.zoom}`
			+ ` rotation=${rotatedView.badge}→${afterReset.badge} back=${sameGeometry(afterReset, viewBaseline)}`
		);

		// A27：**默认就是两层形状**（假上游 `control.topologyNested` 初值 true，§6.10）。
		// 2026-11-07 现场「页面没看到变化」的真因就在这里：`data` 没被拍平 ⇒ `tier` 全落空 ⇒
		// 布局层拿不到层序、名称退化成管理 IP、状态全 `unknown`。
		// 断言钉四件事：层级树仍把 6 台按四层摆开（4 个不同的 y 行）、名称取自 `data.deviceName`、
		// 详情事实取自 `data.cpu` / `data.interfaces`、以及**两种形状渲染结果逐点一致**
		// （切回扁平本体再读一次几何，必须与两层形状完全相同）。
		// 「四层」只能在层级树下量：默认布局是径向扇，六个方向各不同 ⇒ `y` 各不同（`rows = 6` 属正常，
		// 0.17.15 收掉「分层」后这里改切一层级树再量，量完切回径向扇，不改变后续断言的默认布局）。
		await fetch(`http://${HOST}:${upstreamPort}/__control/topology-nested`);
		await page.reload({ waitUntil: "networkidle" });
		await page.waitForTimeout(800);
		const nestedGeometry = await readGeometry();
		const nestedLabels = await page.evaluate(() => Array.from(document.querySelectorAll("[data-testid='topology-node']"))
			.map((el) => (el.querySelector("text")?.textContent ?? "").trim())
			.sort());
		const nestedFacts = await factsOf("10.0.0.1");
		await switchLayout("层级树");
		const nestedTreeGeometry = await readGeometry();
		await switchLayout("径向扇");

		await fetch(`http://${HOST}:${upstreamPort}/__control/topology-flat`);
		await page.reload({ waitUntil: "networkidle" });
		await page.waitForTimeout(800);
		const flatGeometry = await readGeometry();
		// 复原默认形状：后面的 A4 / A5 走同一份假上游，默认应当仍是现网的两层形状。
		await fetch(`http://${HOST}:${upstreamPort}/__control/topology-nested`);

		const nestedRows = [...new Set(nestedTreeGeometry.nodes.map((node) => node.y))].sort((a, b) => a - b);
		const shapeSame = sameGeometry(flatGeometry, nestedGeometry);
		const labelOk = ["核心路由器-1", "汇聚交换机-1", "接入交换机-1", "无线AP-1", "单链路终端-1", "单链路终端-2"]
			.every((label) => nestedLabels.includes(label));
		log(
			"A27 两层形状（data 嵌套）拍平后：层级树仍按 tier 摆成四层、名称与事实取自 data、与扁平形状逐点一致",
			nestedGeometry.layout === "radial" && nestedGeometry.nodes.length === 6
			&& nestedTreeGeometry.layout === "tree" && nestedTreeGeometry.nodes.length === 6
			&& nestedRows.length === 4 && labelOk
			&& nestedFacts.cpu === "21.5%" && nestedFacts.interfaces === "24"
			&& shapeSame,
			`layout=${nestedGeometry.layout}/${nestedTreeGeometry.layout} nodes=${nestedGeometry.nodes.length} rows=${nestedRows.length}`
			+ ` labels=${nestedLabels.join("|")} cpu=${nestedFacts.cpu} if=${nestedFacts.interfaces} flatSame=${shapeSame}`
		);

		// A41：页头读数搬到工具栏右区（1.0 顶栏版式）。读数本身的口径不变（缺数据写「—」不写 0），
		// 变的是**位置**：原先 4 张 `SparkStat` 卡片独占内容区第一行（100px 高），把画布整个往下推。
		// 断言钉三件事：① 四个徽标都在 `#app-toolbar-right` 内（0.17.15 起「仿真中」那档已删：仿真没配置
		// 是部署形态而不是读数，链路动作按钮的 tooltip 已经说明原因）；② 内容区零 `spark-stat` 卡片、
		// 也没有 `topology-stat-simulated` 这枚多余的徽标；③ 徽标文案 = 「标签 + 读数」（读数取自同一份数据）。
		const statsProbe = await page.evaluate(() => {
			const read = (key) => document.querySelector(`[data-testid='topology-stat-${key}']`);
			const textOf = (key) => read(key)?.textContent?.replace(/\s+/g, " ").trim() ?? "";
			return {
				inToolbar: !!document.querySelector("#app-toolbar-right [data-testid='topology-stats']"),
				badges: document.querySelectorAll("#app-toolbar-right [data-testid^='topology-stat-']").length,
				cards: document.querySelectorAll("[data-testid='spark-stat']").length,
				simulated: !!read("simulated"),
				nodes: textOf("nodes"),
				links: textOf("links"),
				combos: textOf("combos"),
				alarms: textOf("alarms")
			};
		});
		log(
			"A41 页头读数改为工具栏右区徽标（节点 / 链路 / 组合 / 告警），内容区不再有卡片行",
			statsProbe.inToolbar && statsProbe.badges === 4 && statsProbe.cards === 0 && !statsProbe.simulated
			&& statsProbe.nodes.includes("6") && statsProbe.links.includes("6") && statsProbe.combos.includes("3")
			&& statsProbe.alarms.includes("5"),
			`toolbar=${statsProbe.inToolbar} badges=${statsProbe.badges} cards=${statsProbe.cards} 仿真徽标=${statsProbe.simulated}`
			+ ` nodes=${statsProbe.nodes} links=${statsProbe.links} combos=${statsProbe.combos}`
			+ ` alarms=${statsProbe.alarms}`
		);

		// A42：层级树 = **塔型**（1.0 的 `dagre` 等价实现，§6.8）。收掉「分层」那一档之后，塔型的
		// 全部语义都落在层级树上：层内次序按父层重心排（相邻层交叉 0）、父节点压在子女群中线上、
		// 同层间距 ≥ 80（1.0 `nodesep`，不是「铺满整幅画布宽」）、半径随层递减、外圈按层级取色。
		// （默认样本：1 → 2,3；2,3 → 4；4 → 5,6 ⇒ 2 / 3 共享同一个下级 4，两者对称夹在中线两侧。）
		await switchLayout("层级树");
		const towerProbe = await page.evaluate(() => {
			const centers = new Map();
			const roles = {};
			for (const node of document.querySelectorAll("[data-testid='topology-node']")) {
				const id = node.getAttribute("data-node-id") ?? "";
				const shape = node.querySelector("[data-testid='topology-node-shape']");
				const dot = node.querySelector("[data-testid='topology-node-dot']");
				centers.set(id, {
					x: Number(shape?.getAttribute("cx")),
					y: Number(shape?.getAttribute("cy")),
					r: Number(shape?.getAttribute("r"))
				});
				roles[id] = {
					role: shape?.getAttribute("data-node-role") ?? "",
					dotRadius: Number(dot?.getAttribute("r"))
				};
			}
			const links = Array.from(document.querySelectorAll("[data-testid='topology-link']"))
				.map((el) => (el.getAttribute("data-link-key") ?? "").split("|").slice(0, 2));
			let crossings = 0;
			for (let a = 0; a < links.length; a++) {
				for (let b = a + 1; b < links.length; b++) {
					const [a0, a1] = links[a];
					const [b0, b1] = links[b];
					const aUp = (centers.get(a0)?.y ?? 0) <= (centers.get(a1)?.y ?? 0) ? a0 : a1;
					const aLow = aUp === a0 ? a1 : a0;
					const bUp = (centers.get(b0)?.y ?? 0) <= (centers.get(b1)?.y ?? 0) ? b0 : b1;
					const bLow = bUp === b0 ? b1 : b0;
					if (centers.get(aUp)?.y !== centers.get(bUp)?.y)
						continue;
					const deltaUp = (centers.get(aUp)?.x ?? 0) - (centers.get(bUp)?.x ?? 0);
					const deltaLow = (centers.get(aLow)?.x ?? 0) - (centers.get(bLow)?.x ?? 0);
					if (deltaUp * deltaLow < 0)
						crossings++;
				}
			}
			const byY = new Map();
			for (const [, point] of centers) {
				const row = byY.get(point.y) ?? [];
				row.push(point.x);
				byY.set(point.y, row);
			}
			const rowGaps = [...byY.values()].map((xs) => {
				const sorted = [...xs].sort((left, right) => left - right);
				return sorted.length > 1
					? Math.min(...sorted.slice(1).map((value, index) => value - sorted[index]))
					: 999;
			});
			const center = (id) => centers.get(id)?.x ?? Number.NaN;
			return {
				crossings,
				rowGaps,
				coreMid: center("10.0.0.1"),
				distMid: (center("10.0.0.2") + center("10.0.0.3")) / 2,
				accessMid: center("10.0.0.4"),
				terminalMid: (center("10.0.0.5") + center("10.0.0.6")) / 2,
				radius: {
					core: centers.get("10.0.0.1")?.r ?? 0,
					distro: centers.get("10.0.0.2")?.r ?? 0,
					access: centers.get("10.0.0.4")?.r ?? 0,
					terminal: centers.get("10.0.0.5")?.r ?? 0
				},
				roles
			};
		});
		const towerRoles = ["10.0.0.1", "10.0.0.2", "10.0.0.4", "10.0.0.5"]
			.map((id) => towerProbe.roles[id]?.role)
			.join(",");
		const towerAligned = [towerProbe.distMid, towerProbe.accessMid, towerProbe.terminalMid]
			.every((value) => Math.abs(value - towerProbe.coreMid) <= 1);
		const towerSpacingOk = towerProbe.rowGaps.every((gap) => gap >= 79.5);
		const towerRadiusOk = towerProbe.radius.core > towerProbe.radius.distro
			&& towerProbe.radius.distro > towerProbe.radius.access
			&& towerProbe.radius.access > towerProbe.radius.terminal;
		const towerDotOk = ["10.0.0.1", "10.0.0.5", "10.0.0.6"].every((id) => (towerProbe.roles[id]?.dotRadius ?? 0) > 0);
		log(
			"A42 层级树 = 塔型：父层压在子女群中线、层内按重心排序（交叉 0）、间距 ≥ 80、外圈按层级取色",
			towerProbe.crossings === 0 && towerAligned && towerSpacingOk && towerRadiusOk && towerDotOk
			&& towerRoles === "core,distro,access,terminal",
			`crossings=${towerProbe.crossings} aligned=${towerAligned} gaps=${towerProbe.rowGaps.join("/")}`
			+ ` radius=${towerProbe.radius.core}/${towerProbe.radius.distro}/${towerProbe.radius.access}/${towerProbe.radius.terminal}`
			+ ` roles=${towerRoles} centers=${towerProbe.coreMid}/${towerProbe.distMid}/${towerProbe.accessMid}/${towerProbe.terminalMid}`
		);

		// A43：层序归约（§6.8 的两条规则；1.0 完全没有这个能力）。假上游换成「网状顶层 + 无下级接入
		// + 满行终端」的样本（`__control/topology-mesh`），钉四件事：
		//   ① 顶层三台**两两互联**（关系等价，边表达不了上下）⇒ 只有「网控中心」命中名称判据
		//      ⇒ 被选举为根、独占首行（`data-node-role="root"`）；
		//   ② 被留在第二行的核心仍是 `core`：角色按 **tier** 取，不按行号 —— 换了行不等于换了设备类别；
		//   ③ 没有下一级的「接入交换机-2」下移到**末行**（与 13 台终端同排），并因此读作**终端层**
		//      （`terminal`，2026-11-08 要求 3：叶子没有下一层，画成蓝色接入等于说「它下面还有一层」）；
		//   ④ 层序连续：5 行（`y` 逐行等距递增 110 = `TIER_TREE_TIER_GAP`），
		//      末行 14 台 = 满行样本（供 A44 用）。行的判定一律用**行序号**而不是绝对 y：
		//      绝对 y 是层级树几何库的内部常量，写死它等于把「换个间距」当成回归。
		await fetch(`http://${HOST}:${upstreamPort}/__control/topology-mesh`);
		await page.reload({ waitUntil: "networkidle" });
		await page.waitForTimeout(800);
		await switchLayout("层级树");
		const rankProbe = await page.evaluate(() => {
			const nodes = Array.from(document.querySelectorAll("[data-testid='topology-node']")).map((node) => {
				const shape = node.querySelector("[data-testid='topology-node-shape']");
				return {
					id: node.getAttribute("data-node-id") ?? "",
					label: (node.querySelector("text")?.textContent ?? "").trim(),
					x: Number(shape?.getAttribute("cx")),
					y: Number(shape?.getAttribute("cy")),
					role: shape?.getAttribute("data-node-role") ?? "",
					tier: shape?.getAttribute("data-node-tier") ?? ""
				};
			});
			const byId = new Map(nodes.map((node) => [node.id, node]));
			const rows = [...new Set(nodes.map((node) => node.y))].sort((left, right) => left - right);
			const bottom = rows.at(-1) ?? 0;
			const bottomRow = nodes.filter((node) => node.y === bottom);
			// 画布中心读**当前** `viewBox`（20 台样本的末层铺到 1074px，中心是 537 而不是 500）
			const viewBox = (document.querySelector("[data-testid='topology-canvas']")?.getAttribute("viewBox") ?? "").split(/\s+/).map(Number);
			const centreX = (viewBox[2] || 1000) / 2;
			const rowOf = (id) => rows.indexOf(byId.get(id)?.y ?? -1);
			const roots = nodes.filter((node) => node.role === "root");
			return {
				count: nodes.length,
				rows: rows.map((y) => Math.round(y)),
				rowGaps: rows.slice(1).map((y, index) => Math.round(y - rows[index])),
				rootCount: roots.length,
				rootLabel: roots[0]?.label ?? "",
				rootRow: rows.indexOf(roots[0]?.y ?? -1),
				rootY: roots[0]?.y ?? -1,
				// 根的层号必须是 0（2026-11-09 用户裁决：根比边界层还高一档，不再与核心同为 1）
				rootTier: roots[0]?.tier ?? "",
				coreRow: rowOf("10.0.1.2"),
				coreRole: byId.get("10.0.1.2")?.role ?? "",
				coreTier: byId.get("10.0.1.2")?.tier ?? "",
				accessParentRow: rowOf("10.0.1.6"),
				demotedRow: rowOf("10.0.1.7"),
				demotedRole: byId.get("10.0.1.7")?.role ?? "",
				bottomCount: bottomRow.length,
				// 居中基准 = 末层（终端带）：它的 x 均值应落在**画布**中心（±1px）
				bottomMean: Math.round(bottomRow.reduce((sum, node) => sum + node.x, 0) / bottomRow.length),
				centreX
			};
		});
		log(
			"A43 层序归约：名称判据选举根节点（网控中心组网等价时上提到首行，tier=0）、叶子下移到末层并归位终端层、末层居中",
			rankProbe.count === 20 && rankProbe.rows.length === 5
			&& rankProbe.rowGaps.every((gap) => gap === 110)
			&& rankProbe.rootCount === 1 && rankProbe.rootLabel === "网控中心" && rankProbe.rootRow === 0
			&& rankProbe.rootTier === "0" && rankProbe.coreTier === "1"
			&& rankProbe.coreRow === 1 && rankProbe.coreRole === "core"
			&& rankProbe.accessParentRow === 3 && rankProbe.demotedRow === 4 && rankProbe.demotedRole === "terminal"
			&& rankProbe.bottomCount === 14 && Math.abs(rankProbe.bottomMean - rankProbe.centreX) <= 1,
			`nodes=${rankProbe.count} rows=${rankProbe.rows.join("/")} gaps=${rankProbe.rowGaps.join("/")}`
			+ ` root=${rankProbe.rootLabel}@row${rankProbe.rootRow}/tier${rankProbe.rootTier}`
			+ ` core=${rankProbe.coreRole}@row${rankProbe.coreRow}/tier${rankProbe.coreTier}`
			+ ` access-1=@row${rankProbe.accessParentRow} access-2=${rankProbe.demotedRole}@row${rankProbe.demotedRow}`
			+ ` bottom=${rankProbe.bottomCount}/${rankProbe.bottomMean}(centre=${rankProbe.centreX})`
		);

		// A44：标签避让 + 「显示名称」开关（§七）。末行 14 台设备的名称（「无线终端设备-01」10px 下 ≈ 77px）
		// 比同层间距（窄画布收窄到 `TIER_TREE_MIN_NODE_GAP = 74`）宽，硬摆会互相压字；断言钉四件事：
		//   ① 满行按**奇偶错行**（`data-label-shift` 同时出现 0 与 1）；
		//   ② 名称**一个都不截断**：文本里没有省略号 `…`，且逐字等于样本里的设备名
		//      （2026-11-09 用户裁决：画布上出现「汇聚交换机…」会让人认错设备）；
		//   ③ 字号收到 10px（`text-[10px]`，与 `LABEL_FONT_SIZE` 同值 —— 收字号才换来「不截断也不压字」）；
		//   ④ 关掉「显示名称」后画布上 **0 个**标签，再打开恢复原样（开关只影响渲染，不改布局 / 位移）。
		// 「哪一行是末行」由节点 `cy` 的最大值决定（层级树的绝对 y 是几何库内部常量，不写死）。
		const labelProbe = await page.evaluate(() => {
			const groups = Array.from(document.querySelectorAll("[data-testid='topology-node']"));
			const cyOf = (el) => Number(el.querySelector("[data-testid='topology-node-shape']")?.getAttribute("cy"));
			const bottomY = Math.max(...groups.map(cyOf));
			const bottom = groups
				.filter((el) => cyOf(el) === bottomY)
				.map((el) => el.querySelector("[data-testid='topology-node-label']"))
				.filter(Boolean);
			return {
				total: document.querySelectorAll("[data-testid='topology-node-label']").length,
				bottomCount: bottom.length,
				shifts: [...new Set(bottom.map((el) => el.getAttribute("data-label-shift") ?? ""))].sort(),
				// 层级树的标签方向恒为「正下方」（`0,1`）：方向由布局层给，一层只有一个自由度
				dirs: [...new Set(Array.from(document.querySelectorAll("[data-testid='topology-node-label']"))
					.map((el) => el.getAttribute("data-label-dir") ?? ""))].sort(),
				ellipsis: Array.from(document.querySelectorAll("[data-testid='topology-node-label']"))
					.filter((el) => (el.textContent ?? "").includes("…"))
					.length,
				fontSize: bottom[0] ? getComputedStyle(bottom[0]).fontSize : "",
				texts: bottom.map((el) => (el.textContent ?? "").trim())
			};
		});
		const labelNamesOk = ["接入交换机-2", "无线终端设备-01", "无线终端设备-13"]
			.every((name) => labelProbe.texts.includes(name));
		await page.click("[data-testid='topology-labels-toggle']");
		await page.waitForTimeout(300);
		const labelsOff = await page.evaluate(() => document.querySelectorAll("[data-testid='topology-node-label']").length);
		await page.click("[data-testid='topology-labels-toggle']");
		await page.waitForTimeout(300);
		const labelsOn = await page.evaluate(() => document.querySelectorAll("[data-testid='topology-node-label']").length);
		log(
			"A44 名称标签避让：满行按奇偶错行、不截断（无省略号、10px）、层级树方向恒为下方，关闭「显示名称」后 0 标签、再开恢复原样",
			labelProbe.total === 20 && labelProbe.bottomCount === 14
			&& labelProbe.shifts.join(",") === "0,1" && labelProbe.ellipsis === 0
			&& labelProbe.dirs.join("|") === "0,1"
			&& labelProbe.fontSize === "10px"
			&& labelNamesOk && labelsOff === 0 && labelsOn === labelProbe.total,
			`labels=${labelProbe.total} bottom=${labelProbe.bottomCount} shifts=${labelProbe.shifts.join("/")}`
			+ ` ellipsis=${labelProbe.ellipsis} font=${labelProbe.fontSize} dirs=${labelProbe.dirs.join("|")}`
			+ ` names=${labelNamesOk} off=${labelsOff} on=${labelsOn}`
		);
		// A45：层序归约对**两种布局**都生效（§6.8）。A43 / A44 只钉了层级树，若只有它读归约结果、
		// 径向扇仍按原始 `tier` 排，就会「换个布局看」变成「换个事实看」：根被摊回第一圈、
		// 无下级的接入又爬回中间环。这里在同一份 `topology-mesh` 样本上切到径向扇再切回来，钉三件事：
		//   ① 径向扇：圆心 = 被选举的根（根到自己的半径 0），环半径严格递增，末环同时装着
		//      下移的「接入交换机-2」与 13 台终端（同环 = 同一带），下移叶子读作 `terminal`；
		//   ② 层级树：5 条水平线，根独占首行、核心第二行、下移接入与终端同排（末行）。
		//   ③ 切回层级树后与 A43 读数一致（布局切换是幂等的，不会攒状态）。
		const readRankGeometry = () => page.evaluate(() => Array.from(document.querySelectorAll("[data-testid='topology-node']")).map((node) => {
			const shape = node.querySelector("[data-testid='topology-node-shape']");
			const label = node.querySelector("[data-testid='topology-node-label']");
			return {
				id: node.getAttribute("data-node-id") ?? "",
				label: (node.querySelector("text")?.textContent ?? "").trim(),
				x: Number(shape?.getAttribute("cx")),
				y: Number(shape?.getAttribute("cy")),
				role: shape?.getAttribute("data-node-role") ?? "",
				labelX: Number(label?.getAttribute("x")),
				labelY: Number(label?.getAttribute("y")),
				dir: label?.getAttribute("data-label-dir") ?? ""
			};
		}));
		const radialClicked45 = await switchLayout("径向扇");
		await page.waitForTimeout(300);
		const radialNodes = await readRankGeometry();
		const treeClicked45 = await switchLayout("层级树");
		await page.waitForTimeout(300);
		const treeNodes = await readRankGeometry();
		// 切回层级树 = 同一个幂等动作的第二次：坐标必须与 A43 的读数一致（不攒状态）
		const backNodes = treeNodes;

		/** 以某个节点为圆心看半径（径向扇的「第几环」就是它到根的圆心距） */
		const ringOf = (nodes, centerId, id) => {
			const center = nodes.find((node) => node.id === centerId);
			const target = nodes.find((node) => node.id === id);
			return center && target ? Math.round(Math.hypot(target.x - center.x, target.y - center.y)) : -1;
		};
		const radialRoot = radialNodes.filter((node) => node.role === "root");
		// 环半径 = 到根的圆心距；同环节点会有 1~2px 的圆弧取整差，按 6px 容差归并成「第几环」
		const ringRadiusOf = (id) => ringOf(radialNodes, radialRoot[0]?.id ?? "", id);
		const radialRadii = radialNodes.map((node) => ringRadiusOf(node.id)).sort((left, right) => left - right);
		const radialRings = [];
		for (const radius of radialRadii) {
			if (!radialRings.length || radius - radialRings.at(-1) > 6)
				radialRings.push(radius);
		}
		const ringIndexOf = (radius) => radialRings.findIndex((ring) => Math.abs(ring - radius) <= 6);
		const radialRadius = {
			core: ringIndexOf(ringRadiusOf("10.0.1.2")),
			distro: ringIndexOf(ringRadiusOf("10.0.1.4")),
			access: ringIndexOf(ringRadiusOf("10.0.1.6")),
			terminal: ringIndexOf(ringRadiusOf("10.0.1.11")),
			demoted: ringIndexOf(ringRadiusOf("10.0.1.7"))
		};
		const radialDemotedRole = radialNodes.find((node) => node.id === "10.0.1.7")?.role ?? "";
		// 径向扇的标签必须朝**背离圆心**一侧（2026-11-09 用户裁决「标签位置统一」）：
		// 每台的「标签方向」与「它到根的射线」同向（点积 > 0.3，留出扇形角度的余量），
		// 圆心那台没有方向可言（退回 `0,1`，与层级树同一个默认）。
		const radialCenter = radialRoot[0];
		const radialLabelOut = radialCenter
			? radialNodes.filter((node) => node.id !== radialCenter.id).map((node) => {
				const dx = node.x - radialCenter.x;
				const dy = node.y - radialCenter.y;
				const [dirX, dirY] = node.dir.split(",").map(Number);
				const length = Math.hypot(dx, dy) || 1;
				return {
					id: node.id,
					dot: (dx / length) * dirX + (dy / length) * dirY,
					// 标签真的落在那个方向上（而不只是属性对）
					offset: Math.hypot(node.labelX - node.x, node.labelY - node.y),
					away: (node.labelX - node.x) * dirX + (node.labelY - node.y) * dirY > 0
				};
			})
			: [];
		const radialLabelOk = radialLabelOut.length === 19
			&& radialLabelOut.every((item) => item.dot > 0.3 && item.away && item.offset > 0)
			&& radialCenter?.dir === "0,1";
		const radialOk = radialClicked45 && radialNodes.length === 20
			&& radialRoot.length === 1 && radialRoot[0]?.label === "网控中心"
			&& radialRings.length === 5 && radialRings[0] === 0
			&& radialRadius.core === 1 && radialRadius.distro === 2 && radialRadius.access === 3
			&& radialRadius.terminal === 4 && radialRadius.demoted === 4
			&& radialDemotedRole === "terminal";

		const treeRows = [...new Set(treeNodes.map((node) => node.y))].sort((left, right) => left - right);
		const treeYOf = (id) => treeNodes.find((node) => node.id === id)?.y ?? -1;
		const treeRoot = treeNodes.filter((node) => node.role === "root");
		const treeOk = treeClicked45 && treeNodes.length === 20
			&& treeRows.length === 5
			&& treeRoot.length === 1 && treeRoot[0]?.label === "网控中心" && treeRoot[0]?.y === treeRows[0]
			&& treeYOf("10.0.1.2") === treeRows[1]
			&& treeYOf("10.0.1.6") === treeRows[3]
			&& treeYOf("10.0.1.7") === treeRows[4] && treeYOf("10.0.1.11") === treeRows[4];
		const backSame = treeClicked45 && rankProbe.rows[0] === Math.min(...backNodes.map((node) => node.y))
			&& backNodes.filter((node) => node.role === "root").length === 1
			&& backNodes.length === 20;
		log(
			"A45 径向扇与层级树读同一份层序归约：圆心/首行 = 选举出的根，下移接入与终端同环/同排；径向标签朝背离圆心一侧落位",
			radialOk && treeOk && backSame && radialLabelOk,
			`radial=${radialClicked45} ringRadii=${radialRings.join("/")} ringOf=${radialRadius.core}/${radialRadius.distro}/${radialRadius.access}/${radialRadius.demoted}`
			+ ` demoted=${radialDemotedRole} tree=${treeClicked45} rows=${treeRows.map((y) => Math.round(y)).join(",")}`
			+ ` treeRoot=${treeRoot[0]?.label}@${treeRoot[0]?.y} treeBottom=${treeYOf("10.0.1.7")}/${treeYOf("10.0.1.11")} back=${backSame}`
			+ ` labelOut=${radialLabelOut.filter((item) => item.dot > 0.3).length}/${radialLabelOut.length}`
			+ `(minDot=${radialLabelOut.length ? Math.min(...radialLabelOut.map((item) => item.dot)).toFixed(2) : "n/a"})`
		);
		// A46：收起 / 展开下级（§6.15，G6 v5 `collapse-expand`「实际案例」的等价实现）。
		// 语义是「元素自己留着、子树与挂边摘掉」，四件事缺一条都不算过：
		//   ① 角标只长在**真有下级**的节点上：网状顶层两两互联不算下级（方向由 `tier` 定），
		//      末行 13 台终端与「接入交换机-2」都没有下级 ⇒ 20 台里恰 6 台可收起；
		//   ② 双击「接入交换机-1」→ 20 台变 7 台，它的 13 条挂边一起消失且画布上不留悬空边；
		//   ③ 角标写 `+13`、左上角出「已收起 13 台」+「全部展开」—— 读数与真遮住的台数一致；
		//   ④ 再双击复原 20 台且坐标**逐点相等**（收起是视图，不是改数据）；
		//   ⑤ 双击根「网控中心」收起整棵子树，只剩顶层 4 台（各分支不会互认下级）。
		const readCollapseState = () => page.evaluate(() => {
			const nodes = Array.from(document.querySelectorAll("[data-testid='topology-node']"));
			const ids = nodes.map((node) => node.getAttribute("data-node-id") ?? "");
			const idSet = new Set(ids);
			const positions = {};
			for (const node of nodes) {
				const shape = node.querySelector("[data-testid='topology-node-shape']");
				positions[node.getAttribute("data-node-id") ?? ""] = `${shape?.getAttribute("cx")},${shape?.getAttribute("cy")}`;
			}
			// 链路 key 有两种形状（现网线格式 `e-<n>-<source>-<target>`、扁平 `source|target|index`），
			// 但两端都是管理 IP ⇒「key 里出现的 IP 必须都在画布上」是判断悬空边的共同尺子。
			const linkKeys = Array.from(document.querySelectorAll("[data-testid='topology-link']"))
				.map((el) => el.getAttribute("data-link-key") ?? "");
			const dangling = linkKeys.filter((key) => (key.match(/\d+\.\d+\.\d+\.\d+/g) ?? []).some((ip) => !idSet.has(ip)));
			const badges = Array.from(document.querySelectorAll("[data-testid='topology-node-collapse']"));
			return {
				nodeCount: ids.length,
				ids,
				positions,
				linkCount: linkKeys.length,
				dangling,
				badgeIds: badges.map((el) => el.getAttribute("data-node-id") ?? "").sort(),
				badgeTexts: Object.fromEntries(badges.map((el) => [el.getAttribute("data-node-id") ?? "", (el.textContent ?? "").trim()])),
				collapsedIds: badges.filter((el) => el.getAttribute("data-collapsed") === "true").map((el) => el.getAttribute("data-node-id") ?? ""),
				hiddenBadge: document.querySelector("[data-testid='topology-node-collapsed-badge']")?.getAttribute("data-hidden-count") ?? "",
				expandAll: !!document.querySelector("[data-testid='topology-expand-all']")
			};
		});
		/** 双击节点 = G6 `collapse-expand` 的默认触发（角标是同一个动作的鼠标出口） */
		const toggleCollapse = (id) => page.evaluate((nodeId) => {
			const node = Array.from(document.querySelectorAll("[data-testid='topology-node']"))
				.find((el) => el.getAttribute("data-node-id") === nodeId);
			node?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
			return !!node;
		}, id);

		const collapseBefore = await readCollapseState();
		const clickedAccess = await toggleCollapse("10.0.1.6");
		await page.waitForTimeout(400);
		const collapsedAccess = await readCollapseState();
		const clickedAccessAgain = await toggleCollapse("10.0.1.6");
		await page.waitForTimeout(400);
		const restoredAccess = await readCollapseState();
		const clickedRootForCollapse = await toggleCollapse("10.0.1.1");
		await page.waitForTimeout(400);
		const collapsedRoot = await readCollapseState();
		const restoredSame = restoredAccess.nodeCount === collapseBefore.nodeCount
			&& collapseBefore.ids.every((id) => restoredAccess.positions[id] === collapseBefore.positions[id]);
		log(
			"A46 收起 / 展开下级：角标只长在有下级的节点上、双击收起 13 台与挂边、展开坐标逐点复原、收起根只剩顶层 4 台",
			collapseBefore.nodeCount === 20
			&& collapseBefore.badgeIds.join(",") === "10.0.1.1,10.0.1.2,10.0.1.3,10.0.1.4,10.0.1.5,10.0.1.6"
			&& collapseBefore.badgeTexts["10.0.1.6"] === "-"
			&& clickedAccess && collapsedAccess.collapsedIds.join(",") === "10.0.1.6"
			&& collapsedAccess.nodeCount === 7
			&& collapsedAccess.linkCount === collapseBefore.linkCount - 13
			&& collapsedAccess.dangling.length === 0
			&& collapsedAccess.badgeTexts["10.0.1.6"] === "+13"
			&& collapsedAccess.hiddenBadge === "13" && collapsedAccess.expandAll
			&& clickedAccessAgain && restoredSame
			&& clickedRootForCollapse && collapsedRoot.nodeCount === 4
			&& [...collapsedRoot.ids].sort().join(",") === "10.0.1.1,10.0.1.2,10.0.1.3,10.0.1.5",
			`badges=${collapseBefore.badgeIds.join("/")} before=${collapseBefore.nodeCount}台/${collapseBefore.linkCount}边`
			+ ` collapsed=${collapsedAccess.nodeCount}台/${collapsedAccess.linkCount}边 悬空=${collapsedAccess.dangling.length}`
			+ ` 角标=${collapsedAccess.badgeTexts["10.0.1.6"]} 已收起=${collapsedAccess.hiddenBadge} 全部展开=${collapsedAccess.expandAll}`
			+ ` restored=${restoredAccess.nodeCount}台 逐点相等=${restoredSame}`
			+ ` root=${collapsedRoot.nodeCount}台[${[...collapsedRoot.ids].sort().join("/")}]`
		);

		// A47：连线一律**低饱和中性灰** + 选中节点的关联强调（§6.15.2 要求 1 / 2）。四件事一起钉：
		//   ① 灰是**同一档灰** —— 所有 `topology-link` 的 `stroke` 解析结果只有一个值（`--topology-link`），
		//      它既不等于任何一档层色、也不等于主色，并且比 `--ui-text-muted` **同亮度、色度只剩 35%**
		//      （2026-11-08 用户裁决「降低链路颜色的饱和度」—— 连线是背景关系，不该和层色抢注意力）；
		//   ② 关联强调**只加外延、不加粗也不换色** —— 点 `10.0.1.4` 后恰 4 条
		//      `data-link-emphasized=true`（1→4 / 2→4 / 4→6 / 4→7），本体描边仍是那一档灰、宽度仍是
		//      带宽那一档 1.5px（**不是** 3px），多出来的是 4 圈同色低不透明度的外延环（1.5 + 6 = 7.5px / 30%）；
		//      选中节点本体加粗一档（2 → 3px）但**不换色**，另有 1 圈半径 +2、4px / 50% 的同色外环，
		//      恰 4 个 `data-node-emphasized=true`（一跳邻居）且外圈 2px / 22%、层色不变 ——
		//      画布上一共 5 圈外延环（选中 1 + 邻居 4），本体粗细全是 2px；
		//   ③ 「没有未选中态」（2026-11-09 用户裁决）：再点同一台**不会**取消选中 —— 强调条数与
		//      外延环数原样留着（既不是「点亮就不灭」，也不是「点第二下就熄」）；
		// 灰**不丢状态**的那一半在默认样本上（`offline` → 粗虚线、`wifi*` → 细密虚线），见 A47 的尾段。
		await page.click("[data-testid='topology-expand-all']");
		await page.waitForTimeout(400);
		/** 用一个探针元素把 CSS 变量解析成浏览器真会画出来的颜色（不在断言里猜 var 的字符串） */
		const resolveColors = () => page.evaluate(() => {
			const probe = (property, token) => {
				const el = document.createElementNS("http://www.w3.org/2000/svg", "path");
				el.setAttribute("style", `${property}: var(${token})`);
				document.body.append(el);
				const value = getComputedStyle(el)[property];
				el.remove();
				return value;
			};
			return {
				muted: probe("stroke", "--ui-text-muted"),
				primary: probe("stroke", "--ui-primary"),
				link: probe("stroke", "--topology-link")
			};
		});
		const greyColors = await resolveColors();
		/**
		 * 从 `oklch(L C H)` 的序列化里取**色度**：连线灰必须是 muted 的同一亮度、色度只剩 35%。
		 * 取不到数值就返回 `null`（浏览器不支持相对色语法时会退化成 muted 本身 ⇒ 断言红）。
		 */
		const chromaOf = (value) => {
			const match = /^oklch\(\s*([\d.]+)%?\s+([\d.]+)/.exec((value ?? "").trim());
			return match ? { lightness: Number(match[1]), chroma: Number(match[2]) } : null;
		};
		const mutedOklch = chromaOf(greyColors.muted);
		const linkOklch = chromaOf(greyColors.link);
		const linkDesaturatedOk = !!mutedOklch && !!linkOklch
			&& Math.abs(linkOklch.lightness - mutedOklch.lightness) < 0.02
			&& mutedOklch.chroma > 0
			&& Math.abs(linkOklch.chroma / mutedOklch.chroma - 0.35) < 0.06;
		const greyProbe = await page.evaluate(() => {
			const links = Array.from(document.querySelectorAll("[data-testid='topology-link']"));
			const roleStrokes = new Set();
			for (const shape of document.querySelectorAll("[data-testid='topology-node-shape']"))
				roleStrokes.add(getComputedStyle(shape).stroke);
			return {
				linkCount: links.length,
				linkStrokes: [...new Set(links.map((el) => getComputedStyle(el).stroke))],
				roleStrokes: [...roleStrokes]
			};
		});
		const greyOk = greyProbe.linkStrokes.length === 1
			&& greyProbe.linkStrokes[0] === greyColors.link
			&& !greyProbe.roleStrokes.includes(greyColors.link)
			&& greyColors.link !== greyColors.primary
			&& linkDesaturatedOk;

		/** 点一个节点（画布上的 `<g>`）；再点同一台**不会**取消选中（「没有未选中态」，2026-11-09 用户裁决） */
		const clickGraphNode = (id) => page.evaluate((nodeId) => {
			const node = Array.from(document.querySelectorAll("[data-testid='topology-node']"))
				.find((el) => el.getAttribute("data-node-id") === nodeId);
			node?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			return !!node;
		}, id);
		const readHighlight = (nodeId = "") => page.evaluate((id) => {
			const emphasized = Array.from(document.querySelectorAll("[data-testid='topology-link']"))
				.filter((el) => el.getAttribute("data-link-emphasized") === "true");
			const halos = Array.from(document.querySelectorAll("[data-testid='topology-link-halo']"));
			const neighbours = Array.from(document.querySelectorAll("[data-testid='topology-node']"))
				.filter((el) => el.getAttribute("data-node-emphasized") === "true");
			const shapes = neighbours.map((node) => node.querySelector("[data-testid='topology-node-shape']"));
			// 节点本体：粗细必须与未选中时一样（强调只加外延，不靠变粗说话），颜色必须还是它自己的层色
			const self = Array.from(document.querySelectorAll("[data-testid='topology-node']"))
				.find((el) => el.getAttribute("data-node-id") === id);
			const selfShape = self?.querySelector("[data-testid='topology-node-shape']");
			const selfHalo = self?.querySelector("[data-testid='topology-node-halo']");
			return {
				linkCount: emphasized.length,
				linkStrokes: [...new Set(emphasized.map((el) => getComputedStyle(el).stroke))],
				linkWidths: [...new Set(emphasized.map((el) => getComputedStyle(el).strokeWidth))],
				linkHaloCount: halos.length,
				linkHaloLevels: [...new Set(halos.map((el) => el.getAttribute("data-link-halo-emphasis") ?? ""))].sort(),
				linkHaloWidths: [...new Set(halos.map((el) => getComputedStyle(el).strokeWidth))],
				linkHaloOpacities: [...new Set(halos.map((el) => getComputedStyle(el).strokeOpacity))],
				linkHaloStrokes: [...new Set(halos.map((el) => getComputedStyle(el).stroke))],
				// 邻居连线的外延环染成**选中设备**的层色（`data-link-halo-tint` = 角色 id）
				linkHaloTints: [...new Set(halos.map((el) => el.getAttribute("data-link-halo-tint") ?? ""))],
				selfRole: selfShape?.getAttribute("data-node-role") ?? "",
				neighbourIds: neighbours.map((el) => el.getAttribute("data-node-id") ?? "").sort(),
				neighbourWidths: [...new Set(shapes.map((shape) => getComputedStyle(shape).strokeWidth))],
				neighbourStrokes: [...new Set(shapes.map((shape) => getComputedStyle(shape).stroke))],
				neighbourHaloOpacities: [...new Set(neighbours.map((node) => {
					const halo = node.querySelector("[data-testid='topology-node-halo']");
					return halo ? getComputedStyle(halo).strokeOpacity : "none";
				}))],
				selfWidth: selfShape ? getComputedStyle(selfShape).strokeWidth : "",
				selfStroke: selfShape ? getComputedStyle(selfShape).stroke : "",
				haloCount: document.querySelectorAll("[data-testid='topology-node-halo']").length,
				haloStroke: selfHalo ? getComputedStyle(selfHalo).stroke : "",
				haloWidth: selfHalo ? getComputedStyle(selfHalo).strokeWidth : "",
				haloOpacity: selfHalo ? getComputedStyle(selfHalo).strokeOpacity : "",
				haloLevel: selfHalo ? selfHalo.getAttribute("data-halo-emphasis") ?? "" : ""
			};
		}, nodeId);
		const highlightClicked = await clickGraphNode("10.0.1.4");
		await page.waitForTimeout(500);
		const highlighted = await readHighlight("10.0.1.4");
		/**
		 * 「没有未选中态」（2026-11-09 用户裁决）：再点同一台**不会**取消选中、右栏不会掉回空态。
		 * 旧断言在这里读的是「取消后全图无强调」，那套语义已被砍掉（详情栏恒有一台设备）。
		 */
		const reclickSame = await clickGraphNode("10.0.1.4");
		await page.waitForTimeout(400);
		const stillSelected = await readHighlight("10.0.1.4");
		/** 层色不变：邻居外圈的描边必须还是那几档层色之一（换邻居不换设备类别） */
		const neighbourTierOk = highlighted.neighbourStrokes.every((stroke) => greyProbe.roleStrokes.includes(stroke));
		/**
		 * 选中态：本体**加粗一档（2 → 3）但绝不换色**（2026-11-09 用户裁决「加粗节点环」），
		 * 同色外延环紧跟圆边（+2 / 4px / 50%）。取消选中后本体回到 2px（见 A47 尾段）。
		 */
		const selfTierOk = greyProbe.roleStrokes.includes(highlighted.selfStroke)
			&& highlighted.selfStroke !== greyColors.primary
			&& highlighted.haloStroke === highlighted.selfStroke
			&& highlighted.selfWidth === "3px"
			&& highlighted.haloWidth === "4px" && highlighted.haloOpacity === "0.5"
			&& highlighted.haloLevel === "selected";
		/**
		 * 关联链路的强调也必须只落在外延环上：本体 1.5px 不动，外延 1.5 + 6 = 7.5px / 30%；
		 * 颜色取**选中设备**的层色（`data-link-halo-tint` = 它自己的角色 id），不是灰 —— 一圈线只回答
		 * 「它连着谁」，用邻居的颜色会把「谁被点中」说反。30% 是 2026-11-09 调亮后的值：
		 * 16% 压在画布上几乎看不见层色，等于没染色。
		 */
		const linkEmphasisOk = highlighted.linkWidths.join(",") === "1.5px"
			&& highlighted.linkHaloCount === 4
			&& highlighted.linkHaloLevels.join(",") === "incident"
			&& highlighted.linkHaloWidths.join(",") === "7.5px"
			&& highlighted.linkHaloOpacities.join(",") === "0.3"
			&& highlighted.selfRole !== ""
			&& highlighted.linkHaloTints.length === 1 && highlighted.linkHaloTints[0] === highlighted.selfRole
			&& highlighted.linkHaloStrokes.length === 1
			&& highlighted.linkHaloStrokes[0] === highlighted.selfStroke
			&& highlighted.linkHaloStrokes[0] !== greyColors.link;

		// A48 ①②：控件收敛到画布右上一条排、图例落在右下角（§6.15 要求 4 / 5）。位置只能靠几何断言 ——
		// 类名写着 `top-2 right-2` 并不等于「就在右上角」（父容器一换就不成立了），所以量
		// `getBoundingClientRect()` 与画布边界之差（实际是 8px，断言给 12px 容差）。
		// 图例这一侧除位置外还要钉三件事：只有一份（详情栏不再有卡片版）、只列实际出现的角色、
		// 色块与画布外圈**同源**（HTML 认 `border-*`、SVG 认 `stroke-*`，取自 `topologyRoleStyle.ts`
		// 的同一张 ROLE_TONE 表），选举出的根文案是「边界层」而角色 id 仍是 `root`。
		const readCanvasChrome = () => page.evaluate(() => {
			const box = (el) => {
				const rect = el.getBoundingClientRect();
				return { right: rect.right, top: rect.top, bottom: rect.bottom, cy: rect.top + rect.height / 2 };
			};
			// 色块令牌：图例写 `border-(--topology-tier-core)`（HTML）、画布圆写 `stroke-(--topology-tier-core)`
			// （SVG），同名即「同源」。取令牌时按**属性前缀**过滤 —— 节点圆上还挂着 `fill-(--ui-bg-elevated)`，
			// 只认第一个 `(--…` 会一律取到填充色。
			const tokenOf = (el, prefix) => {
				const item = (el?.getAttribute("class") ?? "").split(" ").find((value) => value.startsWith(`${prefix}-(`));
				const start = item ? item.indexOf("(") : -1;
				const end = item ? item.indexOf(")") : -1;
				return start >= 0 && end > start ? item.slice(start + 1, end) : "";
			};
			const canvas = document.querySelector("[data-testid='topology-canvas']");
			const controls = document.querySelector("[data-testid='topology-controls']");
			const rotate = document.querySelector("[data-testid='topology-rotate']");
			const switcher = document.querySelector("[data-testid='topology-layout-switcher']");
			const legend = document.querySelector("[data-testid='topology-legend']");
			const roleList = document.querySelector("[data-testid='topology-legend-roles']");
			const canvasTokens = {};
			for (const shape of document.querySelectorAll("[data-testid='topology-node-shape']"))
				canvasTokens[shape.getAttribute("data-node-role") ?? ""] = tokenOf(shape, "stroke");
			// 图标的「渲染出来了没有」只能看图标节点里有没有东西：图标名写错时按钮仍在、也仍有一个
			// 空图标容器（2026-11-09 之前 `carbon:rotate-ccw` / `-cw` 就是这么一对空按钮）。
			// 图标有两种渲染形态（`@nuxt/icon` 的 svg 模式给 `<svg>` 内容、CSS 模式给 `i-carbon-*` 类），
			// 两种都收进来：断言只关心「非空且彼此不同」，不把实现形态写死。
			const glyphOf = (selector) => {
				const host = document.querySelector(selector);
				if (!host)
					return "";
				const svg = host.querySelector("svg");
				const classes = Array.from(host.querySelectorAll("[class*='i-carbon-'], [class*='iconify']"))
					.map((el) => el.getAttribute("class") ?? "")
					.join(" ");
				return `${svg ? svg.innerHTML.trim().slice(0, 300) : ""}|${classes}`;
			};
			// 画布背景透明：量 `<svg>` 上两层容器的计算背景（第一层是画布宿主、第二层是带边框的画布框）
			const shellBg = [];
			for (let el = canvas?.parentElement, depth = 0; el && depth < 2; el = el.parentElement, depth++)
				shellBg.push(getComputedStyle(el).backgroundColor);
			return {
				canvas: canvas ? box(canvas) : null,
				controls: controls ? box(controls) : null,
				switcher: switcher ? box(switcher) : null,
				rotate: rotate ? box(rotate) : null,
				legend: legend ? box(legend) : null,
				// 控件排搬到工具栏左区（2026-11-09 用户调整）：位置靠 DOM 归属 + 同排几何一起钉
				controlsInToolbarLeft: !!document.querySelector("#app-toolbar-left [data-testid='topology-controls']"),
				switcherInToolbarLeft: !!document.querySelector("#app-toolbar-left [data-testid='topology-layout-switcher']"),
				controlsOverCanvas: !!controls && !!canvas
					&& controls.getBoundingClientRect().bottom > canvas.getBoundingClientRect().top
					&& controls.getBoundingClientRect().top < canvas.getBoundingClientRect().bottom
					&& Math.abs(controls.getBoundingClientRect().right - canvas.getBoundingClientRect().right) <= 12,
				missingParts: ["topology-labels-toggle", "topology-reset-view", "topology-zoom-in", "topology-zoom-out", "topology-zoom", "topology-refresh"]
					.filter((id) => !controls?.querySelector(`[data-testid='${id}']`)),
				// 已下线的两枚「复位」（2026-11-09 用户裁决）：同一个动作由「恢复默认配置」三合一承担
				retiredParts: ["topology-rotate-reset", "topology-zoom-reset"]
					.filter((id) => !!document.querySelector(`[data-testid='${id}']`)),
				// 左区排尾三枚：显示名称 → 恢复默认配置 → 更新（顺序 + 「更新」必须有文字）
				leftTail: Array.from(document.querySelectorAll("#app-toolbar-left [data-testid]"))
					.map((el) => el.getAttribute("data-testid") ?? "")
					.slice(-3),
				refreshLabel: document.querySelector("[data-testid='topology-refresh']")?.textContent?.trim() ?? "",
				shellBg: shellBg.join("|"),
				rotateCcwGlyph: glyphOf("[data-testid='topology-rotate-ccw']"),
				rotateCwGlyph: glyphOf("[data-testid='topology-rotate-cw']"),
				layoutGlyph: glyphOf("[data-testid='topology-layout-switcher']"),
				labelsGlyph: glyphOf("[data-testid='topology-labels-toggle']"),
				legendCount: document.querySelectorAll("[data-testid='topology-legend']").length,
				roleListCount: document.querySelectorAll("[data-testid='topology-legend-roles']").length,
				legendInAside: !!document.querySelector("aside [data-testid='topology-legend'], aside [data-testid='topology-legend-roles']"),
				roles: roleList
					? Array.from(roleList.querySelectorAll("[data-role]")).map((el) => ({
						role: el.getAttribute("data-role") ?? "",
						tone: el.getAttribute("data-role-color") ?? "",
						token: tokenOf(el, "border"),
						label: (el.parentElement?.textContent ?? "").trim()
					}))
					: [],
				canvasTokens
			};
		});

		const canvasChrome = await readCanvasChrome();
		const radialChromeSwitch = await switchLayout("径向扇");
		await page.waitForTimeout(300);
		const radialChrome = await readCanvasChrome();
		await switchLayout("层级树");
		await page.waitForTimeout(300);
		// 控件排在工具栏左区、与布局下拉同一行（2026-11-09 用户调整：原先压在画布右上角盖住顶层节点）。
		// 断言两件事：① 归属（`#app-toolbar-left` 内）；② 同排（两者垂直中心差 ≤ 12px）且**不在画布上**。
		const controlsOk = canvasChrome.controlsInToolbarLeft && canvasChrome.switcherInToolbarLeft
			&& !!canvasChrome.controls && !!canvasChrome.switcher
			&& Math.abs(canvasChrome.controls.cy - canvasChrome.switcher.cy) <= 12
			&& canvasChrome.missingParts.length === 0 && !canvasChrome.controlsOverCanvas
			&& radialChromeSwitch && !!radialChrome.rotate && !!radialChrome.controls
			&& Math.abs(radialChrome.rotate.cy - radialChrome.controls.cy) <= 12;
		// 2026-11-09 那轮工具栏调整里能自动钉的四条：画布透明、两枚「复位」下线、
		// 左区排尾顺序（显示名称 → 恢复默认配置 → 更新）且「更新」带文字、图标真的画出来了。
		// 图标两条尤其要量 SVG 内容：名字写错时按钮上什么都没有，但 `[data-testid]` 照样在。
		// 「布局图标随档位换」用两档 glyph 不相等来钉（径向扇 = `carbon:chart-relationship`，
		// 层级树 = `carbon:category`），不把类名写进断言。
		const retiredOk = canvasChrome.retiredParts.length === 0 && radialChrome.retiredParts.length === 0;
		const tailOrderOk = canvasChrome.leftTail.join(",") === "topology-labels-toggle,topology-reset-view,topology-refresh"
			&& radialChrome.leftTail.join(",") === "topology-labels-toggle,topology-reset-view,topology-refresh";
		const refreshLabelOk = [canvasChrome.refreshLabel, radialChrome.refreshLabel].join("|") === "更新|更新";
		const glyphFilled = (glyph) => glyph.replaceAll("|", "").trim() !== "";
		const glyphOk = glyphFilled(radialChrome.rotateCcwGlyph) && glyphFilled(radialChrome.rotateCwGlyph)
			&& radialChrome.rotateCcwGlyph !== radialChrome.rotateCwGlyph
			&& glyphFilled(canvasChrome.labelsGlyph)
			&& glyphFilled(canvasChrome.layoutGlyph) && glyphFilled(radialChrome.layoutGlyph)
			&& canvasChrome.layoutGlyph !== radialChrome.layoutGlyph;
		// 画布背景：`<svg>` 上两层容器（宿主 + 带边框的画布框）都必须是全透明，底色交给页面
		const shellBgOk = canvasChrome.shellBg === "rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)"
			&& radialChrome.shellBg === "rgba(0, 0, 0, 0)|rgba(0, 0, 0, 0)";
		const legendRoot = canvasChrome.roles.find((entry) => entry.role === "root") ?? null;
		const legendTokensMatch = canvasChrome.roles.length > 0
			&& canvasChrome.roles.every((entry) => entry.token !== "" && entry.token === (canvasChrome.canvasTokens[entry.role] ?? "?"));
		const nearRightEdge = (target) => !!canvasChrome.canvas && !!target
			&& Math.abs(canvasChrome.canvas.right - target.right) <= 12;
		const legendOk = nearRightEdge(canvasChrome.legend)
			&& !!canvasChrome.canvas && !!canvasChrome.legend
			&& Math.abs(canvasChrome.canvas.bottom - canvasChrome.legend.bottom) <= 12
			&& canvasChrome.legendCount === 1 && canvasChrome.roleListCount === 1 && !canvasChrome.legendInAside
			&& legendTokensMatch
			&& !!legendRoot && legendRoot.label === "边界层" && legendRoot.tone === "boundary";

		// 复原默认样本：A28 起的断言仍走 6 节点默认图（`topology-nested` 只切形状，不复位样本）
		await fetch(`http://${HOST}:${upstreamPort}/__control/topology-default`);

		// A47 尾段：灰**不丢状态** —— `offline` 用粗虚线 `6 4`、无线介质用细密虚线 `2 3`（默认 6 节点样本：
		// 恰好 2 条 down、2 条无线，其中 `10.0.0.4→10.0.0.6` 两者兼具 ⇒ 粗虚线优先）。线型成了灰色之后
		// 唯一还带语义的链路差异，所以必须钉住；同一轮顺带钉**线宽读带宽**（§6.15 要求 3）：
		// 样本里只有 `10.0.0.1→10.0.0.2` 给了 `1 Gbps`（= 1000 Mbps，落 `2.5` 那档），其余 5 条没有带宽
		// ⇒ 落到 `1.5` 的缺真值档：宽的那一条必须是它，且全图只有两种宽度。
		await page.reload({ waitUntil: "networkidle" });
		await page.waitForTimeout(900);
		const dashProbe = await page.evaluate(() => Array.from(document.querySelectorAll("[data-testid='topology-link']"))
			.map((el) => ({
				key: el.getAttribute("data-link-key") ?? "",
				dash: getComputedStyle(el).strokeDasharray,
				width: getComputedStyle(el).strokeWidth
			})));
		const dashedLinks = dashProbe.filter((link) => link.dash !== "none");
		const coarseDashed = dashedLinks.filter((link) => ["6 4", "6px, 4px"].includes(link.dash));
		const fineDashed = dashedLinks.filter((link) => ["2 3", "2px, 3px"].includes(link.dash));
		/** 稠密样本里 down 的两条：`10.0.0.3→10.0.0.4`（有线）与 `10.0.0.4→10.0.0.6`（无线，状态优先） */
		const dashOk = dashProbe.length === 6 && dashedLinks.length === 3
			&& coarseDashed.length === 2 && fineDashed.length === 1
			&& coarseDashed.every((link) => link.key.includes("10.0.0.4")
				&& (link.key.includes("10.0.0.3") || link.key.includes("10.0.0.6")))
			&& fineDashed[0].key.includes("10.0.0.4") && fineDashed[0].key.includes("10.0.0.5");
		const wideLinks = dashProbe.filter((link) => link.width === "2.5px");
		const widthOk = wideLinks.length === 1
			&& wideLinks[0].key.includes("10.0.0.1") && wideLinks[0].key.includes("10.0.0.2")
			&& dashProbe.filter((link) => link.width === "1.5px").length === 5;
		log(
			"A47 连线一律低饱和中性灰（同一档灰、不等于任何层色），关联强调只加同色外延环（本体宽度不动）",
			greyOk
			&& highlightClicked && highlighted.linkCount === 4
			&& highlighted.linkStrokes.length === 1 && highlighted.linkStrokes[0] === greyColors.link
			&& linkEmphasisOk
			&& highlighted.neighbourIds.join(",") === "10.0.1.1,10.0.1.2,10.0.1.6,10.0.1.7"
			&& highlighted.neighbourWidths.join(",") === "2px"
			&& highlighted.neighbourHaloOpacities.join(",") === "0.22" && neighbourTierOk
			&& selfTierOk
			&& highlighted.haloCount === 5
			&& reclickSame && stillSelected.selfWidth === "3px"
			&& stillSelected.haloLevel === "selected"
			&& stillSelected.linkCount === 4 && stillSelected.haloCount === 5
			&& dashOk && widthOk,
			`links=${greyProbe.linkCount} 描边=${greyProbe.linkStrokes.length}档 灰=${greyColors.link}`
			+ `（色度 ${linkOklch?.chroma ?? "?"} / muted ${mutedOklch?.chroma ?? "?"}）层色=${greyProbe.roleStrokes.length}档`
			+ ` 强调=${highlighted.linkCount}条[${highlighted.linkStrokes.join("/")}]/${highlighted.linkWidths.join("/")}`
			+ ` 外延=${highlighted.linkHaloCount}圈[${highlighted.linkHaloLevels.join("/")}]/${highlighted.linkHaloWidths.join("/")}/${highlighted.linkHaloOpacities.join("/")} 染色=${highlighted.linkHaloTints.join("/")}`
			+ ` 邻居=${highlighted.neighbourIds.length}个/${highlighted.neighbourWidths.join("/")}/${highlighted.neighbourHaloOpacities.join("/")} 层色不变=${neighbourTierOk}`
			+ ` 本机=${highlighted.selfWidth}/${highlighted.selfStroke} 外环=${highlighted.haloCount}个[${highlighted.haloStroke}]/${highlighted.haloWidth}/${highlighted.haloOpacity}`
			+ ` 再点同一台=${stillSelected.selfWidth}/${stillSelected.haloLevel}/强调=${stillSelected.linkCount}条`
			+ ` 虚线=${dashedLinks.length}条[粗${coarseDashed.length}/细${fineDashed.length}]`
			+ ` 线宽=${wideLinks.length}条2.5px/${dashProbe.filter((link) => link.width === "1.5px").length}条1.5px`
		);

		// A52：**同档**（`tier` 相同）的上下级（§6.15，2026-11-09 用户反馈）。现网 18 台胖 AP 登记成
		// `tier 3`，与它们上联的接入交换机**同档**；只按「严格更靠下」判，收起汇聚时接入被摘掉、
		// AP 却留在画布上且不连任何东西（用户原话「点收起，Wi-Fi胖AP-10~18 没有收起来」）。判据因此
		// 补了第二条：同档时**只有一端还有上行**（邻接里存在 tier 更小的设备）才算方向。样本
		// （`__control/topology-same-tier`）钉四件事：
		//   ① 角标只长在核心-1 / 汇聚-1 / 接入-1 / 胖AP-10 上 —— 两台都上联汇聚的接入-2 与只连接入的
		//      AP-11/12 都没有下级（同档且两端都没有 / 都有上行时不许凭空造层级）；
		//   ② 角标读数：展开态一律 `-`（有下级但没收起）；收起汇聚-1 后它的角标写 `+6`（接入-1、接入-2、
		//      3 台 AP、1 台终端），收起接入-1 后它的角标写 `+4` —— 后者必须**穿过「同档那一跳」**
		//      把 AP 与挂在 AP 下的终端一起算进来；
		//   ③ 双击汇聚-1 → 8 台只剩核心-1 与它自己 2 台、链路只剩 1 条、画布上无悬空边
		//      （旧判据在这里会留下 3 台 AP + 1 台终端，且它们的边全被摘掉 ⇒ 4 个孤点）；
		//   ④ 展开后 8 台坐标逐点复原；再收起接入-1 → 4 台（同档互相不认下级，接入-2 留着）。
		await fetch(`http://${HOST}:${upstreamPort}/__control/topology-same-tier`);
		await page.reload({ waitUntil: "networkidle" });
		await page.waitForTimeout(800);
		const sameTierBefore = await readCollapseState();
		const clickedSameTierDistro = await toggleCollapse("10.0.3.2");
		await page.waitForTimeout(400);
		const sameTierDistroCollapsed = await readCollapseState();
		const clickedSameTierDistroAgain = await toggleCollapse("10.0.3.2");
		await page.waitForTimeout(400);
		const sameTierRestored = await readCollapseState();
		const sameTierRestoredSame = clickedSameTierDistroAgain
			&& sameTierRestored.nodeCount === sameTierBefore.nodeCount
			&& sameTierBefore.ids.every((id) => sameTierRestored.positions[id] === sameTierBefore.positions[id]);
		const clickedSameTierAccess = await toggleCollapse("10.0.3.3");
		await page.waitForTimeout(400);
		const sameTierAccessCollapsed = await readCollapseState();
		log(
			"A52 同档（tier 相同）的上下级：接入收走它同档的胖 AP、两端都有上行的同档邻居互不认下级",
			sameTierBefore.nodeCount === 8
			&& sameTierBefore.linkCount === 8
			&& sameTierBefore.badgeIds.join(",") === "10.0.3.1,10.0.3.10,10.0.3.2,10.0.3.3"
			&& sameTierBefore.badgeTexts["10.0.3.2"] === "-"
			&& sameTierBefore.badgeTexts["10.0.3.3"] === "-"
			&& sameTierBefore.badgeTexts["10.0.3.10"] === "-"
			&& clickedSameTierDistro && sameTierDistroCollapsed.collapsedIds.join(",") === "10.0.3.2"
			&& sameTierDistroCollapsed.nodeCount === 2 && sameTierDistroCollapsed.linkCount === 1
			&& [...sameTierDistroCollapsed.ids].sort().join(",") === "10.0.3.1,10.0.3.2"
			&& sameTierDistroCollapsed.dangling.length === 0
			&& sameTierDistroCollapsed.badgeTexts["10.0.3.2"] === "+6"
			&& sameTierRestoredSame
			&& clickedSameTierAccess && sameTierAccessCollapsed.nodeCount === 4
			&& sameTierAccessCollapsed.badgeTexts["10.0.3.3"] === "+4"
			&& [...sameTierAccessCollapsed.ids].sort().join(",") === "10.0.3.1,10.0.3.2,10.0.3.3,10.0.3.4",
			`badges=${sameTierBefore.badgeIds.join("/")} 展开态=${sameTierBefore.badgeTexts["10.0.3.2"]}/${sameTierBefore.badgeTexts["10.0.3.3"]}/${sameTierBefore.badgeTexts["10.0.3.10"]}`
			+ ` 收后角标=${sameTierDistroCollapsed.badgeTexts["10.0.3.2"]}/${sameTierAccessCollapsed.badgeTexts["10.0.3.3"]}`
			+ ` before=${sameTierBefore.nodeCount}台/${sameTierBefore.linkCount}边`
			+ ` 收汇聚=${sameTierDistroCollapsed.nodeCount}台/${sameTierDistroCollapsed.linkCount}边[${[...sameTierDistroCollapsed.ids].sort().join("/")}] 悬空=${sameTierDistroCollapsed.dangling.length}`
			+ ` 复原=${sameTierRestored.nodeCount}台 逐点相等=${sameTierRestoredSame}`
			+ ` 收接入=${sameTierAccessCollapsed.nodeCount}台[${[...sameTierAccessCollapsed.ids].sort().join("/")}]`
		);
		// 复原默认样本（A48 起的断言仍走 6 节点默认图）
		await fetch(`http://${HOST}:${upstreamPort}/__control/topology-default`);
		await page.reload({ waitUntil: "networkidle" });
		await page.waitForTimeout(900);

		// A48 ③：详情栏的两枚按钮真跳到指标页（§6.15 要求 3）。两个域的记录标识不同（拓扑 id 是管理 IP、
		// 设备台账 `?id` 是 `device_code`、链路台账 `?id` 是 `link_id`），所以深链带 IP、目标页用自己已经
		// 抓到的台账解析成 `?id` —— 只断言「URL 变了」会漏掉「跳过去是另一台设备」。
		// 默认样本里 `10.0.0.2` 对齐台账的 `DEV-CORE-1`（`sys_name` = 核心路由器-1）；`10.0.0.1` 不在台账里，
		// 正好用来说明「命中不了就保持默认选中、不静默翻页去捞」（`NMCPS-ARCH-006` §5.2 同规则）。
		const nodeForMetrics = await clickGraphNode("10.0.0.2");
		await page.waitForTimeout(600);
		const nodeMetricsButton = await page.evaluate(() => {
			const button = document.querySelector("[data-testid='topology-node-metrics']");
			/**
			 * 「按钮在卡片最底部、主色」（2026-11-09 用户裁决）：位置用几何量 ——
			 * 卡片里所有事实行（`dt` / `dd` / 小标题 / 邻居列表）的底边都在按钮上边之上，
			 * 且按钮的包裹 `<span>` 是卡片的**最后一个子元素**（后面没有别的东西了）。
			 * 颜色读 class 里的 `primary`（Nuxt UI 的 soft 主色按钮就是这么标的）。
			 */
			const card = button?.closest("div.rounded-lg.border") ?? null;
			const rect = button?.getBoundingClientRect() ?? null;
			const facts = Array.from(card?.querySelectorAll("dt, dd, h3, ul") ?? [])
				.map((el) => el.getBoundingClientRect())
				.filter((box) => box.height > 0);
			const wrapper = button?.closest("span") ?? button;
			const siblings = card && wrapper ? Array.from(card.children) : [];
			return {
				exists: !!button,
				mgmtIp: button?.getAttribute("data-mgmt-ip") ?? "",
				disabled: button?.hasAttribute("disabled") ?? true,
				belowFacts: !!rect && facts.every((box) => box.bottom <= rect.top + 1),
				factRows: facts.length,
				siblingsAfter: wrapper ? siblings.slice(siblings.indexOf(wrapper) + 1).length : -1,
				primaryTone: !!button && [...button.classList].some((name) => name.includes("primary"))
			};
		});
		await page.click("[data-testid='topology-node-metrics']");
		await page.waitForURL((target) => target.pathname === "/topology/device-metrics", { timeout: 15_000 }).catch(() => {});
		await page.waitForTimeout(1_500);
		const deviceDeepLink = await page.evaluate(() => {
			const url = new URL(window.location.href);
			return {
				path: url.pathname,
				mgmtIp: url.searchParams.get("mgmt_ip") ?? "",
				id: url.searchParams.get("id") ?? "",
				name: document.querySelector("[data-testid='device-detail-name']")?.textContent?.trim() ?? ""
			};
		});

		// 链路侧：回到监控页点一条画布上的链路 → 卡片 → 按钮跳 `/topology/link-metrics`，深链带两端管理 IP。
		// 这一条同时是「命中不了不编造」的反向证明：`10.0.0.1` 不在链路台账里（台账只有 10.0.0.2 ↔ 10.0.0.3
		// 与 AP 那条），所以页面只会带上 `source_ip` / `target_ip`，保持默认选中，不会硬凑一条链路。
		await page.goto(`${BASE_URL}/topology/monitor`, { waitUntil: "networkidle" });
		await page.waitForTimeout(900);
		const clickedLinkForMetrics = await page.evaluate(() => {
			const link = Array.from(document.querySelectorAll("[data-testid='topology-link']"))
				.find((el) => (el.getAttribute("data-link-key") ?? "").includes("10.0.0.1")
					&& (el.getAttribute("data-link-key") ?? "").includes("10.0.0.2"));
			link?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			return link?.getAttribute("data-link-key") ?? "";
		});
		await page.waitForTimeout(500);
		const linkCardVisible = await page.evaluate(() => {
			/**
			 * 链路卡片的指标按钮同样压在**最底部**、同样是主色（2026-11-09 用户裁决），
			 * 并且卡片里**没有关闭叉**（退出链路视图靠再点一次这条线）。
			 */
			const card = document.querySelector("[data-testid='topology-link-card']");
			const button = document.querySelector("[data-testid='topology-link-metrics']");
			const rect = button?.getBoundingClientRect() ?? null;
			const facts = Array.from(card?.querySelectorAll("dt, dd, h3, ul, p") ?? [])
				.map((el) => el.getBoundingClientRect())
				.filter((box) => box.height > 0);
			const wrapper = button?.closest("span") ?? button;
			const children = card && wrapper ? Array.from(card.children) : [];
			return {
				visible: !!card,
				metricsBelowFacts: !!rect && facts.every((box) => box.bottom <= rect.top + 1),
				metricsSiblingsAfter: wrapper ? children.slice(children.indexOf(wrapper) + 1).length : -1,
				metricsPrimary: !!button && [...button.classList].some((name) => name.includes("primary"))
			};
		});
		await page.click("[data-testid='topology-link-metrics']");
		await page.waitForURL((target) => target.pathname === "/topology/link-metrics", { timeout: 15_000 }).catch(() => {});
		await page.waitForTimeout(1_500);
		const linkDeepLink = await page.evaluate(() => {
			const url = new URL(window.location.href);
			return {
				path: url.pathname,
				source: url.searchParams.get("source_ip") ?? "",
				target: url.searchParams.get("target_ip") ?? ""
			};
		});
		// 直达解析（正向）：台账里 `10.0.0.2` / `10.0.0.3` 是 `DEV-CORE-1` / `DEV-ACC-1`，那条链路的
		// `link_id` 是 `DEV-CORE-1:GE0/0/1--DEV-ACC-1:GE1/0/1`；方向不敏感（台账的 source / target 是发现顺序）。
		await page.goto(`${BASE_URL}/topology/link-metrics?source_ip=10.0.0.2&target_ip=10.0.0.3`, { waitUntil: "networkidle" });
		await page.waitForTimeout(1_500);
		const resolvedLink = await page.evaluate(() => {
			const url = new URL(window.location.href);
			return {
				id: url.searchParams.get("id") ?? "",
				header: document.querySelector("[data-testid='link-detail-header'] span")?.textContent?.trim() ?? ""
			};
		});
		log(
			"A48 控件排搬进工具栏左区与布局下拉同排、排尾「显示名称→恢复默认配置→更新」、两枚复位下线、图标非空、画布透明，图例只在画布右下角并写「边界层」，两枚深链按钮真跳到指标页并选中对应记录",
			controlsOk && retiredOk && tailOrderOk && refreshLabelOk && glyphOk && shellBgOk && legendOk
			&& nodeForMetrics && nodeMetricsButton.exists && !nodeMetricsButton.disabled && nodeMetricsButton.mgmtIp === "10.0.0.2"
			&& nodeMetricsButton.belowFacts && nodeMetricsButton.siblingsAfter === 0 && nodeMetricsButton.primaryTone
			&& deviceDeepLink.path === "/topology/device-metrics" && deviceDeepLink.mgmtIp === "10.0.0.2"
			&& deviceDeepLink.id === "DEV-CORE-1" && deviceDeepLink.name === "核心路由器-1"
			&& clickedLinkForMetrics !== "" && linkCardVisible.visible
			&& linkCardVisible.metricsBelowFacts && linkCardVisible.metricsSiblingsAfter === 0 && linkCardVisible.metricsPrimary
			&& linkDeepLink.path === "/topology/link-metrics"
			&& linkDeepLink.source === "10.0.0.1" && linkDeepLink.target === "10.0.0.2"
			&& resolvedLink.id === "DEV-CORE-1:GE0/0/1--DEV-ACC-1:GE1/0/1" && resolvedLink.header.includes("DEV-CORE-1"),
			`工具栏左区=${canvasChrome.controlsInToolbarLeft}/${canvasChrome.switcherInToolbarLeft}`
			+ ` 同排差=${canvasChrome.controls && canvasChrome.switcher ? Math.round(canvasChrome.controls.cy - canvasChrome.switcher.cy) : "?"}`
			+ ` 压画布=${canvasChrome.controlsOverCanvas} 缺控件=[${canvasChrome.missingParts.join("/")}]`
			+ ` 排尾=[${canvasChrome.leftTail.join("/")}] 更新文案=${canvasChrome.refreshLabel || "无"}`
			+ ` 已下线残留=[${canvasChrome.retiredParts.join("/")}]>${retiredOk}/${tailOrderOk}/${glyphOk}`
			+ ` 图标长度=[${[radialChrome.rotateCcwGlyph, radialChrome.rotateCwGlyph, canvasChrome.layoutGlyph, radialChrome.layoutGlyph, canvasChrome.labelsGlyph].map((glyph) => glyph.length).join("/")}]`
			+ ` 画布底=${canvasChrome.shellBg}/${radialChrome.shellBg}`
			+ ` 旋转同排=${!!radialChrome.rotate && !!radialChrome.controls}`
			+ ` 图例右差=${canvasChrome.canvas && canvasChrome.legend ? Math.round(canvasChrome.canvas.right - canvasChrome.legend.right) : "?"}`
			+ ` 下差=${canvasChrome.canvas && canvasChrome.legend ? Math.round(canvasChrome.canvas.bottom - canvasChrome.legend.bottom) : "?"}`
			+ ` 图例份数=${canvasChrome.legendCount}/${canvasChrome.roleListCount} 侧栏重复=${canvasChrome.legendInAside}`
			+ ` 角色=[${canvasChrome.roles.map((entry) => `${entry.role}:${entry.label}`).join("/")}] 色块同源=${legendTokensMatch}`
			+ ` 节点按钮=${nodeMetricsButton.mgmtIp}/${nodeMetricsButton.disabled ? "禁用" : "可点"}`
			+ ` 卡片底部=${nodeMetricsButton.belowFacts}(事实${nodeMetricsButton.factRows}行/尾随${nodeMetricsButton.siblingsAfter})/主色=${nodeMetricsButton.primaryTone}`
			+ ` 设备页=${deviceDeepLink.path}?mgmt_ip=${deviceDeepLink.mgmtIp}&id=${deviceDeepLink.id}/${deviceDeepLink.name || "无"}`
			+ ` 链路=${clickedLinkForMetrics || "未点中"}→卡片=${linkCardVisible.visible}`
			+ ` 底部=${linkCardVisible.metricsBelowFacts}/尾随=${linkCardVisible.metricsSiblingsAfter}/主色=${linkCardVisible.metricsPrimary}`
			+ `→${linkDeepLink.path}?${linkDeepLink.source}/${linkDeepLink.target}`
			+ ` 解析后 id=${resolvedLink.id}`
		);
		// A49 链路可选中、右栏**二选一**切换、图例只留层色一行（§6.15 要求 2 / 5，2026-11-08 用户裁决）。
		// 三件事各自独立地会坏，所以分开量：
		//   ① 图例：一个 `<p>` 都没有、状态组整块消失、`li` 数 === 实际出现的角色数 —— 只留层色那一行；
		//   ② 点链路：右栏切到链路详情，节点的详情 / 无线 / 告警 / LLDP 卡片全部让位（不是上下堆叠）；
		//      链路卡片右上**没有关闭叉**（2026-11-09 用户裁决）—— 退出靠再点一次这条线或点一台设备；
		//   ③ 点回节点：链路详情让位、节点事实回来；被点中的那条链路 `data-link-emphasis=selected`，
		//      本体换成 `primary`、粗细仍只读带宽（`1 Gbps` = 2.5px，**不是** 5px），外延环收窄成一圈
		//      主色柔光（2.5 + 5 = 7.5px / 35%）——「主色说当前、外延只做光晕」。
		//   ⓸ 打开页面就选中根（见上面 `defaultSelection`，2026-11-09 用户裁决「不许有空态」）。
		await page.goto(`${BASE_URL}/topology/monitor`, { waitUntil: "networkidle" });
		await page.waitForTimeout(900);
		/**
		 * 默认选中（2026-11-09 用户裁决「打开监控页就选中根节点，右栏没有空态」）：
		 * ① 画布上恰好一台节点带 `selected` 外延环，且它的层号就是**最上一档**（= 根：层级树里是塔尖、径向扇里是扇心；顶端带只有一台时 `resolveLayeredRanks()` 根本不选举 `role=root`，只能按层号认 —— 按角色名认会把「扇心那台读作 `core`」误判成「没有根」）；
		 * ② 右栏一进来就是设备事实（节点指标按钮在），没有链路卡片；
		 * ③ 空态提示语**不出现**（`detail.empty` 那段没有渲染）。
		 */
		const defaultSelection = await page.evaluate(() => {
			const halos = Array.from(document.querySelectorAll("[data-testid='topology-node-halo']"))
				.filter((el) => el.getAttribute("data-halo-emphasis") === "selected");
			const nodes = Array.from(document.querySelectorAll("[data-testid='topology-node']"));
			const tierOf = (el) => Number(el.querySelector("[data-testid='topology-node-shape']")?.getAttribute("data-node-tier"));
			const tiers = nodes.map(tierOf).filter((tier) => Number.isFinite(tier));
			const topTier = tiers.length > 0 ? Math.min(...tiers) : Number.NaN;
			const nodeIds = (list) => list.map((el) => el.getAttribute("data-node-id") ?? "");
			return {
				selectedHalos: halos.length,
				selectedIds: nodeIds(halos.map((el) => el.closest("[data-testid='topology-node']")).filter(Boolean)),
				selectedTiers: halos.map((el) => tierOf(el.closest("[data-testid='topology-node']"))),
				topTier,
				rootIds: nodeIds(nodes.filter((el) => tierOf(el) === topTier)),
				nodeCard: !!document.querySelector("[data-testid='topology-node-metrics']"),
				linkCard: !!document.querySelector("[data-testid='topology-link-card']"),
				// 空态那一句：右栏不该有任何「点画布上的节点」的提示
				emptyHint: Array.from(document.querySelectorAll("aside p")).some((el) => el.textContent?.includes("点画布上的节点"))
			};
		});
		const defaultSelectionOk = defaultSelection.selectedHalos === 1
			&& defaultSelection.selectedIds.length === 1
			&& defaultSelection.selectedTiers.join(",") === String(defaultSelection.topTier)
			&& defaultSelection.rootIds.includes(defaultSelection.selectedIds[0])
			&& defaultSelection.nodeCard && !defaultSelection.linkCard && !defaultSelection.emptyHint;
		const legendTrim = await page.evaluate(() => {
			const legend = document.querySelector("[data-testid='topology-legend']");
			const roles = document.querySelectorAll("[data-testid='topology-legend-roles'] [data-role]");
			return {
				exists: !!legend,
				paragraphs: legend ? legend.querySelectorAll("p").length : -1,
				statusRows: legend ? legend.querySelectorAll("[data-testid='topology-legend-statuses']").length : -1,
				roleCount: roles.length,
				rows: legend ? legend.querySelectorAll("li").length : -1
			};
		});
		const readAside = () => page.evaluate(() => {
			const selected = Array.from(document.querySelectorAll("[data-testid='topology-link'][data-link-emphasis='selected']"));
			const halos = selected.map((el) => el.parentElement?.querySelector("[data-testid='topology-link-halo']") ?? null);
			const hits = Array.from(document.querySelectorAll("[data-testid='topology-link-hit']"));
			return {
				linkCard: !!document.querySelector("[data-testid='topology-link-card']"),
				// 链路卡片不再有右上角关闭叉（2026-11-09 用户裁决）
				linkClose: !!document.querySelector("[data-testid='topology-link-close']"),
				nodeCard: !!document.querySelector("[data-testid='topology-node-metrics']"),
				alarmCard: !!document.querySelector("[data-testid='topology-alarm-card']"),
				adjacencyCard: !!document.querySelector("[data-testid='topology-adjacency-card']"),
				wifiCard: !!document.querySelector("[data-testid='topology-wifi-card']"),
				selectedCount: selected.length,
				selectedWidths: [...new Set(selected.map((el) => getComputedStyle(el).strokeWidth))],
				selectedStrokes: [...new Set(selected.map((el) => getComputedStyle(el).stroke))],
				selectedHaloCount: halos.filter(Boolean).length,
				selectedHaloWidths: [...new Set(halos.filter(Boolean).map((el) => getComputedStyle(el).strokeWidth))],
				selectedHaloOpacities: [...new Set(halos.filter(Boolean).map((el) => getComputedStyle(el).strokeOpacity))],
				selectedHaloStrokes: [...new Set(halos.filter(Boolean).map((el) => getComputedStyle(el).stroke))],
				hitAreas: hits.length,
				// 连线必须是可聚焦控件（要求 B）：六个命中区一个都不能漏 `tabindex` / `role`
				hitFocusable: hits.filter((el) => el.getAttribute("tabindex") === "0" && el.getAttribute("role") === "button").length,
				selectedPressed: selected.map((el) => el.parentElement?.querySelector("[data-testid='topology-link-hit']")?.getAttribute("aria-pressed") ?? "")
			};
		});
		await clickGraphNode("10.0.0.3");
		await page.waitForTimeout(400);
		const asideOnNode = await readAside();
		/** 点一条画布链路（`10.0.0.1`↔`10.0.0.2`：样本里唯一给了带宽的那条，选中宽度因此可预期） */
		const clickGraphLink = () => page.evaluate(() => {
			const link = Array.from(document.querySelectorAll("[data-testid='topology-link']"))
				.find((el) => /10\.0\.0\.1.+10\.0\.0\.2/.test(el.getAttribute("data-link-key") ?? ""));
			link?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			return link?.getAttribute("data-link-key") ?? "";
		});
		const clickedLinkForPanel = await clickGraphLink();
		await page.waitForTimeout(500);
		const asideOnLink = await readAside();
		await clickGraphNode("10.0.0.6");
		await page.waitForTimeout(400);
		const asideBackOnNode = await readAside();
		const linkPanelOk = asideOnNode.nodeCard && !asideOnNode.linkCard
			&& asideOnLink.linkCard && !asideOnLink.nodeCard
			&& !asideOnLink.alarmCard && !asideOnLink.adjacencyCard && !asideOnLink.wifiCard
			&& asideBackOnNode.nodeCard && !asideBackOnNode.linkCard;
		log(
			"A49 链路可点选中且右栏二选一切换、右下角图例只留层色一行",
			legendTrim.exists && legendTrim.paragraphs === 0 && legendTrim.statusRows === 0
			&& legendTrim.roleCount >= 3 && legendTrim.rows === legendTrim.roleCount
			&& defaultSelectionOk
			&& linkPanelOk && !asideOnLink.linkClose
			&& asideOnLink.selectedCount === 1 && asideOnLink.hitAreas === 6
			&& asideOnLink.hitFocusable === 6
			&& asideOnLink.selectedWidths.join(",") === "2.5px"
			&& asideOnLink.selectedPressed.join(",") === "true"
			&& asideOnLink.selectedHaloCount === 1
			&& asideOnLink.selectedHaloWidths.join(",") === "7.5px"
			&& asideOnLink.selectedHaloOpacities.join(",") === "0.35"
			&& asideOnLink.selectedStrokes.length === 1 && asideOnLink.selectedStrokes[0] === greyColors.primary
			&& asideOnLink.selectedHaloStrokes.join(",") === greyColors.primary,
			`图例 段=${legendTrim.paragraphs} 状态组=${legendTrim.statusRows} 行=${legendTrim.rows}/${legendTrim.roleCount}`
			+ ` 默认选中=${defaultSelection.selectedIds.join("/") || "无"}[根=${defaultSelection.rootIds.join("/") || "无"}]`
			+ `/环=${defaultSelection.selectedHalos}/节点卡=${defaultSelection.nodeCard}/链路卡=${defaultSelection.linkCard}`
			+ ` 节点态[链路卡=${asideOnNode.linkCard}/节点卡=${asideOnNode.nodeCard}]`
			+ ` 链路态[链路卡=${asideOnLink.linkCard}/关闭叉=${asideOnLink.linkClose}/节点卡=${asideOnLink.nodeCard}/告警=${asideOnLink.alarmCard}/邻接=${asideOnLink.adjacencyCard}/无线=${asideOnLink.wifiCard}]`
			+ ` 选中=${clickedLinkForPanel || "未点中"}→${asideOnLink.selectedCount}条/${asideOnLink.selectedWidths.join("/")}/${asideOnLink.selectedStrokes.join("/")}`
			+ ` 外延=${asideOnLink.selectedHaloCount}圈/${asideOnLink.selectedHaloWidths.join("/")}/${asideOnLink.selectedHaloOpacities.join("/")}`
			+ ` 可聚焦命中区=${asideOnLink.hitFocusable}/${asideOnLink.hitAreas} aria-pressed=${asideOnLink.selectedPressed.join("/")}`
			+ ` 点回节点[链路卡=${asideBackOnNode.linkCard}/节点卡=${asideBackOnNode.nodeCard}]`
		);

		// A50 深链**自己翻到目标那一页**（§6.15 要求 5）：台账一页 15 条，现网 36 台设备 / 48 条链路，
		// 目标不在第一页是常态。假上游为此垫了 15 / 20 条填充行把真样本挤到第 2 页（第 2 页因此是
		// 3 台设备 / 7 条链路）—— 深链必须
		// ① 扫到那一页、② 把左栏停在那里（目标行可见）、③ 写 `?id` 并选中它。
		// 只断言「URL 带了 ip」会漏掉「跳过去什么都没选中」这一半，而用户点「遥测」要的正是这一半。
		await fetch(`http://${HOST}:${upstreamPort}/__control/metric-deep-page`);
		await page.goto(`${BASE_URL}/topology/device-metrics?mgmt_ip=10.0.0.2`, { waitUntil: "networkidle" });
		await page.waitForTimeout(2_500);
		const pagedDevice = await page.evaluate(() => {
			const url = new URL(window.location.href);
			const row = document.querySelector("[data-device-id='DEV-CORE-1']");
			return {
				id: url.searchParams.get("id") ?? "",
				rowVisible: !!row,
				rowSelected: row?.getAttribute("aria-selected") === "true",
				name: document.querySelector("[data-testid='device-detail-name']")?.textContent?.trim() ?? "",
				rows: document.querySelectorAll("[data-testid='metric-device-row']").length
			};
		});
		await page.goto(`${BASE_URL}/topology/link-metrics?source_ip=10.0.0.2&target_ip=10.0.0.3`, { waitUntil: "networkidle" });
		await page.waitForTimeout(2_500);
		const pagedLink = await page.evaluate(() => {
			const url = new URL(window.location.href);
			const row = document.querySelector("[data-link-id='DEV-CORE-1:GE0/0/1--DEV-ACC-1:GE1/0/1']");
			return {
				id: url.searchParams.get("id") ?? "",
				rowVisible: !!row,
				rowSelected: row?.getAttribute("aria-selected") === "true",
				rows: document.querySelectorAll("[data-testid='metric-link-row']").length
			};
		});
		await fetch(`http://${HOST}:${upstreamPort}/__control/metric-deep-page-off`);
		log(
			"A50 深链目标落在第 2 页时自己翻页并选中对应设备 / 链路",
			pagedDevice.id === "DEV-CORE-1" && pagedDevice.rowVisible && pagedDevice.rowSelected
			&& pagedDevice.name === "核心路由器-1" && pagedDevice.rows === 3
			&& pagedLink.id === "DEV-CORE-1:GE0/0/1--DEV-ACC-1:GE1/0/1"
			&& pagedLink.rowVisible && pagedLink.rowSelected && pagedLink.rows === 7,
			`设备页 id=${pagedDevice.id || "无"} 行可见=${pagedDevice.rowVisible} 选中=${pagedDevice.rowSelected}`
			+ ` 名称=${pagedDevice.name || "无"} 本页行=${pagedDevice.rows}`
			+ ` 链路页 id=${pagedLink.id || "无"} 行可见=${pagedLink.rowVisible} 选中=${pagedLink.rowSelected} 本页行=${pagedLink.rows}`
		);

		// A51 连线可以用键盘选中（要求 B，2026-11-08）：每条连线的命中区都是**可聚焦控件** ——
		// `role="button"` + `tabindex=0` + 带事实的 `aria-label`，焦点落上去出一圈同色外延环
		// （`focus` 档，与「关联」同宽），`Enter` / `Space` 与鼠标点击**同效**（`Space` 再点一次
		// 即回到设备视图，2026-11-09 起没有「关闭叉」这条路），`aria-pressed` 同步回报。
		// 缺任何一条，「只能用鼠标点」就还在：焦点看不见、键按不动、或无状态回报。
		// 焦点环不引入新色：它借的是那条链路的本体灰（外延 = 基础 2.5 + 6 = 8.5px / 30%）。
		// 焦点**优先于**「关联」：打开监控页就选中根（§6.15.6），与根直连的线一进图就带关联环，
		// 若让关联压住焦点，Tab 到这几条线上就看不到任何变化；所以下面按「这条线自己的环」断言，
		await page.goto(`${BASE_URL}/topology/monitor`, { waitUntil: "networkidle" });
		await page.waitForTimeout(900);
		const focusGraphLink = () => page.evaluate(() => {
			const hit = Array.from(document.querySelectorAll("[data-testid='topology-link-hit']"))
				.find((el) => /10\.0\.0\.1.+10\.0\.0\.2/.test(el.getAttribute("data-link-hit-key") ?? ""));
			hit?.focus();
			return {
				key: hit?.getAttribute("data-link-hit-key") ?? "",
				focused: !!hit && document.activeElement === hit,
				role: hit?.getAttribute("role") ?? "",
				tabindex: hit?.getAttribute("tabindex") ?? "",
				label: hit?.getAttribute("aria-label") ?? ""
			};
		});
		const blurActiveLink = () => page.evaluate(() => {
			if (document.activeElement instanceof SVGElement)
				document.activeElement.blur();
		});
		/**
		 * 读「被聚焦的那条线**自己**」的外延环，而不是全图所有外延环的集合。
		 *
		 * 为什么必须分开：打开监控页就选中根（§6.15.6），与根直连的那两条线一进图就带着 `incident` 环 ——
		 * 全图环数因此恒为 2，「焦点恰一圈」这种断言从此量的是别的东西。焦点在这里只改**这条线**的档位
		 * （`focus` 优先于 `incident`，见 `TopologyCanvas` 的 `linkHaloLevelOf()`），所以逐线读。
		 */
		const readLinkKeyboard = (key) => page.evaluate((linkKey) => {
			const body = Array.from(document.querySelectorAll("[data-testid='topology-link']"))
				.find((el) => el.getAttribute("data-link-key") === linkKey);
			const ownHalo = body?.parentElement?.querySelector("[data-testid='topology-link-halo']") ?? null;
			const pressed = Array.from(document.querySelectorAll("[data-testid='topology-link-hit']"))
				.filter((el) => el.getAttribute("aria-pressed") === "true");
			// 被点中的那条：本体换成主色（2026-11-09 用户裁决「选中链路改主色」）
			const selectedBody = Array.from(document.querySelectorAll("[data-testid='topology-link'][data-link-emphasis='selected']"));
			return {
				ownLevel: ownHalo?.getAttribute("data-link-halo-emphasis") ?? "none",
				ownWidth: ownHalo ? getComputedStyle(ownHalo).strokeWidth : "",
				ownOpacity: ownHalo ? getComputedStyle(ownHalo).strokeOpacity : "",
				ownStroke: ownHalo ? getComputedStyle(ownHalo).stroke : "",
				ownBodyStroke: body ? getComputedStyle(body).stroke : "",
				bodyWidth: body ? getComputedStyle(body).strokeWidth : "",
				haloCount: document.querySelectorAll("[data-testid='topology-link-halo']").length,
				strokes: [...new Set(selectedBody.map((el) => getComputedStyle(el).stroke))],
				pressedCount: pressed.length,
				card: !!document.querySelector("[data-testid='topology-link-card']"),
				nodeCard: !!document.querySelector("[data-testid='topology-node-metrics']")
			};
		}, key);
		const focusedLink = await focusGraphLink();
		await page.waitForTimeout(300);
		const onFocus = await readLinkKeyboard(focusedLink.key);
		await page.keyboard.press("Enter");
		await page.waitForTimeout(400);
		const onEnter = await readLinkKeyboard(focusedLink.key);
		await page.keyboard.press("Space");
		await page.waitForTimeout(400);
		const onSpace = await readLinkKeyboard(focusedLink.key);
		await blurActiveLink();
		await page.waitForTimeout(300);
		const onBlur = await readLinkKeyboard(focusedLink.key);
		log(
			"A51 连线可聚焦（role=button + tabindex=0 + 事实化 aria-label），Enter / Space 与点击同效并回报 aria-pressed",
			focusedLink.focused && focusedLink.role === "button" && focusedLink.tabindex === "0"
			&& focusedLink.label.startsWith("链路") && focusedLink.label.includes("1 Gbps")
			&& focusedLink.label.includes("回车查看详情")
			// 焦点环：这一条线自己的环从 `incident` 升到 `focus`（同宽同不透明度的灰圈，不染层色）
			&& onFocus.ownLevel === "focus" && onFocus.ownWidth === "8.5px" && onFocus.ownOpacity === "0.3"
			&& onEnter.card && !onEnter.nodeCard && onEnter.pressedCount === 1
			&& onEnter.ownLevel === "selected" && onEnter.ownWidth === "7.5px"
			&& onEnter.strokes.length === 1 && onEnter.strokes[0] === greyColors.primary
			&& onEnter.bodyWidth === "2.5px" && onEnter.ownBodyStroke === greyColors.primary
			// `Space` 再按一次 = 回到设备视图（没有关闭叉这条路）；焦点仍在线上，环仍是 `focus`，
			// 而本体退回状态灰（不再是主色）—— 这一对照说明「主色只属于选中」。
			&& !onSpace.card && onSpace.pressedCount === 0
			&& onSpace.ownLevel === "focus" && onSpace.bodyWidth === "2.5px"
			&& onSpace.ownBodyStroke !== greyColors.primary
			&& onBlur.ownLevel === "incident" && onBlur.ownWidth === "8.5px" && onBlur.ownOpacity === "0.3"
			&& !onBlur.card,
			`命中区=${focusedLink.key || "未找到"} 聚焦=${focusedLink.focused} role=${focusedLink.role} tabindex=${focusedLink.tabindex}`
			+ ` 名称=${focusedLink.label || "无"}`
			+ ` 焦点环=${onFocus.ownLevel}/${onFocus.ownWidth}/${onFocus.ownOpacity}（全图 ${onFocus.haloCount} 圈）`
			+ ` Enter[卡片=${onEnter.card}/节点卡=${onEnter.nodeCard}/按下=${onEnter.pressedCount}/环=${onEnter.ownLevel}/${onEnter.ownWidth}]`
			+ ` 本体=${onEnter.bodyWidth}/${onEnter.ownBodyStroke === greyColors.primary ? "primary" : onEnter.ownBodyStroke}`
			+ ` Space[卡片=${onSpace.card}/按下=${onSpace.pressedCount}/环=${onSpace.ownLevel}/本体=${onSpace.bodyWidth}]`
			+ ` 失焦后=${onBlur.ownLevel}/${onBlur.ownWidth}/卡片=${onBlur.card}`
		);

		// 回到监控页：下面的断言（链路事实 / 告警 / 仿真 / LLDP）仍从这张图出发
		await page.goto(`${BASE_URL}/topology/monitor`, { waitUntil: "networkidle" });
		await page.waitForTimeout(800);

		// 全是 0，而 21/48 的 `traffic_in|out` 非零（`traffic_out: 16.18` 配 `out_util_pct: 0`）——
		// 这四个 0 是「没算」。断言钉两件事：点链路出卡片且基础事实照实（介质 / 关系 / 管理状态 /
		// 带宽原文 / 双向流量），四个利用率维度写「未计算」而**绝不出现 `0%`**。
		await fetch(`http://${HOST}:${upstreamPort}/__control/topology-nested`);
		await page.reload({ waitUntil: "networkidle" });
		await page.waitForTimeout(800);
		const clickedLink = await page.evaluate(() => {
			const link = Array.from(document.querySelectorAll("[data-link-key]"))
				.find((el) => /10\.0\.0\.1.+10\.0\.0\.2/.test(el.getAttribute("data-link-key") ?? ""));
			link?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			return link?.getAttribute("data-link-key") ?? null;
		});
		await page.waitForTimeout(400);
		const linkCard = await page.evaluate((linkKey) => {
			const read = (key) => document.querySelector(`[data-testid='topology-link-fact-${key}']`)?.textContent?.trim() ?? "";
			return {
				card: !!document.querySelector("[data-testid='topology-link-card']"),
				type: read("type"),
				medium: read("medium"),
				relation: read("relation"),
				admin: read("admin"),
				bandwidth: read("bandwidth"),
				trafficIn: read("traffic-in"),
				trafficOut: read("traffic-out"),
				utilIn: read("util-in"),
				utilOut: read("util-out"),
				packetLoss: read("packet-loss"),
				errorRate: read("error-rate"),
				// 卡片上所有事实格的读数：`0%` 一个都不许出现（四个 0 是「没算」，见 §6.11）
				cells: Array.from(document.querySelectorAll("[data-testid^='topology-link-fact-']"))
					.map((el) => (el.textContent ?? "").trim()),
				title: document.querySelector(`[data-link-key='${linkKey}'] title`)?.textContent ?? ""
			};
		}, clickedLink);
		const linkFactsOk = linkCard.type === "fiber" && linkCard.medium === "optical"
			&& linkCard.relation === "up" && linkCard.admin === "enabled"
			&& linkCard.bandwidth === "1 Gbps"
			&& linkCard.trafficIn === "12.5 Mbps" && linkCard.trafficOut === "16.18 Mbps";
		const utilNotComputed = ["utilIn", "utilOut", "packetLoss", "errorRate"]
			.every((key) => linkCard[key] === "未计算");
		log(
			"A28 点链路出事实卡：基础事实 + 双向流量照实，利用率四项写「未计算」（不出 0%）",
			!!clickedLink && linkCard.card && linkFactsOk && utilNotComputed
			&& !linkCard.cells.includes("0%") && linkCard.title.includes("未计算"),
			`key=${clickedLink} type=${linkCard.type} medium=${linkCard.medium} bw=${linkCard.bandwidth}`
			+ ` in=${linkCard.trafficIn} out=${linkCard.trafficOut} util=${linkCard.utilIn}/${linkCard.utilOut}`
			+ `/pl=${linkCard.packetLoss}/er=${linkCard.errorRate} cells=${linkCard.cells.join(",")}`
			+ ` title=${linkCard.title}`
		);

		// A29：区域分组折叠（§6.11）。`combo-edge` 折起来后画布上少了它的 3 台与挂在上面的 4 条链路，
		// 但**组计数一个字都不变**（`counts` 是上游自报，不是画布统计）——「全部展开」复原。
		const groupRead = () => page.evaluate(() => ({
			nodes: document.querySelectorAll("[data-testid='topology-node']").length,
			links: document.querySelectorAll("[data-link-key]").length,
			badge: document.querySelector("[data-testid='topology-collapsed']")?.textContent?.trim() ?? "",
			counts: document.querySelector("[data-testid='topology-group-counts-combo-edge']")?.textContent?.trim() ?? "",
			members: document.querySelector("[data-testid='topology-groups-expand']") ? "expand" : "collapsed-none"
		}));
		/** 分组清单在画布左上角的浮层里（不再占侧栏），读它之前先展开 */
		const openGroups = async () => {
			await page.click("[data-testid='topology-groups-toggle']");
			await page.waitForTimeout(300);
		};
		await openGroups();
		const groupsBefore = await groupRead();
		await page.click("[data-testid='topology-combo-toggle'][data-combo-id='combo-edge']");
		await page.waitForTimeout(400);
		const groupsCollapsed = await groupRead();
		await page.click("[data-testid='topology-groups-expand']");
		await page.waitForTimeout(400);
		const groupsRestored = await groupRead();
		// 浮层还开着的话，下一次点画布只会把它关掉 —— 先收起来，别让后面的节点点击被吞掉
		await page.keyboard.press("Escape");
		await page.waitForTimeout(200);
		log(
			"A29 折叠区域分组：画布摘掉该组节点与挂边，组计数不变，「全部展开」复原",
			groupsBefore.nodes === 6 && groupsBefore.links === 6
			&& groupsCollapsed.nodes === 3 && groupsCollapsed.links === 2
			&& groupsCollapsed.counts === groupsBefore.counts && groupsCollapsed.counts.includes("终端 2")
			&& groupsCollapsed.badge.includes("3") && groupsCollapsed.members === "expand"
			&& groupsRestored.nodes === 6 && groupsRestored.links === 6 && groupsRestored.badge === "",
			`before=${groupsBefore.nodes}/${groupsBefore.links} collapsed=${groupsCollapsed.nodes}/${groupsCollapsed.links}`
			+ ` counts=${groupsBefore.counts}→${groupsCollapsed.counts} badge=${groupsCollapsed.badge}`
			+ ` restored=${groupsRestored.nodes}/${groupsRestored.links}`
		);

		// A30：无线事实卡（§6.11）。带 Wi-Fi 字段的节点（实测 27/36）才画这块，七项照实不换算；
		// 一个字段都没有的节点（核心路由器）**不画**——画一排「—」等于说「这台 AP 的 SSID 取不到」。
		const wifiOf = async (nodeId) => {
			await page.evaluate((id) => {
				const node = Array.from(document.querySelectorAll("[data-testid='topology-node']"))
					.find((el) => el.getAttribute("data-node-id") === id);
				node?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			}, nodeId);
			await page.waitForTimeout(400);
			return page.evaluate(() => {
				const read = (key) => document.querySelector(`[data-testid='topology-wifi-${key}']`)?.textContent?.trim() ?? "";
				return {
					card: !!document.querySelector("[data-testid='topology-wifi-card']"),
					ssid: read("ssid"),
					band: read("band"),
					channel: read("channel"),
					dbm: read("dbm"),
					clients: read("clients"),
					util: read("util"),
					txPower: read("tx-power")
				};
			});
		};
		const apWifi = await wifiOf("10.0.0.4");
		const coreWifi = await wifiOf("10.0.0.1");
		log(
			"A30 无线事实卡：AP 七项照实（SSID / 频段 / 信道 / 信号 / 终端 / 利用率 / 发射功率），非 AP 不画",
			apWifi.card && apWifi.ssid === "NMCPS-Lab" && apWifi.band === "5G" && apWifi.channel === "149"
			&& apWifi.dbm === "-52 dBm" && apWifi.clients === "12" && apWifi.util === "34%" && apWifi.txPower === "20 dBm"
			&& !coreWifi.card,
			`ap=${apWifi.ssid}/${apWifi.band}/${apWifi.channel}/${apWifi.dbm}/${apWifi.clients}/${apWifi.util}/${apWifi.txPower}`
			+ ` card=${apWifi.card} coreCard=${coreWifi.card}`
		);

		// A31：告警叠加（§6.1）。假上游回 8 条：5 条 firing 里 4 条挂 `10.0.0.1`、1 条挂 `10.0.0.4`，
		// 另有三条**不该落角标**的干扰项 —— 空 `target_id`（现网 77 条 firing 里 9 条如此）、
		// 不在画布上的 `10.9.9.9`、以及已 resolved 的 `10.0.0.2`（`status=firing` 由上游过滤）。
		// 断言「角标数 = 该节点 firing 条数」「页头读的是设备数与事件数两个不同的数」。
		await page.reload({ waitUntil: "networkidle" });
		await page.waitForTimeout(800);
		const alarmCanvas = await page.evaluate(() => {
			const byNode = {};
			for (const node of document.querySelectorAll("[data-testid='topology-node']")) {
				const badge = node.querySelector("[data-testid='topology-node-alarm']");
				if (badge)
					byNode[node.getAttribute("data-node-id") ?? ""] = Number(badge.getAttribute("data-alarm-count"));
			}
			const pageBadge = document.querySelector("[data-testid='topology-alarm-badge']");
			return {
				byNode,
				badges: Object.keys(byNode).length,
				badgeText: pageBadge?.textContent?.replace(/\s+/g, " ").trim() ?? "",
				events: Number(pageBadge?.getAttribute("data-alarm-events") ?? -1),
				nodes: Number(pageBadge?.getAttribute("data-alarm-nodes") ?? -1),
				stat: document.querySelector("[data-testid='topology-stat-alarms']")?.textContent?.replace(/\s+/g, " ").trim() ?? ""
			};
		});
		log(
			"A31 告警叠加：角标只挂 join 得上的两台（空 id / 图外 / 已恢复一概不落角标）",
			alarmCanvas.badges === 2 && alarmCanvas.byNode["10.0.0.1"] === 4 && alarmCanvas.byNode["10.0.0.4"] === 1
			&& alarmCanvas.events === 5 && alarmCanvas.nodes === 2
			&& alarmCanvas.badgeText.includes("5") && alarmCanvas.badgeText.includes("2")
			&& alarmCanvas.stat.includes("5"),
			`badges=${alarmCanvas.badges} byNode=${JSON.stringify(alarmCanvas.byNode)}`
			+ ` events=${alarmCanvas.events} nodes=${alarmCanvas.nodes} badge=${alarmCanvas.badgeText}`
		);

		// A31 续：详情栏列该节点的告警原文（严重度降序，前 3 条 + 「另有 1 条」），
		// 且**只**列这个节点的事件（把全网 5 条抄给每台设备就是编数据）。
		await page.evaluate(() => {
			const node = Array.from(document.querySelectorAll("[data-testid='topology-node']"))
				.find((el) => el.getAttribute("data-node-id") === "10.0.0.1");
			node?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		await page.waitForTimeout(400);
		const alarmCard = await page.evaluate(() => {
			const events = Array.from(document.querySelectorAll("[data-testid='topology-alarm-event']"));
			const card = document.querySelector("[data-testid='topology-alarm-card']");
			return {
				card: !!card,
				count: events.length,
				severities: events.map((el) => el.getAttribute("data-severity")),
				severity: document.querySelector("[data-testid='topology-alarm-severity']")?.textContent?.trim() ?? "",
				text: (card?.textContent ?? "").replace(/\s+/g, " ").trim()
			};
		});
		log(
			"A31 详情栏列该节点告警原文（严重度降序，前 3 条 + 「另有 1 条」）",
			alarmCard.card && alarmCard.count === 3 && alarmCard.severities[0] === "critical"
			&& alarmCard.severity === "严重"
			&& alarmCard.text.includes("CPU 使用率 92%") && alarmCard.text.includes("另有 1 条")
			&& !alarmCard.text.includes("干扰严重") && !alarmCard.text.includes("图外设备"),
			alarmCard.card ? `${alarmCard.count} 条 ${alarmCard.severities.join("/")} badge=${alarmCard.severity}` : "未出现告警卡片"
		);

		// A32：告警通道失败 ≠ 没有告警。上游回 `code=500` + 原话时，拓扑照常渲染、角标全摘，
		// 页头读数写「—」（不是 0），详情栏写「告警通道不可用：<上游原话>」而**不写**「该节点没有进行中的告警」。
		await fetch(`http://${HOST}:${upstreamPort}/__control/alarm-error`);
		await page.reload({ waitUntil: "networkidle" });
		await page.waitForTimeout(800);
		await page.evaluate(() => {
			const node = Array.from(document.querySelectorAll("[data-testid='topology-node']"))
				.find((el) => el.getAttribute("data-node-id") === "10.0.0.1");
			node?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		await page.waitForTimeout(400);
		const alarmDown = await page.evaluate(() => ({
			canvas: !!document.querySelector("[data-testid='topology-node']"),
			badges: document.querySelectorAll("[data-testid='topology-node-alarm']").length,
			badgeVisible: !!document.querySelector("[data-testid='topology-alarm-badge']"),
			stat: document.querySelector("[data-testid='topology-stat-alarms']")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
			unavailable: document.querySelector("[data-testid='topology-alarm-unavailable']")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
			card: (document.querySelector("[data-testid='topology-alarm-card']")?.textContent ?? "").replace(/\s+/g, " ").trim()
		}));
		log(
			"A32 告警通道失败：拓扑照常、角标摘掉、读数写「—」，写上游原话而不写「无告警」",
			alarmDown.canvas && alarmDown.badges === 0 && !alarmDown.badgeVisible
			&& alarmDown.stat.includes("—")
			&& alarmDown.unavailable.includes("告警通道不可用")
			&& alarmDown.unavailable.includes("alarm-db: connection timed out")
			&& !alarmDown.card.includes("该节点没有进行中的告警"),
			`badges=${alarmDown.badges} stat=${alarmDown.stat} unavailable=${alarmDown.unavailable}`
		);
		await fetch(`http://${HOST}:${upstreamPort}/__control/alarm-ok`);

		// A36 / A37：告警读表的两条兜底口径（§6.12 口径 ② 与「角标是读数不是报表」）。
		// `__control/alarm-flood` 换成一份极端样本：103 条挂在 `10.0.0.1`，其中一条 `severity` 是现网
		// 从未出现过的取值（`catastrophic`，实测只有 `critical` / `warning`）。两条断言各自钉一件事 ——
		// 角标数字必截成 `99+`（`data-alarm-count` 仍是真实条数）、未登记取值必须落到最低档 `info`
		// （`data-severity="info"`，不是 `critical`），且排在 warning 之后而不是插到最前。
		await fetch(`http://${HOST}:${upstreamPort}/__control/alarm-flood`);
		await page.reload({ waitUntil: "networkidle" });
		await page.waitForTimeout(800);
		const floodCanvas = await page.evaluate(() => {
			const badge = document.querySelector("[data-testid='topology-node'][data-node-id='10.0.0.1'] [data-testid='topology-node-alarm']");
			const pageBadge = document.querySelector("[data-testid='topology-alarm-badge']");
			return {
				count: Number(badge?.getAttribute("data-alarm-count") ?? -1),
				text: badge?.textContent?.replace(/\s+/g, " ").trim() ?? "",
				events: Number(pageBadge?.getAttribute("data-alarm-events") ?? -1),
				nodes: Number(pageBadge?.getAttribute("data-alarm-nodes") ?? -1)
			};
		});
		log(
			"A36 角标数字超 99 写 `99+`，`data-alarm-count` 仍是真实条数",
			floodCanvas.count === 103 && floodCanvas.text === "99+" && floodCanvas.events === 103 && floodCanvas.nodes === 1,
			`count=${floodCanvas.count} text=${floodCanvas.text} events=${floodCanvas.events} nodes=${floodCanvas.nodes}`
		);

		await page.evaluate(() => {
			const node = Array.from(document.querySelectorAll("[data-testid='topology-node']"))
				.find((el) => el.getAttribute("data-node-id") === "10.0.0.1");
			node?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		await page.waitForTimeout(400);
		const floodCard = await page.evaluate(() => {
			const events = Array.from(document.querySelectorAll("[data-testid='topology-alarm-event']"));
			return {
				card: !!document.querySelector("[data-testid='topology-alarm-card']"),
				badge: document.querySelector("[data-testid='topology-alarm-severity']")?.textContent?.trim() ?? "",
				count: events.length,
				severities: events.map((el) => el.getAttribute("data-severity") ?? ""),
				text: events.map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim()),
				hidden: (document.body.textContent ?? "").includes("另有 100 条未列出")
			};
		});
		log(
			"A37 未登记严重度落到最低档 `info`（不升级成 critical），排序仍在 warning 之后",
			floodCard.card && floodCard.badge === "严重" && floodCard.count === 3
			&& floodCard.severities.join(",") === "critical,warning,info"
			&& floodCard.text[2].includes("板卡温度异常") && floodCard.hidden,
			`badge=${floodCard.badge} severities=${floodCard.severities.join("/")} hidden100=${floodCard.hidden}`
		);
		await fetch(`http://${HOST}:${upstreamPort}/__control/alarm-flood-off`);

		await fetch(`http://${HOST}:${upstreamPort}/__control/topology-empty`);
		await page.reload({ waitUntil: "networkidle" });
		// 等「空态节点出现」而不是等固定毫秒：BFF 冷启动 / 机器过载时 400ms 可能还停在骨架屏上，
		// 那时 `empty` 与 `canvas` 同时为 false，红的是断言而不是实现（2026-11-10 实测一次误报）。
		// 超时不抛：真没出空态就让下面的断言带着 `empty=false` 报出来，失败原因仍指向页面。
		await page.waitForSelector("[data-testid='topology-empty']", { timeout: 10_000 }).catch(() => {});
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

		// A33：只看某个分组（§6.11）。聚焦是「只留」，与折叠的「摘掉」互补：画布只剩该组 3 台 + 组内 2 条链路，
		// 页头写明「只看 X」并给一键回到全部 —— 聚焦态下不给出口等于把人锁在图里。
		await page.reload({ waitUntil: "networkidle" });
		await page.waitForTimeout(800);
		const focusRead = () => page.evaluate(() => ({
			nodes: document.querySelectorAll("[data-testid='topology-node']").length,
			links: document.querySelectorAll("[data-link-key]").length,
			badge: document.querySelector("[data-testid='topology-focus-badge']")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
			clear: !!document.querySelector("[data-testid='topology-focus-clear']"),
			active: Array.from(document.querySelectorAll("[data-testid='topology-combo-focus']"))
				.filter((el) => el.getAttribute("data-focused") === "true")
				.map((el) => el.getAttribute("data-combo-id"))
		}));
		const focusBefore = await (async () => {
			await page.click("[data-testid='topology-groups-toggle']");
			await page.waitForTimeout(300);
			return focusRead();
		})();
		await page.click("[data-testid='topology-combo-focus'][data-combo-id='combo-edge']");
		await page.waitForTimeout(400);
		const focusOn = await focusRead();
		// 浮层开着时点画布上的「回到全部」只会先关浮层（那一击不会穿透）—— 先收起浮层
		await page.keyboard.press("Escape");
		await page.waitForTimeout(200);
		await page.click("[data-testid='topology-focus-clear']");
		await page.waitForTimeout(400);
		const focusOff = await focusRead();
		log(
			"A33 只看某个分组：画布只留该组节点与组内链路，页头标明范围并能一键回到全部",
			focusBefore.nodes === 6 && focusBefore.links === 6 && !focusBefore.clear && focusBefore.badge === ""
			&& focusOn.nodes === 3 && focusOn.links === 2 && focusOn.clear
			&& focusOn.badge.includes("只看") && focusOn.active.length === 1 && focusOn.active[0] === "combo-edge"
			&& focusOff.nodes === 6 && focusOff.links === 6 && !focusOff.clear && focusOff.badge === "",
			`before=${focusBefore.nodes}/${focusBefore.links} on=${focusOn.nodes}/${focusOn.links}`
			+ ` badge=${focusOn.badge} active=${focusOn.active.join(",")} off=${focusOff.nodes}/${focusOff.links}`
		);

		// A34：链路动作按钮在「没有仿真平台」时整组置灰并给原因（本例 BFF 没配仿真上游）。
		// 三个按钮都要在（一字排开才算「有这条能力」），一条都不许假装能点。
		await page.evaluate(() => {
			const link = Array.from(document.querySelectorAll("[data-link-key]"))
				.find((el) => /10\.0\.0\.1.+10\.0\.0\.2/.test(el.getAttribute("data-link-key") ?? ""));
			link?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		await page.waitForTimeout(400);
		const linkActions = await page.evaluate(() => {
			const buttons = Array.from(document.querySelectorAll("[data-testid='topology-link-action']"));
			return {
				actions: buttons.map((el) => el.getAttribute("data-action")),
				disabled: buttons.every((el) => el.hasAttribute("disabled")),
				labels: buttons.map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim()),
				card: (document.querySelector("[data-testid='topology-link-card']")?.textContent ?? "").replace(/\s+/g, " ").trim()
			};
		});
		log(
			"A34 链路动作：三个按钮齐备，租户没有实验实例时整组置灰并写明原因",
			linkActions.actions.length === 3 && linkActions.actions.join(",") === "down,up,toggle"
			&& linkActions.disabled
			&& linkActions.labels.join("|").includes("断开链路")
			&& linkActions.card.includes("实验通道未启用"),
			`actions=${linkActions.actions.join(",")} disabled=${linkActions.disabled} labels=${linkActions.labels.join("|")}`
		);

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

		const deviceProbe = await page.evaluate(() => {
			// 左栏行 = 主标识一行 + 次级信息一行（`NMCPS-ARCH-006` §3.6）：次级信息从「IP · 标识」
			// + 「CPU / 内存 / 端口」两行收成一行「管理 IP · 邻居 · 端口」，CPU / 内存只在右栏概览出。
			const selectedRow = document.querySelector("[data-testid='metric-device-row'][aria-selected='true']");
			const rowLines = Array.from(selectedRow?.querySelectorAll("p") ?? [])
				.map((line) => (line.textContent ?? "").replace(/\s+/g, " ").trim());
			// 工具栏口径（§4.4）：页签条 = `LayoutToolbarTabs`（pill，页签列表带 `bg-elevated`），
			// 读数徽标 = `LayoutToolbarBadge`（`md` = `text-xs`，不是行内那种 `text-[10px]` 的 `sm`）。
			const tabList = document.querySelector("[data-testid='device-detail-tabs'] [data-slot='list'], [data-testid='device-detail-tabs'] [role='tablist']");
			const tabCountBadge = document.querySelector("[data-testid='device-detail-tab-count']");
			const statusBadge = document.querySelector("[data-testid='device-detail-status']");
			const badgeClass = (element) => element?.className ?? "";
			return {
				rows: document.querySelectorAll("[data-testid='metric-device-row']").length,
				selected: selectedRow?.getAttribute("data-device-id") ?? "",
				rowLines,
				header: !!document.querySelector("[data-testid='device-detail-header']"),
				tabs: document.querySelectorAll("[data-testid='device-detail-tabs'] [role='tab']").length,
				tabCount: document.querySelector("[data-testid='device-detail-tab-count']")?.textContent?.trim() ?? "",
				overview: !!document.querySelector("[data-testid='device-detail-cpu']"),
				chart: !!document.querySelector("[data-testid='trend-chart']"),
				tabsPill: !!tabList && tabList.className.includes("bg-elevated"),
				badgesMd: [tabCountBadge, statusBadge].every((badge) => {
					const className = badgeClass(badge);
					return className.includes("text-xs") && !className.includes("text-[10px]");
				}),
				text: document.body.textContent ?? ""
			};
		});
		log(
			"A10 设备台账渲染 + 默认选中第一条（计数来自信封 total），行次级信息只一行（IP · 邻居 · 端口）",
			deviceProbe.rows === 3
			&& deviceProbe.selected === "DEV-CORE-1"
			&& deviceProbe.text.includes("共 3 台设备")
			&& deviceProbe.rowLines.length === 2
			&& deviceProbe.rowLines[1] === "10.0.0.2 · 邻居 2 · 端口 22/24",
			`rows=${deviceProbe.rows} selected=${deviceProbe.selected || "无"} 行=${JSON.stringify(deviceProbe.rowLines)}`
		);
		// 1.0 版式：记录标识（名称 / IP / 状态）在工具栏左区，页签 / 页签数 / 刷新在右区，默认停在概览；
		// 页签条是 pill 胶囊、读数徽标是 `md`（工具栏口径 §4.4，由 `LayoutToolbarTabs` / `LayoutToolbarBadge` 写死）
		log(
			"A10 设备详情为 1.0 版式（工具栏记录标识 + 7 页 Tab + 概览卡；页签 pill、徽标 md）",
			deviceProbe.header && deviceProbe.tabs === 7 && deviceProbe.tabCount.includes("7") && deviceProbe.overview && !deviceProbe.chart
			&& deviceProbe.tabsPill && deviceProbe.badgesMd,
			`header=${deviceProbe.header} tabs=${deviceProbe.tabs} 计数=${deviceProbe.tabCount || "无"} 概览=${deviceProbe.overview} 概览页有图=${deviceProbe.chart} pill=${deviceProbe.tabsPill} 徽标 md=${deviceProbe.badgesMd}`
		);

		await openDetailTab("图表");
		const deviceChartProbe = await page.evaluate(() => ({
			chart: !!document.querySelector("[data-testid='trend-chart']"),
			overview: !!document.querySelector("[data-testid='device-detail-cpu']")
		}));
		log(
			"A10 切到图表页后按 mgmt_ip 出 TrendChart",
			deviceChartProbe.chart
			&& !deviceChartProbe.overview
			&& metricRequests.some((url) => url.includes("/api/metric/datapoint") && url.includes("mgmt_ip=10.0.0.2")),
			deviceChartProbe.chart ? "已出图" : "无 [data-testid='trend-chart']"
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

		// A10q：目录的真实字段名是 `data_type`（`hw_board_name` 那条样本），**不是** `metric_type`。
		// 只认 `metric_type` 会让这条 `string` 指标按 §8.3 第 3 条落成 `numeric` 混进选项，
		// 用户选中它就得到一条恒 1 的直线（2026-11-08 真实上游的路由器正是这样）。
		const textMetricLeaked = pickerOptions.some((item) => item.includes("Board name") || item.includes("hw_board_name"));
		log(
			"A10q 目录按实测字段名（data_type）判类型：string 指标不进选择器",
			pickerOptions.length > 0 && !textMetricLeaked,
			textMetricLeaked ? "hw_board_name 混进了选项" : `选项 ${pickerOptions.length} 条，无 string 指标`
		);

		// A10p：**名字清单为空**（§七 实测 24/36 台）不再等于「没有可画的指标」——
		// 候选交给 §8.6 的并集（目录里的 numeric 条目），选择器可用 + 提示一句，图表照常出。
		await fetch(`http://${HOST}:${upstreamPort}/__control/names-empty`);
		await page.goto(`${BASE_URL}/topology/device-metrics?id=DEV-CORE-1`, { waitUntil: "networkidle" });
		await page.waitForTimeout(1_200);
		await openDetailTab("图表");
		const emptyNamesProbe = await page.evaluate(() => {
			const picker = document.querySelector("[data-testid='metric-picker']");
			return {
				notice: document.querySelector("[data-testid='metric-name-list-empty']")?.textContent ?? "",
				disabled: picker ? picker.hasAttribute("disabled") || picker.getAttribute("aria-disabled") === "true" : null,
				chart: !!document.querySelector("[data-testid='trend-chart']"),
				picked: picker?.textContent?.trim().slice(0, 40) ?? ""
			};
		});
		await page.locator("[data-testid='metric-picker']").click();
		await page.waitForTimeout(400);
		const emptyNamesOptions = await page.evaluate(() =>
			Array.from(document.querySelectorAll("[role='option']")).map((el) => el.textContent?.trim() ?? ""));
		await page.keyboard.press("Escape");
		await page.waitForTimeout(200);
		await fetch(`http://${HOST}:${upstreamPort}/__control/names-ok`);
		// 左栏台账行同样是 `role="option"`（含 `·` 分隔），只留下拉里的条目
		const emptyNamesPicker = emptyNamesOptions.filter((item) => !item.includes("·"));
		log(
			"A10p 名清单为空时候选来自目录（选择器可用 + 提示一句 + 照常出图）",
			emptyNamesProbe.disabled === false
			&& emptyNamesProbe.notice.includes("指标目录")
			&& emptyNamesProbe.chart
			&& emptyNamesPicker.some((item) => item.includes("Interface in octets"))
			&& emptyNamesPicker.some((item) => item.includes("CPU utilization")),
			`disabled=${emptyNamesProbe.disabled} 提示=${emptyNamesProbe.notice ? "有" : "无"} 选中=${emptyNamesProbe.picked || "无"} 图=${emptyNamesProbe.chart} 选项=${emptyNamesPicker.join(" | ") || "无"}`
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

		const linkShell = await page.evaluate(() => {
			// 左栏行（`NMCPS-ARCH-006` §3.6）：标题 = 两端**设备名**（端点只有 `device_code`，
			// 名字靠 `/metric/device` 的 `sys_name` 反查），次级信息 = 两端 `接口名:管理 IP`。
			const firstRow = document.querySelector("[data-testid='metric-link-row']");
			const firstLines = Array.from(firstRow?.querySelectorAll("p") ?? [])
				.map((line) => (line.textContent ?? "").replace(/\s+/g, " ").trim());
			// 工具栏口径（§4.4）：页签条 pill（列表带 `bg-elevated`）、读数徽标 `md`（`text-xs`）
			const tabList = document.querySelector("[data-testid='link-detail-tabs'] [data-slot='list'], [data-testid='link-detail-tabs'] [role='tablist']");
			const tabCountBadge = document.querySelector("[data-testid='link-detail-tab-count']");
			const statusBadge = document.querySelector("[data-testid='link-detail-status']");
			return {
				rows: document.querySelectorAll("[data-testid='metric-link-row']").length,
				selected: document.querySelector("[data-testid='metric-link-row'][aria-selected='true']")?.getAttribute("data-link-id") ?? "",
				firstLines,
				header: !!document.querySelector("[data-testid='link-detail-header']"),
				tabs: document.querySelectorAll("[data-testid='link-detail-tabs'] [role='tab']").length,
				overview: !!document.querySelector("[data-testid='link-detail-id']"),
				chart: !!document.querySelector("[data-testid='trend-chart']"),
				tabsPill: !!tabList && tabList.className.includes("bg-elevated"),
				badgesMd: [tabCountBadge, statusBadge].every((badge) => {
					const className = badge?.className ?? "";
					return className.includes("text-xs") && !className.includes("text-[10px]");
				}),
				text: document.body.textContent ?? ""
			};
		});
		log(
			"A12 链路台账渲染当前值（设备名 → 设备名 / 接口:管理 IP）+ 右栏概览出利用率与时延",
			linkShell.rows === 2
			&& linkShell.text.includes("共 2 条链路")
			&& linkShell.firstLines.length === 2
			&& linkShell.firstLines[0] === "核心路由器-1 → 接入交换机-1"
			&& linkShell.firstLines[1] === "GE0/0/1:10.0.0.2 → GE1/0/1:10.0.0.3"
			&& linkShell.text.includes("32.5%")
			&& linkShell.text.includes("1.2 ms"),
			`rows=${linkShell.rows} selected=${linkShell.selected || "无"} 行=${JSON.stringify(linkShell.firstLines)}`
		);
		// 1.0 版式同样落在链路页：两端 → 标识 / 状态在工具栏左区，页签 / 页签数 / 刷新在右区，默认概览；
		// 页签条 pill、读数徽标 `md`（与设备页同一口径，§4.4）
		log(
			"A12 链路详情为 1.0 版式（6 页 Tab + 概览卡，默认不出图；页签 pill、徽标 md）",
			linkShell.header && linkShell.tabs === 6 && linkShell.overview && !linkShell.chart
			&& linkShell.tabsPill && linkShell.badgesMd,
			`header=${linkShell.header} tabs=${linkShell.tabs} 概览=${linkShell.overview} 概览页有图=${linkShell.chart} pill=${linkShell.tabsPill} 徽标 md=${linkShell.badgesMd}`
		);

		await openDetailTab("图表");
		const linkProbe = await page.evaluate(() => ({
			selected: document.querySelector("[data-testid='metric-link-row'][aria-selected='true']")?.getAttribute("data-link-id") ?? "",
			chart: !!document.querySelector("[data-testid='trend-chart']"),
			seriesIfIndex: document.querySelector("[data-testid='metric-trend']")?.getAttribute("data-series-if-index") ?? "",
			seriesCount: document.querySelector("[data-testid='metric-trend']")?.getAttribute("data-series-count") ?? "",
			text: document.body.textContent ?? ""
		}));

		const linkIndex = metricRequests.find((url) => url.includes("/api/metric/device") && url.includes("page_size=200")) ?? "";
		const linkDatapoint = metricRequests.filter((url) => url.includes("/api/metric/datapoint")).at(-1) ?? "";
		log(
			"A12 链路折线取 source 端设备 IP（device_code → mgmt_ip 反查）",
			linkProbe.selected === "DEV-CORE-1:GE0/0/1--DEV-ACC-1:GE1/0/1"
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
		await page.locator("[data-link-id='DEV-AP-1:WLAN-0--DEV-CORE-1:GE0/0/9']").click();
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

		// A10b：设备详情「接口列表」页 —— 2.0 没有端口清单端点，逐端口表只能按 `ifIndex` 分组派生：
		// 两个方向都不选时只说怎么用（外加缺口卡）；选定后端口行来自入向指标，设备级（无 `ifIndex`）组排在末尾并如实标注。
		await page.goto(`${BASE_URL}/topology/device-metrics`, { waitUntil: "networkidle" });
		await page.waitForTimeout(1_200);
		await openDetailTab("接口列表");
		const interfaceHint = await page.evaluate(() => ({
			hint: !!document.querySelector("[data-testid='interface-hint']"),
			table: !!document.querySelector("[data-testid='interface-table']"),
			gap: !!document.querySelector("[data-testid='telemetry-gap']")
		}));
		log(
			"A10b 接口列表页未选方向时只给用法说明 + 缺口卡（不出空表）",
			interfaceHint.hint && !interfaceHint.table && interfaceHint.gap,
			`hint=${interfaceHint.hint} table=${interfaceHint.table} gap=${interfaceHint.gap}`
		);

		await page.locator("[data-testid='interface-inbound-picker']").click();
		await page.waitForTimeout(400);
		await page.getByRole("option", { name: /Interface in octets/ }).first().click();
		await page.waitForTimeout(400);
		await page.locator("[data-testid='interface-outbound-picker']").click();
		await page.waitForTimeout(400);
		await page.getByRole("option", { name: /CPU utilization/ }).first().click();
		await page.waitForTimeout(1_500);
		const interfaceProbe = await page.evaluate(() => {
			const table = document.querySelector("[data-testid='interface-table']");
			const rows = Array.from(table?.querySelectorAll("tbody tr") ?? []);
			return {
				table: !!table,
				rows: rows.length,
				last: rows.at(-1)?.textContent ?? "",
				count: document.querySelector("[data-testid='interface-row-count']")?.textContent?.trim() ?? "",
				error: !!document.querySelector("[data-testid='interface-error']")
			};
		});
		log(
			"A10c 选定两个方向后按 ifIndex 出端口表（设备级组排在末尾并标注）",
			interfaceProbe.table
			&& interfaceProbe.rows === 3
			&& interfaceProbe.count.includes("3")
			&& interfaceProbe.last.includes("设备级")
			&& !interfaceProbe.error,
			`rows=${interfaceProbe.rows} 计数=${interfaceProbe.count || "无"} 末行=${interfaceProbe.last.trim().slice(0, 40) || "无"}`
		);

		// A10b 补充：接口列表页顶部先列**上游端口清单**（`/metric/device` 的 `lldp.ports`）——
		// 「2.0 没有端口清单」是错的，缺的是逐端口的状态 / 速率 / 计数。
		const lldpPortCount = await page.evaluate(() =>
			document.querySelectorAll("[data-testid='interface-lldp-ports'] tbody tr").length);
		log(
			"A10b 接口列表页先列上游端口清单（lldp.ports）",
			lldpPortCount === 2,
			`端口清单行数=${lldpPortCount}`
		);

		// A10d：概览页按实测响应出「系统信息 / 硬件 / 邻居」三卡 —— 这些字段就在 `/metric/device` 里
		await openDetailTab("概览");
		const overviewExtras = await page.evaluate(() => ({
			descr: document.querySelector("[data-testid='device-detail-descr']")?.textContent?.trim() ?? "",
			text: document.querySelector("[data-testid='device-detail-body']")?.textContent ?? ""
		}));
		log(
			"A10d 概览页出系统信息 / 硬件 / 邻居（sys_* 与 neighbors 是真来源）",
			overviewExtras.descr.includes("Core Router")
			&& overviewExtras.text.includes("机房 A-01")
			&& overviewExtras.text.includes("接入交换机-1 · 无线AP-1")
			&& overviewExtras.text.includes("VLAN 数"),
			`描述=${overviewExtras.descr.slice(0, 24) || "无"}`
		);

		// A10e：协议页出真实计数器（DEV-CORE-1 的 tcp.retrans_segs=487114、ip 组整组 null）
		await openDetailTab("协议");
		const protocolProbe = await page.evaluate(() => ({
			ip: document.querySelector("[data-testid='device-protocol-ip']")?.textContent ?? "",
			tcp: document.querySelector("[data-testid='device-protocol-tcp']")?.textContent ?? "",
			gapTabs: Array.from(document.querySelectorAll("[data-testid='telemetry-gap']"))
				.map((element) => element.getAttribute("data-gap-tab"))
		}));
		// `formatCount` 走 `toLocaleString("en-US")`：487114 → `487,114`，断言按千分位写
		log(
			"A10e 协议页出真实计数器（IP 组 null 显 —，TCP retrans_segs 有值），缺口只到 OSPF/BGP 邻居表",
			protocolProbe.tcp.includes("487,114")
			&& (protocolProbe.ip.match(/—/g) ?? []).length >= 4
			&& protocolProbe.gapTabs.join(",") === "protocolStack",
			`缺口页=${protocolProbe.gapTabs.join(",") || "无"}`
		);

		// A10f：DEV-CORE-1 的 `radio` 是 null ⇒ 射频页说明「上游没给 radio 块」，不画空表
		await openDetailTab("射频");
		const radioAbsent = await page.evaluate(() => ({
			tabs: Array.from(document.querySelectorAll("[data-testid='telemetry-gap']"))
				.map((element) => element.getAttribute("data-gap-tab")),
			table: !!document.querySelector("[data-testid='device-radio-associations']")
		}));
		log(
			"A10f 非无线设备（radio=null）的射频页如实说明没给，不出空表",
			radioAbsent.tabs.includes("radio") && !radioAbsent.table,
			`缺口页=${radioAbsent.tabs.join(",") || "无"} 关联表=${radioAbsent.table}`
		);

		// A10g：切到 DEV-AP-1（radio 有值）⇒ 信道 / 关联客户端表照实出数
		await page.locator("[data-device-id='DEV-AP-1']").click();
		await page.waitForTimeout(900);
		const radioProbe = await page.evaluate(() => {
			const rows = Array.from(document.querySelectorAll("[data-testid='device-radio-associations'] tbody tr"));
			return {
				channel: document.querySelector("[data-testid='device-radio-channel']")?.textContent?.trim() ?? "",
				rows: rows.length,
				first: rows[0]?.textContent ?? "",
				gap: !!document.querySelector("[data-gap-tab='radio']")
			};
		});
		log(
			"A10g 无线设备的射频页出信道与关联客户端（一条 assoc 行）",
			radioProbe.channel === "36" && radioProbe.rows === 1 && radioProbe.first.includes("单链路终端-1") && radioProbe.first.includes("-45") && !radioProbe.gap,
			`信道=${radioProbe.channel || "无"} 关联行=${radioProbe.rows}`
		);

		// A10j：实测 `radio` 还有 MLO 从链路（`multilinks[]`）、对端 AP 与四个数值枚举 —— 之前整块被丢弃，
		// 这一页只能看到 SSID / 信道。断言「多链路表 1 行 + 对端 AP 名 + 角色 / BSS 类型照实」。
		const radioExtra = await page.evaluate(() => {
			const rows = Array.from(document.querySelectorAll("[data-testid='device-radio-multilinks'] tbody tr"));
			return {
				rows: rows.length,
				first: rows[0]?.textContent ?? "",
				peer: document.querySelector("[data-testid='device-radio-peer-ap']")?.textContent?.trim() ?? "",
				text: document.querySelector("[data-testid='device-detail-body']")?.textContent ?? ""
			};
		});
		log(
			"A10j 射频页出 MLO 多链路表与对端 AP（role / bss_type / 功率管理原样数值）",
			radioExtra.rows === 1
			&& radioExtra.first.includes("02:00:00:00:09:00")
			&& radioExtra.peer === "n10"
			&& radioExtra.text.includes("BSS 类型")
			&& radioExtra.text.includes("功率管理"),
			`多链行=${radioExtra.rows} 对端AP=${radioExtra.peer || "无"}`
		);

		// A10h：DEV-AP-1 的 `lldp` 是 null（没上报，不是失败）⇒ 缺口卡；DEV-CORE-1 才有端口与邻居表
		await openDetailTab("LLDP");
		const lldpAbsent = await page.evaluate(() => ({
			gap: !!document.querySelector("[data-gap-tab='lldp']"),
			ports: document.querySelectorAll("[data-testid='device-lldp-ports'] tbody tr").length
		}));
		log(
			"A10h lldp 为 null 的设备只说明「没上报 LLDP」，不出端口表",
			lldpAbsent.gap && lldpAbsent.ports === 0,
			`缺口=${lldpAbsent.gap} 端口行=${lldpAbsent.ports}`
		);

		await page.locator("[data-device-id='DEV-CORE-1']").click();
		await page.waitForTimeout(900);
		const lldpProbe = await page.evaluate(() => {
			const rows = Array.from(document.querySelectorAll("[data-testid='device-lldp-neighbors'] tbody tr"));
			return {
				ports: document.querySelectorAll("[data-testid='device-lldp-ports'] tbody tr").length,
				rows: rows.length,
				first: rows[0]?.textContent ?? "",
				gap: !!document.querySelector("[data-gap-tab='lldp']")
			};
		});
		log(
			"A10h LLDP 页列本机端口 2 条 + 邻居 1 条，且邻居的本机端口按 port_num 反查成端口名",
			lldpProbe.ports === 2 && lldpProbe.rows === 1 && lldpProbe.first.includes("n10-eth2") && lldpProbe.first.includes("n4-eth5") && !lldpProbe.gap,
			`端口行=${lldpProbe.ports} 邻居行=${lldpProbe.rows} 首个邻居=${lldpProbe.first.trim().slice(0, 40) || "无"}`
		);

		// A10k：实测 `lldp.man_addr` 与邻居的 `man_addr` / `sys_desc` 都在 —— 之前整列被丢掉，
		// 于是「对端是谁、怎么连过去」只能靠 sys_name 猜。断言本机地址一行 + 邻居行里的对端地址。
		const lldpManAddr = await page.evaluate(() => ({
			local: document.querySelector("[data-testid='device-lldp-man-addr']")?.textContent?.trim() ?? "",
			first: document.querySelector("[data-testid='device-lldp-neighbors'] tbody tr")?.textContent ?? ""
		}));
		log(
			"A10k LLDP 页给本机管理地址与邻居的对端管理地址 / 系统描述",
			lldpManAddr.local === "10.0.0.2"
			&& lldpManAddr.first.includes("10.0.0.249")
			&& lldpManAddr.first.includes("Ubuntu 22.04.5"),
			`本机=${lldpManAddr.local || "无"} 邻居含对端地址=${lldpManAddr.first.includes("10.0.0.249")}`
		);

		// A10l：`hw.entities[]` 实测只有交换机报（36 台里 9 台），此前只数了条数、丢掉板名 /
		// 型号 / 两个状态。断言概览页把实体表画出来（板名照实、状态原样数值）。
		await openDetailTab("概览");
		const hwEntityProbe = await page.evaluate(() => {
			const rows = Array.from(document.querySelectorAll("[data-testid='device-hw-entities'] tbody tr"));
			return { rows: rows.length, first: rows[0]?.textContent ?? "" };
		});
		log(
			"A10l 概览页把 hw.entities 画成硬件实体表（板名 / 型号 / 两个状态数值）",
			hwEntityProbe.rows === 1
			&& hwEntityProbe.first.includes("CloudEngine S5735-L24P4X-A1")
			&& hwEntityProbe.first.includes("4")
			&& hwEntityProbe.first.includes("3"),
			`实体行=${hwEntityProbe.rows} 首行=${hwEntityProbe.first.trim().slice(0, 40) || "无"}`
		);

		await openDetailTab("数据质量");
		const deviceQualityProbe = await page.evaluate(() => ({
			latency: document.querySelector("[data-testid='device-quality-latency']")?.textContent?.trim() ?? "",
			text: document.querySelector("[data-testid='device-detail-body']")?.textContent ?? "",
			gapTabs: Array.from(document.querySelectorAll("[data-testid='telemetry-gap']"))
				.map((element) => element.getAttribute("data-gap-tab"))
		}));
		log(
			"A10i 数据质量页出探针侧质量与质量标记（时延 µs、丢包比 0 ppm、job_mixed 置位）",
			deviceQualityProbe.latency.includes("16,850")
			&& deviceQualityProbe.text.includes("0 ppm")
			&& deviceQualityProbe.text.includes("job_mixed")
			&& deviceQualityProbe.gapTabs.join(",") === "dataQualityProbe",
			`时延=${deviceQualityProbe.latency || "无"} 缺口页=${deviceQualityProbe.gapTabs.join(",") || "无"}`
		);

		// A10m：实测 `/metric/datapoint?metric_code=simIfaceInKbps` 的序列标签是 `simIfaceMetricIndex`
		// （不是 `ifIndex`）。只认 `ifIndex` 时整页只剩「设备级」一行 ⇒ 断言分组认这个兜底、出三个端口。
		await openDetailTab("接口列表");
		await page.locator("[data-testid='interface-inbound-picker']").click();
		await page.waitForTimeout(400);
		await page.getByRole("option", { name: /Sim interface in Kbps/ }).first().click();
		await page.waitForTimeout(1_500);
		const simIfaceProbe = await page.evaluate(() => {
			const rows = Array.from(document.querySelectorAll("[data-testid='interface-table'] tbody tr"));
			return {
				rows: rows.length,
				ports: rows.map((row) => row.querySelector("td")?.textContent?.trim() ?? ""),
				count: document.querySelector("[data-testid='interface-row-count']")?.textContent?.trim() ?? ""
			};
		});
		log(
			"A10m 端口维度认 simIfaceMetricIndex 兜底（3 个索引出 3 行，不塌成设备级 1 行）",
			simIfaceProbe.rows === 3
			&& simIfaceProbe.count.includes("3")
			&& simIfaceProbe.ports.join(",") === "2,3,4",
			`rows=${simIfaceProbe.rows} 计数=${simIfaceProbe.count || "无"} 端口=${simIfaceProbe.ports.join(",") || "无"}`
		);

		// A10n：1.0 版式的两行都在右栏内自建 —— 第一行左区（名称 · 管理 IP · 状态）、第二行（7 页签）
		// 与第一行右区（页签数 + 刷新）本轮全部上内容页工具栏：左区出记录标识、右区出页签 / 页签数 / 刷新。
		// 断言两侧同时成立 —— 工具栏真有这几件东西（且与左栏选中行是同一条），右栏内零 header / 零页签（§4.5）。
		const toolbarProbe = await page.evaluate(() => {
			const left = document.getElementById("app-toolbar-left");
			const right = document.getElementById("app-toolbar-right");
			const body = document.querySelector("[data-testid='device-detail-body']");
			const row = document.querySelector("[data-testid='metric-device-row'][aria-selected='true']");
			return {
				rowId: row?.getAttribute("data-device-id") ?? "",
				rowName: row?.querySelector("p")?.textContent?.trim() ?? "",
				rowIp: row?.querySelector(".font-mono")?.textContent?.split("·")[0]?.trim() ?? "",
				name: left?.querySelector("[data-testid='device-detail-name']")?.textContent?.trim() ?? "",
				ip: left?.querySelector("[data-testid='device-detail-header'] span")?.textContent?.trim() ?? "",
				status: left?.querySelector("[data-testid='device-detail-status']")?.textContent?.trim() ?? "",
				tabs: right?.querySelectorAll("[data-testid='device-detail-tabs'] [role='tab']").length ?? -1,
				count: right?.querySelector("[data-testid='device-detail-tab-count']")?.textContent?.trim() ?? "",
				refresh: !!right?.querySelector("[data-testid='device-detail-refresh']"),
				bodyHeader: body?.querySelectorAll("header").length ?? -1,
				bodyTabs: body?.querySelectorAll("[role='tab']").length ?? -1
			};
		});
		log(
			"A10n 记录标识在工具栏左区、7 页签 + 页签数 + 刷新在右区，右栏内零 header / 零页签",
			!!toolbarProbe.rowId
			&& toolbarProbe.name === toolbarProbe.rowName
			&& toolbarProbe.name.length > 0
			&& toolbarProbe.ip === toolbarProbe.rowIp
			&& toolbarProbe.status === "online"
			&& toolbarProbe.tabs === 7
			&& toolbarProbe.count.includes("7")
			&& toolbarProbe.refresh
			&& toolbarProbe.bodyHeader === 0
			&& toolbarProbe.bodyTabs === 0,
			`选中=${toolbarProbe.rowId || "无"} 工具栏名称=${toolbarProbe.name || "无"} IP=${toolbarProbe.ip || "无"} 状态=${toolbarProbe.status || "无"} 页签=${toolbarProbe.tabs} 计数=${toolbarProbe.count || "无"} 刷新=${toolbarProbe.refresh} 栏内 header=${toolbarProbe.bodyHeader} 栏内页签=${toolbarProbe.bodyTabs}`
		);

		// A10o：工具栏宽度不够时页签折叠成 `UDropdownMenu`（§4.4，断点与页面的 `compactToolbar` 同源）：
		// 页签条消失、按钮写着当前页、菜单仍列 7 项，选中另一页后按钮文案跟着变、右栏内容真的换页。
		await page.setViewportSize({ width: 1180, height: 900 });
		await page.waitForTimeout(700);
		const collapsedProbe = await page.evaluate(() => ({
			menu: !!document.querySelector("[data-testid='device-detail-tabs-menu']"),
			tabs: document.querySelectorAll("[data-testid='device-detail-tabs'] [role='tab']").length,
			label: document.querySelector("[data-testid='device-detail-tabs-menu']")?.textContent?.trim() ?? ""
		}));
		await page.locator("[data-testid='device-detail-tabs-menu']").click();
		await page.waitForTimeout(500);
		const menuItems = await page.evaluate(() =>
			document.querySelectorAll("[role='menuitemcheckbox'], [role='menuitem']").length);
		await page.getByRole("menuitemcheckbox", { name: "LLDP" }).first().click();
		await page.waitForTimeout(1_000);
		const afterPick = await page.evaluate(() => ({
			label: document.querySelector("[data-testid='device-detail-tabs-menu']")?.textContent?.trim() ?? "",
			neighbors: !!document.querySelector("[data-testid='device-lldp-neighbors']")
		}));
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.waitForTimeout(700);
		log(
			"A10o 窄屏把 7 页签折叠成下拉（页签条消失、菜单 7 项、选中即换页）",
			collapsedProbe.menu
			&& collapsedProbe.tabs === 0
			&& collapsedProbe.label === "接口列表"
			&& menuItems === 7
			&& afterPick.label === "LLDP"
			&& afterPick.neighbors,
			`折叠=${collapsedProbe.menu} 页签条=${collapsedProbe.tabs} 按钮=${collapsedProbe.label || "无"} 菜单项=${menuItems} 选后=${afterPick.label || "无"} LLDP 表=${afterPick.neighbors}`
		);

		// 端点对比给两端字段表、错误统计 / 链路质量给比率 / 时延并列出 2.0 缺哪些计数。
		await page.goto(`${BASE_URL}/topology/link-metrics`, { waitUntil: "networkidle" });
		await page.waitForTimeout(1_200);
		await openDetailTab("端点对比");
		const endpointProbe = await page.evaluate(() => {
			const table = document.querySelector("[data-testid='link-endpoint-compare']");
			return { table: !!table, text: table?.textContent ?? "" };
		});
		log(
			"A12b 端点对比页给出两端字段表（oper_status 只显示数值、不猜 up / down）",
			endpointProbe.table && endpointProbe.text.includes("操作状态") && endpointProbe.text.includes("DEV-CORE-1"),
			endpointProbe.table ? "已出表" : "无 [data-testid='link-endpoint-compare']"
		);

		await openDetailTab("错误统计");
		const errorsProbe = await page.evaluate(() => ({
			rate: document.querySelector("[data-testid='link-error-rate']")?.textContent ?? "",
			loss: document.querySelector("[data-testid='link-loss']")?.textContent ?? "",
			gap: document.querySelector("[data-testid='telemetry-gap']")?.textContent ?? ""
		}));
		// 假上游只给 `packet_loss_percent: 0`、**没有** `error_rate_percent` ⇒ 一个显示 `0.0000%`、
		// 一个必须是 `—`（缺字段不写 0），缺口卡同时列出 2.0 缺的计数端点。
		log(
			"A12c 错误统计页：缺的字段显示 —、有的字段按 4 位小数，缺口卡列出计数",
			errorsProbe.rate.includes("—")
			&& errorsProbe.loss.includes("0.0000%")
			&& errorsProbe.gap.includes("ifInCrcErrors"),
			`rate=${errorsProbe.rate.trim() || "无"} loss=${errorsProbe.loss.trim() || "无"} gap=${errorsProbe.gap ? "有" : "无"}`
		);

		// A12e：实测 `/metric/link` 的 `metrics` 逐条都有计数（in/out errors、discards、unknown protos、
		// qlen、单播包）—— 把它们写成「2.0 没有端点」是误判。断言这些值照实上屏。
		const counterProbe = await page.evaluate(() => ({
			outErrors: document.querySelector("[data-testid='link-in-errors']")?.textContent?.trim() ?? "",
			ucast: document.querySelector("[data-testid='link-in-ucast']")?.textContent?.trim() ?? "",
			text: document.querySelector("[data-testid='link-detail-body']")?.textContent ?? ""
		}));
		log(
			"A12e 错误统计页照实出报文计数（out_errors=2 / out_discards=3 / out_qlen=4 / in_ucast=103）",
			counterProbe.outErrors === "0"
			&& counterProbe.ucast === "103"
			&& counterProbe.text.includes("3")
			&& counterProbe.text.includes("发送队列长度"),
			`in_errors=${counterProbe.outErrors || "无"} in_ucast=${counterProbe.ucast || "无"}`
		);

		await openDetailTab("链路质量");
		const qualityProbe = await page.evaluate(() => ({
			latency: document.querySelector("[data-testid='link-latency']")?.textContent ?? "",
			peer: document.querySelector("[data-testid='link-probe-peer']")?.textContent?.trim() ?? "",
			gap: document.querySelector("[data-testid='telemetry-gap']")?.textContent ?? ""
		}));
		log(
			"A12d 链路质量页给时延 + 报文计数缺口",
			qualityProbe.latency.includes("ms") && qualityProbe.gap.includes("packets.retransmit"),
			`latency=${qualityProbe.latency.trim() || "无"} gap=${qualityProbe.gap ? "有" : "无"}`
		);

		// A12f：探针侧三个字段（probe_peer / probe_dir / rtt_mdev_us）与四个新鲜度都在实测响应里，
		// 断言对端名与 rtt µs 照实、时延新鲜度按秒给出（不换算成「x 分钟前」）。
		const probeSide = await page.evaluate(() => ({
			text: document.querySelector("[data-testid='link-detail-body']")?.textContent ?? ""
		}));
		log(
			"A12f 链路质量页给探针侧与新鲜度（probe_peer=n7、rtt 8 µs、时延新鲜度 49 s）",
			qualityProbe.peer === "n7"
			&& probeSide.text.includes("8 µs")
			&& probeSide.text.includes("49 s")
			&& probeSide.text.includes("探针侧"),
			`probe_peer=${qualityProbe.peer || "无"}`
		);

		// A12g：链路页与设备页同一版式 —— 两端标识在工具栏左区、6 页签 + 页签数 + 刷新在右区，
		// 右栏内零 header / 零页签（§4.5）。链路的两端文案与 `link_id` 都按上游原样，不在这里改写。
		const linkToolbar = await page.evaluate(() => {
			const left = document.getElementById("app-toolbar-left");
			const right = document.getElementById("app-toolbar-right");
			const body = document.querySelector("[data-testid='link-detail-body']");
			return {
				name: left?.querySelector("[data-testid='link-detail-name']")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
				id: left?.querySelector("[data-testid='link-detail-header'] span")?.textContent?.trim() ?? "",
				status: left?.querySelector("[data-testid='link-detail-status']")?.textContent?.trim() ?? "",
				tabs: right?.querySelectorAll("[data-testid='link-detail-tabs'] [role='tab']").length ?? -1,
				count: right?.querySelector("[data-testid='link-detail-tab-count']")?.textContent?.trim() ?? "",
				refresh: !!right?.querySelector("[data-testid='link-detail-refresh']"),
				bodyHeader: body?.querySelectorAll("header").length ?? -1,
				bodyTabs: body?.querySelectorAll("[role='tab']").length ?? -1
			};
		});
		log(
			"A12g 链路页同版式：两端标识在左区、6 页签 + 页签数 + 刷新在右区，右栏内零 header",
			linkToolbar.name.includes("→")
			&& linkToolbar.id.includes("--")
			&& linkToolbar.status === "up"
			&& linkToolbar.tabs === 6
			&& linkToolbar.count.includes("6")
			&& linkToolbar.refresh
			&& linkToolbar.bodyHeader === 0
			&& linkToolbar.bodyTabs === 0,
			`两端=${linkToolbar.name || "无"} 标识=${linkToolbar.id || "无"} 状态=${linkToolbar.status || "无"} 页签=${linkToolbar.tabs} 计数=${linkToolbar.count || "无"} 刷新=${linkToolbar.refresh} 栏内 header=${linkToolbar.bodyHeader} 栏内页签=${linkToolbar.bodyTabs}`
		);

		// A13：上游**回了信封但业务失败**（HTTP 200 + `code !== 0`，§6.7）—— 页面必须逐字给出上游原话
		// 并给重试，且不能把失败画成「该时间窗内无采集数据」（空态是「没数据」，失败是「取不到」，两回事）。
		// 这里用 `__control/metric-error` 而不是 `__control/down`：后者断的是网络错误下的 stale 分支。
		await fetch(`http://${HOST}:${upstreamPort}/__control/metric-error`);
		// 整页重开而不是在原地切链路：切链路会复用同一个面板实例，上一台设备留下的点会走到 stale 分支，
		// 断言的就不是「纯失败态」了。
		await page.goto(`${BASE_URL}/topology/link-metrics`, { waitUntil: "networkidle" });
		await page.waitForTimeout(1_200);
		// 折线在「图表」页：失败语义要落在面板上，先切过去
		await openDetailTab("图表");

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

		// A14：同一个共用面板挂到**设备页**（`/topology/device-metrics`）时，失败语义不能因为换页退回空态。
		// 设备页要先选一台设备才出面板：点第一行带管理 IP 的台账行（`/metric/device` 与取数无关）。
		// 上面 A13 的反向断言把开关恢复成 ok 了，这里重新打开 —— 失败语义要在三个入口上都成立。
		await fetch(`http://${HOST}:${upstreamPort}/__control/metric-error`);
		await page.goto(`${BASE_URL}/topology/device-metrics`, { waitUntil: "networkidle" });
		await page.waitForTimeout(1_000);
		const pickedRow = await page.evaluate(() => {
			const rows = Array.from(document.querySelectorAll("[data-testid='metric-device-row']"));
			const row = rows.find((el) => (el.textContent ?? "").includes("·") && !/\u2014 \u00B7/.test(el.textContent ?? ""));
			row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			return row?.getAttribute("data-device-id") ?? null;
		});
		await page.waitForTimeout(1_500);
		await openDetailTab("图表");
		const deviceFailProbe = await page.evaluate(() => {
			const box = document.querySelector("[data-testid='metric-trend-error']");
			return {
				box: !!box,
				text: box?.textContent ?? "",
				chart: !!document.querySelector("[data-testid='metric-trend']"),
				page: document.body.textContent ?? ""
			};
		});
		log(
			"A14 设备页共用面板同样逐字展示原话、不降级成空态",
			!!pickedRow
			&& deviceFailProbe.box
			&& deviceFailProbe.text.includes(METRIC_UPSTREAM_FAILURE)
			&& deviceFailProbe.text.includes("重试")
			&& !deviceFailProbe.chart
			&& !deviceFailProbe.page.includes("该时间窗内无采集数据"),
			`row=${pickedRow ?? "无"} box=${deviceFailProbe.box} chart=${deviceFailProbe.chart} 原话=${deviceFailProbe.text.includes(METRIC_UPSTREAM_FAILURE)}`
		);

		// A15：监控页**不再取数**（折线归指标页，见 A3），因此上游指标失败时它既不该冒出错误块，
		// 也不该冒出「该时间窗内无采集数据」—— 它手上根本没有这份数据，说哪一句都是编。
		// 失败原话只在指标页逐字出现（A13 / A14）；监控页只留深链按钮，把人送到会说实话的那一页。
		const monitorRequests = [];
		const recordMonitor = (request) => {
			if (request.url().includes("/api/metric/"))
				monitorRequests.push(request.url());
		};
		page.on("request", recordMonitor);
		await page.goto(`${BASE_URL}/topology/monitor`, { waitUntil: "networkidle" });
		await page.waitForTimeout(1_000);
		const monitorNode = await page.evaluate(() => {
			const node = Array.from(document.querySelectorAll("[data-testid='topology-node']"))
				.find((el) => el.getAttribute("data-node-id") === "10.0.0.2");
			node?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			return node?.getAttribute("data-node-id") ?? null;
		});
		await page.waitForTimeout(1_500);
		const monitorFailProbe = await page.evaluate(() => {
			const box = document.querySelector("[data-testid='trend-error']");
			return {
				box: !!box,
				chart: !!document.querySelector("[data-testid='trend-chart']"),
				button: !!document.querySelector("[data-testid='topology-node-metrics']"),
				page: document.body.textContent ?? ""
			};
		});
		page.off("request", recordMonitor);
		log(
			"A15 指标失败时监控页不编空态也不出错误块：取数只发生在指标页，监控页只给深链入口",
			monitorNode === "10.0.0.2"
			&& !monitorFailProbe.box
			&& !monitorFailProbe.chart
			&& monitorFailProbe.button
			&& monitorRequests.length === 0
			&& !monitorFailProbe.page.includes("该时间窗内无采集数据")
			&& !monitorFailProbe.page.includes(METRIC_UPSTREAM_FAILURE),
			`node=${monitorNode ?? "无"} box=${monitorFailProbe.box} chart=${monitorFailProbe.chart}`
			+ ` 深链=${monitorFailProbe.button} 指标请求=${monitorRequests.length}`
		);

		// A16：**网络错误**下的 stale 分支（与上面「信封失败」是两条路）：上游已掉线，但手上还有上次成功的
		// 序列 —— 框架必须保留折线并说明「显示的是上一次成功的数据」，而不是清空成空态（§6.7 / §8.3）。
		await fetch(`http://${HOST}:${upstreamPort}/__control/metric-ok`);
		await page.goto(`${BASE_URL}/topology/device-metrics`, { waitUntil: "networkidle" });
		await page.waitForTimeout(1_000);
		await page.evaluate(() => {
			const rows = Array.from(document.querySelectorAll("[data-testid='metric-device-row']"));
			const row = rows.find((el) => (el.textContent ?? "").includes("·") && !/\u2014 \u00B7/.test(el.textContent ?? ""));
			row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		await page.waitForTimeout(1_500);
		await openDetailTab("图表");
		const beforeStale = await page.evaluate(() => document.querySelector("[data-testid='metric-trend']")?.getAttribute("data-series-count") ?? "");

		await fetch(`http://${HOST}:${upstreamPort}/__control/down`);
		await page.getByRole("button", { name: "刷新指标" }).first().click();
		await page.waitForTimeout(1_500);
		const staleProbe = await page.evaluate(() => {
			const box = document.querySelector("[data-testid='metric-trend-error']");
			const trend = document.querySelector("[data-testid='metric-trend']");
			return {
				box: !!box,
				chart: !!trend,
				seriesCount: trend?.getAttribute("data-series-count") ?? "",
				page: document.body.textContent ?? ""
			};
		});
		// 掉线期间页面其它请求也会失败，先恢复上游，避免后面的断言被这条开关连坐
		await fetch(`http://${HOST}:${upstreamPort}/__control/up`);
		log(
			"A16 同设备重取遇到网络错误时保留旧折线并标 stale（不清成空态）",
			beforeStale !== ""
			&& staleProbe.box
			&& staleProbe.chart
			&& staleProbe.seriesCount === beforeStale
			&& staleProbe.page.includes("指标通道暂时不可用"),
			`series=${beforeStale || "无"} → ${staleProbe.seriesCount || "无"} box=${staleProbe.box} stale=${staleProbe.page.includes("指标通道暂时不可用")}`
		);

		// A17：**目录失败**（§8.4）是第三种失败，和上面两种都不同 —— 失败的是「类型判定依据」，名字清单与
		// 序列都还好。此时图表必须照常出，页面只多一句「只按名字判断类型」，且**不许**把目录的原话当成
		// 取数失败展示（`metric-trend-error` 不出现、页面上看不到 `CATALOG_UPSTREAM_FAILURE`）。
		await fetch(`http://${HOST}:${upstreamPort}/__control/catalog-ok`);
		await fetch(`http://${HOST}:${upstreamPort}/__control/catalog-error`);
		await page.goto(`${BASE_URL}/topology/device-metrics`, { waitUntil: "networkidle" });
		await page.waitForTimeout(1_500);
		await openDetailTab("图表");
		const degradedProbe = await page.evaluate(() => {
			const alert = document.querySelector("[data-testid='metric-catalog-degraded']");
			const trend = document.querySelector("[data-testid='metric-trend']");
			return {
				alert: !!alert,
				alertText: alert?.textContent ?? "",
				chart: !!document.querySelector("[data-testid='trend-chart']"),
				seriesCount: trend?.getAttribute("data-series-count") ?? "",
				errorBox: !!document.querySelector("[data-testid='metric-trend-error']"),
				page: document.body.textContent ?? ""
			};
		});
		log(
			"A17 目录失败不阻塞出图，也不冒充取数失败",
			degradedProbe.alert
			&& degradedProbe.alertText.includes("只按名字判断类型")
			&& degradedProbe.chart
			&& degradedProbe.seriesCount !== ""
			&& !degradedProbe.errorBox
			&& !degradedProbe.page.includes(CATALOG_UPSTREAM_FAILURE),
			`alert=${degradedProbe.alert} chart=${degradedProbe.chart} series=${degradedProbe.seriesCount || "无"} errorBox=${degradedProbe.errorBox} 原话外泄=${degradedProbe.page.includes(CATALOG_UPSTREAM_FAILURE)}`
		);

		// A18：降级的**后果**要如实暴露 —— 只剩名字判据时，`sys_name`（目录里标 `string`）会被当成可绘图指标
		// 出现在选项里，而且**显示名也没有了**（`en_name` 来自目录），选项只剩编码。三条一起断言，
		// 正是在断言「提示不是装饰」：如果选择器依旧干净、还带中文/英文名，说明目录其实没失败。
		// 左栏台账行也是 `role="option"`（同一页面的 listbox），按「不含 `·`」把它们排掉。
		await page.locator("[data-testid='metric-picker']").click();
		await page.waitForTimeout(400);
		const degradedOptions = await page.evaluate(() =>
			Array.from(document.querySelectorAll("[role='option']")).map((el) => el.textContent?.trim() ?? ""));
		await page.keyboard.press("Escape");
		await page.waitForTimeout(200);
		const pickerOnly = degradedOptions.filter((item) => !item.includes("·"));
		log(
			"A18 目录失败时选择器退化为「只按名字判断」（文本指标混入、显示名不可得）",
			pickerOnly.includes("sys_name")
			&& pickerOnly.includes("if_in_octets")
			&& !degradedOptions.some((item) => item.includes("System name")),
			pickerOnly.length ? pickerOnly.join(" | ") : "下拉没有选项"
		);

		// A19：**台账失败 ≠ 空态**（`NMCPS-ARCH-006` §3.4）。断言什么都没覆盖这条，是 2026-11-06 的视觉自查
		// 用肉眼抓到的：上游掉线时左栏除了错误提示，还并排写着「当前租户下没有设备事实」、页脚「共 0 台设备」，
		// 右栏再把「没加载出来」讲成「该设备不在当前分页结果内」—— 四句话互相打架。这里三条否定判据一起钉。
		await fetch(`http://${HOST}:${upstreamPort}/__control/down`);
		await page.goto(`${BASE_URL}/topology/device-metrics?id=DEV-CORE-1`, { waitUntil: "networkidle" });
		await page.waitForTimeout(1_500);
		const ledgerFailProbe = await page.evaluate(() => {
			const split = "[data-split='device-metrics']";
			const body = document.body.textContent ?? "";
			return {
				body,
				list: document.querySelector(`${split} [data-pane='list']`)?.textContent ?? "",
				detail: document.querySelector(`${split} [data-pane='detail']`)?.textContent ?? ""
			};
		});
		log(
			"A19 台账失败不出空态、不写「共 0 台设备」、不断言「不在当前分页」",
			ledgerFailProbe.list.includes("加载设备台账失败")
			&& ledgerFailProbe.list.includes("bff_upstream_unreachable")
			&& ledgerFailProbe.detail.includes("无法确认这台设备")
			&& !ledgerFailProbe.body.includes("当前租户下没有设备事实")
			&& !ledgerFailProbe.body.includes("共 0 台设备")
			&& !ledgerFailProbe.body.includes("不在当前分页结果内"),
			`错误=${ledgerFailProbe.list.includes("加载设备台账失败")} 空态=${ledgerFailProbe.body.includes("当前租户下没有设备事实")} 计数=${ledgerFailProbe.body.includes("共 0 台设备")} 不在本页=${ledgerFailProbe.body.includes("不在当前分页结果内")}`
		);

		// A20：同一套模板在链路页也必须一致 —— 只钉一页等于没钉（两页各有一份列表 / 详情模板）。
		await page.goto(`${BASE_URL}/topology/link-metrics?id=DEV-CORE-1:GE0/0/1--DEV-ACC-1:GE1/0/1`, { waitUntil: "networkidle" });
		await page.waitForTimeout(1_500);
		const linkLedgerFailProbe = await page.evaluate(() => {
			const split = "[data-split='link-metrics']";
			const body = document.body.textContent ?? "";
			return {
				body,
				list: document.querySelector(`${split} [data-pane='list']`)?.textContent ?? "",
				detail: document.querySelector(`${split} [data-pane='detail']`)?.textContent ?? ""
			};
		});
		log(
			"A20 链路页台账失败同样不冒充空态",
			linkLedgerFailProbe.list.includes("加载链路台账失败")
			&& linkLedgerFailProbe.detail.includes("无法确认这条链路")
			&& !linkLedgerFailProbe.body.includes("当前租户下没有链路事实")
			&& !linkLedgerFailProbe.body.includes("共 0 条链路")
			&& !linkLedgerFailProbe.body.includes("不在当前分页结果内"),
			`错误=${linkLedgerFailProbe.list.includes("加载链路台账失败")} 空态=${linkLedgerFailProbe.body.includes("当前租户下没有链路事实")} 计数=${linkLedgerFailProbe.body.includes("共 0 条链路")} 不在本页=${linkLedgerFailProbe.body.includes("不在当前分页结果内")}`
		);

		// 目录恢复：后面的断言（以及别的页面）不该被这条开关连坐
		await fetch(`http://${HOST}:${upstreamPort}/__control/up`);
		await fetch(`http://${HOST}:${upstreamPort}/__control/catalog-ok`);

		page.off("request", recordMetric);
	}
}

// 11.1 实验通道**已配置**的对照面：另起一个带 `NUXT_MININET_INSTANCES` 的 BFF，断言「实验」标记
// 真的落到按管理 IP 对齐的节点上（虚线外环 2 个）、降级条不出现；邻接卡读的是
// `GET /api/mininet/links` 推导出的台账（`NMCPS-ADR-0027` §7），不是已经裁决不建的 LLDP 通道。
// 只读一侧：把能力位覆盖成没有 `lab:operate`，页面连一条写都不该发（按钮置灰不靠 403 兜底）。
if (upstreamPort) {
	const SIM_TENANT = "t_default";
	const simBffPort = await freePort();
	const simBffBase = `http://${HOST}:${simBffPort}`;
	const simBff = await startBff(simBffPort, {
		NUXT_BFF_UPSTREAM_BASE: `http://${HOST}:${upstreamPort}`,
		// 实验端点要读签名会话（`authorizeLabSession`）：缺 secret 时通道探针回 503 `bff_auth_not_configured`
		NUXT_BFF_SESSION_SECRET: "check-ui-monitor-session-secret-0123456789abcdef",
		// 台账没有归属记录时 `/api/mininet/nodes` 回 404 `lab_resource_not_found`（租户还没有实验网络）。
		// 监控页叠加的是「已有那张网」的运行态，所以这里按实验台页面同形种一条台账记录。
		NUXT_LAB_LEDGER_FILE: `.data/check-ui-monitor-${process.pid}.json`,
		NUXT_LAB_LEDGER_SEED: JSON.stringify([{ id: "net_monitor", tenant_id: SIM_TENANT, engine: "mininet", upstream_id: "mininet-t_default", state: "running", created_by: "u_alice", created_at: "2026-11-15T00:00:00.000Z", updated_at: "2026-11-15T00:00:00.000Z" }]),
		NUXT_MININET_INSTANCES: JSON.stringify({ [SIM_TENANT]: { baseUrl: `http://${HOST}:${upstreamPort}` } })
	});

	/**
	 * 邻接样本：默认台账是 h1—sw1 / sw1—r1，补一条 h1—h2 —— h2 的 IP（10.0.0.2）在 8888 图上是
	 * 已知节点、sw1 没有，于是同一张卡里「画布内对端 + 画布外对端」同时出现。
	 */
	const adjacencyLink = { from: "h1", to: "h2" };
	const dropAdjacencyLink = () => {
		upstreamServer.mininetState.links = upstreamServer.mininetState.links
			.filter((link) => !(link.from === adjacencyLink.from && link.to === adjacencyLink.to));
	};

	try {
		upstreamServer.mininetRun.started = true;
		upstreamServer.mininetState.links.push(adjacencyLink);
		const simContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
		const simPage = await simContext.newPage();
		// 记下「页面打开之前」的写请求数：后面的「只读会话零写请求」只数这一段之后的新增
		const simWritesBeforePage = upstreamServer.mininetLog.length;
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
			"实验通道已配置时按管理 IP 对齐并叠加「实验中」标记",
			!probe.degraded && probe.markers === 2,
			`markers=${probe.markers} degraded=${probe.degraded}`
		);
		log(
			"实验通道已配置时不再显示降级条",
			!probe.text.includes("实验通道不可用"),
			probe.text.includes("实验通道不可用") ? "仍提示不可用" : "无降级提示"
		);

		// 能力探针：`/api/mininet/channel` 不触达上游，回 `configured` + `capabilities` + `endpointCount`，
		// 且响应体里没有上游地址 —— 页面据此把按钮置灰，而不是让用户点了再收 403。地址泄露是安全问题，
		// 这里按原文搜端口号。
		const channel = await simPage.request.get(`${simBffBase}/api/mininet/channel`).catch(() => null);
		const channelJson = channel ? await channel.json().catch(() => null) : null;
		const channelRaw = channel ? await channel.text().catch(() => "") : "";
		log(
			"能力探针回 configured + lab:operate + 端点数，且不泄露上游地址",
			channel?.status() === 200
			&& channelJson?.data?.configured === true
			&& channelJson?.data?.capabilities?.operate === true
			&& channelJson?.data?.endpointCount === 59
			&& !channelRaw.includes(String(upstreamPort)),
			channel
				? `${channel.status()} configured=${channelJson?.data?.configured} operate=${channelJson?.data?.capabilities?.operate} 端点=${channelJson?.data?.endpointCount} 泄露端口=${channelRaw.includes(String(upstreamPort))}`
				: "请求失败"
		);

		// 只读会话：`operate=false` 时链路动作按钮必须禁用（不渲染可点入口），且一条写都不发
		await simPage.route("**/api/mininet/channel", async (route) => {
			const response = await route.fetch();
			const payload = await response.json();
			if (!payload?.data?.capabilities)
				return route.fulfill({ response, json: payload });
			payload.data.capabilities.operate = false;
			payload.data.capabilities.create = false;
			payload.data.capabilities.delete = false;
			payload.data.writeEnabled = false;
			payload.data.readOnly = true;
			await route.fulfill({ response, json: payload });
		});
		await simPage.reload({ waitUntil: "networkidle" });
		await simPage.waitForTimeout(800);
		await simPage.evaluate(() => {
			const link = Array.from(document.querySelectorAll("[data-link-key]"))
				.find((el) => /10\.0\.0\.1.+10\.0\.0\.2/.test(el.getAttribute("data-link-key") ?? ""));
			link?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		await simPage.waitForTimeout(500);
		const readOnlyProbe = await simPage.evaluate(() => {
			const buttons = Array.from(document.querySelectorAll("[data-testid='topology-link-action']"));
			return { total: buttons.length, enabled: buttons.filter((el) => !el.hasAttribute("disabled")).length };
		});
		const pageWrites = upstreamServer.mininetLog
			.slice(simWritesBeforePage)
			.filter((entry) => entry.method !== "GET");
		log(
			"没有 lab:operate 时链路动作全部禁用且页面零写请求",
			readOnlyProbe.total === 3 && readOnlyProbe.enabled === 0 && pageWrites.length === 0,
			`按钮=${readOnlyProbe.total} 可点=${readOnlyProbe.enabled} 写请求=${pageWrites.length}`
		);

		// A38：拓扑邻接卡（`NMCPS-ADR-0027` §7）。台账里 h1 两条链路：h2 在画布上（10.0.0.2），
		// sw1 没有 8888 对应节点（画布外）。断言两端接口按方向分名、链路状态取 M1.2 的实测读数、
		// 画布内计数分开报；**不**出现 TTL / 发现时间 / MIB 系统名（那不是台账能给出的事实）。
		await simPage.unroute("**/api/mininet/channel");
		await simPage.reload({ waitUntil: "networkidle" });
		await simPage.waitForTimeout(800);
		await simPage.evaluate(() => {
			const node = Array.from(document.querySelectorAll("[data-testid='topology-node']"))
				.find((el) => el.getAttribute("data-node-id") === "10.0.0.1");
			node?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		await simPage.waitForTimeout(600);
		const adjacencyProbe = await simPage.evaluate(() => {
			const card = document.querySelector("[data-testid='topology-adjacency-card']");
			const rows = Array.from(document.querySelectorAll("[data-testid='topology-adjacency-neighbor']"));
			return {
				state: card?.getAttribute("data-adjacency-state") ?? "",
				count: Number(card?.getAttribute("data-adjacency-count") ?? -1),
				onCanvas: Number(card?.getAttribute("data-adjacency-on-canvas") ?? -1),
				text: (card?.textContent ?? "").replace(/\s+/g, " ").trim(),
				rows: rows.map((el) => ({
					id: el.getAttribute("data-neighbor-id") ?? "",
					onCanvas: el.getAttribute("data-on-canvas") ?? "",
					text: (el.textContent ?? "").replace(/\s+/g, " ").trim()
				}))
			};
		});
		const h2Row = adjacencyProbe.rows.find((row) => row.id === "h2");
		const sw1Row = adjacencyProbe.rows.find((row) => row.id === "sw1");
		log(
			"A38 拓扑邻接从 /links 推导：对端身份、两端接口、画布内外分开报",
			adjacencyProbe.state === "ok" && adjacencyProbe.count === 2 && adjacencyProbe.onCanvas === 1
			&& h2Row?.onCanvas === "true" && h2Row?.text.includes("h1-eth0 → h2-eth0")
			&& sw1Row?.onCanvas === "false"
			&& !adjacencyProbe.text.includes("TTL") && !adjacencyProbe.text.includes("00:00:00:00:00:00"),
			`state=${adjacencyProbe.state} count=${adjacencyProbe.count} onCanvas=${adjacencyProbe.onCanvas} h2=${h2Row?.text ?? "无"} sw1=${sw1Row?.text ?? "无"}`
		);

		// A39：台账里确实没有链路时才是「没有邻接」—— 撤掉 h1—h2，h2 自己一条边都没有，
		// 卡片必须写空态而不是失败、也不是「读不到」。
		dropAdjacencyLink();
		await simPage.reload({ waitUntil: "networkidle" });
		await simPage.waitForTimeout(800);
		await simPage.evaluate(() => {
			const node = Array.from(document.querySelectorAll("[data-testid='topology-node']"))
				.find((el) => el.getAttribute("data-node-id") === "10.0.0.2");
			node?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		await simPage.waitForTimeout(600);
		const adjacencyEmpty = await simPage.evaluate(() => {
			const card = document.querySelector("[data-testid='topology-adjacency-card']");
			const empty = document.querySelector("[data-testid='topology-adjacency-empty']");
			return {
				state: card?.getAttribute("data-adjacency-state") ?? "",
				count: Number(card?.getAttribute("data-adjacency-count") ?? -1),
				emptyText: (empty?.textContent ?? "").replace(/\s+/g, " ").trim(),
				idle: !!document.querySelector("[data-testid='topology-adjacency-idle']")
			};
		});
		log(
			"A39 台账里没有链路时写空态（不是失败、也不是读不到）",
			adjacencyEmpty.state === "ok" && adjacencyEmpty.count === 0 && !adjacencyEmpty.idle
			&& adjacencyEmpty.emptyText.includes("实验台账里这台设备没有链路"),
			`state=${adjacencyEmpty.state} count=${adjacencyEmpty.count} empty=${adjacencyEmpty.emptyText}`
		);

		await simContext.close();
	} finally {
		dropAdjacencyLink();
		// 上游运行态是全局单例：不复位会把 11.3 的「台账 running + 上游 false ⇒ 已停止」对账钉弄红。
		upstreamServer.mininetRun.started = false;
		await stopBff(simBff);
	}
}

// 11.2 写入口（NMCPS-DESIGN-001 §九 A9）：同一个实验通道，能力位来自 `GET /api/mininet/channel` 的
// `capabilities.operate`。11.1 证明「没授权时一步也走不出去」，这里证明「有授权时按钮真的能按下、
// 按下真的到达上游」—— 能力位 → 二次确认 → 上游实收 → 成功提示。
if (upstreamPort) {
	const WRITE_TENANT = "t_default";
	const writeLink = { from: "h1", to: "h2" };
	const writeBffPort = await freePort();
	const writeBffBase = `http://${HOST}:${writeBffPort}`;
	const writeBff = await startBff(writeBffPort, {
		NUXT_BFF_UPSTREAM_BASE: `http://${HOST}:${upstreamPort}`,
		NUXT_BFF_SESSION_SECRET: "check-ui-monitor-session-secret-0123456789abcdef",
		// 台账没有归属记录时 `/api/mininet/nodes` 回 404 `lab_resource_not_found`（租户还没有实验网络）。
		// 监控页叠加的是「已有那张网」的运行态，所以这里按实验台页面同形种一条台账记录。
		NUXT_LAB_LEDGER_FILE: `.data/check-ui-monitor-write-${process.pid}.json`,
		NUXT_LAB_LEDGER_SEED: JSON.stringify([{ id: "net_monitor", tenant_id: WRITE_TENANT, engine: "mininet", upstream_id: "mininet-t_default", state: "running", created_by: "u_alice", created_at: "2026-11-15T00:00:00.000Z", updated_at: "2026-11-15T00:00:00.000Z" }]),
		NUXT_MININET_INSTANCES: JSON.stringify({ [WRITE_TENANT]: { baseUrl: `http://${HOST}:${upstreamPort}` } })
	});

	try {
		upstreamServer.mininetRun.started = true;
		if (!upstreamServer.mininetState.links.some((link) => link.from === writeLink.from && link.to === writeLink.to))
			upstreamServer.mininetState.links.push(writeLink);
		delete upstreamServer.mininetLinkState[`${writeLink.from}|${writeLink.to}`];
		delete upstreamServer.mininetLinkState[`${writeLink.to}|${writeLink.from}`];

		const writeContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
		const writePage = await writeContext.newPage();
		await writePage.goto(`${writeBffBase}/auth/login`, { waitUntil: "networkidle" });
		await writePage.locator("input[autocomplete='username']").fill(ACCOUNT);
		await writePage.locator("input[type='password']").fill(PASSWORD);
		await writePage.locator("button[type='submit']").first().click();
		await writePage.waitForURL((url) => url.pathname !== "/auth/login", { timeout: 20_000 }).catch(() => {});

		const channelResponse = await writePage.request.get(`${writeBffBase}/api/mininet/channel`).catch(() => null);
		const channelBody = channelResponse ? await channelResponse.json().catch(() => null) : null;
		log(
			"实验台管理员的能力探针回 writeEnabled=true（lab:operate）",
			channelResponse?.status() === 200 && channelBody?.data?.writeEnabled === true,
			`${channelResponse?.status() ?? 0} writeEnabled=${channelBody?.data?.writeEnabled}`
		);

		await writePage.goto(`${writeBffBase}/topology/monitor`, { waitUntil: "networkidle" });
		await writePage.waitForTimeout(800);

		// A9：有写权限也**仍然**不在画布上长出节点级动作 —— 引擎面没有节点动作端点（ADR-0027 §4 第 2 条），
		// 写入口只剩链路详情卡里的 `topology-link-action`。
		const writeCapability = await writePage.evaluate(() => ({
			canvas: !!document.querySelector("[data-testid='topology-canvas']"),
			actions: document.querySelectorAll("[data-testid='sim-action']").length,
			text: document.body.textContent ?? ""
		}));
		log(
			"A9 有写权限也不在画布上长出节点级动作（写入口只在链路详情卡里）",
			writeCapability.canvas && writeCapability.actions === 0
			&& !writeCapability.text.includes("停止节点") && !writeCapability.text.includes("重启节点"),
			`canvas=${writeCapability.canvas} sim-action=${writeCapability.actions}`
		);

		// A35：链路动作端到端。选 `10.0.0.1 ↔ 10.0.0.2`（台账里就是 h1—h2），按钮才可点；弹窗写明
		// 动作与实验链路；确认后写请求打到 `PATCH /api/mininet/links/h1/h2/state`，正文是 `{ state }`，
		// 上游台账与页面回读都必须变成 `down`。
		await writePage.evaluate(() => {
			const link = Array.from(document.querySelectorAll("[data-link-key]"))
				.find((el) => /10\.0\.0\.1.+10\.0\.0\.2/.test(el.getAttribute("data-link-key") ?? ""));
			link?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		await writePage.waitForTimeout(400);
		const linkReady = await writePage.evaluate(() => {
			const buttons = Array.from(document.querySelectorAll("[data-testid='topology-link-action']"));
			return {
				actions: buttons.map((el) => el.getAttribute("data-action")),
				disabled: buttons.filter((el) => el.hasAttribute("disabled")).length
			};
		});
		log(
			"A35 选中实验台账里的链路后三个链路动作按钮都可点",
			linkReady.actions.join(",") === "down,up,toggle" && linkReady.disabled === 0,
			`actions=${linkReady.actions.join(",")} disabled=${linkReady.disabled}`
		);

		const linkHitsBefore = upstreamServer.mininetLog.length;
		await writePage.locator("[data-testid='topology-link-action'][data-action='down']").click();
		const linkConfirmText = await writePage.locator("[role='dialog']").first().evaluate((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim()).catch(() => "");
		log(
			"A35 链路动作要二次确认并写明实验链路",
			linkConfirmText.includes("断开链路") && linkConfirmText.includes("实验链路 h1 → h2"),
			linkConfirmText.slice(0, 120) || "未出现确认弹窗"
		);

		await writePage.locator("[data-testid='sim-confirm']").click();
		await writePage.waitForTimeout(1200);
		const linkHits = upstreamServer.mininetLog.slice(linkHitsBefore).filter((entry) => entry.method !== "GET");
		const linkHit = linkHits[0];
		log(
			"A35 确认后 PATCH 到达 /links/h1/h2/state，正文是 { state: down }",
			linkHits.length === 1 && linkHit?.method === "PATCH"
			&& linkHit?.path === "/api/mininet/links/h1/h2/state"
			&& linkHit?.body?.state === "down",
			linkHit ? `${linkHit.method} ${linkHit.path} body=${JSON.stringify(linkHit.body)}` : `写请求 ${linkHits.length} 次`
		);

		const linksAfter = await writePage.request.get(`${writeBffBase}/api/mininet/links`).catch(() => null);
		const linksAfterJson = linksAfter ? await linksAfter.json().catch(() => null) : null;
		const h1h2 = (linksAfterJson?.data ?? []).find((link) =>
			(link.from === "h1" && link.to === "h2") || (link.from === "h2" && link.to === "h1"));
		log(
			"A35 下发后回读 /links 是 down（状态真落到了台账）",
			upstreamServer.mininetLinkState["h1|h2"] === "down" && h1h2?.status === "down",
			`上游=${upstreamServer.mininetLinkState["h1|h2"] ?? "无"} 回读=${h1h2?.status ?? "无"}`
		);

		const linkDoneText = await writePage.evaluate(() => document.body.textContent ?? "");
		log(
			"A35 成功后提示「链路已断开」",
			linkDoneText.includes("链路已断开"),
			linkDoneText.includes("链路已断开") ? "已提示" : `未见提示：${linkDoneText.slice(0, 80)}`
		);

		await writeContext.close();
	} finally {
		upstreamServer.mininetState.links = upstreamServer.mininetState.links
			.filter((link) => !(link.from === writeLink.from && link.to === writeLink.to));
		delete upstreamServer.mininetLinkState[`${writeLink.from}|${writeLink.to}`];
		delete upstreamServer.mininetLinkState[`${writeLink.to}|${writeLink.from}`];
		// 同上：留给 11.3 的必须是「假上游没启动」这个事实。
		upstreamServer.mininetRun.started = false;
		await stopBff(writeBff);
	}
}

// 11.3 实验网只读页（NMCPS-ADR-0021 P2 / NMCPS-ADR-0020）：`/scenario/simulator`
// 的数据源是 `/api/mininet/networks` + 五类节点 + 链路。这里分三个 BFF：
//   ① 空台账：页面必须明确说「暂无仿真网络」，而不是画一张空画布；
//   ② 有台账：节点 / 链路真的投影到画布，选中节点与链路时右侧详情跟着切换；
//   ③ 有资源清单：清单外的节点 / 链路不得进入画布。
// 失败分支不另起 BFF，而是在浏览器侧把列表请求换成 503 / 403，再验证刷新重试。
// 假 Mininet 端点已由 `startUpstream()` 提供（对象字典 + 数组），不需要再起第三个上游。
if (upstreamPort) {
	const LAB_TENANT = "t_default";
	const labSecret = "check-ui-lab-session-secret-0123456789abcdef";
	const labSeed = [{
		id: "net_ui",
		tenant_id: LAB_TENANT,
		engine: "mininet",
		upstream_id: "mininet-t_default",
		state: "running",
		created_by: "u_alice",
		created_at: "2026-11-15T00:00:00.000Z",
		updated_at: "2026-11-15T00:00:00.000Z"
	}];

	const loginToLab = async (targetPage, base) => {
		await targetPage.goto(`${base}/auth/login`, { waitUntil: "networkidle" });
		await targetPage.locator("input[autocomplete='username']").fill(ACCOUNT);
		await targetPage.locator("input[type='password']").fill(PASSWORD);
		await targetPage.locator("button[type='submit']").first().click();
		await targetPage.waitForURL((url) => url.pathname !== "/auth/login", { timeout: 20_000 }).catch(() => {});
		await targetPage.goto(`${base}/scenario/simulator`, { waitUntil: "networkidle" });
		await targetPage.waitForTimeout(800);
	};

	const emptyPort = await freePort();
	const emptyBase = `http://${HOST}:${emptyPort}`;
	const emptyBff = await startBff(emptyPort, {
		NUXT_BFF_UPSTREAM_BASE: `http://${HOST}:${upstreamPort}`,
		NUXT_BFF_SESSION_SECRET: labSecret,
		NUXT_LAB_LEDGER_FILE: `.data/check-ui-lab-empty-${process.pid}.json`,
		NUXT_LAB_LEDGER_SEED: ""
	});

	try {
		const emptyContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
		const emptyPage = await emptyContext.newPage();
		await loginToLab(emptyPage, emptyBase);
		// 空台账是整段 11.x 的第一个页面：BFF 冷启动（首次 SSR）+ 台账读盘可能超过 `loginToLab`
		// 的固定等待，这里等它落到三种终态之一（空提示 / 画布 / 错误卡）再判，别把「还在读」当「报错」。
		await emptyPage.waitForSelector("[data-testid='mininet-empty'], [data-testid='topology-canvas'], [data-testid='mininet-error']", { timeout: 20000 }).catch(() => {});
		await emptyPage.waitForTimeout(300);
		const emptyProbe = await emptyPage.evaluate(() => ({
			empty: !!document.querySelector("[data-testid='mininet-empty']"),
			canvas: !!document.querySelector("[data-testid='topology-canvas']"),
			error: !!document.querySelector("[data-testid='mininet-error']"),
			text: (document.body.textContent ?? "").replace(/\s+/g, " ").trim()
		}));
		log(
			"11.3 空台账显示「暂无仿真网络」，不画空画布也不报错",
			emptyProbe.empty && !emptyProbe.canvas && !emptyProbe.error && emptyProbe.text.includes("暂无仿真网络"),
			`empty=${emptyProbe.empty} canvas=${emptyProbe.canvas} error=${emptyProbe.error} 文案=${emptyProbe.text.slice(0, 80)}`
		);
		await emptyContext.close();
	} finally {
		await stopBff(emptyBff);
	}

	const labPort = await freePort();
	const labBase = `http://${HOST}:${labPort}`;
	const labBff = await startBff(labPort, {
		NUXT_BFF_UPSTREAM_BASE: `http://${HOST}:${upstreamPort}`,
		NUXT_BFF_SESSION_SECRET: labSecret,
		NUXT_LAB_LEDGER_FILE: `.data/check-ui-lab-${process.pid}.json`,
		NUXT_LAB_LEDGER_SEED: JSON.stringify(labSeed),
		NUXT_MININET_INSTANCES: JSON.stringify({ [LAB_TENANT]: { baseUrl: `http://${HOST}:${upstreamPort}` } })
	});

	try {
		const labContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
		const labPage = await labContext.newPage();

		// 失败分支：不改 BFF / 台账文件，直接在浏览器侧把列表请求换成 503 / 403。
		// 断言三件事：错误卡出现、上游原话逐字保留、撤掉故障后点刷新能恢复画布。
		let labNetworksFailure = { status: 503, message: "tenant_runtime_unavailable" };
		await labPage.route("**/api/mininet/networks", async (route) => {
			if (!labNetworksFailure) {
				await route.continue();
				return;
			}

			await route.fulfill({
				status: labNetworksFailure.status,
				contentType: "application/json",
				body: JSON.stringify({
					code: labNetworksFailure.status,
					status: "error",
					message: labNetworksFailure.message,
					timestamp: new Date().toISOString()
				})
			});
		});

		await loginToLab(labPage, labBase);

		const failureProbe = await labPage.evaluate(() => {
			const error = document.querySelector("[data-testid='mininet-error']");
			return {
				error: !!error,
				canvas: !!document.querySelector("[data-testid='topology-canvas']"),
				text: (error?.textContent ?? "").replace(/\s+/g, " ").trim()
			};
		});
		log(
			"11.3 /api/mininet/networks 503 时显示错误卡并保留上游原话",
			failureProbe.error && !failureProbe.canvas && failureProbe.text.includes("tenant_runtime_unavailable"),
			`error=${failureProbe.error} canvas=${failureProbe.canvas} 文案=「${failureProbe.text.slice(0, 120)}」`
		);

		labNetworksFailure = { status: 403, message: "lab_permission_denied" };
		await labPage.locator("[data-testid='mininet-refresh']").click();
		await labPage.waitForTimeout(800);
		const deniedProbe = await labPage.evaluate(() => {
			const error = document.querySelector("[data-testid='mininet-error']");
			return {
				error: !!error,
				canvas: !!document.querySelector("[data-testid='topology-canvas']"),
				text: (error?.textContent ?? "").replace(/\s+/g, " ").trim()
			};
		});
		log(
			"11.3 /api/mininet/networks 403 时错误卡展示权限拒绝原话",
			deniedProbe.error && !deniedProbe.canvas && deniedProbe.text.includes("lab_permission_denied"),
			`error=${deniedProbe.error} canvas=${deniedProbe.canvas} 文案=「${deniedProbe.text.slice(0, 120)}」`
		);

		labNetworksFailure = null;
		await labPage.locator("[data-testid='mininet-refresh']").click();
		await labPage.waitForTimeout(800);
		const recoveredProbe = await labPage.evaluate(() => ({
			error: !!document.querySelector("[data-testid='mininet-error']"),
			canvas: !!document.querySelector("[data-testid='topology-canvas']"),
			nodes: document.querySelectorAll("[data-testid='topology-node']").length
		}));
		log(
			"11.3 撤掉故障后点刷新重试，错误卡消失且画布恢复",
			!recoveredProbe.error && recoveredProbe.canvas && recoveredProbe.nodes === 6,
			`error=${recoveredProbe.error} canvas=${recoveredProbe.canvas} nodes=${recoveredProbe.nodes}`
		);

		const topologyProbe = await labPage.evaluate(() => {
			const statText = (id) => (document.querySelector(`[data-testid='${id}']`)?.textContent ?? "").replace(/\s+/g, " ").trim();
			return {
				nodes: document.querySelectorAll("[data-testid='topology-node']").length,
				links: document.querySelectorAll("[data-testid='topology-link']").length,
				network: statText("mininet-stat-network"),
				nodeStat: statText("mininet-stat-nodes"),
				linkStat: statText("mininet-stat-links"),
				body: (document.body.textContent ?? "").replace(/\s+/g, " ").trim()
			};
		});
		log(
			"11.3 有台账时五类节点与链路投影到画布，网络卡片显示台账事实",
			topologyProbe.nodes === 6 && topologyProbe.links === 2
			&& topologyProbe.nodeStat.includes("6") && topologyProbe.linkStat.includes("2")
			// 台账 seed 写的是 `running`，但假上游 `GET /api/mininet/start` 回 `false`；
			// 读路径对账（`NMCPS-ADR-0026` D4）会把 `running` 改判成「已停止」并落盘 ——
			// 这正是「从没启动过的网显示运行中」那条缺陷的回归钉。上游原样透传的是「连通」页
			// 的运行态徽章（`mininet-run-state`），两者别混。
			&& topologyProbe.body.includes("net_ui")
			&& topologyProbe.network.includes("已停止"),
			`nodes=${topologyProbe.nodes} links=${topologyProbe.links}`
			+ ` 状态=「${topologyProbe.network}」节点=「${topologyProbe.nodeStat}」链路=「${topologyProbe.linkStat}」`
		);

		await labPage.evaluate(() => {
			document.querySelector("[data-testid='topology-node'][data-node-id='h1']")
				?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		await labPage.waitForTimeout(200);
		const nodeDetail = await labPage.evaluate(() =>
			(document.querySelector("[data-testid='mininet-detail']")?.textContent ?? "").replace(/\s+/g, " ").trim()
		);
		log(
			"11.3 选中节点后详情栏显示节点 id / IP / MAC / 直连链路数",
			nodeDetail.includes("h1") && nodeDetail.includes("10.0.0.1")
			&& nodeDetail.includes("00:00:00:00:00:01") && /链路\s*1/.test(nodeDetail),
			nodeDetail.slice(0, 160) || "详情栏为空"
		);

		await labPage.evaluate(() => {
			const link = Array.from(document.querySelectorAll("[data-testid='topology-link-hit']"))
				.find((el) => (el.getAttribute("data-link-hit-key") ?? "").includes("h1"));
			link?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		await labPage.waitForTimeout(200);
		const linkDetail = await labPage.evaluate(() =>
			(document.querySelector("[data-testid='mininet-detail']")?.textContent ?? "").replace(/\s+/g, " ").trim()
		);
		log(
			"11.3 选中链路后详情栏切换到链路起点 / 终点",
			linkDetail.includes("h1") && linkDetail.includes("sw1")
			&& linkDetail.includes("↔") && linkDetail.includes("起点") && linkDetail.includes("终点"),
			linkDetail.slice(0, 160) || "详情栏为空"
		);

		// ── 11.4 拓扑编辑（NMCPS-ADR-0022 W2）：能力位 → 新增 / 拖动 / 删除 ──
		// 断言分两层：**页面渲染**跟能力位走（没有 `lab:create` 就不出菜单），
		// **写请求**真的到达上游且请求体是上游要的形状（`mininetLog` 记的是 BFF 转发出去的那一次）。
		await labPage.evaluate(() => {
			document.querySelector("[data-testid='topology-node'][data-node-id='h1']")
				?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		await labPage.waitForTimeout(300);
		const editProbe = await labPage.evaluate(() => {
			const palette = document.querySelector("[data-testid='mininet-node-palette']");
			const canvas = document.querySelector("[data-testid='topology-canvas']");
			const generate = document.querySelector("[data-testid='mininet-generate-topology']");
			const paletteBox = palette?.getBoundingClientRect();
			const canvasBox = canvas?.getBoundingClientRect();
			const generateBox = generate?.getBoundingClientRect();
			return {
				palette: !!palette,
				removeNode: !!document.querySelector("[data-testid='mininet-remove-node']"),
				// 设备栏在画布**外面**（W10）：整列靠左、右边缘不越过画布左边缘
				outsideCanvas: !!(paletteBox && canvasBox && paletteBox.right <= canvasBox.left + 1),
				// 并且撑满容器高度（与画布列同高，差 ≤ 2px）
				fullHeight: !!(paletteBox && canvasBox && Math.abs(paletteBox.height - canvasBox.height) <= 2),
				// 运行控制与「生成拓扑」都在栏顶（上半部）
				generateOnTop: !!(generate && palette && palette.contains(generate)
					&& paletteBox && generateBox && generateBox.top < paletteBox.top + paletteBox.height / 2)
			};
		});
		log(
			"11.4 会话有写能力位时渲染画布**外面**左侧的满高设备栏（运行控制与生成拓扑在栏顶）",
			editProbe.palette && editProbe.outsideCanvas && editProbe.fullHeight
			&& editProbe.generateOnTop && editProbe.removeNode,
			`palette=${editProbe.palette} outside=${editProbe.outsideCanvas}`
			+ ` fullHeight=${editProbe.fullHeight} generateTop=${editProbe.generateOnTop}`
			+ ` remove=${editProbe.removeNode}`
		);

		/*
		 * 11.4a 设备栏去卡片化（W11）：整列透明 —— 不铺底色、不描边、不投影，看上去就是
		 * 画布左侧的一条图标列。列一透明按钮就只剩图标，所以每个按钮必须有 tooltip：
		 * 这里用「生成拓扑」（永不 disabled，悬停一定有反应）取证，文案取自 `generate.hint`。
		 */
		const railTone = await labPage.evaluate(() => {
			const rail = document.querySelector("[data-testid='mininet-node-palette']");
			if (!rail)
				return null;
			const style = getComputedStyle(rail);
			return {
				bg: style.backgroundColor,
				border: style.borderTopWidth,
				shadow: style.boxShadow
			};
		});
		const generateTooltip = await (async () => {
			const trigger = labPage.locator("[data-testid='mininet-generate-topology']").first();
			if (await trigger.count() === 0)
				return "";
			await trigger.hover();
			await labPage.waitForTimeout(1200);
			const text = await labPage.evaluate(() => [...document.querySelectorAll("[role='tooltip']")]
				.map((node) => (node.textContent ?? "").trim())
				.filter(Boolean)
				.join(" "));
			await labPage.mouse.move(0, 0);
			await labPage.waitForTimeout(200);
			return text;
		})();
		const railTransparent = !!railTone
			&& (railTone.bg === "rgba(0, 0, 0, 0)" || railTone.bg === "transparent")
			&& railTone.border === "0px"
			&& railTone.shadow === "none";
		log(
			"11.4a 设备栏透明（无底色 / 无描边 / 无投影），图标按钮的说明挂在 tooltip 上",
			railTransparent && generateTooltip.includes("按预置形状"),
			`底色=${railTone?.bg} 描边=${railTone?.border} 投影=${railTone?.shadow} 提示=${generateTooltip || "无"}`
		);

		// 新增主机：右侧节点面板 → 表单 → 提交。默认名 `h3`，默认 IP 与坐标由页面给，这里只填名称。
		// 元素缺失时**不抛**（Playwright 点空会等 30s 再中断整个自查），改成记一次失败继续跑。
		const clickIfPresent = async (target) => {
			const locator = typeof target === "string" ? labPage.locator(target) : target;
			if (await locator.count() === 0)
				return false;
			await locator.first().click();
			return true;
		};
		/** 右栏是五标签面板：运行读数 / 抓包观察窗在「连通」，观测三块在各自的标签 */
		const openSideTab = async (label) => {
			const tab = labPage.locator("[data-testid='mininet-side-tabs'] [role='tab']").filter({ hasText: label });
			const clicked = await clickIfPresent(tab);
			await labPage.waitForTimeout(300);
			return clicked;
		};

		const itemClicked = await clickIfPresent("[data-testid='mininet-add-kind-host']");
		await labPage.waitForTimeout(300);
		const createOpen = itemClicked && await labPage.evaluate(() => !!document.querySelector("[data-testid='lab-node-name']"));
		// 默认名按「画布节点数 + 1」生成（6 台 ⇒ `h7`）；这里显式写成 `h3`，
		// 后续删除用例才对得上同一个 id，也不受假上游初始台数变化影响。
		if (createOpen)
			await labPage.locator("[data-testid='lab-node-name']").fill("h3");
		const submitted = !!createOpen && await clickIfPresent("[data-testid='lab-node-submit']");
		await labPage.waitForTimeout(1200);

		const createdWrite = upstreamServer.mininetLog.find((entry) => entry.method === "POST" && entry.path === "/api/mininet/hosts");
		const afterCreate = await labPage.evaluate(() => ({
			nodes: document.querySelectorAll("[data-testid='topology-node']").length,
			modal: !!document.querySelector("[data-testid='lab-node-name']")
		}));
		log(
			"11.4 新增主机走 POST /api/mininet/hosts，请求体带名称 / IP / 坐标且画布随之多一个节点",
			submitted
			&& !!createdWrite
			&& createdWrite.body?.name === "h3"
			&& typeof createdWrite.body?.ip === "string" && createdWrite.body.ip.length > 0
			&& typeof createdWrite.body?.x === "number" && typeof createdWrite.body?.y === "number"
			&& afterCreate.nodes === 7 && !afterCreate.modal,
			`表单=${createOpen} 提交=${submitted} 请求=${createdWrite ? JSON.stringify(createdWrite.body) : "无"} 节点=${afterCreate.nodes} 弹窗=${afterCreate.modal}`
		);

		// 拖拽新增（ADR-0022 W2 补强 / W7 迁移到右侧面板）：把类型图标拖到画布落点 → 表单带着落点坐标打开。
		// 用合成 DragEvent 覆盖页面自己的 dragstart / dragover / drop 处理，不用鼠标轨迹：
		// 无头浏览器里原生拖放不稳定，而这条链路的输入本来就是事件序列。
		const chipReady = await labPage.evaluate(() => !!document.querySelector("[data-testid='mininet-add-kind-host']"));
		const dragStartProbe = await labPage.evaluate(() => {
			const chip = document.querySelector("[data-testid='mininet-add-kind-host']");
			const svg = document.querySelector("[data-testid='topology-canvas']");
			if (!chip || !svg)
				return null;
			const rect = svg.getBoundingClientRect();
			const clientX = Math.round(rect.left + rect.width * 0.6);
			const clientY = Math.round(rect.top + rect.height * 0.6);
			const dataTransfer = new DataTransfer();
			chip.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer, clientX, clientY }));
			svg.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer, clientX, clientY }));
			return { clientX, clientY };
		});
		await labPage.waitForTimeout(200);
		const dropHintText = await labPage.evaluate(() => {
			const hint = document.querySelector("[data-testid='topology-drop-hint']");
			return hint ? (hint.textContent ?? "").trim() : "";
		});
		log(
			"11.4 右侧节点面板可拖拽：拖到画布上方出现投放提示",
			chipReady && !!dragStartProbe && dropHintText.includes("主机"),
			`面板=${chipReady} 拖拽=${!!dragStartProbe} 提示=${dropHintText || "无"}`
		);

		const dropped = await labPage.evaluate((point) => {
			const svg = document.querySelector("[data-testid='topology-canvas']");
			if (!svg || !point)
				return false;
			svg.dispatchEvent(new DragEvent("drop", {
				bubbles: true,
				cancelable: true,
				dataTransfer: new DataTransfer(),
				clientX: point.clientX,
				clientY: point.clientY
			}));
			return true;
		}, dragStartProbe);
		await labPage.waitForTimeout(400);
		const dropForm = await labPage.evaluate(() => {
			const origin = document.querySelector("[data-testid='lab-node-origin']");
			return {
				open: !!document.querySelector("[data-testid='lab-node-name']"),
				origin: origin ? (origin.textContent ?? "").trim() : "",
				hint: !!document.querySelector("[data-testid='topology-drop-hint']")
			};
		});
		const originNumbers = (dropForm.origin.match(/-?\d+/g) ?? []).map(Number);
		if (dropForm.open)
			await labPage.locator("[data-testid='lab-node-name']").fill("h9");
		const dropSubmitted = dropForm.open && await clickIfPresent("[data-testid='lab-node-submit']");
		await labPage.waitForTimeout(1200);
		const dropWrite = upstreamServer.mininetLog.find((entry) =>
			entry.method === "POST" && entry.path === "/api/mininet/hosts" && entry.body?.name === "h9");
		const afterDrop = await labPage.evaluate(() => document.querySelectorAll("[data-testid='topology-node']").length);
		// 投放必须**改写**落点：此刻 7 台已有节点，默认落点是 (400, 250)，与落点坐标不同才算按放手位置建。
		const defaultOrigin = [120 + (7 % 5) * 140, 120 + Math.floor(7 / 5) * 130];
		log(
			"11.4 拖到画布落点新增主机：表单带落点坐标，请求体 x/y 与落点一致",
			!!dropped && dropForm.open && !dropForm.hint
			&& originNumbers.length === 2
			&& dropSubmitted && !!dropWrite
			&& dropWrite.body?.x === originNumbers[0] && dropWrite.body?.y === originNumbers[1]
			&& (originNumbers[0] !== defaultOrigin[0] || originNumbers[1] !== defaultOrigin[1])
			&& afterDrop === 8,
			`落点=${dropForm.origin || "无"} 请求=${dropWrite ? JSON.stringify(dropWrite.body) : "无"} 默认落点=${defaultOrigin.join("/")} 节点=${afterDrop}`
		);

		// 拖动：画布给的是增量，页面必须落成绝对值（h1 原坐标 80/120，拖 +40/+20 ⇒ 120/140）
		await labPage.locator("[data-testid='topology-node'][data-node-id='h1']").scrollIntoViewIfNeeded();
		const nodeBox = await labPage.locator("[data-testid='topology-node'][data-node-id='h1']").boundingBox();
		if (nodeBox) {
			await labPage.mouse.move(nodeBox.x + nodeBox.width / 2, nodeBox.y + nodeBox.height / 2);
			await labPage.mouse.down();
			await labPage.mouse.move(nodeBox.x + nodeBox.width / 2 + 40, nodeBox.y + nodeBox.height / 2 + 20, { steps: 8 });
			await labPage.mouse.up();
		}
		await labPage.waitForTimeout(1200);
		const movedWrite = upstreamServer.mininetLog.find((entry) => entry.method === "POST" && entry.path === "/api/mininet/node_position");
		log(
			"11.4 拖动节点把增量落成绝对值（POST /api/mininet/node_position）",
			!!nodeBox
			&& movedWrite?.body?.node_id === "h1"
			&& Array.isArray(movedWrite.body.position)
			&& movedWrite.body.position[0] > 80 && movedWrite.body.position[1] > 120,
			movedWrite ? JSON.stringify(movedWrite.body) : (nodeBox ? "没有坐标写请求" : "没找到 h1 节点")
		);

		// 删除新增的 h3：确认弹窗必须写出 id，确认后请求 `delete_node/h3`
		await labPage.evaluate(() => {
			document.querySelector("[data-testid='topology-node'][data-node-id='h3']")
				?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		await labPage.waitForTimeout(300);
		const removeOpened = await clickIfPresent("[data-testid='mininet-remove-node']");
		await labPage.waitForTimeout(300);
		const nodesBeforeRemove = await labPage.evaluate(() => document.querySelectorAll("[data-testid='topology-node']").length);
		const confirmText = await labPage.evaluate(() =>
			(document.body.textContent ?? "").replace(/\s+/g, " ").trim()
		);
		const confirmed = removeOpened && await clickIfPresent("[data-testid='lab-remove-confirm']");
		await labPage.waitForTimeout(1200);

		const deletedWrite = upstreamServer.mininetLog.find((entry) => entry.method === "DELETE" && entry.path === "/api/mininet/delete_node/h3");
		const afterRemove = await labPage.evaluate(() => document.querySelectorAll("[data-testid='topology-node']").length);
		log(
			"11.4 删除确认写明节点 id，确认后 DELETE /api/mininet/delete_node/h3 并从画布消失",
			confirmed && confirmText.includes("h3") && !!deletedWrite && afterRemove === nodesBeforeRemove - 1,
			`确认文案含 h3=${confirmText.includes("h3")} 请求=${deletedWrite ? deletedWrite.path : "无"} 节点=${nodesBeforeRemove}→${afterRemove}`
		);

		// 流表：选中交换机后读 `GET /api/mininet/flows/sw1`，原文逐字上屏（不做解析）
		await labPage.evaluate(() => {
			document.querySelector("[data-testid='topology-node'][data-node-id='sw1']")
				?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		await labPage.waitForTimeout(800);
		const flowText = await labPage.evaluate(() =>
			document.querySelector("[data-testid='mininet-flows']")?.textContent ?? ""
		);
		log(
			"11.4 选中交换机读出流表原文（GET /api/mininet/flows/sw1）",
			flowText.includes("actions=CONTROLLER") && flowText.includes("priority=0"),
			flowText.trim().slice(0, 120) || "流表为空"
		);

		// 流表写入（W2b）：填匹配域 / 动作 / 优先级 → `POST /api/mininet/flows`，
		// 上游收到的就是这三段；重读后新行必须出现在同一块原文里。
		// 注意 `UInput type="number"` 会把 v-model 交成 number —— 曾经让 `priority.trim()`
		// 抛 TypeError、点击静默不写，这是自检真正抓到的那一处。
		const flowForm = await labPage.evaluate(() => !!document.querySelector("[data-testid='lab-flow-actions']"));
		if (flowForm) {
			await labPage.locator("[data-testid='lab-flow-match']").fill("ip,nw_dst=10.0.0.9");
			await labPage.locator("[data-testid='lab-flow-actions']").fill("output:2");
			await labPage.locator("[data-testid='lab-flow-priority']").fill("10");
		}
		const flowSubmitted = flowForm && await clickIfPresent("[data-testid='lab-flow-submit']");
		await labPage.waitForTimeout(1200);
		const flowWrite = upstreamServer.mininetLog.find((entry) => entry.method === "POST" && entry.path === "/api/mininet/flows");
		const flowAfterAdd = await labPage.evaluate(() =>
			document.querySelector("[data-testid='mininet-flows']")?.textContent ?? ""
		);
		log(
			"11.4 加流走 POST /api/mininet/flows，请求体带匹配域 / 动作 / 优先级且流表立即回显",
			flowSubmitted
			&& flowWrite?.body?.switch === "sw1"
			&& flowWrite.body.match === "ip,nw_dst=10.0.0.9"
			&& flowWrite.body.actions === "output:2"
			&& flowWrite.body.priority === 10
			&& flowAfterAdd.includes("nw_dst=10.0.0.9") && flowAfterAdd.includes("actions=output:2"),
			`表单=${flowForm} 提交=${flowSubmitted} 请求=${flowWrite ? JSON.stringify(flowWrite.body) : "无"} 流表含新行=${flowAfterAdd.includes("nw_dst=10.0.0.9")}`
		);

		// 删单条流：第一行的删除按钮 ⇒ `DELETE /api/mininet/flows/sw1/1`（1 基序号按 dump 行序），
		// 删掉的必须是 CONTROLLER 那条，刚加的 output:2 仍在。
		const flowRemoveClicked = await clickIfPresent("[data-testid='mininet-flow-remove']");
		await labPage.waitForTimeout(1200);
		const flowDeleteWrite = upstreamServer.mininetLog.find((entry) => entry.method === "DELETE" && entry.path === "/api/mininet/flows/sw1/1");
		const flowAfterRemove = await labPage.evaluate(() =>
			document.querySelector("[data-testid='mininet-flows']")?.textContent ?? ""
		);
		log(
			"11.4 删单条流走 DELETE /api/mininet/flows/sw1/1，行号与上游 dump 序一致",
			flowRemoveClicked
			&& !!flowDeleteWrite
			&& !flowAfterRemove.includes("CONTROLLER") && flowAfterRemove.includes("nw_dst=10.0.0.9"),
			`点击=${flowRemoveClicked} 请求=${flowDeleteWrite ? flowDeleteWrite.path : "无"} 残留CONTROLLER=${flowAfterRemove.includes("CONTROLLER")}`
		);

		// 本地校验先拦一道（三条分支，零请求）：动作必填 / 匹配域不许夹带 `actions=` / 优先级 0-65535。
		// 这三条必须在浏览器里就拦住 —— 发出去等上游 4xx 是另一码事，不能记成「校验通过」。
		const flowPostCount = () => upstreamServer.mininetLog
			.filter((entry) => entry.method === "POST" && entry.path === "/api/mininet/flows")
			.length;
		const flowPostsBeforeDraft = flowPostCount();
		const submitFlowDraft = async (draft) => {
			await labPage.locator("[data-testid='lab-flow-match']").fill(draft.match);
			await labPage.locator("[data-testid='lab-flow-actions']").fill(draft.actions);
			await labPage.locator("[data-testid='lab-flow-priority']").fill(String(draft.priority));
			await clickIfPresent("[data-testid='lab-flow-submit']");
			await labPage.waitForTimeout(500);
			// 就地报错的落点：`[data-slot='error']` 挂在 `UFormField` 根节点下，
			// 该字段里的 `input` 就是被判定的那个框 —— 借它证明「报错挂在出错的字段」。
			return labPage.evaluate(() => ({
				errors: [...document.querySelectorAll("[data-slot='error']")].map((node) => ({
					text: (node.textContent ?? "").trim(),
					field: node.closest("[data-slot='root']")?.querySelector("input")?.getAttribute("data-testid") ?? ""
				})),
				values: Object.fromEntries(["match", "actions", "priority"].map((key) => [key, document.querySelector(`[data-testid='lab-flow-${key}']`)?.value ?? ""]))
			}));
		};

		const emptyActionsDraft = await submitFlowDraft({ match: "ip,nw_dst=10.0.0.9", actions: "", priority: "10" });
		log(
			"11.4 加流本地校验：动作为空时就地报错且零请求",
			emptyActionsDraft.errors.length === 1
			&& emptyActionsDraft.errors[0].text === "请填写动作"
			&& emptyActionsDraft.errors[0].field === "lab-flow-actions"
			&& flowPostCount() === flowPostsBeforeDraft,
			`表单=${JSON.stringify(emptyActionsDraft.values)} 报错=${JSON.stringify(emptyActionsDraft.errors)} 请求数=${flowPostCount()}（基线 ${flowPostsBeforeDraft}）`
		);

		const matchActionsDraft = await submitFlowDraft({ match: "actions=output:1", actions: "output:2", priority: "10" });
		log(
			"11.4 加流本地校验：匹配域夹带 actions= 时就地报错且零请求",
			matchActionsDraft.errors.length === 1
			&& matchActionsDraft.errors[0].text === "匹配域不能包含 actions="
			&& matchActionsDraft.errors[0].field === "lab-flow-match"
			&& flowPostCount() === flowPostsBeforeDraft,
			`表单=${JSON.stringify(matchActionsDraft.values)} 报错=${JSON.stringify(matchActionsDraft.errors)} 请求数=${flowPostCount()}（基线 ${flowPostsBeforeDraft}）`
		);

		// 70000 是 5 位整数，卡的是上界而不是位数：正则放行、`> 65535` 拦下。
		const overflowDraft = await submitFlowDraft({ match: "ip,nw_dst=10.0.0.9", actions: "output:2", priority: "70000" });
		log(
			"11.4 加流本地校验：优先级超过 65535 时就地报错且零请求",
			overflowDraft.errors.length === 1
			&& overflowDraft.errors[0].text === "优先级必须是 0-65535 的整数"
			&& overflowDraft.errors[0].field === "lab-flow-priority"
			&& flowPostCount() === flowPostsBeforeDraft,
			`表单=${JSON.stringify(overflowDraft.values)} 报错=${JSON.stringify(overflowDraft.errors)} 请求数=${flowPostCount()}（基线 ${flowPostsBeforeDraft}）`
		);

		// 清流（批量 `DELETE /flows`，W2b）：本地只拦「匹配域夹带 actions=」一条 ——
		// 留空是合法的（清整表），所以不能套用加流那套「动作必填」校验。
		const flowBulkDeleteCount = () => upstreamServer.mininetLog
			.filter((entry) => entry.method === "DELETE" && entry.path === "/api/mininet/flows")
			.length;
		const clearBaseline = flowBulkDeleteCount();
		const clearEnabled = await labPage.evaluate(() => {
			const button = document.querySelector("[data-testid='mininet-flow-clear']");
			return !!button && !button.hasAttribute("disabled");
		});
		const clearOpened = clearEnabled && await clickIfPresent("[data-testid='mininet-flow-clear']");
		await labPage.waitForTimeout(400);
		const clearMatchForm = await labPage.evaluate(() => !!document.querySelector("[data-testid='lab-flow-clear-match']"));
		if (clearMatchForm)
			await labPage.locator("[data-testid='lab-flow-clear-match']").fill("actions=output:1");
		await clickIfPresent("[data-testid='lab-flow-clear-confirm']");
		await labPage.waitForTimeout(500);
		// 报错要落在弹窗自己那个输入框上：加流表单的旧报错可能还挂着，所以按「报错所在的
		// `UFormField` 里那个 input」认领 —— 只取 `lab-flow-clear-match` 那一条，不看全页数量。
		const clearInvalid = await labPage.evaluate(() => {
			const input = document.querySelector("[data-testid='lab-flow-clear-match']");
			const errors = [...document.querySelectorAll("[data-slot='error']")].map((node) => ({
				text: (node.textContent ?? "").trim(),
				field: node.closest("[data-slot='root']")?.querySelector("input")?.getAttribute("data-testid") ?? ""
			})).filter((item) => item.field === "lab-flow-clear-match");
			return {
				open: !!input,
				errors,
				value: input?.value ?? ""
			};
		});
		log(
			"11.4 清流本地校验：匹配域夹带 actions= 时弹窗就地报错、不关闭且零请求",
			clearEnabled && clearOpened && clearMatchForm && clearInvalid.open
			&& clearInvalid.errors.length === 1
			&& clearInvalid.errors[0].text === "匹配域不能包含 actions="
			&& clearInvalid.value === "actions=output:1"
			&& flowBulkDeleteCount() === clearBaseline,
			`按钮可用=${clearEnabled} 弹窗=${clearInvalid.open} 报错=${JSON.stringify(clearInvalid.errors)} 批量删除请求=${flowBulkDeleteCount()}（基线 ${clearBaseline}）`
		);

		// 清空整表：匹配域清空后确认 ⇒ `DELETE /api/mininet/flows` 只带 `switch`（不带 `match`），
		// 上游按 `del-flows <sw>` 清空，重读后流表块消失、空态文案出现。
		if (clearInvalid.open)
			await labPage.locator("[data-testid='lab-flow-clear-match']").fill("");
		await clickIfPresent("[data-testid='lab-flow-clear-confirm']");
		await labPage.waitForTimeout(1200);
		const clearWrite = upstreamServer.mininetLog.find((entry) => entry.method === "DELETE" && entry.path === "/api/mininet/flows");
		const flowsAfterClear = await labPage.evaluate(() =>
			document.querySelector("[data-testid='mininet-flows']")?.textContent ?? ""
		);
		const emptyFlowText = await labPage.evaluate(() =>
			(document.querySelector("[data-testid='mininet-flow-empty']")?.textContent ?? "").trim()
		);
		log(
			"11.4 清空整表走 DELETE /api/mininet/flows，请求体只有 switch，流表清空并显示空态",
			flowBulkDeleteCount() === clearBaseline + 1
			&& clearWrite?.body?.switch === "sw1"
			&& !Object.hasOwn(clearWrite?.body ?? {}, "match")
			&& flowsAfterClear === ""
			&& emptyFlowText.length > 0,
			`请求=${clearWrite ? JSON.stringify(clearWrite.body) : "无"} 流表=${JSON.stringify(flowsAfterClear.slice(0, 60))} 空态=${JSON.stringify(emptyFlowText)}`
		);

		// 带匹配域批量删流：清空后没有可删的行，按钮是禁用的，所以先补一条流；
		// 再只按 `match` 删 —— 请求体必须原样带上匹配域，否则删的就是整表。
		await labPage.locator("[data-testid='lab-flow-match']").fill("ip,nw_dst=10.2.2.2");
		await labPage.locator("[data-testid='lab-flow-actions']").fill("output:3");
		await labPage.locator("[data-testid='lab-flow-priority']").fill("20");
		await clickIfPresent("[data-testid='lab-flow-submit']");
		await labPage.waitForTimeout(1200);
		const reseededFlows = await labPage.evaluate(() =>
			document.querySelector("[data-testid='mininet-flows']")?.textContent ?? ""
		);
		const scopedOpened = await clickIfPresent("[data-testid='mininet-flow-clear']");
		await labPage.waitForTimeout(400);
		const scopedForm = await labPage.evaluate(() => !!document.querySelector("[data-testid='lab-flow-clear-match']"));
		if (scopedForm)
			await labPage.locator("[data-testid='lab-flow-clear-match']").fill("ip,nw_dst=10.2.2.2");
		await clickIfPresent("[data-testid='lab-flow-clear-confirm']");
		await labPage.waitForTimeout(1200);
		const bulkDeletes = upstreamServer.mininetLog
			.filter((entry) => entry.method === "DELETE" && entry.path === "/api/mininet/flows");
		const scopedWrite = bulkDeletes[bulkDeletes.length - 1];
		const flowsAfterScoped = await labPage.evaluate(() =>
			document.querySelector("[data-testid='mininet-flows']")?.textContent ?? ""
		);
		const reseedOk = reseededFlows.includes("nw_dst=10.2.2.2");
		log(
			"11.4 带匹配域批量删流：请求体原样透传 match，命中行删掉且流表回到空态",
			reseedOk
			&& scopedOpened && scopedForm
			&& bulkDeletes.length === clearBaseline + 2
			&& scopedWrite?.body?.switch === "sw1"
			&& scopedWrite?.body?.match === "ip,nw_dst=10.2.2.2"
			&& flowsAfterScoped === "",
			`补流=${reseedOk} 弹窗=${scopedForm} 请求=${scopedWrite ? JSON.stringify(scopedWrite.body) : "无"} 流表=${JSON.stringify(flowsAfterScoped.slice(0, 60))}`
		);

		// ── 11.4 运行控制（NMCPS-ADR-0022 W3）：start / stop / pingall / iperf ──
		// 运行态读 `GET /api/mininet/start`（上游裸布尔）。三态是刻意的：读不到 ≠ 已停止，
		// 所以「已停止」只有真的读到 `false` 才出现；按钮可用性跟着它走，
		// 否则「没启动却点了探测」会以 400 的形式被当成「功能坏了」。
		//
		// 启动 / 停止 / 重启 / 重建自 W10 起常驻画布**左侧设备栏顶部**（原工具栏「运行」菜单已
		// 删除，一条动作只有一个入口），所以自检直接点 `mininet-run-*` 按钮；可用性读原生
		// `disabled`（UButton 渲染成 `<button>`），不再去查 Reka 菜单项的 `data-disabled`。
		const runButtonState = async (testId) => labPage.evaluate((id) => {
			const node = document.querySelector(`[data-testid='${id}']`);
			if (!node)
				return { present: false, disabled: true };
			return {
				present: true,
				disabled: node.disabled === true || node.getAttribute("aria-disabled") === "true"
			};
		}, testId);
		const runPick = async (testId) => {
			const picked = await clickIfPresent(`[data-testid='${testId}']`);
			await labPage.waitForTimeout(250);
			return picked;
		};
		/**
		 * 工具栏「网络」读数：读的是**台账** `state`（i18n 后是「运行中」/「已停止」），
		 * 与「连通」页的 `mininet-run-state`（上游裸布尔）是两个真源。
		 * 2026-11-20 逐条复验时两者长期不一致：台账从不随 `start` / `stop` 写回，
		 * 网停了读数还停在 `running`。这里两边都钉住，缺一条就是这个回归又回来了。
		 */
		const networkStatText = async () => labPage.evaluate(() =>
			(document.querySelector("[data-testid='mininet-stat-network']")?.textContent ?? "").replace(/\s+/g, " ").trim());
		const runMenuProbe = async () => {
			const [start, stop, restart, reset] = await Promise.all([
				runButtonState("mininet-run-start"),
				runButtonState("mininet-run-stop"),
				runButtonState("mininet-run-restart"),
				runButtonState("mininet-reset-network")
			]);
			const state = await labPage.evaluate(() =>
				(document.querySelector("[data-testid='mininet-run-state']")?.textContent ?? "").trim());
			return {
				state,
				present: { start: start.present, stop: stop.present, restart: restart.present, reset: reset.present },
				startDisabled: !start.present || start.disabled,
				stopDisabled: !stop.present || stop.disabled,
				restartDisabled: !restart.present || restart.disabled,
				resetDisabled: !reset.present || reset.disabled
			};
		};

		// 右栏五标签后，运行态徽章与探测 / 测速表单都在「连通」标签里
		const connectivityOpened = await openSideTab("连通");
		const runBefore = await runMenuProbe();
		const runReadout = await labPage.evaluate(() =>
			(document.querySelector("[data-testid='mininet-run-state']")?.textContent ?? "").trim());
		log(
			"11.4 运行控制读 GET /api/mininet/start：初始已停止，启动可点而停止 / 重启 / 探测禁用",
			connectivityOpened && runReadout === "已停止"
			&& runBefore.state === "已停止"
			&& runBefore.present.start && runBefore.present.stop && runBefore.present.restart
			&& runBefore.present.reset
			&& !runBefore.startDisabled && runBefore.stopDisabled && runBefore.restartDisabled
			// 重建与运行态无关（`full_reset` 对停着的网同样有效），只受 `runBusy` 约束
			&& !runBefore.resetDisabled,
			`状态=${runBefore.state} 按钮=${JSON.stringify(runBefore.present)} 启动禁用=${runBefore.startDisabled} 停止禁用=${runBefore.stopDisabled} 重启禁用=${runBefore.restartDisabled} 重建禁用=${runBefore.resetDisabled}`
		);

		const startClicked = await runPick("mininet-run-start");
		await labPage.waitForTimeout(1500);
		const startWrite = upstreamServer.mininetLog.find((entry) => entry.method === "POST" && entry.path === "/api/mininet/start");
		const runRunning = await runMenuProbe();
		const networkRunningStat = await networkStatText();
		log(
			"11.4 启动走 POST /api/mininet/start，徽章变为运行中且停止 / 重启 / 探测转为可用",
			startClicked && !!startWrite
			&& runRunning.state === "运行中"
			&& networkRunningStat.includes("运行中")
			&& runRunning.startDisabled && !runRunning.stopDisabled && !runRunning.restartDisabled,
			`请求=${startWrite ? startWrite.path : "无"} 状态=${runRunning.state} 台账=${networkRunningStat} 启动禁用=${runRunning.startDisabled} 停止禁用=${runRunning.stopDisabled} 重启禁用=${runRunning.restartDisabled}`
		);

		const pingClicked = await clickIfPresent("[data-testid='mininet-run-ping']");
		await labPage.waitForTimeout(1500);
		const pingWrite = upstreamServer.mininetLog.find((entry) => entry.method === "POST" && entry.path === "/api/mininet/pingall");
		const pingText = await labPage.evaluate(() =>
			(document.querySelector("[data-testid='mininet-run-ping-output']")?.textContent ?? "").trim()
		);
		log(
			"11.4 连通性走 POST /api/mininet/pingall，上游文本逐行上屏",
			pingClicked && !!pingWrite
			&& pingText.includes("h1->h2") && pingText.includes("rtt min/avg/max/mdev"),
			`请求=${pingWrite ? pingWrite.path : "无"} 输出=${JSON.stringify(pingText.slice(0, 80))}`
		);

		/** USelect 的选项在浮层里（`role="option"`）：点开触发器再按名字选 */
		const pickSelect = async (testId, name) => {
			const opened = await clickIfPresent(`[data-testid='${testId}']`);
			if (!opened)
				return false;
			await labPage.waitForTimeout(250);
			const chosen = await clickIfPresent(labPage.getByRole("option", { name, exact: true }));
			await labPage.waitForTimeout(250);
			return chosen;
		};
		const iperfPostCount = () => upstreamServer.mininetLog
			.filter((entry) => entry.method === "POST" && entry.path === "/api/mininet/iperf")
			.length;
		const iperfBaseline = iperfPostCount();

		const clientPicked = await pickSelect("mininet-iperf-client", "h1");
		const serverSame = await pickSelect("mininet-iperf-server", "h1");
		const sameSubmitted = await clickIfPresent("[data-testid='mininet-iperf-submit']");
		await labPage.waitForTimeout(500);
		const sameErrors = await labPage.evaluate(() => [...document.querySelectorAll("[data-slot='error']")]
			.map((node) => (node.textContent ?? "").trim())
			.filter(Boolean));
		log(
			"11.4 吞吐测试本地校验：两端选成同一台主机时就地报错且零请求",
			clientPicked && serverSame && sameSubmitted
			&& sameErrors.includes("客户端与服务端不能是同一台主机")
			&& iperfPostCount() === iperfBaseline,
			`客户端=${clientPicked} 服务端=${serverSame} 报错=${JSON.stringify(sameErrors)} 请求数=${iperfPostCount()}（基线 ${iperfBaseline}）`
		);

		const serverPicked = await pickSelect("mininet-iperf-server", "h2");
		await labPage.locator("[data-testid='mininet-iperf-seconds']").fill("3");
		const iperfSubmitted = await clickIfPresent("[data-testid='mininet-iperf-submit']");
		await labPage.waitForTimeout(1500);
		const iperfWrites = upstreamServer.mininetLog
			.filter((entry) => entry.method === "POST" && entry.path === "/api/mininet/iperf");
		const iperfWrite = iperfWrites[iperfWrites.length - 1];
		const iperfText = await labPage.evaluate(() => [
			document.querySelector("[data-testid='mininet-iperf-client-output']")?.textContent ?? "",
			document.querySelector("[data-testid='mininet-iperf-server-output']")?.textContent ?? ""
		].join(" | ").trim());
		log(
			"11.4 吞吐测试走 POST /api/mininet/iperf：请求体带两端 / 协议 / 秒数，两侧输出上屏",
			serverPicked && iperfSubmitted
			&& iperfWrite?.body?.client === "h1" && iperfWrite?.body?.server === "h2"
			&& iperfWrite?.body?.l4_type === "TCP" && iperfWrite?.body?.seconds === 3
			&& iperfText.includes("1.02 Gbits/sec") && iperfText.includes("done"),
			`请求=${iperfWrite ? JSON.stringify(iperfWrite.body) : "无"} 输出=${JSON.stringify(iperfText.slice(0, 100))}`
		);

		const stopOpened = await runPick("mininet-run-stop");
		await labPage.waitForTimeout(400);
		const stopModalText = await labPage.evaluate(() => (document.body.textContent ?? "").replace(/\s+/g, " ").trim());
		const stopConfirmed = stopOpened && await clickIfPresent("[data-testid='mininet-run-stop-confirm']");
		await labPage.waitForTimeout(1500);
		const stopWrite = upstreamServer.mininetLog.find((entry) => entry.method === "POST" && entry.path === "/api/mininet/stop");
		const runStopped = await runMenuProbe();
		const networkStoppedStat = await networkStatText();
		log(
			"11.4 停止需确认（弹窗写明后果），确认后 POST /api/mininet/stop 且徽章与台账都回到已停止",
			stopOpened && stopModalText.includes("停止会终止全部节点进程")
			&& stopConfirmed && !!stopWrite
			&& runStopped.state === "已停止" && networkStoppedStat.includes("已停止")
			&& !runStopped.startDisabled && runStopped.stopDisabled,
			`弹窗=${stopOpened} 确认=${stopConfirmed} 请求=${stopWrite ? stopWrite.path : "无"} 状态=${runStopped.state} 台账=${networkStoppedStat} 启动禁用=${runStopped.startDisabled}`
		);

		// ── 11.4 菜单栏（复刻 1.0 版式的「视图」，NMCPS-ADR-0022 W2 修订 / W10）──
		// 「视图」是四个 checkbox 项（Reka 的 `role="menuitemcheckbox"`），点完菜单不收起；
		// 「运行」菜单在 W10 已被设备栏顶部的常驻按钮取代，启停 / 重启在上面钉过，
		// 这里补「重启 = 停止 + 启动」（按钮同样是设备栏顶部那一个入口）。
		const openViewMenu = async () => {
			const opened = await clickIfPresent("[data-testid='mininet-view-menu']");
			if (opened)
				await labPage.waitForTimeout(250);
			return opened;
		};
		const viewMenuLabels = async () => {
			const opened = await openViewMenu();
			const labels = opened
				? await labPage.evaluate(() => [...document.querySelectorAll("[role='menuitemcheckbox']")]
					.map((node) => (node.textContent ?? "").trim()))
				: [];
			if (opened)
				await labPage.keyboard.press("Escape");
			await labPage.waitForTimeout(150);
			return labels;
		};
		const viewToggle = async (label) => {
			const opened = await openViewMenu();
			if (!opened)
				return false;
			const picked = await clickIfPresent(labPage.getByRole("menuitemcheckbox", { name: label, exact: true }));
			await labPage.waitForTimeout(350);
			await labPage.keyboard.press("Escape");
			await labPage.waitForTimeout(200);
			return picked;
		};
		const canvasProbe = () => labPage.evaluate(() => ({
			nodes: document.querySelectorAll("[data-testid='topology-node']").length,
			labels: [...document.querySelectorAll("[data-testid='topology-node-label']")]
				.map((node) => (node.textContent ?? "").trim())
		}));

		const viewLabels = await viewMenuLabels();
		log(
			"11.4 工具栏最左是复刻的「视图」菜单：「视图」四项显示开关齐全",
			viewLabels.includes("显示名称") && viewLabels.includes("显示主机")
			&& viewLabels.includes("显示控制器") && viewLabels.includes("显示主机 IP"),
			`菜单项=${JSON.stringify(viewLabels)}`
		);

		const canvasAll = await canvasProbe();
		const hostLabels = canvasAll.labels.filter((label) => /^h\d/.test(label));
		const hostsToggledOff = await viewToggle("显示主机");
		const canvasNoHosts = await canvasProbe();
		const hostsToggledOn = await viewToggle("显示主机");
		const canvasHostsBack = await canvasProbe();
		log(
			"11.4 视图「显示主机」只在渲染层过滤：主机节点消失、链路跟着走，切回即恢复",
			hostsToggledOff && hostsToggledOn && hostLabels.length > 0
			&& canvasNoHosts.nodes === canvasAll.nodes - hostLabels.length
			&& !canvasNoHosts.labels.some((label) => /^h\d/.test(label))
			&& canvasHostsBack.nodes === canvasAll.nodes,
			`全量=${canvasAll.nodes} 主机=${hostLabels.length} 关主机=${canvasNoHosts.nodes} 恢复=${canvasHostsBack.nodes} 关后标签=${JSON.stringify(canvasNoHosts.labels)}`
		);

		const ipToggledOn = await viewToggle("显示主机 IP");
		const labelsWithIp = (await canvasProbe()).labels.filter((label) => /10\.0\.0\.\d/.test(label));
		const ipToggledOff = await viewToggle("显示主机 IP");
		const labelsWithoutIp = (await canvasProbe()).labels.filter((label) => /10\.0\.0\.\d/.test(label));
		log(
			"11.4 视图「显示主机 IP」给主机标签补注 IP，切回即恢复纯名称",
			ipToggledOn && ipToggledOff && labelsWithIp.length > 0 && labelsWithoutIp.length === 0,
			`带 IP=${JSON.stringify(labelsWithIp)} 关闭后=${JSON.stringify(labelsWithoutIp)}`
		);

		const mininetWriteCount = (method, writePath) => upstreamServer.mininetLog
			.filter((entry) => entry.method === method && entry.path === writePath)
			.length;
		const restartBaseline = {
			start: mininetWriteCount("POST", "/api/mininet/start"),
			stop: mininetWriteCount("POST", "/api/mininet/stop")
		};
		const restartStarted = await runPick("mininet-run-start");
		await labPage.waitForTimeout(1200);
		const restartPicked = await runPick("mininet-run-restart");
		await labPage.waitForTimeout(400);
		const restartModalText = await labPage.evaluate(() => (document.body.textContent ?? "").replace(/\s+/g, " ").trim());
		const restartConfirmed = restartPicked && await clickIfPresent("[data-testid='mininet-run-stop-confirm']");
		await labPage.waitForTimeout(2500);
		const runAfterRestart = await runMenuProbe();
		log(
			"11.4 重启 = 停止 + 启动：确认后依次发出 POST /stop 与 POST /start，徽章回到运行中",
			restartStarted && restartPicked && restartConfirmed
			&& restartModalText.includes("重启 = 先停止再启动")
			&& mininetWriteCount("POST", "/api/mininet/stop") === restartBaseline.stop + 1
			&& mininetWriteCount("POST", "/api/mininet/start") === restartBaseline.start + 2
			&& runAfterRestart.state === "运行中",
			`启动=${restartStarted} 重启=${restartPicked} 确认=${restartConfirmed} stop=${mininetWriteCount("POST", "/api/mininet/stop") - restartBaseline.stop} start=${mininetWriteCount("POST", "/api/mininet/start") - restartBaseline.start} 状态=${runAfterRestart.state}`
		);

		// ── 11.5 「文件」菜单（NMCPS-ADR-0022 W4：导入拓扑 / 导出 JSON / 导出 Python 脚本）──
		// 导出为什么单列：它不是 `ApiResponse`，而是原样的文本 + `content-disposition`；
		// 自检必须看到「另存下来的文件就是拓扑 / 源码」，而不是被信封包过的字符串。
		const fileMenuLabels = async () => {
			const opened = await clickIfPresent("[data-testid='mininet-file-menu']");
			if (opened)
				await labPage.waitForTimeout(250);
			const labels = opened
				? await labPage.evaluate(() => [...document.querySelectorAll("[role='menuitem']")]
					.map((node) => (node.textContent ?? "").trim()))
				: [];
			if (opened)
				await labPage.keyboard.press("Escape");
			await labPage.waitForTimeout(150);
			return labels;
		};
		const pickFileItem = async (name) => {
			const opened = await clickIfPresent("[data-testid='mininet-file-menu']");
			if (!opened)
				return false;
			await labPage.waitForTimeout(250);
			return clickIfPresent(labPage.getByRole("menuitem", { name, exact: true }));
		};

		const fileItems = await fileMenuLabels();
		log(
			"11.5 工具栏最左的「文件」菜单：导入 / 导出 JSON / 导出脚本 / 导出 PNG / 地址规划 / 台账对账 / 设置七项齐全",
			fileItems.length === 7
			&& fileItems.some((label) => label.includes("导入拓扑"))
			&& fileItems.some((label) => label.includes("导出 JSON"))
			&& fileItems.some((label) => label.includes("导出 Python 脚本"))
			&& fileItems.some((label) => label.includes("导出拓扑 PNG"))
			&& fileItems.some((label) => label.includes("导出地址规划"))
			&& fileItems.some((label) => label.includes("台账对账"))
			&& fileItems.some((label) => label.includes("设置")),
			`菜单项=${JSON.stringify(fileItems)}`
		);

		const canvasBeforeImport = await canvasProbe();
		const importHitsBefore = upstreamServer.mininetLog.filter((entry) => entry.path === "/api/mininet/import_json").length;
		await labPage.locator("[data-testid='mininet-import-input']").setInputFiles({
			name: "topo.json",
			mimeType: "application/json",
			buffer: Buffer.from(JSON.stringify({ hosts: [{ name: "h7", ip: "10.0.0.7" }], switches: [], links: [] }))
		});
		await labPage.waitForTimeout(2500);
		const importHit = upstreamServer.mininetLog.filter((entry) => entry.path === "/api/mininet/import_json").at(-1);
		const canvasAfterImport = await canvasProbe();
		const bodyAfterImport = await labPage.evaluate(() => (document.body.textContent ?? "").replace(/\s+/g, " ").trim());
		log(
			"11.5 导入：按 multipart 发往上游（上游只收 `file` 字段），画布出现新节点",
			upstreamServer.mininetLog.filter((entry) => entry.path === "/api/mininet/import_json").length === importHitsBefore + 1
			&& String(importHit?.contentType ?? "").startsWith("multipart/form-data")
			&& String(importHit?.raw ?? "").includes("name=\"file\"")
			&& canvasAfterImport.nodes > canvasBeforeImport.nodes
			&& bodyAfterImport.includes("拓扑已导入"),
			`nodes ${canvasBeforeImport.nodes}→${canvasAfterImport.nodes} contentType=${importHit?.contentType}`
		);

		const exportOnce = async (name) => {
			const [download] = await Promise.all([
				labPage.waitForEvent("download", { timeout: 15000 }),
				(async () => {
					const picked = await pickFileItem(name);
					if (!picked)
						throw new Error(`没能点中「${name}」`);
				})()
			]);
			const filePath = await download.path();
			return {
				name: download.suggestedFilename(),
				text: filePath ? readFileSync(filePath, "utf8") : ""
			};
		};

		const exportedJson = await exportOnce("导出 JSON");
		log(
			"11.5 导出 JSON：文件名由 BFF 生成、正文是拓扑原文（不套 JSON 信封）",
			/^lab-.+-\d{8}T\d{6}Z\.json$/.test(exportedJson.name)
			&& exportedJson.text.trimStart().startsWith("{")
			&& exportedJson.text.includes("\"hosts\"")
			&& !exportedJson.text.includes("\"code\": 0"),
			`文件=${exportedJson.name} 头部=${exportedJson.text.slice(0, 24).replace(/\s+/g, " ")}`
		);

		const exportedScript = await exportOnce("导出 Python 脚本");
		log(
			"11.5 导出脚本：扩展名 .py、正文是 Python 源码",
			exportedScript.name.endsWith(".py") && exportedScript.text.startsWith("from mininet.topo import Topo"),
			`文件=${exportedScript.name} 头部=${exportedScript.text.split("\n")[0]}`
		);

		// 二进制下载要用字节比对：`readFileSync(path, "utf8")` 会把 PNG / pcap 解成 U+FFFD，
		// 魔数永远对不上 —— 这条与 11.6 的 pcap 用例同一口径。
		const exportBytesOnce = async (name) => {
			const [download] = await Promise.all([
				labPage.waitForEvent("download", { timeout: 15000 }),
				(async () => {
					const picked = await pickFileItem(name);
					if (!picked)
						throw new Error(`没能点中「${name}」`);
				})()
			]);
			const filePath = await download.path();
			return { name: download.suggestedFilename(), bytes: filePath ? readFileSync(filePath) : Buffer.alloc(0) };
		};

		/*
		 * 11.5b 导出拓扑 PNG（NMCPS-ADR-0022 W9 第 1 项）：**纯前端**，画布 SVG 序列化 →
		 * 内联计算样式 → `<img>` → `<canvas>` → Blob，不经过 BFF 的导出通道，也不读上游。
		 * 断言两件事：另存下来的是**真 PNG**（魔数 + 非空字节），且这次点击零上游写 ——
		 * 把「浏览器生成」混进 JSON / 文本导出的断言里，就看不出它到底走没走网络。
		 */
		const pngWriteBaseline = upstreamServer.mininetLog.length;
		const exportedPng = await exportBytesOnce("导出拓扑 PNG");
		const exportedPngWrites = upstreamServer.mininetLog.length - pngWriteBaseline;
		log(
			"11.5b 导出拓扑 PNG：浏览器直接生成真 PNG（魔数 89504e47），全程零上游写",
			/^lab-topology-\d{8}T\d{6}Z\.png$/.test(exportedPng.name)
			&& exportedPng.bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47]))
			&& exportedPng.bytes.length > 1000
			&& exportedPngWrites === 0,
			`文件=${exportedPng.name} 大小=${exportedPng.bytes.length}B 魔数=${exportedPng.bytes.subarray(0, 4).toString("hex")} 上游写=${exportedPngWrites}`
		);

		/*
		 * 11.5c 导出地址规划（W9 第 2 项）：走 `GET /api/mininet/addressing_plan`（`lab:read`），
		 * 正文是上游原文 `{ generated_at, nodes: [...] }`，由页面落成 JSON 下载 ——
		 * 不是 BFF 的导出通道（没有 `content-disposition`），所以文件名由页面给。
		 * 假上游在未启动时按真实上游回 400：这条用例能过，就等于证明「读的是正在跑的网络」。
		 */
		const planReadBaseline = upstreamServer.mininetReadLog.length;
		const exportedPlan = await exportOnce("导出地址规划（JSON）");
		const planReads = upstreamServer.mininetReadLog
			.slice(planReadBaseline)
			.filter((entry) => entry.path === "/api/mininet/addressing_plan");
		const planBody = (() => {
			try {
				return JSON.parse(exportedPlan.text);
			} catch {
				return undefined;
			}
		})();
		log(
			"11.5c 导出地址规划：读 GET /api/mininet/addressing_plan，正文是上游原文（不套信封）",
			/^lab-addressing-\d{8}T\d{6}Z\.json$/.test(exportedPlan.name)
			&& planReads.length === 1
			&& Array.isArray(planBody?.nodes) && planBody.nodes.length > 0
			&& Array.isArray(planBody.nodes[0]?.intfs)
			&& typeof planBody?.generated_at === "string"
			&& !exportedPlan.text.includes("\"code\": 0"),
			`文件=${exportedPlan.name} 上游读=${planReads.length} 节点=${planBody?.nodes?.length ?? "无"} 头部=${exportedPlan.text.slice(0, 24).replace(/\s+/g, " ")}`
		);

		/*
		 * 11.5d 生成拓扑（W9 第 3 项）：表单只收参数，页面按 `labGeneratePlan()` 的计划
		 * **串行**写（D5：单网络只允许一个在途写，并发必 409）。断言比对的是上游写日志的
		 * **顺序**，不是总数：先交换机、再主机、链路最后 —— 顺序反了链路两端还不存在。
		 * Linear + 2 交换机 + 每台 1 主机 = 4 节点、3 条链路（1 条级联 + 2 条主机）。
		 */
		const generateBefore = await canvasProbe();
		const generateLogBaseline = upstreamServer.mininetLog.length;
		await clickIfPresent("[data-testid='mininet-generate-topology']");
		await labPage.waitForSelector("[data-testid='lab-generate-shape']", { timeout: 10000 }).catch(() => {});
		await labPage.waitForTimeout(300);
		await clickIfPresent("[data-testid='lab-generate-shape']");
		await labPage.waitForTimeout(250);
		const generateShapePicked = await clickIfPresent(labPage.getByRole("option", { name: /Linear/ }));
		await labPage.waitForTimeout(250);
		await labPage.locator("[data-testid='lab-generate-switches']").fill("2", { timeout: 5000 }).catch(() => {});
		await labPage.locator("[data-testid='lab-generate-hosts-per-switch']").fill("1", { timeout: 5000 }).catch(() => {});
		await labPage.waitForTimeout(250);
		const generateSummary = await labPage.evaluate(() =>
			(document.querySelector("[data-testid='lab-generate-summary']")?.textContent ?? "").replace(/\s+/g, " ").trim());
		const generateSubmitted = await clickIfPresent("[data-testid='lab-generate-submit']");
		await labPage.waitForTimeout(3000);
		const generateWrites = upstreamServer.mininetLog.slice(generateLogBaseline)
			.filter((entry) => entry.method === "POST")
			.map((entry) => entry.path.replace("/api/mininet/", ""));
		const generateAfter = await canvasProbe();
		const generateModalClosed = await labPage.locator("[data-testid='lab-generate-shape']").count() === 0;
		log(
			"11.5d 生成拓扑：按「交换机 → 主机 → 链路」串行写 4 节点 3 链路，画布重读台账",
			generateShapePicked && generateSubmitted
			&& generateSummary.includes("4")
			&& JSON.stringify(generateWrites) === JSON.stringify(["switches", "switches", "hosts", "hosts", "links", "links", "links"])
			&& generateAfter.nodes === generateBefore.nodes + 4
			&& generateModalClosed,
			`摘要=${generateSummary || "无"} 写入=${JSON.stringify(generateWrites)} nodes ${generateBefore.nodes}→${generateAfter.nodes}`
		);

		// ── 11.6 「工具」菜单（NMCPS-ADR-0022 W5：抓包启停 + pcap 下载）与破坏性重建 ──
		// 抓包是**独立授权位**：`lab:sniffer` 不在租户管理员的默认权限里，BFF 的导出通道也
		// 按种类判权限（pcap 要 sniffer，json / script 只要 read）。自检账号另挂一条
		// `r_lab_sniffer`（见 `scripts/lib/bff-harness.mjs`），否则「工具」菜单根本不该出现。
		const openToolsMenu = async () => {
			const opened = await clickIfPresent("[data-testid='mininet-tools-menu']");
			if (opened)
				await labPage.waitForTimeout(250);
			return opened;
		};
		const toolMenuLabels = async () => {
			const opened = await openToolsMenu();
			const labels = opened
				? await labPage.evaluate(() => [...document.querySelectorAll("[role='menuitem']")]
					.map((node) => (node.textContent ?? "").trim()))
				: [];
			if (opened)
				await labPage.keyboard.press("Escape");
			await labPage.waitForTimeout(150);
			return labels;
		};
		const pickToolItem = async (name) => {
			const opened = await openToolsMenu();
			if (!opened)
				return false;
			await labPage.waitForTimeout(250);
			return clickIfPresent(labPage.getByRole("menuitem", { name, exact: true }));
		};
		const snifferReadout = () => labPage.evaluate(() =>
			(document.querySelector("[data-testid='mininet-sniffer-state']")?.textContent ?? "").replace(/\s+/g, " ").trim());

		const toolLabels = await toolMenuLabels();
		const snifferIdle = await snifferReadout();
		log(
			"11.6 有 lab:sniffer 时渲染「工具」菜单（开始 / 停止 / 下载），读数为未抓包",
			toolLabels.length === 3
			&& toolLabels.some((label) => label.includes("开始抓包"))
			&& toolLabels.some((label) => label.includes("停止抓包"))
			&& toolLabels.some((label) => label.includes("下载抓包"))
			&& snifferIdle.includes("未抓包"),
			`菜单项=${JSON.stringify(toolLabels)} 读数=${snifferIdle}`
		);

		const snifferStartsBefore = upstreamServer.mininetLog
			.filter((entry) => entry.method === "POST" && entry.path === "/api/mininet/sniffer/start")
			.length;
		const sniffStartPicked = await pickToolItem("开始抓包");
		await labPage.waitForTimeout(1500);
		const snifferRunning = await snifferReadout();
		const snifferStartsAfter = upstreamServer.mininetLog
			.filter((entry) => entry.method === "POST" && entry.path === "/api/mininet/sniffer/start")
			.length;
		log(
			"11.6 开始抓包走 POST /api/mininet/sniffer/start，读数变为抓包中",
			sniffStartPicked && snifferStartsAfter === snifferStartsBefore + 1 && snifferRunning.includes("抓包中"),
			`读数=${snifferRunning}`
		);

		// pcap 下载：文件名来自 BFF，正文必须是二进制魔数（`text()` 解一次就废）
		const [captureDownload] = await Promise.all([
			labPage.waitForEvent("download", { timeout: 15000 }),
			(async () => {
				const picked = await pickToolItem("下载抓包文件（pcap）");
				if (!picked)
					throw new Error("没能点中「下载抓包文件（pcap）」");
			})()
		]);
		const capturePath = await captureDownload.path();
		const captureBytes = capturePath ? readFileSync(capturePath) : Buffer.alloc(0);
		log(
			"11.6 pcap 下载：文件名由 BFF 生成、正文魔数 d4c3b2a1（二进制未被文本化）",
			/^lab-.+-\d{8}T\d{6}Z\.pcap$/.test(captureDownload.suggestedFilename())
			&& captureBytes.subarray(0, 4).equals(Buffer.from([0xD4, 0xC3, 0xB2, 0xA1])),
			`文件=${captureDownload.suggestedFilename()} 魔数=${captureBytes.subarray(0, 4).toString("hex")}`
		);

		const sniffStopPicked = await pickToolItem("停止抓包");
		await labPage.waitForTimeout(1500);
		const snifferStopped = await snifferReadout();
		log(
			"11.6 停止抓包走 POST /api/mininet/sniffer/stop，读数回到未抓包",
			sniffStopPicked
			&& upstreamServer.mininetLog.some((entry) => entry.method === "POST" && entry.path === "/api/mininet/sniffer/stop")
			&& snifferStopped.includes("未抓包"),
			`读数=${snifferStopped}`
		);

		/*
		 * 破坏性重建（W5）：`POST /api/mininet/full_reset` 要逐字输入网络 ID。
		 * 断言拆成三步 —— 弹窗开着、输错不给点、输对才发请求且请求体带 confirm。
		 */
		const resetPicked = await runPick("mininet-reset-network");
		await labPage.waitForTimeout(400);
		const stateBeforeReset = structuredClone(upstreamServer.mininetState);
		const resetModalProbe = await labPage.evaluate(() => ({
			input: !!document.querySelector("[data-testid='mininet-reset-confirm-input']"),
			confirmDisabled: !!document.querySelector("[data-testid='mininet-reset-confirm']")?.hasAttribute("disabled")
		}));
		const resetInput = labPage.locator("[data-testid='mininet-reset-confirm-input']");
		await resetInput.fill("net_wrong");
		await labPage.waitForTimeout(200);
		const wrongStillDisabled = await labPage.evaluate(() =>
			!!document.querySelector("[data-testid='mininet-reset-confirm']")?.hasAttribute("disabled"));
		await resetInput.fill("net_ui");
		await labPage.waitForTimeout(200);
		const rightEnabled = await labPage.evaluate(() =>
			!document.querySelector("[data-testid='mininet-reset-confirm']")?.hasAttribute("disabled"));
		const resetConfirmed = rightEnabled && await clickIfPresent("[data-testid='mininet-reset-confirm']");
		await labPage.waitForTimeout(2500);
		const resetWrite = upstreamServer.mininetLog.find((entry) => entry.method === "POST" && entry.path === "/api/mininet/full_reset");
		const canvasAfterReset = await canvasProbe();
		const bodyAfterReset = await labPage.evaluate(() => (document.body.textContent ?? "").replace(/\s+/g, " ").trim());
		log(
			"11.6 重建网络：输错网络 ID 不放行，输对后 POST /api/mininet/full_reset 带 confirm 且画布清空",
			resetPicked && resetModalProbe.input && resetModalProbe.confirmDisabled
			&& wrongStillDisabled && resetConfirmed
			&& resetWrite?.body?.confirm === "net_ui"
			&& canvasAfterReset.nodes === 0
			&& bodyAfterReset.includes("该网络还没有主机"),
			`弹窗=${resetModalProbe.input} 输错仍禁用=${wrongStillDisabled} confirm=${resetWrite?.body?.confirm} nodes=${canvasAfterReset.nodes}`
		);

		/*
		 * 11.6a 空拓扑（0 节点）也要能拖拽新增（W11 缺陷修复）。
		 *
		 * `full_reset` 之后这一屏正是「从零建网」的第一屏：台账里有网络、上游一台设备都没有。
		 * 画布以前写成 `v-if="visibleNodes.length"`，没节点时被一句占位文案换掉，而 `drop`
		 * 只挂在画布那张 `svg` 上 —— 于是拖拽新增在空网里静默失败（拖源、提示都对，落点不存在）。
		 * 这里合成一次完整拖放，只断言「画布还在 + 表单带着落点打开」，随后取消：不写节点，
		 * 下面还要恢复的共用假上游状态不受影响。
		 */
		const emptyDragPoint = await labPage.evaluate(() => {
			const chip = document.querySelector("[data-testid='mininet-add-kind-host']");
			const svg = document.querySelector("[data-testid='topology-canvas']");
			if (!chip || !svg)
				return null;
			const rect = svg.getBoundingClientRect();
			const clientX = Math.round(rect.left + rect.width * 0.5);
			const clientY = Math.round(rect.top + rect.height * 0.5);
			const dataTransfer = new DataTransfer();
			chip.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer, clientX, clientY }));
			svg.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer, clientX, clientY }));
			return { clientX, clientY };
		});
		await labPage.waitForTimeout(250);
		const emptyDropHint = await labPage.evaluate(() => {
			const hint = document.querySelector("[data-testid='topology-drop-hint']");
			return hint ? (hint.textContent ?? "").trim() : "";
		});
		const emptyDropped = await labPage.evaluate((point) => {
			const svg = document.querySelector("[data-testid='topology-canvas']");
			if (!svg || !point)
				return false;
			svg.dispatchEvent(new DragEvent("drop", {
				bubbles: true,
				cancelable: true,
				dataTransfer: new DataTransfer(),
				clientX: point.clientX,
				clientY: point.clientY
			}));
			return true;
		}, emptyDragPoint);
		await labPage.waitForTimeout(400);
		const emptyDropForm = await labPage.evaluate(() => {
			const origin = document.querySelector("[data-testid='lab-node-origin']");
			return {
				canvas: !!document.querySelector("[data-testid='topology-canvas']"),
				open: !!document.querySelector("[data-testid='lab-node-name']"),
				origin: origin ? (origin.textContent ?? "").trim() : ""
			};
		});
		const emptyFormCancelled = emptyDropForm.open
			&& await clickIfPresent(labPage.locator("[role='dialog'] button").filter({ hasText: "取消" }));
		// 弹窗收场有过渡动画：等节点名字段真的消失，别用固定 sleep 赌动画时长
		const emptyFormClosed = await labPage
			.waitForFunction(() => !document.querySelector("[data-testid='lab-node-name']"), null, { timeout: 5000 })
			.then(() => true)
			.catch(() => false);
		log(
			"11.6a 空拓扑（0 节点）仍能拖拽新增：画布常驻、投放提示照出、表单带落点打开",
			!!emptyDragPoint && emptyDropHint.includes("主机") && emptyDropped
			&& emptyDropForm.canvas && emptyDropForm.open
			&& (emptyDropForm.origin.match(/-?\d+/g) ?? []).length >= 2
			&& emptyFormCancelled && emptyFormClosed,
			`画布=${emptyDropForm.canvas} 提示=${emptyDropHint || "无"} 表单=${emptyDropForm.open}`
			+ ` 落点=${emptyDropForm.origin || "无"} 取消=${emptyFormCancelled}`
		);

		/*
		 * 11.6c 空画布导出拓扑 PNG：不出文件、只报错（2026-11-20 逐条复验暴露的缺陷）。
		 *
		 * 画布自 W11 起常驻，`svgElement` 永远非空 —— 导出判据若只判「拿得到 SVG」，
		 * 就会把一张空白画布导成 PNG（复验时实测下载了 `lab-topology-*.png`，打开是全空）。
		 * 判据必须是「画布上有可见节点」，所以这里应当：没有 `download` 事件，且给出
		 * 红 toast 说明原因。这条同时守着 11.5b（有节点时仍然导得出）。
		 */
		const emptyPngDownload = labPage
			.waitForEvent("download", { timeout: 1500 })
			.then(() => true)
			.catch(() => false);
		const emptyPngPicked = await pickFileItem("导出拓扑 PNG");
		const emptyPngToast = await labPage
			.waitForFunction(() => (document.body.textContent ?? "").includes("画布上还没有可导出的拓扑"), null, { timeout: 5000 })
			.then(() => true)
			.catch(() => false);
		const emptyPngDownloaded = await emptyPngDownload;
		log(
			"11.6c 空画布导出拓扑 PNG：不产生下载，改用红 toast「画布上还没有可导出的拓扑」",
			emptyPngPicked && !emptyPngDownloaded && emptyPngToast,
			`点中=${emptyPngPicked} 下载=${emptyPngDownloaded} toast=${emptyPngToast}`
		);

		/*
		 * 假上游是**整段 11.x 共用**的（后面的资源清单用例还要读它），而 `full_reset`
		 * 已经把台账清空。这里把快照放回去 —— 恢复的是测试夹具，不是被测行为：
		 * 页面上「重建后画布为空」已经在上一行断言完。
		 */
		Object.assign(upstreamServer.mininetState, structuredClone(stateBeforeReset));

		/*
		 * 11.6b 台账对账（NMCPS-ADR-0023）：`POST /api/mininet/networks/{id}/sync`
		 *
		 * 旧前端 / 运维直连上游加出来的节点在台账里没有痕迹，出口过滤会把它们藏起来。
		 * 对账是**显式**动作：双权限位 + 逐字输入网络 id；BFF 只读上游、只重写清单，
		 * 因此上游读侧日志应当出现五类节点 + 链路（`mininetReadLog`），写侧一条都没有。
		 */
		const fileMenuEntries = async () => {
			const opened = await clickIfPresent("[data-testid='mininet-file-menu']");
			if (!opened)
				return [];
			await labPage.waitForTimeout(250);
			const entries = await labPage.evaluate(() => [...document.querySelectorAll("[role='menuitem']")].map((node) => ({
				label: (node.textContent ?? "").trim(),
				disabled: node.getAttribute("aria-disabled") === "true" || node.hasAttribute("data-disabled")
			})));
			await labPage.keyboard.press("Escape");
			await labPage.waitForTimeout(150);
			return entries;
		};

		// 重建后画布停在空态；这里先重读一次台账，让「对账前后视觉不变」有对照面
		await labPage.reload({ waitUntil: "networkidle" });
		await labPage.waitForTimeout(1200);
		const canvasBeforeReconcile = await canvasProbe();

		const menuBeforeReconcile = await fileMenuEntries();
		const reconcileEntry = menuBeforeReconcile.find((entry) => entry.label.includes("台账对账"));
		// 「文件」菜单的完整形状（W4 三项 + W9 三项 + ADR-0023 的对账）：项数写过一次就跟着菜单走，
		// 别再拿旧的四项去比 —— W9 补了三项之后这条断言曾经长期为红。
		const fileMenuLabelList = menuBeforeReconcile.map((entry) => entry.label);
		const fileMenuExpected = [
			"导入拓扑（JSON）…",
			"导出 JSON",
			"导出 Python 脚本",
			"导出拓扑 PNG",
			"导出地址规划（JSON）",
			"台账对账…",
			"设置…"
		];
		log(
			"11.6b 双权限（create + delete）时「文件」菜单多出「台账对账」，且可点",
			fileMenuExpected.every((label) => fileMenuLabelList.includes(label))
			&& fileMenuLabelList.length === fileMenuExpected.length
			&& !!reconcileEntry && !reconcileEntry.disabled,
			`菜单项=${JSON.stringify(menuBeforeReconcile)}`
		);

		const reconcilePicked = !!reconcileEntry && await pickFileItem(reconcileEntry.label);
		await labPage.waitForTimeout(400);
		const reconcileModal = await labPage.evaluate(() => ({
			input: !!document.querySelector("[data-testid='mininet-reconcile-confirm-input']"),
			confirmDisabled: !!document.querySelector("[data-testid='mininet-reconcile-confirm']")?.hasAttribute("disabled")
		}));
		const reconcileInput = labPage.locator("[data-testid='mininet-reconcile-confirm-input']");
		await reconcileInput.fill("net_wrong");
		await labPage.waitForTimeout(200);
		const reconcileWrongDisabled = await labPage.evaluate(() =>
			!!document.querySelector("[data-testid='mininet-reconcile-confirm']")?.hasAttribute("disabled"));
		await reconcileInput.fill("net_ui");
		await labPage.waitForTimeout(200);
		const reconcileRightEnabled = await labPage.evaluate(() =>
			!document.querySelector("[data-testid='mininet-reconcile-confirm']")?.hasAttribute("disabled"));
		log(
			"11.6b 对账弹窗要逐字输入网络 ID：输错仍禁用，输对才放行",
			reconcilePicked && reconcileModal.input && reconcileModal.confirmDisabled
			&& reconcileWrongDisabled && reconcileRightEnabled,
			`弹窗=${reconcileModal.input} 初始禁用=${reconcileModal.confirmDisabled} 输错=${reconcileWrongDisabled} 输对=${reconcileRightEnabled}`
		);

		const reconcileReadBaseline = upstreamServer.mininetReadLog.length;
		const reconcileLogBefore = upstreamServer.mininetLog.length;
		const reconcileConfirmed = reconcileRightEnabled && await clickIfPresent("[data-testid='mininet-reconcile-confirm']");
		await labPage.waitForTimeout(3000);
		const reconcileReads = upstreamServer.mininetReadLog.slice(reconcileReadBaseline);
		const reconcileReadPaths = [...new Set(reconcileReads.map((entry) => entry.path))];
		const reconcileWrites = upstreamServer.mininetLog.slice(reconcileLogBefore);
		const expectedReconcileReads = ["/api/mininet/hosts", "/api/mininet/switches", "/api/mininet/routers", "/api/mininet/nats", "/api/mininet/controllers", "/api/mininet/links"];
		const canvasAfterReconcile = await canvasProbe();
		const bodyAfterReconcile = await labPage.evaluate(() => (document.body.textContent ?? "").replace(/\s+/g, " ").trim());
		// 台账落盘是这次唯一的写：清单被**整体重写**成上游此刻的事实（不是合并）
		const reconcileLedger = JSON.parse(readFileSync(`.data/check-ui-lab-${process.pid}.json`, "utf8"));
		const reconcileManifest = (reconcileLedger.networks ?? []).find((item) => item.id === "net_ui")?.resources;
		log(
			"11.6b 确认后读上游五类节点 + 链路且零写，并把台账清单整体重写成上游事实",
			reconcileConfirmed
			&& reconcileWrites.length === 0
			&& expectedReconcileReads.every((item) => reconcileReadPaths.includes(item))
			&& Array.isArray(reconcileManifest?.nodes) && reconcileManifest.nodes.length === canvasBeforeReconcile.nodes
			&& Array.isArray(reconcileManifest?.links) && reconcileManifest.links.length === upstreamServer.mininetState.links.length
			&& canvasAfterReconcile.nodes === canvasBeforeReconcile.nodes
			&& bodyAfterReconcile.includes("台账已对齐上游"),
			`读取=${JSON.stringify(reconcileReadPaths)} 写=${reconcileWrites.length} 清单=${reconcileManifest?.nodes?.length ?? "无"}节点/${reconcileManifest?.links?.length ?? "无"}链路 nodes=${canvasBeforeReconcile.nodes}→${canvasAfterReconcile.nodes}`
		);

		/*
		 * 11.7 抓包实时流（NMCPS-ADR-0022 D6 / W5 剩余部分）
		 *
		 * 页面不直连上游：先 `POST /api/mininet/ws-ticket` 换一次性票，再连同源 `/mininet-ws/sniffer`，
		 * BFF 以票里的 `sub` / `tid` 建上游连接。断言三段 —— 未抓包只回填历史、
		 * 抓包中实时帧进列表（且上游连接不带 cookie / authorization）、停止后断流但保留已收到的包。
		 */
		// 上一步的 reload 把右栏带回缺省「网络」标签：抓包读数与实时包列表都在「连通」标签里
		await openSideTab("连通");
		const snifferRows = () => labPage.evaluate(() =>
			[...document.querySelectorAll("[data-testid='mininet-sniffer-packet']")]
				.map((node) => (node.textContent ?? "").replace(/\s+/g, " ").trim()));
		const snifferStreamState = () => labPage.evaluate(() =>
			(document.querySelector("[data-testid='mininet-sniffer-stream-state']")?.textContent ?? "").trim());
		const waitForSnifferRows = async (expected, timeout = 10000) => {
			const deadline = Date.now() + timeout;
			let rows = await snifferRows();
			while (rows.length !== expected && Date.now() < deadline) {
				await labPage.waitForTimeout(200);
				rows = await snifferRows();
			}
			return rows;
		};

		const historyRows = await waitForSnifferRows(1, 5000);
		const idleStreamState = await snifferStreamState();
		// 11.6 已经开过一次抓包（连接记录留在日志里）；这里断言的是「空闲时不**新增**连接」
		const socketLogAtIdle = upstreamServer.mininetSocketLog.length;
		log(
			"11.7 未抓包时不建流：面板回填 sniffer/history（1 条 UDP），状态为未连接",
			historyRows.length === 1
			&& historyRows[0]?.includes("UDP")
			&& idleStreamState === "未连接"
			&& socketLogAtIdle === upstreamServer.mininetSocketLog.length,
			`历史=${JSON.stringify(historyRows)} 状态=${idleStreamState} 上游连接=${upstreamServer.mininetSocketLog.length}`
		);

		// 抓包要求网络在跑（上游 `sniffer_start` 对未启动回 400）；full_reset 已经把网停掉了
		await runPick("mininet-run-start");
		await labPage.waitForTimeout(1200);
		const socketsBeforeStreaming = upstreamServer.mininetSocketLog.length;
		await pickToolItem("开始抓包");
		const liveRows = await waitForSnifferRows(3);
		const liveStreamState = await snifferStreamState();
		const upstreamSocket = upstreamServer.mininetSocketLog.at(-1);
		log(
			"11.7 开始抓包后换票连 /mininet-ws/sniffer：实时帧进列表，出站不带 cookie / authorization",
			liveRows.length === 3
			&& liveRows.some((row) => row.includes("TCP"))
			&& liveRows.some((row) => row.includes("ICMP"))
			&& liveStreamState === "实时"
			&& upstreamServer.mininetSocketLog.length === socketsBeforeStreaming + 1
			&& upstreamSocket?.path === "/api/mininet/sniffer"
			&& !upstreamSocket?.headers.cookie
			&& !upstreamSocket?.headers.authorization,
			`列表=${JSON.stringify(liveRows)} 状态=${liveStreamState} 上游连接=${upstreamServer.mininetSocketLog.length} cookie=${!!upstreamSocket?.headers.cookie}`
		);

		await pickToolItem("停止抓包");
		await labPage.waitForTimeout(1200);
		const stoppedStreamState = await snifferStreamState();
		const keptRows = await snifferRows();
		log(
			"11.7 停止抓包后断流（状态回到未连接），已收到的包保留",
			stoppedStreamState === "未连接" && keptRows.length === 3,
			`状态=${stoppedStreamState} 保留=${keptRows.length}`
		);

		/*
		 * 11.8 右栏观测三块（NMCPS-ADR-0022 D6 的三条剩余通道）
		 *
		 * 右栏是一个五标签面板（Webshell / 日志 / 监控 / 网络 / 连通），工具栏不再有「网络工具」
		 * 按钮，也不再另开右抽屉。抓包之外的三块观测面：Webshell（`lab:terminal`）、
		 * 日志 / 监控（`lab:read`）。断言四段：五个标签页都在、旧入口已删除、日志随标签自动建流、
		 * 终端有**上行**（回显真的回来了）、监控把 `node:intf` 拆成上游查询串并把采样渲染出来；
		 * 逐键映射另有三条**字节级**用例，直接核对假上游收到的入站帧（`Ctrl-L` → 0x0c、
		 * 方向键 → CSI、`Ctrl+V` 不上行 `v` 且粘贴整段一次送出）。
		 */
		const sideTabs = await labPage.evaluate(() => ({
			labels: [...document.querySelectorAll("[data-testid='mininet-side-tabs'] [role='tab']")]
				.map((node) => (node.textContent ?? "").trim()),
			legacyEntry: !!document.querySelector("[data-testid='mininet-network-tools']"),
			legacyPanel: !!document.querySelector("[data-testid='mininet-network-tools-tabs']")
		}));
		log(
			"11.8 右栏五个标签页（Webshell / 日志 / 监控 / 网络 / 连通），工具栏「网络工具」入口与右抽屉已删除",
			["Webshell", "日志", "监控", "网络", "连通"].every((label) => sideTabs.labels.includes(label))
			&& !sideTabs.legacyEntry && !sideTabs.legacyPanel,
			`tabs=${JSON.stringify(sideTabs.labels)} 旧入口=${sideTabs.legacyEntry} 旧面板=${sideTabs.legacyPanel}`
		);

		const waitForText = async (testid, predicate, timeout = 10000) => {
			const deadline = Date.now() + timeout;
			let text = "";
			while (Date.now() < deadline) {
				text = (await labPage.locator(`[data-testid='${testid}']`).textContent() ?? "").trim();
				if (predicate(text))
					return text;
				await labPage.waitForTimeout(200);
			}
			return text;
		};

		// ── 日志：进标签即建流，两行原文进面板 ──
		const logSocketsBefore = upstreamServer.mininetSocketLog.length;
		await openSideTab("日志");
		const logsText = await waitForText("mininet-logs-output", (text) => text.includes("mininet starting") && text.includes("link up"));
		const logsUpstream = upstreamServer.mininetSocketLog.at(-1);
		log(
			"11.8 日志页自动换票连 /mininet-ws/logs：两行原文进面板，上游不带 cookie / authorization",
			logsText.includes("mininet starting")
			&& logsText.includes("link up")
			&& upstreamServer.mininetSocketLog.length === logSocketsBefore + 1
			&& logsUpstream?.path === "/api/mininet/logs"
			&& !logsUpstream?.headers.cookie
			&& !logsUpstream?.headers.authorization,
			`上游=${logsUpstream?.path} cookie=${!!logsUpstream?.headers.cookie}`
		);

		// ── Webshell：连接 → 问候帧 → 逐键敲一行 → 回车执行（上行链路） ──
		await openSideTab("Webshell");
		await labPage.waitForTimeout(200);
		const terminalSocketsBefore = upstreamServer.mininetSocketLog.length;
		await clickIfPresent("[data-testid='mininet-terminal-connect']");
		const bannerText = await waitForText("mininet-terminal-output", (text) => text.includes("root@"));
		const terminalUpstream = upstreamServer.mininetSocketLog.at(-1);
		log(
			"11.8 Webshell 连 `/mininet-ws/terminal/<node>`：问候帧进面板，上游路径带节点段",
			bannerText.includes("root@")
			&& upstreamServer.mininetSocketLog.length === terminalSocketsBefore + 1
			&& /^\/api\/mininet\/terminal\/[^/]+$/.test(terminalUpstream?.path ?? "")
			&& !terminalUpstream?.headers.cookie,
			`上游=${terminalUpstream?.path}`
		);

		// 夹具的问候帧带 ANSI 颜色码，面板必须洗掉它：渲染 `^[[1;32m` 会把提示符变成乱码
		log(
			"11.8 问候帧里的 ANSI 颜色码被洗掉：上游原样带 ESC，面板里一个都不剩",
			MININET_TERMINAL_BANNER.includes("\u001B")
			&& bannerText.includes("root@")
			&& !bannerText.includes("\u001B"),
			`夹具带ESC=true 面板带ESC=${bannerText.includes("\u001B")}`
		);

		// ── 逐键上行：点终端拿焦点 → 敲两个字母 → 回显是上游逐个字节回来的 ──
		await labPage.locator("[data-testid='mininet-terminal-output']").click();
		await labPage.keyboard.type("ls");
		const typedText = await waitForText("mininet-terminal-output", (text) => text.includes("ls"));
		log(
			"11.8 终端逐键上行：敲下的字符由上游回显（面板不做本地回显，否则一次输入两份）",
			typedText.includes("ls") && !typedText.includes("echo:ls"),
			`输出尾部=${JSON.stringify(typedText.slice(-16))}`
		);

		// 回车发 `\r`（PTY 的行规程只认它）：上游把整行回成 `echo:ls`
		await labPage.keyboard.press("Enter");
		const echoText = await waitForText("mininet-terminal-output", (text) => text.includes("echo:ls"));
		log(
			"11.8 回车发 `\\r`：整行经 BFF 转给上游，`echo:ls` 回显进面板",
			echoText.includes("echo:ls"),
			`输出尾部=${JSON.stringify(echoText.slice(-24))}`
		);

		// ── 逐键映射的**字节证据**：面板会把控制序列洗掉（`ESC[C` 洗成空），
		//    所以这三条直接看假上游收到的入站帧（`connection.input`）──
		const terminalInput = () => terminalUpstream?.input ?? [];
		const waitForTerminalInput = async (predicate, timeout = 5000) => {
			const deadline = Date.now() + timeout;
			while (Date.now() < deadline) {
				if (predicate(terminalInput()))
					return true;
				await labPage.waitForTimeout(100);
			}
			return predicate(terminalInput());
		};

		// `Ctrl+字母` 发 `0x01–0x1A`：`Ctrl-L`（readline 清屏）必须是 0x0c，不是字面量 "l"
		await labPage.locator("[data-testid='mininet-terminal-output']").click();
		const ctrlBefore = terminalInput().length;
		await labPage.keyboard.press("Control+l");
		await waitForTerminalInput((frames) => frames.length > ctrlBefore);
		log(
			"11.8 Ctrl-L 发 0x0c（控制字节）而不是字面量 `l`",
			terminalInput().at(-1) === "\u000C",
			`最后帧=${JSON.stringify(terminalInput().at(-1) ?? "")} 帧数=${terminalInput().length}`
		);

		// 方向键走 CSI：→ 是 `ESC[C`、← 是 `ESC[D`（不是把键名当文本上行）
		const arrowBefore = terminalInput().length;
		await labPage.keyboard.press("ArrowRight");
		await waitForTerminalInput((frames) => frames.length > arrowBefore);
		const rightFrame = terminalInput().at(-1);
		await labPage.keyboard.press("ArrowLeft");
		await waitForTerminalInput((frames) => frames.length > arrowBefore + 1);
		log(
			"11.8 方向键发 CSI 序列：→ 是 `\\x1b[C`、← 是 `\\x1b[D`",
			rightFrame === "\u001B[C" && terminalInput().at(-1) === "\u001B[D",
			`→=${JSON.stringify(rightFrame)} ←=${JSON.stringify(terminalInput().at(-1))}`
		);

		// `Shift+Tab` 是反向补全（`ESC[Z`），不是 `\t` —— 发成 `\t` 会在 readline 里补全而不是回退
		const shiftTabBefore = terminalInput().length;
		await labPage.keyboard.press("Shift+Tab");
		await waitForTerminalInput((frames) => frames.length > shiftTabBefore);
		log(
			"11.8 `Shift+Tab` 发 `\\x1b[Z`（反向补全），不是 `\\t`",
			terminalInput().at(-1) === "\u001B[Z",
			`最后帧=${JSON.stringify(terminalInput().at(-1) ?? "")}`
		);

		// 带修饰的光标键是 `CSI 1;<mod><letter>`：`Shift+→` 是 `ESC[1;2C`（readline 按词跳）
		const shiftArrowBefore = terminalInput().length;
		await labPage.keyboard.press("Shift+ArrowRight");
		await waitForTerminalInput((frames) => frames.length > shiftArrowBefore);
		log(
			"11.8 `Shift+→` 发 `\\x1b[1;2C`（带修饰的 CSI，不是裸 `\\x1b[C`）",
			terminalInput().at(-1) === "\u001B[1;2C",
			`最后帧=${JSON.stringify(terminalInput().at(-1) ?? "")}`
		);

		// `Alt+字母` 发 `ESC + 字母`（readline 的按词操作），不是可打印的字母本身
		const altBefore = terminalInput().length;
		await labPage.keyboard.press("Alt+b");
		await waitForTerminalInput((frames) => frames.length > altBefore);
		log(
			"11.8 `Alt+b` 发 `\\x1b b`（ESC 前缀），不是裸 `b`",
			terminalInput().at(-1) === "\u001Bb",
			`最后帧=${JSON.stringify(terminalInput().at(-1) ?? "")}`
		);

		// `Ctrl+V` 只走浏览器粘贴：自身绝不能把 "v" 上行；粘贴文本整段一次送出，换行转成 `\r`
		const pasteBefore = terminalInput().length;
		await labPage.keyboard.press("Control+v");
		await labPage.waitForTimeout(300);
		const afterCtrlV = terminalInput().length;
		await labPage.evaluate(() => {
			const element = document.querySelector("[data-testid='mininet-terminal-input']");
			const data = new DataTransfer();
			data.setData("text/plain", "p1\np2");
			element?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
		});
		await waitForTerminalInput((frames) => frames.length > afterCtrlV);
		const pastedFrame = terminalInput().at(-1);
		log(
			"11.8 粘贴整段一次送出：Ctrl+V 自身不上行 `v`，换行转成 `\\r`",
			afterCtrlV === pasteBefore && pastedFrame === "p1\rp2",
			`Ctrl+V 新增帧=${afterCtrlV - pasteBefore} 粘贴帧=${JSON.stringify(pastedFrame ?? "")}`
		);

		// ── 多会话（1.0 的「每节点一条终端」）：第二个节点开新标签、独立一条上游连 ──
		/** 上游建连是换票之后的异步动作：等到日志里真的多出一条，别和请求赛跑 */
		const waitForSockets = async (count) => {
			const deadline = Date.now() + 10000;
			while (Date.now() < deadline && upstreamServer.mininetSocketLog.length < count)
				await labPage.waitForTimeout(100);
			return upstreamServer.mininetSocketLog.length;
		};
		const multiSocketsBefore = upstreamServer.mininetSocketLog.length;
		await labPage.locator("[data-testid='mininet-terminal-node']").click();
		const secondNodePicked = await clickIfPresent(labPage.getByRole("option").nth(1));
		await clickIfPresent("[data-testid='mininet-terminal-connect']");
		const multiSockets = await waitForSockets(multiSocketsBefore + 1);
		const sessionTabs = labPage.locator("[data-testid='mininet-terminal-sessions'] > div");
		const tabCount = await sessionTabs.count();
		const secondUpstream = upstreamServer.mininetSocketLog.at(-1);
		log(
			"11.8 多会话：第二个节点开新标签、独立一条上游连，第一条仍在",
			secondNodePicked
			&& tabCount === 2
			&& multiSockets === multiSocketsBefore + 1
			&& secondUpstream?.path !== terminalUpstream?.path
			&& /^\/api\/mininet\/terminal\/[^/]+$/.test(secondUpstream?.path ?? ""),
			`标签=${tabCount} 上游=${secondUpstream?.path}`
		);

		// 切回第一条标签：只换视图，不重新建连，转写仍是它自己的
		const switchSocketsBefore = upstreamServer.mininetSocketLog.length;
		await clickIfPresent(sessionTabs.first().locator("button").first());
		const backText = await waitForText("mininet-terminal-output", (text) => text.includes("echo:ls"));
		log(
			"11.8 标签切换只换视图：切回第一条仍是它自己的转写，不重新建连",
			backText.includes("echo:ls") && upstreamServer.mininetSocketLog.length === switchSocketsBefore,
			`输出尾部=${JSON.stringify(backText.slice(-16))} 新建连=${upstreamServer.mininetSocketLog.length - switchSocketsBefore}`
		);

		// 关掉第二条会话：只断那一条，第一条仍是已连接
		await clickIfPresent(sessionTabs.nth(1).locator("button").last());
		await labPage.waitForTimeout(200);
		const remainingTabs = await labPage.locator("[data-testid='mininet-terminal-sessions'] > div").count();
		const remainingState = (await labPage.locator("[data-testid='mininet-terminal-state']").textContent() ?? "").trim();
		log(
			"11.8 关掉一条会话只断那条：标签消失，剩下那条仍是已连接",
			remainingTabs === 1 && remainingState === "已连接",
			`剩余标签=${remainingTabs} 状态=${remainingState}`
		);

		// Ctrl-C 发的是 0x03：上游只对这一字节回 `^C`，字面量 `^C` 会走 `echo:` 分支
		await clickIfPresent("[data-testid='mininet-terminal-interrupt']");
		const interruptText = await waitForText("mininet-terminal-output", (text) => text.includes("^C"));
		log(
			"11.8 中断按钮发 `Ctrl-C`（0x03）而不是字面量：上游回 `^C`",
			interruptText.includes("^C") && !interruptText.includes("echo:^C"),
			`输出尾部=${JSON.stringify(interruptText.slice(-16))}`
		);

		// 清屏只清浏览器侧转写：输出回到空态，连接保持（再敲一行仍然通）
		await clickIfPresent("[data-testid='mininet-terminal-clear']");
		const clearedText = await waitForText("mininet-terminal-output", (text) => !text.includes("echo:ls") && !text.includes("root@"));
		const clearedState = (await labPage.locator("[data-testid='mininet-terminal-state']").textContent() ?? "").trim();
		log(
			"11.8 清屏回到空态但不断流：转写清空、状态仍是已连接",
			!clearedText.includes("echo:ls") && !clearedText.includes("root@") && clearedText.length > 0 && clearedState === "已连接",
			`输出=${JSON.stringify(clearedText.slice(0, 16))} 状态=${clearedState}`
		);
		// ── 监控：`node:intf` 拆成上游查询串，采样渲染成一行读数 ──
		await openSideTab("监控");
		await labPage.waitForTimeout(300);
		const monitorSocketsBefore = upstreamServer.mininetSocketLog.length;
		await clickIfPresent("[data-testid='mininet-monitor-start']");
		const sampleText = await waitForText("mininet-monitor-samples", (text) => text.includes("TX"));
		const monitorUpstream = upstreamServer.mininetSocketLog.at(-1);
		const monitorParams = new URLSearchParams(monitorUpstream?.search ?? "");
		log(
			"11.8 监控：target `node:intf` 拼成上游查询串，采样按 TX / RX 渲染",
			sampleText.includes("TX") && sampleText.includes("RX")
			&& upstreamServer.mininetSocketLog.length === monitorSocketsBefore + 1
			&& monitorUpstream?.path === "/api/mininet/monitor"
			&& (monitorParams.get("node") ?? "") !== ""
			&& (monitorParams.get("intf") ?? "").includes("-eth0"),
			`上游=${monitorUpstream?.path}?${monitorParams.toString()}`
		);

		// ── 右键菜单与双击详情（NMCPS-ADR-0022 W12 / W13）──
		// 先铺一台主机和一条链路：前面几组用例（删节点 / 重置 / 生成）会改变共享状态，这里自己
		// 建一份，不依赖「上一组留下谁」。**必须走 `/api/mininet/**` 写路径** —— 页面读的是台账（出口
		// 只放行登记过的资源），直接往假上游的 `mininetState` 里塞，画布根本看不见它。
		// 写请求由**页面自己**发（同源 fetch，带上会话 cookie）：`page.request` 走的是另一套
		// 请求上下文，实测拿到 503 `bff_auth_not_configured`，铺不成路。
		const detailSwitch = upstreamServer.mininetState.switches.sw1 ? "sw1" : Object.keys(upstreamServer.mininetState.switches)[0];
		const seedThroughPage = async (path, payload) => labPage.evaluate(async ({ path, payload }) => {
			const response = await fetch(path, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(payload)
			});
			return { status: response.status, text: await response.text() };
		}, { path, payload });
		const detailHostSeed = await seedThroughPage("/api/mininet/hosts", {
			id: "h_detail",
			type: "host",
			name: "h_detail",
			label: "h_detail",
			ip: "10.0.0.254/8",
			mac: "00:00:00:00:00:09",
			x: 420,
			y: 260
		});
		const detailLinkSeed = await seedThroughPage("/api/mininet/links", { src: "h_detail", dst: detailSwitch });
		const detailSeedOk = detailHostSeed.status === 200 && detailLinkSeed.status === 200;
		await labPage.reload({ waitUntil: "networkidle" });
		await labPage.waitForSelector("[data-testid='topology-node'][data-node-id='h_detail']", { timeout: 20000 }).catch(() => {});
		await labPage.waitForTimeout(400);

		// 11.11 节点右键：两项（打开 Webshell / 查看节点详情）；空白右键不弹菜单也不弹浏览器菜单。
		const detailNode = labPage.locator("[data-testid='topology-node'][data-node-id='h_detail']");
		const canvasNodeIds = await labPage.evaluate(() => [...document.querySelectorAll("[data-testid='topology-node']")]
			.map((node) => node.getAttribute("data-node-id")));
		const detailNodeSeen = await detailNode.count() > 0;
		if (detailNodeSeen)
			await detailNode.first().click({ button: "right" }).catch(() => {});
		await labPage.waitForTimeout(400);
		const contextItems = await labPage.evaluate(() => [...document.querySelectorAll("[role='menu'] [role='menuitem']")]
			.map((node) => (node.textContent ?? "").replace(/\s+/g, " ").trim()));
		await labPage.keyboard.press("Escape");
		await labPage.waitForTimeout(200);
		const canvasBox = await labPage.locator("[data-testid='topology-canvas']").boundingBox();
		if (canvasBox)
			await labPage.mouse.click(canvasBox.x + 24, canvasBox.y + 24, { button: "right" });
		await labPage.waitForTimeout(300);
		const blankMenuCount = await labPage.locator("[role='menu']").count();
		const detailHostSeedText = detailHostSeed.text.replace(/\s+/g, " ").trim();
		log(
			"11.11 节点右键弹出「打开 Webshell / 查看节点详情」两项，空白右键不弹菜单",
			detailSeedOk && detailNodeSeen
			&& contextItems.some((item) => item.includes("打开 Webshell"))
			&& contextItems.some((item) => item.includes("查看节点详情"))
			&& blankMenuCount === 0,
			`铺路=${detailHostSeed.status}/${detailLinkSeed.status} 上游=${detailHostSeedText.slice(0, 80)}`
			+ ` 画布节点=${JSON.stringify(canvasNodeIds)} 菜单=${JSON.stringify(contextItems)} 空白菜单数=${blankMenuCount}`
		);

		// 11.12 双击主机 → 详情弹窗（台账事实 + 运行态读数），改 IP 走 PATCH /hosts/{id}。
		await detailNode.first().dblclick({ timeout: 5000 }).catch(() => {});
		await labPage.waitForSelector("[data-testid='lab-node-detail-ip']", { timeout: 10000 }).catch(() => {});
		await labPage.waitForTimeout(600);
		const nodeDetailProbe = await labPage.evaluate(() => ({
			open: Boolean(document.querySelector("[data-testid='lab-node-detail-ip']")),
			live: Boolean(document.querySelector("[data-testid='lab-node-detail-live']")),
			arp: Boolean(document.querySelector("[data-testid='lab-node-detail-arp']")),
			text: (document.querySelector("[data-testid='lab-node-detail-body']")?.textContent ?? "").replace(/\s+/g, " ").trim()
		}));
		await labPage.locator("[data-testid='lab-node-detail-ip']").fill("10.0.0.77/8", { timeout: 5000 }).catch(() => {});
		await labPage.locator("[data-testid='lab-node-detail-submit']").click({ timeout: 5000 }).catch(() => {});
		await labPage.waitForTimeout(1200);
		const hostWrite = upstreamServer.mininetLog.filter((entry) => entry.method === "PATCH" && entry.path === "/api/mininet/hosts/h_detail").at(-1);
		const nodeDetailClosed = await labPage.locator("[data-testid='lab-node-detail-ip']").count();
		log(
			"11.12 双击主机打开详情（台账事实 + 运行态读数），改 IP 走 PATCH /hosts/{id} 并重读台账",
			nodeDetailProbe.open && nodeDetailProbe.live && nodeDetailProbe.arp
			&& nodeDetailProbe.text.includes("h_detail") && nodeDetailProbe.text.includes("10.0.0.254")
			&& hostWrite?.body?.ip === "10.0.0.77/8"
			&& upstreamServer.mininetState.hosts.h_detail?.ip === "10.0.0.77/8"
			&& nodeDetailClosed === 0,
			`弹窗=${nodeDetailProbe.open} 运行态=${nodeDetailProbe.live} 请求=${hostWrite ? JSON.stringify(hostWrite.body) : "无"} 台账IP=${upstreamServer.mininetState.hosts.h_detail?.ip}`
		);

		// 11.13 双击链路 → 详情弹窗（tx/rx 读数），改带宽走 PUT /links（只带填过的属性）。
		// 画布上链路很多，按 aria-label 定位到刚铺的那条（`<source> ↔ <target>`），不赌顺序。
		await labPage.locator("[data-testid='topology-link-hit'][aria-label*='h_detail']").first().dblclick({ force: true, timeout: 5000 }).catch(() => {});
		await labPage.waitForSelector("[data-testid='lab-link-detail-bw']", { timeout: 10000 }).catch(() => {});
		await labPage.waitForTimeout(600);
		const linkDetailText = await labPage.evaluate(() => (document.querySelector("[data-testid='lab-link-detail-body']")?.textContent ?? "").replace(/\s+/g, " ").trim());
		await labPage.locator("[data-testid='lab-link-detail-bw']").fill("100", { timeout: 5000 }).catch(() => {});
		await labPage.locator("[data-testid='lab-link-detail-submit']").click({ timeout: 5000 }).catch(() => {});
		await labPage.waitForTimeout(1200);
		const linkWrite = upstreamServer.mininetLog.filter((entry) => entry.method === "PUT" && entry.path === "/api/mininet/links").at(-1);
		const linkDetailClosed = await labPage.locator("[data-testid='lab-link-detail-bw']").count();
		log(
			"11.13 双击链路打开详情（tx/rx 读数），改带宽走 PUT /links 且请求体只带填过的属性",
			linkDetailText.includes("h_detail") && linkDetailText.includes("1024")
			&& linkWrite?.body?.src !== undefined && linkWrite?.body?.dst !== undefined
			&& linkWrite?.body?.options?.bw === 100 && Object.keys(linkWrite.body.options).length === 1
			&& linkDetailClosed === 0,
			`弹窗文本=${linkDetailText.slice(0, 60)} 请求=${linkWrite ? JSON.stringify(linkWrite.body) : "无"}`
		);

		// 11.14 只读原因是可见事实（NMCPS-ADR-0022 W13 收尾）：控制器没有保存按钮，
		// 但弹窗要说清「为什么」—— 上游改控制器只改台账、不重启，给按钮等于承诺不发生的生效。
		const controllerNode = labPage.locator("[data-testid='topology-node'][data-node-id='c0']");
		const controllerSeen = await controllerNode.count() > 0;
		// 上一条若没关成功（它自己失败时），先收掉残留弹窗，免得读到另一份详情
		await labPage.keyboard.press("Escape");
		await labPage.waitForTimeout(200);
		if (controllerSeen)
			await controllerNode.first().dblclick({ force: true, timeout: 5000 }).catch(() => {});
		await labPage.waitForSelector("[data-testid='lab-node-detail-body']", { timeout: 10000 }).catch(() => {});
		await labPage.waitForTimeout(400);
		const nodeReadOnlyProbe = await labPage.evaluate(() => ({
			note: (document.querySelector("[data-testid='lab-node-detail-readonly']")?.textContent ?? "").replace(/\s+/g, " ").trim(),
			submit: document.querySelectorAll("[data-testid='lab-node-detail-submit']").length
		}));
		await labPage.keyboard.press("Escape");
		await labPage.waitForTimeout(300);
		log(
			"11.14 控制器详情只读：没有保存按钮，且弹窗写明「只改台账、不重启控制器」",
			controllerSeen
			&& nodeReadOnlyProbe.submit === 0
			&& nodeReadOnlyProbe.note.includes("只读")
			&& nodeReadOnlyProbe.note.includes("台账") && nodeReadOnlyProbe.note.includes("不重启"),
			`只读说明=${nodeReadOnlyProbe.note.slice(0, 48) || "无"} 保存按钮=${nodeReadOnlyProbe.submit}`
		);

		// 两种形态各一条：只读会话（实验台操作员）与只有 `lab:operate` 的会话（租户管理员）。
		// 两者都不含 `lab:terminal`，所以 Webshell 一律不出现 —— 这是「终端不由 operate 推导」的
		// 可见证据；只读会话连「连通」也不出现，因为探测 / 测速 / 抓包读数都要写位。
		// 假上游固定给 alice 全能力位（其余用例靠它），这里直接改写 `GET /api/mininet/channel` 的
		// 能力位来覆盖裁剪分支，而不是去动共用角色表。
		const overrideChannel = async (capabilities) => {
			await labPage.unroute("**/api/mininet/channel");
			await labPage.route("**/api/mininet/channel", async (route) => {
				const response = await route.fetch();
				const body = await response.json();
				const writeEnabled = capabilities.create || capabilities.operate || capabilities.delete || capabilities.sniffer;
				await route.fulfill({
					status: 200,
					contentType: "application/json; charset=utf-8",
					body: JSON.stringify({ ...body, data: { ...body.data, readOnly: !writeEnabled, writeEnabled, capabilities } })
				});
			});
			await labPage.reload({ waitUntil: "networkidle" });
			await labPage.waitForTimeout(600);
			return await labPage.evaluate(() => ({
				labels: [...document.querySelectorAll("[data-testid='mininet-side-tabs'] [role='tab']")]
					.map((node) => (node.textContent ?? "").trim()),
				connectivityText: (document.body.textContent ?? "").includes("连通"),
				terminalPanel: Boolean(document.querySelector("[data-testid='mininet-terminal-panel']"))
			}));
		};

		const readOnlyProbe = await overrideChannel({ read: true, create: false, operate: false, delete: false, terminal: false, sniffer: false });
		log(
			"11.9 只读会话（实验台操作员）：右栏只剩 日志 / 监控 / 网络，Webshell 与连通都不出现",
			readOnlyProbe.labels.length === 3
			&& ["日志", "监控", "网络"].every((label) => readOnlyProbe.labels.includes(label))
			&& !readOnlyProbe.labels.includes("Webshell") && !readOnlyProbe.labels.includes("连通")
			&& !readOnlyProbe.connectivityText && !readOnlyProbe.terminalPanel,
			`tabs=${JSON.stringify(readOnlyProbe.labels)} 连通字样=${readOnlyProbe.connectivityText}`
		);

		const operateProbe = await overrideChannel({ read: true, create: false, operate: true, delete: false, terminal: false, sniffer: false });
		const operateTab = await openSideTab("连通");
		const operatePanel = await labPage.evaluate(() => ({
			runState: Boolean(document.querySelector("[data-testid='mininet-run-state']")),
			ping: Boolean(document.querySelector("[data-testid='mininet-run-ping']")),
			iperf: Boolean(document.querySelector("[data-testid='mininet-iperf-client']")),
			sniffer: Boolean(document.querySelector("[data-testid='mininet-sniffer-panel']"))
		}));
		log(
			"11.9 只有 lab:operate 的会话（租户管理员）：连通出现且探测 / 测速可用，Webshell 与抓包读数都不出现",
			operateTab && operateProbe.labels.includes("连通") && !operateProbe.labels.includes("Webshell")
			&& !operateProbe.terminalPanel
			&& operatePanel.runState && operatePanel.ping && operatePanel.iperf && !operatePanel.sniffer,
			`tabs=${JSON.stringify(operateProbe.labels)} 运行态=${operatePanel.runState} 探测=${operatePanel.ping} 测速=${operatePanel.iperf} 抓包=${operatePanel.sniffer}`
		);

		await labContext.close();
	} finally {
		await stopBff(labBff);
	}

	// 资源清单分支：台账显式登记 nodes / links 时，BFF 列表出口必须把清单外条目剪掉。
	// 假上游固定 6 节点 / 2 链路；这里只登记 5 个节点和 1 条链路，页面不应画出 h2 与 sw1→r1。
	const manifestPort = await freePort();
	const manifestBase = `http://${HOST}:${manifestPort}`;
	const manifestBff = await startBff(manifestPort, {
		NUXT_BFF_UPSTREAM_BASE: `http://${HOST}:${upstreamPort}`,
		NUXT_BFF_SESSION_SECRET: labSecret,
		NUXT_LAB_LEDGER_FILE: `.data/check-ui-lab-manifest-${process.pid}.json`,
		NUXT_LAB_LEDGER_SEED: JSON.stringify([{
			...labSeed[0],
			id: "net_ui_manifest",
			resources: {
				nodes: ["h1", "sw1", "r1", "nat1", "c0"],
				links: ["h1--sw1"]
			}
		}]),
		NUXT_MININET_INSTANCES: JSON.stringify({ [LAB_TENANT]: { baseUrl: `http://${HOST}:${upstreamPort}` } })
	});

	try {
		const manifestContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
		const manifestPage = await manifestContext.newPage();
		await loginToLab(manifestPage, manifestBase);
		// 台账 → 五类节点 → 画布是三次串行读取，`loginToLab` 的固定等待在机器忙时会不够；
		// 先等画布真的落下一个节点再取证，别把「还在读」记成「节点没画出来」。
		await manifestPage.waitForSelector("[data-testid='topology-node']", { timeout: 20000 }).catch(() => {});

		const manifestProbe = await manifestPage.evaluate(() => ({
			nodes: Array.from(document.querySelectorAll("[data-testid='topology-node']"))
				.map((el) => el.getAttribute("data-node-id") ?? ""),
			links: Array.from(document.querySelectorAll("[data-testid='topology-link']"))
				.map((el) => el.getAttribute("data-link-key") ?? "")
		}));
		const hiddenNode = !manifestProbe.nodes.includes("h2");
		const hiddenLink = manifestProbe.links.every((key) => !/(?:^|-)r1(?:$|-)/.test(key));
		log(
			"11.3 台账资源清单外的节点与链路不进入画布",
			manifestProbe.nodes.length === 5 && manifestProbe.links.length === 1
			&& manifestProbe.nodes.includes("h1") && manifestProbe.nodes.includes("c0")
			&& hiddenNode && hiddenLink,
			`nodes=${manifestProbe.nodes.join(",")} links=${manifestProbe.links.join(",")}`
		);

		/*
		 * 对账入口的负半：只有 create 没有 delete 时「台账对账」必须禁用。
		 * 页面能力位来自 `GET /api/mininet/channel`，这里只改这一条响应（BFF 侧守卫不变），
		 * 断言的是「客户端不给出注定 403 的入口」这一层，与 BFF 的 403 用例互补。
		 */
		await manifestPage.route("**/api/mininet/channel", async (route) => {
			const response = await route.fetch();
			const payload = await response.json();
			const capabilities = payload?.data?.capabilities ?? {};
			await route.fulfill({ response, json: { ...payload, data: { ...payload.data, capabilities: { ...capabilities, delete: false } } } });
		});
		await manifestPage.reload({ waitUntil: "networkidle" });
		await manifestPage.waitForTimeout(800);
		const downgradedMenu = await (async () => {
			const button = manifestPage.locator("[data-testid='mininet-file-menu']");
			if (await button.count() === 0)
				return [];
			await button.first().click();
			await manifestPage.waitForTimeout(250);
			const entries = await manifestPage.evaluate(() => [...document.querySelectorAll("[role='menuitem']")].map((node) => ({
				label: (node.textContent ?? "").trim(),
				disabled: node.getAttribute("aria-disabled") === "true" || node.hasAttribute("data-disabled")
			})));
			await manifestPage.keyboard.press("Escape");
			return entries;
		})();
		const downgradedReconcile = downgradedMenu.find((entry) => entry.label.includes("台账对账"));
		log(
			"11.6b 缺 lab:delete 时「台账对账」禁用（客户端能力位与 BFF 守卫同源）",
			!!downgradedReconcile && downgradedReconcile.disabled,
			`菜单项=${JSON.stringify(downgradedMenu)}`
		);

		await manifestContext.close();
	} finally {
		await stopBff(manifestBff);
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
