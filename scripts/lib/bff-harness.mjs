// scripts/lib/bff-harness.mjs
// 自查脚本共用的本地脚手架：拉起 `.output/server/index.mjs`（BFF）与一个假上游。
// 前置：`pnpm build:server` —— 本模块只消费构建产物，不自行构建。
// 使用方：`scripts/check-bff.mjs`（纯 HTTP 契约）、`scripts/check-ui.mjs`（浏览器端到端）。
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

export const SERVER_ENTRY = ".output/server/index.mjs";
export const HOST = "127.0.0.1";

/**
 * `__control/metric-error` 打开时 `/metric/datapoint` 回的失败原话（HTTP 200 + `code !== 0`）。
 * 刻意写成「一句带标点、带英文缩写」的上游口吻：页面对它必须**逐字**展示（`NMCPS-CONTRACT-002` §6.7
 * 的失败语义 —— 原文是数据，不翻译、不替换成 `api_request_failed`）。自查拿这个常量做字面比对。
 */
export const METRIC_UPSTREAM_FAILURE = "指标库查询超时（tsdb: query timeout after 30s）";

/**
 * `__control/catalog-error` 打开时 `/metric/definition` 回的失败原话（HTTP 200 + `code !== 0`）。
 * 目录失败**不是**取数失败（`NMCPS-CONTRACT-002` §8.4）：页面只该提示「只按名字判断类型」，
 * 既不降级成空态，也不把这句话当成取数失败展示 —— 自查同时比对「出现了什么」与「没出现什么」。
 */
export const CATALOG_UPSTREAM_FAILURE = "指标目录服务不可用（catalog: upstream 503 after 3 retries）";

const START_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 5_000;

/** 进程内申请一个空闲端口，避免与 dev server / 已部署实例冲突 */
export async function freePort() {
	const probe = createNetServer();
	await new Promise((resolve, reject) => {
		probe.once("error", reject);
		probe.listen(0, HOST, resolve);
	});
	const { port } = probe.address();
	await new Promise((resolve) => probe.close(resolve));
	return port;
}

/** 拉起构建产物（BFF），就绪判据为 `GET /health` */
export async function startBff(port, env) {
	let output = "";
	const child = spawn(process.execPath, [SERVER_ENTRY], {
		env: {
			...process.env,
			NODE_ENV: "production",
			HOST,
			PORT: String(port),
			NO_PROXY: `${HOST},localhost`,
			no_proxy: `${HOST},localhost`,
			...env
		},
		stdio: ["ignore", "pipe", "pipe"]
	});

	child.stdout.on("data", (chunk) => {
		output += chunk;
	});
	child.stderr.on("data", (chunk) => {
		output += chunk;
	});

	const deadline = Date.now() + START_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (child.exitCode !== null)
			throw new Error(`BFF 进程提前退出（code=${child.exitCode}）\n${output}`);
		try {
			const res = await fetch(`http://${HOST}:${port}/health`);
			if (res.ok)
				return child;
		} catch {
			// 端口尚未监听，继续等
		}
		await delay(200);
	}

	child.kill("SIGKILL");
	throw new Error(`BFF 未在 ${START_TIMEOUT_MS}ms 内就绪\n${output}`);
}

export async function stopBff(child) {
	if (!child || child.exitCode !== null)
		return;
	child.kill("SIGTERM");
	const deadline = Date.now() + STOP_TIMEOUT_MS;
	while (child.exitCode === null && Date.now() < deadline)
		await delay(50);
	if (child.exitCode === null)
		child.kill("SIGKILL");
}

/** 关闭假上游：先销毁 keep-alive 连接，避免探针用例留下挂起的 socket 拖住 close */
export async function closeUpstream(server) {
	/*
	 * 升级过的 WebSocket socket 已经从 http server 的连接表里摘出去，
	 * `closeAllConnections()` 不会碰它们 —— 不显式销毁的话 `server.close()` 永远等不齐，
	 * 自检会以「unsettled top-level await」退出（实测 check:ui 退出码 13）。
	 */
	for (const socket of server.snifferUpgradeSockets ?? [])
		socket.destroy();

	server.closeAllConnections?.();
	await new Promise((resolve) => server.close(resolve));
}

/**
 * 抓包历史样本（`GET /api/mininet/sniffer/history` → `{ events }`）。
 *
 * 单独一份、与 `MININET_SNIFFER_LIVE` 不重叠：页面挂载时先读历史、开始抓包后再追加实时流，
 * 只有两份样本不同，自检才能区分「历史回填」与「WS 真的连上了」。
 */
export const MININET_SNIFFER_HISTORY = [
	{ ts: 1_760_000_000_000_000_000, proto: "UDP", src: "10.0.0.2", dst: "10.0.0.1", len: 60, info: "5353 -> 5353", node: "h2", intf: "h2-eth0", type: "packet" }
];

/** 抓包实时流样本（WS `/api/mininet/sniffer` 推的那几帧，字段与上游 `SnifferEvent` 对齐） */
export const MININET_SNIFFER_LIVE = [
	{ ts: 1_760_000_001_000_000_000, proto: "TCP", src: "10.0.0.1", dst: "10.0.0.2", len: 74, info: "52210 -> 80 [SYN]", node: "h1", intf: "h1-eth0", type: "packet" },
	{ ts: 1_760_000_002_000_000_000, proto: "ICMP", src: "10.0.0.2", dst: "10.0.0.1", len: 98, info: "type=8 code=0", node: "h2", intf: "h2-eth0", type: "packet" }
];

/** 服务端 → 客户端的文本帧（FIN + opcode 0x1，无掩码；客户端帧不参与断言） */
function serverTextFrame(text) {
	const body = Buffer.from(text, "utf8");
	if (body.length < 126) {
		return Buffer.concat([Buffer.from([0x81, body.length]), body]);
	}
	if (body.length < 65536) {
		const header = Buffer.alloc(4);
		header[0] = 0x81;
		header[1] = 126;
		header.writeUInt16BE(body.length, 2);
		return Buffer.concat([header, body]);
	}
	const header = Buffer.alloc(10);
	header[0] = 0x81;
	header[1] = 127;
	header.writeBigUInt64BE(BigInt(body.length), 2);
	return Buffer.concat([header, body]);
}

/**
 * 终端 WebSocket 的问候帧（真实上游由 PTY 输出，形状是**裸文本**，不是 JSON）。
 * BFF 不在中间做任何包装，自检据此断言文本帧原样穿过。
 *
 * 刻意带 ANSI 颜色码（`ESC[1;32m…ESC[0m`）：真实 PTY 一定带，页面若原样渲染，
 * 用户看到的是 `^[[1;32mroot@h1:/#` 而不是提示符 —— `check:ui` 11.8 断言面板里没有 ESC。
 */
export const MININET_TERMINAL_BANNER = "\u001B[1;32mroot@h1:/#\u001B[0m ";

/** 终端 `Ctrl-C`（0x03）的上游回显：真 PTY 由内核终端驱动打 `^C`，不是 `echo:` */
export const MININET_TERMINAL_INTERRUPT_ECHO = "^C\r\n";

/** 日志 WS 的前两行（真实上游是 `tail -n 1000 -f mininet.log` 的逐行文本） */
export const MININET_LOG_LINES = [
	"2026-11-17 10:00:00,000 INFO mininet starting",
	"2026-11-17 10:00:01,000 INFO h1 -> sw1 link up"
];

/** 监控采样（字段与上游 `websocket_interface_monitor` 对齐，速率单位 Gbit/s） */
export const MININET_MONITOR_SAMPLE = {
	node: "h1",
	intf: "h1-eth0",
	ts: "2026-11-17T10:00:02+00:00",
	tx_gbps: 0.125,
	rx_gbps: 0.25
};

/**
 * 客户端 → 服务端帧解析：只处理自检用得到的小帧（FIN + 必带掩码）。
 *
 * 为什么手写：`ws` 不是本项目的直接依赖，而这些自检只发一行命令、只收一段回显。
 * 返回解析出的帧与**没拼完的尾巴**（TCP 可能把一帧拆成两次 `data`）。
 */
function readClientFrames(buffer) {
	const frames = [];
	let offset = 0;

	while (buffer.length - offset >= 2) {
		const opcode = buffer[offset] & 0x0F;
		const masked = (buffer[offset + 1] & 0x80) !== 0;
		let length = buffer[offset + 1] & 0x7F;
		let cursor = offset + 2;

		if (length === 126) {
			if (buffer.length < cursor + 2)
				break;
			length = buffer.readUInt16BE(cursor);
			cursor += 2;
		} else if (length === 127) {
			if (buffer.length < cursor + 8)
				break;
			length = Number(buffer.readBigUInt64BE(cursor));
			cursor += 8;
		}

		const maskLength = masked ? 4 : 0;
		if (buffer.length < cursor + maskLength + length)
			break;

		const mask = masked ? buffer.subarray(cursor, cursor + 4) : undefined;
		cursor += maskLength;
		const payload = Buffer.from(buffer.subarray(cursor, cursor + length));
		if (mask) {
			for (let index = 0; index < payload.length; index += 1)
				payload[index] ^= mask[index % 4];
		}

		frames.push({ opcode, text: payload.toString("utf8") });
		offset = cursor + length;
	}

	return { frames, rest: buffer.subarray(offset) };
}

/**
 * 给假上游挂四条实验 WebSocket（NMCPS-ADR-0022 D6）：抓包 / 终端 / 日志 / 监控。
 *
 * 为什么四张路由共用**一个** `upgrade` 监听：`server.on("upgrade")` 允许多个监听，
 * 但每个都会收到同一次升级 —— 各自「不是我的路径就 destroy」会把别人的 socket 拆掉。
 * 所以这里只有一张派发表，路径不命中才 destroy。
 *
 * 为什么手写握手而不是引 `ws`：自检脚本只消费**服务端**文本帧、只发一行终端输入，
 * 握手 + 写帧 + 小帧解析不到 100 行；而 `ws` 不是本项目的直接依赖（跨层引一个传递依赖，
 * 构建期一改就可能断）。真实上游由 FastAPI 的四个 `@app.websocket` 提供，
 * 形状见 `mininet_gui_backend/api.py`。
 *
 * 返回的连接记录数组（`{ path, search, headers }`）用来断言「BFF 真的向上游建了连」——
 * 浏览器侧握手成功只能证明 BFF 接受了升级，证明不了它连到了哪。
 *
 * @param {import("node:http").Server} server
 * @param {{ events?: object[], path?: string }} [options]
 */
export function attachSnifferSocket(server, options = {}) {
	const events = options.events ?? MININET_SNIFFER_LIVE;
	const path = options.path ?? "/api/mininet/sniffer";
	const connections = [];
	/** 升级后的 socket 不再归 http server 管：`closeAllConnections()` 不会碰它们 */
	const openSockets = new Set();
	server.snifferUpgradeSockets = openSockets;

	/**
	 * 通道派发表：`prefix` 表示路径段之后还可有内容（终端是 `/terminal/<node>`）。
	 * 终端额外带 `echo`：上游把收到的一行回成 `echo:<行>`，自检据此证明
	 * 「浏览器 → BFF → 上游」这条上行链路通了（只有这条通道有上行）。
	 */
	const specs = [
		{ path, frames: events.map((event) => JSON.stringify(event)) },
		{ path: "/api/mininet/terminal", prefix: true, frames: [MININET_TERMINAL_BANNER], echo: true },
		{ path: "/api/mininet/logs", frames: [...MININET_LOG_LINES] },
		{ path: "/api/mininet/monitor", frames: [JSON.stringify(MININET_MONITOR_SAMPLE)] }
	];

	server.on("upgrade", (req, socket) => {
		let url;
		try {
			url = new URL(req.url, `http://${HOST}`);
		} catch {
			socket.destroy();
			return;
		}

		const spec = specs.find((item) => item.prefix
			? url.pathname.startsWith(`${item.path}/`)
			: url.pathname === item.path);
		if (!spec) {
			socket.destroy();
			return;
		}

		const key = req.headers["sec-websocket-key"];
		if (typeof key !== "string") {
			socket.destroy();
			return;
		}

		openSockets.add(socket);
		socket.on("close", () => openSockets.delete(socket));
		/**
		 * 这条上游连的入站帧（`input`）：逐键映射只能靠「上游到底收到哪串字节」来证明 ——
		 * 回显会被面板的 ANSI 清洗吃掉，`Ctrl-L` 的 `0x0c` 与 `ESC[C` 在那里看不清。
		 * 抓包 / 日志 / 监控没有上行，数组因此恒为空。
		 */
		const connection = { path: url.pathname, search: url.search, headers: req.headers, input: [] };
		connections.push(connection);

		// RFC 6455 §4.2.2：`Sec-WebSocket-Accept = base64(sha1(key + GUID))`
		const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
		socket.write([
			"HTTP/1.1 101 Switching Protocols",
			"Upgrade: websocket",
			"Connection: Upgrade",
			`Sec-WebSocket-Accept: ${accept}`,
			"",
			""
		].join("\r\n"));

		socket.on("error", () => {});
		/*
		 * 终端有上行：假上游按**真 PTY 的形状**回答（NMCPS-ADR-0022 W8）——
		 * 收到的可打印字节原样回显（面板逐键发送，回显由上游给，不是本地画的），
		 * 换行（`\r` / `\n` / `\r\n`）把整行回成 `echo:<line>`，`0x03` 走中断分支回 `^C`。
		 * 其余通道不吃客户端帧。
		 */
		let pending = Buffer.alloc(0);
		/** 假 PTY 的行缓冲：回车才回一行 `echo:<line>`，与真 bash 的「回车才执行」一致 */
		let line = "";
		socket.on("data", (chunk) => {
			const parsed = readClientFrames(Buffer.concat([pending, chunk]));
			pending = parsed.rest;
			for (const frame of parsed.frames) {
				if (frame.opcode === 0x1)
					connection.input.push(frame.text);
				if (!spec.echo)
					continue;
				if (frame.opcode === 0x8) {
					socket.end();
					return;
				}
				if (frame.opcode !== 0x1)
					continue;

				// `Ctrl-C` 走中断分支：回显 `^C`（发字面量 `^C` 则落到 `echo:` 分支）
				if (frame.text === "\u0003") {
					line = "";
					socket.write(serverTextFrame(MININET_TERMINAL_INTERRUPT_ECHO));
					continue;
				}

				const typed = frame.text.replace(/\r\n|[\r\n]/g, "");
				if (typed) {
					line += typed;
					socket.write(serverTextFrame(typed));
				}
				if (typed.length !== frame.text.length) {
					socket.write(serverTextFrame("\r\n"));
					socket.write(serverTextFrame(`echo:${line}\r\n`));
					line = "";
				}
			}
		});

		// 等 BFF 侧 peer 打开再推：升级完成到 crossws `open` 之间还有一次事件循环
		setTimeout(() => {
			if (socket.destroyed)
				return;
			for (const frame of spec.frames) {
				if (socket.destroyed)
					return;
				socket.write(serverTextFrame(frame));
			}
		}, 30).unref?.();
	});

	return connections;
}

/**
 * 把扁平拓扑样本包成现网的两层形状（G6 元素形态，`NMCPS-DESIGN-001` §6.10）：
 * `{ id, data: { deviceName, tier, status, cpu… }, style: { x, y }, combo }`，链路同样把事实塞进 `data`。
 *
 * 为什么假上游要默认回这个形状：2026-11-07 之前自检一直只回扁平样本，比现网「干净」，
 * 于是「`data.tier` 读不到 ⇒ 36 个节点排成一条水平线」这类**形状缺口**没有任何断言能发现
 * （A27 落地前的实测：`rows = 1`）。包一层之后，A21 ~ A26 这些事实 / 布局 / 交互用例
 * 默认就走「线格式 → 拍平」这条路；`__control/topology-flat` 切回扁平形状，
 * A27 再用它证明两种形状的渲染结果**逐点一致**。
 *
 * `style.x|y` 给的是与布局无关的坐标：页面**不复用**它（几何只来自 `layoutTopology()`），
 * 这份样本的坐标因此可以随便编 —— 正好用来证明「上游坐标没被误当成布局结果」。
 */
/**
 * 分层规则样本（`__control/topology-mesh`，A43 / A44 专用）：`NMCPS-DESIGN-001` §6.8 / §七 的夹具。
 *
 * 形状刻意做成「现实里最常见、但 dagre 排不出来」的那种图：
 *   · 顶层三台设备**两两互联**（关系等价）⇒ 边表达不了上下，只能靠名称判据选举根节点；
 *   · 一台汇聚下挂两台接入，其中「接入交换机-2」**没有下级** ⇒ 应下移到末行；
 *   · 末行 14 台设备的名称比 `nodesep = 80` 宽 ⇒ 标签必须错行（`data-label-shift`）。
 *
 * 出站故意走**扁平**形状：本样本要钉的是布局规则，不是 §6.10 的两层形状（那条由 A27 钉）。
 */
function meshTopologyGraph() {
	const node = (id, name, tier, status = 1) => ({ id, name, category: "network-device", type: "access", tier, status });
	const terminals = Array.from({ length: 13 }, (_, index) => {
		const serial = String(index + 1).padStart(2, "0");
		return { id: `10.0.1.${11 + index}`, name: `无线终端设备-${serial}`, category: "client", type: "endnode", tier: 4, status: index === 5 ? 0 : 1 };
	});
	return {
		nodes: [
			node("10.0.1.1", "网控中心", 1),
			node("10.0.1.2", "核心路由器-2", 1),
			node("10.0.1.3", "核心路由器-3", 1),
			node("10.0.1.4", "汇聚交换机-1", 2),
			node("10.0.1.5", "汇聚交换机-2", 2),
			node("10.0.1.6", "接入交换机-1", 3, 2),
			node("10.0.1.7", "接入交换机-2", 3),
			...terminals
		],
		edges: [
			// 顶层网状（三台两两互联）
			{ source: "10.0.1.1", target: "10.0.1.2", status: "up", bandwidth: "1 Gbps" },
			{ source: "10.0.1.2", target: "10.0.1.3", status: "up", bandwidth: "1 Gbps" },
			{ source: "10.0.1.3", target: "10.0.1.1", status: "up", bandwidth: "1 Gbps" },
			// 核心 → 汇聚（三台核心都往下走，因此都有「下一级」）
			{ source: "10.0.1.2", target: "10.0.1.4", status: "up" },
			{ source: "10.0.1.3", target: "10.0.1.5", status: "up" },
			{ source: "10.0.1.1", target: "10.0.1.4", status: "up" },
			// 汇聚 → 接入
			{ source: "10.0.1.4", target: "10.0.1.6", status: "up" },
			{ source: "10.0.1.5", target: "10.0.1.6", status: "up" },
			// 「接入交换机-2」只有上级、没有下级 ⇒ 应下移到末行
			{ source: "10.0.1.4", target: "10.0.1.7", status: "up" },
			...terminals.map((terminal) => ({ source: "10.0.1.6", target: terminal.id, status: "up", linkType: "wireless" }))
		],
		combos: []
	};
}

