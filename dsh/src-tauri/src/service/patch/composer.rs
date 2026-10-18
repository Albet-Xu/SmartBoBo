//! composer 补丁：让「不属于任何工作区、但有自己的 cwd」的会话也能直接输入。
//!
//! 需求：`dsh-tauri-ui` 的「未分组」新建会话不登记任何工作区（`sessions.create()` 不传
//! workspaceId），宿主按默认 cwd 建会话、不 attach 任何工作区。但官方 `ConversationRoot`
//! 里 `inert = sessionId === void 0 || hero && chipTitle === void 0`，而 `chipTitle` 只来自
//! 「pending 工作区」或「会话所属工作区」——于是**任何不属于工作区的空白会话**，composer
//! 都被换成「选择工作区」触发器：编辑器不挂载，整个新会话不可用。
//!
//! 本补丁只放宽这一处判定：会话已经有 cwd 时不再算 inert（cwd 由宿主在
//! `api-session/added` 帧里回填，`sessions.create()` 之后即到）。其余判定、其余槽位、
//! 官方 chip 文案（未分组会话仍是「选择工作区」占位）全部不动——插件侧有自己的
//! chip 与选择器，这里只补「composer 可用」这一项窄面能力。
//!
//! 目标选择：**活动核心**的 `dsh-client-ui-conversation/lib/client.js`，读写与幂等判定
//! 统一交给 [`crate::utils::patch_dsh`]。
//!
//! 能力声明：补丁在文件末尾写入 `<html data-dsh-composer-cwd="1">`，客户端插件据此探测
//! 本能力（`adapter.has('composer.workspace-less')`），**不猜核心版本**；标记缺失时插件
//! 按退级策略禁用「未分组」入口并告警，绝不静默半工作。
//!
//! 幂等与容错：
//! - 已含标记即跳过；
//! - 上游将来自己放宽该判定（inert 语句里已带 `&& cwd === void 0`）时只补能力标记，
//!   不再改写源码——补丁随上游自动退休；
//! - 锚点因上游布局变更而找不到 → 跳过并告警，不阻断启动（插件侧退级到功能禁用）。
//!
//! 挂点：`service::workflow::launch` 启动 dsh 进程前的补丁链（最佳努力，失败只告警）。

use std::path::Path;

use crate::utils::{patch_core_file, patch_dsh, PatchOutcome};

/// 幂等/自识别标记：写在能力声明行上。
const PATCH_MARKER: &str = "dsh-tauri: composer stays usable for a session outside every workspace";

/// 客户端插件探测本能力用的 DOM 标记（与 `dsh-tauri` 适配层的
/// `composer.workspace-less` 能力判据逐字一致，跨语言协议字面量）。
const CAPABILITY_ATTRIBUTE: &str = "data-dsh-composer-cwd";

/// 官方 inert 语句（锚点绑定 0.1.5-rc.1 / rc.2 的压缩后源码）。
const INERT_ORIGINAL: &str = "const inert = sessionId === void 0 || hero && chipTitle === void 0;";

/// 放宽后的语句：会话有 cwd 就不再算 inert。
const INERT_PATCHED: &str = "const inert = sessionId === void 0 || hero && chipTitle === void 0 && cwd === void 0;";

/// 导出锚点的关键字（所在行的前导缩进随版本变化，不做硬编码）。
const ANCHOR_KEYWORD: &str = "return module.exports;";

/// 相对活动核心安装目录的 conversation `lib/client.js` 包内路径。
const CONVERSATION_CLIENT_JS: &str =
    "node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js";

/// 幂等补丁逻辑的纯函数部分（便于单测，不触碰文件系统）。
///
/// 判定优先看**原始语句**：只要它还在场就放宽它，只有它缺席、而放宽形态在场时才判定为
/// 「上游已自修」。反过来的优先级会让注释里的同形文本把补丁误判成「已修」而静默漏放宽
/// ——那正是「声明了能力、composer 却仍不可用」的半工作态。
fn patch_source(source: &str) -> PatchOutcome {
    if source.contains(PATCH_MARKER) {
        return PatchOutcome::AlreadyPatched;
    }
    let needs_relax = if source.contains(INERT_ORIGINAL) {
        true
    }
    else if source.contains(INERT_PATCHED) {
        false
    }
    else {
        return PatchOutcome::AnchorMissing;
    };
    let Some((line_start, indent)) = locate_return_module_exports(source) else {
        return PatchOutcome::AnchorMissing;
    };

    let mut patched = source.to_string();
    patched.insert_str(
        line_start,
        &format!(
            "{indent}if (typeof document !== \"undefined\") document.documentElement.setAttribute(\"{CAPABILITY_ATTRIBUTE}\", \"1\"); /* {PATCH_MARKER} */\n"
        ),
    );
    if needs_relax {
        patched = patched.replacen(INERT_ORIGINAL, INERT_PATCHED, 1);
    }
    PatchOutcome::Patched(patched)
}

