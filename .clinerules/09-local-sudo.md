---
paths:
  - "scripts/**"
  - "layers/scenario/scripts/**"
  - "services/mininet-api/**"
  - "docs/ai/**"
  - ".clinerules/**"
---
# 本地 sudo 凭据与用法

本机登录用户 `user` 有 sudo 权限。**密码不入库**：写在 `.clinerules/.sudo.local`（git-ignored，`chmod 600`）。
本文件只写「怎么用」，不写「用什么」。永远不要把密码写进被跟踪的文件、提交信息、日志或命令回显。

## 何时需要 root

- Mininet 特权操作：`mn -c`、`ovs-vsctl`、`tc qdisc show`、`pkill -9 -f 'uvicorn mininet_gui_backend.api:app'`、重启 `:8000` 后端。
  完整步骤与踩坑见 `docs/ai/lab-boundary.md`。
- `pnpm check:lab-real` 的 tc 那一层：只有脚本以 root 运行才断言接口的 htb 类 `rate` 就是新带宽；普通用户跑只会打 `⏭`
  （跳过不算通过，别读成已验证）。
- 安装系统依赖 / 改 `/etc/hosts` / 操作容器网络这类一次性动作。

不需要 root 的别硬要：`GET /api/mininet/*` 读台账、跑 `check:ui` / `check:lab-bff` / `lint` / `typecheck` 全是普通用户。

## 怎么用

`sudo -n` 在本机**不可用**（实测 `sudo: interactive authentication is required`），不要用它探测权限，
也不要写进脚本当门禁。用 `sudo -A` + 同目录的 `sudo-askpass.sh`：助手只把口令文件的内容回显给 sudo ——
口令不在仓库里、不在命令行上、不出现在 `ps` 里。

```bash
# 探活（`sudo -k` 先清缓存，确认真的走到了 askpass）
sudo -k
SUDO_ASKPASS="$PWD/.clinerules/sudo-askpass.sh" sudo -A id -u        # → 0

# 查一台主机接口上的限速：接口在**主机自己的 netns** 里，根 netns 看不到 h1-eth0，
# 所以要先拿 pid，再用 nsenter 进去（Mininet 的 TCLink 用 htb，bw 落在 class 的 rate 上）
H1_PID=$(curl -s http://127.0.0.1:8000/api/mininet/interfaces | sed -n 's/.*"id":"h1"[^}]*"pid":\([0-9]*\).*/\1/p')
SUDO_ASKPASS="$PWD/.clinerules/sudo-askpass.sh" sudo -A nsenter -t "$H1_PID" -n tc class show dev h1-eth0
```

口令文件默认是本目录的 `.sudo.local`（git-ignored，`chmod 600`）。要指到别处用
`NMCPS_SUDO_PASS_FILE=/path/to/pass`（本机实测能传进 askpass；若哪天被 sudo 的 `env_reset` 挡住，
加 `-E` 或改脚本默认值）。文件缺失时 askpass 打一行说明并以 1 退出，**不会**卡在等输入 ——
这正是 `sudo -S` 喂错口令时会发生的卡死。

没有 askpass 的场合（某些脚本 / 管道）才用 `sudo -S -p ''` 从 stdin 喂：

```bash
sudo -S -p '' id -u < .clinerules/.sudo.local
```

硬约束：

- 用 `< .clinerules/.sudo.local` 重定向或 `sudo -A`，**不要** `echo "$PASS" | sudo -S` —— 后者在 `ps` 里明文可见；
  也**不要**把口令内联进 `SUDO_ASKPASS`（那等于把口令写进命令行）。
- 一条命令串只喂一次密码：`sudo` 有一次性的凭据缓存，重复读没意义；密码输错时 `sudo -S` 会再等输入，
  所以别在交互式终端里跑需要密码的 `sudo -S`，一次喂错就卡住（`-A` 没有这个问题）。
- 起长驻进程（重启后端）要 `sudo -A nohup … > /tmp/xxx.log 2>&1 &`，然后**用 `curl` 的 HTTP 码验证**
  （`000` = 没人 bind，见 `docs/ai/lab-boundary.md` 的「两个进程都在、没人 bind」），不要等提示符。
  验证回环端口必须 `curl --noproxy '*'`：本机 `http_proxy` 会把 `127.0.0.1` 也送去公司代理，
  不绕过时拿到的是代理那侧的 nginx 400，不是本服务的真实状态。
