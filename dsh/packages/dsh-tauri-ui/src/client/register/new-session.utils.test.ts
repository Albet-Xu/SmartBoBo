/**
 * register/new-session.utils.test.ts — 侧边栏「新建会话」判据的回归测试。
 *
 * 锁住的契约：只有官方侧边栏那枚按钮（品牌按钮与工具栏按钮共用一条 aria-label）会被命中；
 * 官方工作区分组行的「+」用带工作区名字的文案，必须落在判据之外（分组行行为保持不变）。
 * 文案逐字取自官方词典：sidebar `session.new.label`、workspace `actions.newSession.aria`。
 */
import { describe, expect, it } from 'vitest'
import { isNewSessionLabel, isUngroupedNewSessionLabel } from './new-session.utils'

describe('isNewSessionLabel', () => {
  it('认官方侧边栏「新建会话」按钮的中英两条 aria-label', () => {
    expect(isNewSessionLabel('新建会话'), '官方中文文案').toBe(true)
    expect(isNewSessionLabel('New session'), '官方英文文案').toBe(true)
  })

  it('不认工作区分组行「+」的带名字文案', () => {
    expect(isNewSessionLabel('在“dsh-tauri-desktop”中新建会话'), '官方中文文案（含工作区名）').toBe(false)
    expect(isNewSessionLabel('New session in dsh-tauri-desktop'), '官方英文文案（含工作区名）').toBe(false)
  })

  it('不认英雄区工作区 chip 与其它按钮', () => {
    expect(isNewSessionLabel('选择工作区'), '英雄区 chip 中文').toBe(false)
    expect(isNewSessionLabel('Choose workspace'), '英雄区 chip 英文').toBe(false)
    expect(isNewSessionLabel('收起侧边栏'), '侧边栏折叠按钮').toBe(false)
  })

  it('缺 aria-label 时不命中', () => {
    expect(isNewSessionLabel(null)).toBe(false)
    expect(isNewSessionLabel('')).toBe(false)
  })
})

/**
 * ≤0.1.6 的退化判据：那两代分组行没有 `data-row-key`，只能靠官方词典里的
 * 「未分组」新建会话文案识别（0.1.7 起按行键判定，见 `new-session.test.ts`）。
 */
describe('isUngroupedNewSessionLabel', () => {
  it('认官方「未分组」分组行「+」的中英两条 aria-label', () => {
    expect(isUngroupedNewSessionLabel('在“未分组”中新建会话'), '官方中文文案').toBe(true)
    expect(isUngroupedNewSessionLabel('New session in Ungrouped'), '官方英文文案').toBe(true)
  })

  it('不认真实工作区的带名字文案与侧边栏「新建会话」', () => {
    expect(isUngroupedNewSessionLabel('在“dsh-tauri-desktop”中新建会话')).toBe(false)
    expect(isUngroupedNewSessionLabel('New session in dsh-tauri-desktop')).toBe(false)
    expect(isUngroupedNewSessionLabel('新建会话')).toBe(false)
    expect(isUngroupedNewSessionLabel('New session')).toBe(false)
  })

  it('缺 aria-label 时不命中', () => {
    expect(isUngroupedNewSessionLabel(null)).toBe(false)
    expect(isUngroupedNewSessionLabel('')).toBe(false)
  })
})
