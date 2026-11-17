// scripts/check-lab-run.ts
// 运行控制纯函数自查（NMCPS-ADR-0022 W3）。
//
// 运行：pnpm check:lab-run
// 只验证 `layers/scenario/shared/types/labRun.ts`：运行态读数归一、iperf 草稿校验、
// 草稿 → 上游请求体（`IperfRequest`）、`pingall` 文本化、iperf 结果文本化。
// 不启动 Nitro、不访问上游、不开浏览器。
//
// 与 `check:lab-flows` 同族：Lab 的本地纯函数自检，不进 `ci.yml`。
import type { LabIperfDraft } from "../layers/scenario/shared/types/labRun.ts";
import assert from "node:assert/strict";
import process from "node:process";
import {
	LAB_IPERF_L4_TYPES,
	LAB_IPERF_SECONDS_MAX,
	labIperfDraftError,
	labIperfDraftOf,
	labIperfPayloadOf,
	labIperfResultOf,
	labRunOutputOf,
	labRunStateOf
} from "../layers/scenario/shared/types/labRun.ts";

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
function draftOf(partial: Partial<LabIperfDraft> = {}): LabIperfDraft {
	return { ...labIperfDraftOf(), ...partial };
}

/**
 * `UInput type="number"` 在运行时交回的是 **number**，而 `LabIperfDraft.seconds` 声明为
 * `string` —— 故意越过类型复现真实路径（与 `LabFlowDraft.priority` 同一个坑）。
 */
function numericSeconds(seconds: number): LabIperfDraft {
	return { ...labIperfDraftOf(), client: "h1", server: "h2", seconds: seconds as unknown as string };
}

check("运行态读数只认布尔：true / false 原样，其余一律 null（未知）", () => {
	assert.equal(labRunStateOf(true), true);
	assert.equal(labRunStateOf(false), false);
	for (const payload of [null, undefined, "true", "false", 1, 0, {}, []])
		assert.equal(labRunStateOf(payload), null, `payload=${JSON.stringify(payload)}`);
});

check("iperf 草稿：两端都留空时先报客户端", () => {
	assert.equal(labIperfDraftError(draftOf()), "clientRequired");
	assert.equal(labIperfDraftError(draftOf({ client: "   " })), "clientRequired");
});

check("iperf 草稿：填了客户端没填服务端时报服务端", () => {
	assert.equal(labIperfDraftError(draftOf({ client: "h1" })), "serverRequired");
	assert.equal(labIperfDraftError(draftOf({ client: "h1", server: "  " })), "serverRequired");
});

check("iperf 草稿：两端相同被本地拦下（上游 `client == server` 回 400）", () => {
	assert.equal(labIperfDraftError(draftOf({ client: "h1", server: "h1" })), "sameEndpoint");
});

check("iperf 草稿：秒数留空合法（= 跟随上游默认 5 秒）", () => {
	assert.equal(labIperfDraftError(draftOf({ client: "h1", server: "h2" })), undefined);
	assert.equal(labIperfDraftError(draftOf({ client: "h1", server: "h2", seconds: "   " })), undefined);
});

check("iperf 草稿：秒数必须是 1..3600 的整数", () => {
	for (const seconds of ["0", "-1", "abc", "5.5", "1e3", String(LAB_IPERF_SECONDS_MAX + 1)])
		assert.equal(labIperfDraftError(draftOf({ client: "h1", server: "h2", seconds })), "secondsInvalid", `seconds=${seconds}`);
	assert.equal(labIperfDraftError(draftOf({ client: "h1", server: "h2", seconds: "1" })), undefined);
	assert.equal(labIperfDraftError(draftOf({ client: "h1", server: "h2", seconds: String(LAB_IPERF_SECONDS_MAX) })), undefined);
});

check("iperf 草稿：运行时 number 秒数不抛错（`String()` 归一，不直接 `.trim()`）", () => {
	assert.equal(labIperfDraftError(numericSeconds(5)), undefined);
	assert.equal(labIperfDraftError(numericSeconds(0)), "secondsInvalid");
	assert.deepEqual(labIperfPayloadOf(numericSeconds(5)), { client: "h1", server: "h2", l4_type: "TCP", seconds: 5 });
});

check("iperf 请求体：去空白、`l4_type` 总发、秒数留空则不发该字段", () => {
	assert.deepEqual(
		labIperfPayloadOf(draftOf({ client: " h1 ", server: " h2 ", l4Type: "UDP" })),
		{ client: "h1", server: "h2", l4_type: "UDP" }
	);
	// 空协议只可能是「旧草稿 / 手改数据」，`USelect` 本身只给 TCP / UDP；
	// 这里越过类型复现一次，确认它会退回上游默认而不会发出空串。
	assert.deepEqual(
		labIperfPayloadOf({ ...draftOf({ client: "h1", server: "h2" }), l4Type: "" as unknown as LabIperfDraft["l4Type"] }),
		{ client: "h1", server: "h2", l4_type: "TCP" }
	);
});

check("iperf 协议只给 TCP / UDP（与上游 `l4Type` 词表一致）", () => {
	assert.deepEqual([...LAB_IPERF_L4_TYPES], ["TCP", "UDP"]);
});

check("`pingall` 文本化：字符串去首尾空白、数组按行拼、其余为空串", () => {
	assert.equal(labRunOutputOf("  h1->h2: 0/1\n"), "h1->h2: 0/1");
	assert.equal(labRunOutputOf(["h1->h2: 0/1", "h2->h1: 0/1"]), "h1->h2: 0/1\nh2->h1: 0/1");
	assert.equal(labRunOutputOf({ lines: [] }), "");
	assert.equal(labRunOutputOf(undefined), "");
});

check("iperf 结果：`{ client, server }` 两侧各自文本化（对象转 JSON）", () => {
	assert.deepEqual(labIperfResultOf({ client: " 1.02 Gbits/sec ", server: "done" }), {
		client: "1.02 Gbits/sec",
		server: "done"
	});
	assert.deepEqual(labIperfResultOf({ client: { bps: 1024 }, server: null }), {
		client: "{\"bps\":1024}",
		server: ""
	});
});

check("iperf 结果：上游 `{ result }` 分支不丢结果（塞进 client 侧）", () => {
	assert.deepEqual(labIperfResultOf({ result: "unexpected shape" }), { client: "unexpected shape", server: "" });
});

check("iperf 结果：形状不符一律 null（页面不渲染空结果块）", () => {
	for (const payload of [null, undefined, "text", 42, [], {}])
		assert.equal(labIperfResultOf(payload), null, `payload=${JSON.stringify(payload)}`);
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exitCode = fail > 0 ? 1 : 0;
