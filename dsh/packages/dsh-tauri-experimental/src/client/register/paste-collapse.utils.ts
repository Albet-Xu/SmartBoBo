import type { PasteInputActions, PasteOccurrence, PasteSessionInput, PasteTokenSpan } from './paste-collapse.types'

/** 超过该字符数的粘贴折叠成引用 chip；官方路径会把整段原文灌进编辑器，长文本即「一大串文字」。 */
const PASTE_COLLAPSE_THRESHOLD = 500

/** chip 标题（粘贴内容首行）的字符上限：chip 自身还有 240px 省略，这里只保证标题可读。 */
const PASTE_TITLE_MAX_LENGTH = 24

/**
 * 取插入 chip 用的选区快照（detect 坐标 + 修订号）。
 *
 * `0.1.5-rc.x` 的动作面只有 setDraft/submit，没有 `captureInsertion`；壳自身的 `caretSpan()`
 * 仍在，而 `0.1.7` 的 `captureInsertion` 实现就是「caretSpan + draftRev」。按能力探测取用，
 * 两条通路都缺席时返回 undefined，由调用方退回官方粘贴路径。
 */
export function resolveInsertionSpan(
  actions: PasteInputActions | undefined,
  input: PasteSessionInput,
): PasteTokenSpan | undefined {
  const captured = actions?.captureInsertion?.()
  if (captured !== undefined)
    return captured
  const caret = input.caretSpan?.()
  const draftRev = input.state.getSnapshot().draftRev
  return caret === undefined || draftRev === undefined ? undefined : { ...caret, draftRev }
}

/**
 * 是否接管这次粘贴：带文件的粘贴必须让给官方路径（它负责文件入草稿），空文本同样不接管。
 */
export function isCollapsiblePaste(input: { text: string, fileCount: number }): boolean {
  return input.fileCount === 0 && input.text.length > PASTE_COLLAPSE_THRESHOLD
}

export function clipboardFileCount(clipboard: DataTransfer): number {
  let count = 0
  for (const item of clipboard.items) {
    if (item.kind === 'file')
      count += 1
  }
  return count
}

/** chip 标题取首个非空行（折叠连续空白并限长）；整段无可见字符时返回空串，由调用方退回首行无关的文案。 */
export function pasteChipTitle(text: string): string {
  const line = text.split(/\r?\n/)
    .find(part => part.trim() !== '')
    ?.replace(/\s+/g, ' ')
    .trim() ?? ''
  return line.length > PASTE_TITLE_MAX_LENGTH ? `${line.slice(0, PASTE_TITLE_MAX_LENGTH)}…` : line
}

/** 当前草稿里仍在使用本插件引用的 ref 集合（chip 被删除后即可回收其正文）。 */
export function livePasteRefs(occurrences: readonly PasteOccurrence[] | undefined, source: string): Set<string> {
  const refs = new Set<string>()
  for (const occurrence of occurrences ?? []) {
    if (occurrence.source === source && typeof occurrence.ref === 'string')
      refs.add(occurrence.ref)
  }
  return refs
}

/** 已不在草稿中、且过了插入宽限期的 ref：草稿投影晚于插入发布，宽限期内回收会把正文丢掉。 */
export function stalePasteRefs(
  stash: ReadonlyMap<string, { at: number }>,
  live: ReadonlySet<string>,
  now: number,
  graceMs: number,
): string[] {
  const stale: string[] = []
  for (const [ref, entry] of stash) {
    if (!live.has(ref) && now - entry.at >= graceMs)
      stale.push(ref)
  }
  return stale
}
