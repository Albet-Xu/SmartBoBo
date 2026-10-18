/**
 * 补丁层问题的识别与信息提取（纯函数，便于单测）。
 *
 * 两类问题：
 * - YAML 语法错误：Rust 侧 `service::plugin::internal::repair_loader_state` 解析
 *   档案层 / home 层的 `cordis.patch.yml` 失败时抛出
 *   `INTERNAL_PLUGIN_PATCH_PARSE_FAILED: <路径>: <错误>`（见
 *   `service::plugin::patch_guard` 的模块说明），随后被包成
 *   `INTERNAL_PLUGIN_INSTALL_FAILED` 并挂在「Plugin installation 阶段」——用户看到
 *   的是「插件安装失败」，实际原因却是补丁文件写错了（issue #525）。
 * - 悬空 insert 条目：手写的 `insert` 引用了装不出来的包，loader 抛
 *   `ERR_MODULE_NOT_FOUND` 让整棵树加载失败（见 `service::plugin::patch_entries`），
 *   启动前预检抛出 `PATCH_LAYER_ENTRY_UNRESOLVED: {json}`。
 *
 * 两类都在这里转成「哪个文件、哪一行、怎么改」的针对性提示与恢复入口。
 */

/** Rust 侧补丁层解析失败的错误码。 */
export const PATCH_PARSE_ERROR_CODE = 'INTERNAL_PLUGIN_PATCH_PARSE_FAILED'

/** 启动失败信息里是否包含补丁层解析失败。 */
export function containsPatchLayerParseError(message: string): boolean {
  return message.includes(`${PATCH_PARSE_ERROR_CODE}:`)
}

/** 提取补丁层解析失败的「路径 + YAML 错误（含行列号）」片段（无则空串）。 */
export function patchLayerErrorDetail(message: string): string {
  const marker = `${PATCH_PARSE_ERROR_CODE}:`
  const at = message.indexOf(marker)
  if (at < 0)
    return ''
  return message.slice(at + marker.length).trim()
}

/** Rust 侧补丁层「隔离失败」的错误码。 */
export const QUARANTINE_FAILED_CODE = 'PATCH_LAYER_QUARANTINE_FAILED'

/**
 * 隔离动作是否因改名失败而中止。
 *
 * 损坏文件仍在原地时后端会拒绝重启（否则立刻回到同一个解析失败），前端据此换成
 * 「先手动处理文件」的提示，而不是再弹一条备份已完成的 toast。
 */
export function containsQuarantineFailure(message: string): boolean {
  return message.includes(`${QUARANTINE_FAILED_CODE}:`)
}

/** 提取隔离失败的具体原因（路径 + 改名错误）；无则空串。 */
export function quarantineFailureDetail(message: string): string {
  const marker = `${QUARANTINE_FAILED_CODE}:`
  const at = message.indexOf(marker)
  if (at < 0)
    return ''
  return message.slice(at + marker.length).trim()
}

/** Rust 侧补丁层「悬空 insert 条目」的错误码。 */
export const PATCH_ENTRY_UNRESOLVED_CODE = 'PATCH_LAYER_ENTRY_UNRESOLVED'

/** Rust 侧 `service::plugin::patch_entries::UnresolvedPatchEntry` 的序列化形态。 */
export interface UnresolvedPatchEntry {
  /** 补丁层文件路径（档案层或 home 层） */
  layer: string
  /** `name` 所在的 1-based 行号 */
  line: number
  /** 条目的 loader id（缺失时用包名展示） */
  id?: string | null
  /** 引用的包名 */
  name: string
  /** 该包是否仍写在档案 dependencies 里（是则「重装插件」比「删条目」更对症） */
  declared: boolean
}

/** 启动失败信息里是否包含补丁层悬空 insert 条目。 */
export function containsPatchEntryUnresolved(message: string): boolean {
  return message.includes(`${PATCH_ENTRY_UNRESOLVED_CODE}:`)
}

/**
 * 提取悬空条目明细（文件 / 行号 / 包名 / 是否已声明）。
 *
 * Rust 侧把明细作为 JSON 挂在错误码之后；这里做括号配平截取再解析，容忍错误串
 * 前后被套上其它文案（如 `errors.startup_failed` 的模板），解析不了就当没有明细
 * ——提示退化成通用文案，绝不因为解析失败而吞掉整条错误。
 */
export function patchEntryUnresolvedEntries(message: string): UnresolvedPatchEntry[] {
  const marker = `${PATCH_ENTRY_UNRESOLVED_CODE}:`
  const at = message.indexOf(marker)
  if (at < 0)
    return []
  const payload = extractJsonObject(message.slice(at + marker.length))
  if (!payload)
    return []
  try {
    const parsed = JSON.parse(payload) as { entries?: UnresolvedPatchEntry[] }
    return Array.isArray(parsed.entries) ? parsed.entries : []
  }
  catch {
    return []
  }
}

/** 从文本里截出第一个配平的 JSON 对象（字符串内的括号不计数）。 */
function extractJsonObject(text: string): string {
  const start = text.indexOf('{')
  if (start < 0)
    return ''
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index++) {
    const char = text[index]
    if (inString) {
      if (escaped)
        escaped = false
      else if (char === '\\')
        escaped = true
      else if (char === '"')
        inString = false
      continue
    }
    if (char === '"') {
      inString = true
    }
    else if (char === '{') {
      depth++
    }
    else if (char === '}') {
      depth--
      if (depth === 0)
        return text.slice(start, index + 1)
    }
  }
  return ''
}
