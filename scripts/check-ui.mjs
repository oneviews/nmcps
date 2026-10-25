// scripts/check-ui.mjs
// 无头浏览器自查：跑在服务器上，用 Playwright 打开页面并断言关键视觉/布局点。
// ⚠️ 基准地址：服务器端开发，不能用 localhost，须指向 http://192.168.1.90:3000
import { chromium } from "playwright";

const BASE_URL = "http://192.168.1.90:3000";

// 绕过环境里的 HTTP 代理（直连内网 dev server）
process.env.NO_PROXY = process.env.NO_PROXY || "192.168.1.90,127.0.0.1,localhost";
process.env.no_proxy = process.env.no_proxy || "192.168.1.90,127.0.0.1,localhost";

const results = [];
function log(label, ok, detail) {
	results.push({ label, ok, detail });
	console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
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
await page.waitForURL("**/dashboard/overview", { timeout: 15000 }).catch(() => {});

// 1. 默认布局模式
const layoutMode = await page.evaluate(() => document.querySelector("[data-layout-mode]")?.getAttribute("data-layout-mode"));
log("默认布局模式 = bigscreen", layoutMode === "bigscreen", layoutMode);

// 2. header：磨砂玻璃 + 阴影 + 底框
const headerStyle = await page.evaluate(() => {
	const el = document.querySelector(".side-head");
	if (!el) return null;
	const s = getComputedStyle(el);
	return { backdropFilter: s.backdropFilter, boxShadow: s.boxShadow, backgroundImage: s.backgroundImage, backgroundColor: s.backgroundColor };
});
if (!headerStyle) {
	log("header(.side-head) 存在", false, "未找到 .side-head");
} else {
	log("header 磨砂玻璃(backdrop-filter)", headerStyle.backdropFilter !== "none", headerStyle.backdropFilter);
	log("header 阴影(box-shadow)", headerStyle.boxShadow !== "none", headerStyle.boxShadow);
	log("header 底框(background-image)", headerStyle.backgroundImage !== "none", headerStyle.backgroundImage.slice(0, 60));
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
	const header = document.querySelector(".side-head");
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
await page.screenshot({ path: "/tmp/ui-check.png", fullPage: false });
log("截图已保存", true, "/tmp/ui-check.png");

// 5. 控制台错误/告警
log("控制台错误", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | ") || "无");
log("控制台告警", consoleWarns.length === 0, consoleWarns.slice(0, 3).join(" | ") || "无");

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
if (failed.length) {
	console.log("失败项：");
	for (const f of failed) console.log(`  - ${f.label}`);
	process.exitCode = 1;
}
