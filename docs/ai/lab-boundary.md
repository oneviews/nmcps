# Lab 边界约定

Mininet 是**有状态、特权、单实例**的实验床，不是普通只读数据源。合并进 nmcps2 后必须保留这层边界。

## 当前事实

- `services/mininet-api` 的 `app.net` 是进程内全局拓扑，同一时间只有一张网络。
- 后端没有登录态；CORS 已关闭（`NMCPS-ADR-0022` D9 / W6），浏览器只经 BFF 访问，`:8000` 只对回环 / 反代暴露。
- 终端、抓包、`reset`、`full_reset` 属于高权限操作。
- 拓扑、节点位置、运行状态都归后端所有，前端不是事实源。

## 特权命令怎么跑（2026-11-20）

- 本机 `sudo -n` **不可用**（`interactive authentication is required`），口令存在 git-ignored 的 `.clinerules/.sudo.local`，
  用 `SUDO_ASKPASS="$PWD/.clinerules/sudo-askpass.sh" sudo -A <command>`（助手只回显口令文件，口令不进命令行）。
  完整写法与禁令（不要 `echo "$PASS" | sudo`）见 `.clinerules/09-local-sudo.md`。
- 整跑 `check:lab-real` 用同一套写法，但 `sudo` 会重置环境变量，`PATH`（nvm 的 `node`）/ `CHECK_REAL_MININET` /
  `REAL_MININET_BASE` 都要跟在 `sudo -A env …` 之后。**用包装脚本 `pnpm check:lab-real:root`**（`layers/scenario/scripts/check-lab-real-root.mjs`）：
  它组装好这几个变量并透出被测脚本的退出码，root 下 tc / SNMP 两层不再跳过（2026-11-20 实测 18/18 全绿；
  2026-11-23 新增真 iperf 用例后 19 项；2026-11-26 新增 11.16 真 `snmpwalk` 两条后共 21 项，root 整跑 21/21）。
- 主机的接口在**它自己的 netns** 里：根 netns 里 `tc qdisc show dev h1-eth0` 什么都不打印，要先 `GET /api/mininet/interfaces`
  拿 pid，再 `SUDO_ASKPASS="$PWD/.clinerules/sudo-askpass.sh" sudo -A nsenter -t <pid> -n tc class show dev h1-eth0`。
- TCLink 用的是 **`htb`**（不是 `tbf`）：`bw=10` 落成 `class htb 5:1 root prio 0 rate 10Mbit ceil 10Mbit`（2026-11-20 实测），
  所以「带宽有没有生效」要看那行 `rate`，不是看 qdisc 类型名。
- **`GET /links` 的 `from` / `to` 不是稳定的**：`stop` → `start` 之后同一条链路会换个方向回读
  （2026-11-21 实测：建链时 `h1→h2`，重启后 `h2→h1`，`intfs` 一起变成 `h2-eth0→h1-eth0`）。
  写断言时不要按「`h1` 在前」找连线、也不要固定用 `h1` 的 pid 去 `nsenter` 看别的接口 ——
  `check:lab-real` 的 W13 就因此假红过一次（双击落空 → `PUT /links` 没发 → 后两条跟着红）；
  现在按「两个节点 id 都在这条连线的无障碍名称里」定位，再按接口名前缀（`h2-eth0` → `h2`）取 pid。
- root 跑完会在 `.data` 留下 **root 名下**的产物（当日审计分片 `.data/audit/lab-audit-<日期>.jsonl`），
  也会在 `services/mininet-api/.data/snmp/` 留下 root 的 agent 档案 / 日志。普通用户的 BFF 再往同一分片追加就
  `EACCES` → 所有写端点 `503 audit_unavailable`，而读端点照常 200 ——
  `check:ui` 的 11.4 写用例会整段假红（2026-11-22 实测）。包装脚本现在在 `finally` 里把**这两个目录**下 root 名下的
  文件 chown 回调用者；先看 `find .data services/mininet-api/.data -user root`，再怀疑代码。

## SNMP 采集面（`NMCPS-ADR-0028`，2026-11-26）

- 每个节点一条 agent 进程，由 `snmp/runtime.py` 用 `nsenter -t <node pid> -n -- python -m mininet_gui_backend.snmp.agent` 拉进**节点自己的 netns**，端口在 netns 内绑 161（`LAB_SNMP_PORT`），所以宿主 `snmpd` 继续占根 netns 的 161 也不冲突。
- 前提三条都成立才会起：`LAB_SNMP_ENABLED=1`、后端以 root 跑（`os.geteuid() == 0`）、节点有 `pid`（Mininet 要 `start()` 才有）。任一不满足只在状态里记 `unavailable` + 原因，不会让起网失败（D4）。
- 产物在 `services/mininet-api/.data/snmp/`（`SERVICE_ROOT` 是 `services/mininet-api`，不是仓库根）：`<node>.json` 档案（0600）、`<node>.log`（agent 的 stdout / stderr）。root 跑过之后这些文件属 root，普通用户的 BFF 再写会 `EACCES`；收尾照 `09-local-sudo.md` 的规矩 chown 回调用者 —— **两处都要**：`sudo -A chown -R "$(id -u):$(id -g)" .data services/mininet-api/.data`。
- 凭据（`NMCPS-ADR-0028` §6 D8–D12）：全服务只有**一份**可管理的 SNMP v2c 社区串，落在 `services/mininet-api/.data/snmp/credential.json`（文件 0600、目录 0700、原子写）。未开通时采集用部署默认串（`LAB_SNMP_COMMUNITY`，缺省 `public`，`community_source: deployment`）；开通后串由服务端生成（`sim-` 前缀）或按强度校验接受显式值，**不回传** —— `GET /api/mininet/snmp/state` 只给 `onboarded` / `credential_version` / `created_at` / `rotated_at` / `credential_error`，`community` 在开通 / 轮换后置 `null`（未开通时它就是部署默认串，不是编排出来的秘密）。开通 / 轮换 / 吊销是三条 `lab:snmp` 写端点（`POST /snmp/onboard`、`POST /snmp/rotate`、`DELETE /snmp/credentials`），写成功后 `apply_credentials()` 全量重启 agent 才生效；重启失败只记在 `nodes[*].status`，不回滚写。文件损坏时状态里给 `credential_error`，采集回落部署默认串 —— 不静默、也不把后端弄红。root 与本机用户混跑时同样要 chown 回 `.data` 所有者，否则开通会 503。

