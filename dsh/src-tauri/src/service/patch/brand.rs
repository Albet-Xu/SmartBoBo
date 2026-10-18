//! brand 补丁：把打包内核的用户可见品牌面换成 SmartBoBo（boot 字标 AGENT、
//! 会话 Hero 标语与预览徽章、web 静态 favicon、页面标题、PWA manifest）。
//!
//! 纯展示层替换：每一处都以「上游原文」为锚点、以「品牌新文」为幂等判据；
//! 上游改写锚点时只告警跳过，功能路径不受影响。boot 字标补丁对
//! `dsh-web-frontend/dist/assets/index-*.js` 做目录扫描（文件名带内容哈希）；
//! 宿主的 `plugin_boot.js.inc` 同步接受 HARNESS 与 AGENT 两种字标，
//! 补丁失败时 splash 识别仍可工作。
//!
//! 挂点：`service::workflow::launch` 启动 dsh 进程前的补丁链（最佳努力，失败只告警）。

use std::path::Path;

use crate::utils::{active_core_install_dir, patch_core_file, patch_dsh, PatchOutcome};

const CONVERSATION_CLIENT_JS: &str =
    "node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js";

const HEADLINE_ZH_ORIGINAL: &str = "\"hero.headline\": \"探索未至之境\"";
const HEADLINE_ZH_PATCHED: &str = "\"hero.headline\": \"万物皆可得\"";
const HEADLINE_EN_ORIGINAL: &str = "\"hero.headline\": \"Into the Unknown\"";
const HEADLINE_EN_PATCHED: &str = "\"hero.headline\": \"Everything is obtainable\"";

const PREVIEW_BADGE_RENDER: &str = "children: t(\"hero.preview\")";
const PREVIEW_BADGE_ORIGINAL: &str = "[(0, react_jsx_runtime.jsx)(\"span\", { children: t(\"hero.headline\") }), (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\t\t\tclassName: HeroShell_module_css_default.previewBadge,\n\t\t\t\t\t\t\t\tchildren: t(\"hero.preview\")\n\t\t\t\t\t\t\t})]";
const PREVIEW_BADGE_PATCHED: &str = "(0, react_jsx_runtime.jsx)(\"span\", { children: t(\"hero.headline\") })";

const WEB_ASSETS_DIR: &str = "node_modules/@deepseek-ai/dsh-web-frontend/dist/assets";
const BOOT_WORDMARK_ORIGINAL: &str = "wordmark,\"HARNESS\")";
const BOOT_WORDMARK_PATCHED: &str = "wordmark,\"AGENT\")";

const LAYOUT_CLIENT_JS: &str = "node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js";
const PLUGIN_MANAGER_CLIENT_JS: &str =
    "node_modules/@deepseek-ai/dsh-client-ui-plugin-manager/lib/client.js";
const DOCPREVIEW_CLIENT_JS: &str =
    "node_modules/@deepseek-ai/dsh-client-ui-sidebar-documentpreview/lib/client.js";
const ACCOUNT_CLIENT_JS: &str =
    "node_modules/@deepseek-ai/dsh-client-ui-settings-account/lib/client.js";

