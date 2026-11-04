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
//
// 三个回放断言（拿真实日志尾部当样本，措辞一变就红）：
//   ⑫ 每个 key 都有样本 `scripts/fixtures/ci-logs/<key>.log`，且样本与 key 双向一致
//   ⑬ 每条正则在对应样本上用 `grep -aE` 命中（与 ci-summary.sh 同工具同参数）
//   ⑭ 每份样本都带 `# source:` 出处行（防止编造样本冒充真实输出）
//
// 三个清单断言（SHA256 + source 双源互证，手改样本不重新封存就红）：
//   ⑮ 样本清单 `scripts/fixtures/ci-logs/.manifest.json` 与样本文件双向一致
//   ⑯ 清单里每条 sha256 与样本字节一致
//   ⑰ 清单里的 source 与样本 `# source:` 行一致（两个来源互相印证）
//
// 一个回填断言（样本来源不能随手编）：
//   ⑱ `--from-ci` 表里的步骤名与产物名都在 ci.yml 里存在（改名即红，回填不会写出假出处）
//
// 重采样（两条路，都不需要手抄日志）：
//   `--write-fixtures`   本地重跑 lint / typecheck / i18n / governance 四步，把真实输出尾部写回
//                        样本并封存清单；某步 exit≠0 就跳过该 key（失败输出绝不当样本）。
//   `--from-ci [run-id]` 从该次运行的产物（ci.yml 里 `tee` 落盘的那份）回填，覆盖全部六个 key，
//                        包含本地跑不了的 bff / ui；步骤名与 job 名取自这次的 `gh run view`。
// 两条路都会在写回后立刻把正则回放一遍，措辞漂移当场就报；任一不过退出码 1。
// `--seal` 只重封清单、不碰样本（手工改过样本时用）。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = "scripts/ci-summary.sh";
const OK_LOG = "结果：967 通过 / 0 失败 / 0 告警\n文档体系自测 4/4 通过\n";
const PLAIN_LOG = "$ vue-tsc -b --pretty\n▎ TNB ACTIVE — tsconfig ok\n";
const FIXTURE_DIR = "scripts/fixtures/ci-logs";
const TABLE_SCRIPT = "scripts/ci-expectations.sh";
const MANIFEST = `${FIXTURE_DIR}/.manifest.json`;
const fixturePath = (key) => `${FIXTURE_DIR}/${key}.log`;
const fixtureKeysOnDisk = () =>
	readdirSync(join(ROOT, FIXTURE_DIR))
		.filter((f) => f.endsWith(".log"))
		.map((f) => f.replace(/\.log$/, ""))
		.sort();
