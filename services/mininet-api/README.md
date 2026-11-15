# Mininet API

独立部署的 Mininet 实验后端（FastAPI）。它属于本仓库，但**不跟随 Nuxt 构建**：
运行在需要 Linux、root、Mininet、OVS、Ryu 的实验主机或容器中。

## 边界

- 只监听 `127.0.0.1:8000` 或受控内网，由 nmcps2 BFF 的 `/api/lab/**` 代理。
- 浏览器不得直接访问本服务；终端、抓包、reset 等特权操作必须经过 BFF 鉴权与审计。
- 拓扑状态归本服务所有，Nuxt 只读或通过显式 API 修改。
- 接口变更后运行 `pnpm contracts:gen`，契约快照位于 `packages/contracts/openapi/mininet.json`。

## 本地运行

```bash
pnpm dev:lab-api
pnpm lab:check
```

依赖：系统已安装 Mininet/OVS/Ryu，Python 依赖见 `requirements.txt`。
