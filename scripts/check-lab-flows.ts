// scripts/check-lab-flows.ts
// 流表编辑纯函数自查（NMCPS-ADR-0022 W2b）。
//
// 运行：pnpm check:lab-flows
// 只验证 `layers/scenario/shared/types/labFlows.ts`：草稿校验、草稿 → 上游请求体、
// `dump-flows` 原文 → 行号。不启动 Nitro、不访问上游、不开浏览器。
//
// 行号口径对齐 `services/mininet-api/mininet_gui_backend/api.py::delete_flow_by_id()`：
// 它取 `[line for line in stdout.splitlines() if "actions=" in line]` 的 `flow_id - 1`，
// 即「含 `actions=` 的行」的 1 基序号 —— 页面数错一位就删掉另一条流。
import type { LabFlowDraft } from "../layers/scenario/shared/types/labFlows.ts";
import assert from "node:assert/strict";
import process from "node:process";
import {
	LAB_FLOW_PRIORITY_MAX,
	labFlowActionsOf,
	labFlowDraftError,
	labFlowDraftOf,
	labFlowPayloadOf,
	labFlowRowsOf
} from "../layers/scenario/shared/types/labFlows.ts";

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

/** 草稿构造：默认空草稿，按需覆盖 */
function draftOf(partial: Partial<LabFlowDraft> = {}): LabFlowDraft {
	return { ...labFlowDraftOf(), ...partial };
}

/**
 * `UInput type="number"` 在运行时交回的是 **number**，而 `LabFlowDraft.priority` 声明为
 * `string` —— 这里故意越过类型复现那条真实路径（它曾让 `priority.trim()` 抛 TypeError，
 * 点击后静默不写；check:ui 11.4 抓到的正是这一处）。
 */
function numberPriority(priority: number): LabFlowDraft {
	return { ...labFlowDraftOf(), actions: "output:2", priority: priority as unknown as string };
}

/** 一条 `ovs-ofctl` dump 行（字段顺序与上游 `build_flow()` 一致） */
function flowLine(priority: number, match: string, actions: string): string {
	const tail = match ? `,${match}` : "";
	return `cookie=0x0, duration=1.2s, table=0, n_packets=0, n_bytes=0, priority=${priority}${tail} actions=${actions}`;
}

console.log("流表编辑纯函数（NMCPS-ADR-0022 W2b）\n");

check("labFlowDraftOf 每次返回一份新的空草稿", () => {
	const first = labFlowDraftOf();
	const second = labFlowDraftOf();
	assert.deepEqual(first, { match: "", actions: "", priority: "" });
	assert.notEqual(first, second, "两次调用共用了同一个对象");
});

check("labFlowActionsOf：去空白、剥 `actions=` 前缀（大小写不敏感），空串归一为空", () => {
	assert.equal(labFlowActionsOf("  output:2  "), "output:2");
	assert.equal(labFlowActionsOf("actions=output:2"), "output:2");
	assert.equal(labFlowActionsOf("ACTIONS= drop"), "drop");
	assert.equal(labFlowActionsOf("Actions="), "");
	assert.equal(labFlowActionsOf("   "), "");
});

check("动作必填：空串 / 纯空白 / 只写 `actions=` 都算没填", () => {
	for (const actions of ["", "   ", "actions=", "ACTIONS=  "]) {
		assert.equal(
			labFlowDraftError(draftOf({ actions, match: "ip,nw_dst=10.0.0.9" })),
			"actionsRequired",
			`actions=${JSON.stringify(actions)}`
		);
	}
});

check("匹配域不许夹带 `actions=`（大小写不敏感，含整段粘贴）", () => {
	for (const match of ["actions=output:1", "Actions=drop", "ip,nw_dst=1.1.1.1 actions=output:2"]) {
		assert.equal(
			labFlowDraftError(draftOf({ match, actions: "output:2" })),
			"matchInvalid",
			`match=${JSON.stringify(match)}`
		);
	}
});

check("优先级 0 / 65535 放行（字符串与运行时 number 两种形态）", () => {
	assert.equal(labFlowDraftError(draftOf({ actions: "output:2", priority: "0" })), undefined);
	assert.equal(labFlowDraftError(draftOf({ actions: "output:2", priority: "65535" })), undefined);
	assert.equal(labFlowDraftError(numberPriority(0)), undefined);
	assert.equal(labFlowDraftError(numberPriority(LAB_FLOW_PRIORITY_MAX)), undefined);
});

