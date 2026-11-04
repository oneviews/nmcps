// scripts/check-ci-summary.mjs
// `scripts/ci-summary.sh` 的自测：把「--expect 期望结论」的语义固化成可执行断言。
//
// 背景：摘要是给人看的，抽不到结论时旧版只会静静写一句「没有小结行」，CI 依旧是绿的。
// `--expect "<正则>"` 让调用方声明「本步骤必须出现哪条结论」，缺失即 `::error` + 退出码 1，
// 由 `ci.yml` 里的 `|| status=1` 把步骤变红。这里把该行为、以及「不给 --expect 时的向后兼容」
// 和「参数错误」都钉住。
//
// 六个行为用例（跑真脚本）：
//   ① 命中：日志有「结果：967 通过 / 0 失败 / 0 告警」→ 退出码 0，无 ::error
//   ② 未命中：期望「文案自查 10/10 通过」但日志没有 → 退出码 1，::error + 摘要写「预期结论缺失」
//   ③ 向后兼容：不给 --expect、日志也没有小结行 → 退出码 0，摘要写「没有…小结行」
//   ④ 非 CI 环境（无 $GITHUB_STEP_SUMMARY）：--expect 未命中同样退出码 1 并打 ::error
//   ⑤ 参数缺值：`--expect` 后面没值 → 退出码 2 + usage
//   ⑥ 未知选项：第三个参数不是 --expect → 退出码 2
//
// 五个接线断言（静态读 ci.yml + 调 scripts/ci-expectations.sh）：
//   ⑦ 每处 ci-summary.sh 调用都带 `--expect "$(sh scripts/ci-expectations.sh <key>)"`
//   ⑧ 每处调用都以 `|| status=1` 收尾（已红分支里允许 `|| true`）
//   ⑨ ci.yml 用到的 key 与 `--list` 表双向一致（无死条目、无未登记 key）
//   ⑩ 表里每个 key 都能解析出非空正则
//   ⑪ unknown key 有明确报错（退出码 2 + 可用 key 提示）
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = "scripts/ci-summary.sh";
const OK_LOG = "结果：967 通过 / 0 失败 / 0 告警\n文档体系自测 4/4 通过\n";
const PLAIN_LOG = "$ vue-tsc -b --pretty\n▎ TNB ACTIVE — tsconfig ok\n";

const dir = mkdtempSync(join(tmpdir(), "ci-summary-selftest-"));
const okLog = join(dir, "ok.log");
const plainLog = join(dir, "plain.log");
writeFileSync(okLog, OK_LOG);
writeFileSync(plainLog, PLAIN_LOG);

let seq = 0;
/** 跑一次摘要脚本，返回 { status, out, summary }；summary 为 null 表示本次不提供 $GITHUB_STEP_SUMMARY */
function run(args, { withSummary = true } = {}) {
	const summary = join(dir, `summary-${seq++}.md`);
	writeFileSync(summary, "");
	const env = { ...process.env };
	if (withSummary)
		env.GITHUB_STEP_SUMMARY = summary;
	else
		delete env.GITHUB_STEP_SUMMARY;
	const r = spawnSync("sh", [SCRIPT, ...args], { cwd: ROOT, env, encoding: "utf8" });
	return {
		status: r.status,
		out: `${r.stdout ?? ""}${r.stderr ?? ""}`,
		summary: withSummary ? readFileSync(summary, "utf8") : null
	};
}

const CASES = [
	{
		name: "命中：--expect 找到「结果：967 通过」",
		run: () => run(["governance guard", okLog, "--expect", "结果：[0-9]+ 通过"]),
		expect: ({ status, out, summary }) => status === 0
			&& !out.includes("::error")
			&& summary.includes("**关键结论**")
			&& summary.includes("结果：967 通过 / 0 失败 / 0 告警")
			&& !summary.includes("预期结论缺失")
	},
	{
		name: "未命中：--expect 找不到「文案自查 10/10 通过」→ 红",
		run: () => run(["i18n guard", okLog, "--expect", "文案自查 [0-9]+/[0-9]+ 通过"]),
		expect: ({ status, out, summary }) => status === 1
			&& out.includes("::error title=预期结论缺失 (i18n guard)::")
			&& summary.includes("**预期结论缺失**")
			&& summary.includes("文案自查 [0-9]+/[0-9]+ 通过")
	},
	{
		name: "向后兼容：不给 --expect、日志无小结行 → 仍然绿",
		run: () => run(["typecheck", plainLog]),
		expect: ({ status, out, summary }) => status === 0
			&& !out.includes("::error")
			&& summary.includes("日志里没有「N/N 项通过 / 结果：…」小结行")
			&& !summary.includes("预期结论缺失")
	},
	{
		name: "非 CI 环境：--expect 未命中也要 ::error + 退出码 1",
		run: () => run(["governance guard", plainLog, "--expect", "结果：[0-9]+ 通过"], { withSummary: false }),
		expect: ({ status, out, summary }) => status === 1
			&& out.includes("::error title=预期结论缺失")
			&& out.includes("（非 CI 环境：跳过步骤摘要）")
			&& summary === null
	},
	{
		name: "参数缺值：--expect 后面没值 → usage + 退出码 2",
		run: () => run(["lint", okLog, "--expect"]),
		expect: ({ status, out }) => status === 2 && out.includes("usage: sh scripts/ci-summary.sh")
	},
	{
		name: "未知选项：第三个参数不是 --expect → usage + 退出码 2",
		run: () => run(["lint", okLog, "--bogus", "x"]),
		expect: ({ status, out }) => status === 2 && out.includes("unknown option: --bogus")
	}
];

