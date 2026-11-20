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
也不要写进脚本当门禁。一律用 `sudo -S -p ''` 从 **stdin** 喂密码，密码从本地文件读：

```bash
# 探活（一条命令验一次，不落日志）
sudo -S -p '' id -u < .clinerules/.sudo.local

# 查一台主机接口上的限速：接口在**主机自己的 netns** 里，根 netns 看不到 h1-eth0，
# 所以要先拿 pid，再用 nsenter 进去（Mininet 的 TCLink 用 htb，bw 落在 class 的 rate 上）
H1_PID=$(curl -s http://127.0.0.1:8000/api/mininet/interfaces | sed -n 's/.*"id":"h1"[^}]*"pid":\([0-9]*\).*/\1/p')
sudo -S -p '' nsenter -t "$H1_PID" -n tc class show dev h1-eth0 < .clinerules/.sudo.local
```

硬约束：

- 用 `< .clinerules/.sudo.local` 重定向，**不要** `echo "$PASS" | sudo -S` —— 后者在 `ps` 里明文可见。
- 一条命令串只喂一次密码：`sudo` 有一次性的凭据缓存，重复读没意义；密码输错时 `sudo` 会再等输入，
  所以别在交互式终端里跑需要密码的 `sudo`，一次喂错就卡住。
- 起长驻进程（重启后端）要 `sudo -S -p '' nohup … > /tmp/xxx.log 2>&1 &`，然后**用 `curl` 的 HTTP 码验证**
  （`000` = 没人 bind，见 `docs/ai/lab-boundary.md` 的「两个进程都在、没人 bind」），不要等提示符。
- 以 root 跑 Playwright（整个 `check:lab-real`）会撞 Chromium sandbox / `.output` 归属问题：**不要**为此改脚本，
  tc 那一层单独用上面那条 `nsenter -t <pid> -n tc class show …` 手验即可。
- 密码换了就只改 `.clinerules/.sudo.local`；本文件若发现引用了不存在的文件，先问用户要口令，
  不要凭猜测尝试或改用别的提权方式。
