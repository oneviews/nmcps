// layers/scenario/scripts/check-lab-real-root.mjs
// `pnpm check:lab-real:root`：以 root 整跑 `check-lab-real.mjs`，让 `tc` 与 SNMP 两层真的断言
// 而不是打 `⏭`（非 root 只能看台账里的 `options.bw` / 配置串，看不到主机 netns 里的 htb 类与
// `10.0.0.2:161` 的 agent）。
//
// 为什么需要这层包装：`sudo` 会重置环境变量，而 nvm 的 `node` 不在 sudo 的 `secure_path` 里 ——
// `PATH` / `CHECK_REAL_MININET` / `REAL_MININET_BASE` 必须跟在 `sudo -A env …` 之后传。
// 手写这条命令容易漏（漏 `PATH` 就是「sudo: node: command not found」，漏门禁变量就是
// 「⏭ 跳过」被读成「已验」）。口令不进命令行：`sudo -A` + `.clinerules/sudo-askpass.sh`
// 只做「把 git-ignored 的 `.sudo.local` 回显给 sudo」，见 `.clinerules/09-local-sudo.md`。
// 后端要 `x-lab-token` 时也不把 token 拼进 `env`（那会在 `ps` 里明文可见）：这里落成 0600
// 临时文件、只传 `LAB_TOKEN_FILE=<路径>`，被测脚本读完转给 BFF，`finally` 删除。
//
// 空实例守卫仍在 `check-lab-real.mjs` 里（`GET /api/mininet/start` 为 false 且五类节点全空）：
// 这层不重复实现，也不替它兜底 —— 别人的拓扑一律不碰。
import { execFileSync } from "node:child_process";
import { chmodSync, chownSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "check-lab-real.mjs");
const ASKPASS = resolve(".clinerules/sudo-askpass.sh");
const REAL_BASE = process.env.REAL_MININET_BASE ?? "http://127.0.0.1:8000";

/**
 * 收尾：把 `.data` 下 root 名下的产物还给调用者。
 *
 * root 整跑会留下 `root:root` 的当日审计分片（`.data/audit/lab-audit-<日期>.jsonl`）。之后
 * 普通用户起的 BFF 再往同一分片追加就是 `EACCES` → 每个写端点回 503 `audit_unavailable`，
 * `check:ui` 的写用例全假红（实测 2026-11-22：11.4 四条 + 后续 Modal 卡死）。这层本来就是
 * 为了提权才存在，顺手把所有权还原是它自己的职责，不该让下一个人去猜「为什么刚才是绿的」。
 *
 * `services/mininet-api/.data` 是后端自己的产物目录（SNMP agent 的 profile / log，`NMCPS-ADR-0028`
 * §6）：11.16 起 root 跑会在那里也留下 root 文件，一起还 —— 否则普通用户起的后端写 profile 就是
 * `EACCES`，采集面直接起不来。
 */
const DATA_DIRS = [".data", "services/mininet-api/.data"];

function rootOwnedEntries(dir) {
	if (!existsSync(dir))
		return [];

	const found = [];
	const walk = (target) => {
		const info = lstatSync(target);
		if (info.uid === 0)
			found.push(target);
		if (info.isDirectory()) {
			for (const entry of readdirSync(target))
				walk(resolve(target, entry));
		}
	};

	walk(dir);
	return found;
}

/** 两个产物目录里 root 名下的条目（`.data` + 后端的 `.data`） */
function rootOwnedArtifacts() {
	return DATA_DIRS.flatMap((dir) => rootOwnedEntries(dir));
}

/** 已经是 root：自己动手 chown，还原给 `SUDO_UID:$SUDO_GID`（`sudo -i` 时可能没有） */
function restoreDataOwnershipInProcess() {
	const uid = Number(process.env.SUDO_UID ?? "");
	const gid = Number(process.env.SUDO_GID ?? "");
	if (!Number.isInteger(uid) || uid === 0)
		return 0;

	const entries = rootOwnedArtifacts();
	for (const entry of entries)
		chownSync(entry, uid, Number.isInteger(gid) ? gid : uid);
	return entries.length;
}

/**
 * 普通用户进程：自己 chown 会 `EPERM`，交给 `sudo -A`（同一次提权后的凭据缓存还在，
 * 过期也只是再走一次 askpass，不会卡在等输入）。只碰 root 名下的条目，不动别人的文件。
 */
function restoreDataOwnershipViaSudo() {
	const owned = rootOwnedArtifacts();
	if (owned.length === 0)
		return 0;

	execFileSync("sudo", [
		"-A",
		"chown",
		`${process.getuid()}:${process.getgid()}`,
		...owned
	], {
		stdio: "ignore",
		env: { ...process.env, SUDO_ASKPASS: ASKPASS }
	});
	return owned.length;
}

