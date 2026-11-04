// scripts/check-ci-summary.mjs
// `scripts/ci-summary.sh` 的自测：把「--expect 期望结论」的语义固化成可执行断言。
//
// 背景：摘要是给人看的，抽不到结论时旧版只会静静写一句「没有小结行」，CI 依旧是绿的。
// `--expect "<正则>"` 让调用方声明「本步骤必须出现哪条结论」，缺失即 `::error` + 退出码 1，
// 由 `ci.yml` 里的 `|| status=1` 把步骤变红。这里把该行为、以及「不给 --expect 时的向后兼容」
// 和「参数错误」都钉住。
//
// 六个用例：
//   ① 命中：日志有「结果：967 通过 / 0 失败 / 0 告警」→ 退出码 0，无 ::error
//   ② 未命中：期望「文案自查 10/10 通过」但日志没有 → 退出码 1，::error + 摘要写「预期结论缺失」
//   ③ 向后兼容：不给 --expect、日志也没有小结行 → 退出码 0，摘要写「没有…小结行」
//   ④ 非 CI 环境（无 $GITHUB_STEP_SUMMARY）：--expect 未命中同样退出码 1 并打 ::error
//   ⑤ 参数缺值：`--expect` 后面没值 → 退出码 2 + usage
//   ⑥ 未知选项：第三个参数不是 --expect → 退出码 2
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

console.log(`\n步骤摘要自测 ${pass}/${CASES.length} 通过`);
// exitCode 而非 process.exit()：避免截断尚未刷出的 stdout
process.exitCode = fail > 0 ? 1 : 0;
