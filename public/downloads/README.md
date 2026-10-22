# 安装包存放目录

将构建好的安装包放到本目录（`public/downloads/`），文件名需与 `app/app.config.ts` 中 `downloads.assets` 配置保持一致。

## 构建命令

```sh
pnpm tauri:build
```

## 产物位置

`src-tauri/target/release/bundle/`

## 各平台默认产物（Tauri v2 默认命名）

| 平台 | 产物 |
|---|---|
| Windows | `nmcps_1.7.0_x64-setup.exe` / `nmcps_1.7.0_x64_en-US.msi` |
| macOS | `nmcps_1.7.0_universal.dmg` |
| Linux | `nmcps_1.7.0_amd64.deb` / `.AppImage` / `.rpm` |
| Android | `.apk`（位于 `src-tauri/gen/android/app/build/outputs/`） |

## 访问方式

文件放入后，通过以下地址直接下载：

```
http://192.168.1.90:3000/downloads/<文件名>
```

> 注意：`public/` 目录下的文件会被 Nuxt 原样静态托管（不打包进 JS），
> 但执行 `pnpm generate` 时会复制到 `dist/`，请确保磁盘空间充足。
