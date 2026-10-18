import { afterEach, describe, expect, it, vi } from 'vitest'
import { activeQueues as queues, toast } from '../src/utils/toast'

afterEach(() => {
  toast.clear()
  vi.useRealTimers()
})

describe('toast lifecycle', () => {
  it('keeps persistent notifications open until explicitly closed and runs their callback', async () => {
    vi.useFakeTimers()
    const onClose = vi.fn()
    const key = toast('Update available', { timeout: 0, onClose })
    const queue = queues['bottom end']
    const notification = queue.visibleToasts.find(item => item.key === key)!

    expect(notification.timer).toBeUndefined()
    expect(notification.content).not.toHaveProperty('onClose')
    expect(notification.content).not.toHaveProperty('timeout')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(queue.visibleToasts.some(item => item.key === key)).toBe(true)

    // HeroUI 的关闭按钮直接关闭底层队列，也必须触发业务层的忽略版本回调。
    queue.close(key)
    expect(onClose).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(queue.visibleToasts.some(item => item.key === key)).toBe(false)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('expires a notification using its requested timeout', async () => {
    vi.useFakeTimers()
    const onClose = vi.fn()
    const key = toast('Update available', { timeout: 8000, onClose })
    const queue = queues['bottom end']
    const notification = queue.visibleToasts.find(item => item.key === key)!

    // 组件挂载时会启动计时，这里模拟显示后开始倒计时。
    notification.timer!.resume()
    await vi.advanceTimersByTimeAsync(7999)
    expect(queue.visibleToasts.some(item => item.key === key)).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(queue.visibleToasts.some(item => item.key === key)).toBe(false)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closes only the selected notification in its own placement', async () => {
    const onClose = vi.fn()
    const key = toast('Download complete', { placement: 'top', onClose })
    const otherKey = toast('Update available', { timeout: 0 })

    toast.close(key)
    await Promise.resolve()

    expect(queues.top.visibleToasts.some(item => item.key === key)).toBe(false)
    expect(queues['bottom end'].visibleToasts.some(item => item.key === otherKey)).toBe(true)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('never discards an actionable notification when the queue overflows', async () => {
    const keys = [1, 2, 3, 4].map(index => toast(`Authorise ${index}`, { timeout: 0, sticky: true }))
    const queue = queues['bottom end']

    // 超出可见上限的那条不能被悄悄销毁：它只是暂时不渲染，旧气泡关闭后必须复现
    // （授权按钮一旦被淘汰，用户再也点不到，队列会永远停在等待授权上）
    await Promise.resolve()
    expect(toast.isActive(keys[0])).toBe(true)

    toast.close(keys[3])
    await Promise.resolve()
    expect(queue.visibleToasts.map(item => item.key)).toEqual([keys[2], keys[1], keys[0]])
  })

  it('still evicts the oldest ordinary notification when the queue overflows', async () => {
    const onClose = vi.fn()
    const first = toast('Result 1', { timeout: 0, onClose })
    toast('Result 2', { timeout: 0 })
    toast('Result 3', { timeout: 0 })
    toast('Result 4', { timeout: 0 })

    await Promise.resolve()
    await Promise.resolve()
    expect(onClose).toHaveBeenCalledWith('evicted')
    expect(toast.isActive(first)).toBe(false)
  })
})
