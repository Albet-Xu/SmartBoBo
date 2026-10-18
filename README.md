# SmartBoBo

基于 Deepseek Harness（dsh web）的智能工作台：启动脚本 + SmartBoBo 品牌补丁 + CloakBrowser 隐身浏览器集成。

## 仓库内容

| 路径 | 说明 |
|---|---|
| `启动.cmd` / `启动.sh` | 启动器：打品牌补丁 → 以项目内 `DSH_HOME` 启动 dsh web（7075） |
| `scripts/` | `apply-brand-patch.mjs` 等工具脚本 |
| `cloak/` | CloakBrowser 集成：官方 `cloakserve` vendored 脚本、dsh 插件（`cloak_fetch` 工具）、预铺脚本 `ensure.ps1` |
| `docs/` | 集成与界面文档 |
| `pyproject.toml` / `uv.lock` / `.python-version` | Python 运行时（uv 管理，见下） |
| `.dsh/` | 本地 DSH_HOME 运行状态（含凭据，已 gitignore） |
| `dsh/` | deepseek-harness-desktop 源码工作区（含 SmartBoBo 品牌改动；以普通文件收录，不含其 `.git` 历史与 `source/` 第三方子仓） |
| `vendor/` | 从桌面端安装包迁出的 `dsh-tauri-*` 插件构建产物（profile 以 link: 引用；含定点补丁，见 docs/前端界面/03） |

## 运行前提

1. 打包内核位于 `%APPDATA%\dsh-tauri\dependencies\dsh\`（随原桌面应用首次运行下载，独立于安装目录）；若不存在，重装 [Deepseek Harness Desktop](https://github.com/dsh-tauri/deepseek-harness-desktop) 跑一次下载，或自行设置 `DSH_KERNEL`。
2. Windows 双击 `启动.cmd`；浏览器自动打开 `http://127.0.0.1:7075`。

## CloakBrowser 运行时（uv 管理 Python 依赖）

```powershell
# 需已安装 uv：https://docs.astral.sh/uv/
powershell -ExecutionPolicy Bypass -File cloak\ensure.ps1   # uv sync + 浏览器二进制预铺
node cloak\plugin\test.mjs                                   # 回归测试（可选）
```

依赖声明在 `pyproject.toml`，锁定在 `uv.lock`，虚拟环境在项目根 `.venv/`。详见 `docs/CloakBrowser浏览器/01-CloakBrowser集成操作指南.md`。

## dsh 源码工作区

`dsh/` 源自 [dsh-tauri/deepseek-harness-desktop](https://github.com/dsh-tauri/deepseek-harness-desktop)，已作为普通文件随本仓库上传（其本地 `.git` 历史、`node_modules`、`source/` 下 13 个第三方子仓不上传）。品牌改动由 `scripts/apply-brand-patch.mjs` 幂等生成。