- 真采集验收 2026-11-26 已在 90 上闭环（`NMCPS-ADR-0028` §5 有实测输出）：`apt-get install snmp` 装上 net-snmp（`/usr/bin/snmpwalk`），root 后端带 `LAB_SNMP_ENABLED=1` 起网后，`nsenter -t <node pid> -n -- snmpwalk -v2c -c public 127.0.0.1 1.3.6.1.2.1.1` 回 `sysName=<节点 id>`、`ifDescr` / `ipAdEntAddr` 与台账一致；从另一个节点的 netns 打 `10.0.0.x` 同样通（跨仿真网可达）。节点 netns 里没有路由到根 netns 的通路，所以**别在宿主上直接 `snmpwalk 10.0.0.1`** —— 那是「从外部 NMS 采集」的形态，本机拓扑没有接外部网。`pnpm check:snmp`（回环客户端 + 真子进程入口 + 凭据存储 / `apply_credentials()` 重启面，41 项）仍是唯一无需 root 的自动检查；`pnpm check:lab-real:root` 的 11.16 两条把 ADR-0028 §6.3「Real machine」那一行做成自动断言（部署串可读 → 开通串可读且旧串无应答 → 轮换换串 → 吊销回部署串），条件不满足（非 root / 无 `snmpwalk` / 采集面没开 / 实例已开通）时打 `⏭`，跳过不算已验。

## 本机 `:8000` 必须跑本仓代码（2026-11-18 现场）

- 现场 `:8000` 的 uvicorn 是 11-15 20:39 启动的，cwd 在仓库外的旧副本 `/home/user/project/mininet/mininet-gui-backend`；该副本 `api.py` 里 `switch_fail_mode` / `failMode` **一次都没出现**（ADR-0024 之前的代码），所以交换机仍是 Mininet 默认 `failMode='secure'` + 零控制器。
- 症状与判据：`POST /api/mininet/pingall` 回 `h1->h5: 1/0, rtt min/avg/max/mdev 0.000/0.000/0.000/0.000 ms`。`1/0` 是上游 `net.pingFull()` 的 **sent/received**（`api.py` 拼串处），即 1 发 0 收、100% 丢包；全是 `0.000` 是因为没有任何回包。对比 `s1-eth1` / `s1-eth3` 的计数器：ping 前后两个口 `rx_bytes` 各 +126（h1 / h5 的 ARP 都到了交换机），而 `tx_bytes` **完全不变** —— 收进来不转发，就是 secure 无控制器的典型形态，不是链路断、也不是页面解析错。
- 临时救现场（不动拓扑，需要 root）：`sudo ovs-vsctl set bridge s1 fail-mode=standalone`（s2 / s3 同理），立刻恢复连通；但后端进程仍是旧代码，下次起网 / 重建又回到 secure。
- **2026-11-18 已处置**：三台 bridge 改 `standalone` 后 `ping` 仍不通，`ovs-vsctl list-ports s1` 只有 `s1-eth1` / `s1-eth2` —— 运行中新增的 `h5—s1` 链路，`s1-eth3` 不在 bridge 里。根因是 `create_link()` 只给「有控制器的交换机」重新初始化端口（`and node.controller`），无控制器交换机被跳过。已改为对所有交换机「先重设 `failMode` 再 `node.start(...)`」，`pnpm lab:check` 补三条断言，细节见 `NMCPS-ADR-0024` 第 5 追加节；临时补端口用 `ovs-vsctl add-port s1 s1-eth3`，补完 `ping -c 2 10.0.0.5` 即 2/2。
- 根治：先「文件 → 导出 JSON」留一份拓扑，再重启后端到本仓代码，然后导入、启动：
  ```bash
  # 0) 先停网（页面「运行 → 停止」），别让旧进程带着在途 pingall / iperf 关闭
  sudo pkill -9 -f 'uvicorn mininet_gui_backend.api:app'
  sudo mn -c                       # 清掉旧网络残留，否则新进程会卡在 mn_cleanup()
  ss -ltn | grep ':8000' && echo '端口仍被占用，别继续'
  cd /home/user/project/nmcps2/services/mininet-api
  sudo nohup python3 -m uvicorn mininet_gui_backend.api:app --host 0.0.0.0 --port 8000 --log-level info \
    > /tmp/mininet-api.log 2>&1 &
  for i in $(seq 1 40); do sleep 1
    curl -s --noproxy '*' -o /dev/null -w '%{http_code}' \
      http://127.0.0.1:8000/api/mininet/switches | grep -q 200 && { echo ready; break; }
  done
  ```
