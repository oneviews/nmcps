# 下载说明

安装包已改用 **GitHub Release** 托管，不再本地存放于此目录。

下载页会从 GitHub Release 自动获取对应平台/架构的安装包：

```
https://github.com/oneviews/nmcps/releases
```

> 原因：`public/` 目录会被 Nuxt 打包进应用、再被 Tauri 嵌入二进制，
> 若把安装包放在这里会导致二进制体积膨胀数百 MB。
> 因此安装包统一由 CI 上传到 GitHub Release，下载页直接引用其下载链接。
