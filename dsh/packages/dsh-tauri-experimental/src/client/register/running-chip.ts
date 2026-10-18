/**
 * client/register/running-chip.ts — 把「运行中」提示条注册进 `conversation.input.dock`。
 *
 * 该槽是 **list** 型、**可叠加**，因此与工作树状态条等其他 dock 条目并存即可，无需抢占选举；
 * 负 order 让提示条排在官方任务清单与工作树横幅之上（理由见 constants）。
 */

import type { ClientContext } from 'dsh-tauri/client'
import { defineRegister } from 'dsh-tauri/client'
import { RunningChangesChip } from '../components/running-changes-chip'
import {
  PLUGIN_ID,
  RUNNING_CHANGES_INPUT_DOCK_SLOT,
  RUNNING_CHANGES_RUNNING_CHIP_ID,
  RUNNING_CHANGES_RUNNING_CHIP_ORDER,
} from '../constants'

export const runningChipFeature = defineRegister<ClientContext>((controller, ctx) => {
  controller.add(ctx.slots.inject(
    RUNNING_CHANGES_INPUT_DOCK_SLOT as never,
    () =>
      ctx.slots.register(
        {
          name: RUNNING_CHANGES_INPUT_DOCK_SLOT,
          id: RUNNING_CHANGES_RUNNING_CHIP_ID,
          order: RUNNING_CHANGES_RUNNING_CHIP_ORDER,
          registrant: PLUGIN_ID,
          inject: (sessionId?: string) => ({ sessionId }),
        } as never,
        RunningChangesChip as never,
      ),
  ))
})
