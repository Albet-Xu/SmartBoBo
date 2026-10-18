/**
 * utils/error.ts — 插件运行期错误上报桥（iframe → 桌面宿主）。
 *
 * 协议与宿主入站桥 `src/layout/components/iframe.tsx` 的 `dsh://plugin-error` 分支逐字一致：
 *
 *   { type: 'dsh://plugin-error', id, error, action }
 *
 * 宿主收到后经 `report_plugin_error` 持久化到插件错误注册表（`plugin-errors.json`，
 * 按插件 id 幂等覆盖），「插件」面板据此给本插件显示 danger 标记与修复入口。
 */
import type { ErrorAction, ParentMessage } from '../types'
import { PLUGIN_ID } from '../constants'
import { invokeParent } from '../service/invoke-parent'

/** iframe → 宿主：插件运行期错误上报（宿主持久化到 `plugin-errors.json`）。 */
const ERROR_TYPE = 'dsh://plugin-error'

export type { ErrorAction } from '../types'

/**
 * 上报插件运行期错误到宿主。
 *
 * 上报本身绝不抛错：宿主缺席（`NO_HOST`，非 iframe 的运行形态）时静默丢弃，
 * 调用点都在 catch 分支里，二次抛错会盖掉原始错误。
 *
 * @param error - 错误对象/消息（宿主截断保留 2000 字符）
 * @param action - 记录动作，默认 runtime
 */
export function reportPluginError(error: unknown, action: ErrorAction = 'runtime'): void {
  const message = (error instanceof Error ? `${error.name}: ${error.message}` : String(error))
    .trim()
    .slice(0, 2000)
  if (!message)
    return
  const payload: ParentMessage = { type: ERROR_TYPE, id: PLUGIN_ID, error: message, action }
  try {
    invokeParent(payload)
  }
  catch {
    // NO_HOST：没有父窗口可上报，保持原始错误路径不受影响。
  }
}
