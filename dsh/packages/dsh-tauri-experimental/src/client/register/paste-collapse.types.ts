/**
 * 官方 composer 折叠粘贴所需的跨包面（结构等价，不绑定核心版本）。
 *
 * 落点随核心版本漂移：`ctx.inputTriggers.registerSource` 提供引用 chip 的模型序列化，
 * `ctx.conversation.input.for(actx)` 提供每会话的输入面，`sessions.binding().ctx` /
 * `sessions.provideInfo` 提供会话作用域与标准动作面。全部按需可选，缺失即视为不可用。
 */

export interface PasteTokenSpan {
  start: number
  end: number
  draftRev: number
}

export interface PasteInputActions {
  captureInsertion?: () => PasteTokenSpan
}

export interface PasteReferenceInsert {
  source: string
  ref: string
  label: string
  appearance?: 'session' | 'file' | 'folder'
  clipboardText: string
}

export interface PasteOccurrence {
  source?: string
  ref?: string
}

export interface PasteInputState {
  draftRev?: number
  occurrences?: readonly PasteOccurrence[]
}

export interface PasteInputStateSource {
  getSnapshot: () => PasteInputState
  subscribe: (listener: () => void) => () => void
}

export interface PasteSessionInput {
  insertReference: (reference: PasteReferenceInsert, span: PasteTokenSpan) => boolean
  /** `0.1.5-rc.x` 的动作面还没有 `captureInsertion`：壳自身的同义方法仍在（后者就是它 + draftRev）。 */
  caretSpan?: () => { start: number, end: number }
  state: PasteInputStateSource
}

export interface PasteSessionBinding {
  ctx?: unknown
}

export interface PasteSessionServices {
  list?: { getSnapshot: () => { current?: string } }
  binding?: (sessionId: string) => PasteSessionBinding | undefined
  provideInfo?: (sessionId: string) => { props?: { inputActions?: PasteInputActions } } | undefined
}

export interface PasteConversationService {
  input?: { for: (actx: unknown) => PasteSessionInput | undefined }
}

export interface PasteTriggerCodec {
  clipboardText: (ref: string) => string
  serialize: (ref: string, signal: AbortSignal) => Promise<string>
}

export interface PasteTriggerSource {
  trigger: '@'
  name: string
  showGroupTitle: boolean
  candidates: () => Promise<readonly unknown[]>
  onPick: () => undefined
  codec: PasteTriggerCodec
}

export interface PasteTriggerRegistry {
  registerSource: (source: PasteTriggerSource) => () => void
}
