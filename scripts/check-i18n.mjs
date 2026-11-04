// scripts/check-i18n.mjs
// 文案自查（无依赖、不起服务）：把多语言的「键齐、占位符齐、没混语言」变成门禁。
//
// 背景：系统管理的策略 / 权限两页换新代接口时，文案是按页面重写的，最容易漏的是
// ① 一个键被当成两种用途（标签 + 提示），渲染出来只剩一个词；
// ② 转义过的 JSON 示例被写进文案（`{'{...}'}`），占位符里多出一对引号；
// ③ 英文值里混进中文、占位符两边不一致、键只在一边存在。
//
// 断言分组：
//   ① 文件集：`i18n/locales` 只有 cn / en 两份，且都能 parse
//   ② 键齐：两份的键集合完全一致（打印差集）
//   ③ 语言：en 的值不得含中文（数据由上游给，不进文案）
//   ④ 形状：值非空、无首尾空白、无双空格、无 `{'...'}` 转义引号残留（vue-i18n 的字面量转义除外）
//   ⑤ 占位符：同一个键在两份里的 `{name}` 集合一致
//   ⑥ 使用：`layers/system` 里引用的 `pages.system-*` 键必须在两份里都存在（否则界面露键名）
//   ⑦ 模板：`.vue` 的 `<template>` 段不得硬编码中文（可见文案只能来自 i18n；注释剥离后判定）
//   ⑧ 全站：`app` 与 `layers/*/app` 里 `t()` / `$t()` / `tm()` 的字面量键必须在两份里都存在
//      —— ⑥ 只看系统管理页的 `pages.system-*`（含命名空间常量），⑧ 把同一口径铺到全部域
//      ⑥ / ⑧ 共用 `auditUsage()`：只有采样器不同（⑥ 按文本匹配、⑧ 按 `t()` 实参），
//      前缀判定按「静态部分是否落在段边界」分 segment / open 两种，防止 `pages.system-log`
//      被 `pages.system-login` 顶替，同时不把 `pages.content-` + `${section}` 误报成缺键
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const LOCALES_DIR = "i18n/locales";
const LOCALES = ["cn", "en"];
/** 引用面：这些目录里的 `t()` / `$t()` 用到 `pages.system-*` 键 */
const USAGE_DIRS = ["layers/system/app"];
/** 全站引用面：`app` 与每个 `layers/<layer>/app` 都要查（⑧） */
const USAGE_ALL_DIRS = [
	"app",
	...(existsSync("layers")
		? readdirSync("layers", { withFileTypes: true })
			.filter((entry) => entry.isDirectory() && existsSync(join("layers", entry.name, "app")))
			.map((entry) => join("layers", entry.name, "app"))
		: [])
];
/** 模板面：这些目录里的 `.vue` 的 `<template>` 段不得写死中文 */
const TEMPLATE_DIRS = ["app", "layers"];
const CJK = /[\u4E00-\u9FFF]/;
const PLACEHOLDER = /\{(\w+)\}/g;
/**
 * vue-i18n 的字面量转义：`@` / `|` 在消息语法里有含义，`{` / `}` 会被当成占位符，
 * 因此 `{'@'}`、`{'|'}`、`{'{'}`、`{'}'}` 是**正确**写法，不算「转义引号残留」。
 * 反例是把整段 JSON 包进引号（`{'[...]'}`）：界面上会多出一对单引号。
 */
const I18N_LITERAL_ESCAPE = /\{'[@|{}]'\}/g;
/** 值里允许出现中文的键：语言名本身是母语写法（en.json 的 `language.cn`） */
const NATIVE_LABEL_KEYS = /^language\./;

const results = [];

function log(label, ok, detail) {
	results.push({ label, ok: !!ok });
	console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

function flatten(object, prefix = "") {
	const out = new Map();

	for (const [key, value] of Object.entries(object)) {
		const path = prefix ? `${prefix}.${key}` : key;

		if (value && typeof value === "object" && !Array.isArray(value)) {
			for (const [childKey, childValue] of flatten(value, path))
				out.set(childKey, childValue);
			continue;
		}

		out.set(path, value);
	}

	return out;
}

function placeholders(value) {
	return [...String(value).matchAll(PLACEHOLDER)].map((match) => match[1]).sort().join(",");
}

function walk(dir) {
	if (!existsSync(dir))
		return [];

	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);

		if (entry.isDirectory())
			return walk(path);

		return /\.(?:vue|ts)$/.test(entry.name) ? [path] : [];
	});
}

/** 解析后的两份扁平键表：`locale → Map<key, value>`，①–⑤ 填，⑥ / ⑧ 读 */
const messages = new Map();

