// scripts/check-lab-ws.ts
// `/lab-ws/*` 纯函数自查（NMCPS-ADR-0022 D6 / W5）。
//
// 运行：pnpm check:lab-ws
// 只验证三份纯函数模块，不启动 Nitro、不访问上游、不开浏览器：
//   - `layers/scenario/shared/constants/labWs.ts`：通道登记表、`target` 形状、上游地址拼接；
//   - `layers/scenario/shared/types/labWs.ts`：票响应归一、监控帧归一、PTY 文本清洗；
//   - `layers/scenario/shared/types/labInterfaces.ts`：接口清单归一。
//
// 这些函数是「票怎么签 / 连到哪 / 面板怎么显示」的唯一判据：形状判错会让一张票指向
// 别的节点（`target` 绑定失效），清洗写错会让终端把 `^[[1;32m` 当提示符显示出来。
import assert from "node:assert/strict";
import process from "node:process";
import {
	LAB_WS_KINDS,
	LAB_WS_PATHS,
	LAB_WS_UPSTREAMS,
	labWsTargetError,
	labWsTargetParts,
	labWsTicketUrl,
	labWsUpstreamPath
} from "../layers/scenario/shared/constants/labWs.ts";
import { labInterfaceNodesOf } from "../layers/scenario/shared/types/labInterfaces.ts";
import {
	labMonitorFrameOf,
	labMonitorSampleOf,
	labTerminalTextOf,
	labWsTicketOf
} from "../layers/scenario/shared/types/labWs.ts";
import { LAB_PERMISSIONS, LAB_TENANT_ADMIN_PERMISSIONS, LAB_TENANT_DEFAULT_PERMISSIONS } from "../shared/constants/labPermissions.ts";

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

/** 控制字符用 `String.fromCharCode` 拼：源码里不留裸控制字符，也不会踩控制字符正则 */
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const BACKSPACE = String.fromCharCode(8);

console.log("`/lab-ws/*` 纯函数（NMCPS-ADR-0022 D6）\n");

check("登记表四条通道，`LAB_WS_PATHS` 与之逐键对齐（不多不少）", () => {
	assert.deepEqual([...LAB_WS_KINDS].sort(), ["logs", "monitor", "sniffer", "terminal"]);
	assert.deepEqual(Object.keys(LAB_WS_PATHS).sort(), [...LAB_WS_KINDS].sort());
	for (const kind of LAB_WS_KINDS)
		assert.equal(LAB_WS_PATHS[kind], `/lab-ws/${kind}`);
});

check("每个通道的权限位都来自权限矩阵（不写裸字符串）", () => {
	const known = new Set<string>(Object.values(LAB_PERMISSIONS));
	for (const kind of LAB_WS_KINDS) {
		const permission: string = LAB_WS_UPSTREAMS[kind].permission;
		assert.ok(known.has(permission), `${kind} → ${permission} 不在 LAB_PERMISSIONS 里`);
	}
});

check("终端 / 抓包权限不被默认角色隐式授予（租户用户与租户管理员都没有）", () => {
	for (const permission of [LAB_PERMISSIONS.TERMINAL, LAB_PERMISSIONS.SNIFFER]) {
		assert.ok(!LAB_TENANT_DEFAULT_PERMISSIONS.includes(permission), `${permission} 被租户默认角色带上`);
		assert.ok(!LAB_TENANT_ADMIN_PERMISSIONS.includes(permission), `${permission} 被 tenant_admin 带上`);
	}
});

check("只有终端有上行（`clientToUpstream`），其余三条纯下行", () => {
	for (const kind of LAB_WS_KINDS)
		assert.equal(LAB_WS_UPSTREAMS[kind].clientToUpstream, kind === "terminal", kind);
});

check("`targetKind` 与 `targetRequired` 自洽：`none` / `network` 不带目标，`node` / `node-intf` 必填", () => {
	for (const kind of LAB_WS_KINDS) {
		const { targetKind, targetRequired, clientToUpstream } = LAB_WS_UPSTREAMS[kind];
		assert.equal(targetRequired, targetKind === "node" || targetKind === "node-intf", `${kind} 的 targetRequired`);
		assert.equal(typeof clientToUpstream, "boolean", `${kind} 的 clientToUpstream`);
	}
	assert.equal(LAB_WS_UPSTREAMS.logs.targetKind, "none");
	assert.equal(LAB_WS_UPSTREAMS.sniffer.targetKind, "network");
	assert.equal(LAB_WS_UPSTREAMS.monitor.targetKind, "node-intf");
});

check("日志通道：带目标一律 `invalid`（上游按整台上游出日志，没有单目标）", () => {
	assert.equal(labWsTargetError("logs", ""), undefined);
	for (const target of ["net_a", "sw1", "sw1:sw1-eth0"])
		assert.equal(labWsTargetError("logs", target), "invalid", target);
});

check("抓包通道：空目标合法，非空时按网络 id 形状判", () => {
	assert.equal(labWsTargetError("sniffer", ""), undefined);
	assert.equal(labWsTargetError("sniffer", "net_a"), undefined);
	for (const target of ["net/a", "net a", "net|a", "net\\a"])
		assert.equal(labWsTargetError("sniffer", target), "invalid", JSON.stringify(target));
});

