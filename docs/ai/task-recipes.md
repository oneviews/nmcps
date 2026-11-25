# AI 任务配方

每个配方都从**仓库根目录**执行。先读 `docs/ai/repo-map.md`，再按影响面顺序改。

## 新增/修改 Mininet REST 接口

1. 改 `services/mininet-api/mininet_gui_backend/api.py` 与 `schema.py`。
2. 运行 `pnpm lab:check`，确认后端可导入、路由存在。
3. 运行 `pnpm contracts:gen` 刷新 `packages/contracts/openapi/mininet.json`。
4. 在 `layers/scenario/shared/constants/mininetRoutes.ts` 增加逐端点白名单；只读阶段只加 `GET`，写端点不得登记。
5. 更新 `packages/mininet-client` 的调用与类型（尚未创建时先落最小客户端）。
6. 更新 `layers/scenario` 页面/composable，禁止直连 `:8000`。
7. 跑 `pnpm contracts:check && pnpm build:server && pnpm check:lab-bff && pnpm lint && pnpm typecheck`。

## 新增 Lab 页面

1. 在 `layers/scenario/app/pages/scenario/` 建页面，路由沿用 `/scenario/*`；仿真网只读页是 `simulator.vue`。
2. 文案写进 `i18n/locales/{cn,en}.json`，两边 key 一致。
3. 通过 `useApi()` 或 `mininet-client` 取数，不写 axios。
4. 页面数据加载用 `client-only`，避免 SSR 访问本地实验服务。
5. 跑 `pnpm check:i18n && pnpm lint && pnpm typecheck`。
6. 改完前端再跑 `pnpm check:ui`：它跑的是构建产物，脚本会先比时间戳，产物比源码旧就停下并提示 `pnpm build:server` —— 先构建，别无脑重跑。

## 修改 WebSocket

1. 改 `services/mininet-api` 的 WS 处理逻辑。
2. 在 `layers/scenario/shared/constants/labWs.ts` 的 `LAB_WS_UPSTREAMS` 登记通道：`upstream`、`permission`、`targetRequired`、`targetKind`（`network` / `node` / `node-intf` / `none`，决定 `target` 怎么校验）、`clientToUpstream`（只有终端是 `true`）。上游地址不是常量时改 `labWsUpstreamPath()`（终端拼路径段、监控拼 `?node=&intf=`）。
3. 新建 `layers/scenario/server/routes/mininet-ws/<kind>.ts`，内容只有 `export default createLabWsRelay("<kind>")`：验票 / 连上游 / 透传 / 审计都在 `layers/scenario/server/utils/bff/labWsRelay.ts`，不要复制第二份。
4. `layers/scenario/server/api/mininet/ws-ticket.post.ts` 已按 `targetKind` 判形状与台账收窄（`network` 等于本网 id；`node` / `node-intf` 在 `resources.nodes` 已登记时只放行清单内节点）。新增通道若引入新的 `target` 语义，改 `labWsTargetError()` / `labWsTargetParts()`，不要在 handler 里另写一套判断。未登记种类必须继续回 `400 lab_ws_kind_invalid`。
5. 页面侧在 `layers/scenario/app/composables/` 消费：抓包用 `useLabSnifferStream()`（含历史回填），日志 / 监控用 `useLabWsChannel(kind)`（`lines` / `text` / `status` / `send`），Webshell 用 `useLabTerminalSessions()`（每个节点一条 socket + 一条标签，`open` / `close` / `send` / `clear`），组件里不出现 `new WebSocket`。归一（监控采样、日志行、终端转写）放 `layers/scenario/shared/types/` 的纯函数，便于 `check:lab-*` 直接断言。
6. 手动验证：断网重连、后端重启、页面切换、权限过期（票 60 秒 / 一次性，重放应得 `401 lab_ws_ticket_invalid`）。
7. 跑 `pnpm build:server && pnpm check:lab-bff`（⑫ 票与抓包流、⑬ 终端 / 日志 / 监控）与 `pnpm check:ui`（11.7 实时包列表、11.8 右栏五标签与观测三块）。动到终端按键映射再补 `pnpm check:lab-terminal`（真 `bash` + PTY 回放字节序列，POSIX 才跑；渲染边界见 `NMCPS-ADR-0025`，别在页面里另写第二套清洗），以及 `CHECK_REAL_MININET=1 pnpm check:lab-real`（真后端端到端，见下一节）。假上游的 WS 只有在 `scripts/lib/bff-harness.mjs` 的 `attachSnifferSocket()` 派发表里登记过才会接受升级 —— 它同时监听四条路径，别另挂第二个 `server.on("upgrade")`（会互相 `destroy`）。

