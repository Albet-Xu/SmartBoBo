//! 备份保留份数裁剪。
//!
//! 当备份数量超过 `backup_retention_count` 时，删除最旧的备份（文件 + 清单条目）。

use std::fs;
use std::path::Path;
use tauri::AppHandle;

use crate::service::backup;

/// 按保留份数裁剪指定目录下的旧备份（文件 + 清单条目）。
///
/// 纯函数：只读 `backup_dir` 路径，不依赖 AppHandle，便于单元测试。
pub fn prune_backups_in_dir(
    backup_dir: &Path,
    retention_count: u32,
) -> Result<(), String> {
    if retention_count == 0 {
        return Ok(());
    }
    // 读取清单
    let manifest_path = backup_dir.join(".manifest.json");
    let content = fs::read_to_string(&manifest_path).unwrap_or_default();
    let mut manifest: serde_json::Value = if content.trim().is_empty() {
        serde_json::json!({ "backups": [] })
    } else {
        serde_json::from_str(&content)
            .map_err(|e| format!("BACKUP_PRUNE_MANIFEST: {e}"))?
    };
    let backups = manifest["backups"]
        .as_array_mut()
        .ok_or_else(|| "BACKUP_PRUNE_MANIFEST_INVALID: backups is not an array".to_string())?;

    if backups.len() <= retention_count as usize {
        return Ok(());
    }

    // 按时间戳升序，保留最新的 retention_count 份
    backups.sort_by(|a, b| {
        let a_ts = a["timestamp"].as_str().unwrap_or("");
        let b_ts = b["timestamp"].as_str().unwrap_or("");
        a_ts.cmp(b_ts)
    });
    let remove_count = backups.len() - retention_count as usize;
    // 收集要删除的条目（保留完整 JSON 以获取 path），然后从清单移除
    let to_remove: Vec<serde_json::Value> = backups.drain(..remove_count).collect();

    // 写回清单（先写 tmp 再 rename，原子性）
    let tmp = manifest_path.with_extension("tmp");
    fs::write(
        &tmp,
        serde_json::to_string_pretty(&manifest)
            .map_err(|e| format!("BACKUP_PRUNE_SERIALIZE: {e}"))?,
    )
    .map_err(|e| format!("BACKUP_PRUNE_WRITE: {e}"))?;
    fs::rename(&tmp, manifest_path)
        .map_err(|e| format!("BACKUP_PRUNE_RENAME: {e}"))?;

    // 删除文件：使用清单中存储的 path 字段（而非自行拼文件名）。
    // 清单可被改写，只有确实位于本目录下的路径才允许删除。
    let canonical_dir =
        fs::canonicalize(backup_dir).map_err(|e| format!("BACKUP_PRUNE_DIR: {e}"))?;
    for entry in &to_remove {
        if let Some(path_str) = entry["path"].as_str() {
            let file = Path::new(path_str);
            if !is_direct_child_of(&canonical_dir, file) {
                log::warn!("[backup] 跳过清单中的越界备份路径: {path_str}");
                continue;
            }
            if file.exists() {
                if let Err(e) = fs::remove_file(file) {
                    // 文件删除失败不阻断整体裁剪，仅记录警告
                    log::warn!("[backup] 删除旧备份失败: {e} ({path_str})");
                }
            }
        }
    }
    Ok(())
}

/// 路径的父目录（跟随链接解析后）是否就是 `dir`。
fn is_direct_child_of(dir: &Path, candidate: &Path) -> bool {
    match candidate.parent() {
        Some(parent) => matches!(fs::canonicalize(parent), Ok(resolved) if resolved == dir),
        None => false,
    }
}

