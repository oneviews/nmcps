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
- 整跑 `check:lab-real`（root 下才会真断言 tc）：`sudo` 会重置环境变量，所以 `CHECK_REAL_MININET` / `REAL_MININET_BASE` /
  `PATH`（nvm 的 `node` 不在 sudo 的 `secure_path` 里）都要跟在 `sudo -A env …` 之后传；浏览器的
  `PLAYWRIGHT_BROWSERS_PATH` 不用管，脚本自己回落到 `$SUDO_USER` 的缓存（2026-11-20 实测 root 下 18/18 全绿）：
  ```bash
  NODE_BIN=$(dirname "$(command -v node)")
  SUDO_ASKPASS="$PWD/.clinerules/sudo-askpass.sh" sudo -A env \
    PATH="$NODE_BIN:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
    CHECK_REAL_MININET=1 REAL_MININET_BASE=http://192.168.1.90:8000 \
    node layers/scenario/scripts/check-lab-real.mjs
  ```
  中途失败会把 `h1` / `h2` 与那条带 `bw` 的链路留在真后端上（脚本在起网之后才崩的话）—— 下次跑前先
  `POST /api/mininet/full_reset` 清空，别让「非空实例」守卫替你报错。
- 密码换了就只改 `.clinerules/.sudo.local`；本文件若发现引用了不存在的文件，先问用户要口令，
  不要凭猜测尝试或改用别的提权方式。
