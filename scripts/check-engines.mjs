// scripts/check-engines.mjs
// 引擎分层静态守卫 + dryrun 引擎行为自检（NMCPS-DESIGN-008 M0）。
//
// 两件事各测一半：
//   1. 静态：`import mininet` / `mn_wifi` 只允许出现在 `engines/` 与**冻结的 legacy 名单**里。
//      名单以外的文件新出现一次 import 就变红 —— 这正是「M1 把 api.py 拆成适配器」的进度尺。
//   2. 行为：`python3` 直接跑 dryrun 会话链路（会话 → 节点 → 链路 → 起停 → 删除），
//      只依赖标准库，CI 里没有 fastapi / mininet / root 也能过。
//
// 不做的事：不启动 uvicorn、不建真网络。那两条在 `pnpm check:simulation` / `pnpm check:lab-real`。

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const SERVICE_DIR = "services/mininet-api";
const PACKAGE_DIR = path.join(SERVICE_DIR, "mininet_gui_backend");
const ENGINES_DIR = path.join(PACKAGE_DIR, "engines");

/** 引擎层落地前就在 `import mininet` 的文件；M1 每搬走一个就从这里删一个，不允许新增。 */
const LEGACY_MININET_IMPORTERS = new Set(["api.py", "export.py", "schema.py", "nodes.py", "cli.py"]);

const REQUIRED_MODULES = [
	"engines/__init__.py",
	"engines/base.py",
	"engines/registry.py",
	"engines/dryrun.py",
	"engines/wired.py",
	"engines/wireless.py",
	"sessions.py",
	"auth.py"
];

const MININET_IMPORT = /^\s*(?:from|import)\s+(?:mininet|mn_wifi)\b/m;

const results = [];