/// 按保留份数裁剪当前 $DSH_HOME/.backups/ 下的旧备份。
pub fn prune_old_backups(
    app_handle: &AppHandle,
    retention_count: u32,
) -> Result<(), String> {
    let backup_dir = backup::get_backup_dir(app_handle);
    prune_backups_in_dir(&backup_dir, retention_count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write as _;

    static FIXTURE_SEQ: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

    /// 在临时目录下构造指定数量的假备份文件 + 清单，返回目录路径。
    fn setup_fake_backups(count: usize) -> std::path::PathBuf {
        let seq = FIXTURE_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "dsh-backup-retention-{}-{}-{}",
            std::process::id(),
            count,
            seq
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let mut entries = Vec::new();
        for i in 0..count {
            // 时间戳按 i 递增，便于验证「最旧的被删」
            let ts = format!("2026{:010}", i); // 14 位紧凑格式，匹配生产代码
            let file = dir.join(format!("web-{ts}.tar.zst")); // 匹配生产代码 {profile}-{ts} 格式
            let mut f = fs::File::create(&file).unwrap();
            f.write_all(b"dummy").unwrap();
            entries.push(serde_json::json!({
                "timestamp": ts,
                "profile": "web",
                "path": file.to_string_lossy(),
                "size": 5,
                "includeCredentials": false
            }));
        }

        let manifest = serde_json::json!({ "backups": entries });
        fs::write(
            dir.join(".manifest.json"),
            serde_json::to_string_pretty(&manifest).unwrap(),
        )
        .unwrap();
        dir
    }

    fn read_manifest_backups(dir: &Path) -> Vec<String> {
        let content = fs::read_to_string(dir.join(".manifest.json")).unwrap();
        let m: serde_json::Value = serde_json::from_str(&content).unwrap();
        m["backups"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|v| v["timestamp"].as_str().map(String::from))
            .collect()
    }

    #[test]
    fn prunes_oldest_backups_beyond_limit() {
        let dir = setup_fake_backups(5);
        prune_backups_in_dir(&dir, 3).unwrap();

        let remaining = read_manifest_backups(&dir);
        assert_eq!(remaining.len(), 3, "5 份备份 retention=3 应剩 3 份");
        // 最旧的 2 个应被删除
        assert!(!remaining.contains(&"20260000000000".to_string()));
        assert!(!remaining.contains(&"20260000000001".to_string()));
        // 文件也应被删除（使用 path 字段）
        assert!(!dir.join("web-20260000000000.tar.zst").exists());
        assert!(!dir.join("web-20260000000001.tar.zst").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn keeps_all_within_limit() {
        let dir = setup_fake_backups(3);
        prune_backups_in_dir(&dir, 10).unwrap();

        let remaining = read_manifest_backups(&dir);
        assert_eq!(remaining.len(), 3, "3 份备份 retention=10 应全部保留");
        for i in 0..3 {
            let ts = format!("2026{:010}", i);
            assert!(dir.join(format!("web-{ts}.tar.zst")).exists());
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn removes_both_file_and_manifest_entry() {
        let dir = setup_fake_backups(2);
        prune_backups_in_dir(&dir, 1).unwrap();

        let remaining = read_manifest_backups(&dir);
        assert_eq!(remaining.len(), 1);
        // 最旧的被删
        assert!(!dir.join("web-20260000000000.tar.zst").exists());
        // 较新的保留
        assert!(dir.join("web-20260000000001.tar.zst").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn refuses_to_delete_paths_outside_backup_dir() {
        let dir = setup_fake_backups(2);
        let outside = std::env::temp_dir().join(format!(
            "dsh-backup-retention-outside-{}",
            std::process::id()
        ));
        fs::write(&outside, b"sentinel").unwrap();
        let mut manifest: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(dir.join(".manifest.json")).unwrap())
                .unwrap();
        manifest["backups"][0]["path"] = serde_json::json!(outside.to_string_lossy());
        fs::write(
            dir.join(".manifest.json"),
            serde_json::to_string_pretty(&manifest).unwrap(),
        )
        .unwrap();

        prune_backups_in_dir(&dir, 1).unwrap();

        assert!(outside.exists(), "清单中的越界路径不得被删除");
        assert_eq!(read_manifest_backups(&dir).len(), 1);
        let _ = fs::remove_file(&outside);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn handles_empty_backup_list() {
        let dir = std::env::temp_dir().join(format!(
            "dsh-backup-retention-empty-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let manifest = serde_json::json!({ "backups": [] });
        fs::write(
            dir.join(".manifest.json"),
            serde_json::to_string_pretty(&manifest).unwrap(),
        )
        .unwrap();

        // 空清单不 panic
        prune_backups_in_dir(&dir, 3).unwrap();
        let remaining = read_manifest_backups(&dir);
        assert!(remaining.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }
}
