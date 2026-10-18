//! 多 Profile 环境隔离。
//!
//! 管理 `$DSH_HOME/profiles` 下的档案：列表、创建（web 模板）、切换当前使用中的
//! 档案，以及删除（默认档案与使用中的档案不可删除）与重置（清空档案数据、
//! 保留会话）。

use crate::config;
use crate::service::profile;
use crate::service::profile::migrate::{MigrationAnalysis, MigrationDataKind, MigrateReport};
use tauri::AppHandle;

/// 档案列表（$DSH_HOME/profiles 下的目录，含 active/default 标记）
#[tauri::command]
pub fn get_profiles(app_handle: AppHandle) -> Vec<profile::Profile> {
    profile::list(&app_handle)
}

/// 新建档案（初始化 $DSH_HOME/profiles/<id>，web 模板）
#[tauri::command]
pub fn create_profile(app_handle: AppHandle, name: String) -> Result<profile::Profile, String> {
    profile::create(&app_handle, &name)
}

/// 切换当前使用中的档案（持久化；重启服务后生效，由前端触发）
#[tauri::command]
pub fn set_active_profile(app_handle: AppHandle, id: String) -> Result<profile::Profile, String> {
    profile::set_active(&app_handle, &id)
}

/// 删除档案（默认档案与使用中的档案不可删除）
#[tauri::command]
pub fn remove_profile(app_handle: AppHandle, id: String) -> Result<(), String> {
    profile::remove(&app_handle, &id)
}

/// 重置档案（清空档案目录并按模板重新初始化；会话数据在档案目录之外，保留）
#[tauri::command]
pub fn reset_profile(app_handle: AppHandle, id: String) -> Result<(), String> {
    profile::reset(&app_handle, &id)
}

/// 克隆档案（全量复制源档案目录，自动递增命名或指定名称）。
///
/// 异步命令：把 CPU/IO 密集的目录树复制放到 `spawn_blocking` 线程池，
/// 避免阻塞 Tauri 异步运行时导致 UI 卡顿。内部 `copy_dir_tree` 已用 rayon
/// 并行处理同级条目。
#[tauri::command]
pub async fn clone_profile(
    app_handle: AppHandle,
    source_id: String,
    name: Option<String>,
) -> Result<profile::Profile, String> {
    let profiles_root = config::get_dsh_data_path(&app_handle).join("profiles");
    tauri::async_runtime::spawn_blocking(move || {
        profile::clone_with_root(&profiles_root, &source_id, name.as_deref())
    })
    .await
    .map_err(|e| format!("PROFILE_CLONE_TASK: {e}"))?
}

/// 分析源档案的可迁移插件与档案级数据（只读，判定基准 = 当前核心版本）
#[tauri::command]
pub async fn analyze_profile_migration(
    app_handle: AppHandle,
    source_id: String,
) -> Result<MigrationAnalysis, String> {
    profile::migrate::analyze(&app_handle, &source_id).await
}

/// 把源档案选中的数据并入当前档案（逐项独立，结果里逐项报告）
#[tauri::command]
pub async fn migrate_profile_data(
    app_handle: AppHandle,
    source_id: String,
    items: Vec<MigrationDataKind>,
) -> Result<MigrateReport, String> {
    let handle = app_handle.clone();
    tauri::async_runtime::spawn_blocking(move || {
        profile::migrate::apply(&handle, &source_id, &items)
    })
    .await
    .map_err(|e| format!("PROFILE_MIGRATION_TASK: {e}"))?
}