/**
 * 同档下级样本（`__control/topology-same-tier`，A52 专用）：`NMCPS-DESIGN-001` §6.15 的夹具。
 *
 * 形状照现网 36 节点样本里最容易被误判的一段搬（2026-11-09 用户反馈）：
 *   · 三台胖 AP 登记成 `tier 3`，与它们上联的接入交换机**同档** ⇒ 只按「严格更靠下」判，
 *     它们谁也不是接入的下级；收起汇聚时接入被摘掉，AP 却留在画布上、不连任何东西；
 *   · 两台接入都上联同一台汇聚 ⇒ 同档且**两端都有上行** ⇒ 谁也不是谁的下级（不得凭空造层级）；
 *   · 一台终端挂在 AP-10 下面（`tier 4`）⇒ 收起汇聚要能穿过「同档那一跳」把它一起带走。
 */
function sameTierTopologyGraph() {
	const node = (id, name, tier, category = "network-device") => ({ id, name, category, type: "access", tier, status: 1 });
	return {
		nodes: [
			node("10.0.3.1", "核心路由器-1", 1),
			node("10.0.3.2", "汇聚交换机-1", 2),
			node("10.0.3.3", "接入交换机-1", 3),
			node("10.0.3.4", "接入交换机-2", 3),
			node("10.0.3.10", "Wi-Fi胖AP-10", 3, "ap"),
			node("10.0.3.11", "Wi-Fi胖AP-11", 3, "ap"),
			node("10.0.3.12", "Wi-Fi胖AP-12", 3, "ap"),
			node("10.0.3.21", "无线终端设备-01", 4, "client")
		],
		edges: [
			{ source: "10.0.3.2", target: "10.0.3.1", status: "up" },
			{ source: "10.0.3.3", target: "10.0.3.2", status: "up" },
			{ source: "10.0.3.4", target: "10.0.3.2", status: "up" },
			// 同档：两台接入互相是邻居（都上联汇聚 ⇒ 两端都有上行 ⇒ 谁也不服谁）
			{ source: "10.0.3.3", target: "10.0.3.4", status: "up" },
			// 同档：AP 只连接入（AP 没有上行 ⇒ 接入是它们的上级）
			{ source: "10.0.3.3", target: "10.0.3.10", status: "up", linkType: "wireless" },
			{ source: "10.0.3.3", target: "10.0.3.11", status: "up", linkType: "wireless" },
			{ source: "10.0.3.3", target: "10.0.3.12", status: "up", linkType: "wireless" },
			{ source: "10.0.3.10", target: "10.0.3.21", status: "up", linkType: "wireless" }
		],
		combos: []
	};
}

/** 现网的两层形状（`NMCPS-DESIGN-001` §6.10 / A27）：事实全塞进 `data`，坐标走 `style` */
function nestTopologyGraph(flat) {
	return {
		nodes: flat.nodes.map((node, index) => {
			const { id, combo, ...facts } = node;
			return {
				id,
				data: { deviceName: facts.name, ...facts },
				style: { x: 80 + index * 60, y: 120 + index * 90 },
				// 现网每个节点自带 `combo`（分组折叠读它，§6.11）；样本没写归属时落到 `combo-access`
				combo: combo ?? "combo-access"
			};
		}),
		edges: flat.edges.map((edge, index) => {
			const { source, target, ...facts } = edge;
			return { id: `e-${index}-${source}-${target}`, source, target, data: facts };
		}),
		combos: flat.combos
	};
}

// ── IAM 夹具种子（`GET /iam/roles` / `/iam/role-policies` / `/iam/subject-roles`）──
// 导出给 `scripts/check-bff.mjs`：那里的 iam 两条断言按 `.length` 走，不再把总数写死 ——
// 加一条角色 / 一条绑定只改这里，不会再让 CI 的 Gateway contract checks 假红（2026-11-26 实测过一次）。
// `startUpstream()` 每次深拷贝一份，写端点（建 / 删角色、挂 / 摘策略、授 / 撤角色）改的是副本。
/**
 * 新代角色假数据（`GET /iam/roles`，2026-11-04 实测字段）：给 `/system/permission` 两栏自查用。
 * 三条硬要求，否则用例测不出真伪：
 *   - `keyword` 真的命中 name / code（`enabled` / `tenant_id` 传了被静默忽略，UP-RBAC-06）；
 *   - 分页字段是 `page_size`，`total` 要能分页；
 *   - 留一条「删除回 `200 {code:400}`」的样本（`r_tenant_viewer_isp_a`），把 UP-RBAC-05 的
 *     失败通道固定进假上游，否则「删除失败」分支永远测不到。
 */
export const IAM_ROLE_SEED = [
	{ id: "r_platform_admin", tenant_id: null, name: "平台管理员", code: "platform.admin", description: "平台内置角色", enabled: true, is_system: true, created_at: "2026-11-03T18:59:06+08:00", updated_at: "2026-11-03T18:59:06+08:00", deleted_at: null },
	{ id: "r_tenant_admin", tenant_id: "tnt_default", name: "租户管理员", code: "tenant.admin", description: "租户内置角色", enabled: true, is_system: true, created_at: "2026-11-03T19:00:00+08:00", updated_at: "2026-11-03T19:00:00+08:00", deleted_at: null },
	{ id: "r_tenant_viewer_isp_a", tenant_id: "t_isp_a", name: "ISP-A 只读", code: "tenant.viewer", description: "删除会被上游拒绝（UP-RBAC-05）", enabled: true, is_system: false, created_at: "2026-11-04T09:20:00+08:00", updated_at: "2026-11-04T09:20:00+08:00", deleted_at: null },
	// 实验台管理角色（NMCPS-ADR-0021 / NMCPS-ADR-0022）：`labPermissionsOf()` 只认
	// `tenant_admin` 这个**下划线**编码，而本文件的 IAM 列表用的是点号编码（`tenant.admin`），
	// 两者不是同一套词表 —— 没有这条角色，`/scenario/simulator` 的自检账号只有 `lab:read`，
	// 「写动作先读能力位」的正向分支就永远测不到。
	{ id: "r_lab_tenant_admin", tenant_id: "t_default", name: "实验台管理员", code: "tenant_admin", description: "仿真网络读写（NMCPS-ADR-0021 D3）", enabled: true, is_system: false, created_at: "2026-11-16T09:00:00+08:00", updated_at: "2026-11-16T09:00:00+08:00", deleted_at: null },
	// 抓包授权（NMCPS-ADR-0022 W5）：`lab:sniffer` 必须单独授予，不能由 `tenant_admin` 推导；
	// 自检账号额外挂这一条，才能在浏览器里走到「工具」菜单的启停 / 下载。
	{ id: "r_lab_sniffer", tenant_id: "t_default", name: "实验台抓包", code: "lab_sniffer", description: "抓包启停与 pcap 下载（NMCPS-ADR-0021 D3）", enabled: true, is_system: false, created_at: "2026-11-16T10:00:00+08:00", updated_at: "2026-11-16T10:00:00+08:00", deleted_at: null },
	// 终端授权（NMCPS-ADR-0022 D6）：与抓包同一条纪律 —— 没有这条角色，自检账号的
	// Network Tools 里只会有日志 / 监控两个标签页，Webshell 的正向分支永远测不到。
	{ id: "r_lab_terminal", tenant_id: "t_default", name: "实验台终端", code: "lab_terminal", description: "Webshell 进入节点终端（NMCPS-ADR-0021 D3）", enabled: true, is_system: false, created_at: "2026-11-17T10:00:00+08:00", updated_at: "2026-11-17T10:00:00+08:00", deleted_at: null },
	// SNMP 凭据（NMCPS-ADR-0028 §6 D10）：`lab:snmp` 同样单独授予 —— 自检账号没有这条
	// 角色时，SNMP 弹窗的写按钮永远不渲染，「已开通再开通回 409」这类分支测不到。
	{ id: "r_lab_snmp", tenant_id: "t_default", name: "实验台 SNMP", code: "lab_snmp", description: "SNMP 凭据开通 / 轮换 / 吊销（NMCPS-ADR-0028 D10）", enabled: true, is_system: false, created_at: "2026-11-26T10:00:00+08:00", updated_at: "2026-11-26T10:00:00+08:00", deleted_at: null }
];

/**
 * 关系假数据（`GET /iam/role-policies`、`GET /iam/subject-roles`）：
 *   - `rp-orphan` 指向不存在的策略、`sr-orphan` 指向已删用户 —— 两页都要按存在性过滤（UP-RBAC-10）；
 *   - 重复挂载回 `SQLSTATE 23505`、摘除幂等，与实测一致。
 */
export const IAM_ROLE_POLICY_SEED = [
	{ id: "rp-platform", role_id: "r_platform_admin", policy_id: "pol_platform_full", created_at: "2026-11-03T18:59:06+08:00" },
	{ id: "rp-tenant-reader", role_id: "r_tenant_admin", policy_id: "pol_tenant_reader", created_at: "2026-11-04T09:00:00+08:00" },
	{ id: "rp-orphan", role_id: "r_tenant_admin", policy_id: "pol_deleted_elsewhere", created_at: "2026-11-04T09:05:00+08:00" }
];

export const IAM_SUBJECT_ROLE_SEED = [
	{ id: "sr-alice", subject_type: "user", subject_id: "u_alice", role_id: "r_tenant_admin", created_at: "2026-11-04T09:00:00+08:00" },
	// `/scenario/simulator` 的写路径自查用：给 alice 一条 `tenant_admin`（下划线编码）角色
	{ id: "sr-alice-lab", subject_type: "user", subject_id: "u_alice", role_id: "r_lab_tenant_admin", created_at: "2026-11-16T09:00:00+08:00" },
	// 抓包单独授权（W5）：与上一行分开，正是要证明 `lab:sniffer` 不由 `tenant_admin` 推导
	{ id: "sr-alice-sniffer", subject_type: "user", subject_id: "u_alice", role_id: "r_lab_sniffer", created_at: "2026-11-16T10:00:00+08:00" },
	// 终端单独授权（D6）：同上，`lab:terminal` 也不由 `tenant_admin` 推导
	{ id: "sr-alice-terminal", subject_type: "user", subject_id: "u_alice", role_id: "r_lab_terminal", created_at: "2026-11-17T10:00:00+08:00" },
	// SNMP 单独授权（D10）：`lab:snmp` 不由 `tenant_admin` 推导
	{ id: "sr-alice-snmp", subject_type: "user", subject_id: "u_alice", role_id: "r_lab_snmp", created_at: "2026-11-26T10:00:00+08:00" },
	{ id: "sr-bob", subject_type: "user", subject_id: "u_bob", role_id: "r_tenant_admin", created_at: "2026-11-04T09:01:00+08:00" },
	{ id: "sr-orphan", subject_type: "user", subject_id: "u_ghost", role_id: "r_tenant_admin", created_at: "2026-11-04T09:02:00+08:00" }
];

/**
 * 新代策略假数据（`GET /iam/policies`，2026-11-04 实测字段）：给 `/system/policy` 两栏自查用。
 * 三条硬要求，否则用例测不出真伪：
 *   - `keyword` 真的命中 name / code（`code` / `policy_type` / `enabled` 传了被静默忽略，UP-RBAC-06）；
 *   - 分页字段是 `page_size`（不是 `pageSize`），`total` 要能分页；
 *   - 留一条「删除回 `200 {code:400}`」的样本（`pol_role_reader_isp_a`），把 UP-RBAC-05 的
 *     失败通道固定进假上游，否则「删除失败」分支永远测不到。
 *
 * 与角色种子同理导出：`scripts/check-bff.mjs` 按 `IAM_POLICY_SEED.length` 断言「`code` 过滤被忽略」
 * 的总数，加一条策略不必再改字面量。
 */
export const IAM_POLICY_SEED = [
	{ id: "pol_platform_full", tenant_id: "tnt_default", name: "平台全权限", code: "platform.full_access", policy_type: "system", document: "[{\"Action\":[\"*\"],\"Effect\":\"Allow\",\"Resource\":[\"*\"]}]", description: "平台内置全权限策略", enabled: true, is_system: true, created_at: "2026-11-03T18:59:06+08:00", updated_at: "2026-11-03T18:59:06+08:00", deleted_at: null },
	{ id: "pol_tenant_reader", tenant_id: "tnt_default", name: "租户只读", code: "tenant.readonly", policy_type: "custom", document: "[{\"Action\":[\"read\"],\"Effect\":\"Allow\",\"Resource\":[\"*\"]}]", description: "自查用自建策略", enabled: true, is_system: false, created_at: "2026-11-04T09:00:00+08:00", updated_at: "2026-11-04T09:00:00+08:00", deleted_at: null },
	{ id: "pol_role_reader_isp_a", tenant_id: "t_isp_a", name: "ISP-A 角色只读", code: "isp.role.readonly", policy_type: "custom", document: "[]", description: "删除会被上游拒绝（UP-RBAC-05）", enabled: true, is_system: false, created_at: "2026-11-04T09:10:00+08:00", updated_at: "2026-11-04T09:10:00+08:00", deleted_at: null }
];

/**
 * 假上游：覆盖裸 JSON、已是信封、业务错误、慢响应、Header 回显、健康探针与 SSE 流。
 * `/auth/*` 模拟新建 iam 服务（信封为 `{ code, msg, data }`）：登录签发 `at-N` / `rt-N`，
 * `whoami` 只认签发过的访问令牌 —— 浏览器自查靠它走完「登录 → 会话 → 自助安全设置」全流程。
 */