- **重启的坑（2026-11-18 实测）**：用 SIGTERM（`pkill` 默认）时，旧进程若正卡在一个同步操作里（例如 `net.pingFull()`），uvicorn 的优雅关闭会一直等 —— 结果是**进程还在、`:8000` 已无监听**；紧接着新进程又在启动阶段的 `mn_cleanup()` 上阻塞，于是「两个进程都在、没人 bind」，页面全线 500 / 502。判据：`curl -o /dev/null -w '%{http_code}' :8000/api/mininet/switches` 恒为 `000`，而 `ps` 里 uvicorn 还在。处置：`sudo pkill -9` + `sudo mn -c`，确认端口空置后再起。
- 真机复验（2026-11-18，本仓代码 + `standalone`）：导入 4 交换机 / 3 主机 / 6 链路 → `start` → 四台 bridge 全 `standalone`、端口与链路一一对应（`s1: eth1..eth3`、`s2: eth1..eth3`、`s4: eth1..eth2`），`pingall` 6 组全 `1/1`（rtt 0.028–0.377 ms）；再在**运行中**加 `h8—s4`，`s4-eth3` 立刻进 bridge、`fail-mode` 仍 `standalone`、12 组全 `1/1` —— `create_link()` 的修复在真机上成立。
- 删节点 / 删链路的对称处理（2026-11-18 修）：Mininet 的 `delNode` / `delLink` 只删接口、不通知 OVS，bridge 会留下 `ofport: -1`、`error: could not open network device …` 的鬼端口（`ovs-vsctl list-ports` 看起来链路还在，排查时极易误判），删节点还会把死链路留在 `app.links` 里让 export 输出已不存在的链路。现在 `delete_node` / `delete_link` 先 `release_switch_port()`（`ovs-vsctl --if-exists del-port`）再删，且 `delete_node` 同步清 `app.links` / `app.link_attrs`；`pnpm lab:check` 有对应断言。真机复验：加 `h9—s4` → `s4-eth3` 进 bridge → 删链路 → 端口消失 → 同名端口复用再通（12 组 `1/1`）→ 删节点 → 端口消失、`export` 回到 6 条链路且无 `h9` 引用。
- 后端重启会丢 `app.net` 与 `app.hosts`（进程内全局拓扑），台账 JSON 仍在但上游为空；这时**不要**点「台账对账」（它按上游事实重写清单，上游空 = 把台账清空），正确顺序是导入拓扑 → 启动。

## 阶段一约束（已被 NMCPS-ADR-0022 取代）

- 后端只监听 `127.0.0.1` 或受控内网（仍然有效）。
- 不新增浏览器直连 `:8000` 的代码（仍然有效）。
- ~~旧 Vite 前端只作行为参考，不再扩展功能~~ → 见下节：复刻验收后直接退役。
- ~~先完成 BFF 通道和只读页面，再开放写操作~~ → 只读阶段已完成，写操作按 ADR-0022 W1~W4 分段开放。

## 全量并入与旧前端退役（NMCPS-ADR-0022）

- 目标：把旧 Vite 前端（`mininet_gui_frontend`）全部能力并入 `/scenario/simulator`，验收后删除该前端，`services/mininet-api` 只留纯后端。
- 40 条写端点按 `(method, 模板)` 逐条登记进 `MININET_ROUTES`，一个端点一个权限位：`lab:create`（建网 / 加节点加链 / 建会话）、`lab:operate`（改网络、链路通断、pingall、iperf、流表、停会话）、`lab:delete`（删节点 / 删会话）、`lab:sniffer`（抓包启停）、`lab:snmp`（SNMP 凭据开通 / 轮换 / 吊销，`NMCPS-ADR-0028` §6）；`full_reset` 与 `import_json` 需 `lab:delete` + `lab:create` 双权限。
- `GET /api/mininet/channel` 的 `writeEnabled` / `capabilities` 按会话计算；页面先读能力位再渲染，不再恒为 `false`。
- 写操作先写审计 outbox（`.data/audit/lab-audit.jsonl`）再执行；写盘失败回 `503 audit_unavailable`。同一网络同时只允许一个在途写操作（`409 lab_operation_in_progress`）。
- 四个 WebSocket 走同源 `/mininet-ws/*`：`POST /api/mininet/ws-ticket` 签 60 秒一次性 HMAC 票，绑定 `sub` / `tid` / `kind` / `target`；票过期、重放、绑定不符一律 `401 lab_ws_ticket_invalid`。四条通道全部落地（`sniffer` / `terminal` / `logs` / `monitor`）：验票、连上游、透传与审计只有一份实现 `layers/scenario/server/utils/bff/labWsRelay.ts` 的 `createLabWsRelay(kind)`，每个路由文件只有一行；`target` 语义按通道登记（抓包=网络 id 可空、终端=节点、监控=`<node>:<intf>`、日志必须为空），票据签出前判形状与台账，会话开始 / 结束各记一条审计（`duration_ms`，**不记**终端输入 / 日志正文 / 抓包载荷）。通道登记表在 `layers/scenario/shared/constants/labWs.ts`（`LAB_WS_UPSTREAMS`），未登记种类回 `400 lab_ws_kind_invalid`；票是一次性的（`jti` 内存表，多实例部署需落台账）。终端是唯一有上行的通道，上游握手期间的上行帧排队到 `open` 再发。
- 导出走独立内容类型通道：`GET /api/mininet/export/{kind}`（静态路由 `layers/scenario/server/api/mininet/export/[kind].get.ts`）不套 `ApiResponse` 信封，文件名由 BFF 生成（`lab-<network_id>-<UTC>.<ext>`，不信任上游 `Content-Disposition`）。种类与权限位**逐条**登记在 `LAB_EXPORT_UPSTREAMS`：`json` / `script` 要 `lab:read` 并直出 `text/plain`；`pcap` 要 `lab:sniffer`、按 `arrayBuffer` 取二进制（`fetchMininetBinary()`，走 `text()` 会毁掉魔数）。未登记种类回 `400 bff_path_invalid`，且先判种类再判权限。
- 破坏性重建（`POST /api/mininet/full_reset`）除 `lab:delete` + `lab:create` 外还要 `{ confirm: "<network_id>" }`：缺失或不符回 `400 lab_confirm_required` 且不触达上游（ADR-0022 W5）；成功后台账 `resources` 整体清空。
- 旧前端删除前打 tag `legacy-mininet-gui-final`；上游 CORS 关闭，只经反代暴露。两条都已完成（W6）：`mininet_gui_frontend` 从未进本仓库，`services/mininet-api` 只剩纯后端；`CORSMiddleware` 已删除，`pnpm lab:check` 断言 `app.user_middleware` 里不再出现 CORS 中间件。

