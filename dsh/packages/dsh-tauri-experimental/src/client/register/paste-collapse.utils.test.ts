import { describe, expect, it } from 'vitest'
import {
  clipboardFileCount,
  isCollapsiblePaste,
  livePasteRefs,
  pasteChipTitle,
  resolveInsertionSpan,
  stalePasteRefs,
} from './paste-collapse.utils'

describe('isCollapsiblePaste', () => {
  it('恰好 500 字的粘贴不折叠：阈值是「超过」', () => {
    expect(isCollapsiblePaste({ text: 'x'.repeat(500), fileCount: 0 })).toBe(false)
  })

  it('501 字的粘贴折叠', () => {
    expect(isCollapsiblePaste({ text: 'x'.repeat(501), fileCount: 0 })).toBe(true)
  })

  it('带文件的粘贴一律不折叠，文件入草稿留给官方路径', () => {
    expect(isCollapsiblePaste({ text: 'x'.repeat(501), fileCount: 1 })).toBe(false)
  })
})

describe('clipboardFileCount', () => {
  it('只数 kind=file 的剪贴板条目', () => {
    const clipboard = { items: [{ kind: 'file' }, { kind: 'string' }, { kind: 'file' }] } as unknown as DataTransfer

    expect(clipboardFileCount(clipboard)).toBe(2)
  })

  it('无文件条目时报 0', () => {
    expect(clipboardFileCount({ items: [] } as unknown as DataTransfer)).toBe(0)
  })
})

describe('pasteChipTitle', () => {
  it('取首个非空行并折叠行内空白', () => {
    expect(pasteChipTitle('\n\n  ###  环境信息 \tapp \n更多')).toBe('### 环境信息 app')
  })

  it('超过 24 字截断并补省略号', () => {
    expect(pasteChipTitle('a'.repeat(30))).toBe(`${'a'.repeat(24)}…`)
  })

  it('整段没有可见字符时返回空串，由调用方改用与首行无关的文案', () => {
    expect(pasteChipTitle('   \n\t\n')).toBe('')
  })
})

describe('livePasteRefs', () => {
  it('只收本插件引用源且带 ref 的 occurrence', () => {
    const refs = livePasteRefs([
      { source: 'dsh-tauri-experimental-paste', ref: 'a' },
      { source: 'files', ref: 'b' },
      { source: 'dsh-tauri-experimental-paste' },
    ], 'dsh-tauri-experimental-paste')

    expect([...refs]).toEqual(['a'])
  })

  it('草稿投影尚未发布（occurrences 缺席）时视为没有引用', () => {
    expect(livePasteRefs(undefined, 'dsh-tauri-experimental-paste').size).toBe(0)
  })
})

describe('stalePasteRefs', () => {
  it('过了宽限期且不再被引用的 ref 回收', () => {
    const stash = new Map([['a', { at: 0 }], ['b', { at: 1500 }]])

    expect(stalePasteRefs(stash, new Set(), 2000, 2000)).toEqual(['a'])
  })

  it('宽限期内不回收：草稿投影晚于 chip 插入发布', () => {
    const stash = new Map([['a', { at: 1000 }]])

    expect(stalePasteRefs(stash, new Set(), 2000, 2000)).toEqual([])
  })

  it('仍被草稿引用的 ref 不回收', () => {
    const stash = new Map([['a', { at: 0 }]])

    expect(stalePasteRefs(stash, new Set(['a']), 60_000, 2000)).toEqual([])
  })
})

describe('resolveInsertionSpan', () => {
  it('动作面提供 captureInsertion 时直接用它的快照', () => {
    const span = { start: 4, end: 4, draftRev: 9 }

    expect(resolveInsertionSpan({ captureInsertion: () => span }, sessionInput())).toBe(span)
  })

  it('动作面没有 captureInsertion（0.1.5-rc.x）时退回 caretSpan + state.draftRev，组成同形快照', () => {
    const input = sessionInput({ caret: { start: 2, end: 5 }, draftRev: 12 })

    expect(resolveInsertionSpan({}, input)).toEqual({ start: 2, end: 5, draftRev: 12 })
  })

  it('两条通路都缺席时返回 undefined，由调用方退回官方粘贴', () => {
    expect(resolveInsertionSpan(undefined, sessionInput())).toBeUndefined()
  })
})

function sessionInput(options: { caret?: { start: number, end: number }, draftRev?: number } = {}) {
  return {
    insertReference: () => true,
    ...(options.caret === undefined ? {} : { caretSpan: () => options.caret! }),
    state: { getSnapshot: () => ({ occurrences: [], ...options.draftRev === undefined ? {} : { draftRev: options.draftRev } }), subscribe: () => () => {} },
  }
}
