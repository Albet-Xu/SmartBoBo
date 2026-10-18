/**
 * register/hero-workspace.test.ts — 英雄区工作区选择控件接管的注册契约回归测试。
 *
 * 锁住的契约：本条目注册进官方单格槽 `conversation.hero.workspace`（动态加载条目拿到更低的
 * shadowing priority，因此顶掉官方 `WorkspacePicker`）；inject 工厂把官方工作区创建能力与
 * 未分组新建动作交给组件，并暴露目录流程槽的占用源（官方「添加工作区」入口据此决定是否出现）。
 */
import type { ClientContext } from 'dsh-tauri/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { heroWorkspaceFeature } from './hero-workspace'

const HERO_WORKSPACE_SLOT = 'conversation.hero.workspace'
const HERO_WORKSPACE_FLOW_SLOT = 'conversation.hero.workspace.directoryFlow'
const HERO_WORKSPACE_PRIORITY = -1

const mocks = vi.hoisted(() => ({
  workspaceService: {
    model: { create: vi.fn() },
    create(input: { path: string }) { return this.model.create(input) },
  },
  startUngroupedSession: vi.fn(),
  registrations: [] as Array<{ key: string, options: Record<string, unknown>, component: unknown }>,
  composerWorkspaceLess: true,
  workspaceServiceAvailable: true,
}))

vi.mock('../service/ungrouped-session', () => ({ startUngroupedSession: mocks.startUngroupedSession }))

// 组件树会拉起官方 primitives（含 `.module.css`，node 环境下不可加载）：这里只验注册契约，替身即可。
vi.mock('../ui/hero-workspace', () => ({ HeroWorkspace: () => null }))

vi.mock('dsh-tauri/client', () => ({
  defineRegister: (ctxOrSetup: unknown, maybeSetup?: unknown) => {
    const setup = (typeof maybeSetup === 'function' ? maybeSetup : ctxOrSetup) as
      (controller: unknown, ctx: unknown, adapter: unknown) => void
    return function registerEffect(this: unknown) {
      const disposers: Array<() => void> = []
      const controller = {
        add: (disposer: () => void) => {
          disposers.push(disposer)
        },
        listen: () => () => {},
        observe: () => ({ disconnect: () => {} }),
        isDisposed: () => false,
        dispose: () => {
          for (const disposer of [...disposers])
            disposer()
          disposers.length = 0
        },
      }
      setup(controller, this, {
        service: (name: string) => name === 'workspaces' && mocks.workspaceServiceAvailable
          ? mocks.workspaceService
          : undefined,
        has: () => mocks.composerWorkspaceLess,
      })
      return () => controller.dispose()
    }
  },
}))

function createCtx(options: { flowOccupied?: boolean } = {}) {
  const register = vi.fn((slotOptions: Record<string, unknown>, component: unknown) => {
    mocks.registrations.push({ key: String(slotOptions.name), options: slotOptions, component })
    return () => {}
  })
  const inject = vi.fn((_key: string, callback: () => unknown) => {
    callback()
    return () => {}
  })
  const subscribe = vi.fn(() => () => {})
  const ctx = {
    slots: {
      register,
      inject,
      entries: () => options.flowOccupied === true ? [{}] : [],
      subscribe,
    },
  } as unknown as ClientContext
  return { ctx, register, inject, subscribe }
}

afterEach(() => {
  mocks.registrations.length = 0
  mocks.composerWorkspaceLess = true
  mocks.workspaceServiceAvailable = true
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('heroWorkspaceFeature', () => {
  it('注册进官方单格槽 conversation.hero.workspace', () => {
    const { ctx, inject, register } = createCtx()

    const dispose = heroWorkspaceFeature.call(ctx)

    expect(inject, '官方槽由 ui-workspace 声明，必须经 inject 等声明到位').toHaveBeenCalledWith(
      HERO_WORKSPACE_SLOT,
      expect.any(Function),
    )
    expect(register).toHaveBeenCalledTimes(1)
    expect(mocks.registrations[0]?.key, '槽位名必须逐字等于官方单格槽').toBe(HERO_WORKSPACE_SLOT)
    expect(mocks.registrations[0]?.options.priority, 'single 槽必须用更低 priority 顶掉官方条目（同 priority 会抛错）')
      .toBe(HERO_WORKSPACE_PRIORITY)
    expect(mocks.registrations[0]?.component, '注册的必须是接管组件本体').toBeTypeOf('function')
    dispose()
  })

  it('inject 工厂绑定官方建工作区服务、未分组新建动作与目录流程占用源', async () => {
    const { ctx, subscribe } = createCtx({ flowOccupied: true })

    const dispose = heroWorkspaceFeature.call(ctx)
    const injectFactory = mocks.registrations[0]?.options.inject as () => {
      createWorkspace?: (input: { path: string }) => Promise<{ workspaceId: string }>
      startUngrouped: () => void
      hooks: { directoryFlow: { getSnapshot: () => boolean, subscribe: (listener: () => void) => () => void } }
    }
    const injected = injectFactory()

    const workspace = { workspaceId: 'workspace-new' }
    mocks.workspaceService.model.create.mockResolvedValue(workspace)
    expect(injected.createWorkspace).toBeTypeOf('function')
    await expect(injected.createWorkspace!({ path: '/tmp/example' })).resolves.toBe(workspace)
    expect(mocks.workspaceService.model.create).toHaveBeenCalledWith({ path: '/tmp/example' })

    injected.startUngrouped()
    expect(mocks.startUngroupedSession).toHaveBeenCalledTimes(1)

    expect(injected.hooks.directoryFlow.getSnapshot(), '目录流程槽已占用').toBe(true)
    const listener = vi.fn()
    injected.hooks.directoryFlow.subscribe(listener)
    expect(subscribe).toHaveBeenCalledWith(HERO_WORKSPACE_FLOW_SLOT, listener)
    dispose()
  })

  it('工作区服务晚于适配层就绪时仍可创建，缺席时不暴露入口', async () => {
    const { ctx } = createCtx()
    mocks.workspaceServiceAvailable = false
    const dispose = heroWorkspaceFeature.call(ctx)
    const injectFactory = mocks.registrations[0]?.options.inject as () => {
      createWorkspace?: (input: { path: string }) => Promise<{ workspaceId: string }>
    }

    expect(injectFactory().createWorkspace).toBeUndefined()
    mocks.workspaceServiceAvailable = true
    const workspace = { workspaceId: 'workspace-late' }
    mocks.workspaceService.model.create.mockResolvedValue(workspace)
    await expect(injectFactory().createWorkspace!({ path: '/tmp/late' })).resolves.toBe(workspace)
    expect(mocks.workspaceService.model.create).toHaveBeenCalledWith({ path: '/tmp/late' })
    dispose()
  })

  it('缺 composer 补丁时不接管：保留官方工作区选择器并告警', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.composerWorkspaceLess = false
    const { ctx, register } = createCtx()

    const dispose = heroWorkspaceFeature.call(ctx)

    expect(register, '退级第 4 级：能力缺席时不得顶掉官方条目').not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('composer.workspace-less'))
    dispose()
  })
})