## 已落地的只读通道（NMCPS-ADR-0020）

- **前缀同形（`NMCPS-ADR-0022` D11，M1.1）**：BFF 的对外前缀是 `/api/mininet/**` 与 `/mininet-ws/*`，与上游
  `services/mininet-api` 的同名路径**同形但不同主机** —— 本文里不带主机的 `/api/mininet/**` 一律指 BFF；
  带 `http://<lab-host>:8000` / `127.0.0.1:8000` 的是上游直连（只允许自检脚本与排障命令）。隔离靠
  「浏览器只拿同源相对路径 + 上游基址只在 Nitro 运行时配置 + `proxyToMininet()` 是唯一出站点」，
  不靠前缀差异；`lab:*` 权限位与 `lab_*` 错误码是能力域命名，不随路径改名。旧前缀不留兼容别名（2026-11-24 对
  `build:server` 产物实测）：`GET /api/lab/channel` 落到主网关回 `404 bff_resource_not_allowed`，`/lab-ws/*` 已无路由、
  普通 GET 不会升级（`GET /mininet-ws/logs` 无升级头回 `426 Upgrade Required`）。
- 浏览器入口只有 `/api/mininet/**`；上游基址在 `runtimeConfig.mininet.instances`（`NUXT_MININET_INSTANCES`，租户 → 实例 JSON）。未配置实例的租户回 `503 tenant_runtime_unavailable`，不会回退全局 `baseUrl`。
- `layers/scenario/shared/constants/mininetRoutes.ts` 登记 **64 条**端点：24 条查询 + 40 条写（ADR-0022 W1；其中 12 条是 2.0 会话入口 `/sessions/**` → `/api/simulation/**`，NMCPS-DESIGN-008 M1；3 条是 `NMCPS-ADR-0028` §6 的 SNMP 凭据写面 `/snmp/onboard`、`/snmp/rotate`、`DELETE /snmp/credentials`，只认 `lab:snmp`）；查询里的 `GET /nodes` 是统一节点投影（M1.1：五类分表 → `/api/mininet/nodes`，与会话侧 `/sessions/{id}/nodes` 同形），页面拓扑只打它 + `/links` 两条；`PATCH /links/{src_id}/{dst_id}/state` 是链路运行态通断（`up` / `down` / `toggle`，`lab:operate`，与改属性的 `PUT /links` 分成两条端点）。导出另走静态路由（`export/[kind].get.ts` + `LAB_EXPORT_UPSTREAMS`，`json` / `script` / `pcap` 三种，权限位与内容类型逐条登记），不占白名单条目。未登记路径回 404、动词不符回 405。
- BFF 出站不读 `nmcps_at`、不转 `Bearer`、不转发 cookie；只带 `accept` / `user-agent` / `x-request-id`。
- `GET /api/mininet/channel` 返回 `configured` / `readOnly` / `writeEnabled` / `capabilities` / `endpointCount`，**按会话计算**，不回传上游地址。
- 已开放：四条 WebSocket（抓包实时流 `/mininet-ws/sniffer`、Webshell `/mininet-ws/terminal`、日志 `/mininet-ws/logs`、监控 `/mininet-ws/monitor`，均经一次性票）、抓包启停（`lab:sniffer`）与 pcap 下载、导出 JSON / 脚本与 `import_json`（W4）、写操作（按权限位）、旧前端退役（W6：纯后端 + CORS 关闭 + `legacy-mininet-gui-final` 标签）。页面对全部写动作与三条观测面板都先读能力位再渲染。
- `pnpm build:server && pnpm check:lab-bff` 验证 168 项通道契约（含台账租户隔离、资源清单、401/403/503 与上游零命中，⑧ 覆盖链路通断的 PATCH 出站 / 请求体原样 / 无 `lab:operate` 403 零命中，⑩ 覆盖导出 `text/plain` / BFF 文件名 / 未登记种类 400 / 导入 multipart 与清单并集，⑪ 覆盖 pcap 的 `lab:sniffer` 门禁与二进制直出、抓包启停、`full_reset` 的 confirm 闸门与清单清空，⑫ 覆盖 WebSocket 票的权限 / 种类 / 目标绑定、无票与篡改与重放三条 401、实时帧透传与上游零 cookie、会话审计不含载荷，⑬ 覆盖终端 / 日志 / 监控三条通道的 target 形状与台账收窄、终端上行回显与 `Ctrl-C` 控制字节、日志逐行原文、监控 `node:intf` 查询串与采样，⑭ 覆盖台账对账的 403 / 400（缺确认、确认不符）/ 409 / 上游读失败不落盘 / 清单整体重写与幽灵 id 清除 / 两条审计 / 不在白名单，⑰ 覆盖 SNMP 凭据三条写端点的 `lab:snmp` 门禁、`snmp` 能力位不由写位推导、租户管理员 403 零上游，以及 409 / 404 的原样透传）。`pnpm check:lab-flows` 另有 21 项纯函数断言（草稿三条校验 / 请求体省略规则 / 清流请求体留空不发 `match` / 行号口径），`pnpm check:lab-run` 有 13 项（运行态三态归一 / iperf 两端与秒数校验 / 请求体省略规则 / `pingall` 与 iperf 结果文本化），`pnpm check:lab-ws` 有 21 项（四通道登记表与权限位 / `target` 四种形状 / 上游地址拼接 / 票与监控帧归一 / PTY 文本清洗），三者都不启 Nitro、不碰上游。
- 拓扑编辑（`/scenario/simulator`，ADR-0022 W2 / W2b）只走 `/api/mininet/**`：新增 / 删除节点、连线、拖动落库（`POST /node_position`）、OpenFlow 版本、流表读数（`GET /flows/{switch}`）与流表写入（`POST /flows` 加流、`DELETE /flows/{switch}/{flow_id}` 删单条、`DELETE /flows` 批量删流 —— `match` 留空即清整表，填了只删命中项）；删单条的 `flow_id` 是上游按「含 `actions=` 的行」数的 1 基序号，页面必须按同一口径计（`labFlowRowsOf()`）。`TopologyCanvas` 的 `draggable` 必须跟 `capabilities.operate` 走，否则拖动会「看起来成功但没落库」。
- 运行控制（W3）同样只走 `/api/mininet/**`：`POST /start`（`lab:create`）、`POST /stop`（`lab:operate`，确认弹窗）、`POST /pingall` / `POST /iperf`（`lab:operate`）。运行态只读 `GET /start` 的裸布尔：读到 `false` 才写「已停止」，读不到一律「未知」且四个动作全部禁用 —— 把「读不到」当成「没启动」会让启动按钮对着已在跑的网络发请求，再拿上游 400 当失败。这条「三态读数、`null` 一律禁用」不只属于实验台，是全站交互约束，口径以 `NMCPS-ARCH-006`（`layers/content/collections/cn/architecture/1.architecture/ui-architecture.md`）§4.2 为准，本节只记实验台怎么落地。四个动作互斥（上游单实例），失败原话（400 / 403 / 409 / 503）逐字显示。
- 台账对账（`NMCPS-ADR-0023`）是唯一的「只改台账、不转发上游写」端点：`POST /api/mininet/networks/{id}/sync`（静态路由 `networks/[id]/sync.post.ts`，**不在** `MININET_ROUTES` 里），双权限 `lab:create` + `lab:delete`、逐字确认 `{ confirm: "<network_id>" }`、先审计后执行、同网络单写锁；读 `/hosts` `/switches` `/routers` `/nats` `/controllers` 与 `/links` 后**整体重写**资源清单，任一读取失败原样回上游状态且不落盘。
- 无控制器的交换机按 `NMCPS-ADR-0024` 落在 `failMode='standalone'`（传统自学习，开箱即通），关联控制器后改 `secure`（OpenFlow 流表生效）；`pingall` 100% 丢包的根因就是「默认 secure + 零控制器」。导出脚本同源，`pnpm lab:check` 三条静态断言钉住映射、四个 OVS 分支与导出文本。
- 实时包列表（W5 WebSocket 段）：页面挂载先 `GET /api/mininet/sniffer/history` 回填，抓包态变 `true` 时由 `useLabSnifferStream()` 先 `POST /api/mininet/ws-ticket` 再连同源 `/mininet-ws/sniffer`（`null` / `false` 都不连）；组件不 `new WebSocket`，列表上限 200 条，停止抓包即断流但保留已收到的包。
- 右栏观测三块（面板五个标签页里的 Webshell / 日志 / 监控，`SimulatorNetworkTools` + `useLabWsChannel(kind)` / `useLabTerminalSessions()`）：Webshell 要 `lab:terminal`（节点来自台账，逐键上行走 `/mininet-ws/terminal`，每个节点一条会话标签，握手期的按键先排队到上游 `open`）；日志与监控只要 `lab:read`（`/mininet-ws/logs` 逐行、`/mininet-ws/monitor` 的 `target` 为 `<node>:<intf>`，接口选项只来自 `GET /api/mininet/interfaces`）。两个能力位都没有时这三页都不渲染（标签定义在页面的 `sideTabItems` 里）；日志随标签打开自动建流、离开即断，监控只有一个目标、切走即停，终端会话是**显式的多会话**——切标签不断流、标签上的 × 才断那一条，收起右栏才全断。上游在通道内用 `Error: …` 文本表达失败，页面显示成错误行而不是「暂无数据」。终端是逐键终端：`keydown` 翻译成 PTY 字节（回车 `\r`、退格 `0x7f`、方向键走 CSI、带修饰方向键 `CSI 1;<mod><letter>`、`Ctrl+字母` 发 `0x01–0x1A`、`Ctrl+Space` 发 `0x00`、`Alt+字母` 发 `ESC+字母`、F1–F12 走 xterm 序列），带 `Ctrl` / `Alt` / `Meta` 的可打印键一律不上行，`Ctrl+V` 只走粘贴事件（不能把 `v` 当输入）、IME 组字期间的 `keydown` 放行，连续字符攒 8ms 一帧，中文等 IME 输入由隐藏 textarea 的 `input` 事件整段送出；回显交给 PTY，面板不做本地回显（否则一次输入两份）。输出先过 `labTerminalTextOf()`：真 PTY 带 ANSI 颜色码与 `\r` 重绘，原样渲染会把提示符显示成 `^[[1;32m`；「中断」发 `0x03`，「清屏」只清浏览器侧转写且不断流。