/**
 * 引用闭合审计（⑥ / ⑧ 共用）：把代码里出现的键与前缀对齐两份 locale。
 *
 * 前缀分两种，判据是「静态部分的末尾有没有落在段边界上」：
 * - `segment`（`pages.system-log.` / `pages.content-${x}.title` 的前缀）：只认 `prefix.` 开头的键，
 *   否则 `pages.system-log` 会被 `pages.system-login` 假冒命中；
 * - `open`（`pages.content-${section}` 断在段中间 → `pages.content-`）：只能认「任意以该前缀开头的键」，
 *   否则「前缀合法但换了段」会被误判成缺键。
 *
 * @param {string[]} dirs 扫描目录
 * @param {(source: string, exact: Set<string>, prefixes: Map<string, "segment" | "open">) => void} collect 采样器
 */
function auditUsage(dirs, collect) {
	const sources = dirs.flatMap(walk);
	const exact = new Set();
	const prefixes = new Map();

	for (const path of sources)
		collect(readFileSync(path, "utf8"), exact, prefixes);

	const hasKey = (locale, key) => messages.get(locale).has(key);
	const hasPrefix = (locale, prefix, kind) => {
		const keys = [...messages.get(locale).keys()];

		return kind === "open"
			? keys.some((key) => key.startsWith(prefix))
			: keys.some((key) => key.startsWith(`${prefix}.`));
	};
	// 命名空间常量（`policyErrorKey(error, "pages.system-policy")`）不是叶子键：
	// 只有它在两份里都没有、但下面有键时，按 segment 前缀断言，不算缺键
	const namespacePrefixes = new Map(prefixes);
	const missingKeys = [];

	for (const key of exact) {
		if (LOCALES.every((locale) => hasKey(locale, key)))
			continue;
		if (LOCALES.every((locale) => hasPrefix(locale, key, "segment"))) {
			namespacePrefixes.set(key, "segment");
			continue;
		}
		missingKeys.push(key);
	}

	const emptyPrefixes = [...namespacePrefixes].filter(([prefix, kind]) => {
		return LOCALES.some((locale) => !hasPrefix(locale, prefix, kind));
	}).map(([prefix]) => prefix).sort();

	return {
		files: sources.length,
		exact: exact.size,
		prefixes: namespacePrefixes.size,
		missing: [...missingKeys.sort(), ...emptyPrefixes.map((prefix) => `${prefix}*`)]
	};
}

/** ⑥ 的采样：`layers/system` 里任何位置出现的 `pages.system-*` 字面量（含命名空间常量、非 `t()` 调用处） */
function collectSystemPageKeys(source, exact, prefixes) {
	for (const match of source.matchAll(/pages\.system-[\w.-]*/g)) {
		const raw = match[0];
		const next = source[match.index + raw.length] ?? "";

		// `pages.system-log.${kind}` / `pages.system-log.filter.` 这类是动态拼接：
		// 只能断言「前缀下有键」，不能当成完整键
		if (next === "$" || raw.endsWith(".")) {
			const head = raw.replace(/\.$/, "");

			if (head)
				prefixes.set(head, raw.endsWith(".") ? "segment" : "open");
			continue;
		}

		exact.add(raw);
	}
}

