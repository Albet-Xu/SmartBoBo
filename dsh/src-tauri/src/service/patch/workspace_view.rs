//! workspace view 持久化状态补丁：降级核心读到新核心写下的形状时不再崩溃。
//!
//! 现象（0.1.5-rc.1 / 0.1.5-rc.2 一进页面就报
//! `slot entry crashed in 'sidebar.workspaces': TypeError: Cannot convert undefined or null to object`，
//! 工作区列表整条槽渲染失败）：核心 0.1.6-alpha.1 起
//! `@deepseek-ai/dsh-client-ui-workspace` 的浏览视图 store 去掉了
//! `sessionUpdatedAtByAccount`，持久化键却仍是同一个 `dsh.workspace.view.v5`。
//! 于是「先跑 0.1.6 + 再切回旧核心」时，旧核心 rehydrate 到的 state 没有该字段，
//! 而 `retainAccountKeys` 直接 `Object.entries(d.sessionUpdatedAtByAccount)` → 必抛；
//! 存储里的形状又不会自愈（每次进入都崩），工作区在旧核心上等于永久不可用。
//!
//! 本补丁只把该 action 里三处 `Object.entries(d.X)` 改成 `Object.entries(d.X ?? {})`
//! ——与上游 0.1.6 的定义对齐（0.1.6 直接删掉这个字段，消费方不再引用）。三处同属
//! 一个 action，任一字段缺失都该退化成空表，所以一起放宽；`?? {}` 对正常路径是 no-op。
//!
//! 目标选择：**活动核心**的 `dsh-client-ui-workspace/lib/client.js`（web 侧由 dsh 的
//! web 服务直接读该文件），读写与幂等判定统一交给 [`crate::utils::patch_dsh`]。
//!
//! 锚点按语句逐条独立判定（issue #762）：0.1.7 起上游把第三条 `Object.entries(...)`
//! 换成了 `delete d.sessionUpdatedAtByAccount;`，三行连排的整块锚点随之失配，
//! 前两条的 `?? {}` 保护也跟着静默失效。逐条放宽后，存活几条就放宽几条，
//! 只有三条语句全都不在场（上游整体改写该 action）才判定锚点缺失并安全跳过。
//!
//! 挂点：`service::workflow::launch` 启动 dsh 进程前的补丁链（最佳努力，失败只告警）。

use std::path::Path;

use crate::utils::{patch_core_file, patch_dsh, PatchOutcome};

/// 幂等/自识别标记：出现在被改写的三条语句末尾。
const PATCH_MARKER: &str = "dsh-tauri: tolerate workspace view state written by a newer core";

/// `retainAccountKeys` 里按账号收敛的三条语句（锚点绑定 rc.1/rc.2 的压缩后源码）。
const GROUP_EXPANSION_ORIGINAL: &str =
    "d.groupExpansion = Object.fromEntries(Object.entries(d.groupExpansion).filter(([key]) => retained.has(key)));";
const SESSION_ORDER_ORIGINAL: &str =
    "d.sessionOrderByAccount = Object.fromEntries(Object.entries(d.sessionOrderByAccount).filter(([key]) => retained.has(key)));";
const SESSION_UPDATED_AT_ORIGINAL: &str =
    "d.sessionUpdatedAtByAccount = Object.fromEntries(Object.entries(d.sessionUpdatedAtByAccount).filter(([key]) => retained.has(key)));";

const GROUP_EXPANSION_PATCHED: &str =
    "d.groupExpansion = Object.fromEntries(Object.entries(d.groupExpansion ?? {}).filter(([key]) => retained.has(key))); /* dsh-tauri: tolerate workspace view state written by a newer core */";
const SESSION_ORDER_PATCHED: &str =
    "d.sessionOrderByAccount = Object.fromEntries(Object.entries(d.sessionOrderByAccount ?? {}).filter(([key]) => retained.has(key))); /* dsh-tauri: tolerate workspace view state written by a newer core */";
const SESSION_UPDATED_AT_PATCHED: &str =
    "d.sessionUpdatedAtByAccount = Object.fromEntries(Object.entries(d.sessionUpdatedAtByAccount ?? {}).filter(([key]) => retained.has(key))); /* dsh-tauri: tolerate workspace view state written by a newer core */";

/// 相对活动核心安装目录的 workspace 客户端 `lib/client.js` 包内路径。
const WORKSPACE_CLIENT_JS: &str =
    "node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js";

/// 逐条锚点（原写法 → 放宽写法）。独立判定、独立替换：上游只要还留着其中一条，
/// 这条的 `?? {}` 保护就必须生效，不被其它条目的增删连坐。
const RETENTION_STATEMENTS: [(&str, &str); 3] = [
    (GROUP_EXPANSION_ORIGINAL, GROUP_EXPANSION_PATCHED),
    (SESSION_ORDER_ORIGINAL, SESSION_ORDER_PATCHED),
    (SESSION_UPDATED_AT_ORIGINAL, SESSION_UPDATED_AT_PATCHED),
];

