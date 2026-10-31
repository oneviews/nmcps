import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import process from "node:process";

const DEFAULT_PORT = 3000;
/** Nuxt 用来阻止同目录并行起两个 dev server 的锁文件 */
const NUXT_LOCK_FILE = ".nuxt/nuxt.lock";

interface DevServerLock {
	pid: number
	port: number
	url: string
}

/**
 * 读 Nuxt 的 dev server 锁。`pnpm tauri:dev` 换端口只解决「端口被占」，
 * 绕不过「本目录已有一个 dev server」——那一步会直接报 ActionableError（实测 2026-10-31）。
 */
function readDevServerLock(): DevServerLock | null {
	try {
		const parsed = JSON.parse(readFileSync(NUXT_LOCK_FILE, "utf8")) as Partial<DevServerLock>;
		if (typeof parsed.pid !== "number" || typeof parsed.port !== "number")
			return null;
		return { pid: parsed.pid, port: parsed.port, url: parsed.url ?? `http://localhost:${parsed.port}` };
	} catch {
		return null;
	}
}

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/** 探活期间自带失败提示：让 `pnpm tauri:dev` 在编译 Rust 之前就报清楚，而不是编译完再 panic */
function assertReadyToLaunch(): void {
	const lock = readDevServerLock();

	if (lock && isAlive(lock.pid)) {
		console.error(`✖ 本目录已有 Nuxt dev server 在跑（pid ${lock.pid}，${lock.url}），Nuxt 不允许同目录再起一个。`);
		console.error(`  · 先停掉它：kill ${lock.pid}`);
		console.error("  · 或改在另一个工作目录跑桌面壳（devUrl 指向同一个 dev server）");
		process.exit(1);
	}

	if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
		console.error("✖ 没有可用的显示服务（`DISPLAY` / `WAYLAND_DISPLAY` 均为空），Tauri 窗口起不来（`gtk::rt::init` 会 panic）。");
		console.error("  · 桌面环境下请在图形会话里执行；容器 / 远程主机需先起 Xvfb 或转发 X11");
		console.error("  · 只想验证 Rust 侧编译：cargo build --manifest-path src-tauri/Cargo.toml");
		process.exit(1);
	}
}

function isPortAvailable(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const server = createServer();
		server.once("error", () => resolve(false));
		server.once("listening", () => {
			server.close(() => resolve(true));
		});
		server.listen(port, "0.0.0.0");
	});
}

async function findAvailablePort(startPort: number): Promise<number> {
	for (let port = startPort; port < startPort + 100; port++) {
		if (await isPortAvailable(port)) {
			return port;
		}
	}
	throw new Error(`No available port found in range ${startPort}-${startPort + 99}`);
}

async function main(): Promise<void> {
	assertReadyToLaunch();

	const port = await findAvailablePort(DEFAULT_PORT);

	if (port !== DEFAULT_PORT) {
		console.log(`Port ${DEFAULT_PORT} is busy, using port ${port}`);
	}

	const tauriConfig = JSON.stringify({
		build: {
			devUrl: `http://localhost:${port}`,
			beforeDevCommand: `pnpm dev --port ${port}`
		}
	});

	const tauri = spawn("pnpm", ["tauri", "dev", "--config", tauriConfig], {
		stdio: "inherit",
		shell: process.platform === "win32",
		cwd: process.cwd()
	});

	tauri.on("close", (code) => {
		process.exit(code ?? 0);
	});
}

main();
