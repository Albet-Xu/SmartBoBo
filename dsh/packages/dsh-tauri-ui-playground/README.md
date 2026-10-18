# dsh-tauri-ui-playground

Dev-only「UI 组件」调试面板，从 `dsh-tauri-ui` 拆出的独立包；组件层仍从 `dsh-tauri-ui/client` 复用。

该包 **不在** `src-tauri/resources/manifest.jsonc` 的 `plugins.built-in` 中：debug 构建由 `preset.rs` 的 `discover_dev_internal_plugins_at` 扫描 `packages/*` 发现并安装，release 构建不包含它。
