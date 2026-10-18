//! 官方 dsh boot 页卡在 “Loading plugins…” 时通知宿主执行有界恢复。
//!
//! 脚本仅精确识别 `#root` 下单一 boot 根节点的 wordmark（HARNESS/AGENT）与
//! Loading plugins 提示；普通页面正文出现同名文本不会触发。计时从 splash 首次被观察到
//! 才开始，消失后撤销，晚出现或再次出现都可重新计时；正常应用 shell 挂载后永久
//! 停止观察。
//!
//! 另有一条帧身份申报（issue #705）：子 frame 解析出 `#root` 即上报
//! `dsh://plugin-boot:frame`，宿主据此认定「帧里确实加载了 dsh 页面」而不是
//! 浏览器内部错误页（错误页同样触发 iframe 的 load，且永远没有 `#root`）。

/// iframe 内：报告帧身份与 boot 页 stalled/ready/failed；实际重载预算由宿主管理。
pub(crate) const PLUGIN_BOOT_RELOAD_JS: &str = include_str!("plugin_boot.js.inc");

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn boot_bridge_uses_exact_dom_and_cleans_up_without_self_reload() {
        assert!(PLUGIN_BOOT_RELOAD_JS.contains("getElementById('root')"));
        assert!(PLUGIN_BOOT_RELOAD_JS.contains("isOfficialSplash"));
        assert!(PLUGIN_BOOT_RELOAD_JS.contains("isApplicationShell"));
        assert!(PLUGIN_BOOT_RELOAD_JS.contains("MutationObserver"));
        assert!(PLUGIN_BOOT_RELOAD_JS.contains("pagehide"));
        assert!(PLUGIN_BOOT_RELOAD_JS.contains("dsh://plugin-boot:stalled"));
        assert!(PLUGIN_BOOT_RELOAD_JS.contains("dsh://plugin-boot:ready"));
        assert!(PLUGIN_BOOT_RELOAD_JS.contains("dsh://plugin-boot:failed"));
        assert!(PLUGIN_BOOT_RELOAD_JS.contains("dsh://plugin-boot:frame"));
        assert!(PLUGIN_BOOT_RELOAD_JS.contains("dsh://plugin-boot:leaving"));
        assert!(PLUGIN_BOOT_RELOAD_JS.contains("reportFrame"));
        assert!(PLUGIN_BOOT_RELOAD_JS.contains("reportLeaving"));
        assert!(PLUGIN_BOOT_RELOAD_JS.contains("reportRestored"));
        assert!(PLUGIN_BOOT_RELOAD_JS.contains("window.parent === window.top"));
        assert!(PLUGIN_BOOT_RELOAD_JS.contains("bootFailureText"));
        assert!(PLUGIN_BOOT_RELOAD_JS.contains("Failed to load plugins"));
        assert!(!PLUGIN_BOOT_RELOAD_JS.contains("body.innerText"));
        assert!(!PLUGIN_BOOT_RELOAD_JS.contains("location.reload"));
    }
}
