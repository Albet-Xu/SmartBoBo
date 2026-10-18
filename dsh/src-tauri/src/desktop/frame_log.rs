//! 帧内前端日志桥：把 dsh iframe（含其内部嵌套 frame）的 `console.warn/error`
//! 与未捕获异常送回宿主，落盘到 `desktop.frontdesk.log`。
//!
//! iframe 与壳层跨源，帧内 `console.*` 既没有壳层的 console 劫持（`src/utils/logger.ts`
//! 只跑在壳层文档里），也没有宿主侧通路，报障时「运行日志」里只有壳层自己的前台日志，
//! 帧内报错完全缺失。脚本按 `dsh-notification-bridge` / `dsh-clipboard-image-bridge`
//! 同一套注入通道（Windows 在 FrameCreated → ContentLoading 时 ExecuteScript，其余平台
//! `initialization_script_for_all_frames`）下发，带 `__dsh_frame_log_bridge__` 幂等守卫；
//! 顶层文档直接返回，避免与壳层日志重复。宿主侧由 `src/layout/components/iframe.tsx`
//! 的 `dsh://frame-log` 分支调 `log_frontend`（`target: "iframe"`）。

/// iframe 内：console.warn/error 与未捕获异常 → `dsh://frame-log` → 宿主落盘。
pub(crate) const FRAME_LOG_BRIDGE_JS: &str = include_str!("frame_log.js.inc");

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_log_bridge_only_taps_frames_and_stays_idempotent() {
        assert!(FRAME_LOG_BRIDGE_JS.contains("window.__dsh_frame_log_bridge__"));
        assert!(FRAME_LOG_BRIDGE_JS.contains("if (window === window.top) return"));
        assert!(FRAME_LOG_BRIDGE_JS.contains("dsh://frame-log"));
        assert!(FRAME_LOG_BRIDGE_JS.contains("dsh-frame-log-bridge"));
        assert!(FRAME_LOG_BRIDGE_JS.contains("unhandledrejection"));
        assert!(FRAME_LOG_BRIDGE_JS.contains("originalError"));
        assert!(FRAME_LOG_BRIDGE_JS.contains("window.parent.postMessage"));
        assert!(!FRAME_LOG_BRIDGE_JS.contains("location.reload"));
    }
}