- 整跑 `check:lab-real`（root 下才会真断言 tc）直接用包装脚本 `pnpm check:lab-real:root`
  （`layers/scenario/scripts/check-lab-real-root.mjs`）：它自己把 `PATH`（nvm 的 `node` 不在 sudo 的
  `secure_path` 里）、`CHECK_REAL_MININET=1`、`REAL_MININET_BASE` 跟在 `sudo -A env …` 之后传，
  并检查 askpass helper 存在可执行 —— 手写这条命令最容易漏变量（漏 `PATH` = `sudo: node: command not found`，
  漏门禁变量 = 打 `⏭` 却被读成「已验」）。**`REAL_MININET_BASE` 的缺省就是 `http://127.0.0.1:8000`，
  本机也用它**（2026-11-25 实测 `REAL_MININET_BASE=http://127.0.0.1:8000 pnpm check:lab-real:root`
  19/19 全绿，含 tc 真断言）。两处曾经的误判要分清：
  - `curl http://127.0.0.1:8000/...` 回 nginx 的 400「plain HTTP to HTTPS port」**不是端口被占**，是本机
    `http_proxy` 把回环请求也送去了公司代理。验证直连要 `curl --noproxy '*'`；Node 内置 fetch 只在
    `NODE_USE_ENV_PROXY` 打开时才走代理（本机没开），所以脚本自己不受影响。
  - 改成网卡地址 `http://192.168.1.90:8000` 时，后端若没配 `LAB_API_TOKEN` 会回 **401 `lab_token_required`**
    （loopback-only 策略；`/api/health`、`/api/version` 例外）。要给后端开 token 再按网卡地址跑：
    `LAB_API_TOKEN=<token> REAL_MININET_BASE=http://192.168.1.90:8000 pnpm check:lab-real:root` ——
    包装脚本把 token 落成 `.data` 下的 0600 临时文件、只把 `LAB_TOKEN_FILE=<路径>` 传给 root 进程
    （`ps` 里看不到明文），被测脚本据此给准备 / 收尾的直连带 `x-lab-token`、给 BFF 配同值
    `NUXT_MININET_TOKEN`，收尾自动删文件。实测 2026-11-25：token 后端 + 网卡地址 **19/19 全绿**（含 tc 真断言）。
  实例非空时脚本会在空实例守卫处报错退出（实测 2026-11-23：什么都没测就 `EXIT=1`，极易被读成「用例挂了」），
  跑前先 `POST /api/mininet/full_reset`。要手工复现等价命令
  （2026-11-20 实测 root 下 18/18 全绿；2026-11-23 新增真 iperf 用例、2026-11-25 复验后 19/19 全绿）：
  ```bash
  NODE_BIN=$(dirname "$(command -v node)")
  SUDO_ASKPASS="$PWD/.clinerules/sudo-askpass.sh" sudo -A env \
    PATH="$NODE_BIN:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
    CHECK_REAL_MININET=1 REAL_MININET_BASE=http://127.0.0.1:8000 \
    node layers/scenario/scripts/check-lab-real.mjs
  ```
  浏览器的 `PLAYWRIGHT_BROWSERS_PATH` 不用管，脚本自己回落到 `$SUDO_USER` 的缓存。
  中途失败会把 `h1` / `h2` 与那条带 `bw` 的链路留在真后端上（脚本在起网之后才崩的话）—— 下次跑前先
  `POST /api/mininet/full_reset` 清空，别让「非空实例」守卫替你报错。
- root 跑完会留下 **root 名下的 `.data` 产物**（当日审计分片 `.data/audit/lab-audit-<日期>.jsonl`）。
  之后普通用户起的 BFF 往同一分片追加就是 `EACCES`，**每条写端点回 503 `audit_unavailable`** ——
  `check:ui` 的写用例会全红（实测 2026-11-22：11.4 四条 + 后续弹窗卡死，读用例仍然全绿，极易误判成代码回归）。
  包装脚本已在 `finally` 里把 `.data` 下 root 名下的文件 chown 回 `$SUDO_UID:$SUDO_GID`；手工跑过 root 命令的话，
  收尾自己补一条 `sudo -A chown -R "$(id -u):$(id -g)" .data`。诊断口径：`find .data -user root` 有输出就先修权限再谈代码。
- 提权统一走 `sudo -A` + `$PWD/.clinerules/sudo-askpass.sh`（或 `pnpm check:lab-real:root`，两者同一路径）：
  新增脚本别再自造提权方式，也别把口令搬到别的文件 —— `pnpm check:rules` 断言 helper 可执行、
  `.sudo.local` 被忽略且未被跟踪、口令原文不出现在任何被跟踪文件里。
- 密码换了就只改 `.clinerules/.sudo.local`；本文件若发现引用了不存在的文件，先问用户要口令，
  不要凭猜测尝试或改用别的提权方式。