/** ⑧ 的采样：`t()` / `$t()` / `tm()` 的第一个实参为字面量时取键 */
function collectTranslationKeys(source, exact, prefixes) {
	// 前置 `(?<![\w$])` 排除 `split(` / `format(` / `parseInt(` 这类以 t 结尾的其它函数名；
	// 实参不是字面量（变量、函数返回值）时无从静态判定，交由运行时断言兜底
	for (const match of source.matchAll(/(?<![\w$])\$?(?:tm|t)\(\s*(["'`])([^"'`\n]{1,160})\1/g)) {
		const raw = match[2];
		const dynamicAt = raw.indexOf("${");
		// 静态部分 = 到 `${` 为止（无插值则整串），末尾的 `.` 决定它是段边界还是段中间
		const staticPart = dynamicAt >= 0 ? raw.slice(0, dynamicAt) : raw;
		const head = staticPart.replace(/\.$/, "");

		if (dynamicAt >= 0 || raw.endsWith(".")) {
			if (head)
				prefixes.set(head, staticPart.endsWith(".") ? "segment" : "open");
			continue;
		}

		exact.add(raw);
	}
}

// ── ① 文件集 ──────────────────────────────────────────
const files = existsSync(LOCALES_DIR) ? readdirSync(LOCALES_DIR).filter((name) => name.endsWith(".json")).sort() : [];

log(`${LOCALES_DIR} 只有 cn.json / en.json`, files.join(",") === "cn.json,en.json", files.join(",") || "目录为空");

for (const locale of LOCALES) {
	const path = join(LOCALES_DIR, `${locale}.json`);

	if (!existsSync(path)) {
		log(`${path} 存在`, false);
		continue;
	}

	try {
		messages.set(locale, flatten(JSON.parse(readFileSync(path, "utf8"))));
		log(`${path} 可 parse`, true, `${messages.get(locale).size} 个键`);
	} catch (error) {
		log(`${path} 可 parse`, false, error instanceof Error ? error.message : String(error));
	}
}

// ── ② 键齐 ────────────────────────────────────────────
if (messages.size === LOCALES.length) {
	const [first, second] = LOCALES;
	const onlyFirst = [...messages.get(first).keys()].filter((key) => !messages.get(second).has(key));
	const onlySecond = [...messages.get(second).keys()].filter((key) => !messages.get(first).has(key));

	log(
		`${first} / ${second} 键集合一致`,
		onlyFirst.length === 0 && onlySecond.length === 0,
		onlyFirst.length || onlySecond.length ? `只在 ${first}: ${onlyFirst.join(", ") || "无"}；只在 ${second}: ${onlySecond.join(", ") || "无"}` : `${messages.get(first).size} 个键`
	);
}

// ── ③④ 语言与形状 ────────────────────────────────────
for (const locale of LOCALES) {
	const table = messages.get(locale);

	if (!table)
		continue;

	const problems = [];

	for (const [key, value] of table) {
		if (typeof value !== "string") {
			problems.push(`${key}（值不是字符串）`);
			continue;
		}

		const marks = [];
		const trimmed = value.replace(I18N_LITERAL_ESCAPE, "");

		if (value.trim() === "")
			marks.push("空值");
		if (value !== value.trim())
			marks.push("首尾空白");
		if (value.includes("  "))
			marks.push("连续空格");
		if (trimmed.includes("{'") || trimmed.includes("'}"))
			marks.push("转义引号残留");
		if (locale === "en" && !NATIVE_LABEL_KEYS.test(key) && CJK.test(value))
			marks.push("混入中文");

		if (marks.length)
			problems.push(`${key}（${marks.join(" / ")}）`);
	}

	log(`${locale}.json 的值形状合规（非空 / 无首尾空白 / 无双空格 / 无转义引号残留）`, problems.length === 0, problems.slice(0, 8).join("；") || `${table.size} 个值`);
}

// ── ⑤ 占位符 ──────────────────────────────────────────
if (messages.size === LOCALES.length) {
	const [first, second] = LOCALES;
	const mismatched = [];

	for (const [key, value] of messages.get(first)) {
		const other = messages.get(second).get(key);

		if (typeof other !== "string")
			continue;
		if (placeholders(value) !== placeholders(other))
			mismatched.push(`${key}（${first}: {${placeholders(value)}} vs ${second}: {${placeholders(other)}}）`);
	}

	log(`${first} / ${second} 占位符一致`, mismatched.length === 0, mismatched.slice(0, 8).join("；") || "全部一致");
}

// ── ⑥ 使用面 ──────────────────────────────────────────
if (messages.size === LOCALES.length) {
	const audit = auditUsage(USAGE_DIRS, collectSystemPageKeys);

	log(
		`${USAGE_DIRS.join(", ")} 引用的 ${audit.exact} 个完整键 / ${audit.prefixes} 个动态前缀两份都在`,
		audit.missing.length === 0,
		audit.missing.slice(0, 8).join("；") || `${audit.exact} / ${audit.prefixes}`
	);
}

// ── ⑦ 模板 ────────────────────────────────────────────
{
	const hardcoded = [];
	const files = TEMPLATE_DIRS.flatMap(walk).filter((path) => path.endsWith(".vue"));

	for (const path of files) {
		const source = readFileSync(path, "utf8");
		// 取首个 `<template>` 到最后一个 `</template>`（模板内的 `<template #slot>` 也算在内），
		// 再把 HTML 注释剥离 —— 注释里写中文是允许的，可见文案不是
		const block = /<template>([\s\S]*)<\/template>/.exec(source)?.[1] ?? "";
		const visible = block.replace(/<!--[\s\S]*?-->/g, "");

		for (const line of visible.split("\n")) {
			if (CJK.test(line))
				hardcoded.push(`${path}: ${line.trim().slice(0, 40)}`);
		}
	}

	log(
		`${TEMPLATE_DIRS.join(", ")} 下 ${files.length} 个 .vue 的 <template> 无硬编码中文`,
		hardcoded.length === 0,
		hardcoded.slice(0, 8).join("；") || "全部走 i18n"
	);
}

// ── ⑧ 全站引用面 ──────────────────────────────────────
if (messages.size === LOCALES.length) {
	const audit = auditUsage(USAGE_ALL_DIRS, collectTranslationKeys);

	log(
		`${USAGE_ALL_DIRS.length} 个域的 ${audit.files} 个文件里 t() 字面量 ${audit.exact} 个完整键 / ${audit.prefixes} 个动态前缀两份都在`,
		audit.missing.length === 0,
		audit.missing.slice(0, 8).join("；") || `${audit.exact} / ${audit.prefixes}`
	);
}

// ── 总结 ──────────────────────────────────────────────
const failed = results.filter((item) => !item.ok);

console.log(`\n${failed.length === 0 ? "✅" : "❌"} 文案自查 ${results.length - failed.length}/${results.length} 通过`);

if (failed.length)
	process.exitCode = 1;
