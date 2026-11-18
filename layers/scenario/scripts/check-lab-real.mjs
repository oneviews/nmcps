// layers/scenario/scripts/check-lab-real.mjs
// 真实 Mininet 端到端手验（NMCPS-ADR-0022 的 W8 / 右栏五标签、NMCPS-ADR-0025 的渲染边界）。
//
// 与 `check:ui` / `check:lab-bff` 的分工：那两个跑**假上游**（终端只回显），
// 看不出「按键真的被真 bash 认了吗」。这里把 BFF 的 `NUXT_MININET_INSTANCES`
// 指向本机真后端（`pnpm dev:lab-api`，Mininet 需要 root），用真 bash + 真 PTY 验证：
//   演示开关预填 alice → 运行态读真后端 → 五标签切换 → 真提示符 → 算术执行 →
//   方向键行内编辑 → `Ctrl-L` 清屏后仍可用 → 粘贴整段执行 → `Ctrl+V` 不留 `v` →
//   切标签不拆 socket → 收起右栏全断。
//
// 门禁：默认**不跑**（脚本会建 h1、起停一个真网络），必须显式开门：
//   CHECK_REAL_MININET=1 pnpm check:lab-real
// 前置：`pnpm build:server`（消费 `.output/server/index.mjs`）+ 一个**空**的真后端
// （`GET /api/mininet/start` 为 false 且 hosts / switches / routers / nats / controllers 全空）。
// 结束时脚本自己收尾：停网络、删掉它建的 `h1`、删临时台账；不碰别人正在跑的拓扑 ——
// 所以空实例守卫是硬门，别为了「跑通」把它去掉。
import { existsSync, rmSync } from "node:fs";
import process from "node:process";
import { chromium } from "playwright";
import { closeUpstream, freePort, HOST, SERVER_ENTRY, startBff, startUpstream, stopBff } from "../../../scripts/lib/bff-harness.mjs";

/** 真后端地址：与 `NUXT_MININET_INSTANCES` 里登记的一致（`pnpm dev:lab-api` 的默认值） */
const REAL_BASE = "http://127.0.0.1:8000";
/** 本脚本自建自删的节点 / 租户 / 台账：租户名必须与假 IAM 给 alice 的租户一致 */
const NODE_ID = "h1";
const TENANT = "t_default";
const LEDGER_FILE = `/tmp/check-lab-real-ledger-${process.pid}.json`;

const results = [];
const log = (name, ok, detail) => {
	results.push(ok);
	console.log(`${ok ? "✅" : "❌"} ${name}${detail === undefined ? "" : ` — ${detail}`}`);
};

/** 真后端的直连调用：只用于**准备与收尾**（建 / 删节点、起停网络、读健康） */
const call = async (method, path, body) => {
	const response = await fetch(`${REAL_BASE}${path}`, {
		method,
		headers: body === undefined ? undefined : { "content-type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body)
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
	console.log(`❌ 真后端不是空实例（${occupied.join(" / ")}）：脚本会 start/stop 网络并删掉自己建的 ${NODE_ID}，`);
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
if (!created.ok) {
	console.log(`❌ 建 ${NODE_ID} 失败（${created.status}）：${created.text.slice(0, 120)}`);
	process.exit(1);
}
const startedNetwork = await call("POST", "/api/mininet/start");
if (!startedNetwork.ok) {
	console.log(`❌ 启动真网络失败（${startedNetwork.status}）：${startedNetwork.text.slice(0, 160)}`);
	await call("DELETE", `/api/mininet/delete_node/${NODE_ID}`);
	process.exit(1);
}
networkStarted = true;

const upstreamPort = await freePort();
const upstream = await startUpstream(upstreamPort);
const port = await freePort();
const bff = await startBff(port, {
	NUXT_BFF_UPSTREAM_BASE: `http://${HOST}:${upstreamPort}`,
	NUXT_BFF_SESSION_SECRET: "check-lab-real-secret-0123456789",
	// 单租户实例：BFF 的每个 `/api/lab/**` 都落到这台真后端
	NUXT_MININET_INSTANCES: JSON.stringify({ [TENANT]: { baseUrl: REAL_BASE } }),
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
		resources: { nodes: [NODE_ID] }
	}]),
	// 演示开关打开：登录页预填实验台操作员，一步进实验台
	NUXT_PUBLIC_DEMO_LAB_OPERATOR: "true"
});
const BASE = `http://${HOST}:${port}`;

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
	const runState = await page.evaluate(async () => (await fetch("/api/lab/start")).json());
	log("BFF 把运行态指向真后端（已启动的网）", runState?.data === true, JSON.stringify(runState?.data));

	const openSideTab = async (label) => {
		const tab = page.locator("[data-testid='mininet-side-tabs'] [role='tab']").filter({ hasText: label });
		if (await tab.count() === 0)
			return false;
		await tab.first().click();
		await page.waitForTimeout(300);
		return true;
	};

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
} catch (error) {
	log(`脚本异常：${error.message}`, false, error.stack?.split("\n")[1]?.trim());
} finally {
	await browser.close();
	await stopBff(bff);
	await closeUpstream(upstream);
	// 收尾真后端：停网络（同时终止 PTY）→ 删掉自建的节点 → 删临时台账
	if (networkStarted)
		await call("POST", "/api/mininet/stop").catch(() => undefined);
	await call("DELETE", `/api/mininet/delete_node/${NODE_ID}`).catch(() => undefined);
	rmSync(LEDGER_FILE, { force: true });
	const passed = results.filter(Boolean).length;
	console.log(`\n${passed}/${results.length} 项通过（真实 Mininet + 真 bash + PTY）`);
	process.exit(passed === results.length && results.length > 0 ? 0 : 1);
}