let pass = 0;
let fail = 0;
try {
	for (const c of CASES) {
		let result = null;
		let err = null;
		try {
			result = c.run();
		} catch (e) {
			err = e;
		}
		const ok = !err && c.expect(result);
		if (ok) {
			pass++;
			console.log(`  ✅ ${c.name}`);
		} else {
			fail++;
			console.log(`  ❌ ${c.name}${result ? `（exit ${result.status}）` : ""}`);
			console.log(`     ${err ? err.message : (result.summary ?? result.out).split("\n").slice(0, 6).join("\n     ")}`);
		}
	}
} finally {
	rmSync(dir, { recursive: true, force: true });
}

// ── 接线断言：ci.yml 的每个调用点都必须走 --expect 表（scripts/ci-expectations.sh） ──
// 为什么不只测脚本本身：正则原先内联在 ci.yml 六处，改小结措辞时要同步改六处，
// 漏一处就静默退化。这层断言让「漏写 --expect / 漏写 || status=1 / key 写错 / 表里的
// key 没调用点」在本地就变红。
const CI_YML = ".github/workflows/ci.yml";
const TABLE_SCRIPT = "scripts/ci-expectations.sh";
const EXPECT_CALL = /--expect "\$\(sh scripts\/ci-expectations\.sh ([a-z0-9-]+)\)"/;

const ciLines = readFileSync(join(ROOT, CI_YML), "utf8").split("\n");
const callSites = ciLines
	.map((line, idx) => ({ line: line.trim(), idx }))
	.filter(({ line }) => line.includes("sh scripts/ci-summary.sh ") && !line.startsWith("#"));

/** 最近的上一层 `if [ "$status" -ne 0 ]` 分支里？（用于放行已红分支的 `|| true`） */
function inFailedBranch(lines, idx) {
	for (let i = idx - 1; i >= 0; i--) {
		const t = lines[i].trim();
		if (t === "if [ \"$status\" -ne 0 ]; then")
			return true;
		if (t === "fi" || t === "done" || t.startsWith("for "))
			return false;
	}
	return false;
}

function table(key) {
	const r = spawnSync("sh", [TABLE_SCRIPT, key], { cwd: ROOT, encoding: "utf8" });
	return { status: r.status, out: (r.stdout ?? "").trim(), err: r.stderr ?? "" };
}

function wiring(name, ok, detail) {
	if (ok) {
		pass++;
		console.log(`  ✅ ${name}`);
	} else {
		fail++;
		console.log(`  ❌ ${name}`);
		if (detail)
			console.log(`     ${detail}`);
	}
	return ok;
}

const tableKeys = spawnSync("sh", [TABLE_SCRIPT, "--list"], { cwd: ROOT, encoding: "utf8" })
	.stdout
	.trim()
	.split("\n")
	.map((l) => l.split("\t")[0]);
const usedKeys = [
	...new Set(
		callSites
			.map(({ line }) => (line.match(EXPECT_CALL) ?? [])[1])
			.filter(Boolean)
	)
];

wiring(
	`${CI_YML} 每处 ci-summary.sh 调用都带 --expect "$(sh ${TABLE_SCRIPT} <key>)"（${callSites.length} 处）`,
	callSites.length > 0 && callSites.every(({ line }) => EXPECT_CALL.test(line)),
	callSites.filter(({ line }) => !EXPECT_CALL.test(line)).map(({ idx, line }) => `L${idx + 1}: ${line}`).join("\n")
);

wiring(
	"每处调用都以 `|| status=1` 收尾（已红分支里允许 `|| true`）",
	callSites.every(({ line, idx }) => line.endsWith("|| status=1") || (line.endsWith("|| true") && inFailedBranch(ciLines, idx))),
	callSites
		.filter(({ line, idx }) => !(line.endsWith("|| status=1") || (line.endsWith("|| true") && inFailedBranch(ciLines, idx))))
		.map(({ idx, line }) => `L${idx + 1}: ${line}`)
		.join("\n")
);

wiring(
	`ci.yml 用到的 key 与 \`--list\` 表双向一致（${usedKeys.join(" / ")}）`,
	usedKeys.length === tableKeys.length && usedKeys.every((k) => tableKeys.includes(k)),
	`used=[${usedKeys.join(", ")}] table=[${tableKeys.join(", ")}]`
);

wiring(
	"表里每个 key 都能解析出非空正则",
	tableKeys.length > 0 && tableKeys.every((k) => {
		const r = table(k);
		return r.status === 0 && r.out.length > 0;
	}),
	tableKeys.map((k) => `${k}=${JSON.stringify(table(k).out)}`).join(" ")
);

const bogus = table("bogus-key");
wiring(
	"unknown key 有明确报错（退出码 2 + 可用 key 提示）",
	bogus.status === 2 && /unknown key: bogus-key/.test(bogus.err) && /可用 key/.test(bogus.err),
	`exit=${bogus.status} stderr=${JSON.stringify(bogus.err.trim())}`
);

console.log(`\n步骤摘要自测 ${pass}/${pass + fail} 通过`);
// exitCode 而非 process.exit()：避免截断尚未刷出的 stdout
process.exitCode = fail > 0 ? 1 : 0;