if (!existsSync(SCRIPT)) {
	console.log(`❌ 找不到 ${SCRIPT}：这层包装只负责提权，脚本本体必须存在`);
	process.exit(1);
}

/**
 * 真后端入口凭据（`M0` 远程化）：后端配了 `LAB_API_TOKEN` 时，准备 / 收尾的直连要带 `x-lab-token`，
 * BFF 侧要用同值的 `NUXT_MININET_TOKEN`。**不能把它拼进 `sudo -A env …`** —— 那会在 `ps` 里明文可见；
 * 这里落成 0600 临时文件，只把路径传进去，被测脚本读完自己转发给 BFF，`finally` 删除。
 */
const TOKEN = (process.env.LAB_API_TOKEN ?? process.env.NUXT_MININET_TOKEN ?? "").trim();
const TOKEN_FILE = resolve(`.data/check-lab-real-token-${process.pid}.txt`);

const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
const node = process.execPath;

if (!isRoot && TOKEN) {
	mkdirSync(dirname(TOKEN_FILE), { recursive: true });
	writeFileSync(TOKEN_FILE, TOKEN, { mode: 0o600 });
	chmodSync(TOKEN_FILE, 0o600);
}

/** 要跨过 sudo 的环境变量：一个都不能少（`PATH` 决定 node 能不能找到） */
const passthrough = ["CHECK_REAL_MININET", "REAL_MININET_BASE", "CHECK_REAL_IAM", "REAL_IAM_BASE", "PLAYWRIGHT_BROWSERS_PATH", "NMCPS_SUDO_PASS_FILE"];
const envPairs = [
	`PATH=${dirname(process.execPath)}:${process.env.PATH ?? "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"}`,
	"CHECK_REAL_MININET=1",
	`REAL_MININET_BASE=${REAL_BASE}`,
	...(TOKEN ? [`LAB_TOKEN_FILE=${TOKEN_FILE}`] : []),
	...passthrough
		.filter((key) => key !== "CHECK_REAL_MININET" && key !== "REAL_MININET_BASE")
		.filter((key) => process.env[key] !== undefined)
		.map((key) => `${key}=${process.env[key]}`)
];

if (isRoot) {
	// 已经是 root（容器 / `sudo -i` 里）：直接跑，别在 root 上再套一层 sudo
	console.log(`▶ ${node} ${SCRIPT}（已是 root，tc 层会真断言）`);
	try {
		execFileSync(node, [SCRIPT], {
			stdio: "inherit",
			env: { ...process.env, CHECK_REAL_MININET: "1", REAL_MININET_BASE: REAL_BASE }
		});
	} catch (caught) {
		process.exitCode = typeof caught?.status === "number" ? caught.status : 1;
	} finally {
		rmSync(TOKEN_FILE, { force: true });
		const restored = restoreDataOwnershipInProcess();
		if (restored > 0)
			console.log(`  ⏎ 已把 ${restored} 个 root 名下的产物还给调用者（否则普通用户的写端点会 503 audit_unavailable、采集面写不了 profile）`);
	}
	process.exit();
}

if (!existsSync(ASKPASS) || !(statSync(ASKPASS).mode & 0o111)) {
	console.log(`❌ 缺少可执行的 askpass helper：${ASKPASS}`);
	console.log("   口令只放 `.clinerules/.sudo.local`（git-ignored，chmod 600），helper 见 `.clinerules/09-local-sudo.md`");
	process.exit(1);
}

console.log(`▶ sudo -A env ${envPairs.join(" ")} ${node} ${SCRIPT}`);
try {
	execFileSync("sudo", ["-A", "env", ...envPairs, node, SCRIPT], {
		stdio: "inherit",
		env: { ...process.env, SUDO_ASKPASS: ASKPASS }
	});
} catch (caught) {
	// sudo 失败（口令错 / 无权限）或被测脚本失败：原样透出退出码，不要伪装成通过
	process.exitCode = typeof caught?.status === "number" ? caught.status : 1;
} finally {
	// 被测脚本失败也要还原：半途崩掉同样会留下 root 名下的审计分片
	rmSync(TOKEN_FILE, { force: true });
	let restored = 0;
	try {
		restored = restoreDataOwnershipViaSudo();
	} catch (caught) {
		// 还原失败不该盖掉被测结果，但必须说清楚：下一个人会撞上 503 audit_unavailable
		console.warn(`  ⚠ 还原 .data 所有权失败（${caught?.message ?? caught}）：先看 \`find .data services/mininet-api/.data -user root\``);
	}
	if (restored > 0)
		console.log(`  ⏎ 已把 ${restored} 个 root 名下的产物还给调用者（否则普通用户的写端点会 503 audit_unavailable、采集面写不了 profile）`);
}