check("优先级越界 / 位数不对 / 非整数一律 priorityInvalid", () => {
	for (const priority of ["65536", "70000", "123456", "abc", "1.5", "-1", "+5", "0x10"]) {
		assert.equal(
			labFlowDraftError(draftOf({ actions: "output:2", priority })),
			"priorityInvalid",
			`priority=${JSON.stringify(priority)}`
		);
	}
	assert.equal(labFlowDraftError(numberPriority(70000)), "priorityInvalid");
});

check("优先级留空 = 交给上游默认，不拦截", () => {
	assert.equal(labFlowDraftError(draftOf({ actions: "output:2" })), undefined);
	assert.equal(labFlowDraftError(draftOf({ actions: "output:2", priority: "   " })), undefined);
});

check("完整合法草稿通过校验", () => {
	assert.equal(
		labFlowDraftError(draftOf({ match: "ip,nw_dst=10.0.0.9", actions: "output:2", priority: "10" })),
		undefined
	);
});

check("运行时 number 优先级不再抛 TypeError，请求体照常带 number", () => {
	assert.doesNotThrow(() => labFlowDraftError(numberPriority(10)));
	assert.deepEqual(
		labFlowPayloadOf("sw1", numberPriority(10)),
		{ switch: "sw1", actions: "output:2", priority: 10 }
	);
});

check("只填动作：请求体只带 switch + actions，match / priority 整个字段不发送", () => {
	assert.deepEqual(
		labFlowPayloadOf("sw1", draftOf({ actions: "output:2" })),
		{ switch: "sw1", actions: "output:2" }
	);
});

check("三字段齐全：match 去空白后原样透传，priority 转成 number", () => {
	assert.deepEqual(
		labFlowPayloadOf("sw1", draftOf({ match: " ip,nw_dst=10.0.0.9 ", actions: "output:2", priority: "10" })),
		{ switch: "sw1", actions: "output:2", match: "ip,nw_dst=10.0.0.9", priority: 10 }
	);
});

check("空白 match / 空白 priority 不发送（上游缺省走 None，不发空串）", () => {
	assert.deepEqual(
		labFlowPayloadOf("sw1", draftOf({ match: "   ", actions: "drop", priority: "  " })),
		{ switch: "sw1", actions: "drop" }
	);
});

check("`actions=` 前缀被剥掉；priority \"0\" 不会被当成空值丢掉", () => {
	assert.deepEqual(
		labFlowPayloadOf("sw1", draftOf({ actions: " Actions=output:1 ", priority: "0" })),
		{ switch: "sw1", actions: "output:1", priority: 0 }
	);
});

check("行号只发给含 `actions=` 的行，1 基递增，其余行原样保留且无 id", () => {
	const rows = labFlowRowsOf([
		flowLine(0, "", "CONTROLLER:65535"),
		"NXST_FLOW reply (xid=0x2):",
		flowLine(10, "ip,nw_dst=10.0.0.9", "output:2"),
		flowLine(20, "arp", "drop")
	].join("\n"));

	assert.equal(rows.length, 4);
	assert.deepEqual(rows.map((row) => row.id), [1, undefined, 2, 3]);
	assert.equal(rows[1]!.text, "NXST_FLOW reply (xid=0x2):");
	assert.equal(rows[3]!.text, flowLine(20, "arp", "drop"));
});

check("空行 / 行尾换行 / CRLF 不改变编号（与 splitlines 同口径）", () => {
	const dump = `\r\n${flowLine(0, "", "CONTROLLER:65535")}\r\n\r\n${flowLine(10, "arp", "drop")}\r\n`;
	const rows = labFlowRowsOf(dump);
	assert.deepEqual(rows.map((row) => row.id), [1, 2]);
	assert.equal(rows[0]!.text, flowLine(0, "", "CONTROLLER:65535"), "CRLF 的 \\r 没被裁掉");
});

check("空文本与纯空行 → 没有行（不造出可点的删除按钮）", () => {
	assert.deepEqual(labFlowRowsOf(""), []);
	assert.deepEqual(labFlowRowsOf("\n\n  \n"), []);
});

check("序号与上游 delete_flow_by_id() 同源：两流夹一条非流行 ⇒ id 1 / 2", () => {
	// 上游：lines = [l for l in dump.stdout.splitlines() if "actions=" in l]；再取 lines[flow_id - 1]
	const dump = [
		"OFPST_FLOW reply (xid=0x4):",
		flowLine(100, "ip,nw_dst=10.0.0.9", "output:2"),
		"No such flow",
		flowLine(0, "", "CONTROLLER:65535")
	].join("\n");
	const pageIds = labFlowRowsOf(dump).flatMap((row) => (row.id ? [row.id] : []));
	assert.deepEqual(pageIds, [1, 2]);
	assert.equal(labFlowRowsOf(dump).filter((row) => row.id).length, 2);
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exitCode = fail > 0 ? 1 : 0;
