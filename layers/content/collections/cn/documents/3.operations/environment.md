---
title: "开发环境调优"
description: "内容中心开发环境调优：dev server 配置、@nuxt/content 缓存与 HMR 注意事项。"
excerpt: "dev server 配置、content 缓存与 HMR 调优。"
createdAt: "2026-10-25"
updatedAt: "2026-10-25"
icon: "carbon:book"
---

# 开发环境调优

## dev server

- 端口：3000（`strictPort: true`）。
- 监听 `0.0.0.0`，便于物理设备访问。

## @nuxt/content 缓存

- 内容集合在 dev server 启动时解析一次，文档变更经 HMR 增量解析。
- **新增集合目录后需重启 dev server**，否则监视器不识别新目录。

## 双语集合

- `content_cn`：cn 权威语言。
- `content_en`：en 镜像（docId 一致、路径对齐）。
- 文档页经 `useContentCollection` 按 locale 切换集合。

## 三栏布局 sticky 偏移

左树 / 右目录的 sticky 偏移与最大高度由布局根节点注入的 CSS 变量控制：

- `--content-sticky-top`：sticky 偏移（bigscreen 为 0，其余为 toolbar 高度）。
- `--content-max-h`：sticky 最大高度（跟随滚动容器）。
