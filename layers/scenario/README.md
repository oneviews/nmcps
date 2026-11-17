# Scenario Layer

场景筹划层。除既有的生产拓扑场景编辑外，本层还承载 Mininet 仿真网的入口、拓扑编辑与 BFF 路由。

## 页面

- `/scenario/*`：场景筹划页面。
- `/scenario/simulator`：仿真网总览 + 拓扑编辑（`app/pages/scenario/simulator.vue`），读取 `/api/lab/networks` 的台账并投影为 `TopologyCanvas`；旧的 `/sim-generation` 仅保留重定向。
- 编辑动作按 `GET /api/lab/channel` 的能力位分档渲染（NMCPS-ADR-0022 W2）：新增节点（五类）/ 连线用 `create`，删节点用 `delete`，拖动落库 / OpenFlow / 删链路用 `operate`；没有 `operate` 时画布不接收拖动。
- 新增节点两个入口共用一张表单：工具栏节点面板（`UPopover`）里点类型用默认落点，把类型拖到画布上用放手位置 —— 落点由 `TopologyCanvas` 的 `canvasDrop` 反解成图坐标（含缩放 / 平移），页面再按最近节点锚点换算成上游 `x` / `y`；`dropEnabled` 缺省关闭，只在有 `lab:create` 且正在拖拽时打开。
- 表单与确认组件在 `app/components/Simulator/`（`NodeFormModal` / `DeleteTargetModal` / `ClearFlowsModal` / `StopNetworkModal`），校验与请求体组装在 `shared/types/labNodes.ts`、`shared/types/labFlows.ts` 与 `shared/types/labRun.ts`（纯函数）。
- 所有 Mininet 文案在 `i18n/locales/{cn,en}.json` 的 `pages.scenario-simulator.*`。
- 流表三档写路径都由 `operate` 把关：加流（`POST /flows`）、删单条流（`DELETE /flows/{switch}/{flow_id}`，行号按「含 `actions=` 的行」计）、清流（`DELETE /flows`，`match` 留空 = 清整表，填了只删命中项；确认弹窗写出交换机 id）。
- 运行控制（NMCPS-ADR-0022 W3）：启动（`POST /start`，`create`）、停止（`POST /stop`，`operate`，确认弹窗写明会终止节点进程）、重启（`POST /stop` + `POST /start`，同一个确认弹窗，仅运行中可点）、连通性（`POST /pingall`，`operate`，上游文本逐行上屏）、吞吐测试（`POST /iperf`，`operate`，两端各一段原文）。运行态读 `GET /start` 的裸布尔，读不到显示「未知」并禁用动作 —— 未知不等于已停止。
- 工具栏最左是复刻 1.0 版式的菜单栏（NMCPS-ADR-0022 W2 修订）：「视图」（显示名称 / 显示主机 / 显示控制器 / 显示主机 IP，只过滤渲染，`nodes` 仍是全量台账事实）与「运行」（启动 / 停止 / 重启）；右栏卡片只留运行态读数与连通性 / 吞吐结果，同一动作全页只有一个入口。「文件」已在 W4 补齐（导入拓扑 / 导出 JSON / 导出脚本），「工具 / 帮助」等 W5（抓包下载）与 W4 之后的帮助面板。
- 导入 / 导出（NMCPS-ADR-0022 W4）：「文件」菜单点导入只负责唤隐藏 `<input type="file">`，读文件后先过纯函数 `parseLabImport()`（三类就地报错零请求：空文件 / 非法 JSON / 形状不认 —— 既不是 `nodes`+`edges` 的图形状，也没有五个节点集合的台账形状；两种形状都接受，台账形状即 `export_json` 的产物），再由 `POST /api/lab/import_json` 发往 BFF（双权限 `lab:create` + `lab:delete`，`canImport` 两个能力位都要有）；上游只收 multipart 的 `file` 字段，重封装在 BFF 里做，页面始终发 JSON。导出走 `GET /api/lab/export/{json|script}`（`lab:read`），页面用 `useApi().download()` 拿 blob 再从 `content-disposition` 取文件名落 `<a download>` —— 导出不进 `[...slug]` 的 JSON 信封，也不许用 `api.get()` 自己拼文件名。导入是**追加**语义，成功后重读台账（画布多出导入的节点）。
- `scripts/check-ui.mjs` 的 11.5 覆盖「文件」菜单：三项齐全、导入按 multipart 发上游且画布多一个节点、导出 JSON / 脚本的扩展名与正文（BFF 生成文件名、不套 JSON 信封）。
- `scripts/check-ui.mjs` 的 11.3 覆盖只读路径（空台账、正常台账、`/api/lab/networks` 503/403 与刷新恢复、资源清单外节点/链路过滤），11.4 覆盖写路径（能力位渲染、新增 → 请求体 / 画布一致、拖动落成绝对值、删除 + 流表读数、加流 → 请求体与回显一致、删单条流按 dump 行序、清流三条 —— 匹配域夹带 `actions=` 就地报错零请求 / 留空清整表只带 `switch` / 带 `match` 只删命中行 —— 加流本地校验三条分支 —— 动作必填 / 匹配域夹带 `actions=` / 优先级超 65535 —— 就地报错且零请求，运行控制六条 —— 初始已停止 + 菜单项禁用 / 启动后转为运行中 / `pingall` 文本上屏 / iperf 两端同主机就地报错零请求 / iperf 请求体带两端与秒数且两侧输出上屏 / 停网确认后回到已停止，以及菜单栏四条 —— 「视图」四项齐全 / 关「显示主机」后主机与链路一起消失、切回恢复 / 「显示主机 IP」补注 IP、切回恢复 / 重启依次发 `stop` + `start` 且回到运行中）。

