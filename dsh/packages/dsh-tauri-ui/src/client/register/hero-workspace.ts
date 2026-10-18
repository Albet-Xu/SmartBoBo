import type { AdapterWorkspaces, ClientAdapter, ClientContext } from 'dsh-tauri/client'
import { defineRegister } from 'dsh-tauri/client'
import { PLUGIN_ID } from '../../shared/constants'
import {
  HERO_WORKSPACE_FLOW_SLOT,
  HERO_WORKSPACE_PRIORITY,
  HERO_WORKSPACE_SLOT,
} from '../constants'
import { startUngroupedSession } from '../service/ungrouped-session'
import { HeroWorkspace } from '../ui/hero-workspace'

/**
 * 接管官方 `conversation.hero.workspace`（single/root）：按更低 priority 顶掉官方 `WorkspacePicker`，
 * 官方注册仍在场（其子槽 `…directoryFlow` 继续有效，本条目退位时官方选择器原样回来）。
 */
export const heroWorkspaceFeature = defineRegister<ClientContext>((controller, ctx, adapter) => {
  const directoryFlow = {
    getSnapshot: () => ctx.slots.entries(HERO_WORKSPACE_FLOW_SLOT as never).length > 0,
    subscribe: (listener: () => void) => ctx.slots.subscribe(HERO_WORKSPACE_FLOW_SLOT as never, listener),
  }

  controller.add(ctx.slots.inject(HERO_WORKSPACE_SLOT as never, () => {
    // 退级第 4 级：没有 composer 补丁时不接管——否则「未分组」会开出一条输入不了的会话。
    // 探测点必须在 inject 回调里：本槽由官方 conversation 条目声明，此刻它的产物已求值完
    // （补丁的能力标记正是在那里写下的），因此不依赖插件激活顺序。
    if (!adapter.has('composer.workspace-less')) {
      console.warn(
        `[${PLUGIN_ID}] 「未分组」新建会话不可用：缺少桌面壳 composer 补丁（composer.workspace-less），保留官方工作区选择器。`,
      )
      return () => {}
    }

    return ctx.slots.register(
      {
        name: HERO_WORKSPACE_SLOT,
        registrant: PLUGIN_ID,
        priority: HERO_WORKSPACE_PRIORITY,
        inject: () => ({
          createWorkspace: readCreateWorkspace(adapter),
          startUngrouped: () => startUngroupedSession(ctx, adapter),
          hooks: { directoryFlow },
        }),
      } as never,
      HeroWorkspace as never,
    )
  }))
})

/** 调用期解析：适配层创建期的 `adapter.workspaces` 快照可能因服务晚到而永久缺席。 */
function readCreateWorkspace(adapter: ClientAdapter): AdapterWorkspaces['create'] {
  const workspaces = adapter.service<AdapterWorkspaces>('workspaces')
  return workspaces?.create?.bind(workspaces)
}