## 已落地的鉴权（NMCPS-ADR-0021 P1）

- 登录 / 刷新签发 `nmcps_sess`：HMAC-SHA256、`HttpOnly`、`SameSite=Lax`、`Path=/`，载荷含 `sub` / `tid` / `iat` / `exp` / `ath`。
- `ath` 是访问令牌的 SHA-256；会话与凭据必须同源，错配一律 401。
- 密钥来自 `NUXT_BFF_SESSION_SECRET`（至少 32 字节），轮换窗口用 `NUXT_BFF_SESSION_SECRET_PREVIOUS` 验证旧 cookie；缺密钥回 `503 bff_auth_not_configured`。
- **生产启动的 `.env` 加载**：`pnpm start` 现在走 `scripts/start-server.mjs` —— 它先 `process.loadEnvFile('.env')`（只填**尚未设置**的变量，显式 export / 部署平台注入的变量优先），再 import `.output/server/index.mjs`。直接 `node .output/server/index.mjs` 不读 `.env`：忘了导出密钥时，登录照常但 `/scenario/simulator` 的每个 `/api/mininet/**` 都回 `503 bff_auth_not_configured`（已实测：带密钥时同一请求是 `401 bff_auth_required`）——这与角色无关，不是租户管理员被拒。密钥缺失或不足 32 字节时启动脚本会打印一条同名警告。
- `/api/mininet/**` 先解析 IAM `subject-roles → roles/{id}`，租户角色必须满足 `role.tenant_id === 会话 tid`；查询失败回 `503 bff_role_resolution_failed`，不降级成 `tenant_user`。
- 平台管理员（`tid === null`）回 `403 lab_permission_denied`，没有运行态权限。
- 主网关已剥离客户端 `x-tenant-id`；租户只来自签名会话，不来自请求头 / 查询 / body。
- 桌面端（`x-nmcps-client: desktop`）当前只在响应体拿 tokens，不落签名会话；在补充桌面会话承载前，`/api/mininet/**` 对桌面端返回 401。
- `/api/sim/**`（8001 仿真平台）已于 2026-11-25 随 `NMCPS-ADR-0027` §4 R8 退役：BFF 不再有第二条实验出站通道，租户实例与签名会话只在 `/api/mininet/**` 上闭环。
- **真实 IAM 里的 `lab_*` 角色需要手工补（2026-11-18 两个都已补齐）**：`GET /api/iam/roles?page=1&page_size=200`（2026-11-17 实测）只有 9 条（`platform_admin`、三个租户各三条 `tenant_admin` / `tenant_operator` / `tenant_viewer`），所以演示账号 `tenantadmin` 的 `/api/mininet/channel` 恒为 `terminal: false`、`admin` 恒为 `403`；`check:ui` / `check:lab-bff` 能全绿是因为 `scripts/lib/bff-harness.mjs` 自造了 `r_lab_terminal` 并绑给 `alice`。想在本机手点 Webshell / 抓包，得先在 IAM 侧把角色补出来：
  ```bash
  # 1) 建角色（用租户令牌建，实测落库 tenant_id = tnt_default；用 admin 建会是平台角色）
  curl --noproxy '*' -s -b /tmp/tj.txt -X POST -H 'content-type: application/json' \
    -d '{"name":"实验台终端","code":"lab_terminal","description":"Webshell（NMCPS-ADR-0021 D3）"}' \
    http://127.0.0.1:3000/api/iam/roles
  # 2) 绑定（role_id 用上一步返回的 id）
  curl --noproxy '*' -s -b /tmp/tj.txt -X POST -H 'content-type: application/json' \
    -d '{"subject_type":"user","subject_id":"u_tenant_admin","role_id":"<id>"}' \
    http://127.0.0.1:3000/api/iam/subject-roles/AssignRole
  ```
  注意命令要带 `--noproxy '*'`：本机 shell 设了 `http_proxy`，不加会把 `127.0.0.1:3000` 送去代理（拿到 One API 的 `Invalid URL (GET /api/...)` 或一张 HTML），看着像 BFF 404。
  **2026-11-18 补齐结果（`tnt_default`）**：`lab_terminal` = `f1f011d8-d5b0-43b6-9467-2cf8d8d57b67`（2026-11-17 建），`lab_sniffer` = `bcadd871-d4f2-40f5-9ac6-1c4ad28e096f`（本次建；`code` 必须是 `lab_sniffer`，BFF 只认 `LAB_ROLE_CODES`）；两条都 `AssignRole` 给 `alice`（`a6541d3f-…`），读回 `GET /iam/subject-roles?subject_id=a6541d3f-…` 是 2 行、`tenant_id` 均为 `tnt_default`。alice 的 `/api/mininet/channel` 因此变成 `terminal: true` + `sniffer: true`（`create` / `operate` / `delete` 仍 `false`），右栏 5 个标签（Webshell / 日志 / 监控 / 网络 / 连通）；「连通」里只有抓包读数（`抓包 · 未抓包` + 实时包面板），**没有**探测按钮 —— 那是 `lab:operate` 的入口。实测「工具 → 开始抓包」把上游 `sniffer/state` 推到 `active: true`、实时流状态变「实时」，再点「停止抓包」回到「未抓包」。页面刚加载时 `runState` 还没读回来（`null`），菜单项被 `disabled` 挡住约 1 秒 —— 等运行态显示「运行中」再点，这不是权限问题（这条禁用是 `NMCPS-ARCH-006` §4.2 规则的可见代价，见本节第 64 行）。
