import type { PasteReferenceInsert, PasteTokenSpan } from './paste-collapse.types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pasteCollapseFeature } from './paste-collapse'

/**
 * 折叠粘贴的注册层契约：占位 chip 的插入参数、正文的双向（草稿投影 + 模型序列化）与
 * 「任何一环缺席都不接管」的退级。仓库未装 jsdom，DOM 用最小替身提供。
 */

const PASTE_SOURCE = 'dsh-tauri-experimental-paste'
const LONG_TEXT = `### 环境信息 app:版本 1.0\n${'日志行'.repeat(200)}`

interface ControllerStub {
  paste: (event: unknown) => void
  dispose: () => void
}

const mocks = vi.hoisted(() => ({
  adapter: {} as Record<string, unknown>,
  controller: undefined as unknown,
  text: vi.fn((key: string) => key),
}))

vi.mock('dsh-tauri/client', () => {
  const defineLocale = (namespace: string) => ({
    NS: namespace,
    text: mocks.text,
    activeLocale: () => 'zh',
    isEnglishLocale: () => false,
    useLocale: () => 'zh',
    registerLocale: () => () => {},
  })
  const createLifecycleController = () => {
    const disposers: Array<() => void> = []
    let pasteHandler: ((event: unknown) => void) | undefined
    return {
      add: (disposer: () => void) => {
        disposers.push(disposer)
      },
      listen: (_type: string, handler: (event: unknown) => void) => {
        pasteHandler = handler
        return () => {}
      },
      observe: () => ({ disconnect: () => {} }),
      isDisposed: () => false,
      dispose: () => {
        for (const disposer of [...disposers])
          disposer()
        disposers.length = 0
      },
      paste: (event: unknown) => pasteHandler?.(event),
    }
  }
  return {
    defineLocale,
    createLifecycleController,
    defineRegister: (ctxOrSetup: unknown, maybeSetup?: unknown) => {
      const setup = (typeof maybeSetup === 'function' ? maybeSetup : ctxOrSetup) as
        (controller: unknown, ctx: unknown, adapter: unknown) => void
      return function registerEffect(this: unknown) {
        const controller = createLifecycleController()
        mocks.controller = controller
        setup(controller, this, mocks.adapter)
        return () => controller.dispose()
      }
    },
  }
})

class FakeElement {
  closest: (selector: string) => unknown = () => null
}

function snapshotSource<T>(initial: T) {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    publish: (next: T) => {
      state = next
      for (const listener of [...listeners])
        listener()
    },
  }
}

interface HarnessOptions {
  insertable?: boolean
  retained?: boolean
  triggersAvailable?: boolean
  /** 模拟 `0.1.5-rc.x`：动作面没有 captureInsertion，只有壳自身的 caretSpan。 */
  legacyActions?: boolean
}

function harness(options: HarnessOptions = {}) {
  const occurrences = snapshotSource<{ draftRev?: number, occurrences?: readonly { source?: string, ref?: string }[] }>({
    draftRev: 7,
    occurrences: [],
  })
  const span: PasteTokenSpan = { start: 3, end: 3, draftRev: 7 }
  const insertReference = vi.fn((_reference: PasteReferenceInsert, _span: PasteTokenSpan) => options.insertable ?? true)
  const sessionInput = {
    insertReference,
    state: occurrences,
    ...options.legacyActions === true ? { caretSpan: () => ({ start: 5, end: 5 }) } : {},
  }
  const list = snapshotSource({ current: 's-1' as string | undefined })
  const binding = vi.fn((id: string) =>
    id === 's-1' && options.retained !== false ? { ctx: { scope: id } } : undefined)
  const provideInfo = vi.fn(() => ({
    props: { inputActions: options.legacyActions === true ? {} : { captureInsertion: () => span } },
  }))
  const registered: { source?: { name?: string, trigger?: string, codec?: { clipboardText: (ref: string) => string, serialize: (ref: string, signal: AbortSignal) => Promise<string> } } } = {}
  const triggers = {
    registerSource: vi.fn((source: unknown) => {
      registered.source = source as typeof registered.source
      return () => {}
    }),
  }

  mocks.adapter.sessions = { list, binding, provideInfo }
  mocks.adapter.service = (name: string) => {
    if (name === 'conversation')
      return { input: { for: () => sessionInput } }
    if (name === 'inputTriggers')
      return options.triggersAvailable === false ? undefined : triggers
    return undefined
  }

  Object.assign(globalThis, { document: {}, Element: FakeElement })
  mocks.text.mockClear()

  const ctx = { inject: (_deps: readonly string[], callback: () => undefined | (() => void)) => callback() }
  const register = pasteCollapseFeature as unknown as (this: unknown) => () => void
  const cleanup = register.call(ctx)

  return {
    span,
    insertReference,
    occurrences,
    binding,
    provideInfo,
    triggers,
    triggerSource: () => registered.source,
    setCurrentSession: (sessionId: string | undefined) => list.publish({ current: sessionId }),
    paste: (event: unknown) => (mocks.controller as ControllerStub).paste(event),
    cleanup,
  }
}

function pasteEvent(options: {
  text?: string
  files?: number
  inComposer?: boolean
  defaultPrevented?: boolean
} = {}) {
  const target = new FakeElement()
  target.closest = (selector: string) => options.inComposer === false
    ? null
    : (selector === '[data-composer-card]' ? {} : null)
  return {
    clipboardData: {
      items: Array.from({ length: options.files ?? 0 }, () => ({ kind: 'file' })),
      getData: () => options.text ?? LONG_TEXT,
    },
    target,
    defaultPrevented: options.defaultPrevented ?? false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  }
}

beforeEach(() => {
  vi.useFakeTimers({ now: 0 })
})

