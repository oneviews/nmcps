// scripts/check-doc-system.ts
// 文档体系守卫（S0 奠基；设计基准：NMCPS-GOV-001，索引：NMCPS-GOV-003）
//
// 六组最小断言：
//   ① 唯一性：docId 唯一、同 scope 仅一个 normative、DOC_PATHS 与文件集一致
//   ② 完整性：受治理文档的 frontmatter 必需字段齐全且合法
//   ③ 引用闭合：dependsOn 目标 docId 必须存在（死链拦截）
//   ④ 无环：dependsOn 构成 DAG
//   ⑤ 层级合法：只向上引用、normative 不依赖 informative、Tier 5 不作依据
//   ⑥ 老化告警：reviewBy 过期 / updatedAt 超 180 天 —— 仅告警，不影响退出码
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import process from "node:process";
import { DOC_PATHS } from "../shared/constants/docIds.ts";

// ── 常量 ──────────────────────────────────────────────
/** 受治理文档目录（必须有 docId / tier / authority / scope / status） */
const GOV_DIRS = [
	"layers/content/collections/cn/architecture",
	"layers/content/collections/cn/records"
];
const DOC_ID_RE = /^NMCPS-(?:GOV|ARCH|DESIGN|CONTRACT|ADR|REC)-[A-Z0-9-]+$/;
const SCOPE_RE = /^[a-z][a-z0-9.-]*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = ["draft", "review", "baseline", "deprecated", "superseded"];
const AUTHORITIES = ["normative", "informative"];
const STALE_DAYS = 180;
const TODAY = new Date();

let pass = 0;
let fail = 0;
let warn = 0;

function ok(cond: boolean, msg: string, extra?: unknown): void {
	if (cond) {
		pass++;
		console.log(`  ✅ ${msg}`);
	} else {
		fail++;
		console.log(`  ❌ ${msg}`, extra !== undefined ? JSON.stringify(extra) : "");
	}
}

function warning(msg: string): void {
	warn++;
	console.log(`  ⚠️  ${msg}`);
}

// ── 极简 frontmatter 解析（无第三方依赖，形状受控） ──
interface DocMeta {
	file: string
	path: string
	docId: string | null
	title: string | null
	tier: number | null
	authority: string | null
	scope: string[]
	status: string | null
	owner: string | null
	reviewBy: string | null
	updatedAt: string | null
	excerpt: string | null
	dependsOn: string[]
}

function parseDoc(file: string): DocMeta {
	const src = readFileSync(file, "utf8");
	const end = src.startsWith("---\n") ? src.indexOf("\n---\n", 3) : -1;
	const fm = end > 0 ? src.slice(4, end) : "";
	const lines = fm.split("\n");

	const scalar = (key: string): string | null => {
		const hit = lines.find((l) => l.startsWith(`${key}:`));
		if (!hit)
			return null;
		const v = hit.slice(key.length + 1).trim().replace(/^"|"$/g, "");
		return v === "" ? null : v;
	};
	const list = (key: string): string[] => {
		const out: string[] = [];
		const i = lines.findIndex((l) => l.startsWith(`${key}:`));
		if (i < 0)
			return out;
		const inline = lines[i]!.slice(key.length + 1).trim();
		if (inline.startsWith("[")) {
			const inner = inline.slice(1, -1).trim();
			return inner === "" ? [] : inner.split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
		}
		for (let j = i + 1; j < lines.length; j++) {
			const l = lines[j]!;
			if (l.startsWith("  - ") || l.startsWith("\t- ")) {
				out.push(l.trim().replace(/^- /, "").trim().replace(/^"|"$/g, ""));
			} else if (l.trim() === "") {
				continue;
			} else {
				break;
			}
		}
		return out;
	};

	const tierRaw = scalar("tier");
	return {
		file,
		path: relative("layers/content/collections/cn", file),
		docId: scalar("docId"),
		title: scalar("title"),
		tier: tierRaw === null ? null : Number(tierRaw),
		authority: scalar("authority"),
		scope: list("scope"),
		status: scalar("status"),
		owner: scalar("owner"),
		reviewBy: scalar("reviewBy"),
		updatedAt: scalar("updatedAt"),
		excerpt: scalar("excerpt"),
		dependsOn: list("dependsOn")
	};
}

// ── 递归扫描 ──────────────────────────────────────────
function walk(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		if (statSync(full).isDirectory())
			out.push(...walk(full));
		else if (name.endsWith(".md"))
			out.push(full);
	}
	return out;
}

// ── 主流程 ────────────────────────────────────────────
const files = GOV_DIRS.flatMap((d) => (existsSync(d) ? walk(d) : []));
const docs = files.map(parseDoc);
const governed = docs.filter((d) => d.docId !== null);

console.log(`扫描受治理文档 ${governed.length} 篇（共 ${docs.length} 个 .md）\n`);

