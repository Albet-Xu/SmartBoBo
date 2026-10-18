//! 备份 / 还原 Tauri 命令。
//!
//! 薄封装：把 IPC 参数转成 `service::backup` 的调用，遵循 `bridge/profile.rs`
//! → `service::profile` 的分层模式。备份 / 还原均为异步命令，IO 密集的
//! 归档操作通过 `spawn_blocking` 脱离异步运行时，避免阻塞 UI。

use tauri::AppHandle;

use crate::service::backup;

#[tauri::command]
pub async fn export_recovery_backup(
    app_handle: AppHandle,
    include_credentials: bool,
) -> Result<backup::BackupInfo, String> {
    let transition = crate::service::workflow::acquire_core_transition().await?;
    let operation = crate::service::plugin::acquire_operation_lock().await;
    crate::service::workflow::stop(app_handle.clone()).await?;
    let source = crate::config::get_dsh_data_path(&app_handle);
    let app_data = crate::config::get_base_dir(&app_handle);
    tauri::async_runtime::spawn_blocking(move || {
        let _transition = transition;
        let _operation = operation;
        backup::recovery::export(&source, &app_data, include_credentials)
    })
    .await
    .map_err(|e| format!("RECOVERY_TASK: {e}"))?
}

/// 创建当前 profile 的备份（不包含共享会话与工作区数据）。
///
/// 异步命令：zstd 多线程压缩 + 目录遍历在 `spawn_blocking` 线程池执行。
#[tauri::command]
pub async fn backup_profile(
    app_handle: AppHandle,
    include_credentials: bool,
) -> Result<backup::BackupInfo, String> {
    let app = app_handle.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        backup::create_backup(
            &app,
            backup::BackupOptions { include_credentials },
        )
    })
    .await
    .map_err(|e| format!("BACKUP_TASK: {e}"))?;
    match &result {
        Ok(info) => log::info!("[backup] 创建成功: {} ({} bytes)", info.timestamp, info.size),
        Err(e) => log::error!("[backup] 创建失败: {e}"),
    }
    result
}

/// 从指定备份还原。
///
/// `as_new` = true 时创建新档案目录；false 时覆盖当前激活的 profile。
/// 异步命令：zstd 解压在 `spawn_blocking` 线程池执行。
#[tauri::command]
pub async fn restore_profile(
    app_handle: AppHandle,
    timestamp: String,
    as_new: bool,
) -> Result<(), String> {
    let mode = if as_new {
        backup::RestoreMode::AsNew
    } else {
        backup::RestoreMode::Overwrite
    };
    let app = app_handle.clone();
    tauri::async_runtime::spawn_blocking(move || {
        backup::restore_backup(&app, &timestamp, mode)
    })
    .await
    .map_err(|e| format!("RESTORE_TASK: {e}"))?
}

/// 列出所有备份。
#[tauri::command]
pub fn list_backups(app_handle: AppHandle) -> Vec<backup::BackupInfo> {
    backup::list_backups(&app_handle)
}

/// 删除指定备份。
#[tauri::command]
pub fn delete_backup(app_handle: AppHandle, timestamp: String) -> Result<(), String> {
    backup::delete_backup(&app_handle, &timestamp)
}
