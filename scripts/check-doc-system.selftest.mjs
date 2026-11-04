// scripts/check-doc-system.selftest.mjs
// 文档体系守卫自测：把 ⑦「中英对齐」的负例固化成可执行断言，防止重构把这条断言改哑。
//
// 做法（不污染工作区、不改被测脚本）：把 `check-doc-system.ts` + `docIds.ts` + 全部 `.md`
// 拷进系统临时目录，在副本上制造漂移，再用真脚本跑一遍，比对「退出码 + 报文字样」。
//
// 四个用例：
//   ① 基线：原样副本 → 0 失败，且 ⑦ 段存在
//   ② doc-map 漂移：en 的 `ARCH-006 → 0.2.22` 改成 `0.2.99` → 1 失败，报文含 missing / extra
//   ③ 版本漂移：en 的 `ARCH-006` 文档 frontmatter `version` 改小一版 → 1 失败
//   ④ 镜像缺失：删掉 en 的 `ARCH-006` 文档 → 1 失败，报文指名 docId
import { spawnSync } from "node:child_process";
import {
	closeSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TSX = join(ROOT, "node_modules/tsx/dist/cli.mjs");
const CHECK = "scripts/check-doc-system.ts";
const DOC_IDS = "shared/constants/docIds.ts";
const COLLECTIONS = "layers/content/collections";
const EN_MAP = `${COLLECTIONS}/en/architecture/0.governance/doc-map.md`;

/** 递归列出 dir 下所有 .md（返回相对 ROOT 的路径） */
function walkMd(dir) {
	const out = [];
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		if (statSync(full).isDirectory())
			out.push(...walkMd(full));
		else if (name.endsWith(".md"))
			out.push(relative(ROOT, full));
	}
	return out;
}

/** 只拷被测脚本需要的三样东西，保持相对路径不变 */
const MD_FILES = walkMd(join(ROOT, COLLECTIONS));

function stage() {
	const dir = mkdtempSync(join(tmpdir(), "doc-system-selftest-"));
	for (const file of [CHECK, DOC_IDS, ...MD_FILES]) {
		const dest = join(dir, file);
		mkdirSync(dirname(dest), { recursive: true });
		cpSync(join(ROOT, file), dest);
	}
	return dir;
}

function runCheck(dir) {
	// 输出走文件而不是管道：被测脚本约 1000 行输出，管道缓冲区写满时 process.exit 会截断尾巴
	const log = join(dir, "__selftest.log");
	const fd = openSync(log, "w");
	try {
		const r = spawnSync(process.execPath, [TSX, CHECK], { cwd: dir, stdio: ["ignore", fd, fd] });
		return { status: r.status, out: readFileSync(log, "utf8") };
	} finally {
		closeSync(fd);
	}
}

/** 在 en 集合里按 docId 找文档路径（相对临时目录） */
function findByDocId(dir, docId) {
	const hit = MD_FILES
		.filter((f) => f.startsWith(`${COLLECTIONS}/en/`))
		.find((f) => readFileSync(join(dir, f), "utf8").includes(`docId: ${docId}`));
	if (!hit)
		throw new Error(`临时目录里找不到 ${docId} 的 en 文档`);
	return hit;
}

/** 按顺序执行编辑，返回改动后的临时目录内容（每个用例一份干净副本） */
function caseDir(mutate) {
	const dir = stage();
	if (mutate)
		mutate(dir);
	return dir;
}

const CASES = [
	{
		name: "基线：原样副本 0 失败",
		mutate: null,
		expect: (r) => r.status === 0
			&& /结果：\d+ 通过 \/ 0 失败 \/ 0 告警/.test(r.out)
			&& r.out.includes("⑦ 中英对齐")
	},
	{
		name: "doc-map 漂移：en 的 0.2.22 改成 0.2.99",
		mutate: (dir) => {
			const file = join(dir, EN_MAP);
			const src = readFileSync(file, "utf8");
			const patched = src.replace("ARCH-006` → 0.2.22", "ARCH-006` → 0.2.99");
			if (patched === src)
				throw new Error("en doc-map 里没有找到 `ARCH-006` → 0.2.22");
			writeFileSync(file, patched);
		},
		expect: (r) => r.status === 1
			&& r.out.includes("❌ 变更集合中英一致：NMCPS-ARCH-006")
			&& r.out.includes("\"missing\":[\"0.2.22\"]")
			&& r.out.includes("\"extra\":[\"0.2.99\"]")
	},
	{
		name: "版本漂移：en 的 ARCH-006 版本改小一版",
		mutate: (dir) => {
			const file = join(dir, findByDocId(dir, "NMCPS-ARCH-006"));
			const src = readFileSync(file, "utf8");
			const patched = src.replace(/^version: (\d+)\.(\d+)\.(\d+)$/m, (_, a, b) => `version: ${a}.${Number(b) - 1}.0`);
			if (patched === src)
				throw new Error("en 的 ARCH-006 文档没有 version 行");
			writeFileSync(file, patched);
		},
		expect: (r) => r.status === 1 && r.out.includes("❌ 中英版本号一致：NMCPS-ARCH-006")
	},
	{
		name: "镜像缺失：删掉 en 的 ARCH-006 文档",
		mutate: (dir) => {
			rmSync(join(dir, findByDocId(dir, "NMCPS-ARCH-006")));
		},
		expect: (r) => r.status === 1 && r.out.includes("❌ en 对应文档存在：NMCPS-ARCH-006")
	}
];

if (!existsSync(TSX)) {
	console.error(`❌ 找不到 tsx：${TSX}（先 pnpm install）`);
	process.exit(1);
}

let pass = 0;
let fail = 0;
for (const c of CASES) {
	let dir = null;
	try {
		dir = caseDir(c.mutate);
		const r = runCheck(dir);
		if (c.expect(r)) {
			pass++;
			console.log(`  ✅ ${c.name}`);
		} else {
			fail++;
			console.log(`  ❌ ${c.name}（exit ${r.status}）`);
			const bad = r.out.split("\n").filter((l) => l.includes("❌") || l.includes("结果："));
			console.log(bad.length > 0 ? bad.map((l) => `     ${l.trim()}`).join("\n") : "     （被测脚本无 ❌ 行，可能提前退出）");
		}
	} catch (err) {
		fail++;
		console.log(`  ❌ ${c.name}：${err.message}`);
	} finally {
		if (dir)
			rmSync(dir, { recursive: true, force: true });
	}
}

console.log(`\n文档体系自测 ${pass}/${CASES.length} 通过`);
process.exit(fail > 0 ? 1 : 0);
