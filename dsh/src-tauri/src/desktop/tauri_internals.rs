//! Tauri 初始化脚本兼容桥：给子 frame 补上 `window.__TAURI_INTERNALS__`。
//!
//! 背景：Tauri 的 `path` 插件初始化脚本（`tauri/src/path/init.js`）无条件读取
//! `window.__TAURI_INTERNALS__.plugins`，而定义该全局的引导脚本是 main-frame-only
//! （`tauri/src/manager/webview.rs` 的 `main_frame_script`）。Windows/WebView2 上 wry
//! 忽略该标记（“scripts are always added to subframes regardless of the
//! `for_main_frame_only` option”），会把每个插件初始化脚本注入所有子 frame；dsh GUI
//! 正跑在跨源 `<iframe>` 里（见 `src/layout/components/iframe.tsx`），于是每次加载都抛
//! `Uncaught TypeError: Cannot read properties of undefined (reading 'plugins')`
//! （堆栈 `<anonymous>:5:50` 就是 `path/init.js` 第 5 行）。
//!
//! 修法只能落在壳层：Tauri 用户插件的初始化脚本排在 core 插件之前注册
//! （`App::register_core_plugins` 在 `Builder::build` 末尾才执行），所以把本垫片注册成
//! **第一个**用户插件，就能保证它先于 `path` 脚本执行，把缺失的骨架补回去。
//!
//! 刻意不定义 `isTauri`：引导脚本用不可配置的 `Object.defineProperty` 定义它，垫片重复
//! 定义会抛 `Cannot redefine property: isTauri`，反而在主 frame 制造新报错。
//!
//! 仅在 Windows 注入：其余平台 wry 尊重 `for_main_frame_only`，子 frame 本来收不到
//! `path` 脚本；补上 `__TAURI_INTERNALS__` 会改变 dsh 页面在 macOS/Linux 下的能力探测。

/// 补齐 `window.__TAURI_INTERNALS__` 骨架的幂等垫片（与 Tauri 引导脚本同形）。
pub(crate) const TAURI_INTERNALS_SHIM_JS: &str = r#"(function () {
  if (window.__TAURI_INTERNALS__) return;
  Object.defineProperty(window, '__TAURI_INTERNALS__', { value: { plugins: {} } });
})();"#;

/// 构造垫片插件：只带初始化脚本，注入所有 frame（Windows 上 wry 本来就全 frame 注入）。
pub(crate) fn shim<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("dsh-tauri-internals-shim")
        .js_init_script_on_all_frames(TAURI_INTERNALS_SHIM_JS)
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shim_fills_internals_without_touching_is_tauri() {
        assert!(TAURI_INTERNALS_SHIM_JS.contains("window.__TAURI_INTERNALS__"));
        assert!(TAURI_INTERNALS_SHIM_JS.contains("plugins"));
        // isTauri 由引导脚本以不可配置 defineProperty 定义，垫片再定义会抛错
        assert!(!TAURI_INTERNALS_SHIM_JS.contains("isTauri"));
    }
}