// ① 唯一性
console.log("① 唯一性");
{
	const seen = new Map<string, string>();
	for (const d of governed) {
		ok(!seen.has(d.docId!), `docId 唯一：${d.docId}`, seen.has(d.docId!) ? `与 ${seen.get(d.docId!)} 重复` : undefined);
		seen.set(d.docId!, d.path);
	}
	// DOC_PATHS 与文件集一致
	for (const [docId, path] of Object.entries(DOC_PATHS)) {
		ok(existsSync(path), `DOC_PATHS 路径存在：${docId}`);
		ok(seen.has(docId), `DOC_PATHS 已登记且有文档：${docId}`);
	}
	for (const d of governed) {
		const mapped = (DOC_PATHS as Record<string, string>)[d.docId!];
		ok(mapped !== undefined && relative(mapped, join("layers/content/collections/cn", d.path)) === "", `DOC_PATHS 映射一致：${d.docId}`);
	}
	// 同 scope 仅一个 normative
	const scopeOwner = new Map<string, string>();
	for (const d of governed) {
		if (d.authority !== "normative")
			continue;
		for (const s of d.scope) {
			ok(!scopeOwner.has(s), `同 scope 仅一个 normative：${s}`, scopeOwner.has(s) ? `与 ${scopeOwner.get(s)} 冲突` : undefined);
			scopeOwner.set(s, d.docId!);
		}
	}
}

// ② 完整性
console.log("\n② 完整性");
for (const d of governed) {
	const id = d.docId!;
	ok(DOC_ID_RE.test(id), `docId 格式合法：${id}`);
	ok(d.title !== null, `title 存在：${id}`);
	ok(d.tier !== null && Number.isInteger(d.tier) && d.tier >= 0 && d.tier <= 5, `tier 合法（0~5）：${id}`, d.tier);
	ok(d.authority !== null && AUTHORITIES.includes(d.authority), `authority 合法：${id}`, d.authority);
	ok(d.scope.length > 0, `scope 非空：${id}`);
	ok(d.scope.every((s) => SCOPE_RE.test(s)), `scope 格式合法：${id}`, d.scope);
	ok(d.status !== null && STATUSES.includes(d.status), `status 合法：${id}`, d.status);
	ok(d.owner !== null, `owner 存在：${id}`);
	ok(d.reviewBy !== null && DATE_RE.test(d.reviewBy), `reviewBy 日期合法：${id}`, d.reviewBy);
}

// ③ 引用闭合
console.log("\n③ 引用闭合");
const byId = new Map(governed.map((d) => [d.docId!, d]));
for (const d of governed) {
	for (const dep of d.dependsOn) {
		ok(byId.has(dep), `${d.docId} 的 dependsOn 存在：${dep}`);
	}
}

// ④ 无环（dependsOn DAG）
console.log("\n④ 无环");
{
	const visiting = new Set<string>();
	const visited = new Set<string>();
	function dfs(id: string, stack: string[]): void {
		if (visiting.has(id)) {
			fail++;
			console.log(`  ❌ 引用成环：${[...stack, id].join(" → ")}`);
			return;
		}
		if (visited.has(id))
			return;
		const doc = byId.get(id);
		if (!doc)
			return;
		visiting.add(id);
		for (const dep of doc.dependsOn)
			dfs(dep, [...stack, id]);
		visiting.delete(id);
		visited.add(id);
	}
	for (const d of governed)
		dfs(d.docId!, []);
	if (visiting.size === 0)
		ok(true, "dependsOn 无环（DAG）");
}

// ⑤ 层级合法
console.log("\n⑤ 层级合法");
for (const d of governed) {
	for (const dep of d.dependsOn) {
		const t = byId.get(dep);
		if (!t)
			continue;
		ok(t.tier !== null && d.tier !== null && t.tier <= d.tier, `${d.docId} 只向上引用 ${dep}（tier ${t.tier} ≤ ${d.tier}）`);
		if (d.authority === "normative")
			ok(t.authority === "normative", `${d.docId}（normative）不依赖 informative：${dep}`);
		ok(t.tier !== 5, `${d.docId} 不依赖 Tier 5 记录层：${dep}`);
	}
}

// ⑥ 老化告警（仅告警）
console.log("\n⑥ 老化告警");
for (const d of governed) {
	if (d.reviewBy && DATE_RE.test(d.reviewBy)) {
		const r = new Date(d.reviewBy);
		if (r < TODAY)
			warning(`${d.docId} reviewBy 已过期：${d.reviewBy}`);
	}
	if (d.updatedAt && DATE_RE.test(d.updatedAt)) {
		const days = Math.floor((TODAY.getTime() - new Date(d.updatedAt).getTime()) / 86400000);
		if (days > STALE_DAYS)
			warning(`${d.docId} updatedAt 超 ${STALE_DAYS} 天：${d.updatedAt}（${days} 天）`);
	}
	// excerpt 短摘要长度告警（列表卡片排版）
	if (d.excerpt && d.excerpt.length > 80)
		warning(`${d.docId} excerpt 超 80 字：${d.excerpt.length} 字`);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败 / ${warn} 告警`);
process.exit(fail > 0 ? 1 : 0);
