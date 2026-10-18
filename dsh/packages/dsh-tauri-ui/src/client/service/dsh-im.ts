import type { ClientContext } from 'dsh-tauri/client'
import type { DshImClient } from './dsh-im.types'
import { DSH_IM_CLIENT_SERVICE } from '../constants'

/**
 * client/service/dsh-im.ts — 读 dsh-im 客户端服务（能力探测，不做版本嗅探）。
 *
 * 服务由另一个客户端插件发布、apply 顺序不保证，且旧版 dsh-im 根本没有它：
 * 在注册回调内即时读取，`version !== 1`、缺少可调用的 `render` 或注册表异常
 * 一律按「没有该能力」处理——只失去这个控制面，不影响本插件自身。
 */
export function readDshImClient(ctx: ClientContext): DshImClient | undefined {
  const reflect = ctx?.reflect
  if (reflect === undefined || typeof reflect.get !== 'function')
    return undefined
  let service: unknown
  try {
    service = reflect.get(DSH_IM_CLIENT_SERVICE)
  }
  catch {
    return undefined
  }
  if (service === null || service === undefined)
    return undefined
  const face = service as DshImClient
  const usable = face.version === 1
    && typeof face.render === 'function'
    && typeof face.setSettingsVisible === 'function'
    && typeof face.settingsVisible === 'function'
  return usable ? face : undefined
}
