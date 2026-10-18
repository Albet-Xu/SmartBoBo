//! bridge/preset_pet.rs — 预设宠物清单（`resources/manifest.jsonc` 的 `pets.built-in`）。
//!
//! 预设宠物不再下载到本地：清单里的条目本身就是 `dsh-pet-component` 的
//! `<Pet>` 渲染参数（`config` / `uri` / `ext` / `kind` / `size`），pet 窗口按
//! 当前激活 id 取到条目后直连远端素材播放（macOS 用 `uri.mac` / `ext.mac`
//! 指向 HEVC-with-Alpha 的 `.mov` 素材：WKWebView 不认 VP9-alpha WebM）。
//!
//! 于是本模块只剩两件事，全部与「下载/解压/安装」无关：
//! 1. 从资源清单取 `pets.built-in`；
//! 2. 校验形状（id 安全 + 唯一、地址非空、kind 合法）后原样交给前端。

use std::collections::HashSet;
use tauri::AppHandle;

use crate::config::manifest::{self, PresetPetSpec};

/// 预设 id 是否安全（直接进入设置持久化与命令参数，只允许 ASCII 字母数字与 `-`/`_`）。
pub(crate) fn safe_preset_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || value == '-' || value == '_')
}

/// 读取并校验清单。任何形状问题都返回带 `PET_PRESET_CATALOG_*` 前缀的错误，不做静默兜底。
pub fn read_preset_catalog(app: &AppHandle) -> Result<Vec<PresetPetSpec>, String> {
    let manifest = manifest::read(app)
        .ok_or_else(|| "PET_PRESET_CATALOG_MISSING: manifest.jsonc was not found".to_string())?;
    let catalog = manifest.pets.built_in;
    validate_catalog(&catalog)?;
    Ok(catalog)
}

fn validate_catalog(catalog: &[PresetPetSpec]) -> Result<(), String> {
    let mut ids = HashSet::new();
    for spec in catalog {
        if !safe_preset_id(&spec.id) {
            return Err(format!(
                "PET_PRESET_CATALOG_INVALID: preset id {:?} is not a safe id",
                spec.id
            ));
        }
        if !ids.insert(spec.id.as_str()) {
            return Err(format!(
                "PET_PRESET_CATALOG_INVALID: duplicate preset id {:?}",
                spec.id
            ));
        }
        for (field, value) in [
            ("name", spec.name.as_str()),
            ("config", spec.config.as_str()),
            ("uri.default", spec.uri.default.as_str()),
        ] {
            if value.trim().is_empty() {
                return Err(format!(
                    "PET_PRESET_CATALOG_INVALID: preset {:?} must have a non-empty {field}",
                    spec.id
                ));
            }
        }
        if let Some(kind) = spec.kind.as_deref() {
            if kind != "dsh" && kind != "codex" {
                return Err(format!(
                    "PET_PRESET_CATALOG_INVALID: preset {:?} kind must be dsh or codex",
                    spec.id
                ));
            }
        }
    }
    Ok(())
}

