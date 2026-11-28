// layers/scenario/scripts/check-lab-real.mjs
// 真实 Mininet 端到端手验（NMCPS-ADR-0022 的 W8 / 右栏五标签、NMCPS-ADR-0025 的渲染边界）。
//
// 与 `check:ui` / `check:lab-bff` 的分工：那两个跑**假上游**（终端只回显），
// 看不出「按键真的被真 bash 认了吗」。这里把 BFF 的 `NUXT_MININET_INSTANCES`
// 指向本机真后端（`pnpm dev:lab-api`，Mininet 需要 root），用真 bash + 真 PTY 验证：
//   演示开关预填 alice → 运行态读真后端 → 栏顶「停止 / 启动 / 重启」真打 Mininet（h1 的 pid 换人）→
//   五标签切换 → 真提示符 → 算术执行 →
//   方向键行内编辑 → `Ctrl-L` 清屏后仍可用 → 粘贴整段执行 → `Ctrl+V` 不留 `v` →
//   切标签不拆 socket → 收起右栏全断 → 双击链路改带宽（W13）并回读上游属性 →
//   真后端 iperf 收尾并回读两侧读数（2026-11-23 补的 D1 缺口）→
//   真机 SNMP v2c：部署默认串 snmpwalk 到对端、开通 / 轮换 / 吊销后新旧串的应答差异（11.16）。
//
// 门禁：默认**不跑**（脚本会建 h1 / h2 与一条链路、起停一个真网络），必须显式开门：
//   CHECK_REAL_MININET=1 pnpm check:lab-real
//   CHECK_REAL_IAM=1 另加一节真 IAM 能力位验收：登录真实 IAM 的 alice，断言
//   `/api/mininet/channel` = `terminal + sniffer` 且 `create/operate/delete` 全 false，
//   再跑一轮抓包启停并断言 `pingall` 回 403；IAM 地址用 `REAL_IAM_BASE` 覆盖
//   （默认 http://192.168.1.55:8888，需该实例已有 alice 且两个实验室角色都已分配）。
// 真后端地址默认 http://127.0.0.1:8000（`pnpm dev:lab-api` 的本机口径），可用 `REAL_MININET_BASE`
// 覆盖：有些机器 127.0.0.1:8000 被 nginx 的默认 SSL server 占着，只有走网卡地址才能拿到后端。
// 后端配了 `LAB_API_TOKEN` 时（网卡地址只认 token），把同值导给包装脚本即可，它负责带上
// `x-lab-token` 并给 BFF 配 `NUXT_MININET_TOKEN`：
//   LAB_API_TOKEN=<token> REAL_MININET_BASE=http://192.168.1.90:8000 pnpm check:lab-real:root
// 前置：`pnpm build:server`（消费 `.output/server/index.mjs`）+ 一个**空**的真后端
// （`GET /api/mininet/start` 为 false 且 hosts / switches / routers / nats / controllers 全空）。
// root 整跑（tc 与 SNMP 两层不再跳过，共 21 项）：`sudo -A env PATH=… CHECK_REAL_MININET=1 … node <本文件>`，
// 完整命令见 `.clinerules/09-local-sudo.md`；`sudo` 会重置环境变量，所以那几个变量得跟在 `env` 之后。
// 结束时脚本自己收尾：停网络、删掉它建的 `h1` / `h2`（连带那条自建链路）、删临时台账；
// 不碰别人正在跑的拓扑 —— 所以空实例守卫是硬门，别为了「跑通」把它去掉。
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import process from "node:process";
import { closeUpstream, freePort, HOST, SERVER_ENTRY, startBff, startUpstream, stopBff } from "../../../scripts/lib/bff-harness.mjs";

/**
 * 真后端地址：与 `NUXT_MININET_INSTANCES` 里登记的一致（`pnpm dev:lab-api` 的默认值）。
 * `REAL_MININET_BASE` 可覆盖 —— 后端不在本机回环时（或 127.0.0.1:8000 被别的服务占着）用它。
 */
const REAL_BASE = process.env.REAL_MININET_BASE ?? "http://127.0.0.1:8000";
/** 本脚本自建自删的节点 / 租户 / 台账：租户名必须与假 IAM 给 alice 的租户一致 */
const NODE_ID = "h1";
/**
 * 第二台主机：W13 的链路编辑要真打会话链路 PATCH（`NMCPS-ADR-0029` M1.2），而 `intf.config(bw=…)`
 * 只有 TCLink 才会去动 tc。
 * 两台主机直连一条带 `bw` 的链路就够（上游限制「每台主机只能有一条链路」，所以不挂交换机）。
 */
const NODE_ID_2 = "h2";
/** 起网前给这条链路设的初始带宽（Mbit）：W13 会把它改成 10，回读要能看出变化 */
const SEED_BW = 5;
const TENANT = "t_default";
const LEDGER_FILE = `/tmp/check-lab-real-ledger-${process.pid}.json`;

const results = [];
const log = (name, ok, detail) => {
	results.push(ok);
	console.log(`${ok ? "✅" : "❌"} ${name}${detail === undefined ? "" : ` — ${detail}`}`);
};

/**
 * 真后端入口凭据（`M0` 远程化，`NMCPS-ARCH-007`）：后端设了 `LAB_API_TOKEN` 时，HTTP 一律要
 * `x-lab-token`，BFF 侧用同值的 `NUXT_MININET_TOKEN`。三个来源按优先级读 —— 包装脚本给的
 * `LAB_TOKEN_FILE`（0600 临时文件，避免 token 出现在 `ps` 的 `sudo env …` 里）、直接跑时的
 * `LAB_API_TOKEN` / `NUXT_MININET_TOKEN`。三者都没有 = 后端回环信任模式，两边都不发头。
 */
const LAB_TOKEN = (() => {
	if (process.env.LAB_TOKEN_FILE) {
		try {
			return readFileSync(process.env.LAB_TOKEN_FILE, "utf8").trim();
		} catch {
			return "";
		}
	}
	return (process.env.LAB_API_TOKEN ?? process.env.NUXT_MININET_TOKEN ?? "").trim();
})();

/** 真后端的直连调用：只用于**准备与收尾**（建 / 删节点、起停网络、读健康） */
const call = async (method, path, body, timeoutMs) => {
	const headers = {
		...(body === undefined ? {} : { "content-type": "application/json" }),
		...(LAB_TOKEN ? { "x-lab-token": LAB_TOKEN } : {})
	};
	const response = await fetch(`${REAL_BASE}${path}`, {
		method,
		headers,
		body: body === undefined ? undefined : JSON.stringify(body),
		signal: timeoutMs === undefined ? undefined : AbortSignal.timeout(timeoutMs)
	});
	const text = await response.text();
	let json;
	try {
		json = text ? JSON.parse(text) : undefined;
	} catch {
		json = undefined;
	}
	return { ok: response.ok, status: response.status, text, json };
};

