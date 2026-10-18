import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function panel(): string {
  return readFileSync(new URL('../src/ui/config/plugin.tsx', import.meta.url), 'utf8')
}

describe('plugin panel per-row actions', () => {
  it('tracks in-flight actions per row instead of one global busy slot', () => {
    const source = panel()

    expect(source).toContain('const [busy, setBusy] = useState<string[]>([])')
    expect(source).toContain('function rowBusy(id: string): boolean')
    expect(source).toContain('function busyWith(id: string, action: string): boolean')
    expect(source).toContain('function markBusy(id: string, action: string): void')
    expect(source).toContain('function clearBusy(id: string, action: string): void')
    // 单槽 busy 会把所有行一起置灰，后续点击无法再入队
    expect(source).not.toContain('setBusy(null)')
    expect(source).not.toContain('setBusy({ id, action')
  })

  it('greys out and spins only the row that owns the action', () => {
    const source = panel()

    expect(source.match(/actionChip\(\{ busy: rowBusy\(plugin\.id\) \}\)/g)).toHaveLength(7)
    expect(source).not.toContain('actionChip({ busy: !!busy })')
    expect(source).toContain('<If cond={busyWith(plugin.id, \'update\')}')
    expect(source).toContain('<If cond={busyWith(plugin.id, \'remove\')}')
  })

  it('keeps the manager action union required by the disable/enable contract', () => {
    expect(panel()).toContain('action: \'update\' | \'remove\' | \'disable\' | \'enable\'')
  })

  it('guards every row handler with rowBusy(id)', () => {
    const source = panel()

    for (const handler of ['onRemove', 'onEnable', 'onSnapshot', 'onRestore', 'onDeleteSnapshot']) {
      const block = source.match(new RegExp(`async function ${handler}\\([\\s\\S]*?\\n {2}\\}`))
      expect(block).not.toBeNull()
      expect(block![0]).toContain('if (rowBusy(id))')
    }
  })
})