- **上游缺陷（`AssignRole` 不写关系租户；2026-11-18 上游已修复，尾部为复测证据）**。实测 `POST /iam/subject-roles/AssignRole` 无论 body 带不带 `tenant_id`、带不带 `X-Tenant-Id`，落库的 `sys_subject_role_relation.tenant_id` 恒为 `NULL`（`PUT` / `PATCH /subject-roles/{id}` 都是 404，没有修正入口）；而 `GET /iam/subject-roles?subject_id=<用户>` 按调用者租户过滤，`NULL` 关系对租户用户不可见 —— `resolveLabRoles()` 只按 `subject_id` 取关系，于是 `lab:terminal` 绑了也不生效。BFF 不做绕过（放宽 `role.tenantId === 会话 tid` 等于废掉 UP-RBAC-09），修法只在上游：AssignRole 从 role 推导 `tenant_id`，或补一次数据修正。本机已建的角色 `f1f011d8-d5b0-43b6-9467-2cf8d8d57b67`（`lab_terminal` / `tnt_default`）保留备用，关系已 `RevokeRole` 回滚，`u_tenant_admin` 仍只有 `r_tenant_admin`。**2026-11-18 复测（给 alice 绑定）**：`AssignRole` 回 `200`，平台管理员 `GET /iam/subject-roles?subject_id=a6541d3f-…` 能读到关系 `b7fa1e07-f955-47c6-8168-b26260bfe126`（响应里没有 `tenant_id` 字段 = `NULL`），而同一查询走租户会话（`tenantadmin`）仍返回 `total: 0`；alice 重登后 `/api/mininet/channel` 依旧 `terminal: false`。结论未变：缺陷在上游，BFF 不绕过。**2026-11-18 上游修复后复测已闭环**：重新 `AssignRole` 的 `lab_terminal` 关系行（`b7fa1e07-f955-47c6-8168-b26260bfe126`）带 `tenant_id = "tnt_default"`，`tenantadmin` 的 `GET /iam/subject-roles?subject_id=a6541d3f-…` 回 `total: 1`，全量关系 17 → 20 行且 `tenant_id` 为空的行 0 条（旧数据已回填）；alice 重登后 `GET /api/mininet/channel` 变 `terminal: true`（`create` / `operate` / `delete` / `sniffer` 仍 `false`），页面右栏由 日志 / 监控 / 网络 变成 日志 / 监控 / 网络 / Webshell，真连 `h1` 拿到 `root@h1:…$`、`id` 回 `uid=0(root)`。`lab_sniffer` 仍未建，所以「连通」对 alice 依旧不出现。
  **2026-11-18 决定性取证（发给上游的工单材料）**：`docs/handoff/iam-assignrole-report-2026-11-18.md`。三条硬证据 —— ① 给干净账号 `u_bj_01` `AssignRole` 传 role 的 uuid 回 `200 success`，紧接着 `GET subject-roles?subject_id=u_bj_01` 仍是 1 行、全量仍是 17 行（写入即失联）；② 同一对 `(subject, role)` 再 `AssignRole` 回 `400 duplicate key value violates unique constraint "uk_sys_srr_global_subject_role"`（行确实在表里）；③ `RevokeRole` 同一对回 `200`（能按 subject+role 删掉），删完全量仍 17 行。关系表名以错误文本为准是 `sys_subject_role_relation`（`fk_sys_srr_role`）。附带两条：约束冲突以 `HTTP 400 + 纯文本 "ERROR: …"` 返回而不是 `{code,message,data}` 信封；`GET /iam/subject-roles` 忽略 `role_id` 参数（带它也返回全量）。