if (process.env.CHECK_REAL_MININET !== "1") {
	console.log("⏭  跳过：真 Mininet 手验会起停一个真网络，需要显式开门 —— CHECK_REAL_MININET=1 pnpm check:lab-real");
	console.log("   前置：root 起 `pnpm dev:lab-api`（127.0.0.1:8000）+ `pnpm build:server`");
	process.exit(0);
}

if (!existsSync(SERVER_ENTRY)) {
	console.log(`❌ 找不到构建产物 ${SERVER_ENTRY}：先 \`pnpm build:server\``);
	process.exit(1);
}

const health = await call("GET", "/api/health").catch(() => undefined);
if (!health?.ok) {
	console.log(`❌ 真后端不可达：${REAL_BASE}/api/health —— 先以 root 起 \`pnpm dev:lab-api\``);
	process.exit(1);
}

// 空实例守卫：脚本要自己建节点并在结束后删掉，别人正在用的拓扑一律不碰
const [started, hosts, switches, routers, nats, controllers] = await Promise.all([
	call("GET", "/api/mininet/start"),
	call("GET", "/api/mininet/hosts"),
	call("GET", "/api/mininet/switches"),
	call("GET", "/api/mininet/routers"),
	call("GET", "/api/mininet/nats"),
	call("GET", "/api/mininet/controllers")
]);
const occupied = [
	started.json === true ? "已启动的网络" : "",
	Object.keys(hosts.json ?? {}).length ? `hosts=${Object.keys(hosts.json).join(",")}` : "",
	Object.keys(switches.json ?? {}).length ? `switches=${Object.keys(switches.json).join(",")}` : "",
	Object.keys(routers.json ?? {}).length ? `routers=${Object.keys(routers.json).join(",")}` : "",
	Object.keys(nats.json ?? {}).length ? `nats=${Object.keys(nats.json).join(",")}` : "",
	Object.keys(controllers.json ?? {}).length ? `controllers=${Object.keys(controllers.json).join(",")}` : ""
].filter(Boolean);
if (occupied.length) {
	console.log(`❌ 真后端不是空实例（${occupied.join(" / ")}）：脚本会 start/stop 网络并删掉自己建的 ${NODE_ID} / ${NODE_ID_2}，`);
	console.log("   拿正在用的拓扑跑会把别人的实验停掉。先 `curl -X POST http://127.0.0.1:8000/api/mininet/full_reset`。");
	process.exit(1);
}

const created = await call("POST", "/api/mininet/hosts", {
	id: NODE_ID,
	type: "host",
	name: NODE_ID,
	label: NODE_ID,
	x: 100,
	y: 100,
	ip: "10.0.0.1/24",
	mac: "00:00:00:00:00:01"
});
let networkStarted = false;
/** 11.16 自己开通的 SNMP 凭据：收尾必须吊销，把实例还原成部署默认串 */
let snmpCredentialCreated = false;
if (!created.ok) {
	console.log(`❌ 建 ${NODE_ID} 失败（${created.status}）：${created.text.slice(0, 120)}`);
	process.exit(1);
}

/*
 * 第二台主机 + 一条**带 `bw` 的**链路（W13 的前置）：上游只有在链路参数非空时才去
 * `intf.config(**opts)` —— 不带 options 建的普通链路改了属性只落台账、碰不到 tc，那就
 * 证明不了「真机上也生效」。所以起网前就用 `{ options: { bw } }` 建（上游据此用 TCLink
 * 建链，需要 tc 权限）。后续改带宽由页面走会话链路 PATCH（`NMCPS-ADR-0029` M1.2）；
 * 1.x 的 `PUT /links` 是同一件事的旧入口，页面已不再调用。
 */
const peer = await call("POST", "/api/mininet/hosts", {
	id: NODE_ID_2,
	type: "host",
	name: NODE_ID_2,
	label: NODE_ID_2,
	x: 320,
	y: 100,
	ip: "10.0.0.2/24",
	mac: "00:00:00:00:00:02"
});
const seededLink = peer.ok
	? await call("POST", "/api/mininet/links", { src: NODE_ID, dst: NODE_ID_2, options: { bw: SEED_BW } })
	: { ok: false, status: peer.status, text: peer.text };
if (!seededLink.ok) {
	console.log(`❌ 建 ${NODE_ID_2} / ${NODE_ID}-${NODE_ID_2} 链路失败（${seededLink.status}）：${seededLink.text.slice(0, 160)}`);
	await call("DELETE", `/api/mininet/delete_node/${NODE_ID}`).catch(() => undefined);
	await call("DELETE", `/api/mininet/delete_node/${NODE_ID_2}`).catch(() => undefined);
	process.exit(1);
}

const startedNetwork = await call("POST", "/api/mininet/start");
if (!startedNetwork.ok) {
	console.log(`❌ 启动真网络失败（${startedNetwork.status}）：${startedNetwork.text.slice(0, 160)}`);
	await call("DELETE", `/api/mininet/delete_node/${NODE_ID}`).catch(() => undefined);
	await call("DELETE", `/api/mininet/delete_node/${NODE_ID_2}`).catch(() => undefined);
	process.exit(1);
}
networkStarted = true;

const upstreamPort = await freePort();
const upstream = await startUpstream(upstreamPort);
const port = await freePort();
const bff = await startBff(port, {
	NUXT_BFF_UPSTREAM_BASE: `http://${HOST}:${upstreamPort}`,
	NUXT_BFF_SESSION_SECRET: "check-lab-real-secret-0123456789",
	// 单租户实例：BFF 的每个 `/api/mininet/**` 都落到这台真后端
	NUXT_MININET_INSTANCES: JSON.stringify({ [TENANT]: { baseUrl: REAL_BASE } }),
	// 后端要 `x-lab-token` 时，BFF 用同一个值（`NUXT_MININET_TOKEN`）；回环信任模式下不设
	...(LAB_TOKEN ? { NUXT_MININET_TOKEN: LAB_TOKEN } : {}),
	NUXT_LAB_LEDGER_FILE: LEDGER_FILE,
	// 台账先登记本网的节点清单：ws-ticket 的 `target` 只放行清单内节点，
	// 不登记就等页面刷新台账之后再开会话（这里直接给全，省掉时序依赖）
	NUXT_LAB_LEDGER_SEED: JSON.stringify([{
		id: "net_real",
		tenant_id: TENANT,
		engine: "mininet",
		upstream_id: `mininet-${TENANT}`,
		state: "running",
		created_by: "u_alice",
		created_at: "2026-11-18T00:00:00.000Z",
		updated_at: "2026-11-18T00:00:00.000Z",
		resources: { nodes: [NODE_ID, NODE_ID_2] }
	}]),
	// 演示开关打开：登录页预填实验台操作员，一步进实验台
	NUXT_PUBLIC_DEMO_LAB_OPERATOR: "true"
});
const BASE = `http://${HOST}:${port}`;

