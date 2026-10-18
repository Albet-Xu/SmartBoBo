use std::path::Path;

use crate::utils::{patch_core_file, patch_dsh, PatchOutcome};

const CLIENT: &str = "node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js";
const MARKER: &str = "isDshMobileComposer() && t.hasAttribute(\"data-composer-input\")";
const LEGACY_MOBILE: &str = r#"function isDshMobileComposer() {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" && ["(hover: none)", "(any-pointer: coarse)", "(any-hover: none)"].every(query => window.matchMedia(query).matches);
}
"#;
const MOBILE: &str = r#"function isDshMobileComposer() {
    return typeof document !== "undefined" && document.documentElement.hasAttribute("data-dsh-mobile-ui") && typeof window.matchMedia === "function" && ["(hover: none)", "(any-pointer: coarse)", "(any-hover: none)"].every(query => window.matchMedia(query).matches);
}
"#;
const KEYMAP: &str = "function registerComposerKeymap(editor, handlers) {";
const ENTER: &str = "if (event !== null && (event.altKey || event.getModifierState(\"AltGraph\") || event.ctrlKey && event.metaKey || event.shiftKey && (event.ctrlKey || event.metaKey))) return true;";
const ENTER_PATCHED: &str = r#"if (isDshMobileComposer()) return event !== null && isComposingEvent(event, recentlyComposing);
                if (event !== null && (event.altKey || event.getModifierState("AltGraph") || event.ctrlKey && event.metaKey || event.shiftKey && (event.ctrlKey || event.metaKey))) return true;"#;
const AUTOFOCUS: &str = "if (locked || editor === null) return;";
const AUTOFOCUS_PATCHED: &str = "if (locked || editor === null || isDshMobileComposer()) return;";
const ROOT: &str = "this._updateTags.add(xo), bi(this), this._config.disableEvents";
// Reattachment commits a saved selection synchronously, before the guarded focus effect.
const ROOT_PATCHED: &str = "this._updateTags.add(xo), isDshMobileComposer() && t.hasAttribute(\"data-composer-input\") && this._updateTags.add(\"skip-dom-selection\"), bi(this), this._config.disableEvents";

fn patch_source(source: &str) -> PatchOutcome {
    if source.contains(MOBILE) && source.contains(MARKER) {
        return PatchOutcome::AlreadyPatched;
    }
    if source.contains(LEGACY_MOBILE) {
        let root = if source.contains(MARKER) {
            ROOT_PATCHED
        } else {
            ROOT
        };
        if [LEGACY_MOBILE, ENTER_PATCHED, AUTOFOCUS_PATCHED, root]
            .iter()
            .any(|anchor| source.matches(anchor).count() != 1)
        {
            return PatchOutcome::AnchorMissing;
        }
        return PatchOutcome::Patched(
            source
                .replacen(LEGACY_MOBILE, MOBILE, 1)
                .replacen(root, ROOT_PATCHED, 1),
        );
    }
    if source.contains("function isDshMobileComposer()") {
        return PatchOutcome::AnchorMissing;
    }
    if [KEYMAP, ENTER, AUTOFOCUS, ROOT]
        .iter()
        .any(|anchor| source.matches(anchor).count() != 1)
    {
        return PatchOutcome::AnchorMissing;
    }
    PatchOutcome::Patched(
        source
            .replacen(KEYMAP, &format!("{MOBILE}{KEYMAP}"), 1)
            .replacen(ENTER, ENTER_PATCHED, 1)
            .replacen(AUTOFOCUS, AUTOFOCUS_PATCHED, 1)
            .replacen(ROOT, ROOT_PATCHED, 1),
    )
}

pub fn apply_at(core_dir: &Path) -> Result<(), String> {
    patch_core_file(core_dir, CLIENT, patch_source)
}

pub fn apply(app_handle: &tauri::AppHandle) -> Result<(), String> {
    patch_dsh(app_handle, CLIENT, patch_source)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> String {
        format!("{KEYMAP}\n{ENTER}\n}}\n{AUTOFOCUS}\nfocusDraftEditor(editor, revealSelection);\n{ROOT}\n")
    }

    #[test]
    fn guards_only_automatic_focus_and_enter_submission() {
        let PatchOutcome::Patched(result) = patch_source(&fixture()) else {
            panic!("not patched")
        };
        assert!(result.contains(MOBILE));
        assert!(result.contains(ENTER_PATCHED));
        assert!(result.contains(AUTOFOCUS_PATCHED));
        assert!(result.contains(ROOT_PATCHED));
        assert!(result.contains("focusDraftEditor(editor, revealSelection);"));
        assert_eq!(patch_source(&result), PatchOutcome::AlreadyPatched);
    }

    #[test]
    fn upgrades_previous_patch_without_duplicating_guards() {
        let old = fixture()
            .replacen(KEYMAP, &format!("{LEGACY_MOBILE}{KEYMAP}"), 1)
            .replacen(ENTER, ENTER_PATCHED, 1)
            .replacen(AUTOFOCUS, AUTOFOCUS_PATCHED, 1);
        let PatchOutcome::Patched(result) = patch_source(&old) else {
            panic!("not upgraded")
        };
        assert!(result.contains(ROOT_PATCHED));
        assert_eq!(result.matches("function isDshMobileComposer()").count(), 1);
        assert_eq!(patch_source(&result), PatchOutcome::AlreadyPatched);
        assert_eq!(
            patch_source(&old.replace(ROOT, "")),
            PatchOutcome::AnchorMissing
        );
    }

    #[test]
    fn upgrades_complete_legacy_patch_to_plugin_activation() {
        let legacy = fixture()
            .replacen(KEYMAP, &format!("{LEGACY_MOBILE}{KEYMAP}"), 1)
            .replacen(ENTER, ENTER_PATCHED, 1)
            .replacen(AUTOFOCUS, AUTOFOCUS_PATCHED, 1)
            .replacen(ROOT, ROOT_PATCHED, 1);
        let PatchOutcome::Patched(result) = patch_source(&legacy) else {
            panic!("not upgraded")
        };
        assert!(result.contains(MOBILE));
        assert!(!result.contains(LEGACY_MOBILE));
        assert_eq!(result.matches(MARKER).count(), 1);
        assert_eq!(patch_source(&result), PatchOutcome::AlreadyPatched);
        assert_eq!(
            patch_source(&legacy.replace(AUTOFOCUS_PATCHED, "")),
            PatchOutcome::AnchorMissing
        );
    }

    #[test]
    fn changed_or_ambiguous_anchors_do_not_apply_a_partial_patch() {
        assert_eq!(patch_source(""), PatchOutcome::AnchorMissing);
        assert_eq!(
            patch_source(&fixture().replace(ENTER, "")),
            PatchOutcome::AnchorMissing
        );
        assert_eq!(
            patch_source(&format!("{}{AUTOFOCUS}", fixture())),
            PatchOutcome::AnchorMissing
        );
    }
}
