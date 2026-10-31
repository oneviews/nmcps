// scripts/check-rules.mjs
// `.clinerules` 自查：把「规则」本身纳入门禁，防止约定被改回散文后自动失效。
//
// 无外部依赖、不起服务，纯静态检查（与 `pnpm check:doc-system` 同级，互不替代）。
//
// 断言分组：
//   ① 文件集：`01-`~`05-` 五份规则齐全且非空
//   ② 结构：每份恰好一个 H1、UTF-8 无 BOM、行尾 LF、文件以换行结尾
//   ③ 后续建议：A/B/C 选项的每条要求都必须写成列表项（Markdown 会把软换行折叠成一行，
//      散文式写法在渲染后就读不出「每条分行」）
//   ④ 语言与引用：收尾总结用中文；文档清单只引用 NMCPS-GOV-003，不手写清单
//   ⑤ 工程约定：typecheck / lint / Rust 校验命令仍在规则里
//   ⑥ CI 自查用例：`check:ui` / `check:bff` 的被测实例必须自带上游配置（否则用例误报）
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const RULES_DIR = ".clinerules";
const EXPECTED = ["01-next-steps.md", "02-coding-conventions.md", "03-git-workflow.md", "04-docs.md", "05-rust.md"];

const results = [];

function log(label, ok, detail) {
	results.push({ label, ok: !!ok });
	console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

function read(name) {
	return readFileSync(join(RULES_DIR, name), "utf8");
}

/** 行首为列表项（`- ` / `* ` / `1. `），且包含全部关键词 */
function bulletLines(text, keywords) {
	return text.split("\n").filter((line) => /^\s*(?:[-*]|\d+\.)\s/.test(line) && keywords.every((keyword) => line.includes(keyword)));
}

// ── ① 文件集 ──────────────────────────────────────────
let files = [];
try {
	files = readdirSync(RULES_DIR).filter((name) => name.endsWith(".md")).sort();
} catch {
	log(`${RULES_DIR} 目录可读`, false, "目录不存在");
}

log("规则文件齐全（5 份）", files.length === EXPECTED.length && EXPECTED.every((name) => files.includes(name)), files.join(", ") || "无");

// ── ② 结构 ───────────────────────────────────────────
const texts = new Map();
for (const name of EXPECTED.filter((n) => files.includes(n))) {
	const text = read(name);
	texts.set(name, text);

	const h1 = text.split("\n").filter((line) => line.startsWith("# "));
	const bytes = readFileSync(join(RULES_DIR, name));
	const hasBom = bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF;

	log(`${name} 恰好一个 H1`, h1.length === 1, `${h1.length} 个`);
	log(`${name} 编码与行尾规范（无 BOM / LF / 以换行结尾）`, !hasBom && !text.includes("\r\n") && text.endsWith("\n"));
}

// ── ③ 后续建议：A/B/C 必须逐条成列表项 ────────────────
const nextSteps = texts.get("01-next-steps.md") ?? "";

const REQUIREMENTS = [
	{ label: "先总结已完成的工作与结果", keyword: "Summarize the completed work" },
	{ label: "列出 2-5 条具体可执行的后续选项", keyword: "specific follow-up options" },
	{ label: "每条必须具体可执行", keyword: "concrete and actionable" },
	{ label: "最推荐的选项放 A", keyword: "most recommended option as A" },
	{ label: "每条选项单独成行（禁止软换行拼接）", keyword: "own line" },
	{ label: "收尾时主动给出建议", keyword: "provide suggestions immediately" }
];

for (const { label, keyword } of REQUIREMENTS) {
	const hits = bulletLines(nextSteps, [keyword]);
	log(`后续建议要求「${label}」以列表项声明`, hits.length === 1, hits[0]?.trim().slice(0, 60) ?? "未找到列表项");
}

const ownLineRule = bulletLines(nextSteps, ["own line"])[0] ?? "";
log("「单独成行」规则说明了软换行会被折叠的原因", /Markdown/.test(ownLineRule) && /bullet|list/.test(ownLineRule));

const paragraphOptions = nextSteps
	.split("\n")
	.filter((line) => /^[A-Z]（推荐）|^\*\*[A-Z]/.test(line.trim()));
log("后续建议示例没有被写成裸段落行", paragraphOptions.length === 0, paragraphOptions.join(" / ") || "无");

// ── ④ 语言与引用 ─────────────────────────────────────
log("收尾总结必须用中文（列表项声明）", bulletLines(nextSteps, ["最后的总结必须使用中文"]).length === 1);

const docs = texts.get("04-docs.md") ?? "";
log("文档清单只引用 NMCPS-GOV-003（不手写清单）", docs.includes("NMCPS-GOV-003") && docs.includes("doc-map"));
log("受治理文档须带 docId / tier / authority / scope / status", ["docId", "tier", "authority", "scope", "status"].every((key) => docs.includes(key)));
log("新文档须同步 doc-map 与 shared/constants/docIds.ts", docs.includes("doc-map") && docs.includes("shared/constants/docIds.ts") && docs.includes("check:doc-system"));

// ── ⑤ 工程约定 ───────────────────────────────────────
const coding = texts.get("02-coding-conventions.md") ?? "";
log("编码约定仍要求在改动后跑 typecheck / lint", coding.includes("pnpm typecheck") && coding.includes("pnpm lint"));
log(
	"编码约定记录了 runtimeConfig 改动后先 nuxt prepare（.nuxt/types 缓存坑）",
	bulletLines(coding, ["nuxt prepare"]).length === 1 && coding.includes("runtimeConfig") && coding.includes("TS2353")
);

const rust = texts.get("05-rust.md") ?? "";
log("Rust 约定仍要求 cargo build 校验", rust.includes("cargo build") && rust.includes("src-tauri"));

const git = texts.get("03-git-workflow.md") ?? "";
log("Git 约定仍要求「未明确要求不提交」", git.includes("Do not commit") && git.includes("Conventional Commit"));

// ── ⑥ CI 自查用例的环境前提 ──────────────────────────
log(
	"编码约定记录了 UI / 集成自查步骤必须给被测实例配上游（否则用例误报）",
	bulletLines(coding, ["NUXT_BFF_UPSTREAM_BASE"]).length === 1 && coding.includes("check:ui") && coding.includes("check:bff")
);

const passed = results.filter((item) => item.ok).length;
console.log(`\n${passed}/${results.length} 项通过`);
process.exit(passed === results.length ? 0 : 1);