afterEach(() => {
  vi.useRealTimers()
  delete mocks.adapter.sessions
  delete mocks.adapter.service
})

describe('pasteCollapseFeature', () => {
  it('超过 500 字的粘贴插入引用 chip，label 带首行与字数，正文随 chip 一起被 codec 还原', async () => {
    const h = harness()
    const event = pasteEvent()

    h.paste(event)

    expect(h.insertReference, '长文本必须走 chip 插入，而不是把原文灌进编辑器').toHaveBeenCalledTimes(1)
    const [insert, span] = h.insertReference.mock.calls[0]!
    expect(insert.source, 'chip 必须归属于本插件注册的引用源，否则发送时找不到 codec').toBe(PASTE_SOURCE)
    expect(insert.ref, 'ref 必须是本插件签发的标识').toMatch(new RegExp(`^${PASTE_SOURCE}-\\d+$`))
    expect(insert.appearance, 'chip 用文档图标').toBe('file')
    expect(insert.clipboardText, '草稿投影与原生复制必须是正文原文').toBe(LONG_TEXT)
    expect(mocks.text, 'label 走本地化文案，带首行与字数').toHaveBeenCalledWith('pasteChipTitled', {
      title: '### 环境信息 app:版本 1.0',
      count: LONG_TEXT.length,
    })
    expect(insert.label).toBe('pasteChipTitled')
    expect(span, '插入位置取自标准动作面的选区快照').toBe(h.span)

    expect(event.preventDefault, '接管后必须阻止浏览器默认插入').toHaveBeenCalledTimes(1)
    expect(event.stopPropagation, '接管后必须挡住官方的 paste 命令').toHaveBeenCalledTimes(1)

    const codec = h.triggerSource()?.codec
    expect(codec, '模型序列化依赖注册的引用源 codec').toBeDefined()
    await expect(codec!.serialize(insert.ref, new AbortController().signal)).resolves.toBe(LONG_TEXT)
    expect(codec!.clipboardText(insert.ref), '剪贴板/持久化投影同样是正文').toBe(LONG_TEXT)
    h.cleanup()
  })

  it('恰好 500 字的粘贴不接管：阈值是「超过」', () => {
    const h = harness()
    const event = pasteEvent({ text: 'x'.repeat(500) })

    h.paste(event)

    expect(h.insertReference, '恰好 500 字必须走官方粘贴路径').not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
    h.cleanup()
  })

  it('带文件的粘贴不接管：文件入草稿由官方路径负责', () => {
    const h = harness()
    const event = pasteEvent({ files: 1 })

    h.paste(event)

    expect(h.insertReference).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
    h.cleanup()
  })

  it('composer 卡片之外的粘贴不接管', () => {
    const h = harness()
    const event = pasteEvent({ inComposer: false })

    h.paste(event)

    expect(h.binding, '非 composer 落点连会话都不必解析').not.toHaveBeenCalled()
    expect(h.insertReference).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
    h.cleanup()
  })

  it('chip 插入失败时不接管，也不留下无处引用的正文', () => {
    const h = harness({ insertable: false })
    const event = pasteEvent()

    h.paste(event)

    expect(h.insertReference).toHaveBeenCalledTimes(1)
    expect(event.preventDefault, '插入失败必须放行官方路径，绝不吞掉用户的粘贴').not.toHaveBeenCalled()
    const [insert] = h.insertReference.mock.calls[0]!
    expect(h.triggerSource()?.codec?.clipboardText(insert.ref), '失败插入的正文必须回滚').toBe('')
    h.cleanup()
  })

  it('草稿中已删除的 chip 过宽限期后回收正文，序列化报错而不是静默降级成空文本', async () => {
    const h = harness()
    h.paste(pasteEvent())
    const [insert] = h.insertReference.mock.calls[0]!
    const codec = h.triggerSource()!.codec!

    vi.setSystemTime(3000)
    h.occurrences.publish({ occurrences: [] })

    expect(codec.clipboardText(insert.ref), '正文必须随 chip 删除一起回收').toBe('')
    await expect(codec.serialize(insert.ref, new AbortController().signal)).rejects.toThrow(/已不在内存中/)
    h.cleanup()
  })

  it('宽限期内草稿投影尚未包含该 chip 时不回收正文', async () => {
    const h = harness()
    h.paste(pasteEvent())
    const [insert] = h.insertReference.mock.calls[0]!
    const codec = h.triggerSource()!.codec!

    h.occurrences.publish({ occurrences: [] })

    await expect(codec.serialize(insert.ref, new AbortController().signal)).resolves.toBe(LONG_TEXT)
    h.cleanup()
  })

  it('0.1.5-rc.x 动作面没有 captureInsertion 时退回壳自身的 caretSpan，chip 仍插在光标处', () => {
    const h = harness({ legacyActions: true })
    const event = pasteEvent()

    h.paste(event)

    expect(h.insertReference, '旧基线的折叠同样必须生效').toHaveBeenCalledTimes(1)
    expect(h.insertReference.mock.calls[0]![1], '快照由 caretSpan + state.draftRev 组成').toEqual({ start: 5, end: 5, draftRev: 7 })
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    h.cleanup()
  })

  it('引用源缺席（无 inputTriggers 服务）时不接管粘贴', () => {
    const h = harness({ triggersAvailable: false })
    const event = pasteEvent()

    h.paste(event)

    expect(h.triggers.registerSource, '服务缺席时不得注册半截引用源').not.toHaveBeenCalled()
    expect(h.insertReference).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
    h.cleanup()
  })

  it('会话未被保留（拿不到会话作用域）时不接管粘贴', () => {
    const h = harness({ retained: false })
    const event = pasteEvent()

    h.paste(event)

    expect(h.insertReference).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
    h.cleanup()
  })
})