- **本机手点 Webshell 的旁路（不动 IAM）**：`scripts/lib/bff-harness.mjs` 的 `startUpstream(port)` 同时给出假 IAM 与假 Mininet，`alice / p@ssw0rd` 自带 `r_lab_terminal` / `r_lab_sniffer` / `r_lab_tenant_admin`。用 `NUXT_BFF_UPSTREAM_BASE=http://127.0.0.1:8899` + `NUXT_MININET_INSTANCES='{"t_default":{"baseUrl":"http://127.0.0.1:8899"}}'` 重启 `pnpm dev` 即可；租户键必须是 `t_default`（假 IAM 里 alice 的 `tenantId`），写成真环境的 `tnt_default` 会得到 `configured: false` 与 `503 tenant_runtime_unavailable`，那是键名不匹配而不是权限问题。台账还要把节点登记进 `resources.nodes`（`["h1","h2","sw1"]`），否则 `/api/mininet/hosts` 回 `{}`、`ws-ticket` 对 `h1` 回 `404 lab_resource_not_found` —— 出口按台账清单收窄。这条链路是回显仿真（敲 `whoami` 收到 `echo:whoami`，不是真 PTY），验证的是 BFF 转发 + 前端渲染，真 shell 仍需回到 `.env` 指向的本机 Mininet。登录页进 `alice` 的入口是演示开关 `NUXT_PUBLIC_DEMO_LAB_OPERATOR=true`（`runtimeConfig.public.demoLabOperator`，缺省 `false` 时该按钮不渲染、预填回到 `admin`）：**2026-11-18 已在真实 IAM 建号**（`POST /api/iam/users`，部门 `dept_default_ops` → 租户 `tnt_default`，口令 `p@ssw0rd`，id `a6541d3f-7880-4bb9-8917-5338d78e6925`），实测上游与 BFF 登录都 200、`tenantId = tnt_default`；`/api/mininet/channel` 现在给 `read` + `terminal` + `sniffer`（`create` / `operate` / `delete` 仍 `false`，见上一条的补齐结果）。换上游实例前先确认它有 `alice`，没有就关掉开关；正式部署仍建议关闭（`NMCPS-ADR-0013` 的「实验台操作员随演示开关出现」条）。

  **旁路必须换端口，别污染 3000 的常驻实例**：把 `NUXT_BFF_UPSTREAM_BASE=http://127.0.0.1:8899`（外加 `NODE_USE_ENV_PROXY=1`）塞给默认 `pnpm dev`，假上游一退出，3000 上的登录就整片报 `502 bff_upstream_unreachable`，登录页显示「上游服务暂时不可达」——而 `.env` 里配的真实上游其实是好的（`curl --noproxy '*' http://192.168.1.55:8888/api/v1/health` 仍 200）。排查口径：先看 `/ready` 的 `upstream.reason`，再看该 dev 进程的环境（`tr '\0' '\n' < /proc/<dev pid>/environ | grep NUXT_BFF`），env 里出现 8899 就说明是旁路残留而不是上游故障。要手点 Webshell 就 `PORT=3001 NUXT_BFF_UPSTREAM_BASE=… pnpm dev` 另起一个，验完即停。