check("监控通道：必须 `<node>:<intf>` 两段，缺段 / 多段 / 空白都拒绝", () => {
	assert.equal(labWsTargetError("monitor", ""), "missing");
	assert.equal(labWsTargetError("monitor", "sw1:sw1-eth0"), undefined);
	for (const target of ["sw1", "sw1:", ":sw1-eth0", "sw1:sw1-eth0:0", "sw 1:sw1-eth0", "sw1:sw1 eth0"])
		assert.equal(labWsTargetError("monitor", target), "invalid", JSON.stringify(target));
});

check("`labWsTargetParts`：形状不合法时两段都为空（不半信半疑地取前半段）", () => {
	assert.deepEqual(labWsTargetParts("terminal", "sw1"), { node: "sw1", intf: "" });
	assert.deepEqual(labWsTargetParts("monitor", "sw1:sw1-eth0"), { node: "sw1", intf: "sw1-eth0" });
	assert.deepEqual(labWsTargetParts("monitor", "sw1"), { node: "", intf: "" });
	assert.deepEqual(labWsTargetParts("logs", ""), { node: "", intf: "" });
	assert.deepEqual(labWsTargetParts("sniffer", "net_a"), { node: "", intf: "" });
});

check("上游地址：终端拼路径段并编码，监控拼查询串，日志 / 抓包不带参数", () => {
	assert.equal(labWsUpstreamPath("terminal", "sw1"), "/api/mininet/terminal/sw1");
	assert.equal(labWsUpstreamPath("terminal", "h%1"), "/api/mininet/terminal/h%251");
	assert.equal(labWsUpstreamPath("monitor", "sw1:sw1-eth0"), "/api/mininet/monitor?node=sw1&intf=sw1-eth0");
	assert.equal(labWsUpstreamPath("logs", ""), "/api/mininet/logs");
	assert.equal(labWsUpstreamPath("sniffer", ""), "/api/mininet/sniffer");
});

check("票的同源 url：无目标不带 `target`，有目标必须带上（升级钩子要逐字比对）", () => {
	assert.equal(labWsTicketUrl("terminal", "tk"), "/lab-ws/terminal?ticket=tk");
	assert.equal(
		labWsTicketUrl("monitor", "tk", "sw1:sw1-eth0"),
		"/lab-ws/monitor?ticket=tk&target=sw1%3Asw1-eth0"
	);
	assert.ok(!labWsTicketUrl("terminal", "tk").includes("target="));
});

check("票响应归一：缺 `ticket` / `url` / `kind` 一律无效，`expiresAt` 缺省为空串", () => {
	assert.deepEqual(
		labWsTicketOf({ ticket: "tk", url: "/lab-ws/logs?ticket=tk", kind: "logs", expiresAt: "2026-11-17T10:00:00Z" }),
		{ ticket: "tk", url: "/lab-ws/logs?ticket=tk", kind: "logs", expiresAt: "2026-11-17T10:00:00Z" }
	);
	assert.deepEqual(
		labWsTicketOf({ ticket: "tk", url: "/lab-ws/logs?ticket=tk", kind: "logs" }),
		{ ticket: "tk", url: "/lab-ws/logs?ticket=tk", kind: "logs", expiresAt: "" }
	);
	for (const payload of [
		undefined,
		null,
		[],
		"tk",
		{ url: "/lab-ws/logs", kind: "logs" },
		{ ticket: "tk", kind: "logs" },
		{ ticket: "tk", url: "/lab-ws/logs" },
		{ ticket: "  ", url: "/lab-ws/logs", kind: "logs" }
	])
		assert.equal(labWsTicketOf(payload), undefined, JSON.stringify(payload));
});

check("监控采样：字符串数字也收（上游 JSON 里两种都有），两档速率都读不到就判无效", () => {
	assert.deepEqual(
		labMonitorSampleOf({ node: "h1", intf: "h1-eth0", ts: "2026-11-17T10:00:02Z", tx_gbps: 0.125, rx_gbps: "0.25" }),
		{ node: "h1", intf: "h1-eth0", ts: "2026-11-17T10:00:02Z", txGbps: 0.125, rxGbps: 0.25 }
	);
	assert.deepEqual(
		labMonitorSampleOf({ node: "h1", intf: "h1-eth0", tx_gbps: 1 }),
		{ node: "h1", intf: "h1-eth0", ts: "", txGbps: 1, rxGbps: null }
	);
	for (const payload of [
		{ intf: "h1-eth0", tx_gbps: 1 },
		{ node: "h1", tx_gbps: 1 },
		{ node: "h1", intf: "h1-eth0" },
		{ node: "h1", intf: "h1-eth0", tx_gbps: "n/a", rx_gbps: null },
		{ node: "h1", intf: "h1-eth0", tx_gbps: null, rx_gbps: "" },
		{ node: "h1", intf: "h1-eth0", tx_gbps: true, rx_gbps: [] },
		null
	])
		assert.equal(labMonitorSampleOf(payload), undefined, JSON.stringify(payload));
});

