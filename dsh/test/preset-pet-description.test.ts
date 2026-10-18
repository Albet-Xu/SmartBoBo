import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('built-in pet descriptions', () => {
  it('describes Maid DeepSeek Whale with the approved Chinese copy', () => {
    const source = readFileSync(new URL('../src-tauri/resources/manifest.jsonc', import.meta.url), 'utf8')
    const manifest = JSON.parse(source.replace(/^\s*\/\/.*$/gm, '')) as {
      pets: { 'built-in': { id: string, desc?: string }[] }
    }
    const pet = manifest.pets['built-in'].find(entry => entry.id === 'maid-deepseek-whale')

    expect(pet?.desc).toBe('一只小小的迷你蓝头发的鲸鱼女仆，穿着海军蓝裙子，白色褶边，蓝眼睛，侧鳍和鲸鱼尾巴。')
  })
})
