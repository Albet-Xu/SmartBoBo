/** 预装插件列表项（与 Rust service::plugin::PreinstallPlugin 对齐） */
export interface PreinstallPlugin {
  id: string
  name: string
  description: string
  repo_url: string
  recommended: boolean
  /** “修复”类项（Windows 极简模式修复）：黄色 chip，默认勾选 */
  fix: boolean
  /** 无 chip 但默认勾选（首次引导直接勾上，不标「推荐」） */
  defaultChecked: boolean
  /** 显式声明首次引导不默认勾选（仍可标「推荐」chip，但不预选） */
  defaultUnchecked: boolean
  installed: boolean
  unsupported: boolean
}

/** Rust 侧 preinstall-log 事件载荷（dsh plugin 进程输出行） */
export interface PreinstallLogPayload {
  line: string
}

/** 预装插件的安装/卸载 diff（前端比对勾选结果得出） */
export interface PreinstallSelection {
  installIds?: string[]
  uninstallIds?: string[]
}

/**
 * 被核心版本兼容性拦截的插件（与 Rust `service::plugin::IncompatibleVersion` 对齐）。
 *
 * 授权只对**精确的**包名 + 版本 + 运行时版本生效，因此三个字段原样往返后端。
 */
export interface IncompatibleVersion {
  name: string
  version: string
  runtime_version: string
}

/**
 * 被 pnpm 发布时长策略拦截的插件版本（与 Rust `service::plugin::PolicyBlockedVersion` 对齐）。
 *
 * 豁免写进档案的 `minimumReleaseAgeExclude`，按精确 `包名@版本` 生效，因此只需要这两个
 * 字段；运行时版本与这条策略无关。
 */
export interface PolicyBlockedVersion {
  name: string
  version: string
}
