import { readFileSync, writeFileSync } from "node:fs";
import { defineConfig } from "bumpp";

// 侧边栏版本号的事实源（app.version）不在清单文件里，bumpp 的文本替换会误改 downloads 段的资产版本，故单独精确改写
const APP_CONFIG_PATH = "app/app.config.ts";
const APP_VERSION_PATTERN = /(app:\s*\{[\s\S]*?\bversion:\s*")([^"]+)(")/;

export default defineConfig({
	release: "prompt",
	commit: false,
	tag: false,
	push: false,
	files: [
		"package.json",
		"src-tauri/tauri.conf.json",
		"src-tauri/Cargo.toml"
	],
	/** 同步 app/app.config.ts 的 app.version（仅该字段，保持 downloads 段不变） */
	execute({ state }) {
		const source = readFileSync(APP_CONFIG_PATH, "utf8");
		const next = source.replace(APP_VERSION_PATTERN, `$1${state.newVersion}$3`);

		if (next === source)
			throw new Error(`[bump] 未在 ${APP_CONFIG_PATH} 中定位到 app.version 字段`);

		writeFileSync(APP_CONFIG_PATH, next);
	}
});
