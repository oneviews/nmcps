// scripts/check-platform.mjs
// 平台能力面自查（无依赖、不起服务）：把 `arch.platform` 的约定变成门禁。
//
// 设计基准：NMCPS-ARCH-005（layers/content/collections/cn/architecture/1.architecture/platform-architecture.md）
// 裁决：NMCPS-ADR-0015（layers/content/collections/cn/records/adr/adr-0015.md）
//
// 断言分组：
//   ① 权限：capabilities 不得出现 `shell:allow-execute`（任意命令执行）
//   ② 探针页：5 个页面存在、`commands.vue` 已下线、meta 齐全（sort / group / tauriOnly）
//   ③ 边界：页面不直接调用 Tauri 插件，统一走 `layers/platform/app/composables`
//   ④ 导航：`useNavigation()` 支持 `tauriOnly` 过滤与分组聚合
//   ⑤ 文案：cn / en 的 `pages.platform.title` 等键齐全，`pages.commands` 已删除
//   ⑥ 文档：docId 表登记 ARCH-005 / ADR-0015 且文件存在
import { existsSync, readFileSync } from "node:fs";
import process from "node:process";

const PAGES_DIR = "layers/platform/app/pages";
const COMPOSABLES_DIR = "layers/platform/app/composables";
const PROBES = ["os", "file", "store", "notifications", "webview"];
const COMPOSABLES = ["usePlatformInfo", "usePlatformStore", "usePlatformFile", "usePlatformNotify", "usePlatformWindow", "useExternalLink"];
const CAPABILITIES = ["src-tauri/capabilities/main.json", "src-tauri/capabilities/desktop.json"];

const results = [];

function log(label, ok, detail) {
	results.push({ label, ok: !!ok });
	console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

function read(path) {
	return readFileSync(path, "utf8");
}

// ── ① 权限 ────────────────────────────────────────────
for (const file of CAPABILITIES) {
	const src = existsSync(file) ? read(file) : "";
	log(`${file} 不含 shell:allow-execute`, src !== "" && !src.includes("shell:allow-execute"));
}

// shell 插件本身也不存在：不注册、不依赖、不导出自动导入，
// 避免「注册留着、等以后放开」的回头路（裁决见 NMCPS-ADR-0015 及其后续记录）。
const SHELL_RESIDUE = [
	["src-tauri/src/lib.rs 不注册 tauri_plugin_shell", "src-tauri/src/lib.rs", "tauri_plugin_shell"],
	["src-tauri/Cargo.toml 不声明 tauri-plugin-shell", "src-tauri/Cargo.toml", "tauri-plugin-shell"],
	["package.json 不依赖 @tauri-apps/plugin-shell", "package.json", "@tauri-apps/plugin-shell"],
	["modules/tauri.ts 不导出 shell 自动导入", "modules/tauri.ts", "plugin-shell"]
];

for (const [label, file, needle] of SHELL_RESIDUE) {
	const src = existsSync(file) ? read(file) : "";
	log(label, src !== "" && !src.includes(needle));
}

// ── ② 探针页 ──────────────────────────────────────────
log(`${PAGES_DIR}/commands.vue 已下线`, !existsSync(`${PAGES_DIR}/commands.vue`));

for (const name of PROBES) {
	const path = `${PAGES_DIR}/${name}.vue`;

	if (!existsSync(path)) {
		log(`探针页存在：${name}.vue`, false, "文件缺失");
		continue;
	}

	const src = read(path);
	const metaReady = /sort:\s*\d+/.test(src) && /group:\s*"platform"/.test(src) && /tauriOnly:\s*true/.test(src);
	log(`探针页 meta 齐全：${name}.vue`, metaReady, metaReady ? "" : "需要 sort / group / tauriOnly");
}

// ── ③ 边界 ────────────────────────────────────────────
for (const name of COMPOSABLES) {
	log(`组合式存在：${name}`, existsSync(`${COMPOSABLES_DIR}/${name}.ts`));
}

for (const name of PROBES) {
	const path = `${PAGES_DIR}/${name}.vue`;

	if (!existsSync(path))
		continue;

	const src = read(path);
	log(`${name}.vue 不直接调用 Tauri 插件`, !/useTauri(?:Fs|Store|Notification|Opener|Os|WebviewWindow)\w*\(/.test(src));
}

// ── ④ 导航 ────────────────────────────────────────────
{
	const src = read("app/composables/useNavigation.ts");
	log("导航支持 tauriOnly 过滤", src.includes("meta.tauriOnly") && src.includes("isTauriHost"));
	log("导航支持分组聚合（meta.group）", src.includes("meta.group") && src.includes("GROUP_ICONS"));
}

// ── ⑤ 文案 ────────────────────────────────────────────
for (const locale of ["cn", "en"]) {
	const messages = JSON.parse(read(`i18n/locales/${locale}.json`));
	const pages = messages.pages ?? {};

	log(`文案 ${locale}：pages.platform.title 存在`, !!pages.platform?.title);
	log(`文案 ${locale}：pages.commands 已删除`, pages.commands === undefined);
	log(
		`文案 ${locale}：file scope 与 webview desktopOnly 齐全`,
		!!pages.file?.scopeDesktop && !!pages.file?.scopeMobile && !!pages.webview?.desktopOnly
	);
}

// ── ⑥ 文档 ────────────────────────────────────────────
{
	const docIds = read("shared/constants/docIds.ts");
	log("docId 表登记 NMCPS-ARCH-005", docIds.includes("NMCPS-ARCH-005"));
	log("docId 表登记 NMCPS-ADR-0015", docIds.includes("NMCPS-ADR-0015"));
	log(
		"平台能力文档存在（cn / en）",
		existsSync("layers/content/collections/cn/architecture/1.architecture/platform-architecture.md")
		&& existsSync("layers/content/collections/en/architecture/1.architecture/platform-architecture.md")
	);
}

const passed = results.filter((item) => item.ok).length;
const failed = results.filter((item) => !item.ok);

console.log(`\n${passed}/${results.length} 项通过`);
if (failed.length) {
	console.log("失败项：");
	for (const item of failed)
		console.log(`  - ${item.label}`);
	process.exitCode = 1;
}
