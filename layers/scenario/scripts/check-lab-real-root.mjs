// layers/scenario/scripts/check-lab-real-root.mjs
// `pnpm check:lab-real:root`：以 root 整跑 `check-lab-real.mjs`，让 `tc` 那一层真的断言
// 而不是打 `⏭`（非 root 只能看台账里的 `options.bw`，看不到主机 netns 里的 htb 类）。
//
// 为什么需要这层包装：`sudo` 会重置环境变量，而 nvm 的 `node` 不在 sudo 的 `secure_path` 里 ——
// `PATH` / `CHECK_REAL_MININET` / `REAL_MININET_BASE` 必须跟在 `sudo -A env …` 之后传。
// 手写这条命令容易漏（漏 `PATH` 就是「sudo: node: command not found」，漏门禁变量就是
// 「⏭ 跳过」被读成「已验」）。口令不进命令行：`sudo -A` + `.clinerules/sudo-askpass.sh`
// 只做「把 git-ignored 的 `.sudo.local` 回显给 sudo」，见 `.clinerules/09-local-sudo.md`。
//
// 空实例守卫仍在 `check-lab-real.mjs` 里（`GET /api/mininet/start` 为 false 且五类节点全空）：
// 这层不重复实现，也不替它兜底 —— 别人的拓扑一律不碰。
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "check-lab-real.mjs");
const ASKPASS = resolve(".clinerules/sudo-askpass.sh");
const REAL_BASE = process.env.REAL_MININET_BASE ?? "http://127.0.0.1:8000";

if (!existsSync(SCRIPT)) {
	console.log(`❌ 找不到 ${SCRIPT}：这层包装只负责提权，脚本本体必须存在`);
	process.exit(1);
}

/** 要跨过 sudo 的环境变量：一个都不能少（`PATH` 决定 node 能不能找到） */
const passthrough = ["CHECK_REAL_MININET", "REAL_MININET_BASE", "CHECK_REAL_IAM", "REAL_IAM_BASE", "PLAYWRIGHT_BROWSERS_PATH", "NMCPS_SUDO_PASS_FILE"];
const envPairs = [
	`PATH=${dirname(process.execPath)}:${process.env.PATH ?? "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"}`,
	"CHECK_REAL_MININET=1",
	`REAL_MININET_BASE=${REAL_BASE}`,
	...passthrough
		.filter((key) => key !== "CHECK_REAL_MININET" && key !== "REAL_MININET_BASE")
		.filter((key) => process.env[key] !== undefined)
		.map((key) => `${key}=${process.env[key]}`)
];

const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
const node = process.execPath;

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
}