fn patch_source(source: &str) -> PatchOutcome {
    if source.contains(PATCH_MARKER) {
        return PatchOutcome::AlreadyPatched;
    }
    let mut patched = source.to_string();
    let mut relaxed = 0usize;
    for (original, replacement) in RETENTION_STATEMENTS {
        if source.contains(original) {
            patched = patched.replacen(original, replacement, 1);
            relaxed += 1;
        }
    }
    if relaxed == 0 {
        return PatchOutcome::AnchorMissing;
    }
    PatchOutcome::Patched(patched)
}

/// 对活动核心的 dsh-client-ui-workspace `lib/client.js` 应用补丁（幂等）。
/// 返回 Err 表示读/写失败；文件缺失、已打过、锚点变更均静默跳过（Ok）。
/// 对显式给定的核心安装目录施加本补丁（E2E 编排复用，无需运行中的桌面端）。
pub fn apply_at(core_dir: &Path) -> Result<(), String> {
    patch_core_file(core_dir, WORKSPACE_CLIENT_JS, patch_source)
}
pub fn apply(app_handle: &tauri::AppHandle) -> Result<(), String> {
    patch_dsh(app_handle, WORKSPACE_CLIENT_JS, patch_source)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// rc.1/rc.2 产物的真实片段（`retainAccountKeys` 三连，含上游缩进）。
    fn fixture() -> String {
        format!(
            "\t\t\t\t\tretainAccountKeys: (d, workspaceKeys) => {{\n\t\t\t\t\t\tconst retained = new Set(workspaceKeys);\n\t\t\t\t\t\t{GROUP_EXPANSION_ORIGINAL}\n\t\t\t\t\t\t{SESSION_ORDER_ORIGINAL}\n\t\t\t\t\t\t{SESSION_UPDATED_AT_ORIGINAL}\n\t\t\t\t\t}},\n"
        )
    }

    #[test]
    fn relaxes_all_three_retained_keys() {
        let PatchOutcome::Patched(patched) = patch_source(&fixture()) else {
            panic!("expected patched source");
        };
        assert!(patched.contains("Object.entries(d.groupExpansion ?? {})"));
        assert!(patched.contains("Object.entries(d.sessionOrderByAccount ?? {})"));
        assert!(patched.contains("Object.entries(d.sessionUpdatedAtByAccount ?? {})"));
        assert!(!patched.contains("Object.entries(d.sessionUpdatedAtByAccount).filter"));
        // 补丁只放宽取值，收敛逻辑本身（filter + fromEntries）保持不变。
        assert_eq!(patched.matches("filter(([key]) => retained.has(key)))").count(), 3);
    }

    /// 0.1.7 起上游把第三条换成 `delete d.sessionUpdatedAtByAccount;`（issue #762 现场）。
    fn fixture_after_delete() -> String {
        format!(
            "\t\t\t\t\tretainAccountKeys: (d, workspaceKeys) => {{\n\t\t\t\t\t\tconst retained = new Set(workspaceKeys);\n\t\t\t\t\t\t{GROUP_EXPANSION_ORIGINAL}\n\t\t\t\t\t\t{SESSION_ORDER_ORIGINAL}\n\t\t\t\t\t\tdelete d.sessionUpdatedAtByAccount;\n\t\t\t\t\t}},\n"
        )
    }

    #[test]
    fn relaxes_surviving_keys_after_upstream_switched_to_delete() {
        let PatchOutcome::Patched(patched) = patch_source(&fixture_after_delete()) else {
            panic!("expected patched source");
        };
        assert!(patched.contains("Object.entries(d.groupExpansion ?? {})"));
        assert!(patched.contains("Object.entries(d.sessionOrderByAccount ?? {})"));
        assert!(patched.contains("delete d.sessionUpdatedAtByAccount;"));
        assert_eq!(patched.matches(PATCH_MARKER).count(), 2);
    }

    #[test]
    fn patch_is_idempotent() {
        for layout in [fixture(), fixture_after_delete()] {
            let PatchOutcome::Patched(patched) = patch_source(&layout) else {
                panic!("expected Patched");
            };
            assert_eq!(patch_source(&patched), PatchOutcome::AlreadyPatched);
        }
    }

    #[test]
    fn skips_when_retention_statements_are_gone() {
        // 上游整体改写该 action：三条语句全不在，不能凭残缺片段猜着改。
        let rewritten =
            "\t\t\t\t\tretainAccountKeys: (d) => {\n\t\t\t\t\t\tdelete d.groupExpansion;\n\t\t\t\t\t},\n";
        assert_eq!(patch_source(rewritten), PatchOutcome::AnchorMissing);
    }

    #[test]
    fn leaves_lookalike_from_entries_untouched() {
        let lookalike = "d.sessionOrderByAccount = Object.fromEntries(Object.entries(source.members).map(([key, members]) => {";
        let source = format!("{}{lookalike}", fixture());
        let PatchOutcome::Patched(patched) = patch_source(&source) else {
            panic!("expected Patched");
        };
        assert!(!patched.contains("Object.entries(source.members ?? {})"));
    }
}
