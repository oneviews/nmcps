// scripts/start-server.mjs
// 生产启动入口：先加载 `.env`，再拉起构建产物 `.output/server/index.mjs`。
//
// 为什么需要这一层：`node .output/server/index.mjs` **不会**读 `.env`（那是 Nuxt CLI 的行为），
// 所以用 `pnpm start` 起的实例如果没有从 shell 显式 export `NUXT_BFF_SESSION_SECRET`，
// 所有 `/api/lab/**` 都会回 `503 bff_auth_not_configured`（租户管理员也一样 —— 这不是角色问题）。
// 实测：缺密钥 → 503；补上 → 401 `bff_auth_required`，登录后正常。
//
// `process.loadEnvFile()` 只在变量**尚未设置**时填值，显式 export / 部署平台注入的环境变量
// 优先级更高，因此本层对「已经正确配置环境变量」的部署是零影响。
import { Buffer } from "node:buffer";
import { existsSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

const envFile = fileURLToPath(new URL("../.env", import.meta.url));

if (existsSync(envFile)) {
	try {
		process.loadEnvFile(envFile);
	} catch (error) {
		console.warn(`[start] 无法读取 ${envFile}，继续使用现有环境变量：${error instanceof Error ? error.message : String(error)}`);
	}
}

const secret = process.env.NUXT_BFF_SESSION_SECRET?.trim() ?? "";
if (Buffer.byteLength(secret, "utf8") < 32) {
	console.warn(
		"[start] NUXT_BFF_SESSION_SECRET 缺失或不足 32 字节：/api/lab/** 将回 503 bff_auth_not_configured。"
		+ " 请在环境变量或 .env 里配置后重启。"
	);
}

await import(new URL("../.output/server/index.mjs", import.meta.url).href);