export async function startUpstream(port) {
	/**
	 * 认证相关状态（新代 iam 口径，2026-11-04 实测）：
	 * - 登录签发 `at-N` + `rt-N`，`user_info` 随登录返回；
	 * - 刷新**不轮换**：同一刷新令牌可反复使用，且响应只给新访问令牌；
	 * - 登出**幂等**：重复调用仍 200 `code:0`。
	 *
	 * `reusedRefresh` 记录「刷新令牌被重复使用」的次数 —— 旧代的串行复用即失效语义
	 * （NMCPS-REC-001 UP-AUTH-01 / ADR-0011 轮换条款）已由 NMCPS-ADR-0018 D4 作废。
	 */
	const authLog = { login: 0, refresh: 0, reusedRefresh: 0, logout: [], password: [], issuedAccess: new Set(), revokedAccess: new Set(), seq: 0 };

	/**
	 * Mininet 实验后端状态（NMCPS-ADR-0022 W2）：五类节点 + 链路，**可变**。
	 *
	 * 建节点 / 连线 / 改坐标 / 删除真的改这张表，页面写完 `load()` 能读回刚写的事实；
	 * `mininetLog` 记下每次写请求的 `{ method, path, body }`，自检据此断言
	 * 「发出去的到底是什么」，而不是只看画布上的数字。
	 */
	const mininetLog = [];
	/**
	 * 只读请求日志（NMCPS-ADR-0023 对账）：`mininetLog` 只记写，而「只读上游、只改台账」
	 * 的对账恰恰要靠**读侧**证据说话 —— 读了哪几类端点、有没有夹带写，只有这份日志能回答。
	 */
	const mininetReadLog = [];
	/**
	 * 运行态（NMCPS-ADR-0022 W3）：`GET /api/mininet/start` 回的就是这个布尔值，
	 * `POST start` / `POST stop` **真改它** —— 页面启停后再读一次必须看见变化，
	 * 否则「启动了」只是按钮转了一圈。
	 */
	const mininetRun = { started: false };
	/**
	 * 抓包态（NMCPS-ADR-0022 W5）：`sniffer/state` 回 `{ active }`，启停真改它；
	 * pcap 用真实 tcpdump 魔数开头，自检据此断言「字节原样下载」。
	 */
	const mininetSniffer = {
		active: false,
		pcap: Buffer.from([0xD4, 0xC3, 0xB2, 0xA1, 0x02, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00]),
		// 历史与实时流是两份样本（`MININET_SNIFFER_HISTORY` / `MININET_SNIFFER_LIVE`）：
		// 页面先回填历史，开始抓包后再追加 WS 推来的包，自检据此区分两者
		history: [...MININET_SNIFFER_HISTORY]
	};
	/** `pingall` 的返回：上游 `run_pingall()` 拼的是这种逐行文本 */
	const mininetPingOutput = ["h1->h2: 0/1, rtt min/avg/max/mdev 0.100/0.120/0.140/0.020 ms"];
	const mininetState = {
		hosts: {
			h1: { name: "h1", ip: "10.0.0.1", mac: "00:00:00:00:00:01", x: 80, y: 120 },
			h2: { name: "h2", ip: "10.0.0.2", mac: "00:00:00:00:00:02", x: 80, y: 260 }
		},
		switches: {
			sw1: { name: "sw1", x: 260, y: 190, ports: 4, of_version: null }
		},
		routers: {
			r1: { name: "r1", x: 440, y: 190 }
		},
		nats: {
			nat1: { name: "nat1", x: 620, y: 120 }
		},
		controllers: {
			c0: { name: "c0", x: 620, y: 260 }
		},
		links: [
			{ from: "h1", to: "sw1" },
			{ from: "sw1", to: "r1" }
		]
	};
	/** 节点 id → 它落在哪张表（改坐标 / 删节点按表分派，与上游 `node_position` 同口径） */
	const mininetBucketOf = (id) => ["hosts", "switches", "routers", "nats", "controllers"]
		.find((bucket) => Object.hasOwn(mininetState[bucket], id));

	/**
	 * 2.0 会话（`NMCPS-DESIGN-008` M1 / `NMCPS-ADR-0029` M1.2）：假上游只维护 id 表。
	 *
	 * 页面进实验台时若台账 `session_id` 为空会 `POST /api/mininet/sessions`，
	 * 之后拖动与详情保存都打 `/sessions/{id}/nodes|links`；自检据此断言
	 * 「1.x 更新端点命中数为 0、会话路径命中数对得上」。
	 */
	const mininetSessions = { seq: 0, ids: [] };

	/**
	 * SNMP 凭据（`NMCPS-ADR-0028` §7）：假上游只保留**编排**的那一份。
	 * `state` 里的 `community` 只在未开通时回部署默认串 —— 与上游 D9 同口径，
	 * 已开通的密文仅在开通 / 轮换的响应里出现一次。
	 */
	const mininetSnmp = {
		enabled: true,
		port: 161,
		onboarded: false,
		version: 0,
		community: null,
		createdAt: null,
		rotatedAt: null,
		seq: 0
	};
	const mininetSnmpNodesOf = () => mininetRun.started
		? Object.entries(mininetState.hosts).map(([id, host]) => ({
			id,
			type: "host",
			ip: host.ip ?? null,
			pid: 1000,
			port: mininetSnmp.port,
			status: "running",
			error: null
		}))
		: [];
	const mininetSnmpStateOf = () => ({
		enabled: mininetSnmp.enabled,
		running: mininetRun.started,
		port: mininetSnmp.port,
		community: mininetSnmp.onboarded ? null : "public",
		community_source: mininetSnmp.onboarded ? "credential" : "deployment",
		onboarded: mininetSnmp.onboarded,
		credential_version: mininetSnmp.onboarded ? mininetSnmp.version : null,
		credential_created_at: mininetSnmp.onboarded ? mininetSnmp.createdAt : null,
		credential_rotated_at: mininetSnmp.onboarded ? mininetSnmp.rotatedAt : null,
		credential_error: null,
		started_at: mininetRun.started ? 1 : null,
		error: null,
		nodes: mininetSnmpNodesOf()
	});
	/** 开通 / 轮换共用一个生成器：每次换串，页面据此断言「轮换确实换了值」 */
	const mininetSnmpOnboard = () => {
		mininetSnmp.seq += 1;
		mininetSnmp.community = `sim-checkui-${String(mininetSnmp.seq).padStart(8, "0")}`;
		mininetSnmp.onboarded = true;
		mininetSnmp.version += 1;
		const now = `2026-11-26T00:00:0${mininetSnmp.version}Z`;
		mininetSnmp.createdAt ??= now;
		if (mininetSnmp.version > 1)
			mininetSnmp.rotatedAt = now;
		return {
			community: mininetSnmp.community,
			onboarded: true,
			credential_version: mininetSnmp.version,
			created_at: mininetSnmp.createdAt,
			rotated_at: mininetSnmp.rotatedAt,
			applied: true,
			nodes: mininetSnmpNodesOf()
		};
	};

	/**
	 * 交换机流表（ADR-0022 W2b）：`{ sw1: [ "<原文行>", … ] }`，行序即上游
	 * `DELETE /flows/{sw}/{flow_id}` 的 1 基序号。故意**不放进 `mininetState`** ——
	 * 那里每个键都会落进「单段路径 = 集合」的分支，`GET /flows` 会被误当成集合读。
	 */
	const mininetFlows = {
		sw1: ["cookie=0x0, duration=12.4s, table=0, n_packets=3, n_bytes=210, priority=0 actions=CONTROLLER:65535"]
	};
	/** 加流请求体 → `dump-flows` 形状的一行（字段顺序与 `flow_rules.py::build_flow` 同源） */
	const mininetFlowLineOf = (body) => {
		const actions = String(body?.actions ?? "").trim();
		const plain = actions.toLowerCase().startsWith("actions=") ? actions.slice("actions=".length).trim() : actions;
		const parts = ["cookie=0x0, duration=0s, table=0, n_packets=0, n_bytes=0"];
		if (body?.priority !== undefined && body?.priority !== null)
			parts.push(`priority=${body.priority}`);
		if (typeof body?.match === "string" && body.match.trim())
			parts.push(body.match.trim());
		parts.push(`actions=${plain}`);
		return parts.join(", ");
	};

	/**
	 * 链路属性（ADR-0022 W13）：`PUT /links` 的落表，`from|to` 两个方向都登记
	 * （上游 `app.link_attrs` 按 `frozenset` 存，方向无关；这里两个方向同值即可）。
	 * 故意**不放进 `mininetState.links`**：那条数组的形状是 `{ from, to }`，
	 * 详情弹窗读的是 `GET /links` 的 `options`，两处混在一起会污染「链路清单」断言。
	 */
	const mininetLinkAttrs = {};

	/**
	 * 链路运行态（M1.2 / ADR-0027 §4 R8）：`from|to` 两个方向都登记，`up` / `down`。
	 * 没有登记时由 `mininetRun.started` 派生（未启动恒 `unknown`，不拿停网前的状态冒充运行态）。
	 * `PATCH /links/{src}/{dst}/state` 真改它 —— 页面下发后再读 `GET /links` 必须看见变化。
	 */
	const mininetLinkState = {};
	const mininetLinkStatusOf = (link) => mininetLinkState[`${link.from}|${link.to}`]
		?? mininetLinkState[`${link.to}|${link.from}`]
		?? (mininetRun.started ? "up" : "unknown");

	/**
	 * 账号口令是**可变**的：改密真的落库、重登真的校验（默认口令 `p@ssw0rd`）。
	 *
	 * 新代没有 `mfaRequired` / `mustResetPassword`（NMCPS-ADR-0018 缺口 G2/G8），
	 * 假上游也不再伪造这两个标志 —— 页面侧若还依赖它们，自检会红。
	 */
	const DEFAULT_PASSWORD = "p@ssw0rd";
	const accounts = new Map();
	const accountOf = (name) => {
		if (!accounts.has(name))
			accounts.set(name, { password: DEFAULT_PASSWORD });
		return accounts.get(name);
	};
	/** 访问令牌归属账号：改密按令牌判身份，不再一律回 `alice` */
	const tokenAccount = new Map();
	/** 刷新令牌归属账号：刷新后签发的访问令牌要继承同一身份 */
	const tokenUser = new Map();

	/**
	 * 账号域假数据（`GET /account`、`POST /account`、`PUT /account/{code}/status`）：给
	 * `/system/user` 两栏自查（NMCPS-ARCH-006 §3 / NMCPS-ADR-0017）用 —— 列表要对 `keyword` /
	 * `status` / `accountLevel` 真有筛选效果、`total` 要能分页，否则「深链选中 `?id`」与
	 * 「`?id` 不在当前结果内」两条用例都测不出真伪。
	 */
	const accountRecords = [
		{ accountId: 1, accountCode: "ACC-1001", accountName: "alice", displayName: "Alice", accountLevel: 1, status: 1, mfaEnabled: true, createdAt: "2026-10-01 09:00:00" },
		{ accountId: 2, accountCode: "ACC-1002", accountName: "bob", displayName: "Bob", accountLevel: 1, status: 2, mfaEnabled: false, createdAt: "2026-10-02 10:00:00" },
		{ accountId: 3, accountCode: "ACC-1003", accountName: "carol", displayName: "Carol", accountLevel: 1, status: 3, mfaEnabled: false, createdAt: "2026-10-03 11:00:00" }
	];

	/**
	 * 会话身份等级：`admin` 是平台超级管理员（0），其余账号按租户管理员（1）处理 ——
	 * 照真实种子账号（`admin` / `tenantadmin`，见 `shared/constants/demoAccounts.ts`）。
	 *
	 * 这个字段决定 `/system/user` 建号表单的等级候选与是否出现「所属租户」，
	 * 写死成一个值（此前是 `2`）会让自查看不见两种身份的分支差异。
	 */
	const accountLevelOf = (accountName) => (accountName === "admin" ? 0 : 1);

	/** 租户域假数据（`GET /tenant`）：超级管理员建号时必须选 `tenantId`（NMCPS-REC-002 UP-ACC-07） */
	const tenantRecords = [
		{ tenantId: 1, tenantCode: "default", tenantName: "默认租户", description: "平台内置默认租户", status: 1, isDefault: true, createdAt: "2026-10-29 17:27:21" }
	];

	/**
	 * 新代 iam 假数据（`GET /iam/users|tenants|departments`，2026-11-04 实测字段）：给
	 * `/system/user` 两栏自查用。三条硬要求，否则用例测不出真伪：
	 *   - 列表对 `keyword` / `status` / `department_id` 真有筛选效果；
	 *   - 分页字段是 `page_size`（旧代 `pageSize`），`total` 要能分页；
	 *   - 空结果回 `list: null`（实测口径），顺带验证 BFF 出口归一成 `[]`。
	 */
	const iamTenants = [
		{ id: "tnt_default", name: "默认租户", code: "default", status: "active", description: "示例租户", device_quota: 500, storage_quota: 0, api_quota: 0, deleted_at: null, created_at: "2026-11-03T18:59:06+08:00" },
		{ id: "t_isp_a", name: "ISP-A Network Solutions", code: "isp-a", status: "active", description: "互联网服务提供商", device_quota: 200, storage_quota: 0, api_quota: 0, deleted_at: null, created_at: "2026-11-03T18:59:06+08:00" }
	];

	const iamDepartments = [
		{ id: "dept_default_tech", tenant_id: "tnt_default", name: "技术部", code: "tech", sort_order: 1, deleted_at: null },
		{ id: "dept_default_ops", tenant_id: "tnt_default", name: "运维部", code: "ops", sort_order: 2, deleted_at: null },
		{ id: "dept_isp_hq", tenant_id: "t_isp_a", name: "总部", code: "hq", sort_order: 1, deleted_at: null }
	];

	const iamUsers = [
		{ id: "u_alice", tenant_id: "tnt_default", department_id: "dept_default_tech", username: "alice", email: "alice@nms.local", display_name: "Alice", status: "active", mfa_enabled: true, last_login_at: null, created_at: "2026-11-01T09:00:00+08:00", deleted_at: null },
		{ id: "u_bob", tenant_id: "tnt_default", department_id: "dept_default_tech", username: "bob", email: "bob@nms.local", display_name: "Bob", status: "disabled", mfa_enabled: false, last_login_at: null, created_at: "2026-11-02T10:00:00+08:00", deleted_at: null },
		{ id: "u_carol", tenant_id: "t_isp_a", department_id: "dept_isp_hq", username: "carol", email: "carol@isp-a.example", display_name: "Carol", status: "locked", mfa_enabled: false, last_login_at: null, created_at: "2026-11-03T11:00:00+08:00", deleted_at: null }
	];

	/** 新代分页信封：`page_size`（不是 `pageSize`），`list` 空时给 `null`（真实上游口径） */
	const iamPaged = (records, url) => {
		const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
		const pageSize = Math.max(1, Number(url.searchParams.get("page_size") ?? 20));
		const start = (page - 1) * pageSize;
		const slice = records.slice(start, start + pageSize);
		return { list: slice.length ? slice : null, total: records.length, page, page_size: pageSize };
	};

	/** 设备台账的填充行：字段形状与真样本一致（缺的块写 null / 空对象，不编数） */
	const deepPageDeviceFiller = (n) => ({
		device_code: `FILLER-DEV-${String(n).padStart(2, "0")}`,
		mgmt_ip: `10.9.0.${n}`,
		sys_name: `填充设备-${n}`,
		sys_descr: "Filler Device",
		role: "access",
		vendor: "filler",
		model: "F-1000",
		status: "online",
		health: {},
		hw: { entities: [] },
		interface_summary: { total: 0, up: 0, down: 0 },
		neighbors: [],
		neighbor_summary: { total: 0 },
		traffic: {},
		protocol: null,
		lldp: null,
		radio: null,
		device_quality: null,
		quality: {}
	});

	/** 链路台账的填充行：两端都指向填充设备，因此深链的 IP 索引查不到它们 */
	const deepPageLinkFiller = (n) => ({
		identity: {
			link_id: `FILLER-DEV-${String(n).padStart(2, "0")}:GE0/0/${n}--FILLER-DEV-99:GE0/0/${n}`,
			source: { device_code: `FILLER-DEV-${String(n).padStart(2, "0")}`, device_role: "access", interface_id: `GE0/0/${n}`, interface_name: `GE0/0/${n}`, medium: "wired" },
			target: { device_code: "FILLER-DEV-99", device_role: "access", interface_id: `GE0/0/${n}`, interface_name: `GE0/0/${n}`, medium: "wired" },
			discovery: "lldp"
		},
		metrics: { status: "up", graph_status: "online", medium: "ethernet", bandwidth_mbps: 1000, metric_valid: 1 },
		jobs: ["snmp_devices"]
	});

	/**
	 * 审计域假数据（新代 `audit/*` 三族端点，NMCPS-ADR-0018 §三）：给 `/system/log` 的
	 * 工具栏 / 详情 / 归档自查用。
	 *
	 * 三族各有自己的端点与字段（旧代是单端点 + `category`）：
	 *   - 操作日志 `GET /audit/operation-logs`，时间参数 `created_from` / `created_to`（epoch 毫秒）；
	 *   - 安全日志 `GET /audit/security-logs`，时间参数 `logged_from` / `logged_to`（epoch 毫秒）；
	 *   - 归档记录 `GET /audit/archive/records`，**没有时间条件**。
	 *
	 * 与真实上游一致的两条口径（都实测过）：
	 *   1. **空结果给 `list: null`**（NMCPS-ADR-0018 D6），BFF 出口才归一成 `[]`；
	 *   2. 详情不存在回 **HTTP 200 + `code: 40401`**（不是 404），三个族共用这个码。
	 */
	const auditOperationLogs = [
		{ id: "op-0001", user_id: "u_alice", username: "alice", module: "iam", operation: "POST /api/v1/iam/users", target_type: "user", target_id: "u_bob", status: "success", ip_address: "10.0.0.1", trace_id: "trace-1", created_at: "2026-11-02T03:15:09+08:00" },
		{ id: "op-0002", user_id: "u_alice", username: "alice", module: "asset", operation: "PUT /api/v1/asset/device/dev-1001", target_type: "device", target_id: "dev-1001", status: "failed", ip_address: "10.0.0.2", trace_id: "trace-2", created_at: "2026-11-02T03:20:00+08:00" },
		{ id: "op-0003", user_id: "u_bob", username: "bob", module: "iam", operation: "DELETE /api/v1/iam/users/u_carol", target_type: "user", target_id: "u_carol", status: "success", ip_address: "10.0.0.3", trace_id: "trace-3", created_at: "2026-11-01T22:05:00+08:00" }
	];

	const auditSecurityLogs = [
		{ id: "sec-0001", subject_type: "user", subject_id: "u_alice", subject_name: "alice", action: "auth.login", resource: "/api/v1/iam/auth/login", auth_decision: "allow", ip_address: "10.0.0.1", trace_id: "trace-1", logged_at: "2026-11-02T03:15:09+08:00" },
		{ id: "sec-0002", subject_type: "user", subject_id: "u_alice", subject_name: "alice", action: "iam.user.delete", resource: "/api/v1/iam/users/u_carol", auth_decision: "deny", ip_address: "10.0.0.1", trace_id: "trace-4", logged_at: "2026-11-02T03:30:00+08:00" }
	];

	/** 归档记录：字段集合与真实上游逐字一致（实测 `POST /audit/archive/run` 后回读） */
	const auditArchiveRecords = [
		{ id: "arc-0001", table_name: "sys_operation_log", archive_batch: "arc-0001", rows_archived: 3, cutoff_before: "2026-08-06T10:34:39.998235+08:00", started_at: "2026-11-04T10:34:40+08:00", finished_at: "2026-11-04T10:34:40+08:00", status: "success", created_at: "2026-11-04T10:34:40+08:00" },
		{ id: "arc-0002", table_name: "sys_audit_log", archive_batch: "arc-0002", rows_archived: 0, cutoff_before: "2026-08-06T10:34:40.120011+08:00", started_at: "2026-11-04T10:34:41+08:00", finished_at: "2026-11-04T10:34:41+08:00", status: "success", created_at: "2026-11-04T10:34:41+08:00" }
	];

	/** 时间边界是 epoch 毫秒整数：空串 = 不设边界，非数字按「不设边界」处理（不自作主张报错） */
	const inEpochWindow = (value, from, to) => {
		const stamp = Date.parse(value);
		if (Number.isNaN(stamp))
			return false;
		if (from !== "" && Number.isFinite(Number(from)) && stamp < Number(from))
			return false;
		if (to !== "" && Number.isFinite(Number(to)) && stamp > Number(to))
			return false;
		return true;
	};

	/** 精确匹配的字符串筛选（空串 = 不筛）：上游对枚举参数是精确匹配，这里照样板做 */
	const matchesText = (value, expected) => expected === "" || String(value ?? "") === expected;

	// 夹具种子在模块级导出（`IAM_ROLE_SEED` / `IAM_POLICY_SEED` / `IAM_ROLE_POLICY_SEED` /
	// `IAM_SUBJECT_ROLE_SEED`），这里每次深拷贝一份：写端点会 push / splice，共用一个数组会让
	// 多次 `startUpstream()` 互相污染。
	const iamRoles = IAM_ROLE_SEED.map((item) => ({ ...item }));
	const iamRolePolicies = IAM_ROLE_POLICY_SEED.map((item) => ({ ...item }));
	const iamSubjectRoles = IAM_SUBJECT_ROLE_SEED.map((item) => ({ ...item }));

	const iamPolicies = IAM_POLICY_SEED.map((item) => ({ ...item }));

	/** 分页信封：与审计域一致（`page` / `pageSize` 按请求原样回显） */
	const paged = (records, url) => {
		const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
		const pageSize = Math.max(1, Number(url.searchParams.get("pageSize") ?? 20));
		const start = (page - 1) * pageSize;
		return { list: records.slice(start, start + pageSize), total: records.length, page, pageSize };
	};

	/** 最近一次列表请求的查询串（自查看「控件真的改了请求」时可直接读） */
	const auditLog = { lastQuery: null };

	/** 读原始请求体（multipart 也照原样交回：导入自检要取证「发出去的是不是文件」） */
	async function readRawBody(req) {
		let raw = "";
		for await (const chunk of req)
			raw += chunk;
		return raw;
	}

	/** 读并解析请求体（每个请求只能读一次：账号域与 `/auth/*` 各自在分支内调用） */
	async function readJsonBody(req) {
		const raw = await readRawBody(req);
		try {
			return raw ? JSON.parse(raw) : undefined;
		} catch {
			return undefined;
		}
	}

	/**
	 * 「运行中掉线」开关：`POST /__control/down` 后除控制端点外的请求一律直接销毁 socket，
	 * 让 BFF 侧表现为网络错误（502 `bff_upstream_unreachable`），而不是上游 5xx。
	 * 用于「已登录 → 上游掉线 → 操作给出修复指引」这类只能运行中构造的场景。
	 */
	/**
	 * `topologyNested` **默认 true**：假上游默认回现网的两层形状（`nestTopologyGraph()`，§6.10），
	 * 自检因此默认就覆盖「线格式 → 拍平」这条路，而不是比现网更干净。
	 * `__control/topology-flat` 切回扁平形状（A27 用它证明两种形状渲染结果一致）。
	 */

	const control = { down: false, topologyEmpty: false, topologyNested: true, topologyMesh: false, topologySameTier: false, metricError: false, metricDeepPage: false, catalogError: false, namesEmpty: false, alarmError: false, alarmFlood: false };

	/**
	 * 深链翻页样本（A50，2026-11-08）：在真样本身前垫 `count` 条填充行，把目标挤到第 2 页。
	 *
	 * 只在 `__control/metric-deep-page` 打开时生效（其余断言的台账首页保持 3 台设备 / 2 条链路）。
	 * 填充行刻意**不含**真样本的管理 IP / `device_code`：深链要么命中真的那条，要么什么也命中不了，
	 * 不会「碰巧选中一条填充行」而让断言假绿。
	 */
	const withDeepPageFillers = (records, count, make) => {
		if (!control.metricDeepPage)
			return records;
		const fillers = Array.from({ length: count }, (_, index) => make(index + 1));
		return [...fillers, ...records];
	};

	const server = createHttpServer(async (req, res) => {
		const url = new URL(req.url ?? "/", `http://${HOST}:${port}`);
		const send = (status, payload) => {
			res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
			res.end(JSON.stringify(payload));
		};

		/**
		 * 纯文本响应：真实上游的失败不总是信封 ——
		 * `GET /iam/policies/{id}` 不存在时回 `400` + `记录不存在`，
		 * 唯一键 / jsonb 失败回 `400` + 原始 `ERROR: … (SQLSTATE 23505)`。
		 * BFF 与页面都必须按「非信封」处理，假上游不能把它包装成 JSON。
		 */
		const sendText = (status, text) => {
			res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
			res.end(text);
		};

		if (url.pathname === "/__control/down") {
			control.down = true;
			return send(200, { down: true });
		}
		if (url.pathname === "/__control/up") {
			control.down = false;
			return send(200, { down: false });
		}
		if (url.pathname === "/__control/state")
			return send(200, { down: control.down, topologyEmpty: control.topologyEmpty, topologyNested: control.topologyNested, topologyMesh: control.topologyMesh, topologySameTier: control.topologySameTier, metricError: control.metricError, catalogError: control.catalogError, namesEmpty: control.namesEmpty, alarmError: control.alarmError, alarmFlood: control.alarmFlood });
		/**
		 * 告警取数失败开关：`/alarm/alarm-events` 回 HTTP 200 + `code !== 0` + 一句上游原话。
		 * 拓扑 / 仿真照常（告警是叠加层），页面必须写「告警通道不可用：<原话>」，**不能**写「无告警」——
		 * 「读不到」和「没有」是两件事（NMCPS-DESIGN-001 §6.1 / A32）。
		 */
		if (url.pathname === "/__control/alarm-error") {
			control.alarmError = true;
			return send(200, { alarmError: true });
		}
		if (url.pathname === "/__control/alarm-ok") {
			control.alarmError = false;
			return send(200, { alarmError: false });
		}
		/**
		 * 告警极端样本开关（A36 / A37）：换成「103 条挂在一台设备上、其中一条严重度是上游从未出现过的取值」
		 * 的样本，钉住两条兜底口径 —— 角标数字超 99 写 `99+`（角标是读数不是报表），未知严重度归最低档
		 * `info`（不升级成 `critical`，NMCPS-DESIGN-001 §6.12 口径 ②）。
		 */
		if (url.pathname === "/__control/alarm-flood") {
			control.alarmFlood = true;
			return send(200, { alarmFlood: true });
		}
		if (url.pathname === "/__control/alarm-flood-off") {
			control.alarmFlood = false;
			return send(200, { alarmFlood: false });
		}
		/**
		 * 指标取数失败开关：`/metric/datapoint` 回 HTTP 200 + `code !== 0` + 一句上游原话。
		 * 这不是网络错误（`__control/down` 是），而是「上游回了信封但业务失败」——
		 * 页面必须逐字展示原话并给重试，且**不能**把它渲染成「该时间窗内无采集数据」（§6.7 / A13）。
		 */
		if (url.pathname === "/__control/metric-error") {
			control.metricError = true;
			return send(200, { metricError: true });
		}
		if (url.pathname === "/__control/metric-ok") {
			control.metricError = false;
			return send(200, { metricError: false });
		}
		/**
		 * 深链翻页样本（A49，2026-11-08）：台账一页 15 条，而现网 36 台设备 / 48 条链路，
		 * 拓扑深链的目标**多半不在第一页**。打开后 `/metric/device` 与 `/metric/link` 各在真样本前
		 * 垫 15 / 20 条同名形态的填充行，把三条真设备挤到第 2 页、两条真链路挤到第 2 页：
		 * 深链必须自己翻到那一页再写 `?id`（`resolveDeepLink()`），否则用户点了「遥测」什么都没选中。
		 * 填充行的 `device_code` 都是 `FILLER-DEV-nn`，不与管理 IP 撞车。
		 */
		if (url.pathname === "/__control/metric-deep-page") {
			control.metricDeepPage = true;
			return send(200, { metricDeepPage: true });
		}
		if (url.pathname === "/__control/metric-deep-page-off") {
			control.metricDeepPage = false;
			return send(200, { metricDeepPage: false });
		}
		/**
		 * 目录失败开关：`/metric/definition` 回 HTTP 200 + `code !== 0`。
		 * 与 `metric-error` 的区别是**失败在哪一步**：目录只是「类型判定的依据」，
		 * 而名字清单与序列都还好 —— 页面必须照常出图，只多一句「只按名字判断类型」（§8.4 / A17）。
		 */
		if (url.pathname === "/__control/catalog-error") {
			control.catalogError = true;
			return send(200, { catalogError: true });
		}
		if (url.pathname === "/__control/catalog-ok") {
			control.catalogError = false;
			return send(200, { catalogError: false });
		}
		/**
		 * 名字清单为空开关：`/metric/name` 回 `metrics: []`（实测 24/36 台设备就是这样），
		 * 而 `/metric/datapoint` 照常回序列 —— 用来钉「空清单只影响提示，不影响能不能选」
		 * （CONTRACT-002 §七 / §8.6 / A10p）。
		 */
		if (url.pathname === "/__control/names-empty") {
			control.namesEmpty = true;
			return send(200, { namesEmpty: true });
		}
		if (url.pathname === "/__control/names-ok") {
			control.namesEmpty = false;
			return send(200, { namesEmpty: false });
		}
		if (url.pathname === "/__control/topology-empty") {
			control.topologyEmpty = true;
			return send(200, { topologyEmpty: true });
		}
		if (url.pathname === "/__control/topology-full") {
			control.topologyEmpty = false;
			return send(200, { topologyEmpty: false });
		}
		/**
		 * 形状开关：真实上游（8888 `/api/v1/topology/graph`，2026-11-07 复测）的节点 / 链路是
		 * **G6 元素形态** `{ id, data: { deviceName, tier, status, cpu… }, style, combo }`，事实全在 `data` 里。
		 * 假上游**默认**回这个形状（`control.topologyNested` 初值 true），自检因此默认覆盖
		 * 「线格式 → 读模型」的拍平（`NMCPS-DESIGN-001` §6.10 / A27）：
		 * 少了这一步，`data.tier` 读不到 ⇒ 全部节点落到同一个兜底档 ⇒ 分层布局排成一条水平线。
		 * `topology-flat` 切回扁平本体，A27 用它钉「两种形状渲染结果逐点一致」。
		 */
		if (url.pathname === "/__control/topology-nested") {
			control.topologyNested = true;
			return send(200, { topologyNested: true });
		}
		if (url.pathname === "/__control/topology-flat") {
			control.topologyNested = false;
			return send(200, { topologyNested: false });
		}
		/**
		 * 分层规则样本（A43 / A44）：把拓扑换成「网状顶层 + 无下级接入 + 满行终端」的形状，
		 * 专门钉 `NMCPS-DESIGN-001` §6.8 的两条层序归约规则与 §七 的标签避让：
		 *   · 顶层三台设备两两互联（关系等价）⇒ 只有「网控中心」命中名称判据 ⇒ 被选举为根（第 1 行）；
		 *   · 「接入交换机-2」挂在汇聚下但没有下一级 ⇒ 下移到末行（与终端同排）；
		 *   · 末行 14 台设备的名称比 80px 间距宽 ⇒ 标签按奇偶错行（`data-label-shift` 0/1 交替）。
		 * `topology-default` 复位（后面的断言仍走默认的 6 节点样本）。
		 */
		if (url.pathname === "/__control/topology-mesh") {
			control.topologyMesh = true;
			control.topologySameTier = false;
			return send(200, { topologyMesh: true, topologySameTier: false });
		}
		/**
		 * 同档下级样本（A52，2026-11-09）：胖 AP 与接入交换机同档（`tier 3`）的形状，
		 * 钉「收起汇聚要把同档那一跳下面的 AP 一起带走」（`NMCPS-DESIGN-001` §6.15）。
		 */
		if (url.pathname === "/__control/topology-same-tier") {
			control.topologySameTier = true;
			control.topologyMesh = false;
			return send(200, { topologySameTier: true, topologyMesh: false });
		}
		if (url.pathname === "/__control/topology-default") {
			control.topologyMesh = false;
			control.topologySameTier = false;
			return send(200, { topologyMesh: false, topologySameTier: false, topologyEmpty: control.topologyEmpty });
		}

		if (control.down) {
			req.socket.destroy();
			return;
		}

		if (url.pathname === "/health")
			return send(200, { status: "ok" });
		if (url.pathname === "/unready/health")
			return send(503, { status: "starting" });
		if (url.pathname === "/hang-health") {
			// 就绪探针超时用例：永远拖到客户端超时
			await delay(5_000);
			return send(200, { status: "ok" });
		}

		// ── /topology*：拓扑图（`/topology/monitor`；网关透传路径带 `/api/v1` 前缀） ──
		// 形状对齐 `shared/types/topology.ts`（2026-11-07 只读实测：`id` 是管理 IP、`status` 实测为字符串
		// `online/warning/offline`（数值 1/2/0 的老口径仍兼容）、链路 `bandwidth` 是字符串 `"100 Mbps"`）。
		// 下表是**扁平**样本本体；出站时默认经 `nestTopologyGraph()` 包成现网的两层形状（§6.10 / A27），
		// `__control/topology-empty` 用于「空拓扑渲染空态而不是空白画布」的断言（NMCPS-DESIGN-001 A4）。
		if (/^\/(?:api\/v1\/)?topology\/graph$/.test(url.pathname) && req.method === "GET") {
			// 分层规则样本（A43 / A44）：整套拓扑换成网状顶层 + 无下级接入 + 满行终端的形状
			if (control.topologyMesh)
				return send(200, { code: 0, msg: "success", data: meshTopologyGraph() });
			// 同档下级样本（A52）：胖 AP 与接入同档（tier 3），收起要走通「同档那一跳」
			if (control.topologySameTier)
				return send(200, { code: 0, msg: "success", data: sameTierTopologyGraph() });
			const graph = control.topologyEmpty

				? { nodes: [], edges: [], combos: [] }
				: {
					// 指标事实（`cpu` / `memory` / `interfaces` / `traffic*`）刻意留四种形态，详情栏
					// 必须把后两种显示成「—」、绝不许把未知当 0（NMCPS-CONTRACT-002 §6.3）：
					//   ① 全都给（10.0.0.1）—— 21.5% / 48% / 24 接口 / 12.5 Mbps；
					//   ② 只给 `traffic_in|out`（10.0.0.2）—— 总流量由前端求和（3 + 2 = 5 Mbps）；
					//   ③ 1.0 的 `-1` 哨兵 + 真实 `0` 接口 + 旧 Kbps 字段（10.0.0.3）—— 1500 Kbps → 1.5 Mbps；
					//   ④ 一个都不给（10.0.0.4 ~ 10.0.0.6）—— 全部未知。
					nodes: [
						{
							id: "10.0.0.1",
							name: "核心路由器-1",
							category: "network-device",
							type: "core",
							tier: 1,
							status: 1,
							cpu: 21.5,
							memory: 48,
							interfaces: 24,
							traffic: 12.5,
							traffic_in: 5,
							traffic_out: 7.5,
							uptime: 86400,
							combo: "combo-core"
						},
						{
							id: "10.0.0.2",
							name: "汇聚交换机-1",
							category: "network-device",
							type: "distribution",
							tier: 2,
							status: 1,
							cpu: 63.2,
							memory: 71.4,
							interfaces: 12,
							traffic_in: 3,
							traffic_out: 2,
							combo: "combo-access"
						},
						{
							id: "10.0.0.3",
							name: "接入交换机-1",
							category: "network-device",
							type: "access",
							tier: 2,
							status: 2,
							cpu: -1,
							memory: -1,
							interfaces: 0,
							trafficTotalKbps: 1500,
							combo: "combo-access"
						},
						// 无线事实（§6.11）：A30 钉「带 Wi-Fi 字段的节点才出无线卡」，这台的七项齐全
						{
							id: "10.0.0.4",
							name: "无线AP-1",
							category: "ap",
							type: "access",
							tier: 3,
							status: 1,
							ssid: "NMCPS-Lab",
							band: "5G",
							channel: 149,
							dbm: -52,
							clients: 12,
							util: 34,
							tx_power: 20,
							combo: "combo-edge"
						},
						{ id: "10.0.0.5", name: "单链路终端-1", category: "client", type: "endnode", tier: 4, status: 1, combo: "combo-edge" },
						{ id: "10.0.0.6", name: "单链路终端-2", category: "client", type: "endnode", tier: 4, status: 0, combo: "combo-edge" }
					],
					// 链路基础事实（§6.11）：第一条把 `medium` / `relation` / `admin_status` / `telemetry`
					// 全给齐（A28 用它钉「利用率 0 ⇒ 未计算」），其余保持 `bandwidth: 0`（缺真值口径）。
					edges: [
						{
							source: "10.0.0.1",
							target: "10.0.0.2",
							bandwidth: "1 Gbps",
							linkType: "fiber",
							status: "up",
							medium: "optical",
							relation: "up",
							admin_status: "enabled",
							telemetry: {
								traffic_in: 12.5,
								traffic_out: 16.18,
								in_util_pct: 0,
								out_util_pct: 0,
								packet_loss: 0,
								error_rate: 0,
								metric_updated_at: "2026-11-07T10:00:00Z"
							}
						},
						{ source: "10.0.0.1", target: "10.0.0.3", bandwidth: 0, linkType: "fiber", status: "up", medium: "optical", relation: "up", admin_status: "enabled" },
						{ source: "10.0.0.2", target: "10.0.0.4", bandwidth: 0, linkType: "fiber", status: "up", medium: "copper1g", relation: "up", admin_status: "enabled" },
						{ source: "10.0.0.3", target: "10.0.0.4", bandwidth: 0, linkType: "fiber", status: "down", medium: "optical", relation: "down", admin_status: "disabled" },
						{ source: "10.0.0.4", target: "10.0.0.5", bandwidth: 0, linkType: "wireless", status: "up", medium: "wifi5", relation: "peer", admin_status: "enabled" },
						{ source: "10.0.0.4", target: "10.0.0.6", bandwidth: 0, linkType: "wireless", status: "down", medium: "wifi5", relation: "down", admin_status: "enabled" }
					],
					// 区域分组（§6.11）：三组，`children` 与节点 `combo` 归属一致，`counts` 在 `data` 里
					// （现网形状）—— A29 折 `combo-edge` 后画布少 3 台、计数照旧。
					combos: [
						{
							id: "combo-core",
							data: { label: "核心区", layer: 1, root: true, counts: { distro: 0, access: 0, terminal: 1 } },
							children: ["10.0.0.1"]
						},
						{
							id: "combo-access",
							data: { label: "接入区", layer: 2, root: false, counts: { distro: 1, access: 1, terminal: 0 } },
							children: ["10.0.0.2", "10.0.0.3"]
						},
						{
							id: "combo-edge",
							data: { label: "边缘区", layer: 3, root: false, counts: { distro: 0, access: 1, terminal: 2 } },
							children: ["10.0.0.4", "10.0.0.5", "10.0.0.6"]
						}
					]
				};

			// 默认出站即现网的两层形状（`__control/topology-flat` 才回扁平本体）。
			return send(200, { code: 0, msg: "success", data: control.topologyNested ? nestTopologyGraph(graph) : graph });
		}
		// ── /alarm*：告警事件（`/topology/monitor` 的告警叠加，NMCPS-DESIGN-001 §6.1 / A31） ──
		// 形状对齐 `shared/types/alarm.ts` 的实测口径：
		//   ① `data` 是分页信封 `{ list, page, page_size, total }`；
		//   ② `status` 过滤在**上游**生效 —— 假上游照做（`status=firing` 时把 resolved 那条剔掉），
		//      页面因此不能靠「自己再筛一遍」蒙对；
		//   ③ `target_type` 只有 `device`，`target_id` = 设备管理 IP = 拓扑节点 `id`；
		//   ④ 有 3 条**不该落角标**的干扰项：`target_id` 空串、不在图上的 `10.9.9.9`、以及 resolved 那条。
		//      它们进不了角标才算「不编数据」（空 id 聚成「未知节点」就是编）。
		if (/^\/(?:api\/v1\/)?alarm\/alarm-events$/.test(url.pathname) && req.method === "GET") {
			if (control.alarmError)
				return send(200, { code: 500, msg: "告警库连接超时（alarm-db: connection timed out）", data: null });

			const event = (id, severity, status, eventType, targetId, message, triggerCount, at) => ({
				id,
				severity,
				status,
				event_type: eventType,
				target_type: "device",
				target_id: targetId,
				target_name: targetId || null,
				message,
				first_triggered_at: at,
				last_triggered_at: at,
				trigger_count: triggerCount
			});
			const all = [
				// 10.0.0.1：4 条 firing → 角标写 4，详情栏列 3 条 + 「另有 1 条」
				event("ev-1", "critical", "firing", "wired_cpu_high", "10.0.0.1", "核心路由器-1 CPU 使用率 92%（阈值 80%）", 3, "2026-11-07T10:12:00Z"),
				event("ev-2", "warning", "firing", "wired_mem_high", "10.0.0.1", "核心路由器-1 内存使用率 71%", 1, "2026-11-07T10:05:00Z"),
				event("ev-3", "warning", "firing", "if_flap", "10.0.0.1", "Gi0/3 接口抖动 5 次/分钟", 5, "2026-11-07T09:58:00Z"),
				event("ev-4", "info", "firing", "config_changed", "10.0.0.1", "配置变更：ACL 2000 新增 3 条规则", null, "2026-11-07T09:40:00Z"),
				// 10.0.0.4：1 条 → 第二台有告警的设备
				event("ev-5", "warning", "firing", "wifi_interference", "10.0.0.4", "无线AP-1 信道 149 干扰严重", 2, "2026-11-07T10:01:00Z"),
				// 干扰项 ①：空 target_id（现网 77 条 firing 里 9 条如此）
				event("ev-6", "critical", "firing", "node_down", "", "未知设备离线", 1, "2026-11-07T10:10:00Z"),
				// 干扰项 ②：不在当前画布上的目标
				event("ev-7", "critical", "firing", "wired_cpu_high", "10.9.9.9", "图外设备 CPU 使用率 99%", 4, "2026-11-07T10:11:00Z"),
				// 干扰项 ③：resolved（`status=firing` 时必须被上游过滤掉）
				event("ev-8", "warning", "resolved", "wired_mem_high", "10.0.0.2", "汇聚交换机-1 内存使用率 68%（已恢复）", 1, "2026-11-07T09:20:00Z")
			];
			const status = url.searchParams.get("status");
			let list = status ? all.filter((item) => item.status === status) : all;

			// A36 / A37 的极端样本：103 条挂在 `10.0.0.1`。前三条刻意是「严重 → 警告 → 未登记取值」，
			// 好让详情栏前三行正好把三档都摆出来（`catastrophic` 必须落到「提示」而不是「严重」）；
			// 余下 100 条是时间更早的 info，角标数字因此超 99，必须截成 `99+`。
			if (control.alarmFlood) {
				const flood = [
					event("ev-f1", "critical", "firing", "wired_cpu_high", "10.0.0.1", "核心路由器-1 CPU 使用率 97%（阈值 80%）", 2, "2026-11-07T12:00:00Z"),
					event("ev-f2", "warning", "firing", "wired_mem_high", "10.0.0.1", "核心路由器-1 内存使用率 78%", 1, "2026-11-07T11:00:00Z"),
					event("ev-f3", "catastrophic", "firing", "sensor_overheat", "10.0.0.1", "核心路由器-1 板卡温度异常（上游 severity=catastrophic）", 1, "2026-11-07T10:00:00Z"),
					...Array.from({ length: 100 }, (_, index) =>
						event(
							`ev-f${index + 4}`,
							"info",
							"firing",
							"config_changed",
							"10.0.0.1",
							`配置变更 #${index + 1}`,
							1,
							`2026-11-07T09:${String(59 - (index % 60)).padStart(2, "0")}:00Z`
						))
				];
				list = status ? flood.filter((item) => item.status === status) : flood;
			}

			return send(200, {
				code: 0,
				msg: "success",
				data: {
					list,
					page: Number(url.searchParams.get("page") ?? 1),
					page_size: Number(url.searchParams.get("page_size") ?? 100),
					total: list.length
				}
			});
		}
		// ── /metric/*：节点指标（`/topology/monitor` 详情栏趋势，NMCPS-DESIGN-001 A3） ──
		// `/metric/name` 回该设备可用指标名清单：新路径是字符串数组、旧路径是对象数组（双形态，缺口
		// `API-G12`），两家都要吃得下。这里**首项刻意放采集器自监控名**（`up` / `scrape_*`）——
		// 断言「挑编码时跳过 collector 命名空间」而不是抓到什么画什么（NMCPS-CONTRACT-002 §三）。
		if (/^\/(?:api\/v1\/)?metric\/name$/.test(url.pathname) && req.method === "GET") {
			const ip = url.searchParams.get("mgmt_ip");
			// 空清单样本（§七 实测的 24/36 台）：清单为空 ≠ 设备没有数据，序列由 `/metric/datapoint` 照常给。
			if (control.namesEmpty)
				return send(200, { code: 0, msg: "success", data: { mgmt_ip: ip ?? null, metrics: [] } });

			return send(200, {
				code: 0,
				msg: "success",
				data: {
					mgmt_ip: ip ?? null,
					// `sys_name` 排在最后且被目录标成 `string`：它必须**不**进指标选择器
					// （NMCPS-CONTRACT-002 §八 三分类），否则「文本指标画成折线」的缺口就被掩盖了。
					// `hw_board_name` 是**实测字段名**的那条样本（目录用 `data_type`），同样不许进选择器。
					metrics: ["up", "scrape_duration_seconds", "if_in_octets", "cpu_util_pct", "sys_name", "sim_iface_kbps", "hw_board_name"]
				}
			});
		}

		// `/metric/definition`：指标目录（§八 的 join 依据）。`up` / `scrape_*` 即使登记也不可选（名字判据优先），
		// `sys_name` 标 `string` + `has_series: false` —— 两条文本判据各留一条样本。
		if (/^\/(?:api\/v1\/)?metric\/definition$/.test(url.pathname) && req.method === "GET") {
			// 目录不可用的样本（§8.4 / `__control/catalog-error`）：信封失败，但名字清单与序列照常 ——
			// 用来证明「目录失败不阻塞出图，也不冒充取数失败」。
			if (control.catalogError)
				return send(200, { code: 10503, msg: CATALOG_UPSTREAM_FAILURE, data: null });

			return send(200, {
				code: 0,
				msg: "success",
				data: {
					list: [
						{ code: "up", metric_type: "gauge", unit: "", en_name: "Up" },
						{ code: "scrape_duration_seconds", metric_type: "gauge", unit: "s", en_name: "Scrape duration" },
						{ code: "if_in_octets", metric_type: "counter", unit: "bytes", en_name: "Interface in octets" },
						{ code: "cpu_util_pct", metric_type: "gauge", unit: "%", en_name: "CPU utilization" },
						// 仿真侧接口指标：实测 `metric_code=simIfaceInKbps` 的序列标签是
						// `simIfaceMetricIndex`（不是 `ifIndex`），这里照抄一份样本给 A10j 钉分组兜底。
						{ code: "sim_iface_kbps", metric_type: "gauge", unit: "Kbps", en_name: "Sim interface in Kbps" },
						{ code: "sys_name", metric_type: "string", has_series: false, en_name: "System name" },
						// 实测字段名样本（2026-11-08）：目录真实用的是 `metric_code` / `data_type` / `metric_name` /
						// `metric_name_en`，只认 `metric_type` 会把这条 `string` 指标放行成可绘图（A10q 钉的就是这条）。
						{ metric_code: "hw_board_name", data_type: "string", metric_name: "板卡名称", metric_name_en: "Board name", unit: "", enabled: true }
					],
					page: 1,
					page_size: 200,
					total: 7
				}
			});
		}

		// `/metric/device`：设备台账（指标页左栏，`NMCPS-DESIGN-001` §6.6 / A10）。
		// 三个样本按 **2026-11-08 实测响应**构造，不是只留 identity / health / traffic —— 上游对每个设备
		// 还回 `sys_*` / `hw` / `neighbors` / `protocol` / `lldp` / `radio` / `device_quality` / `quality`，
		// 详情区四页（协议 / 射频 / LLDP / 数据质量）就是靠它们出数（A10d~A10g 钉这几页）。
		// 刻意留的缺口：② 的 `health.mem` / `interface_summary.up` 为 null、`protocol` 整块 null、
		// ③ 没有 `mgmt_ip` 且 `lldp` 为 null（= 没上报，不是失败）；② Ⅲ 的 `radio` 一有一无。
		if (/^\/(?:api\/v1\/)?metric\/device$/.test(url.pathname) && req.method === "GET") {
			const devices = [
				{
					device_code: "DEV-CORE-1",
					mgmt_ip: "10.0.0.2",
					sys_name: "核心路由器-1",
					sys_descr: "Core Router (NMCPS-Core 9000)",
					sys_object_id: "1.3.6.1.4.1.99999.1",
					sys_contact: "NOC <noc@sim.local>",
					sys_location: "机房 A-01",
					sys_services: 6,
					role: "core",
					vendor: "huawei",
					model: "NE9000",
					status: "online",
					uptime_sec: 216532,
					health: { cpu_percent: 21.5, mem_percent: 48 },
					// `hw.entities[]` 按实测形状（交换机报 1 条：板名 / 型号 / 两个数值状态）
					hw: {
						entities: [{ index: "1", board_name: "CloudEngine S5735-L24P4X-A1", model_name: "CloudEngine S5735-L24P4X-A1", admin_status: 4, oper_status: 3 }],
						vlan_count: 12,
						route_count: 340,
						fdb_count: 1024,
						mstp_status: "enabled"
					},
					interface_summary: { total: 24, up: 22, down: 2, unknown: 0, wired: 24, wireless: 0 },
					neighbors: ["接入交换机-1", "无线AP-1"],
					neighbor_summary: { total: 2, router: 0, l3_switch: 1, l2_switch: 0, ap: 1, sta: 0 },
					traffic: { in_bps: 0, out_bps: 0, total_bps: 0, in_octets_total: 7466, out_octets_total: 11534 },
					protocol: {
						ip: { in_receives: null, in_hdr_errors: null, in_addr_errors: null, in_delivers: null },
						icmp: { in_msgs: 2718818, in_errors: 1760, out_msgs: 2719866, out_errors: 0 },
						tcp: { curr_estab: 4, in_segs: 66207457, out_segs: 70025359, retrans_segs: 487114, in_errs: 2 },
						udp: { in_datagrams: 50111034, no_ports: 615, in_errors: 0, out_datagrams: 48531851 }
					},
					lldp: {
						chassis_id: "02:1d:83:d8:bb:ab",
						sys_desc: "Ubuntu 22.04.5 LTS Linux 5.15.0",
						man_addr: "10.0.0.2",
						ports: [
							{ port_num: "1272", port_id: "n10-wlan1", port_id_subtype: 5, port_desc: "n10-wlan1" },
							{ port_num: "1305", port_id: "n10-eth2", port_id_subtype: 5, port_desc: "n10-eth2" }
						],
						neighbors: [
							{
								sys_name: "接入交换机-1",
								chassis_id: "02:1d:fe:6d:22:68",
								local_port_num: "1305",
								port_id: "n4-eth5",
								port_desc: "n4-eth5",
								man_addr: "10.0.0.249",
								sys_desc: "Ubuntu 22.04.5 LTS Linux 5.15.0-198-generic"
							}
						]
					},
					radio: null,
					device_quality: { device_latency_us: 16850, device_jitter_us: 249, device_loss_ratio_ppm: 0, metric_age_sec: 326, metric_valid: 2, peer_count: 2 },
					sim: { session_id: "sim-354a5a7f", scenario_name: "三层环状核心无线场景" },
					jobs: ["snmp_devices", "wireless_devices"],
					anchor_job: "snmp_devices",
					quality: { job_mixed: true, duplicate_samples: true, vendor_fields_unavailable: true }
				},
				{
					device_code: "DEV-ACC-1",
					mgmt_ip: "10.0.0.3",
					sys_name: "接入交换机-1",
					sys_descr: "Access Switch (NMCPS-Access 4800)",
					sys_object_id: "1.3.6.1.4.1.99999.2",
					sys_contact: null,
					sys_location: null,
					sys_services: 2,
					role: "access",
					vendor: "h3c",
					model: "S4800",
					status: "degraded",
					uptime_sec: 10800,
					health: { cpu_percent: 63.25, mem_percent: null },
					hw: { entities: [], vlan_count: null, route_count: null, fdb_count: null, mstp_status: null },
					interface_summary: { total: 48, up: null, down: null },
					neighbors: [],
					neighbor_summary: { total: 0, router: 0, l3_switch: 0, l2_switch: 0, ap: 0, sta: 0 },
					traffic: { in_bps: null, out_bps: null, total_bps: null, in_octets_total: 0, out_octets_total: 0 },
					// 整块 null：协议页必须走「上游这一块没上报」，而不是把 null 画成 0
					protocol: null,
					lldp: {
						chassis_id: "02:1d:5d:4e:2b:d9",
						sys_desc: "H3C S4800",
						ports: [{ port_num: "1", port_id: "GE1/0/1", port_id_subtype: 5, port_desc: "GE1/0/1" }],
						neighbors: []
					},
					radio: null,
					device_quality: null,
					jobs: ["snmp_devices"],
					anchor_job: "snmp_devices",
					quality: {}
				},
				{
					device_code: "DEV-AP-1",
					mgmt_ip: null,
					sys_name: "无线AP-1",
					sys_descr: "Access Point (IEEE 802.11 OVS bridge + hostapd)",
					sys_object_id: "1.3.6.1.4.1.99999.2",
					sys_contact: "Simulation Admin <admin@sim.local>",
					sys_location: "Mininet-WiFi Simulation",
					sys_services: 2,
					role: "ap",
					vendor: "ruijie",
					model: "n10",
					status: "online",
					uptime_sec: 216477,
					health: {},
					hw: { entities: [], vlan_count: null, route_count: null, fdb_count: null, mstp_status: null },
					interface_summary: { total: 1, up: 1, down: 0, unknown: 0, wired: 1, wireless: 0 },
					neighbors: ["单链路终端-1"],
					neighbor_summary: { total: 1, router: 0, l3_switch: 0, l2_switch: 0, ap: 0, sta: 1 },
					protocol: {
						ip: { in_receives: null },
						icmp: { in_msgs: 0, in_errors: 0, out_msgs: 0, out_errors: 0 },
						tcp: { curr_estab: 70, retrans_segs: 487114, in_errs: 2 },
						udp: { in_datagrams: 50112939, no_ports: 615, in_errors: 0 }
					},
					// `null` = 这台设备没上报 LLDP（同一批里 DEV-CORE-1 有）⇒ LLDP 页走「没上报」分支
					lldp: null,
					radio: {
						role: 1,
						ssid: "Wi-Fi胖AP-1",
						mode: 2,
						band: 2,
						channel: 36,
						frequency_mhz: 5180,
						bandwidth_mhz: 20,
						bss_type: 1,
						power_mgmt_mode: 1,
						tx_power_dbm: 36,
						noise_dbm: -93,
						interference_level: 5,
						assoc_count: 1,
						supported_rates_tx_mbps: 52,
						supported_rates_rx_mbps: 52,
						operational_rates_mbps: [6.5, 13, 19.5, 26, 39, 52, 58.5],
						associations: [
							{ index: "1", sta_name: "单链路终端-1", sta_mac: "02:00:00:00:00:00", rssi_dbm: -45, tx_rate_mbps: 52, status: "1" }
						],
						// MLO 从链路（实测 9 台终端共 15 条）与对端 AP（9 台终端各 1 个）
						multilinks: [
							{ index: "1", band: 2, channel: 36, bssid: "02:00:00:00:09:00", rssi_dbm: -45, tx_rate_mbps: 52, status: "1" }
						],
						peer_ap_name: "n10",
						peer_ap_mac: "02:00:00:00:09:00"
					},
					device_quality: { device_latency_us: 50, device_jitter_us: 8, device_loss_ratio_ppm: 0, metric_age_sec: 148, metric_valid: 2, peer_count: 1 },
					sim: { session_id: "sim-354a5a7f", scenario_name: "三层环状核心无线场景" },
					jobs: ["snmp_devices", "wireless_devices"],
					anchor_job: "snmp_devices",
					quality: { vendor_fields_unavailable: true }
				}
			];

			return send(200, { code: 0, msg: "success", data: iamPaged(withDeepPageFillers(devices, 15, deepPageDeviceFiller), url) });
		}

		// `/metric/link`：链路台账（A12）。链路**没有 `mgmt_ip`**，页面靠 source 端 `device_code`
		// 反查设备 IP，并用 source 端 `if_index` 过滤端口序列（CONTRACT-002 §6.9）；第二条刻意从
		// 「没有 IP」的 `DEV-AP-1` 出发，把「取不到折线」这条分支固定进自查。
		if (/^\/(?:api\/v1\/)?metric\/link$/.test(url.pathname) && req.method === "GET") {
			const links = [
				{
					identity: {
						link_id: "DEV-CORE-1:GE0/0/1--DEV-ACC-1:GE1/0/1",
						source: {
							device_code: "DEV-CORE-1",
							device_role: "core",
							interface_id: "GE0/0/1",
							if_index: 101,
							interface_name: "GE0/0/1",
							if_mtu: 1500,
							if_phys_address: "4a:d8:56:6c:6e:75",
							if_speed_bps: 100000000,
							admin_status: 1,
							oper_status: 1,
							medium: "wired"
						},
						target: {
							device_code: "DEV-ACC-1",
							device_role: "access",
							interface_id: "GE1/0/1",
							if_index: 201,
							interface_name: "GE1/0/1",
							if_mtu: 1500,
							if_phys_address: "1a:1e:35:e9:8e:e1",
							if_speed_bps: 100000000,
							admin_status: 1,
							oper_status: 1,
							medium: "wired"
						},
						discovery: "lldp",
						if_type: 6
					},
					// 逐字段照实测形状：计数 / 探针侧 / 新鲜度都在（`redundancy_state` 实测恒 null）
					metrics: {
						status: "up",
						graph_status: "online",
						graph_medium: "eth100m",
						medium: "ethernet",
						bandwidth_mbps: 10000,
						bandwidth_usage_percent: 32.5,
						latency_ms: 1.2,
						jitter_ms: 0.005,
						packet_loss_percent: 0,
						in_errors: 0,
						out_errors: 2,
						in_discards: 0,
						out_discards: 3,
						in_ucast_pkts: 103,
						out_ucast_pkts: 103,
						in_nucast_pkts: 0,
						out_nucast_pkts: 0,
						in_unknown_protos: 0,
						out_qlen: 4,
						probe_peer: "n7",
						probe_dir: 2,
						rtt_mdev_us: 8,
						latency_age_sec: 49,
						jitter_age_sec: 38,
						loss_age_sec: 49,
						rate_age_sec: 8,
						metric_valid: 1,
						redundancy_state: null
					},
					jobs: ["snmp_devices", "wired_devices"]
				},
				{
					identity: {
						link_id: "DEV-AP-1:WLAN-0--DEV-CORE-1:GE0/0/9",
						source: { device_code: "DEV-AP-1", device_role: "ap", interface_id: "WLAN-0", interface_name: "WLAN-0", medium: "wireless" },
						target: { device_code: "DEV-CORE-1", device_role: "core", interface_id: "GE0/0/9", interface_name: "GE0/0/9", medium: "wireless" },
						discovery: "lldp"
					},
					metrics: {
						status: "down",
						graph_status: "offline",
						graph_medium: "wifi",
						medium: "wireless",
						bandwidth_mbps: 300,
						bandwidth_usage_percent: null,
						latency_ms: null,
						jitter_ms: null,
						packet_loss_percent: null,
						// 计数缺失时逐项 null：这一条用来钉「缺字段写 `—`，不补 0」
						in_errors: null,
						out_errors: null,
						in_discards: null,
						in_ucast_pkts: null,
						probe_peer: null,
						probe_dir: null,
						rtt_mdev_us: null,
						metric_valid: null
					},
					jobs: ["wireless_devices"],
					// 无线链路的质量标记：`link_unmapped` 与 `redundancy_unavailable` 置位（实测形状）
					quality: { link_unmapped: true, redundancy_unavailable: true }
				}
			];

			return send(200, { code: 0, msg: "success", data: iamPaged(withDeepPageFillers(links, 20, deepPageLinkFiller), url) });
		}

		// `/metric/datapoint` 回 VM 风格 matrix：点对恒为 `[unix秒, 字符串值]`。序列里**故意夹三个
		// 非法点**（空串 / `NaN` / 缺值）—— 展示层必须丢弃并计数、绝不补 0（CONTRACT-002 §6.3 ②）。
		// 多条 `results` 是常态（§6.9）：接口级指标按 `ifIndex` 分组、同一接口被两个 job 重复采集；
		// 这里给 `if_in_octets` 造 2 个端口 × 2 个 job（同组的第二个 job 只回合法点，于是「丢弃计数」
		// 仍是 3，不会被双 job 翻倍），另一端口的值刻意不同 —— 混画就一定能看出来。
		if (/^\/(?:api\/v1\/)?metric\/datapoint$/.test(url.pathname) && req.method === "GET") {
			// 业务失败（不是网络失败）：信封 `code !== 0`，BFF 归一到 `status: "error"` + 原话 `message`
			if (control.metricError)
				return send(200, { code: 10500, msg: METRIC_UPSTREAM_FAILURE });

			const now = Math.floor(Date.now() / 1000);
			const values = [
				[now - 600, "12.5"],
				[now - 480, "18.25"],
				[now - 420, ""],
				[now - 360, "21"],
				[now - 240, "NaN"],
				[now - 180, "19.75"],
				[now - 120, "23.5"],
				[now - 60, "20.25"],
				[now, "22"]
			];
			const validOnly = values.filter(([, raw]) => raw !== "" && raw !== "NaN");
			const otherPort = validOnly.map(([ts]) => [ts, "41.5"]);

			const code = url.searchParams.get("metric_code") ?? "";
			const ip = url.searchParams.get("mgmt_ip") ?? "";
			const withRate = url.searchParams.get("rate") === "true";
			/** `rate=true` 时 VM 的输出不带 `__name__`（§五 实测），这里照抄，免得内核偷偷依赖它 */
			const nameLabel = withRate ? {} : { __name__: code };

			const results = code === "if_in_octets"
				? [
					{ metric: { ...nameLabel, ip, job: "snmp_devices", ifIndex: "101" }, values },
					{ metric: { ...nameLabel, ip, job: "wireless_devices", ifIndex: "101" }, values: validOnly },
					{ metric: { ...nameLabel, ip, job: "snmp_devices", ifIndex: "102" }, values: otherPort }
				]
				// 仿真侧接口指标（实测 `simIfaceInKbps`）：标签是 `simIfaceMetricIndex`，没有 `ifIndex`
				// ⇒ 分组必须认这个兜底，否则整页只能出「设备级」一行。
				: code === "sim_iface_kbps"
					? [
						{ metric: { ...nameLabel, ip, job: "sim_metrics", simIfaceMetricIndex: "2" }, values },
						{ metric: { ...nameLabel, ip, job: "sim_metrics", simIfaceMetricIndex: "3" }, values: otherPort },
						{ metric: { ...nameLabel, ip, job: "sim_metrics", simIfaceMetricIndex: "4" }, values: validOnly.map(([ts]) => [ts, "7"]) }
					]
					// 设备级指标（`sysUpTime` / `cpu_util_pct` 这类）没有任何接口索引标签
					: [{ metric: { ...nameLabel, ip, job: "snmp_devices" }, values }];

			return send(200, {
				code: 0,
				msg: "success",
				data: {
					mode: url.searchParams.get("mode") ?? "range",
					mgmt_ip: url.searchParams.get("mgmt_ip") ?? null,
					metric_code: url.searchParams.get("metric_code") ?? null,
					rate: withRate,
					results
				}
			});
		}

		const accountPath = url.pathname.match(/^\/(?:api\/v1\/)?account(\/.*)?$/);
		if (accountPath) {
			const rest = accountPath[1] ?? "";
			const statusMatch = rest.match(/^\/([^/]+)\/status$/);

			if (statusMatch && req.method === "PUT") {
				const body = await readJsonBody(req);
				const record = accountRecords.find((item) => item.accountCode === decodeURIComponent(statusMatch[1]));

				if (!record)
					return send(404, { code: 10404, msg: "account_not_found" });
				// 与真实上游一致：`0` / `5` 等非法值报 10101
				if (![1, 2, 3, 4].includes(body?.status))
					return send(400, { code: 10101, msg: "status_invalid" });

				record.status = body.status;
				return send(200, { code: 0, msg: "success", data: { ok: true } });
			}

			if (rest === "" && req.method === "GET") {
				const keyword = (url.searchParams.get("keyword") ?? "").trim().toLowerCase();
				const status = Number(url.searchParams.get("status") ?? 0);
				const level = url.searchParams.get("accountLevel");
				const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
				const pageSize = Math.max(1, Number(url.searchParams.get("pageSize") ?? 20));

				const filtered = accountRecords.filter((item) => {
					const matchedKeyword = !keyword
						|| item.accountName.toLowerCase().includes(keyword)
						|| item.displayName.toLowerCase().includes(keyword);

					// `status: 0` 与 `accountLevel: 0` 上游会当「未提供」（NMCPS-REC-002 UP-ACC-02）
					return matchedKeyword
						&& (!status || item.status === status)
						&& (level === null || item.accountLevel === Number(level));
				});

				const start = (page - 1) * pageSize;
				return send(200, {
					code: 0,
					msg: "success",
					data: { list: filtered.slice(start, start + pageSize), total: filtered.length, page, pageSize }
				});
			}

			if (rest === "" && req.method === "POST") {
				const body = await readJsonBody(req);
				const creator = tokenAccount.get((req.headers.authorization ?? "").replace(/^Bearer\s+/i, "")) ?? "alice";
				const creatorLevel = accountLevelOf(creator);

				// 与真实上游一致：缺必填字段直接 500 / 10509（UP-ACC-03）
				if (!body?.accountName || !body?.displayName || !body?.password || body?.accountLevel === undefined)
					return send(500, { code: 10509, msg: "invalid request" });

				// UP-ACC-07：平台层身份必须显式带 tenantId（`0` 视同缺省）
				if (creatorLevel === 0 && !body.tenantId)
					return send(400, { code: 10101, msg: "缺少必填参数 tenantId" });

				// UP-ACC-01（已闭环）：只能向下管控 —— 同级或更高一律拒绝
				if (body.accountLevel <= creatorLevel)
					return send(403, { code: 20103, msg: "只能向下管控：不可操作与自身同级或更高权限的账号/角色" });

				// UP-ACC-08：`4` 是服务账号（系统开通），`> 4` 越界
				if (body.accountLevel === 4)
					return send(400, { code: 20102, msg: "账号等级与归属层不匹配：服务账号由系统自动开通" });
				if (body.accountLevel > 4)
					return send(400, { code: 10101, msg: "参数 accountLevel 取值应为 0-4" });

				if (accountRecords.some((item) => item.accountName === body.accountName))
					return send(400, { code: 10302, msg: "account_name_duplicated" });

				const record = {
					accountId: accountRecords.length + 1,
					accountCode: `ACC-${1001 + accountRecords.length}`,
					accountName: body.accountName,
					displayName: body.displayName,
					accountLevel: body.accountLevel,
					// 带 `mustResetPassword` 的建号落「待激活」，与上游一致
					status: body.mustResetPassword ? 4 : 1,
					mfaEnabled: !!body.mfaEnabled,
					createdAt: new Date().toISOString().slice(0, 19).replace("T", " ")
				};
				accountRecords.push(record);
				return send(200, { code: 0, msg: "success", data: record });
			}

			return send(404, { code: 10404, msg: "account_path_not_found" });
		}

		// ── /tenant*：租户域（超级管理员建号时选归属租户；BFF 网关透传路径可能带 `/api/v1` 前缀） ──
		const tenantPath = url.pathname.match(/^\/(?:api\/v1\/)?tenant$/);
		if (tenantPath && req.method === "GET")
			return send(200, { code: 0, msg: "success", data: paged(tenantRecords, url) });

		// ── /iam/*：模拟新代 iam 服务（信封为 `{ code, message, data }`；2026-11-04 实测口径） ──
		if (url.pathname.startsWith("/iam/")) {
			let raw = "";
			for await (const chunk of req)
				raw += chunk;
			let body;
			try {
				body = raw ? JSON.parse(raw) : undefined;
			} catch {
				body = undefined;
			}

			const bearer = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
			/** 身份载荷：`user_info`（平台管理员 `tenant_id: null`，其余挂默认租户） */
			const userInfoOf = (username) => ({
				id: `u_${username}`,
				username,
				display_name: username === "admin" ? "平台管理员" : "Alice",
				email: `${username}@nms.local`,
				phone: "",
				tenant_id: username === "admin" ? null : "t_default"
			});
			/** 新的访问令牌；`refresh_token` 只在登录时签发（刷新不轮换，D4） */
			const issueAccess = (username = "alice") => {
				authLog.seq += 1;
				const tokens = { access_token: `at-${authLog.seq}`, expires_in: 86400 };
				authLog.issuedAccess.add(tokens.access_token);
				tokenAccount.set(tokens.access_token, username);
				return tokens;
			};

			if (url.pathname === "/iam/login") {
				authLog.login += 1;
				// 与真实上游一致：空 body 直接 500 / 10509（BFF 必须挡在前面）
				if (!body?.username || !body?.password)
					return send(500, { code: 10509, message: "invalid request" });
				// 新代 iam：业务错误走 `HTTP 200 + code≠0`（实测口令错 = 200 / 10003），
				// 留给「BFF 必须还原成 401 且不写 cookie」这条断言
				if (body.username === "biz-error-user")
					return send(200, { code: 10003, message: "账号或密码错误" });
				const account = accountOf(body.username);
				// 口令错与「账号不存在」同码，不泄露账号是否存在
				if (body.password !== account.password)
					return send(200, { code: 10003, message: "账号或密码错误" });
				const tokens = issueAccess(body.username);
				const refreshToken = `rt-${authLog.seq}`;
				tokenUser.set(refreshToken, body.username);
				return send(200, {
					code: 0,
					message: "success",
					data: { ...tokens, refresh_token: refreshToken, user_info: userInfoOf(body.username) }
				});
			}

			if (url.pathname === "/iam/refresh") {
				authLog.refresh += 1;
				const token = body?.refresh_token;
				if (!token)
					return send(401, { code: 40101, message: "未认证或登录态已失效" });
				// 实测：坏令牌走 **HTTP 200 + code 10007**（不是 401），BFF 必须识别成会话失效
				if (!tokenUser.has(token))
					return send(200, { code: 10007, message: "无效的认证令牌" });
				// 不轮换：同一个刷新令牌可反复使用（实测连用两次均 200）
				authLog.reusedRefresh += 1;
				// 有效刷新令牌签发新访问令牌；**不返回 refresh_token**
				return send(200, { code: 0, message: "success", data: issueAccess(tokenUser.get(token) ?? "alice") });
			}

			if (url.pathname === "/iam/logout") {
				authLog.logout.push({ authorization: req.headers.authorization ?? null, contentType: req.headers["content-type"] ?? null, body: body ?? null });
				// 幂等：重复登出仍 200 code 0（实测）
				authLog.revokedAccess.add(bearer);
				return send(200, { code: 0, message: "success", data: null });
			}

			if (url.pathname === "/iam/password" && req.method === "PUT") {
				authLog.passwordMethod = req.method;
				authLog.password.push(body ?? null);
				if (!authLog.issuedAccess.has(bearer) || authLog.revokedAccess.has(bearer))
					return send(401, { code: 40101, message: "会话已失效" });
				// 与真实上游一致：缺字段直接 500 / 10509（BFF 必须挡在前面）
				if (!body?.old_password || !body?.new_password)
					return send(500, { code: 10509, message: "invalid request" });
				// 按令牌判账号：改密只影响自己的口令，不串号
				const username = tokenAccount.get(bearer);
				const account = username ? accountOf(username) : null;
				// 旧口令错误：真实上游回 **HTTP 200 + code 10003**（BFF 必须还原为 400）
				if (!account || body.old_password !== account.password)
					return send(200, { code: 10003, message: "用户名或密码错误" });
				// 改密真的落库：新口令立刻可登录、旧口令失效
				account.password = body.new_password;
				return send(200, { code: 0, message: "success", data: null });
			}

			// ── 新代用户 / 租户 / 部门（`/system/user` 自查用；2026-11-04 实测口径）─────────
			// `GET /iam/users`：`keyword` 命中 username / display_name / email，`status` 精确匹配，
			// `department_id` 精确匹配；空结果 `list: null`（BFF 出口归一为 `[]`）
			if (url.pathname === "/iam/users" && req.method === "GET") {
				const keyword = (url.searchParams.get("keyword") ?? "").trim().toLowerCase();
				const status = (url.searchParams.get("status") ?? "").trim();
				const departmentId = (url.searchParams.get("department_id") ?? "").trim();

				const filtered = iamUsers.filter((item) => {
					const matchedKeyword = !keyword
						|| item.username.toLowerCase().includes(keyword)
						|| (item.display_name ?? "").toLowerCase().includes(keyword)
						|| (item.email ?? "").toLowerCase().includes(keyword);

					return matchedKeyword
						&& (!status || item.status === status)
						&& (!departmentId || item.department_id === departmentId);
				});

				return send(200, { code: 0, message: "success", data: iamPaged(filtered, url) });
			}

			// `POST /iam/users`：重复用户名 200 / 10002、缺字段 200 / 40001（实测口径）；
			// 成功回 `{ code, message, id }` —— **没有 `data`**，页面靠 keyword 回读
			if (url.pathname === "/iam/users" && req.method === "POST") {
				if (!body?.username || !body?.password)
					return send(200, { code: 40001, message: body?.username ? "密码不能为空" : "用户名不能为空", id: "" });
				if (iamUsers.some((item) => item.username === body.username))
					return send(200, { code: 10002, message: "用户已存在", id: "" });

				const created = {
					id: `u_${body.username}`,
					tenant_id: iamDepartments.find((item) => item.id === body.department_id)?.tenant_id ?? null,
					department_id: body.department_id ?? null,
					username: body.username,
					email: body.email ?? "",
					display_name: body.display_name ?? "",
					status: "active",
					mfa_enabled: false,
					last_login_at: null,
					created_at: "2026-11-04T09:00:00+08:00",
					deleted_at: null
				};
				iamUsers.push(created);
				return send(200, { code: 0, message: "success", id: created.id });
			}

			const iamUserPath = url.pathname.match(/^\/iam\/users\/([^/]+)$/);
			if (iamUserPath) {
				const id = decodeURIComponent(iamUserPath[1]);
				const record = iamUsers.find((item) => item.id === id);

				if (!record)
					// 实测：目标不存在时上游回 **HTTP 400 + 纯文本「记录不存在」**（非信封）
					return send(400, { code: 400, message: "记录不存在" });

				if (req.method === "PUT") {
					if (body?.status && !["active", "disabled", "locked"].includes(body.status))
						return send(200, { code: 40001, message: "status 取值不合法", id: "" });
					for (const key of ["department_id", "email", "phone", "display_name", "status", "mfa_enabled"]) {
						if (body?.[key] !== undefined)
							record[key] = body[key];
					}
					// 改部门会连带改租户归属（部门自带租户），与真实上游一致
					if (body?.department_id)
						record.tenant_id = iamDepartments.find((item) => item.id === body.department_id)?.tenant_id ?? record.tenant_id;
					return send(200, { code: 0, message: "success" });
				}

				if (req.method === "DELETE") {
					// 软删：从列表移除（`deleted_at` 有值，列表默认过滤已删记录）
					record.deleted_at = "2026-11-04T09:30:00+08:00";
					iamUsers.splice(iamUsers.indexOf(record), 1);
					return send(200, { code: 0, message: "success" });
				}

				return send(404, { code: 10404, message: "iam_path_not_found" });
			}

			// ── `iam/policies`（NMCPS-DESIGN-005 §7）：/system/policy 的唯一数据源 ──
			// `GET /iam/policies`：`keyword` 命中 name / code；`code` / `policy_type` / `enabled`
			// 传了被静默忽略（UP-RBAC-06）—— 假上游也不实现它们，页面才测得出「筛选没生效」。
			if (url.pathname === "/iam/policies" && req.method === "GET") {
				const keyword = (url.searchParams.get("keyword") ?? "").trim().toLowerCase();
				const filtered = iamPolicies.filter((item) => !keyword
					|| item.name.toLowerCase().includes(keyword)
					|| item.code.toLowerCase().includes(keyword));

				return send(200, { code: 0, message: "success", data: iamPaged(filtered, url) });
			}

			// `POST /iam/policies`：成功把新主键放在**信封顶层**（`{ code, message, id }`，没有 data）；
			// 非法 document / 重复 code 回 `400` + 原始 SQL 文本（UP-RBAC-04），页面必须换成文案。
			if (url.pathname === "/iam/policies" && req.method === "POST") {
				let parsed = false;
				try {
					JSON.parse(body?.document ?? "");
					parsed = true;
				} catch {
					parsed = false;
				}
				if (!parsed)
					return sendText(400, "ERROR: invalid input syntax for type json (SQLSTATE 22P02)");
				if (iamPolicies.some((item) => item.code === body?.code))
					return sendText(400, "ERROR: duplicate key value violates unique constraint \"uk_sys_policy_tenant_code\" (SQLSTATE 23505)");

				const created = {
					id: `pol_${body.code}`,
					tenant_id: "tnt_default",
					name: body.name ?? "",
					code: body.code,
					policy_type: body.policy_type ?? "custom",
					document: body.document,
					description: body.description ?? "",
					enabled: true,
					is_system: false,
					created_at: "2026-11-04T10:00:00+08:00",
					updated_at: "2026-11-04T10:00:00+08:00",
					deleted_at: null
				};
				iamPolicies.push(created);
				return send(200, { code: 0, message: "success", id: created.id });
			}

			const iamPolicyPath = url.pathname.match(/^\/iam\/policies\/([^/]+)$/);
			if (iamPolicyPath) {
				const id = decodeURIComponent(iamPolicyPath[1]);
				const record = iamPolicies.find((item) => item.id === id);

				// 实测：目标不存在回 **HTTP 400 + 纯文本「记录不存在」**（非信封）
				if (!record)
					return sendText(400, "记录不存在");

				if (req.method === "GET")
					return send(200, { code: 0, message: "success", data: record });

				if (req.method === "PUT") {
					// `enabled` 写入被忽略（UP-RBAC-03）：只有 name / document / description 生效
					for (const key of ["name", "document", "description"]) {
						if (body?.[key] !== undefined)
							record[key] = body[key];
					}
					record.updated_at = "2026-11-04T10:30:00+08:00";
					return send(200, { code: 0, message: "success" });
				}

				if (req.method === "DELETE") {
					// `pol_role_reader_isp_a` 固定走 UP-RBAC-05 的失败通道：transport 仍是 200，业务码 400
					if (record.id === "pol_role_reader_isp_a")
						return send(200, { code: 400, message: "资源不存在或无权访问" });

					iamPolicies.splice(iamPolicies.indexOf(record), 1);
					return send(200, { code: 0, message: "success" });
				}

				return send(404, { code: 10404, message: "iam_path_not_found" });
			}

			// ── `iam/roles`（NMCPS-DESIGN-005 §8）：/system/permission 的角色数据源 ──
			// `GET /iam/roles`：`keyword` 命中 name / code；`enabled` / `tenant_id` 传了被静默忽略（UP-RBAC-06）
			if (url.pathname === "/iam/roles" && req.method === "GET") {
				const keyword = (url.searchParams.get("keyword") ?? "").trim().toLowerCase();
				const filtered = iamRoles.filter((item) => !keyword
					|| item.name.toLowerCase().includes(keyword)
					|| item.code.toLowerCase().includes(keyword));

				return send(200, { code: 0, message: "success", data: iamPaged(filtered, url) });
			}

			// `POST /iam/roles`：成功把新主键放在**信封顶层**（`{ code, message, id }`，没有 data）；
			// 重复 `code` 回 `400` + 原始 SQL 文本（UP-RBAC-04），页面必须换成文案
			if (url.pathname === "/iam/roles" && req.method === "POST") {
				if (!body?.code || !body?.name)
					return sendText(400, "ERROR: null value in column \"code\" violates not-null constraint (SQLSTATE 23502)");
				if (iamRoles.some((item) => item.code === body.code))
					return sendText(400, "ERROR: duplicate key value violates unique constraint \"uk_sys_role_tenant_code\" (SQLSTATE 23505)");

				const created = {
					id: `r_${body.code}`,
					tenant_id: "tnt_default",
					name: body.name,
					code: body.code,
					description: body.description ?? "",
					enabled: true,
					is_system: false,
					created_at: "2026-11-04T10:00:00+08:00",
					updated_at: "2026-11-04T10:00:00+08:00",
					deleted_at: null
				};
				iamRoles.push(created);
				return send(200, { code: 0, message: "success", id: created.id });
			}

			const iamRolePath = url.pathname.match(/^\/iam\/roles\/([^/]+)$/);
			if (iamRolePath) {
				const id = decodeURIComponent(iamRolePath[1]);
				const record = iamRoles.find((item) => item.id === id);

				// 实测：目标不存在回 **HTTP 400 + 纯文本「记录不存在」**（非信封）
				if (!record)
					return sendText(400, "记录不存在");

				if (req.method === "GET")
					return send(200, { code: 0, message: "success", data: record });

				if (req.method === "PUT") {
					// `enabled` 写入被忽略（UP-RBAC-03）：只有 name / description 生效
					for (const key of ["name", "description"]) {
						if (body?.[key] !== undefined)
							record[key] = body[key];
					}
					record.updated_at = "2026-11-04T10:30:00+08:00";
					return send(200, { code: 0, message: "success" });
				}

				if (req.method === "DELETE") {
					// `r_tenant_viewer_isp_a` 固定走 UP-RBAC-05 的失败通道：transport 仍是 200，业务码 400
					if (record.id === "r_tenant_viewer_isp_a")
						return send(200, { code: 400, message: "资源不存在或无权访问" });

					iamRoles.splice(iamRoles.indexOf(record), 1);
					return send(200, { code: 0, message: "success" });
				}

				return send(404, { code: 10404, message: "iam_path_not_found" });
			}

			// ── `iam/role-policies`（策略 × 角色）：只回关系行，不回策略本体 ──
			if (url.pathname === "/iam/role-policies" && req.method === "GET") {
				const roleId = (url.searchParams.get("role_id") ?? "").trim();
				const filtered = iamRolePolicies.filter((item) => !roleId || item.role_id === roleId);
				return send(200, { code: 0, message: "success", data: iamPaged(filtered, url) });
			}

			if (url.pathname === "/iam/role-policies/AttachPolicy" && req.method === "POST") {
				if (!body?.role_id || !body?.policy_id)
					return sendText(400, "ERROR: null value in column \"role_id\" violates not-null constraint (SQLSTATE 23502)");
				if (iamRolePolicies.some((item) => item.role_id === body.role_id && item.policy_id === body.policy_id))
					return sendText(400, "ERROR: duplicate key value violates unique constraint \"uk_sys_role_policy\" (SQLSTATE 23505)");

				iamRolePolicies.push({
					id: `rp-${iamRolePolicies.length + 1}`,
					role_id: body.role_id,
					policy_id: body.policy_id,
					created_at: "2026-11-04T10:40:00+08:00"
				});
				return send(200, { code: 0, message: "success" });
			}

			// 摘除幂等：没有命中的关系行也回 200（实测）
			if (url.pathname === "/iam/role-policies/DetachPolicy" && req.method === "POST") {
				const index = iamRolePolicies.findIndex((item) => item.role_id === body?.role_id && item.policy_id === body?.policy_id);
				if (index >= 0)
					iamRolePolicies.splice(index, 1);
				return send(200, { code: 0, message: "success" });
			}

			// ── `iam/subject-roles`（主体 × 角色）：只认 `subject_id`，按角色反查由前端做 ──
			if (url.pathname === "/iam/subject-roles" && req.method === "GET") {
				const subjectId = (url.searchParams.get("subject_id") ?? "").trim();
				const filtered = iamSubjectRoles.filter((item) => !subjectId || item.subject_id === subjectId);
				return send(200, { code: 0, message: "success", data: iamPaged(filtered, url) });
			}

			if (url.pathname === "/iam/subject-roles/AssignRole" && req.method === "POST") {
				if (!body?.subject_id || !body?.role_id)
					return sendText(400, "ERROR: null value in column \"subject_id\" violates not-null constraint (SQLSTATE 23502)");
				if (iamSubjectRoles.some((item) => item.subject_id === body.subject_id && item.role_id === body.role_id))
					return sendText(400, "ERROR: duplicate key value violates unique constraint \"uk_sys_subject_role\" (SQLSTATE 23505)");

				iamSubjectRoles.push({
					id: `sr-${iamSubjectRoles.length + 1}`,
					subject_type: body.subject_type ?? "user",
					subject_id: body.subject_id,
					role_id: body.role_id,
					created_at: "2026-11-04T10:50:00+08:00"
				});
				return send(200, { code: 0, message: "success" });
			}

			// 撤销幂等：没有命中的关系行也回 200（实测）
			if (url.pathname === "/iam/subject-roles/RevokeRole" && req.method === "POST") {
				const index = iamSubjectRoles.findIndex((item) => item.subject_id === body?.subject_id && item.role_id === body?.role_id);
				if (index >= 0)
					iamSubjectRoles.splice(index, 1);
				return send(200, { code: 0, message: "success" });
			}

			if (url.pathname === "/iam/tenants" && req.method === "GET")
				return send(200, { code: 0, message: "success", data: iamPaged(iamTenants, url) });

			if (url.pathname === "/iam/departments" && req.method === "GET")
				return send(200, { code: 0, message: "success", data: iamPaged(iamDepartments, url) });

			return send(404, { code: 10404, message: "iam_path_not_found" });
		}

		// ── /asset/device：新代资产域（snake_case；`snmp_*_pass` 是明文，NMCPS-ADR-0018 D7
		//    要求 BFF 出口掩码，故这里故意给真值，让 check:bff 断言「掩码后仍是 ***」） ──
		const assetDevicePath = url.pathname.match(/^\/(?:api\/v1\/)?asset\/device$/);
		if (assetDevicePath && req.method === "GET") {
			return send(200, {
				code: 0,
				message: "success",
				data: {
					list: [{ id: "dev-1001", name: "核心交换机", status: "online", snmp_auth_pass: "auth-secret-1", snmp_priv_pass: "priv-secret-1" }],
					page: 1,
					page_size: 10,
					total: 1
				}
			});
		}

		// ── 2.0 会话通道（`NMCPS-DESIGN-008` M1 / `NMCPS-ADR-0029` M1.2）──
		// 真实的会话只是给现有全局 `app.net` 起个名字：这里同样复用同一份 `mininetState`，
		// 建完会话再看得到 1.x 建的节点。写请求同样进 `mininetLog`（路径是上游那条），
		// 自检据此断言页面「只剩会话路径」。
		if (url.pathname.startsWith("/api/simulation/")) {
			const segments = url.pathname.slice("/api/simulation/".length).split("/").filter(Boolean).map((part) => decodeURIComponent(part));

			let body;
			if (req.method !== "GET") {
				const raw = await readRawBody(req);
				body = (() => {
					try {
						return raw ? JSON.parse(raw) : undefined;
					} catch {
						return undefined;
					}
				})();
				mininetLog.push({ method: req.method, path: url.pathname, body, raw, contentType: req.headers["content-type"] });
			}

			if (segments[0] !== "sessions")
				return send(404, { detail: "not found" });

			if (segments.length === 1 && req.method === "POST") {
				const engine = typeof body?.engine === "string" ? body.engine : "wired";
				if (engine !== "wired" && engine !== "dryrun")
					return send(400, { detail: `engine ${engine} is not available` });
				mininetSessions.seq += 1;
				const id = `sim-${mininetSessions.seq}`;
				mininetSessions.ids.push(id);
				const now = new Date().toISOString();
				return send(201, {
					id,
					engine,
					name: typeof body?.name === "string" ? body.name : id,
					state: "created",
					created_at: now,
					updated_at: now,
					metadata: body?.metadata ?? {}
				});
			}

			if (segments.length === 1 && req.method === "GET")
				return send(200, { sessions: mininetSessions.ids.map((id) => ({ id, state: "created" })), total: mininetSessions.ids.length });

			const sessionId = segments[1];
			const kind = segments[2];
			const targetId = segments[3];
			if (!mininetSessions.ids.includes(sessionId))
				return send(404, { detail: `session ${sessionId} not found` });

			// 统一节点 PATCH：`x` / `y` 是 `layout`（任何状态可写），`attributes` 是 `deferred`
			if (kind === "nodes" && targetId && req.method === "PATCH") {
				const bucket = mininetBucketOf(targetId);
				if (!bucket)
					return send(404, { detail: `node ${targetId} not found` });
				const node = mininetState[bucket][targetId];
				if (typeof body?.x === "number")
					node.x = Math.round(body.x);
				if (typeof body?.y === "number")
					node.y = Math.round(body.y);
				const attributes = body?.attributes ?? {};
				const keys = Object.keys(attributes);
				if (keys.length) {
					const mutable = new Set(["ip", "defaultRoute", "interfaceIps", "routes", "proxyArp", "ipForward"]);
					const unknown = keys.find((key) => !mutable.has(key));
					if (unknown)
						return send(400, { detail: `unknown attribute ${unknown}` });
					if (typeof attributes.ip === "string")
						node.ip = attributes.ip.trim();
					if (typeof attributes.defaultRoute === "string")
						node.default_route = attributes.defaultRoute.trim();
					if (attributes.interfaceIps && typeof attributes.interfaceIps === "object")
						node.interface_ips = { ...attributes.interfaceIps };
					if (Array.isArray(attributes.routes))
						node.routes = [...attributes.routes];
					if (typeof attributes.proxyArp === "boolean")
						node.proxy_arp = attributes.proxyArp;
					if (typeof attributes.ipForward === "boolean")
						node.ip_forward = attributes.ipForward;
				}
				const { name, x, y, ...rest } = node;
				return send(200, {
					node: {
						id: targetId,
						type: { hosts: "host", switches: "switch", routers: "router", nats: "nat", controllers: "controller" }[bucket],
						name: name ?? targetId,
						x: x ?? 0,
						y: y ?? 0,
						attributes: rest
					},
					applied: keys.length ? mininetRun.started : true
				});
			}

			// 统一链路 PATCH：`{ options }`（空对象是合法请求 = 清台账）
			if (kind === "links" && targetId && req.method === "PATCH") {
				// 链路 id 是上游 `src--dst`（两个端点，别按三段切）
				const [source, target] = targetId.split("--");
				const link = mininetState.links.find((entry) =>
					(entry.from === source && entry.to === target) || (entry.from === target && entry.to === source));
				if (!link)
					return send(404, { detail: `link ${targetId} not found` });
				if (!body || typeof body !== "object" || !("options" in body))
					return send(400, { detail: "link patch needs 'options'" });
				const options = body.options ?? {};
				const allowed = new Set(["bw", "delay", "jitter", "loss"]);
				const unknown = Object.keys(options).find((key) => !allowed.has(key));
				if (unknown)
					return send(400, { detail: `unknown link option ${unknown}` });
				mininetLinkAttrs[`${link.from}|${link.to}`] = { ...options };
				return send(200, {
					link: { id: targetId, src: link.from, dst: link.to, options: { ...options } },
					applied: Object.keys(options).length ? mininetRun.started : true
				});
			}

			return send(405, { detail: "method not allowed" });
		}

		if (url.pathname.startsWith("/api/mininet/")) {
			const rest = url.pathname.slice("/api/mininet/".length);
			const segments = rest.split("/").filter(Boolean).map((part) => decodeURIComponent(part));

			// ── 写：先记账再落表，自检读的是「页面发了什么」 ──
			if (req.method !== "GET") {
				const raw = await readRawBody(req);
				const body = (() => {
					try {
						return raw ? JSON.parse(raw) : undefined;
					} catch {
						return undefined;
					}
				})();
				mininetLog.push({ method: req.method, path: url.pathname, body, raw, contentType: req.headers["content-type"] });

				const collection = segments[0];

				// 导入（NMCPS-ADR-0022 W4）：真实上游只收 multipart 的 `file` 字段，
				// 照 JSON 转发会 422 —— 自检据此断言 BFF 出站的是不是文件。
				if (collection === "import_json") {
					if (!String(req.headers["content-type"] ?? "").startsWith("multipart/form-data"))
						return send(422, { detail: [{ loc: ["body", "file"], msg: "field required" }] });

					const fileText = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
					const incoming = JSON.parse(fileText);
					for (const host of incoming.hosts ?? [])
						mininetState.hosts[host.name ?? host.id] = { name: host.name ?? host.id, ip: host.ip ?? "", mac: "00:00:00:00:00:99", x: host.x ?? 420, y: host.y ?? 60 };
					for (const sw of incoming.switches ?? [])
						mininetState.switches[sw.name ?? sw.id] = { name: sw.name ?? sw.id, x: sw.x ?? 420, y: sw.y ?? 140, ports: sw.ports ?? 4, of_version: null };
					return send(200, { message: "Topology successfully imported" });
				}

				// 运行控制（ADR-0022 W3）：四个动作都真改状态 / 真回文本，
				// 页面「启动 → 停止 → 探测 → 测速」的每一步都要能读回证据。
				if (collection === "start") {
					if (mininetRun.started)
						return send(400, { detail: "network already started" });
					mininetRun.started = true;
					return send(200, { status: "ok" });
				}

				if (collection === "stop") {
					mininetRun.started = false;
					return send(200, { status: "ok" });
				}

				if (collection === "pingall") {
					if (!mininetRun.started)
						return send(400, { detail: "network must be started to run pingall" });
					return send(200, mininetPingOutput.join("\n"));
				}

				if (collection === "iperf") {
					if (!mininetRun.started)
						return send(400, { detail: "network must be started to run iperf" });
					if (!body?.client || !body?.server)
						return send(422, { detail: "client and server are required" });
					if (body.client === body.server)
						return send(400, { detail: "client and server must be different hosts" });
					return send(200, {
						client: `${String(body.l4_type ?? "TCP")} ${body.client} -> ${body.server} ${body.seconds ?? 5}s: 1.02 Gbits/sec`,
						server: `${String(body.l4_type ?? "TCP")} ${body.server}: done`
					});
				}

				// 抓包启停（ADR-0022 W5）：形状与真实后端一致，都回 `{ active }`；
				// 上游对**未启动**的网络回 400，页面据此把「开始」禁用掉。
				if (collection === "sniffer" && segments[1] === "start") {
					if (!mininetRun.started)
						return send(400, { detail: "network must be started to begin sniffing" });
					mininetSniffer.active = true;
					return send(200, { active: mininetSniffer.active });
				}

				if (collection === "sniffer" && segments[1] === "stop") {
					mininetSniffer.active = false;
					return send(200, { active: mininetSniffer.active });
				}

				// 整表重建（W5）：清空五类节点与链路，页面重读 `GET /hosts` 必须看见空网
				if (collection === "full_reset") {
					mininetState.hosts = {};
					mininetState.switches = {};
					mininetState.routers = {};
					mininetState.nats = {};
					mininetState.controllers = {};
					mininetState.links = [];
					mininetRun.started = false;
					mininetSniffer.active = false;
					for (const key of Object.keys(mininetLinkAttrs))
						delete mininetLinkAttrs[key];
					return send(200, { status: "ok" });
				}

				// SNMP 凭据（NMCPS-ADR-0028 §7）：三条写的成败与真实上游同口径 ——
				// 已开通再开通 409、未开通轮换 / 吊销 404，页面据此区分「按钮点错」与「网挂错」。
				if (collection === "snmp" && segments[1] === "onboard") {
					if (mininetSnmp.onboarded)
						return send(409, { detail: "snmp_credentials_exist" });
					return send(200, mininetSnmpOnboard());
				}

				if (collection === "snmp" && segments[1] === "rotate") {
					if (!mininetSnmp.onboarded)
						return send(404, { detail: "snmp_credentials_missing" });
					return send(200, mininetSnmpOnboard());
				}

				if (req.method === "DELETE" && collection === "snmp" && segments[1] === "credentials") {
					if (!mininetSnmp.onboarded)
						return send(404, { detail: "snmp_credentials_missing" });
					mininetSnmp.onboarded = false;
					mininetSnmp.community = null;
					mininetSnmp.createdAt = null;
					mininetSnmp.rotatedAt = null;
					return send(200, { ...mininetSnmpStateOf(), applied: true });
				}

				// 流表（ADR-0022 W2b）：三条写都真改表 —— 页面写完重读 `GET /flows/{sw}`
				// 必须看得见变化，否则「加流成功」就成了空口断言。
				if (collection === "flows") {
					const switchId = segments[1] ?? body?.switch;
					if (!Object.hasOwn(mininetFlows, switchId))
						return send(404, { detail: `Switch ${switchId} not found` });

					if (req.method === "POST" && segments.length === 1) {
						if (!String(body?.actions ?? "").trim())
							return send(422, { detail: "actions is required" });
						const line = mininetFlowLineOf(body);
						mininetFlows[switchId].push(line);
						return send(200, { status: "ok", flow: line });
					}

					// 单条删除：`flow_id` 是 1 基序号（上游 `delete_flow_by_id()` 的 dump 行序）
					if (req.method === "DELETE" && segments.length === 3) {
						const index = Number(segments[2]) - 1;
						if (!Number.isInteger(index) || index < 0 || index >= mininetFlows[switchId].length)
							return send(404, { detail: "flow_id not found" });
						mininetFlows[switchId].splice(index, 1);
						return send(200, { status: "ok" });
					}

					// 批量删除：带 `match` 只删命中的行，不带就是清空（上游 `del-flows` 语义）
					if (req.method === "DELETE" && segments.length === 1) {
						const match = typeof body?.match === "string" ? body.match.trim() : "";
						mininetFlows[switchId] = match
							? mininetFlows[switchId].filter((line) => !line.includes(match))
							: [];
						return send(200, { status: "ok", match: match || "all" });
					}

					return send(405, { detail: "method not allowed" });
				}

				if (req.method === "POST" && segments.length === 1 && collection !== "links" && Object.hasOwn(mininetState, collection)) {
					const id = body?.name ?? body?.id;
					if (!id)
						return send(422, { detail: "name is required" });
					mininetState[collection][id] = { ...body };
					return send(200, { status: "ok" });
				}

				if (req.method === "POST" && collection === "links") {
					const source = Array.isArray(body) ? body[0] : body?.src;
					const target = Array.isArray(body) ? body[1] : body?.dst;
					if (!source || !target)
						return send(400, { detail: "node not in net" });
					mininetState.links.push({ from: source, to: target });
					return send(200, { status: "ok" });
				}

				if (req.method === "POST" && collection === "node_position") {
					const bucket = mininetBucketOf(body?.node_id);
					const [x, y] = Array.isArray(body?.position) ? body.position : [];
					if (!bucket || typeof x !== "number" || typeof y !== "number")
						return send(404, { detail: `Node ${body?.node_id} not found` });
					mininetState[bucket][body.node_id].x = x;
					mininetState[bucket][body.node_id].y = y;
					return send(200, { message: `Node ${body.node_id} updated successfully` });
				}

				if (req.method === "PUT" && collection === "switches" && segments[2] === "openflow") {
					const node = mininetState.switches[segments[1]];
					if (!node)
						return send(404, { detail: "switch not found" });
					node.of_version = body?.of_version === "auto" || body?.of_version === "" ? null : body?.of_version ?? null;
					return send(200, { switch: node });
				}

				if (req.method === "DELETE" && collection === "delete_node") {
					const bucket = mininetBucketOf(segments[1]);
					if (!bucket)
						return send(404, { detail: `Node ${segments[1]} not found` });
					delete mininetState[bucket][segments[1]];
					mininetState.links = mininetState.links.filter((link) => link.from !== segments[1] && link.to !== segments[1]);
					return send(200, { message: `Node ${segments[1]} deleted successfully` });
				}

				if (req.method === "PATCH" && collection === "links" && segments.length === 4 && segments[3] === "state") {
					const source = segments[1];
					const target = segments[2];
					if (!mininetRun.started)
						return send(400, { detail: "network must be started" });
					const exists = mininetState.links.some((link) =>
						(link.from === source && link.to === target) || (link.from === target && link.to === source));
					if (!exists)
						return send(404, { detail: "link not found" });
					const current = mininetLinkState[`${source}|${target}`] ?? mininetLinkState[`${target}|${source}`] ?? "up";
					const requested = body?.state;
					const next = requested === "toggle" ? (current === "up" ? "down" : "up") : requested;
					if (next !== "up" && next !== "down")
						return send(422, { detail: "state must be one of up / down / toggle" });
					mininetLinkState[`${source}|${target}`] = next;
					mininetLinkState[`${target}|${source}`] = next;
					return send(200, { from: source, to: target, status: next });
				}

				if (req.method === "DELETE" && collection === "delete_link") {
					const before = mininetState.links.length;
					mininetState.links = mininetState.links.filter((link) =>
						!((link.from === segments[1] && link.to === segments[2]) || (link.from === segments[2] && link.to === segments[1])));
					if (mininetState.links.length === before)
						return send(404, { detail: "Node not found" });
					delete mininetLinkAttrs[`${segments[1]}|${segments[2]}`];
					delete mininetLinkAttrs[`${segments[2]}|${segments[1]}`];
					return send(200, { message: "deleted successfully" });
				}

				// 详情弹窗的写（ADR-0022 W13）：PATCH 主机 / 路由器、PUT 链路属性
				if (req.method === "PATCH" && collection === "hosts" && segments.length === 2) {
					const node = mininetState.hosts[segments[1]];
					if (!node)
						return send(404, { detail: `Node ${segments[1]} not found` });
					if (typeof body?.ip === "string" && body.ip.trim())
						node.ip = body.ip.trim();
					return send(200, { status: "ok", host: node });
				}

				if (req.method === "PATCH" && collection === "routers" && segments.length === 2) {
					const node = mininetState.routers[segments[1]];
					if (!node)
						return send(404, { detail: `Router ${segments[1]} not found` });
					if (typeof body?.ip === "string" && body.ip.trim())
						node.ip = body.ip.trim();
					if (Array.isArray(body?.routes))
						node.routes = [...body.routes];
					if (body?.interface_ips && typeof body.interface_ips === "object")
						node.interface_ips = { ...body.interface_ips };
					if (typeof body?.proxy_arp === "boolean")
						node.proxy_arp = body.proxy_arp;
					if (typeof body?.ip_forward === "boolean")
						node.ip_forward = body.ip_forward;
					return send(200, { router: node });
				}

				if (req.method === "PUT" && collection === "links") {
					const source = body?.src;
					const target = body?.dst;
					if (!source || !target)
						return send(422, { detail: "src and dst are required" });
					const exists = mininetState.links.some((link) =>
						(link.from === source && link.to === target) || (link.from === target && link.to === source));
					if (!exists)
						return send(404, { detail: "link not found" });
					mininetLinkAttrs[`${source}|${target}`] = { ...(body.options ?? {}) };
					return send(200, { from: source, to: target, options: mininetLinkAttrs[`${source}|${target}`] });
				}

				return send(200, { status: "ok" });
			}

			// ── 读：五类节点回对象字典、链路回数组、流表回 `ovs-ofctl` 原文 ──
			if (req.method === "GET")
				mininetReadLog.push({ method: req.method, path: url.pathname, search: url.search });
			// 导出（NMCPS-ADR-0022 W4）：真实上游回 `PlainTextResponse`，不是 JSON
			if (segments.length === 1 && segments[0] === "export_json")
				return sendText(200, JSON.stringify({ hosts: mininetState.hosts, switches: mininetState.switches, links: mininetState.links }, null, 4));
			if (segments.length === 1 && segments[0] === "export_script")
				return sendText(200, "from mininet.topo import Topo\n\ntopo = Topo()\n");
			// 统一节点读（M1.1）：五类分表的投影，形状与上游 `GET /api/mininet/nodes` 一致 ——
			// `id/type/name/x/y` 在顶层，其余键进 `attributes`（见 `engines/wired.py` 的
			// `unified_nodes()`）。页面拓扑现在只打这一条，不再并发拉五张分表。
			if (segments.length === 1 && segments[0] === "nodes") {
				const unifiedNodes = [];
				const unifiedBuckets = [["hosts", "host"], ["switches", "switch"], ["routers", "router"], ["nats", "nat"], ["controllers", "controller"]];
				for (const [bucket, type] of unifiedBuckets) {
					for (const [id, node] of Object.entries(mininetState[bucket])) {
						const { name, x, y, ...attributes } = node;
						unifiedNodes.push({ id, type, name: name ?? id, x: x ?? 0, y: y ?? 0, attributes });
					}
				}
				return send(200, unifiedNodes);
			}
			// 运行态（ADR-0022 W3）：上游 `GET /api/mininet/start` 回的就是裸布尔
			if (segments.length === 1 && segments[0] === "start")
				return send(200, mininetRun.started);
			// 抓包读数与下载（ADR-0022 W5）：导出是 pcap 二进制，不能走 `send()`（会 JSON 化）
			if (segments[0] === "sniffer" && segments[1] === "state")
				return send(200, { active: mininetSniffer.active });
			if (segments[0] === "sniffer" && segments[1] === "history")
				return send(200, { events: mininetSniffer.history });
			if (segments[0] === "sniffer" && segments[1] === "export") {
				res.writeHead(200, {
					"content-type": "application/vnd.tcpdump.pcap",
					"content-disposition": "attachment; filename=sniffer.pcap"
				});
				return res.end(mininetSniffer.pcap);
			}
			// SNMP 读数（NMCPS-ADR-0028 §7）：`community` 只回部署默认串，
			// 已开通时恒 `null` —— 页面若试图从 state 里取密文，这里会立刻暴露。
			if (segments[0] === "snmp" && segments[1] === "state")
				return send(200, mininetSnmpStateOf());
			// 地址规划（ADR-0022 W9）：真实上游在**未启动**时回 400（`network must be started`），
			// 正文是 `{ generated_at, nodes: [{ id, type, intfs: [{ name, mac, ipv4, ipv6 }] }] }`。
			// 形状照抄上游：页面把它原样落成 JSON 下载，这里少一个字段，「正文即上游原文」
			// 就成了一句空话。
			if (segments.length === 1 && segments[0] === "addressing_plan") {
				if (!mininetRun.started)
					return send(400, { detail: "network must be started" });
				const planNodes = [];
				const planBuckets = [["hosts", "host"], ["switches", "switch"], ["routers", "router"], ["nats", "nat"], ["controllers", "controller"]];
				for (const [bucket, type] of planBuckets) {
					for (const id of Object.keys(mininetState[bucket])) {
						planNodes.push({
							id,
							type,
							intfs: [{
								name: `${id}-eth0`,
								mac: "00:00:00:00:00:0a",
								ipv4: [`10.0.0.${planNodes.length + 1}/8`],
								ipv6: []
							}]
						});
					}
				}
				return send(200, { generated_at: "2026-11-20T00:00:00Z", nodes: planNodes });
			}
			// 接口清单（ADR-0022 D6 监控通道）：与上游同形状 `{ nodes: [{ id, type, intfs, pid }] }`，
			// 从当前台账派生 —— `full_reset` 之后这里必须也空掉，页面才不会有可点的旧接口。
			if (segments.length === 1 && segments[0] === "interfaces") {
				const rows = [];
				const buckets = [["hosts", "host"], ["switches", "switch"], ["routers", "router"], ["nats", "nat"]];
				for (const [bucket, type] of buckets) {
					for (const id of Object.keys(mininetState[bucket]))
						rows.push({ id, type, intfs: [`${id}-eth0`], pid: 1000 + rows.length });
				}
				return send(200, { nodes: rows });
			}
			// 节点详情（ADR-0022 W13）：与上游同形状 —— 台账字段 + 主机 / 路由器的运行态读数。
			// 交换机那一支真实上游要 `dpctl`，这里不伪造：页面只把 `stats` 当可选读数。
			if (segments[0] === "stats" && segments.length === 2) {
				const id = segments[1];
				const bucket = mininetBucketOf(id);
				if (!bucket)
					return send(404, { detail: `Node ${id} not found` });
				const typeOfBucket = { hosts: "host", switches: "sw", routers: "router", nats: "nat", controllers: "controller" };
				const payload = { ...mininetState[bucket][id], type: typeOfBucket[bucket] };
				if (bucket === "hosts" || bucket === "routers") {
					payload.default_route = `default via 10.0.0.254 dev ${id}-eth0`;
					payload.interfaces = [`${id}-eth0`];
					payload.arp_table = [{ ip: "10.0.0.254", mac: "00:00:00:00:00:fe", interface: `${id}-eth0` }];
				}
				return send(200, payload);
			}

			// 链路读数（ADR-0022 W13）：`intfs[].tx_bytes / rx_bytes` + 已落表的 `options`
			if (segments[0] === "links" && segments[1] === "stats" && segments.length === 4) {
				const [, , src, dst] = segments;
				const exists = mininetState.links.some((link) =>
					(link.from === src && link.to === dst) || (link.from === dst && link.to === src));
				if (!exists)
					return send(404, { detail: "link not found" });
				return send(200, {
					from: src,
					to: dst,
					intfs: [
						{ name: `${src}-eth0`, tx_bytes: 1024, rx_bytes: 2048 },
						{ name: `${dst}-eth0`, tx_bytes: 2048, rx_bytes: 1024 }
					],
					options: mininetLinkAttrs[`${src}|${dst}`] ?? mininetLinkAttrs[`${dst}|${src}`] ?? {},
					timestamp: "2026-11-19T00:00:00Z"
				});
			}

			// 链路清单带上 `options`：详情弹窗在「没改过」时也读得到台账里的属性；
			// `status` 是 M1.2 的运行态读数（未启动恒 `unknown`），页面邻接与链路动作都读它。
			if (segments.length === 1 && segments[0] === "links") {
				return send(200, mininetState.links.map((link) => ({
					...link,
					status: mininetLinkStatusOf(link),
					options: mininetLinkAttrs[`${link.from}|${link.to}`] ?? mininetLinkAttrs[`${link.to}|${link.from}`] ?? {},
					intfs: { from: `${link.from}-eth0`, to: `${link.to}-eth0` }
				})));
			}
			if (segments.length === 1 && Object.hasOwn(mininetState, segments[0])) {
				const value = mininetState[segments[0]];
				return send(200, Array.isArray(value) ? value : { ...value });
			}
			if (segments[0] === "flows" && segments.length === 2) {
				if (!Object.hasOwn(mininetFlows, segments[1]))
					return send(404, { detail: `Switch ${segments[1]} not found` });
				return send(200, { switch: segments[1], flows: mininetFlows[segments[1]].join("\n") });
			}
		}

		if (url.pathname === "/device/ok")
			return send(200, { id: "dev-1", name: "ok" });
		if (url.pathname === "/device/envelope")
			return send(200, { code: 0, status: "success", message: "success", data: { ok: true } });
		if (url.pathname === "/device/error")
			return send(400, { message: "device_not_found" });
		if (url.pathname === "/device/slow") {
			await delay(3_000);
			return send(200, { id: "slow" });
		}
		if (url.pathname === "/device/echo") {
			return send(200, {
				authorization: req.headers.authorization ?? null,
				evil: req.headers["x-evil"] ?? null,
				tenant: req.headers["x-tenant-id"] ?? null
			});
		}
		if (url.pathname === "/device/stream") {
			// 三个事件、间隔 150ms：用于验证网关是否边收边发（整体缓冲会只收到一块）
			res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" });
			for (let i = 0; i < 3; i++) {
				res.write(`data: tick-${i}\n\n`);
				await delay(150);
			}
			res.end();
			return;
		}

		// ── /audit*：审计域三族（`/system/log`；网关透传路径可能带 `/api/v1` 前缀） ──
		const auditPath = url.pathname.match(/^\/(?:api\/v1\/)?audit(\/.*)?$/);
		if (auditPath) {
			const rest = auditPath[1] ?? "";
			const query = (key) => (url.searchParams.get(key) ?? "").trim();

			// 操作日志：字符串筛选 + epoch 毫秒时间窗
			if (rest === "/operation-logs" && req.method === "GET") {
				const filtered = auditOperationLogs.filter((item) =>
					matchesText(item.username, query("username"))
					&& matchesText(item.module, query("module"))
					&& matchesText(item.status, query("status"))
					&& (!query("keyword") || item.operation.includes(query("keyword")) || item.username.includes(query("keyword")))
					&& inEpochWindow(item.created_at, query("created_from"), query("created_to")));
				auditLog.lastQuery = { kind: "operation", query: Object.fromEntries(url.searchParams) };
				return send(200, { code: 0, message: "success", data: iamPaged(filtered, url) });
			}

			// 安全日志：参数与操作日志不同源（`subject_*` / `auth_decision` / `logged_*`）
			if (rest === "/security-logs" && req.method === "GET") {
				const filtered = auditSecurityLogs.filter((item) =>
					matchesText(item.subject_name, query("subject_name"))
					&& matchesText(item.action, query("action"))
					&& matchesText(item.auth_decision, query("auth_decision"))
					&& matchesText(item.ip_address, query("ip_address"))
					&& inEpochWindow(item.logged_at, query("logged_from"), query("logged_to")));
				auditLog.lastQuery = { kind: "security", query: Object.fromEntries(url.searchParams) };
				return send(200, { code: 0, message: "success", data: iamPaged(filtered, url) });
			}

			// 归档记录：**没有时间条件**，只认 `table_name` / `status`
			if (rest === "/archive/records" && req.method === "GET") {
				const filtered = auditArchiveRecords.filter((item) =>
					matchesText(item.table_name, query("table_name"))
					&& matchesText(item.status, query("status")));
				auditLog.lastQuery = { kind: "archive", query: Object.fromEntries(url.searchParams) };
				return send(200, { code: 0, message: "success", data: iamPaged(filtered, url) });
			}

			// 归档（写操作）：实测回「表名 → 本批次行数」，并留下批次记录
			if (rest === "/archive/run" && req.method === "POST") {
				const body = await readJsonBody(req);
				const tableName = typeof body?.table_name === "string" ? body.table_name : "";
				const stamp = new Date().toISOString();
				const tables = tableName ? [tableName] : ["sys_operation_log", "sys_audit_log"];
				const result = {};

				for (const table of tables) {
					result[table] = 0;
					auditArchiveRecords.unshift({
						id: `arc-run-${auditArchiveRecords.length + 1}`,
						table_name: table,
						archive_batch: `arc-run-${auditArchiveRecords.length + 1}`,
						rows_archived: 0,
						cutoff_before: stamp,
						started_at: stamp,
						finished_at: stamp,
						status: "success",
						created_at: stamp
					});
				}

				return send(200, { code: 0, message: "success", data: result });
			}

			// 三族详情：不存在时与真实上游一致 —— **HTTP 200 + `code: 40401`**
			const detail = rest.match(/^\/(operation-logs|security-logs|archive\/records)\/([^/]+)$/);
			if (detail && req.method === "GET") {
				const [collection, rawId] = [detail[1], detail[2]];
				const id = decodeURIComponent(rawId);
				const source = collection === "operation-logs"
					? auditOperationLogs
					: collection === "security-logs" ? auditSecurityLogs : auditArchiveRecords;
				const record = source.find((item) => item.id === id);

				if (!record)
					return send(200, { code: 40401, message: "记录不存在" });

				return send(200, { code: 0, message: "success", data: record });
			}

			return send(404, { code: 10404, msg: "audit_path_not_found" });
		}

		return send(404, { message: "upstream_not_found" });
	});

	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, HOST, resolve);
	});

	server.authLog = authLog;
	server.control = control;
	server.mininetLog = mininetLog;
	server.mininetReadLog = mininetReadLog;
	server.mininetState = mininetState;
	server.mininetLinkAttrs = mininetLinkAttrs;
	server.mininetLinkState = mininetLinkState;
	server.mininetRun = mininetRun;
	server.mininetSniffer = mininetSniffer;
	server.mininetSnmp = mininetSnmp;
	// 抓包实时流（NMCPS-ADR-0022 D6）：连上就推 `MININET_SNIFFER_LIVE` 那两帧
	server.mininetSocketLog = attachSnifferSocket(server, { events: MININET_SNIFFER_LIVE });

	return server;
}