/*
 * 以 root 整跑（`sudo -A … node layers/scenario/scripts/check-lab-real.mjs`）时，Playwright 会去
 * `/root/.cache/ms-playwright` 找浏览器，而机器上的浏览器通常装在调用者（`SUDO_USER`）的缓存里 ——
 * 这里只做回落，显式设了 `PLAYWRIGHT_BROWSERS_PATH` 就照办。Chromium 的 sandbox 不用管：
 * Playwright 缺省就带 `--no-sandbox`（`chromiumSandbox: false`），2026-11-20 实测 root 下直接可用。
 *
 * ⚠ 所以 `playwright` 必须**动态** import：它的浏览器目录在模块初始化时就固定了，
 * 静态 import 会被 hoist 到本段之前，改了环境变量也不生效（实测报错仍是 `/root/.cache/...`）。
 */
if (process.getuid?.() === 0 && !process.env.PLAYWRIGHT_BROWSERS_PATH) {
	const browsers = ["/root/.cache/ms-playwright", process.env.SUDO_USER ? `/home/${process.env.SUDO_USER}/.cache/ms-playwright` : ""]
		.filter(Boolean)
		.find((dir) => {
			try {
				return existsSync(dir) && readdirSync(dir).some((entry) => entry.startsWith("chromium"));
			} catch {
				return false;
			}
		});
	if (browsers)
		process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;
}

const { chromium } = await import("playwright");
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 960 } })).newPage();
page.on("pageerror", (error) => console.log(`pageerror: ${error.message}`));

const waitForText = async (selector, predicate, timeout = 20000) => {
	const deadline = Date.now() + timeout;
	let text = "";
	while (Date.now() < deadline) {
		text = (await page.locator(selector).textContent() ?? "").trim();
		if (predicate(text))
			return text;
		await page.waitForTimeout(200);
	}
	return text;
};

