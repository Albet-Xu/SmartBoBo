import { afterEach, describe, expect, it } from 'vitest'
import { activeQueues, toast } from '../src/utils/toast'

interface StatelyQueueProbe {
  queue: Array<{ key: string, content?: Record<string, unknown> }>
  visibleToasts: unknown[]
}

function probe(): StatelyQueueProbe {
  return activeQueues['bottom end'].getQueue() as unknown as StatelyQueueProbe
}

function entryOf(key: string) {
  return probe().queue.find(item => item.key === key)
}

afterEach(() => {
  toast.clear()
})

describe('toast.update', () => {
  it('writes the update through to the queue entry so the default bubble re-renders', () => {
    const key = toast('正在升级 aaa...', { timeout: 0 })
    const visibleBefore = probe().visibleToasts

    expect(entryOf(key)?.content).toMatchObject({ title: '正在升级 aaa...' })

    toast.update(key, { title: '正在升级 2 个插件...', isLoading: true, description: 'added 1 package' })

    expect(entryOf(key)?.content).toMatchObject({
      title: '正在升级 2 个插件...',
      isLoading: true,
      description: 'added 1 package',
    })
    expect(probe().visibleToasts).not.toBe(visibleBefore)
  })

  it('ignores keys that were already closed', () => {
    const key = toast('x', { timeout: 0 })
    toast.close(key)

    expect(() => toast.update(key, { description: 'late line' })).not.toThrow()
    expect(entryOf(key)).toBeUndefined()
  })

  it('reports evicted keys as inactive so callers can rebuild the bubble', () => {
    const oldest = toast('1', { timeout: 0 })
    const kept = [toast('2', { timeout: 0 }), toast('3', { timeout: 0 })]
    expect(toast.isActive(oldest)).toBe(true)

    const newest = toast('4', { timeout: 0 })

    expect(toast.isActive(oldest)).toBe(false)
    expect(kept.every(key => toast.isActive(key))).toBe(true)
    expect(toast.isActive(newest)).toBe(true)

    const before = entryOf(oldest)
    toast.update(oldest, { description: 'late line' })
    expect(entryOf(oldest)).toBe(before)
    expect(entryOf(oldest)?.content?.description).toBeUndefined()
  })
})
