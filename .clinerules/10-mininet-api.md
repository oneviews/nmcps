---
paths:
  - "services/mininet-api/**"
---
# Mininet API

本目录是独立部署的 FastAPI 服务，不是 Nitro 的一部分。

- 沿用 `mininet_gui_backend/` 现有模块划分；新增文件放同包内，不建第二套入口。
- 依赖保持 `requirements.txt` + `pyproject.toml` 显式声明；不引入 Node 工具链。
- 修改路由或 Pydantic schema 后，运行 `pnpm lab:check` 和 `pnpm contracts:gen`。
- 浏览器不得直连本服务；新端点必须在 BFF 白名单登记并通过 `/api/lab/**` 暴露。
- 终端、抓包、`reset`、`full_reset` 等特权端点必须带权限与审计设计，不能默认开放。
- 日志写 `mininet_gui_backend/mininet.log`，不得提交；`.venv`、`__pycache__`、`nohup.out` 同样不提交。
- 后端仍是单实例 `app.net`；未完成隔离前，不要假设多用户可并发操作。
