/** Rust 侧 `config::RuntimeInfo` 的序列化形态（snake_case） */
export interface RuntimeInfo {
  app_version: string
  /** 当前活动核心的版本号（本地读取，界面展示用） */
  dsh_version: string | null
  node_version: string
  service_url: string
  data_dir: string
  log_path: string
  platform: string
  arch: string
}