## 服务端

- `server/api/lab/**`：Mininet BFF 通道；`/api/lab` 无路径段回 400，其余走 45 条白名单（17 条查询 + 28 条写）。导出不在白名单里：同目录静态路由 `export/[kind].get.ts` 按 `LAB_EXPORT_UPSTREAMS` 取上游路径与权限位（`json` / `script` 是 `lab:read`，`pcap` 是 `lab:sniffer`），直接回 `text/plain` 或 pcap 二进制并自己生成文件名。
- 路由白名单与上游路径在 `layers/scenario/shared/constants/mininetRoutes.ts`；通道类型在 `layers/scenario/shared/types/mininet.ts`；节点草稿与请求体映射在 `layers/scenario/shared/types/labNodes.ts`；导入包体的形状校验在 `layers/scenario/shared/types/labImport.ts`（纯函数，页面与 `check-lab-bff` 共用同一口径）。
- 鉴权、台账、租户实例、审计、串行化锁与出站过滤同层放在 `layers/scenario/server/utils/bff/lab*` / `mininet*.ts`，由本层路由引用；根 `server/` 不再反向依赖场景层。
- `layers/scenario/scripts/check-lab-bff.mjs`：通道自查，复用根 `scripts/lib/bff-harness.mjs`。

## 验证

```bash
pnpm build:server
pnpm check:lab-bff
pnpm check:lab-tenancy
pnpm check:lab-flows
pnpm check:lab-run
pnpm check:lab-ws
pnpm check:i18n
pnpm check:ui
pnpm typecheck
```

## 边界

- 浏览器不得直连 Mininet `:8000`，只经 `/api/lab/**`。
- 终端、抓包、WebSocket 与抓包下载的状态：四条 WebSocket 全部开放（`/lab-ws/sniffer` 实时包、`/lab-ws/terminal` Webshell、`/lab-ws/logs` 上游日志、`/lab-ws/monitor` 单接口速率，均走一次性票 + `createLabWsRelay()`），抓包启停 / pcap 下载已开放（W5）；导出 JSON / 脚本与导入已开放（W4）。`GET /api/lab/channel` 的 `writeEnabled` / `capabilities` 按会话计算，页面先读能力位再渲染。
- 仿真网页面不把 `sim_id` / 节点 ID 当权限凭据；写失败原话（403 / 404 / 409 / 503）照实展示，不做二次解释。