## 已裁决：每租户独立实例（NMCPS-ADR-0021）

- **隔离级别 A**：每个租户独立 Mininet 实例 / 容器 / 网络命名空间，不共享 `app.net`；单实例只能叫「global lease」，不得宣称隔离。
- **租户来源**：只从 BFF 签名会话取，`x-tenant-id`、请求体与查询参数一律不参与归属；P1 前不开放写操作。
- **权限矩阵**：`shared/constants/labPermissions.ts` 是唯一真源。租户普通用户默认 `lab:read`，租户管理员额外 `lab:create` / `lab:operate` / `lab:delete`；`lab:terminal` / `lab:sniffer` / `lab:snmp` 必须单独授权（各自对应 IAM 角色 `lab_terminal` / `lab_sniffer` / `lab_snmp`，不由任何写位推导）。
- **角色校验**：租户角色必须满足 `role.tenant_id === 会话 tenant_id`（UP-RBAC-09）；平台管理员默认没有运行态访问权。
- **资源边界**：BFF 台账记录 `tenant_id` / `engine` / `upstream_id`，上游 `sim_id`、节点 ID、链路 ID 都不是权限凭据；跨租户统一 404。
- **单网络**：同一租户同一引擎同时最多一张运行中网络，第二次创建 / 启动回 `409`。
- **审计**：创建、启动、停止、重置、删除、终端、抓包全部留痕；高风险动作审计失败即拒绝。

## 后续必须拍板

1. **WebSocket 鉴权**：BFF 签发短时 ticket，反代校验后转发。
2. **平台管理员支持会话**：若需要排障，另立 ADR 定义授权人、时限与范围（当前默认拒绝）。
3. **每租户实例编排**：容器 / 命名空间 / 配额的创建与销毁在部署面，BFF 只消费注册表。
4. **数据归属**：实验拓扑只导出/导入，不覆盖生产拓扑。
5. **审计落地**：审计存储、保留期与查询入口。
