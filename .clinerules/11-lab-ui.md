---
paths:
  - "layers/scenario/**"
  - "packages/mininet-client/**"
  - "layers/scenario/shared/constants/mininetRoutes.ts"
---
# Lab UI

Mininet 实验台是 scenario 层里的一个受限功能区，不是第二个前端应用；页面与 BFF 路由同属 `layers/scenario`。

- 所有后端访问走 `useApi()` 或 `packages/mininet-client`，禁止在页面里写 axios 或硬编码 `http://...:8000`。
- 所有后端访问走 `useApi()` 或 `packages/mininet-client`，禁止在页面里写 axios 或硬编码 `http://...:8000`。
- 写能力位只读会话能力：页面先读 `GET /api/lab/channel` 的 `capabilities`，未授权动作不渲染，也不得先渲染再等 403/405；后端守卫永远是唯一权限边界（403 `lab_permission_denied` / 404 `lab_resource_not_found` / 409 冲突）。
- 拓扑编辑按能力位分档渲染：`create`（新增节点 / 连线）、`delete`（删节点）、`operate`（拖动落库 / OpenFlow / 删链路 / 流表写入）。没有 `operate` 时 `TopologyCanvas` 必须传 `:draggable="false"`，否则拖动会「看起来成功但没落库」。
- 新增节点的两个入口共用同一张表单：拓扑图右侧的纵向节点面板（`SimulatorNodePaletteRail`，五个类型图标可点可拖）里点一下用默认落点，拖到画布上则用放手位置。落点由画布反解成**图坐标**（`TopologyCanvas` 的 `canvasDrop`，已含缩放 / 平移）再换算成上游 `x` / `y`，页面不得自己算视口变换；`dropEnabled` 缺省关闭，只在有 `lab:create` 且正在拖拽时为 `true`。面板必须常驻在画布容器内、排在画布之后（`absolute right-2 top-1/2` + `z-10`），别塞回工具栏 `UPopover`：那要「先点开菜单再拖」，菜单一收起拖源随之被拆掉，原生拖放永远到不了画布。