/// (相对路径, 原文, 新文)：内核打包 JS 里纯产品义文案的策展替换表。
/// 只收「主语是产品名」的 UI 串；登录/账号/模型供应商语境（DeepSeek 账号、
/// 计费、API Key）一律不进表——改了会误导（后端仍是 DeepSeek 的服务）。
/// 幂等：原文缺席且新文在场 → AlreadyPatched；两者都缺 → AnchorMissing。
const KERNEL_COPY: &[(&str, &str, &str)] = &[
    (
        LAYOUT_CLIENT_JS,
        "productTitle = \"DeepSeek Harness\"",
        "productTitle = \"SmartBoBo Agent\"",
    ),
    (
        PLUGIN_MANAGER_CLIENT_JS,
        "可能损坏 DeepSeek Harness，或读取和泄露你的数据",
        "可能损坏 SmartBoBo Agent，或读取和泄露你的数据",
    ),
    (
        PLUGIN_MANAGER_CLIENT_JS,
        "can damage DeepSeek Harness or leak your data",
        "can damage SmartBoBo Agent or leak your data",
    ),
    (
        DOCPREVIEW_CLIENT_JS,
        "请在运行 DeepSeek Harness 的主机上",
        "请在运行 SmartBoBo Agent 的主机上",
    ),
    (
        DOCPREVIEW_CLIENT_JS,
        "on the computer running DeepSeek Harness",
        "on the computer running SmartBoBo Agent",
    ),
    (
        ACCOUNT_CLIENT_JS,
        "onboardingBrand: \"DeepSeek Harness\"",
        "onboardingBrand: \"SmartBoBo Agent\"",
    ),
    (
        ACCOUNT_CLIENT_JS,
        "返回 DeepSeek Harness",
        "返回 SmartBoBo Agent",
    ),
    (
        ACCOUNT_CLIENT_JS,
        "Back to DeepSeek Harness",
        "Back to SmartBoBo Agent",
    ),
    (
        ACCOUNT_CLIENT_JS,
        "不会影响 DeepSeek Harness 的工作能力",
        "不会影响 SmartBoBo Agent 的工作能力",
    ),
    (
        ACCOUNT_CLIENT_JS,
        "not what DeepSeek Harness can do",
        "not what SmartBoBo Agent can do",
    ),
    (
        ACCOUNT_CLIENT_JS,
        "DeepSeek Harness works in a local folder",
        "SmartBoBo Agent works in a local folder",
    ),
    (
        ACCOUNT_CLIENT_JS,
        "DeepSeek Harness 会以本地文件夹作为工作区",
        "SmartBoBo Agent 会以本地文件夹作为工作区",
    ),
];

const WEB_FAVICON: &str = "node_modules/@deepseek-ai/dsh-web-frontend/dist/favicon.svg";
const WEB_FAVICON_DARK: &str = "node_modules/@deepseek-ai/dsh-web-frontend/dist/favicon-dark.svg";
const WEB_INDEX_HTML: &str = "node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html";
const WEB_MANIFEST: &str =
    "node_modules/@deepseek-ai/dsh-web-frontend/dist/manifest.webmanifest";

const FAVICON_MARKER: &str = "<!-- smartbobo-pineapple -->";
const WHALE_PATH_ANCHOR: &str = "M48.8354 10.0479C48.3232";

const TITLE_ORIGINAL: &str = "<title>DeepSeek Harness</title>";
const TITLE_PATCHED: &str = "<title>SmartBoBo</title>";

const MANIFEST_NAME_ORIGINAL: &str = "\"name\": \"DeepSeek Harness\"";
const MANIFEST_NAME_PATCHED: &str = "\"name\": \"SmartBoBo\"";
const MANIFEST_SHORT_ORIGINAL: &str = "\"short_name\": \"DSH\"";
const MANIFEST_SHORT_PATCHED: &str = "\"short_name\": \"BoBo\"";

