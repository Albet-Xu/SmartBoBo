import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { normalizeProfileId } from '@/utils/profile-id'

const PROFILE_RS = new URL('../src-tauri/src/service/profile/mod.rs', import.meta.url)

/**
 * 从 Rust 侧 `normalize_id_lowercases_and_joins` 里抽出全部
 * `assert_eq!(normalize_profile_id("X"), "Y");` 断言对。
 *
 * 归一化是前后端共享契约：前端要用它判断「版本档案是否已存在」，判错就会重复创建
 * （撞 `PROFILE_EXISTS`）或切错档案。因此这里不写死期望值，而是直接以 Rust 单测为
 * 权威来源，TS 实现必须与后端逐条一致。
 */
function rustCases(): Array<{ input: string, expected: string }> {
  const source = readFileSync(PROFILE_RS, 'utf8')
  const matches = source.matchAll(/assert_eq!\(\s*normalize_profile_id\("([^"]*)"\),\s*"([^"]*)"\s*\);/g)
  return [...matches].map(m => ({ input: m[1], expected: m[2] }))
}

describe('normalizeProfileId 与 Rust normalize_profile_id 一致', () => {
  it('保留至少 4 条 Rust 侧归一化断言（契约未被删除）', () => {
    expect(rustCases().length).toBeGreaterThanOrEqual(4)
  })

  it('逐条通过 Rust 单测的输入与期望', () => {
    for (const { input, expected } of rustCases())
      expect(normalizeProfileId(input), input).toBe(expected)
  })

  /** 版本档案名带点：后端把 `.` 丢弃（`0.17` → `017`），前端匹配 id 必须同款 */
  it('把版本号形式的档案名归一化为纯数字 id', () => {
    expect(normalizeProfileId('0.17')).toBe('017')
    expect(normalizeProfileId('0.18')).toBe('018')
    expect(normalizeProfileId('  1.0  ')).toBe('10')
  })

  it('空名与纯符号名归一化为空串', () => {
    expect(normalizeProfileId('')).toBe('')
    expect(normalizeProfileId('   ')).toBe('')
    expect(normalizeProfileId('...')).toBe('')
    expect(normalizeProfileId('-_-')).toBe('')
  })

  it('连续分隔符合并、首尾分隔符去除', () => {
    expect(normalizeProfileId('-dev--stage-')).toBe('dev-stage')
    expect(normalizeProfileId('a___b')).toBe('a-b')
    expect(normalizeProfileId('A B')).toBe('a-b')
  })
})
