import type { ClientContext } from 'dsh-tauri/client'
import type {
  PasteConversationService,
  PasteSessionInput,
  PasteSessionServices,
  PasteTriggerRegistry,
} from './paste-collapse.types'
import { defineRegister } from 'dsh-tauri/client'
import { PLUGIN_ID } from '../../shared/constants'
import { PASTE_CHIP_SOURCE } from '../constants'
import { locale } from '../locales'
import { clipboardFileCount, isCollapsiblePaste, livePasteRefs, pasteChipTitle, resolveInsertionSpan, stalePasteRefs } from './paste-collapse.utils'

/**
 * 大段粘贴（>500 字）折叠成官方引用 chip：编辑器里只留一枚 `首行… · N 字` 的 chip，
 * 发送时由本插件注册的 codec 把正文还原给模型，Backspace 整块删除。
 *
 * 走官方公开面（退级阶梯第 1 级），不改内核产物：
 * - `ctx.inputTriggers.registerSource` 注册 chip 所属的引用源与其 codec（clipboardText 即正文，
 *   草稿投影、原生复制、持久化镜像都拿得到原文；模型侧由 codec.serialize 还原）；
 * - `ctx.conversation.input.for(actx)` 在光标处插入 chip（官方 picks 用的是同一条通路）；
 * - `sessions.provideInfo().props.inputActions.captureInsertion()` 取带修订号的选区快照
 *   （`0.1.5-rc.x` 的动作面还没有它，退回壳自身的 `caretSpan()` + `state.draftRev`）。
 *
 * 任何一环缺席都不接管：官方 paste 路径照常把原文插入编辑器（退级第 4 级），绝不吞掉粘贴。
 * 文本落点判定只认官方 `[data-composer-card]`。
 */
const COMPOSER_CARD_SELECTOR = '[data-composer-card]'
const INPUT_TRIGGERS_SERVICE = 'inputTriggers'
const CONVERSATION_SERVICE = 'conversation'

/** chip 插入后草稿投影才发布，宽限期内把「未引用」当成已删除会连正文一起扔掉。 */
const PASTE_STASH_GRACE_MS = 2000

export const pasteCollapseFeature = defineRegister<ClientContext>((controller, ctx, adapter) => {
  if (typeof document === 'undefined')
    return

  const stash = new Map<string, { text: string, at: number }>()
  let seq = 0
  let ready = false
  let watchedSessionId: string | undefined
  let unwatchState: (() => void) | undefined

  const sessions = (): PasteSessionServices => adapter.sessions as unknown as PasteSessionServices

  const chipLabel = (text: string): string => {
    const title = pasteChipTitle(text)
    return title === ''
      ? locale.text('pasteChip', { count: text.length })
      : locale.text('pasteChipTitled', { title, count: text.length })
  }

  const sessionInputOf = (sessionId: string): PasteSessionInput | undefined => {
    const scope = sessions().binding?.(sessionId)?.ctx
    if (scope === undefined)
      return undefined
    try {
      return adapter.service<PasteConversationService>(CONVERSATION_SERVICE)?.input?.for(scope)
    }
    catch {
      // 未被保留的会话拿不到输入面：按不可用处理，退回官方粘贴路径。
      return undefined
    }
  }

  const prune = (input: PasteSessionInput): void => {
    const live = livePasteRefs(input.state.getSnapshot().occurrences, PASTE_CHIP_SOURCE)
    for (const ref of stalePasteRefs(stash, live, Date.now(), PASTE_STASH_GRACE_MS))
      stash.delete(ref)
  }

  const watch = (sessionId: string, input: PasteSessionInput): void => {
    if (watchedSessionId === sessionId)
      return
    unwatchState?.()
    watchedSessionId = sessionId
    unwatchState = input.state.subscribe(() => prune(input))
  }

  const collapse = (event: ClipboardEvent): void => {
    const clipboard = event.clipboardData
    if (!ready || event.defaultPrevented || clipboard === null)
      return
    const target = event.target
    if (!(target instanceof Element) || target.closest(COMPOSER_CARD_SELECTOR) === null)
      return

    const text = clipboard.getData('text/plain')
    if (!isCollapsiblePaste({ text, fileCount: clipboardFileCount(clipboard) }))
      return

    const sessionId = sessions().list?.getSnapshot().current
    if (sessionId === undefined)
      return
    const input = sessionInputOf(sessionId)
    if (input === undefined)
      return
    const span = resolveInsertionSpan(sessions().provideInfo?.(sessionId)?.props?.inputActions, input)
    if (span === undefined)
      return

    const ref = `${PASTE_CHIP_SOURCE}-${seq + 1}`
    stash.set(ref, { text, at: Date.now() })
    const inserted = input.insertReference(
      { source: PASTE_CHIP_SOURCE, ref, label: chipLabel(text), appearance: 'file', clipboardText: text },
      span,
    )
    if (!inserted) {
      stash.delete(ref)
      return
    }

    seq += 1
    watch(sessionId, input)
    prune(input)
    event.preventDefault()
    event.stopPropagation()
  }

  ctx.inject([INPUT_TRIGGERS_SERVICE], () => {
    const triggers = adapter.service<PasteTriggerRegistry>(INPUT_TRIGGERS_SERVICE)
    if (triggers === undefined)
      return
    const dispose = triggers.registerSource({
      trigger: '@',
      name: PASTE_CHIP_SOURCE,
      showGroupTitle: false,
      candidates: async () => [],
      onPick: () => undefined,
      codec: {
        clipboardText: ref => stash.get(ref)?.text ?? '',
        serialize: async (ref) => {
          const held = stash.get(ref)
          if (held === undefined)
            throw new Error(`[${PLUGIN_ID}] 折叠的粘贴内容 ${ref} 已不在内存中，无法还原`)
          return held.text
        },
      },
    })
    ready = true
    return () => {
      ready = false
      dispose()
    }
  })

  controller.add(() => unwatchState?.())
  controller.add(controller.listen('paste', collapse, { capture: true }))
})
