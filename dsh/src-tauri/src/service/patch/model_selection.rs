//! 模型选择菜单的鼠标点击补丁：WKWebView 下点击模型 / 推理等级不再空操作。
//!
//! 现象（Tauri 的 macOS WKWebView 里，模型座位「选择模型」与「推理等级」两栏都必须
//! 用键盘 ↑/↓ + Enter 才能生效；鼠标左键点选项时菜单关闭、等级与模型都不变、既没有
//! 报错也没有任何请求发往核心。同一个核心用浏览器打开时鼠标可以正常选择）：
//! `@deepseek-ai/dsh-client-ui-model-selection` 的 `ModelSelect` 在 `drill()` 之后会把
//! 焦点主动移进 portal 菜单里的某个选项，而根节点的 `onBlur` 只在 `relatedTarget`
//! 落在自身或菜单容器内时才放行，否则一律 `close()`。
//!
//! 根因：WebKit 点击 `<button>` 不会把焦点交给该按钮，因此 mousedown 期间被聚焦的
//! 菜单项失焦时 `relatedTarget` 为 null，`onBlur` 判定为「焦点跑到菜单外」并在
//! mousedown 阶段就卸载菜单——选项的 `click` 再也没有机会触发。Chromium 会给被点击
//! 的按钮焦点，`relatedTarget` 落在 `menuRef` 内，所以同一份代码在浏览器里正常；
//! 键盘路径的焦点自始至终没离开菜单（Enter / Tab 直接 click 已聚焦的按钮），因此也
//! 正常。这就是「键盘能选、鼠标不能、浏览器能选」三者并存的解释。
//!
//! 补丁只加一条守卫：`relatedTarget` 缺失时不再关菜单。菜单外的鼠标点击本来就由同一
//! 个组件的文档级 mousedown 处理器负责关闭，Escape / Tab 也另有按键处理，所以放开这
//! 条路径不会让菜单失去关闭手段；唯一的行为差异是窗口失焦不再自动收起菜单。
//! `relatedTarget` 非空时（浏览器点击、Tab 移出）判定逻辑与原实现完全一致。
//!
//! 目标选择：**活动核心**的 `dsh-client-ui-model-selection/lib/client.js`（web 侧由 dsh
//! 的 web 服务直接读该文件），读写与幂等判定统一交给 [`crate::utils::patch_dsh`]。
//! 锚点缺失（上游换了实现，或官方已修掉这个 WebKit 差异）一律安全跳过，不阻断启动。
//!
//! 挂点：`service::workflow::launch` 启动 dsh 进程前的补丁链（最佳努力，失败只告警）。

use std::path::Path;

use crate::utils::{patch_core_file, patch_dsh, PatchOutcome};

/// 幂等/自识别标记：出现在新增守卫行的末尾。
const PATCH_MARKER: &str = "dsh-tauri: keep the model menu mounted through a WebKit blur";

/// `onBlur` 里「焦点仍在自身或菜单内则放行」的那条判定（锚点绑定 0.1.6-alpha.2 压缩后源码）。
const ONBLUR_ANCHOR: &str = "\t\t\t\tif (event.relatedTarget instanceof Node && (rootRef.current?.contains(event.relatedTarget) === true || menuRef.current?.contains(event.relatedTarget) === true)) return;";

/// 补丁后：先放行 `relatedTarget` 缺失的 blur（WebKit 点按钮不给焦点），再保留原判定。
const ONBLUR_PATCHED: &str = "\t\t\t\tif (event.relatedTarget === null || event.relatedTarget === void 0) return; /* dsh-tauri: keep the model menu mounted through a WebKit blur */\n\t\t\t\tif (event.relatedTarget instanceof Node && (rootRef.current?.contains(event.relatedTarget) === true || menuRef.current?.contains(event.relatedTarget) === true)) return;";

/// 相对活动核心安装目录的模型选择客户端 `lib/client.js` 包内路径。
const MODEL_SELECTION_CLIENT_JS: &str =
    "node_modules/@deepseek-ai/dsh-client-ui-model-selection/lib/client.js";

fn patch_source(source: &str) -> PatchOutcome {
    if source.contains(PATCH_MARKER) {
        return PatchOutcome::AlreadyPatched;
    }
    if !source.contains(ONBLUR_ANCHOR) {
        return PatchOutcome::AnchorMissing;
    }
    PatchOutcome::Patched(source.replacen(ONBLUR_ANCHOR, ONBLUR_PATCHED, 1))
}

/// 对活动核心的 dsh-client-ui-model-selection `lib/client.js` 应用补丁（幂等）。
/// 返回 Err 表示读/写失败；文件缺失、已打过、锚点变更均静默跳过（Ok）。
/// 对显式给定的核心安装目录施加本补丁（E2E 编排复用，无需运行中的桌面端）。
pub fn apply_at(core_dir: &Path) -> Result<(), String> {
    patch_core_file(core_dir, MODEL_SELECTION_CLIENT_JS, patch_source)
}
pub fn apply(app_handle: &tauri::AppHandle) -> Result<(), String> {
    patch_dsh(app_handle, MODEL_SELECTION_CLIENT_JS, patch_source)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 0.1.6-alpha.2 产物的真实片段（`onBlur` 三行，含上游缩进）。
    fn fixture() -> String {
        format!("\t\t\tconst onBlur = (event) => {{\n{ONBLUR_ANCHOR}\n\t\t\t\tclose();\n\t\t\t}};\n")
    }

    #[test]
    fn keeps_menu_mounted_when_related_target_is_missing() {
        let PatchOutcome::Patched(patched) = patch_source(&fixture()) else {
            panic!("expected patched source");
        };
        assert!(patched.contains(
            "if (event.relatedTarget === null || event.relatedTarget === void 0) return;"
        ));
        // 原判定必须原样保留：焦点真的移出菜单（Tab 到别处）时仍要关掉菜单。
        assert!(patched.contains(ONBLUR_ANCHOR));
        assert_eq!(patched.matches("close();").count(), 1);
    }

    #[test]
    fn patch_is_idempotent() {
        let PatchOutcome::Patched(patched) = patch_source(&fixture()) else {
            panic!("expected Patched");
        };
        assert_eq!(patch_source(&patched), PatchOutcome::AlreadyPatched);
    }

    #[test]
    fn skips_when_anchor_missing() {
        // 上游改写 `onBlur`（含官方修掉该 WebKit 差异）后不再猜。
        let rewritten = "\t\t\tconst onBlur = (event) => {\n\t\t\t\tif (event.relatedTarget === null) return;\n\t\t\t\tclose();\n\t\t\t};\n";
        assert_eq!(patch_source(rewritten), PatchOutcome::AnchorMissing);
        assert_eq!(patch_source(""), PatchOutcome::AnchorMissing);
    }
}