/// 列出预设宠物清单（前端按当前激活 id 自行取用；条目即 `<Pet>` 的渲染参数）。
#[tauri::command]
pub fn list_preset_pets(app: AppHandle) -> Result<Vec<PresetPetSpec>, String> {
    read_preset_catalog(&app)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shipped_catalog() -> Vec<PresetPetSpec> {
        manifest::read_at(
            &std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/manifest.jsonc"),
        )
        .expect("shipped manifest should be valid")
        .pets
        .built_in
    }

    #[test]
    fn shipped_catalog_is_valid_and_remote_only() {
        // 随包分发的清单是唯一事实来源：字段名/形状写错必须在这里炸，
        // 而不是等用户点「启用」才在运行时静默失败。
        let catalog = shipped_catalog();
        assert!(!catalog.is_empty(), "预设清单不应为空");
        for spec in catalog {
            assert!(safe_preset_id(&spec.id), "非法 id: {}", spec.id);
            assert!(!spec.name.trim().is_empty());
            assert!(!spec.config.trim().is_empty());
            assert!(!spec.uri.default.trim().is_empty());
            // 不再有本地安装：素材与配置都必须是远端地址。
            assert!(
                spec.config.starts_with("https://"),
                "config 必须是 https 地址"
            );
            assert!(
                spec.uri.default.starts_with("https://"),
                "uri.default 必须是 https 地址"
            );
            if let Some(kind) = spec.kind.as_deref() {
                assert!(kind == "dsh" || kind == "codex");
            }
        }
    }

    #[test]
    fn shipped_catalog_provides_macos_mov_override() {
        // macOS 的 WKWebView 不认 VP9-alpha：至少一个预设必须给出 .mov 覆盖块。
        let spec = shipped_catalog()
            .into_iter()
            .find(|spec| spec.uri.mac.is_some())
            .expect("至少一个预设应提供 macOS 素材覆盖");
        let mac = spec.uri.mac.unwrap();
        assert!(mac.starts_with("https://"));
        assert!(mac.ends_with("/mov"), "macOS 素材目录应为 mov/: {mac}");
        assert_eq!(
            spec.ext.as_ref().and_then(|ext| ext.mac.as_deref()),
            Some("mov")
        );
    }

    #[test]
    fn catalog_entry_deserializes_with_defaults_and_rejects_unknown_fields() {
        let spec: PresetPetSpec = serde_json::from_str(
            r#"{
                "id": "maid-deepseek-whale",
                "name": "Maid DeepSeek Whale",
                "config": "https://example.com/config.jsonc",
                "uri": { "default": "https://example.com/webm" }
            }"#,
        )
        .unwrap();
        assert_eq!(spec.id, "maid-deepseek-whale");
        assert_eq!(spec.desc, None);
        assert_eq!(spec.kind, None);
        assert_eq!(spec.size, None);
        assert_eq!(spec.ext, None);
        assert_eq!(spec.uri.mac, None);

        // 字段名写错（如旧的 sizeMb）必须立刻报错，而不是被静默忽略。
        let error = serde_json::from_str::<PresetPetSpec>(
            r#"{
                "id": "x",
                "name": "X",
                "config": "https://example.com/config.jsonc",
                "uri": { "default": "https://example.com/webm" },
                "sizeMb": 113
            }"#,
        )
        .unwrap_err();
        assert!(
            error.to_string().contains("sizeMb"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn serialization_omits_absent_optional_fields() {
        // 前端 props 里 optional 字段缺省即 undefined：null 会让 `mac?: string` 变成 null。
        let spec = PresetPetSpec {
            id: "p".to_string(),
            name: "P".to_string(),
            desc: None,
            image: None,
            kind: Some("dsh".to_string()),
            size: Some(220.0),
            config: "https://example.com/config.jsonc".to_string(),
            uri: manifest::PresetPetUri {
                default: "https://example.com/webm".to_string(),
                mac: None,
            },
            ext: None,
        };
        let value = serde_json::to_value(&spec).unwrap();
        assert!(value.get("desc").is_none());
        assert!(value.get("ext").is_none());
        assert!(value["uri"].get("mac").is_none());
        assert_eq!(value["kind"], "dsh");
        assert_eq!(value["size"], 220.0);
    }

    #[test]
    fn catalog_validation_preserves_field_errors_and_order() {
        let valid: PresetPetSpec = serde_json::from_str(
            r#"{"id":"safe","name":"Pet","config":"https://e/c","uri":{"default":"https://e/w"}}"#,
        )
        .unwrap();
        assert_eq!(validate_catalog(&[]), Ok(()));
        assert_eq!(validate_catalog(std::slice::from_ref(&valid)), Ok(()));
        for (field, expected) in [
            (
                "name",
                "PET_PRESET_CATALOG_INVALID: preset \"safe\" must have a non-empty name",
            ),
            (
                "config",
                "PET_PRESET_CATALOG_INVALID: preset \"safe\" must have a non-empty config",
            ),
            (
                "uri.default",
                "PET_PRESET_CATALOG_INVALID: preset \"safe\" must have a non-empty uri.default",
            ),
        ] {
            let mut spec = valid.clone();
            match field {
                "name" => spec.name = " \t".into(),
                "config" => spec.config = "\n".into(),
                _ => spec.uri.default = " ".into(),
            }
            assert_eq!(validate_catalog(&[spec]), Err(expected.into()));
        }
        let mut duplicate = valid.clone();
        duplicate.name.clear();
        assert_eq!(
            validate_catalog(&[valid.clone(), duplicate]),
            Err("PET_PRESET_CATALOG_INVALID: duplicate preset id \"safe\"".into())
        );
        let mut unsafe_id = valid.clone();
        unsafe_id.id = "../escape".into();
        unsafe_id.name.clear();
        assert_eq!(
            validate_catalog(&[unsafe_id]),
            Err("PET_PRESET_CATALOG_INVALID: preset id \"../escape\" is not a safe id".into())
        );
        for kind in [None, Some("dsh"), Some("codex")] {
            let mut spec = valid.clone();
            spec.kind = kind.map(str::to_owned);
            assert_eq!(validate_catalog(&[spec]), Ok(()));
        }
        let mut invalid_kind = valid;
        invalid_kind.kind = Some("sprite".into());
        assert_eq!(
            validate_catalog(&[invalid_kind]),
            Err("PET_PRESET_CATALOG_INVALID: preset \"safe\" kind must be dsh or codex".into())
        );
    }

    #[test]
    fn catalog_validation_rejects_unsafe_ids_and_bad_kind() {
        let bad_id = r#"[{ "id": "../escape", "name": "X", "config": "https://e.com/c.jsonc", "uri": { "default": "https://e.com/w" } }]"#;
        let catalog: Vec<PresetPetSpec> = serde_json::from_str(bad_id).unwrap();
        assert!(!safe_preset_id(&catalog[0].id));

        let bad_kind = r#"[{ "id": "x", "name": "X", "kind": "sprite", "config": "https://e.com/c.jsonc", "uri": { "default": "https://e.com/w" } }]"#;
        let catalog: Vec<PresetPetSpec> = serde_json::from_str(bad_kind).unwrap();
        assert_eq!(catalog[0].kind.as_deref(), Some("sprite"));
        assert!(catalog[0]
            .kind
            .as_deref()
            .is_some_and(|kind| kind != "dsh" && kind != "codex"));
    }
}