const PINEAPPLE_FAVICON: &str = r#"<svg xmlns="http://www.w3.org/2000/svg" width="50.000000" height="50.000000" viewBox="0 0 50 50" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
  <!-- smartbobo-pineapple -->
  <style>
    @media (prefers-color-scheme: dark) {
      svg { stroke: #fff; }
    }
  </style>
  <path d="M25 22 Q24 12 22 5 Q21.5 1 20 3" stroke-width="2.8" />
  <path d="M25 22 Q27 10 31 4 Q33 1 31 4" stroke-width="2.8" />
  <path d="M25 22 Q18 15 11 9 Q9 7 10 10" stroke-width="2.5" />
  <path d="M25 22 Q32 15 39 9 Q41 7 40 10" stroke-width="2.5" />
  <path d="M25 22 Q17 17 9 13" stroke-width="2.2" />
  <path d="M25 22 Q33 17 41 13" stroke-width="2.2" />
  <path d="M25 24 Q8 24 7.5 37 Q7.2 44 17 48 Q22.5 50 25 50 Q27.5 50 33 48 Q42.8 44 42.5 37 Q42 24 25 24 Z" stroke-width="3.5" fill="none" />
  <path d="M17.5 29 L12.5 49" stroke-width="1.2" fill="none" />
  <path d="M25 27 L25 50" stroke-width="1.2" fill="none" />
  <path d="M32.5 29 L37.5 49" stroke-width="1.2" fill="none" />
  <path d="M8 32 L42 32" stroke-width="1.2" fill="none" />
  <path d="M7.5 39 L42.5 39" stroke-width="1.2" fill="none" />
  <path d="M8.5 46 L41.5 46" stroke-width="1.2" fill="none" />
</svg>
"#;

fn patch_headline_source(source: &str) -> PatchOutcome {
    let has_zh = source.contains(HEADLINE_ZH_ORIGINAL);
    let has_en = source.contains(HEADLINE_EN_ORIGINAL);
    let has_preview = source.contains(PREVIEW_BADGE_ORIGINAL);
    if !has_zh && !has_en && !has_preview {
        return if source.contains(HEADLINE_ZH_PATCHED)
            && source.contains(HEADLINE_EN_PATCHED)
            && !source.contains(PREVIEW_BADGE_RENDER)
        {
            PatchOutcome::AlreadyPatched
        }
        else {
            PatchOutcome::AnchorMissing
        };
    }
    let mut patched = source.to_string();
    if has_zh {
        patched = patched.replacen(HEADLINE_ZH_ORIGINAL, HEADLINE_ZH_PATCHED, 1);
    }
    if has_en {
        patched = patched.replacen(HEADLINE_EN_ORIGINAL, HEADLINE_EN_PATCHED, 1);
    }
    if has_preview {
        patched = patched.replacen(PREVIEW_BADGE_ORIGINAL, PREVIEW_BADGE_PATCHED, 1);
    }
    PatchOutcome::Patched(patched)
}

fn patch_boot_wordmark_source(source: &str) -> PatchOutcome {
    if source.contains(BOOT_WORDMARK_PATCHED) {
        return PatchOutcome::AlreadyPatched;
    }
    if !source.contains(BOOT_WORDMARK_ORIGINAL) {
        return PatchOutcome::AnchorMissing;
    }
    PatchOutcome::Patched(source.replacen(BOOT_WORDMARK_ORIGINAL, BOOT_WORDMARK_PATCHED, 1))
}

fn patch_favicon_source(source: &str) -> PatchOutcome {
    if source.contains(FAVICON_MARKER) {
        return PatchOutcome::AlreadyPatched;
    }
    if !source.contains(WHALE_PATH_ANCHOR) {
        return PatchOutcome::AnchorMissing;
    }
    PatchOutcome::Patched(PINEAPPLE_FAVICON.to_string())
}

fn patch_title_source(source: &str) -> PatchOutcome {
    if source.contains(TITLE_PATCHED) {
        return PatchOutcome::AlreadyPatched;
    }
    if !source.contains(TITLE_ORIGINAL) {
        return PatchOutcome::AnchorMissing;
    }
    PatchOutcome::Patched(source.replacen(TITLE_ORIGINAL, TITLE_PATCHED, 1))
}

fn patch_manifest_source(source: &str) -> PatchOutcome {
    if source.contains(MANIFEST_NAME_PATCHED) {
        return PatchOutcome::AlreadyPatched;
    }
    if !source.contains(MANIFEST_NAME_ORIGINAL) || !source.contains(MANIFEST_SHORT_ORIGINAL) {
        return PatchOutcome::AnchorMissing;
    }
    let patched = source
        .replacen(MANIFEST_NAME_ORIGINAL, MANIFEST_NAME_PATCHED, 1)
        .replacen(MANIFEST_SHORT_ORIGINAL, MANIFEST_SHORT_PATCHED, 1);
    PatchOutcome::Patched(patched)
}

fn scan_boot_assets(core_dir: &Path) -> Result<(), String> {
    let assets = core_dir.join(WEB_ASSETS_DIR);
    if !assets.is_dir() {
        log::info!("brand boot assets dir not found, skip: {}", assets.display());
        return Ok(());
    }
    let entries = std::fs::read_dir(&assets)
        .map_err(|e| format!("DSH_PATCH_READ: {} failed: {e}", assets.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("DSH_PATCH_READ: {} failed: {e}", assets.display()))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !(name.starts_with("index-") && name.ends_with(".js")) {
            continue;
        }
        let rel = format!("{WEB_ASSETS_DIR}/{name}");
        patch_core_file(core_dir, &rel, patch_boot_wordmark_source)?;
    }
    Ok(())
}

/// 对单个源文件应用一组「原文→新文」替换。任一原文命中即产出 Patched（逐条 replacen）；
/// 全部缺席时，若任一新文在场判 AlreadyPatched，否则 AnchorMissing。
fn patch_copy_pairs(source: &str, pairs: &[(&str, &str)]) -> PatchOutcome {
    if !pairs.iter().any(|(original, _)| source.contains(original)) {
        return if pairs.iter().any(|(_, patched)| source.contains(patched)) {
            PatchOutcome::AlreadyPatched
        }
        else {
            PatchOutcome::AnchorMissing
        };
    }
    let mut patched = source.to_string();
    for (original, new) in pairs {
        if patched.contains(original) {
            patched = patched.replace(original, new);
        }
    }
    PatchOutcome::Patched(patched)
}

/// 按相对路径分组应用 KERNEL_COPY（同一文件的多条替换合并为一次读写）。
fn apply_kernel_copy_at(core_dir: &Path) -> Result<(), String> {
    let mut visited: Vec<&str> = Vec::new();
    for (rel, _, _) in KERNEL_COPY {
        if visited.contains(rel) {
            continue;
        }
        visited.push(rel);
        let pairs: Vec<(&str, &str)> = KERNEL_COPY
            .iter()
            .filter(|(r, _, _)| r == rel)
            .map(|(_, original, new)| (*original, *new))
            .collect();
        patch_core_file(core_dir, rel, |source| patch_copy_pairs(source, &pairs))?;
    }
    Ok(())
}

fn apply_kernel_copy(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let mut visited: Vec<&str> = Vec::new();
    for (rel, _, _) in KERNEL_COPY {
        if visited.contains(rel) {
            continue;
        }
        visited.push(rel);
        let pairs: Vec<(&str, &str)> = KERNEL_COPY
            .iter()
            .filter(|(r, _, _)| r == rel)
            .map(|(_, original, new)| (*original, *new))
            .collect();
        patch_dsh(app_handle, rel, |source| patch_copy_pairs(source, &pairs))?;
    }
    Ok(())
}

pub fn apply_at(core_dir: &Path) -> Result<(), String> {
    scan_boot_assets(core_dir)?;
    patch_core_file(core_dir, CONVERSATION_CLIENT_JS, patch_headline_source)?;
    patch_core_file(core_dir, WEB_FAVICON, patch_favicon_source)?;
    patch_core_file(core_dir, WEB_FAVICON_DARK, patch_favicon_source)?;
    patch_core_file(core_dir, WEB_INDEX_HTML, patch_title_source)?;
    patch_core_file(core_dir, WEB_MANIFEST, patch_manifest_source)?;
    apply_kernel_copy_at(core_dir)
}

pub fn apply(app_handle: &tauri::AppHandle) -> Result<(), String> {
    scan_boot_assets(&active_core_install_dir(app_handle))?;
    patch_dsh(app_handle, CONVERSATION_CLIENT_JS, patch_headline_source)?;
    patch_dsh(app_handle, WEB_FAVICON, patch_favicon_source)?;
    patch_dsh(app_handle, WEB_FAVICON_DARK, patch_favicon_source)?;
    patch_dsh(app_handle, WEB_INDEX_HTML, patch_title_source)?;
    patch_dsh(app_handle, WEB_MANIFEST, patch_manifest_source)?;
    apply_kernel_copy(app_handle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaces_both_headline_locales() {
        let source = "\t\t\t\"hero.headline\": \"探索未至之境\",\n\t\t\t\"hero.headline\": \"Into the Unknown\",\n";
        let PatchOutcome::Patched(patched) = patch_headline_source(source) else {
            panic!("expected Patched");
        };
        assert!(patched.contains(HEADLINE_ZH_PATCHED));
        assert!(patched.contains(HEADLINE_EN_PATCHED));
        assert!(!patched.contains(HEADLINE_ZH_ORIGINAL));
        assert!(!patched.contains(HEADLINE_EN_ORIGINAL));
    }

    #[test]
    fn headline_patch_is_idempotent() {
        let PatchOutcome::Patched(patched) = patch_headline_source(
            "\"hero.headline\": \"探索未至之境\",\n\"hero.headline\": \"Into the Unknown\",\n",
        ) else {
            panic!("expected Patched");
        };
        assert_eq!(patch_headline_source(&patched), PatchOutcome::AlreadyPatched);
    }

    #[test]
    fn headline_partial_replacement_completes_the_rest() {
        let source = "\"hero.headline\": \"万物皆可得\",\n\"hero.headline\": \"Into the Unknown\",\n";
        let PatchOutcome::Patched(patched) = patch_headline_source(source) else {
            panic!("expected Patched");
        };
        assert!(patched.contains(HEADLINE_EN_PATCHED));
        assert_eq!(patch_headline_source(&patched), PatchOutcome::AlreadyPatched);
    }

    #[test]
    fn headline_skips_when_anchor_missing() {
        assert_eq!(patch_headline_source("const x = 1;\n"), PatchOutcome::AnchorMissing);
    }

    #[test]
    fn removes_preview_badge_and_is_idempotent() {
        let source = format!(
            "\"hero.headline\": \"探索未至之境\",\n\"hero.headline\": \"Into the Unknown\",\n{PREVIEW_BADGE_ORIGINAL}\n"
        );
        let PatchOutcome::Patched(patched) = patch_headline_source(&source) else {
            panic!("expected Patched");
        };
        assert!(!patched.contains(PREVIEW_BADGE_RENDER));
        assert!(!patched.contains(PREVIEW_BADGE_ORIGINAL));
        assert!(patched.contains(HEADLINE_ZH_PATCHED));
        assert!(patched.contains(HEADLINE_EN_PATCHED));
        assert_eq!(patch_headline_source(&patched), PatchOutcome::AlreadyPatched);
    }

    #[test]
    fn boot_wordmark_replaces_and_is_idempotent() {
        let source = "this.card=yn(xn.card),this.wordmark=yn(xn.wordmark,\"HARNESS\"),this.spinner=yn(xn.spinner),";
        let PatchOutcome::Patched(patched) = patch_boot_wordmark_source(source) else {
            panic!("expected Patched");
        };
        assert!(patched.contains(BOOT_WORDMARK_PATCHED));
        assert!(!patched.contains(BOOT_WORDMARK_ORIGINAL));
        assert_eq!(patch_boot_wordmark_source(&patched), PatchOutcome::AlreadyPatched);
    }

    #[test]
    fn boot_wordmark_skips_when_anchor_missing() {
        assert_eq!(patch_boot_wordmark_source("const x = 1;\n"), PatchOutcome::AnchorMissing);
    }

    #[test]
    fn favicon_replaces_whale_and_is_idempotent() {
        let whale = format!("<svg>\n\t<path d=\"{WHALE_PATH_ANCHOR} rest\"/>\n</svg>\n");
        let PatchOutcome::Patched(patched) = patch_favicon_source(&whale) else {
            panic!("expected Patched");
        };
        assert!(patched.contains(FAVICON_MARKER));
        assert!(!patched.contains(WHALE_PATH_ANCHOR));
        assert_eq!(patch_favicon_source(&patched), PatchOutcome::AlreadyPatched);
    }

    #[test]
    fn favicon_skips_when_anchor_missing() {
        assert_eq!(patch_favicon_source("<svg></svg>\n"), PatchOutcome::AnchorMissing);
    }

    #[test]
    fn title_and_manifest_replace_and_are_idempotent() {
        let html = "<html><head><title>DeepSeek Harness</title></head></html>\n";
        let PatchOutcome::Patched(patched_html) = patch_title_source(html) else {
            panic!("expected Patched");
        };
        assert!(patched_html.contains(TITLE_PATCHED));
        assert_eq!(patch_title_source(&patched_html), PatchOutcome::AlreadyPatched);

        let manifest = "{\n  \"name\": \"DeepSeek Harness\",\n  \"short_name\": \"DSH\"\n}\n";
        let PatchOutcome::Patched(patched_manifest) = patch_manifest_source(manifest) else {
            panic!("expected Patched");
        };
        assert!(patched_manifest.contains(MANIFEST_NAME_PATCHED));
        assert!(patched_manifest.contains(MANIFEST_SHORT_PATCHED));
        assert_eq!(patch_manifest_source(&patched_manifest), PatchOutcome::AlreadyPatched);
    }

    #[test]
    fn title_skips_when_anchor_missing() {
        assert_eq!(patch_title_source("<html></html>\n"), PatchOutcome::AnchorMissing);
    }

    #[test]
    fn copy_pairs_replace_and_are_idempotent() {
        let pairs = [("productTitle = \"DeepSeek Harness\"", "productTitle = \"SmartBoBo Agent\"")];
        let source = "\t\tconst productTitle = \"DeepSeek Harness\";\n";
        let PatchOutcome::Patched(patched) = patch_copy_pairs(source, &pairs) else {
            panic!("expected Patched");
        };
        assert!(patched.contains("SmartBoBo Agent"));
        assert!(!patched.contains("DeepSeek Harness"));
        assert_eq!(patch_copy_pairs(&patched, &pairs), PatchOutcome::AlreadyPatched);
    }

    #[test]
    fn copy_pairs_multiple_in_one_file_all_applied() {
        let pairs = [("损坏 DeepSeek Harness，或", "损坏 SmartBoBo Agent，或"), ("damage DeepSeek Harness or", "damage SmartBoBo Agent or")];
        let source = "\"可能损坏 DeepSeek Harness，或读取和泄露你的数据。\",\"can damage DeepSeek Harness or leak your data.\"";
        let PatchOutcome::Patched(patched) = patch_copy_pairs(source, &pairs) else {
            panic!("expected Patched");
        };
        assert!(!patched.contains("DeepSeek Harness"));
        assert_eq!(patch_copy_pairs(&patched, &pairs), PatchOutcome::AlreadyPatched);
    }

    #[test]
    fn copy_pairs_anchor_missing() {
        assert_eq!(
            patch_copy_pairs("const x = 1;", &[("a", "b")]),
            PatchOutcome::AnchorMissing
        );
    }

    #[test]
    fn kernel_copy_table_covers_expected_files() {
        let mut files: Vec<&str> = KERNEL_COPY.iter().map(|(rel, _, _)| *rel).collect();
        files.sort_unstable();
        files.dedup();
        assert!(files.contains(&LAYOUT_CLIENT_JS));
        assert!(files.contains(&PLUGIN_MANAGER_CLIENT_JS));
        assert!(files.contains(&DOCPREVIEW_CLIENT_JS));
        assert!(files.contains(&ACCOUNT_CLIENT_JS));
        assert!(KERNEL_COPY.iter().all(|(_, o, n)| o.contains("DeepSeek Harness") && n.contains("SmartBoBo Agent")));
    }
}