check("监控采样：一侧缺失不进 0（`null` / 空串不是「没有流量」，是不认识）", () => {
	assert.deepEqual(
		labMonitorSampleOf({ node: "h1", intf: "h1-eth0", tx_gbps: 0, rx_gbps: null }),
		{ node: "h1", intf: "h1-eth0", ts: "", txGbps: 0, rxGbps: null }
	);
	assert.deepEqual(
		labMonitorSampleOf({ node: "h1", intf: "h1-eth0", tx_gbps: undefined, rx_gbps: "0.5" }),
		{ node: "h1", intf: "h1-eth0", ts: "", txGbps: null, rxGbps: 0.5 }
	);
});

check("监控帧：`Error: …` 判错误（不当「没数据」吞掉），坏 JSON 也判错误，空白帧丢弃", () => {
	assert.deepEqual(labMonitorFrameOf("Error: 网络未启动"), { error: "Error: 网络未启动" });
	assert.deepEqual(labMonitorFrameOf("  Error: iface missing  "), { error: "Error: iface missing" });
	assert.deepEqual(labMonitorFrameOf("not json"), { error: "not json" });
	const missingIntf = JSON.stringify({ node: "h1" });
	assert.deepEqual(labMonitorFrameOf(missingIntf), { error: missingIntf });
	assert.equal(labMonitorFrameOf(""), undefined);
	assert.equal(labMonitorFrameOf("   "), undefined);
	assert.deepEqual(
		labMonitorFrameOf(JSON.stringify({ node: "h1", intf: "h1-eth0", tx_gbps: 0.5, rx_gbps: 0.25 })),
		{ sample: { node: "h1", intf: "h1-eth0", ts: "", txGbps: 0.5, rxGbps: 0.25 } }
	);
});

check("接口清单归一：剔除无 id 的条目、接口去空白，非数组一律空", () => {
	assert.deepEqual(
		labInterfaceNodesOf({ nodes: [
			{ id: "h1", type: "host", intfs: [" h1-eth0 ", ""] },
			{ type: "host", intfs: ["h2-eth0"] },
			"junk",
			{ id: "sw1", intfs: "sw1-eth0" }
		] }),
		[
			{ id: "h1", type: "host", intfs: ["h1-eth0"] },
			{ id: "sw1", type: "host", intfs: [] }
		]
	);
	for (const payload of [undefined, null, [], { nodes: {} }, { nodes: "h1" }, "h1"])
		assert.deepEqual(labInterfaceNodesOf(payload), [], JSON.stringify(payload));
});

check("终端通道：缺目标 `missing`，节点 id 不许带 `:`、`/`、`|`、空白", () => {
	assert.equal(labWsTargetError("terminal", ""), "missing");
	assert.equal(labWsTargetError("terminal", "sw1"), undefined);
	assert.equal(labWsTargetError("terminal", "h2-eth0"), undefined);
	for (const target of ["sw1:sw1-eth0", "sw/1", "sw\\1", "sw|1", "sw 1", " sw1"])
		assert.equal(labWsTargetError("terminal", target), "invalid", JSON.stringify(target));
});

check("PTY 清洗：剥 CSI 颜色码与 OSC 标题，正文一个字不丢", () => {
	assert.equal(labTerminalTextOf(`${ESC}[1;32mroot@h1:/#${ESC}[0m `), "root@h1:/# ");
	assert.equal(labTerminalTextOf(`${ESC}[0;31mERROR${ESC}[0m disk full`), "ERROR disk full");
	assert.equal(labTerminalTextOf(`${ESC}]0;window title${BEL}ls -l`), "ls -l");
	assert.equal(labTerminalTextOf(`${ESC}]2;title${ESC}\\ping`), "ping");
	assert.equal(labTerminalTextOf(`${ESC}[2K${ESC}[Hclean`), "clean");
});

check("PTY 清洗：行内 `\\r` 覆盖取最后一段，`\\r\\n` 仍是换行", () => {
	assert.equal(labTerminalTextOf("10%\r50%\rdone"), "done");
	assert.equal(labTerminalTextOf("a\r\nb\r\n"), "a\nb\n");
	assert.equal(labTerminalTextOf("a\rb"), "b");
	assert.equal(labTerminalTextOf("no carriage return"), "no carriage return");
});

check("PTY 清洗：退格删前一个字符，行首退格直接丢掉", () => {
	assert.equal(labTerminalTextOf(`abc${BACKSPACE}d`), "abd");
	assert.equal(labTerminalTextOf(`${BACKSPACE}x`), "x");
	assert.equal(labTerminalTextOf(`one\n${BACKSPACE}two`), "one\ntwo");
	assert.equal(labTerminalTextOf(`abc${BACKSPACE}${BACKSPACE}`), "a");
});

check("PTY 清洗：空串 / 纯转义不造出内容，中文与 emoji 原样保留", () => {
	assert.equal(labTerminalTextOf(""), "");
	assert.equal(labTerminalTextOf(`${ESC}[0m`), "");
	assert.equal(labTerminalTextOf("连接失败 🚫"), "连接失败 🚫");
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exitCode = fail > 0 ? 1 : 0;