## 手验真 Mininet（五标签右栏 / 真 PTY 键盘）

`pnpm check:ui` 与 `pnpm check:lab-bff` 的上游是假的（终端只回显），证明不了「按键真被 bash 认了」。真后端手验走一个**显式开门**的脚本：

1. 以 root 起真后端：`pnpm dev:lab-api`（`127.0.0.1:8000`），确认 `curl --noproxy '*' http://127.0.0.1:8000/api/health` 通；Mininet 需要 root，普通用户跑不了。回环地址必须带 `--noproxy '*'`（本机 `http_proxy` 会把 `127.0.0.1` 送去公司代理，拿到的是 nginx 的 400）；后端未配 `LAB_API_TOKEN` 时是 loopback-only，改用网卡地址会回 401 `lab_token_required`。
2. 真后端必须是**空实例**（`GET /api/mininet/start` 为 `false`，hosts / switches / routers / nats / controllers 全空）。不是就先 `POST /api/mininet/full_reset` —— 脚本会自己建 `h1`、起停网络，拿正在用的拓扑跑会把别人的实验停掉，所以这道空实例守卫是硬门。
3. `pnpm build:server`（脚本消费 `.output/server/index.mjs`，不自行构建）。
4. `CHECK_REAL_MININET=1 pnpm check:lab-real`：脚本用假 IAM + 真 BFF（`NUXT_MININET_INSTANCES` 指向真后端）+ Playwright，断言演示开关预填 `alice`、运行态读真后端、五标签切换、真提示符、算术执行、方向键行内编辑、`Ctrl-L` 后仍可执行、粘贴整段执行、`Ctrl+V` 不留 `v`、切标签不拆 socket、收起右栏全断；W13 起还覆盖双击链路改带宽。要连 `tc` 那一层一起断言（非 root 只会打 `⏭`）就用 `pnpm check:lab-real:root`，它自己把 `PATH` / `CHECK_REAL_MININET` / `REAL_MININET_BASE` 送进 `sudo -A env`；后端开了 `LAB_API_TOKEN` 时导出同值（`LAB_API_TOKEN=<token> REAL_MININET_BASE=http://192.168.1.90:8000 pnpm check:lab-real:root`），包装脚本会经 0600 临时文件把它转给直连与 BFF，不落命令行。
5. 收尾由脚本自己做（停网络、删掉它建的 `h1`、删临时台账）；跑完再确认 `GET /api/mininet/start` 回到 `false`、`GET /api/mininet/hosts` 回到 `{}`。

不带 `CHECK_REAL_MININET=1` 时脚本只打印跳过说明并以 0 退出 —— 「没跑」不是「通过」，别把它当成真机回归的替代品。

## 排查 BFF 502 / WS 断连

1. `pnpm lab:check` 确认后端可导入。
2. `curl --noproxy '*' http://127.0.0.1:8000/api/health` 确认服务活着。
3. 检查 `NUXT_MININET_INSTANCES` 是否为当前租户配置实例、是否被防火墙拦截；`GET /api/mininet/channel` 的 `configured` 是否为 `true`。
4. 检查 BFF 白名单是否包含该 path；只读阶段 method 必须是 `GET`。
5. WS 额外检查反向代理的 Upgrade 头、ticket 是否过期。

## 迁移旧 Vite 页面

1. 只迁移交互和业务规则，不整文件复制。
2. 把状态与 API 调用抽成 `layers/scenario/app/composables/`。
3. 把画布交互拆成独立组件，图表库保持 `client-only`。
4. 旧实现作为行为参考，迁完一个页面就标记 parity，不长期双写。