const sha256 = (p) => createHash("sha256").update(readFileSync(join(ROOT, p))).digest("hex");
const sourceOf = (p) => (readFileSync(join(ROOT, p), "utf8").match(/^# source: (.*)$/m) ?? ["", ""])[1];

/** 从一段真实日志里取要写进样本的那几行（与 ci.yml 里 `tee` 出来的文件同源） */
function pickTail(text, { tail, keepBanner = false, keep }) {
	return text
		.split("\n")
		.map((l) => l.replace(/\s+$/, ""))
		.filter((l) => l.length > 0 && (keepBanner || !l.startsWith("$ ")) && (!keep || keep.test(l)))
		.slice(-tail);
}

function writeFixture(key, source, hint, body) {
	const header = [`# key: ${key}`, `# source: ${source}`, `# 更新方式：${hint}`];
	writeFileSync(join(ROOT, fixturePath(key)), `${header.join("\n")}\n${body.join("\n")}\n`);
}

/** 把刚写回的样本立刻喂回表里的正则：措辞漂移要在这里喊，而不是等下一次跑断言 */
function replayFixture(key) {
	const re = spawnSync("sh", [TABLE_SCRIPT, key], { cwd: ROOT, encoding: "utf8" }).stdout?.trim() ?? "";
	return { re, hit: spawnSync("grep", ["-aE", re, join(ROOT, fixturePath(key))]).status === 0 };
}

// `--from-ci` 表：key → 产物名 + 产物内文件名 + 该步骤在 ci.yml 里的 name。
// 步骤名写进 `# source:`，所以它必须与 ci.yml 一致（⑱ 静态校验），回填时还要在这次运行里
// 真的找到同名步骤（证明出处不是编的）。产物名同理。
const CI_ARTIFACTS = [
	{ key: "lint", artifact: "check-logs-quality", file: "lint.log", step: "Lint", tail: 6, keepBanner: true },
	{ key: "typecheck", artifact: "check-logs-quality", file: "typecheck.log", step: "Typecheck", tail: 6, keepBanner: true },
	{ key: "i18n", artifact: "check-logs-quality", file: "i18n.log", step: "Text (i18n) guard", tail: 8 },
	{
		key: "governance",
		artifact: "check-logs-quality",
		file: "governance.log",
		step: "Governance guard",
		tail: 12,
		keep: /结果：|自测|项通过/
	},
	{ key: "bff", artifact: "check-logs-runtime", file: "check-bff.log", step: "Gateway contract checks", tail: 8 },
	{ key: "ui", artifact: "check-logs-runtime", file: "check-ui.log", step: "Page UI checks", tail: 8 }
];

/** 把当前样本的 sha256 + source 封存进清单；样本任何字节改动都会与清单对不上 */
function seal() {
	const keys = fixtureKeysOnDisk();
	const rows = {};
	for (const key of keys)
		rows[key] = { sha256: sha256(fixturePath(key)), source: sourceOf(fixturePath(key)) };
	writeFileSync(join(ROOT, MANIFEST), `${JSON.stringify(rows, null, "\t")}\n`);
	console.log(`✅ 已封存 ${MANIFEST}（${keys.length} 条：${keys.join(" / ")}）`);
}

// `--seal`：只重封清单、不跑任何命令（手工替换 bff / ui 样本后用）
if (process.argv.includes("--seal")) {
	seal();
	process.exit(0);
}

// `--write-fixtures`：重采样本后退出，不跑断言（断言要求样本非空且最新）
if (process.argv.includes("--write-fixtures")) {
	const jobs = [
		// lint / typecheck 成功时只有 pnpm 回显的 `$ eslint .` 一行，banner 必须留（正则就指着它）
		{ key: "lint", cmd: "pnpm lint", tail: 6, keepBanner: true },
		{ key: "typecheck", cmd: "pnpm typecheck", tail: 6, keepBanner: true },
		{ key: "i18n", cmd: "pnpm check:i18n", tail: 8 },
		{ key: "governance", cmd: "pnpm check:governance", tail: 12, keep: /结果：|自测|项通过/ }
	];
	// 先跑完、再统一落盘：check:governance 会跑本脚本读样本，跑到一半改样本会让它假红
	const collected = [];
	for (const { key, cmd, tail, keep, keepBanner } of jobs) {
		const r = spawnSync("sh", ["-c", cmd], { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
		collected.push({ key, cmd, status: r.status, body: pickTail(`${r.stdout ?? ""}${r.stderr ?? ""}`, { tail, keep, keepBanner }) });
	}

	let problems = 0;
	for (const { key, cmd, status, body } of collected) {
		// 不绿不写：失败的输出一旦写成样本，就成了「真实日志」的赝品，后面谁也看不出来
		if (status !== 0) {
			problems++;
			console.log(`❌ 跳过 ${fixturePath(key)}：\`${cmd}\` exit ${status}，不把失败输出固化成样本（先让这步本地变绿再重采）`);
			continue;
		}
		const source = `本地 \`${cmd}\` 真实输出尾部（${new Date().toISOString().slice(0, 10)} 重采）`;
		writeFixture(key, source, "node scripts/check-ci-summary.mjs --write-fixtures", body);
		console.log(`✅ 已刷新 ${fixturePath(key)}（${cmd} exit 0，${body.length} 行）`);
		const { re, hit } = replayFixture(key);
		if (!hit) {
			problems++;
			console.log(`   ⚠️ 正则不再命中新样本：key=${key} 正则=${JSON.stringify(re)} — 同步更新 ${TABLE_SCRIPT} 里这条正则`);
		}
	}
	console.log("\n⚠️  bff / ui 需构建产物 + 真浏览器，本地跑不了：用 `--from-ci [run-id]` 从 CI 产物回填（别再手抄）。");
	seal();
	process.exit(problems > 0 ? 1 : 0);
}

// `--from-ci`：把「机器抓的日志」回填成样本 —— 从该次运行的产物里取 ci.yml 用 tee 落盘的那份，
// 所以样本出处不再是「某人从 gh run view 里挑了几行粘过来」（唯一能手工伪造的环节）。
if (process.argv.includes("--from-ci")) {
	const argv = process.argv.slice(2);
	const at = argv.indexOf("--from-ci");
	const explicit = argv[at + 1];
	// 子进程失败要能干净地报错，而不是抛栈
	const gh = (...args) => spawnSync("gh", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
	const fail = (msg) => {
		console.log(`❌ ${msg}`);
		process.exit(1);
	};

	const runId = explicit && /^\d+$/.test(explicit)
		? explicit
		: (gh("run", "list", "--limit", "1", "--json", "databaseId", "--jq", ".[0].databaseId").stdout ?? "").trim();
	if (!runId)
		fail("拿不到 run id：gh 未登录、无运行记录，或参数不是数字（用法：--from-ci [run-id]）");

	// 该运行里真实存在的「步骤名 → job 名」：`# source:` 要写这两个名字，必须是这次真跑过的
	const view = gh("run", "view", runId, "--json", "jobs,headSha");
	if (view.status !== 0)
		fail(`gh run view ${runId} 失败：${(view.stderr ?? "").trim().split("\n")[0]}`);
	let jobsMeta = [];
	try {
		jobsMeta = JSON.parse(view.stdout).jobs ?? [];
	} catch {
		fail(`gh run view ${runId} 的输出不是 JSON`);
	}
	const stepToJob = new Map();
	for (const job of jobsMeta) {
		for (const step of job.steps ?? []) stepToJob.set(step.name, job.name);
	}

	const dir = join(ROOT, "ci-logs/downloads", runId);
	rmSync(dir, { recursive: true, force: true });
	const dl = gh("run", "download", runId, "-D", dir);
	if (dl.status !== 0)
		fail(`gh run download ${runId} 失败（产物可能已过期）：${(dl.stderr ?? "").trim().split("\n")[0]}`);

	/** 产物布局随 upload-artifact 版本变过（v4 起剥掉公共前缀），按 basename 兜底找 */
	const findArtifactFile = (artifact, file) => {
		const root = join(dir, artifact);
		const walk = (d) => {
			let entries = [];
			try {
				entries = readdirSync(d, { withFileTypes: true });
			} catch {
				return null;
			}
			for (const e of entries) {
				const p = join(d, e.name);
				if (e.isDirectory()) {
					const found = walk(p);
					if (found) return found;
				} else if (e.name === file) {
					return p;
				}
			}
			return null;
		};
		return walk(root);
	};

	let problems = 0;
	for (const { key, artifact, file, step, tail, keep, keepBanner } of CI_ARTIFACTS) {
		const jobName = stepToJob.get(step);
		if (!jobName) {
			problems++;
			console.log(`❌ 跳过 ${fixturePath(key)}：run ${runId} 里找不到名为「${step}」的步骤（步骤改名了？同步 CI_ARTIFACTS）`);
			continue;
		}
		const path = findArtifactFile(artifact, file);
		if (!path) {
			problems++;
			console.log(`❌ 跳过 ${fixturePath(key)}：产物 ${artifact}/${file} 不存在（产物过期？或 ci.yml 改了产物路径）`);
			continue;
		}
		const body = pickTail(readFileSync(path, "utf8"), { tail, keep, keepBanner });
		const source = `CI run ${runId} 步骤 "${step}"（job: ${jobName}）产物 ${artifact}/${file} 尾部（${new Date().toISOString().slice(0, 10)} 回填）`;
		writeFixture(key, source, "node scripts/check-ci-summary.mjs --from-ci [run-id]", body);
		console.log(`✅ 已回填 ${fixturePath(key)}（run ${runId} / ${step}，${body.length} 行）`);
		const { re, hit } = replayFixture(key);
		if (!hit) {
			problems++;
			console.log(`   ⚠️ 正则不再命中回填的样本：key=${key} 正则=${JSON.stringify(re)} — 同步更新 ${TABLE_SCRIPT} 里这条正则`);
		}
	}
	console.log(`\n📦 产物留在 ${dir.replace(`${ROOT}/`, "")}（已 gitignore）`);
	seal();
	process.exit(problems > 0 ? 1 : 0);
}

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

// ── 回放断言：每条正则都要在「真实输出」样本上命中 ──
// 为什么还不够：⑦～⑪ 只保证接线对，正则可以写对形式却匹配不上今天的措辞
// （例如小结从「N/N 项通过」改成「N/N cases passed」）。fixtures 是各步骤真实日志尾部，
// 用 `grep -E`（与 ci-summary.sh 用的同一工具、同一选项）回放，措辞一变这里就红。
const fixtureKeys = fixtureKeysOnDisk();
const missingFixture = tableKeys.filter((k) => !fixtureKeys.includes(k));
const orphanFixture = fixtureKeys.filter((k) => !tableKeys.includes(k));

wiring(
	`每个 key 都有真实输出样本 ${FIXTURE_DIR}/<key>.log（${fixtureKeys.length} 份）`,
	tableKeys.length > 0 && missingFixture.length === 0 && orphanFixture.length === 0,
	[
		missingFixture.length ? `缺样本: ${missingFixture.join(", ")}` : "",
		orphanFixture.length ? `无对应 key: ${orphanFixture.join(", ")}` : ""
	]
		.filter(Boolean)
		.join("\n")
);

const replayMiss = tableKeys
	.filter((k) => spawnSync("grep", ["-aE", table(k).out, join(ROOT, fixturePath(k))]).status !== 0);
wiring(
	"每条正则都在对应样本上命中（grep -aE，与 ci-summary.sh 同参数）",
	tableKeys.length > 0 && replayMiss.length === 0,
	replayMiss.map((k) => `grep -E ${JSON.stringify(table(k).out)} ${fixturePath(k)} → 未命中`).join("\n")
);

const noSource = fixtureKeys.filter((k) => !/^# source: /m.test(readFileSync(join(ROOT, fixturePath(k)), "utf8")));
wiring(
	"每份样本都带 `# source:` 出处（防止凭空编造的样本冒充真实输出）",
	fixtureKeys.length > 0 && noSource.length === 0,
	noSource.map((k) => `${fixturePath(k)} 缺 \`# source:\` 行`).join("\n")
);

// ⑱ 回填表 ↔ ci.yml：`--from-ci` 把步骤名与产物名写进 `# source:`，两者都必须在 ci.yml 里存在，
// 否则改完 workflow 就会「从产物里回填出一份出处编造的样本」（或者直接下载失败）。
const ciText = ciLines.join("\n");
const backfillMiss = CI_ARTIFACTS.flatMap(({ key, artifact, step }) => {
	const miss = [];
	if (!ciText.includes(`\n      - name: ${step}\n`))
		miss.push(`${key}: ci.yml 没有名为「${step}」的步骤`);
	if (!ciText.includes(`name: ${artifact}`))
		miss.push(`${key}: ci.yml 没有上传名为 ${artifact} 的产物`);
	return miss;
});
wiring(
	`--from-ci 回填表里的步骤名与产物名都在 ${CI_YML} 里存在（${CI_ARTIFACTS.length} 条）`,
	CI_ARTIFACTS.length > 0 && backfillMiss.length === 0,
	backfillMiss.join("\n")
);

// ── 清单断言：SHA256 与 source 双源互证 ──
// 为什么还要清单：⑭ 的 `# source:` 只是样本里的一行文字，改样本的人顺手也能改它。
// 清单独立记录「样本字节的 sha256 + 它声称的出处」，任何不经过 --seal 的样本改动都会
// 让哈希对不上，任何只改头部不改正文的操作也会让两处 source 打架。
let manifest = {};
try {
	manifest = JSON.parse(readFileSync(join(ROOT, MANIFEST), "utf8"));
} catch {
	manifest = {};
}
const manifestKeys = Object.keys(manifest).sort();

wiring(
	`样本清单 ${MANIFEST} 与样本文件双向一致（${manifestKeys.length} 条）`,
	manifestKeys.length > 0 && fixtureKeys.length === manifestKeys.length && fixtureKeys.every((k) => manifestKeys.includes(k)),
	[
		...fixtureKeys.filter((k) => !manifestKeys.includes(k)).map((k) => `缺清单记录: ${k}（修复：node scripts/check-ci-summary.mjs --seal）`),
		...manifestKeys.filter((k) => !fixtureKeys.includes(k)).map((k) => `清单多出记录: ${k}（样本已删，修复：--seal）`)
	].join("\n")
);

const hashDrift = fixtureKeys.filter((k) => manifest[k]?.sha256 !== sha256(fixturePath(k)));
wiring(
	"清单里每条 sha256 与样本字节一致（手改样本未重新封存即红）",
	manifestKeys.length > 0 && hashDrift.length === 0,
	hashDrift
		.map((k) => `${k}: 清单 ${String(manifest[k]?.sha256 ?? "(无)").slice(0, 12)}… ≠ 实际 ${sha256(fixturePath(k)).slice(0, 12)}…（改完样本请跑 --seal）`)
		.join("\n")
);

const sourceDrift = fixtureKeys.filter((k) => (manifest[k]?.source ?? "") !== sourceOf(fixturePath(k)));
wiring(
	"清单里的 source 与样本 `# source:` 行互证一致",
	manifestKeys.length > 0 && sourceDrift.length === 0,
	sourceDrift
		.map((k) => `${k}: 清单「${manifest[k]?.source ?? "(无)"}」≠ 样本「${sourceOf(fixturePath(k))}」`)
		.join("\n")
);

console.log(`\n步骤摘要自测 ${pass}/${pass + fail} 通过`);
// exitCode 而非 process.exit()：避免截断尚未刷出的 stdout
process.exitCode = fail > 0 ? 1 : 0;