try {
	// ── 登录页：演示开关打开时预填 alice（真 IAM 侧的账号由假上游提供） ──
	await page.goto(`${BASE}/auth/login`, { waitUntil: "networkidle" });
	const prefill = await page.locator("input[autocomplete='username']").inputValue();
	log("演示开关打开时登录页预填 alice", prefill === "alice", prefill);
	await page.locator("button[type='submit']").first().click();
	await page.waitForURL((url) => url.pathname !== "/auth/login", { timeout: 20000 }).catch(() => {});

	// ── 实验台：运行态经 BFF 读真后端（`true` 才给探测 / 停止） ──
	await page.goto(`${BASE}/scenario/simulator`, { waitUntil: "networkidle" });
	await page.waitForSelector("[data-testid='mininet-side-tabs']", { timeout: 20000 });
	const runState = await page.evaluate(async () => (await fetch("/api/mininet/start")).json());
	log("BFF 把运行态指向真后端（已启动的网）", runState?.data === true, JSON.stringify(runState?.data));

	/** 右栏是五标签面板：运行读数 / 抓包观察窗在「连通」，观测三块在各自的标签 */
	const openSideTab = async (label) => {
		const tab = page.locator("[data-testid='mininet-side-tabs'] [role='tab']").filter({ hasText: label });
		if (await tab.count() === 0)
			return false;
		await tab.first().click();
		await page.waitForTimeout(300);
		return true;
	};

	/*
	 * 11.10 栏顶运行控制打真后端（NMCPS-ADR-0022 W10）：工具栏「运行」菜单已删除，启动 / 停止 /
	 * 重启常驻在画布**外面**那一列的栏顶。`check:ui` 用假上游证明了「按钮发的请求对不对」，
	 * 这里补另一半 —— 同一批按钮打到**真** Mininet：点下去 `is_started` 真的翻面、`POST /stop`
	 * 真的重建拓扑（`mn -c` 那一步），所以每个方向点一次就能证明按钮没有被画成装饰。
	 * 运行态徽章在右栏「连通」标签里（默认停在「网络」），先切过去再读。
	 */
	await openSideTab("连通");

	const runButton = (id) => page.locator(`[data-testid='${id}']`);
	const runStateNow = async () => (await call("GET", "/api/mininet/start")).json === true;
	const runButtons = async () => page.evaluate(() => {
		const read = (id) => {
			const node = document.querySelector(`[data-testid='${id}']`);
			if (!node)
				return null;
			return node.hasAttribute("disabled") || node.getAttribute("aria-disabled") === "true";
		};
		return {
			badge: (document.querySelector("[data-testid='mininet-run-state']")?.textContent ?? "").trim(),
			start: read("mininet-run-start"),
			stop: read("mininet-run-stop"),
			restart: read("mininet-run-restart")
		};
	});
	const waitForRunState = async (expected, timeout = 90000) => {
		const deadline = Date.now() + timeout;
		while (Date.now() < deadline) {
			if (await runStateNow() === expected)
				return true;
			await page.waitForTimeout(200);
		}
		return false;
	};

	const railProbe = await page.evaluate(() => {
		const palette = document.querySelector("[data-testid='mininet-node-palette']");
		const canvas = document.querySelector("[data-testid='topology-canvas']");
		const paletteBox = palette?.getBoundingClientRect();
		const canvasBox = canvas?.getBoundingClientRect();
		const buttonTops = ["mininet-run-start", "mininet-run-stop", "mininet-run-restart"]
			.map((id) => document.querySelector(`[data-testid='${id}']`)?.getBoundingClientRect());
		return {
			rail: !!palette,
			// 与 `check:ui` 11.4 同一判据：整列在画布**左外侧**，三个动作都在列的**上半部**
			outsideCanvas: !!(paletteBox && canvasBox && paletteBox.right <= canvasBox.left + 1),
			buttonsOnTop: buttonTops.every((box) => box && paletteBox
				&& box.top >= paletteBox.top - 1 && box.top < paletteBox.top + paletteBox.height / 2)
		};
	});
	const initialRun = await runButtons();
	const legacyRunMenu = await page.locator("[data-testid='mininet-run-menu']").count();
	log(
		"11.10 运行控制常驻画布外那列的栏顶，工具栏不再有「运行」菜单，且状态栏与真后端一致",
		railProbe.rail && railProbe.outsideCanvas && railProbe.buttonsOnTop && legacyRunMenu === 0
		&& initialRun.badge === "运行中"
		&& initialRun.start === true && initialRun.stop === false && initialRun.restart === false,
		`栏=${railProbe.rail} 画布外=${railProbe.outsideCanvas} 栏顶=${railProbe.buttonsOnTop}`
		+ ` 旧菜单=${legacyRunMenu} 徽章=${initialRun.badge} 启动禁用=${initialRun.start}`
		+ ` 停止禁用=${initialRun.stop} 重启禁用=${initialRun.restart}`
	);

	/*
	 * `h1` 的进程 pid：`GET /interfaces` 把 Mininet 的 `host.pid` 直接吐出来。
	 * 它不是运行态信号 —— `POST /stop` 重建拓扑时就顺手把 host 进程起了（实测停着的网上
	 * `intfs` 为空、`pid` 却是新的），所以 pid 只用来证明「stop 段真的重建过拓扑」：
	 * 重启前后必须换人。运行态仍以 `GET /start`（`app.net.is_started`）为准。
	 */
	const nodePid = async () => {
		const res = await call("GET", "/api/mininet/interfaces");
		if (!res.ok)
			return null;
		const node = (res.json?.nodes ?? []).find((entry) => entry.id === NODE_ID);
		return typeof node?.pid === "number" ? node.pid : null;
	};

	// ── 停止：确认弹窗 → 真后端 `is_started` 翻 false，探测被上游按「没启动」拒绝 ──
	await runButton("mininet-run-stop").click();
	await page.waitForTimeout(300);
	const stopModal = await page.evaluate(() => ({
		open: !!document.querySelector("[data-testid='mininet-run-stop-confirm']"),
		mentionsProcesses: (document.body.textContent ?? "").includes("终止全部节点进程")
	}));
	await runButton("mininet-run-stop-confirm").click();
	const stoppedForReal = await waitForRunState(false);
	// 页面自己的请求由浏览器的 fetch 收尾，比脚本直连上游晚一拍；给渲染一点时间再读按钮
	await page.waitForTimeout(600);
	const afterStop = await runButtons();
	// 停着的网跑不了探测（上游 `run_pingall` 直接 400）：比「读 pid」更能说明网真的停了
	const pingWhileStopped = await call("POST", "/api/mininet/pingall");
	log(
		"11.10 栏顶「停止」经确认后真把网络停了（真后端 is_started=false，探测被上游拒绝）",
		stopModal.open && stopModal.mentionsProcesses && stoppedForReal
		&& afterStop.badge === "已停止" && afterStop.start === false && afterStop.stop === true
		&& pingWhileStopped.status === 400,
		`弹窗=${stopModal.open} 写明后果=${stopModal.mentionsProcesses} 真后端=${stoppedForReal}`
		+ ` 徽章=${afterStop.badge} 启动禁用=${afterStop.start}`
		+ ` 停止后探测=${pingWhileStopped.status}`
	);

	// ── 启动：真建网并起节点（对已在跑的网上游会回 400，所以 true 只可能来自真 start） ──
	await runButton("mininet-run-start").click();
	const startedForReal = await waitForRunState(true);
	await page.waitForTimeout(600);
	const afterStart = await runButtons();
	const pidAfterStart = await nodePid();
	const pingWhileRunning = await call("POST", "/api/mininet/pingall");
	log(
		"11.10 栏顶「启动」真把网络拉起来（真后端 is_started=true，探测恢复可用）",
		startedForReal && afterStart.badge === "运行中"
		&& afterStart.start === true && afterStart.stop === false && afterStart.restart === false
		&& pingWhileRunning.status === 200 && pidAfterStart > 0,
		`真后端=${startedForReal} 徽章=${afterStart.badge} 启动禁用=${afterStart.start}`
		+ ` 停止禁用=${afterStart.stop} 重启禁用=${afterStart.restart}`
		+ ` 探测=${pingWhileRunning.status} h1进程=${pidAfterStart}`
	);

	// ── 吞吐测试：真 iperf（2026-11-23 补的 D1 缺口） ──
	// 旧实现走 Mininet 的 `Net.iperf()`，它等「服务端输出里第 2 个 `/sec`」；
	// Debian 打包的 mininet 用 `waitListening()` 的 telnet 探测，而本机 iperf 2.2.1
	// 对那条零字节连接不再打印速率行 → 条件永远不成立，端点永久挂起、`iperf_running`
	// 卡死，紧接着的 pingall 还会因为两端 shell 留在 waiting 而以 AssertionError 500。
	// 现在上游自己起进程并带硬超时，所以这里必须证明：能收尾、两侧都有读数、标志复位。
	const iperfStarted = Date.now();
	const iperfFirst = await call("POST", "/api/mininet/iperf", {
		client: NODE_ID,
		server: NODE_ID_2,
		l4_type: "TCP",
		seconds: 3
	}, 120000);
	const iperfElapsed = Date.now() - iperfStarted;
	const iperfSecond = await call("POST", "/api/mininet/iperf", {
		client: NODE_ID_2,
		server: NODE_ID,
		l4_type: "TCP",
		seconds: 1
	}, 120000);
	const lastLine = (text) => String(text ?? "").trim().split("\n").pop() ?? "";
	log(
		"11.10 真后端 iperf：3 秒内收尾、两侧都有带宽读数，紧接着再跑一次不撞 409（标志已复位）",
		iperfFirst.status === 200
		&& /bits\/sec/.test(String(iperfFirst.json?.client ?? ""))
		&& /bits\/sec/.test(String(iperfFirst.json?.server ?? ""))
		&& iperfElapsed < 60000
		&& iperfSecond.status === 200,
		`首个=${iperfFirst.status} 耗时=${iperfElapsed}ms 客户端=${JSON.stringify(lastLine(iperfFirst.json?.client))}`
		+ ` 服务端=${JSON.stringify(lastLine(iperfFirst.json?.server))} 第二个=${iperfSecond.status}`
	);

	// ── 重启 = 先停再起：stop 段会重建拓扑（h1 换 pid），结束后必须回到运行中 ──
	const pidBeforeRestart = pidAfterStart;
	await runButton("mininet-run-restart").click();
	await page.waitForTimeout(300);
	const restartModal = await page.evaluate(() => ({
		open: !!document.querySelector("[data-testid='mininet-run-stop-confirm']"),
		mentionsStopThenStart: (document.body.textContent ?? "").includes("先停止再启动")
	}));
	await runButton("mininet-run-stop-confirm").click();
	let pidAfterRestart = pidBeforeRestart;
	const restartDeadline = Date.now() + 150000;
	while (Date.now() < restartDeadline) {
		await page.waitForTimeout(200);
		const current = await nodePid();
		if (current !== null && current !== pidBeforeRestart) {
			pidAfterRestart = current;
			break;
		}
	}
	const restartedForReal = await waitForRunState(true);
	await page.waitForTimeout(600);
	const afterRestart = await runButtons();
	log(
		"11.10 栏顶「重启」= 先停再起（stop 段真的重建了拓扑 / h1 换了 pid，结束后仍在运行中）",
		restartModal.open && restartModal.mentionsStopThenStart
		&& pidAfterRestart !== null && pidAfterRestart !== pidBeforeRestart && restartedForReal
		&& afterRestart.badge === "运行中" && afterRestart.restart === false,
		`弹窗=${restartModal.open} 写明先停再起=${restartModal.mentionsStopThenStart}`
		+ ` h1进程=${pidBeforeRestart}→${pidAfterRestart} 运行中=${restartedForReal} 徽章=${afterRestart.badge}`
	);

	/*
	 * SNMP v2c 真机验收（`NMCPS-ADR-0028` §6.3 的「Real machine」那一行，页面侧见 §7）：
	 * agent 绑在**主机自己的 netns** 里（`10.0.0.2:161`），根 netns 没有 10.0.0.0/24 的地址，
	 * 所以探针必须从另一台主机的 netns 发 —— `nsenter -t <h1 pid> -n snmpwalk …`，与 tc 那条
	 * 断言踩的是同一个坑（见 `.clinerules/09-local-sudo.md`）。
	 *
	 * 凭据只从写端点的响应里出现一次（D9），而读端点在有凭据时把 `community` 置 `null`，
	 * 所以这里只在**未开通**的实例上跑：自己开通 → 验串 → 轮换 → 验新串 / 旧串失效 → 吊销
	 * → 部署默认串回来。已开通的实例上密文不可读，脚本不替运维轮换自己的凭据。
	 */
	const snmpWalkFrom = (hostPid, community, target) => {
		try {
			const out = execFileSync(
				"nsenter",
				["-t", String(hostPid), "-n", "snmpwalk", "-v2c", "-c", community, "-On", "-t", "1", "-r", "0", target, "1.3.6.1.2.1.1.5.0"],
				{ encoding: "utf8", timeout: 20000 }
			);
			return { ok: true, out: out.trim(), sysName: /STRING: "?([^"\n]*)"?/.exec(out)?.[1] ?? "" };
		} catch (error) {
			return { ok: false, out: `${error.stdout ?? ""}${error.stderr ?? ""}`.trim(), sysName: "" };
		}
	};
	const snmpState = await call("GET", "/api/mininet/snmp/state");
	const snmpAgents = snmpState.json?.nodes ?? [];
	const snmpH1 = snmpAgents.find((entry) => entry.id === NODE_ID);
	const snmpH2 = snmpAgents.find((entry) => entry.id === NODE_ID_2);
	const snmpRunnable = process.getuid?.() === 0
		&& existsSync("/usr/bin/snmpwalk")
		&& snmpState.ok && snmpState.json?.enabled === true && snmpState.json?.onboarded === false
		&& typeof snmpH1?.pid === "number" && typeof snmpH2?.ip === "string";
	if (snmpRunnable) {
		const deployed = String(snmpState.json.community ?? "");
		const baseline = snmpWalkFrom(snmpH1.pid, deployed, snmpH2.ip);
		log(
			"11.16 真机 SNMP：部署默认串从 h1 的 netns 走 h2:161 读回 sysName",
			baseline.ok && baseline.sysName === NODE_ID_2,
			`后端=${snmpState.json.community_source} 目标=${snmpH2.ip} 读数=${JSON.stringify(baseline.out.slice(0, 80))}`
		);

		// 开通：密文只在响应里，agent 全量重启后新串必须能读、部署默认串必须失效
		const onboard = await call("POST", "/api/mininet/snmp/onboard", {}, 30000);
		const secret = typeof onboard.json?.community === "string" ? onboard.json.community : "";
		snmpCredentialCreated = secret.length > 0;
		await new Promise((resolve) => setTimeout(resolve, 800));
		const withSecret = secret ? snmpWalkFrom(snmpH1.pid, secret, snmpH2.ip) : { ok: false, out: "", sysName: "" };
		const deployedRejected = snmpWalkFrom(snmpH1.pid, deployed, snmpH2.ip);

		// 轮换：版本 +1、拿到另一份密文，上一版必须失效（旧 agent 没被回收就会在这里露出来）
		const rotated = await call("POST", "/api/mininet/snmp/rotate", {}, 30000);
		const secret2 = typeof rotated.json?.community === "string" ? rotated.json.community : "";
		await new Promise((resolve) => setTimeout(resolve, 800));
		const withSecret2 = secret2 ? snmpWalkFrom(snmpH1.pid, secret2, snmpH2.ip) : { ok: false, out: "", sysName: "" };
		const previousRejected = secret ? snmpWalkFrom(snmpH1.pid, secret, snmpH2.ip) : { ok: false, out: "", sysName: "" };

		// 吊销：agent 回落部署默认串（D12），读端点回到 `onboarded: false`
		const revoked = await call("DELETE", "/api/mininet/snmp/credentials", undefined, 30000);
		if (revoked.ok)
			snmpCredentialCreated = false;
		await new Promise((resolve) => setTimeout(resolve, 800));
		const backToDeployed = snmpWalkFrom(snmpH1.pid, deployed, snmpH2.ip);
		const afterRevoke = await call("GET", "/api/mininet/snmp/state");
		log(
			"11.16 真机 SNMP 凭据：开通串可读且旧串无应答；轮换换串、上一版失效；吊销回部署串",
			onboard.status === 200 && secret.startsWith("sim-") && withSecret.ok
			&& withSecret.sysName === NODE_ID_2 && !deployedRejected.ok
			&& rotated.status === 200 && rotated.json?.credential_version === 2
			&& secret2.length > 0 && secret2 !== secret && withSecret2.sysName === NODE_ID_2 && !previousRejected.ok
			&& revoked.ok && backToDeployed.ok && afterRevoke.json?.onboarded === false,
			`开通=${onboard.status} 开通串=${JSON.stringify(withSecret.out.slice(0, 40))} 旧串=${deployedRejected.ok ? "仍有应答" : "无应答"}`
			+ ` 轮换=${rotated.status} 版本=${rotated.json?.credential_version} 新串=${JSON.stringify(withSecret2.out.slice(0, 40))}`
			+ ` 上一版=${previousRejected.ok ? "仍有应答" : "无应答"}`
			+ ` 吊销=${revoked.status} 回部署串=${backToDeployed.ok} onboarded=${afterRevoke.json?.onboarded}`
		);
	} else {
		console.log(`⏭  跳过真机 SNMP 断言：要 root + \`/usr/bin/snmpwalk\` + 后端 \`LAB_SNMP_ENABLED=1\` 且凭据未开通（已开通时密文不可读，脚本不覆盖运维自己的凭据）`
			+ ` —— uid=${process.getuid?.()} snmpwalk=${existsSync("/usr/bin/snmpwalk")}`
			+ ` 状态=${snmpState.status} enabled=${snmpState.json?.enabled} onboarded=${snmpState.json?.onboarded}`
			+ ` agents=${JSON.stringify((snmpState.json?.nodes ?? []).map((entry) => ({ id: entry.id, pid: entry.pid, ip: entry.ip, status: entry.status })))}`);
	}

	log("右栏能切到 Webshell 标签", await openSideTab("Webshell"));

	// ── 真 PTY：提示符由 bash（`PS1` 由上游设置）打印 ──
	const connect = page.locator("[data-testid='mininet-terminal-connect']");
	if (await connect.isDisabled()) {
		await page.locator("[data-testid='mininet-terminal-node']").click();
		await page.getByRole("option").first().click();
	}
	await connect.click();
	const banner = await waitForText("[data-testid='mininet-terminal-output']", (text) => text.includes("root@"));
	log("真 PTY 问候：提示符来自 bash", banner.includes("root@"), JSON.stringify(banner.slice(-30)));

	const output = () => page.locator("[data-testid='mininet-terminal-output']");
	await output().click();
	await page.keyboard.type("echo probe-$((6*7))");
	await page.keyboard.press("Enter");
	const arithmetic = await waitForText("[data-testid='mininet-terminal-output']", (text) => text.includes("probe-42"));
	log("真 bash 执行：`echo probe-$((6*7))` 回 probe-42（回车发 \\r）", arithmetic.includes("probe-42"), JSON.stringify(arithmetic.slice(-40)));

	// 方向键：readline 光标左移两位后插入 X ⇒ 执行 `echo aXbc`（行内编辑，不是把键名当文本）
	await page.keyboard.type("echo abc");
	await page.keyboard.press("ArrowLeft");
	await page.keyboard.press("ArrowLeft");
	await page.keyboard.type("X");
	await page.keyboard.press("Enter");
	const edited = await waitForText("[data-testid='mininet-terminal-output']", (text) => text.includes("aXbc"));
	log("方向键发 CSI：readline 左移两位后插入 X，执行结果是 aXbc", edited.includes("aXbc"), JSON.stringify(edited.slice(-60)));

	// `Ctrl-L`：真 bash 清屏后仍能继续执行（清屏序列被面板洗掉，断言命令本身）
	await page.keyboard.press("Control+l");
	await page.waitForTimeout(600);
	await page.keyboard.type("echo after-clear");
	await page.keyboard.press("Enter");
	const cleared = await waitForText("[data-testid='mininet-terminal-output']", (text) => text.includes("after-clear"));
	log("Ctrl-L（0x0c）清屏后 bash 仍可执行命令", cleared.includes("after-clear"), JSON.stringify(cleared.slice(-40)));

	// `Ctrl+V` 只走粘贴事件：自身不上行 v；粘贴整段（含换行 → `\r`）由 bash 执行
	await page.keyboard.press("Control+v");
	await page.waitForTimeout(300);
	await page.evaluate(() => {
		const element = document.querySelector("[data-testid='mininet-terminal-input']");
		const data = new DataTransfer();
		data.setData("text/plain", "echo pasted-$((2+3))\n");
		element?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
	});
	const pasted = await waitForText("[data-testid='mininet-terminal-output']", (text) => text.includes("pasted-5"));
	log("粘贴整段一次送出：`echo pasted-$((2+3))` 执行回 pasted-5", pasted.includes("pasted-5"), JSON.stringify(pasted.slice(-40)));

	// `Ctrl+V` 没把 "v" 上行：随后的命令仍是干净的一行（否则 bash 会报 command not found）
	await page.keyboard.type("echo vfree");
	await page.keyboard.press("Enter");
	const vfree = await waitForText("[data-testid='mininet-terminal-output']", (text) => text.includes("vfree") && text.includes("pasted-5"));
	log("Ctrl+V 自身不上行 `v`：接着敲的命令仍是一行干净的命令", vfree.includes("vfree") && !vfree.includes("command not found"), JSON.stringify(vfree.slice(-60)));

	// ── 切标签只换视图：Webshell 的会话与转写都还在（`v-show` 常驻，不拆 socket） ──
	await openSideTab("日志");
	await page.waitForTimeout(800);
	await openSideTab("Webshell");
	const backText = await output().textContent();
	const state = (await page.locator("[data-testid='mininet-terminal-state']").textContent() ?? "").trim();
	log("切到日志再切回：会话与转写都在（切标签不拆 socket）", (backText ?? "").includes("pasted-5") && state.includes("已连接"), `状态=${state}`);

	// ── 收起右栏 = 全断：展开后没有会话标签，状态回到未连接 ──
	await page.getByRole("button", { name: "收起右栏面板" }).click();
	await page.waitForTimeout(800);
	const collapsed = await page.getByRole("button", { name: "展开右栏面板" }).count();
	const sessionsWhileCollapsed = await page.locator("[data-testid^='mininet-terminal-session-close-']").count();
	await page.getByRole("button", { name: "展开右栏面板" }).click();
	await page.waitForTimeout(800);
	const sessions = await page.locator("[data-testid^='mininet-terminal-session-close-']").count();
	const stateAfter = (await page.locator("[data-testid='mininet-terminal-state']").textContent() ?? "").trim();
	log("收起右栏即断流：展开后没有会话标签、状态回到未连接", collapsed === 1 && sessionsWhileCollapsed === 0 && sessions === 0 && stateAfter.includes("未连接"), `收起态=${collapsed} 会话=${sessions} 状态=${stateAfter}`);

	/*
	 * W13 真机：双击链路 → 改带宽 → 会话链路 PATCH（`NMCPS-ADR-0029` M1.2；1.x 的 `PUT /links`
	 * 页面已不再调用）。`check:ui` 11.13 用假上游只证明了请求体形状
	 * （`{ options }` 且只带填过的属性），这里补另一半 —— 同一批请求打到**真**后端：
	 * 属性落进 `app.link_attrs`（`GET /links` 回读）、`intf.config(bw=…)` 在真链路上被执行
	 * （链路是带 `bw` 建的 TCLink，回读里有真接口名）、页面 `load()` 后输入框也是新值。
	 *
	 * tc 那一层要 CAP_NET_ADMIN 才看得见（`tc qdisc show`），所以只在脚本以 root 运行时断言
	 * `tbf` 限速；普通用户跑就显式跳过并说明 —— 别把它悄悄算成通过。
	 *
	 * 2026-11-28 真机踩过：常驻 `:8000` 若是 M1.2 之前起的进程，两条会话 PATCH 根本没注册，
	 * 请求回 `405 Method Not Allowed`，表现就是「带宽回读还是旧值、tc 也没变」—— 看着像代码
	 * 回归，其实是后端没重启。改 `sessions.py` / 引擎后先重启后端（`curl` 打一条不存在的会话
	 * 路径应回 `404 session_not_found` 而不是 405）再跑这一条。
	 */
	/*
	 * 命中区不能按固定方向找：上游 `GET /links` 的 `from` / `to` 在 **stop → start** 之后会换个
	 * 方向（2026-11-21 真机实测：建链时回 `h1→h2`，重启后回 `h2→h1`，`intfs` 也跟着换）。
	 * 写成 `aria-label*='h1 ↔ h2'` 时，重启过的那一轮就「画布上没有这条链路」—— 双击落空、
	 * 会话链路 PATCH 根本没发，后面两条断言跟着一起假红。这里只要求「两个 id 都在这条连线的
	 * 无障碍名称里」，方向由上游决定；拿到它的 `data-link-hit-key` 再精确定位。
	 */
	const linkHitKey = await page.evaluate(([left, right]) => {
		const hit = Array.from(document.querySelectorAll("[data-testid='topology-link-hit']"))
			.find((element) => {
				const label = element.getAttribute("aria-label") ?? "";
				return label.includes(left) && label.includes(right);
			});
		return hit?.getAttribute("data-link-hit-key") ?? "";
	}, [NODE_ID, NODE_ID_2]);
	const linkHit = () => page.locator(`[data-testid='topology-link-hit'][data-link-hit-key='${linkHitKey}']`);
	const linkOnCanvas = Boolean(linkHitKey);
	await linkHit().first().dblclick({ force: true, timeout: 10000 }).catch(() => {});
	await page.waitForSelector("[data-testid='lab-link-detail-bw']", { timeout: 15000 }).catch(() => {});
	await page.waitForTimeout(600);
	const linkDetailText = await page.evaluate(() => (document.querySelector("[data-testid='lab-link-detail-body']")?.textContent ?? "").replace(/\s+/g, " ").trim());
	const seededBwShown = await page.locator("[data-testid='lab-link-detail-bw']").inputValue().catch(() => "");
	await page.locator("[data-testid='lab-link-detail-bw']").fill("10", { timeout: 5000 }).catch(() => {});
	await page.locator("[data-testid='lab-link-detail-submit']").click({ timeout: 5000 }).catch(() => {});
	await page.waitForTimeout(2000);
	const linkAfterWrite = await call("GET", "/api/mininet/links");
	const writtenLink = (linkAfterWrite.json ?? []).find((edge) => [edge.from, edge.to].sort().join("|") === [NODE_ID, NODE_ID_2].sort().join("|"));
	const linkStats = await call("GET", `/api/mininet/links/stats/${NODE_ID}/${NODE_ID_2}`);
	const detailClosed = await page.locator("[data-testid='lab-link-detail-bw']").count();
	log(
		"W13 双击链路改带宽：会话链路 PATCH 真打后端，属性回读一致且弹窗收起",
		linkOnCanvas && linkDetailText.includes(NODE_ID) && linkDetailText.includes(NODE_ID_2)
		&& seededBwShown === String(SEED_BW)
		&& writtenLink?.options?.bw === 10 && linkStats.json?.options?.bw === 10
		&& typeof writtenLink?.intfs?.from === "string" && typeof writtenLink?.intfs?.to === "string"
		&& detailClosed === 0,
		`画布=${linkOnCanvas} 弹窗=${linkDetailText.slice(0, 40)} 初始带宽=${seededBwShown || "无"}`
		+ ` 回读 bw=${writtenLink?.options?.bw} stats bw=${linkStats.json?.options?.bw}`
		+ ` 接口=${writtenLink?.intfs?.from ?? "无"}→${writtenLink?.intfs?.to ?? "无"}`
	);

	if (process.getuid?.() === 0 && writtenLink?.intfs?.from) {
		/*
		 * 三个真机事实（2026-11-20 / 2026-11-21 实测）：
		 * ① 接口不在根 netns —— Mininet 把每台主机的接口放进它自己的 netns，根 netns 里
		 *    `tc qdisc show dev h1-eth0` 什么都不打印，必须先 `nsenter -t <该主机的 pid> -n`；
		 * ② TCLink 默认用 `htb`（不是 tbf），`bw` 落到 `class htb 5:1 root … rate <bw>Mbit`；
		 * ③ `intfs.from` 是**上游给的那一端**，重启后它会换方向（见上面命中区那段注释），
		 *    所以 pid 要按接口名的前缀（`h2-eth0` → `h2`）去找 —— 固定拿 `h1` 的 pid 去
		 *    `nsenter` 看 `h2-eth0`，只会得到 `Cannot find device "h2-eth0"`。
		 */
		const iface = writtenLink.intfs.from;
		const ifaceHost = iface.split("-")[0] ?? "";
		const interfaces = await call("GET", "/api/mininet/interfaces");
		const hostNode = (interfaces.json?.nodes ?? []).find((entry) => entry.id === ifaceHost);
		let hostClass = "";
		try {
			hostClass = execFileSync("nsenter", ["-t", String(hostNode?.pid), "-n", "tc", "class", "show", "dev", iface], { encoding: "utf8" });
		} catch (error) {
			hostClass = `ERR ${error.message}`;
		}
		log(
			`W13 带宽真落到接口（root：${ifaceHost} netns 里 htb 类的 rate 已是 10Mbit）`,
			hostNode?.pid !== undefined && /htb/.test(hostClass) && /rate\s+10Mbit/.test(hostClass),
			`${iface}@pid ${hostNode?.pid ?? "无"}：${hostClass.split("\n")[0]?.slice(0, 80) ?? "无输出"}`
		);
	} else {
		console.log("⏭  跳过 tc 断言：脚本不是以 root 运行（接口在主机自己的 netns 里，`nsenter` 要 root）——链路 PATCH 的属性回读已证明写入链路，tc 那一层不算已验证；以 root 手验用 `nsenter -t <接口所属主机的 pid> -n tc class show dev <接口名>`");
	}

	// 保存后页面 `load()` 重读 `GET /links`：再双击一次，输入框里应是新值（不是本地乐观更新）
	await linkHit().first().dblclick({ force: true, timeout: 10000 }).catch(() => {});
	await page.waitForSelector("[data-testid='lab-link-detail-bw']", { timeout: 15000 }).catch(() => {});
	await page.waitForTimeout(400);
	const bwAfterReload = await page.locator("[data-testid='lab-link-detail-bw']").inputValue().catch(() => "");
	await page.keyboard.press("Escape");
	await page.waitForTimeout(300);
	log("W13 保存后重读台账：再次双击链路，带宽输入框已是 10（页面读的是上游事实）", bwAfterReload === "10", `输入框=${bwAfterReload || "无"}`);

	// ── 真 IAM 能力位（CHECK_REAL_IAM=1）：本机真 IAM 的 alice ──────────────
	// 假上游的 alice 带全部实验位，证明不了「角色只给 terminal + sniffer、不给 operate」。
	// 这一段另起一个 BFF 指向**真实 IAM**，登录 alice 后断言能力位三元组，再跑一轮抓包启停：
	// 只有 `lab:sniffer` 而没有 `lab:operate` 时，抓包能开、探测必须 403 —— 能力位互不推导。
	if (process.env.CHECK_REAL_IAM === "1") {
		const iamUrl = process.env.REAL_IAM_BASE ?? "http://192.168.1.55:8888";
		const iamLedger = `${LEDGER_FILE}.iam`;
		const iamPort = await freePort();
		const iamBff = await startBff(iamPort, {
			NUXT_BFF_UPSTREAM_BASE: iamUrl,
			NUXT_BFF_SESSION_SECRET: "check-lab-real-iam-secret-0123456789",
			NUXT_MININET_INSTANCES: JSON.stringify({ [TENANT]: { baseUrl: REAL_BASE } }),
			...(LAB_TOKEN ? { NUXT_MININET_TOKEN: LAB_TOKEN } : {}),
			NUXT_LAB_LEDGER_FILE: iamLedger,
			NUXT_LAB_LEDGER_SEED: JSON.stringify([{
				id: "net_real",
				tenant_id: TENANT,
				engine: "mininet",
				upstream_id: `mininet-${TENANT}`,
				state: "running",
				created_by: "u_alice",
				created_at: "2026-11-18T00:00:00.000Z",
				updated_at: "2026-11-18T00:00:00.000Z",
				resources: { nodes: [NODE_ID, NODE_ID_2] }
			}])
		});
		const iamBase = `http://${HOST}:${iamPort}`;

		try {
			const login = await fetch(`${iamBase}/api/auth/login`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ username: "alice", password: "p@ssw0rd" })
			});
			const cookies = typeof login.headers.getSetCookie === "function"
				? login.headers.getSetCookie()
				: [login.headers.get("set-cookie") ?? ""];
			const cookie = cookies.map((item) => item.split(";")[0]).filter(Boolean).join("; ");
			log("真 IAM：alice 登录 200（能力位自此取自真 IAM 角色）", login.status === 200 && cookie.length > 0, `${login.status} cookies=${cookies.length}`);

			const iamRequest = async (method, path, body) => {
				const response = await fetch(`${iamBase}${path}`, {
					method,
					headers: {
						cookie,
						...(body === undefined ? {} : { "content-type": "application/json" })
					},
					body: body === undefined ? undefined : JSON.stringify(body)
				});
				const text = await response.text();
				let json;
				try {
					json = text ? JSON.parse(text) : undefined;
				} catch {
					json = undefined;
				}
				return { status: response.status, json };
			};

			const channel = await iamRequest("GET", "/api/mininet/channel");
			const caps = channel.json?.data?.capabilities ?? {};
			log(
				"真 IAM：alice 的能力位 = terminal + sniffer，且 create / operate / delete 全为 false",
				caps.terminal === true && caps.sniffer === true
				&& caps.create === false && caps.operate === false && caps.delete === false,
				JSON.stringify(caps)
			);

			const probe = await iamRequest("POST", "/api/mininet/pingall");
			log("真 IAM：没有 lab:operate → pingall 403 lab_permission_denied", probe.status === 403 && probe.json?.message === "lab_permission_denied", `${probe.status} ${probe.json?.message}`);

			const start = await iamRequest("POST", "/api/mininet/sniffer/start");
			log("真 IAM：lab:sniffer 可以开始抓包（active=true）", start.status === 200 && start.json?.data?.active === true, `${start.status} ${JSON.stringify(start.json?.data)}`);

			const stop = await iamRequest("POST", "/api/mininet/sniffer/stop");
			log("真 IAM：停止抓包回到 active=false", stop.status === 200 && stop.json?.data?.active === false, `${stop.status} ${JSON.stringify(stop.json?.data)}`);
		} catch (error) {
			log(`真 IAM 能力位段异常：${error.message}`, false, error.stack?.split("\n")[1]?.trim());
		} finally {
			await stopBff(iamBff);
			rmSync(iamLedger, { force: true });
		}
	} else {
		console.log("⏭  跳过真 IAM 能力位段：CHECK_REAL_IAM=1 才跑（需可达的真实 IAM + alice 账号）");
	}
} catch (error) {
	log(`脚本异常：${error.message}`, false, error.stack?.split("\n")[1]?.trim());
} finally {
	await browser.close();
	await stopBff(bff);
	await closeUpstream(upstream);
	// 收尾真后端：吊销 11.16 开通的凭据（回到部署默认串）→ 停网络（同时终止 PTY）→
	// 删掉自建的节点（链路随节点一起从台账消失）→ 删临时台账
	if (snmpCredentialCreated)
		await call("DELETE", "/api/mininet/snmp/credentials").catch(() => undefined);
	if (networkStarted)
		await call("POST", "/api/mininet/stop").catch(() => undefined);
	await call("DELETE", `/api/mininet/delete_node/${NODE_ID}`).catch(() => undefined);
	await call("DELETE", `/api/mininet/delete_node/${NODE_ID_2}`).catch(() => undefined);
	rmSync(LEDGER_FILE, { force: true });
	const passed = results.filter(Boolean).length;
	console.log(`\n${passed}/${results.length} 项通过（真实 Mininet + 真 bash + PTY）`);
	process.exit(passed === results.length && results.length > 0 ? 0 : 1);
}