/// 定位 `return module.exports;` 所在行的行首字节偏移与其前导缩进。
///
/// 行首到关键字之间必须是纯空白，否则不是锚行（防御上游把该语句挪进表达式里）。
fn locate_return_module_exports(source: &str) -> Option<(usize, &str)> {
    let match_start = source.find(ANCHOR_KEYWORD)?;
    let line_start = source[..match_start].rfind('\n').map(|i| i + 1).unwrap_or(0);
    let indent = &source[line_start..match_start];
    if !indent.chars().all(|c| c == '\t' || c == ' ') {
        return None;
    }
    Some((line_start, indent))
}

/// 对活动核心的 dsh-client-ui-conversation `lib/client.js` 应用补丁（幂等）。
/// 返回 Err 表示读/写失败；文件缺失、已打过、锚点变更均静默跳过（Ok）。
/// 对显式给定的核心安装目录施加本补丁（E2E 编排复用，无需运行中的桌面端）。
pub fn apply_at(core_dir: &Path) -> Result<(), String> {
    patch_core_file(core_dir, CONVERSATION_CLIENT_JS, patch_source)
}
pub fn apply(app_handle: &tauri::AppHandle) -> Result<(), String> {
    patch_dsh(app_handle, CONVERSATION_CLIENT_JS, patch_source)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 官方产物末尾片段（单 tab 缩进，与 renderer 补丁同一形状）。
    fn fixture() -> String {
        format!(
            "\t\t\t{INERT_ORIGINAL}\n\t\t\tconst heroWorkspaceRow = 1;\n\t\texports.apply = apply;\n\t\texports.inject = inject;\n\t\treturn module.exports;\n\t}}\n}});\n"
        )
    }

    #[test]
    fn relaxes_inert_and_declares_capability() {
        let PatchOutcome::Patched(patched) = patch_source(&fixture()) else {
            panic!("expected Patched, got {:?}", patch_source(&fixture()));
        };
        assert!(patched.contains(INERT_PATCHED));
        assert!(!patched.contains(INERT_ORIGINAL));
        assert!(patched.contains(&format!(
            "\t\tif (typeof document !== \"undefined\") document.documentElement.setAttribute(\"{CAPABILITY_ATTRIBUTE}\", \"1\"); /* {PATCH_MARKER} */\n\t\treturn module.exports;\n"
        )));
    }

    #[test]
    fn patch_is_idempotent() {
        let PatchOutcome::Patched(patched) = patch_source(&fixture()) else {
            panic!("expected Patched");
        };
        assert_eq!(patch_source(&patched), PatchOutcome::AlreadyPatched);
    }

    #[test]
    fn upstream_fix_only_declares_capability() {
        let fixed = format!("\t\t\t{INERT_PATCHED}\n\t\treturn module.exports;\n");
        let PatchOutcome::Patched(patched) = patch_source(&fixed) else {
            panic!("expected Patched");
        };
        // 不再改写源码，只补能力标记：补丁随上游退休。
        assert!(patched.contains(INERT_PATCHED));
        assert!(patched.contains(CAPABILITY_ATTRIBUTE));
        assert_eq!(patch_source(&patched), PatchOutcome::AlreadyPatched);
    }

    #[test]
    fn loose_substring_is_not_treated_as_upstream_fix() {
        // 注释或其它代码路径里出现放宽片段时，仍必须真的放宽当前语句。
        let source = format!(
            "\t\t\t// 说明：{INERT_PATCHED}\n\t\t\t{INERT_ORIGINAL}\n\t\treturn module.exports;\n"
        );
        let PatchOutcome::Patched(patched) = patch_source(&source) else {
            panic!("expected Patched");
        };
        assert!(!patched.contains(&format!("{INERT_ORIGINAL}\n")));
        assert_eq!(patched.matches(INERT_PATCHED).count(), 2);
    }

    #[test]
    fn skips_when_anchor_missing() {
        assert_eq!(patch_source("\t\t\tconst inert = 1;\n"), PatchOutcome::AnchorMissing);
        let no_return = format!("\t\t\t{INERT_ORIGINAL}\n");
        assert_eq!(patch_source(&no_return), PatchOutcome::AnchorMissing);
    }
}