function log(label, ok, detail) {
	results.push({ label, ok: !!ok });
	console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

function pythonFiles(dir) {
	const entries = readdirSync(dir, { recursive: true, withFileTypes: true });
	return entries
		.filter((entry) => entry.isFile() && entry.name.endsWith(".py"))
		.map((entry) => path.relative(PACKAGE_DIR, path.join(entry.parentPath ?? entry.path, entry.name)));
}

if (!existsSync(PACKAGE_DIR)) {
	console.error(`❌ 缺少后端包目录 ${PACKAGE_DIR}`);
	process.exit(1);
}

const missingModules = REQUIRED_MODULES.filter((relative) => !existsSync(path.join(PACKAGE_DIR, relative)));
log("引擎层文件齐全（base / registry / dryrun / wired / wireless + sessions / auth）", missingModules.length === 0, missingModules.join(", ") || `${REQUIRED_MODULES.length} 个`);

const files = pythonFiles(PACKAGE_DIR);

// ① 名单冻结：谁 import mininet / mn_wifi 必须与 LEGACY_MININET_IMPORTERS 完全一致
const importers = files.filter((relative) => MININET_IMPORT.test(readFileSync(path.join(PACKAGE_DIR, relative), "utf8")));
const outsideEngines = importers.filter((relative) => !relative.startsWith("engines/"));
const unexpected = outsideEngines.filter((relative) => !LEGACY_MININET_IMPORTERS.has(relative));
const stale = [...LEGACY_MININET_IMPORTERS].filter((relative) => !outsideEngines.includes(relative));
log(
	"`import mininet` 只在 engines/ 与冻结的 legacy 名单里",
	unexpected.length === 0 && stale.length === 0,
	`新增=${unexpected.join(", ") || "无"} 已迁走但名单未更新=${stale.join(", ") || "无"}`
);

// ② 无线依赖不能进顶层：`wireless.py` 只能 `find_spec("mn_wifi")`
const wirelessSource = readFileSync(path.join(ENGINES_DIR, "wireless.py"), "utf8");
log(
	"wireless.py 顶层不 import mn_wifi（只用 find_spec 探测）",
	!/^\s*(?:from|import)\s+mn_wifi\b/m.test(wirelessSource) && wirelessSource.includes("find_spec(\"mn_wifi\")"),
	"顶层 import 会让无无线依赖的机器起不来后端"
);

// ③ 会话 / 引擎必须在 api 启动路径上真正接上，而不是写了模块没人调
const apiSource = readFileSync(path.join(PACKAGE_DIR, "api.py"), "utf8");
log(
	"api.py 启动时登记引擎 + 建会话表 + 挂入口鉴权",
	["register_builtin_engines()", "SessionStore()", "install_lab_auth(app)"].every((needle) => apiSource.includes(needle)),
	"缺一行就等于会话层只是死代码"
);

log(
	"api.py 暴露 /api/simulation/** 会话端点",
	["/api/simulation/engines", "/api/simulation/sessions", "/start", "/stop", "/nodes", "/links"].every((needle) => apiSource.includes(needle)),
	"端点缺失时 BFF 无从接入"
);

// ④ 行为自检：dryrun 全链路（无 root / 无 fastapi / 无 mininet）
const selfTest = String.raw`
import asyncio
import sys

sys.path.insert(0, "services/mininet-api")

from mininet_gui_backend import auth
from mininet_gui_backend.engines import (
    EngineConflict,
    EngineError,
    EngineInvalidRequest,
    EngineNotFound,
    LinkSpec,
    NodeSpec,
    get_engine,
    register_builtin_engines,
)
from mininet_gui_backend.sessions import SessionStore

if "mininet.net" in sys.modules:
    raise AssertionError("引擎层在导入时拉起了 mininet（dryrun 必须无 root 可用）")

register_builtin_engines()
engine = get_engine("dryrun")
if not engine.availability().available:
    raise AssertionError("dryrun 引擎报告不可用")


async def main():
    store = SessionStore()
    record = await store.create("dryrun", "parity-smoke")
    if record.state != "created":
        raise AssertionError("新会话状态=" + record.state)

    store.add_node(record.id, NodeSpec(id="h1", type="host"))
    store.add_node(record.id, NodeSpec(id="s1", type="switch"))
    store.add_link(record.id, LinkSpec(id="h1--s1", src="h1", dst="s1", options={"bw": 10}))

    live = store.status(record.id)["live"]
    if live["node_count"] != 2 or live["link_count"] != 1:
        raise AssertionError("节点 / 链路记账不对：" + str(live))

    try:
        store.add_node(record.id, NodeSpec(id="h1", type="host"))
    except EngineError:
        pass
    else:
        raise AssertionError("重复节点 id 没有报冲突")

    await store.start(record.id)
    if store.status(record.id)["live"]["started"] is not True:
        raise AssertionError("start 后 started 不是 True")
    await store.stop(record.id)
    if store.status(record.id)["live"]["started"] is not False:
        raise AssertionError("stop 后 started 不是 False")

    # M1.2（NMCPS-ADR-0029 D2 / D4）：部分更新的三档生效语义 + 投影响应
    layout_node = store.update_node(record.id, "h1", {"x": 15, "y": 25})
    if not layout_node["applied"] or layout_node["node"]["x"] != 15.0 or layout_node["node"]["y"] != 25.0:
        raise AssertionError("改位置没恒生效 / 投影没带新坐标：" + str(layout_node))
    if set(layout_node["node"]) != {"id", "type", "name", "x", "y", "attributes"}:
        raise AssertionError("更新响应不是统一节点投影：" + str(layout_node))

    queued = store.update_node(record.id, "h1", {"attributes": {"ip": "10.0.0.9/24"}})
    if queued["applied"] or queued["node"]["attributes"].get("ip") != "10.0.0.9/24":
        raise AssertionError("停网改属性应是 applied=false 且台账已写：" + str(queued))

    try:
        store.update_node(record.id, "s1", {"attributes": {"ofVersion": "OpenFlow13"}})
    except EngineConflict:
        pass
    else:
        raise AssertionError("停网改 OpenFlow 版本没有回 409（live 档兑现不了）")

    for bad in ({"name": "h1x"}, {"attributes": {"mac": "00:00:00:00:00:09"}}, {"attributes": {"nope": 1}}):
        try:
            store.update_node(record.id, "h1", bad)
        except EngineInvalidRequest:
            pass
        else:
            raise AssertionError("不可变 / 未登记字段没有被拒绝：" + str(bad))

    link_update = store.update_link(record.id, "h1--s1", {"options": {"bw": 25}})
    if link_update["applied"] or link_update["link"]["options"].get("bw") != 25:
        raise AssertionError("停网改链路应是 applied=false 且台账已写：" + str(link_update))

    await store.start(record.id)
    live_node = store.update_node(record.id, "h1", {"attributes": {"ip": "10.0.0.10/24"}})
    if not live_node["applied"] or live_node["node"]["attributes"].get("ip") != "10.0.0.10/24":
        raise AssertionError("运行中改属性应是 applied=true：" + str(live_node))

    live_link = store.update_link(record.id, "h1--s1", {"options": {"bw": 30}})
    if not live_link["applied"]:
        raise AssertionError("运行中改链路应是 applied=true")
    await store.stop(record.id)

    store.remove_node(record.id, "h1")
    if store.status(record.id)["live"]["link_count"] != 0:
        raise AssertionError("删节点后挂在上面的链路没有回收")

    await store.delete(record.id)
    try:
        store.get(record.id)
    except EngineError:
        pass
    else:
        raise AssertionError("删除后会话仍然可读")

    try:
        get_engine("no-such-engine")
    except EngineNotFound:
        pass
    else:
        raise AssertionError("未知引擎名没有报 404")


asyncio.run(main())

if not auth.is_loopback("127.0.0.1") or not auth.is_loopback("::1"):
    raise AssertionError("回环判定漏了 127.0.0.1 / ::1")
if auth.is_loopback("192.0.2.10"):
    raise AssertionError("公网地址被当成回环")

signature = auth.ws_signature("token-abc", "/api/mininet/logs", "1000")
if not auth.verify_ws_signature("token-abc", "/api/mininet/logs", "1000", signature, now=1000):
    raise AssertionError("合法签名没有通过")
if auth.verify_ws_signature("token-abc", "/api/mininet/logs", "1000", signature, now=1121):
    raise AssertionError("过期签名（121 秒）仍然通过")
if auth.verify_ws_signature("token-abc", "/api/mininet/terminal/h1", "1000", signature, now=1000):
    raise AssertionError("签名能换到别的通道上使用（未绑定路径）")

print("engine-self-test-ok")
`;

const selfTestRun = spawnSync("python3", ["-"], { input: selfTest, encoding: "utf8" });
log(
	"dryrun 会话链路（会话 / 节点 / 链路 / 起停 / 删除 / 更新） + 签名校验",
	selfTestRun.status === 0 && selfTestRun.stdout.includes("engine-self-test-ok"),
	selfTestRun.status === 0
		? "无 root、无 fastapi、无 mininet"
		: (selfTestRun.stderr || selfTestRun.stdout).trim().split("\n").slice(-2).join(" ")
);

// ⑤ 行为自检：wired 统一节点 / 链路适配（`scripts/check-wired-adapter.py`）
//
// 为什么不连真后端：真 wired 要 root，而本脚本是每个 PR 都跑的零依赖守卫。适配层只做
// 形状转换与错误归一，把它和 legacy 的边界（`api.Host` / `create_host` / `api.app.*` 台账）
// 用桩固定住，就能在没有 Mininet 的机器上验证 M1 的统一节点契约。
const wiredRun = spawnSync("python3", ["scripts/check-wired-adapter.py"], { encoding: "utf8" });
log(
	"wired 统一节点 / 链路适配（桩 api：映射 / 错误归一 / 台账计数）",
	wiredRun.status === 0 && wiredRun.stdout.includes("wired-adapter-ok"),
	wiredRun.status === 0
		? "无 root、无 mininet、无 fastapi"
		: (wiredRun.stderr || wiredRun.stdout).trim().split("\n").slice(-2).join(" ")
);

const passed = results.filter((item) => item.ok).length;
console.log(`\n${passed}/${results.length} 项通过`);
process.exitCode = passed === results.length ? 0 : 1;