- `useApi().del(path, body)` 的请求体只服务「定位信息塞不进路径」的端点，目前仅 `DELETE /api/lab/flows`（`FlowRuleDelete` 用 `switch` + 可选 `match` 决定删哪些流）；其余 DELETE 一律无体，删哪个对象由路径段表达。给别的 DELETE 顺手加 body，等于让上游按「什么都不匹配」执行。
- 运行控制（`start` / `stop` / `pingall` / `iperf`）只按 `GET /api/lab/start` 的布尔运行态渲染：`true` 才给停止 / 探测 / 测速，`false` 才给启动，`null`（读不到）动作全禁用并显示「未知」。把「读不到」当成「没启动」，会让启动按钮对着已在跑的网络发请求，再拿上游 400 当失败。`POST /stop` 必须经确认弹窗 —— 上游会终止全部节点进程。
- 工具栏最左是复刻 1.0 版式的菜单栏（`NMCPS-ADR-0022` W2 修订 / W4）：做「文件」「视图」「运行」三组（`UDropdownMenu`，`xs` 按钮 + `carbon:chevron-down`），「工具 / 帮助」要 W5（抓包下载）的端点，不要先占一排点不动的位。「视图」四项（显示名称 / 显示主机 / 显示控制器 / 显示主机 IP）只过滤**渲染** —— `nodes` 仍是全量台账事实，默认落点与拖拽锚点换算都用全量，藏起来的主机不该把新节点放到空处；「运行」装启动 / 停止 / 重启，右栏卡片只留运行态读数与连通性 / 吞吐结果，同一动作全页只有一个入口。重启 = 停止 + 启动（上游没有 `restart` 端点），复用停网确认弹窗，且只在**运行中**可点（第一步就是 `POST /stop`，对已停的网调它只会拿到上游 400）。
- 「文件」装导入拓扑 / 导出 JSON / 导出脚本三项（`NMCPS-ADR-0022` W4）。导入项只负责唤隐藏 `<input type="file">`：读到文本先过 `parseLabImport()`（三类就地报错零请求 —— 空文件 / 非法 JSON / 形状不认；它同时接受 `nodes`+`edges` 的图形状和 `export_json` 的台账形状，controller ↔ switch 的关联线不算链路），再 `POST /api/lab/import_json`；`canImport` 要 `create` **和** `delete` 两个能力位（上游是有破坏性的重建通道），导入成功后重读台账而不是本地拼节点。导出只走 `GET /api/lab/export/{json|script|pcap}` + `useApi().download()`：导出是独立静态路由，返回的正文不是 `ApiResponse` 信封，文件名来自 BFF 的 `content-disposition`；把导出塞进 `[...slug]` 或 `api.get()` 会把 `.json` / `.py` / `.pcap` 变成被包了一层的字符串，也会丢掉文件名。`LAB_EXPORT_UPSTREAMS` 是导出种类白名单，且**权限位逐种类不同**：`json` / `script` 要 `lab:read`，`pcap` 要 `lab:sniffer`；未登记种类一律 `400 bff_path_invalid`（先判种类再判权限，路径写错不能伪装成 403）。
- 「工具」菜单（`NMCPS-ADR-0022` W5）只在 `lab:sniffer` 时渲染，三项 = 开始抓包 / 停止抓包 / 下载 pcap；读数（`GET /api/lab/sniffer/state`，三态，读不到不回落成「未抓包」）放在右栏运行卡片里，动作入口只在菜单。开始抓包还要求网络在跑（上游对未启动回 400）。pcap 下载走 `GET /api/lab/export/pcap`，BFF 以 `fetchMininetBinary()` 取 `arrayBuffer` —— 走 `text()` 会把 `0xd4 0xc3` 解成 U+FFFD，文件打不开。
- Network Tools（`NMCPS-ADR-0022` D6 的其余三条通道）是工具栏「网络工具」按钮打开的面板（`SimulatorNetworkTools` + `useLabWsChannel(kind)`）：Webshell 要 `lab:terminal`，日志 / 监控只要 `lab:read`；两个能力位都没有时整块入口不渲染，面板内标签页再逐个裁剪。日志随标签打开自动建流、关闭即断；监控只有一个目标（选节点 + 接口，接口清单只来自 `GET /api/lab/interfaces`），切走即停；Webshell 是**显式多会话**（每个节点一条标签，`useLabTerminalSessions()` 为每条会话维护一条 socket），切标签不算断开，只有标签上的 × 与关面板才断流 —— 别把「切到日志」实现成「把终端 socket 拆掉」。监控帧先过 `labMonitorFrameOf()`：上游 `Error: …` 文本要显示成错误行，不能当「暂无数据」吞掉。终端按键要翻成 PTY 字节（回车 `\r`、退格 `0x7f`、方向键 CSI、`Ctrl+字母` 发 `0x01–0x1A`），回显交给 PTY，不做本地回显（否则一次输入两份）。终端输出先过 `labTerminalTextOf()`（剥 ANSI / OSC、按 `\r` 覆盖取最后一段、退格删字符）：真 PTY 一定带颜色码，原样渲染会把提示符显示成 `^[[1;32m`；「中断」发 `0x03` 而不是字面量 `^C`，「清屏」只清浏览器侧转写且不断流（远端屏幕要清得自己敲 `clear`）。渲染边界由 `NMCPS-ADR-0025`（`layers/content/collections/cn/records/adr/adr-0025.md`）裁决：全屏 TUI（`vi` / `top`）、颜色、宽字符对齐、窗口缩放**不支持**，这是裁决内的事实而不是待修缺陷 —— 别为此自研 CSI 光标定位（那等于重写终端模拟器），要真模拟器就按 ADR-0025 D5 新开 ADR 评估依赖。抓包**不**在面板里重复一份（启停在「工具」菜单、实时包在右栏），一个动作仍然只有一个入口。
- 「运行」菜单最后一项是破坏性重建（`POST /api/lab/full_reset`）：要 `create` + `delete` 双能力位，且弹窗要**逐字输入网络 ID**；BFF 侧同一值（`{ confirm: "<network_id>" }`）是硬闸门，缺失或不符回 `400 lab_confirm_required` 且不触达上游。成功后台账 `resources` 整体清空（`reset: true`），页面重读台账而不是本地清数组。
- `pnpm check:ui` 不自建 `.output`：脚本先比产物与源码的 mtime，产物比 `app` / `layers` / `shared` / `i18n` / `nuxt.config.ts` 旧就直接退出并提示 `pnpm build:server`。看到这条提示别再顺着失败用例排查，那测的是旧 bundle。
- WebSocket 统一走同源 `/lab-ws/*`：先用 `POST /api/lab/ws-ticket { kind, target? }` 换 60 秒一次性票，再由 BFF 验票（签名 / TTL / 一次性 / `kind`+`target` 绑定）后建连上游转发；组件不直接 `new WebSocket`，也不得向下发上游地址（`NMCPS-ADR-0022` D6）。抓包实时流已落地：`useLabSnifferStream()`（`layers/scenario/app/composables/useLabSnifferStream.ts`）负责换票 / 建连 / 断流，页面只在 `snifferActive === true` 时连，`null`（读不到）与 `false` 都不连；列表先由 `GET /api/lab/sniffer/history` 回填，上限 200 条。票只能由已登记种类签发（`LAB_WS_UPSTREAMS`，当前四条：`sniffer` / `terminal` / `logs` / `monitor`），未登记种类回 `400 lab_ws_kind_invalid`。
- 依赖 Mininet 的页面/画布使用 `client-only`，不在 SSR 阶段访问本地实验服务。
- 组件优先用 Nuxt UI v4 原生组件；沿用现有设计 token，不复制旧 Vite 的样式体系。
- 所有可见文案进 `i18n/locales/{cn,en}.json`，两边 key 与占位符一致。
- 新页面必须声明权限 meta；终端、抓包、reset 默认不显示，除非后端返回对应能力位。
- 租户与权限只信 BFF 会话；页面不得读取或提交 `x-tenant-id`，也不得把 `sim_id` / 节点 ID 当作权限判断依据（NMCPS-ADR-0021）。
- 终端、抓包默认不渲染；`lab:terminal` / `lab:sniffer` 必须单独授权，不能由 `lab:read` / `lab:operate` 推导。
- 仿真网页面是 `/scenario/simulator`（`layers/scenario/app/pages/scenario/simulator.vue`），复用生产 `TopologyCanvas` 展示台账拓扑，不另写一套画布。
- 旧 Vite 前端按 `NMCPS-ADR-0022` 退役：只按能力位重写行为，不复制源码、不复用其样式体系、不双写；复刻验收后即删除，`services/mininet-api` 只留纯后端。
- 依赖 Mininet 的页面/画布使用 `client-only`，不在 SSR 阶段访问本地实验服务。
- 组件优先用 Nuxt UI v4 原生组件；沿用现有设计 token，不复制旧 Vite 的样式体系。
- 所有可见文案进 `i18n/locales/{cn,en}.json`，两边 key 与占位符一致。
- 新页面必须声明权限 meta；终端、抓包、reset 默认不显示，除非后端返回对应能力位。
- 租户与权限只信 BFF 会话；页面不得读取或提交 `x-tenant-id`，也不得把 `sim_id` / 节点 ID 当作权限判断依据（NMCPS-ADR-0021）。
- 终端、抓包默认不渲染；`lab:terminal` / `lab:sniffer` 必须单独授权，不能由 `lab:read` / `lab:operate` 推导。
- 仿真网页面是 `/scenario/simulator`（`layers/scenario/app/pages/scenario/simulator.vue`），复用生产 `TopologyCanvas` 只读展示台账拓扑，不另写一套画布。
