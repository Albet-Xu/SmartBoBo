/**
 * host/utils/queue.test.ts — 工作区级串行队列。
 *
 * 这里守的是「同一工作区的私有仓操作绝不并发」这条不变量：index 与 refs 是共享可变状态，
 * 并发就会撞 `index.lock`。另外两条同样重要：不同工作区必须互不阻塞；队尾必须在结算后出队
 * （否则长期运行的 Host 每见一个工作区就常驻一条 Promise，无界增长）。
 */

import type { WorkspaceLock } from './lock.types'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceLockTimeoutError } from './lock'
import { createWorkspaceQueue } from './queue'

const tick = (ms = 0): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

describe('createWorkspaceQueue', () => {
  it('同一工作区的任务严格 FIFO，绝不重叠', async () => {
    const queue = createWorkspaceQueue()
    const events: string[] = []
    let inFlight = 0

    const task = (name: string, delay: number) => async (): Promise<string> => {
      inFlight += 1
      expect(inFlight).toBe(1)
      events.push(`${name}:start`)
      await tick(delay)
      events.push(`${name}:end`)
      inFlight -= 1
      return name
    }

    // 故意让先入队者更慢：若没有串行化，`b:start` 会插到 `a:end` 前面。
    const first = queue.run('ws', task('a', 20))
    const second = queue.run('ws', task('b', 1))
    const third = queue.run('ws', task('c', 1))

    expect(await Promise.all([first, second, third])).toEqual(['a', 'b', 'c'])
    expect(events).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end'])
  })

  it('不同工作区互不阻塞', async () => {
    const queue = createWorkspaceQueue()
    const order: string[] = []
    const slow = queue.run('ws-a', async () => {
      order.push('a:start')
      await tick(20)
      order.push('a:end')
    })
    const fast = queue.run('ws-b', async () => {
      order.push('b:start')
      await tick(1)
      order.push('b:end')
    })
    await Promise.all([slow, fast])
    // b 不必等 a 的 20ms。
    expect(order.indexOf('b:end')).toBeLessThan(order.indexOf('a:end'))
  })

  it('前一个任务失败不阻断后续排队者，且错误原样透出', async () => {
    const queue = createWorkspaceQueue()
    const failing = queue.run('ws', async () => {
      throw new Error('捕获失败')
    })
    const following = queue.run('ws', async () => 'ok')
    await expect(failing).rejects.toThrow('捕获失败')
    await expect(following).resolves.toBe('ok')
  })

  it('结算后队尾出队；不同工作区各自的队尾共享同一张表', async () => {
    const queue = createWorkspaceQueue()
    expect(queue.size()).toBe(0)
    let release = (): void => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const pending = queue.run('ws-a', async () => {
      await gate
      return 1
    })
    queue.run('ws-b', async () => 2)
    // 队尾表在任务在飞时持有 2 条（a 卡在 gate 上，b 已结算并出队）。
    await tick(5)
    expect(queue.size()).toBe(1)

    const queuedBehind = queue.run('ws-a', async () => 3)
    expect(queue.size()).toBe(1)

    release()
    await expect(pending).resolves.toBe(1)
    await expect(queuedBehind).resolves.toBe(3)
    await tick(5)
    // 全部结算后必须归零：常驻队尾就是泄漏。
    expect(queue.size()).toBe(0)
  })

  it('任务返回值与队列诊断互不干扰', async () => {
    interface Payload { ok: boolean }
    const queue = createWorkspaceQueue()
    const value: Payload = await queue.run('ws', async () => ({ ok: true }))
    expect(value).toEqual({ ok: true })
    await tick(5)
    expect(queue.size()).toBe(0)
  })
})

describe('createWorkspaceQueue — 跨进程锁与等待截止', () => {
  it('每个任务都包在锁内执行：获取 → 任务 → 释放', async () => {
    const events: string[] = []
    const lock: WorkspaceLock = {
      async run<T>(key: string, task: () => Promise<T>): Promise<T> {
        events.push(`acquire:${key}`)
        try {
          return await task()
        }
        finally {
          events.push(`release:${key}`)
        }
      },
      lockPath: (key: string) => key,
    }

    const queue = createWorkspaceQueue({ lock })
    await queue.run('ws', async () => {
      events.push('task')
    })

    expect(events).toEqual(['acquire:ws', 'task', 'release:ws'])
  })

  it('把本次的跨进程等待上限透传给锁（缺省时传 undefined，由锁用自己的默认值）', async () => {
    const seen: Array<number | undefined> = []
    const lock: WorkspaceLock = {
      async run<T>(_key: string, task: () => Promise<T>, lockTimeoutMs?: number): Promise<T> {
        seen.push(lockTimeoutMs)
        return task()
      },
      lockPath: (key: string) => key,
    }

    const queue = createWorkspaceQueue({ lock })
    await queue.run('ws', async () => 'a', 250)
    await queue.run('ws', async () => 'b')

    expect(seen).toEqual([250, undefined])
  })

  it('锁获取失败：错误原样透出，且不阻断后续排队者', async () => {
    let calls = 0
    const lock: WorkspaceLock = {
      async run<T>(key: string, task: () => Promise<T>): Promise<T> {
        calls += 1
        if (calls === 1)
          throw new WorkspaceLockTimeoutError(`workspace lock not acquired (key=${key})`)
        return task()
      },
      lockPath: (key: string) => key,
    }

    const queue = createWorkspaceQueue({ lock })
    await expect(queue.run('ws', async () => 'never')).rejects.toBeInstanceOf(WorkspaceLockTimeoutError)
    await expect(queue.run('ws', async () => 'ok')).resolves.toBe('ok')
    await tick(5)
    expect(queue.size()).toBe(0)
  })

  it('队内等待耗时从传给跨进程锁的剩余预算扣除', async () => {
    vi.useFakeTimers()
    try {
      const timeouts: Array<number | undefined> = []
      const lock: WorkspaceLock = {
        lockPath: key => key,
        async run<T>(_key: string, task: () => Promise<T>, timeout?: number): Promise<T> {
          timeouts.push(timeout)
          return task()
        },
      }
      const queue = createWorkspaceQueue({ lock })
      const first = queue.run('ws', () => tick(12))
      const barrier = queue.run('ws', async () => 'ok', 20, { waitDeadline: Date.now() + 20 })
      await vi.advanceTimersByTimeAsync(12)
      await Promise.all([first, barrier])
      // deadline 从入队前起算：队头的 12ms 排队被扣除，锁只拿到剩余 8ms。
      expect(timeouts).toEqual([undefined, 8])
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('截止时间只取消尚未开始的任务：队头被占用时调用者按时返回，任务永不执行', async () => {
    const lock: WorkspaceLock = { lockPath: key => key, run: async (_key, task) => task() }
    const queue = createWorkspaceQueue({ lock })
    let releaseHead: () => void = () => {}
    const head = queue.run('ws', () => new Promise<void>((resolve) => {
      releaseHead = resolve
    }))
    await tick(5)

    const started: string[] = []
    const barrier = queue.run('ws', async () => {
      started.push('before')
    }, 20, { waitDeadline: Date.now() + 20 })
    await expect(barrier).rejects.toBeInstanceOf(WorkspaceLockTimeoutError)
    expect(started).toEqual([])

    // 取消是永久的：真正轮到它时也不能执行（否则迟到的 before 会拍到模型改动）。
    releaseHead()
    await head
    await tick(10)
    expect(started).toEqual([])
  })

  it('迟到拿锁也不能执行任务：预算过期后即使锁就位也只释放', async () => {
    const events: string[] = []
    let releaseAcquire: () => void = () => {}
    const lock: WorkspaceLock = {
      lockPath: key => key,
      run: <T>(_key: string, task: () => Promise<T>): Promise<T> => {
        events.push('acquire')
        return new Promise<T>((resolve, reject) => {
          // startTask 在预算过期后会同步抛错：延后一步让它变成拒绝，而不是砸进测试。
          releaseAcquire = () => Promise.resolve().then(task).then(resolve, reject)
        })
      },
    }
    const queue = createWorkspaceQueue({ lock })
    const attempt = queue.run('ws', async () => {
      events.push('task')
    }, 5000, { waitDeadline: Date.now() + 30 })

    await tick(10)
    // 锁获取还在飞（模拟「邻居刚好释放」前的一瞬），deadline 先到：调用者拿到超时。
    await expect(attempt).rejects.toBeInstanceOf(WorkspaceLockTimeoutError)
    releaseAcquire()
    await tick(10)
    expect(events).toEqual(['acquire'])
    await tick(5)
    expect(queue.size()).toBe(0)
  })

  it('已开始的任务完整执行：执行开始后等待预算不再生效', async () => {
    const events: string[] = []
    const lock: WorkspaceLock = {
      async run<T>(_key: string, task: () => Promise<T>): Promise<T> {
        events.push('acquire')
        try {
          return await task()
        }
        finally {
          events.push('release')
        }
      },
      lockPath: key => key,
    }
    const queue = createWorkspaceQueue({ lock })
    const started = Date.now()
    const slow = queue.run('ws', async () => {
      events.push('task:start')
      await tick(60)
      events.push('task:end')
      return 'done'
    }, 1000, { waitDeadline: Date.now() + 20 })

    // 任务在预算内开始：一旦开始就必须完整等待——绝不半途放弃 git，也绝不让屏障
    // 在 before 快照执行中放行（否则模型改动会混进基线）。
    await expect(slow).resolves.toBe('done')
    // `tick(60)` 的实测耗时在 60ms 边界上抖动（CI 上出现过 59），断言落在
    // 「明显超过 20ms 的等待预算、即任务被完整执行」而不是卡死 60 这个数字。
    expect(Date.now() - started).toBeGreaterThanOrEqual(50)
    expect(events).toEqual(['acquire', 'task:start', 'task:end', 'release'])
    await tick(5)
    expect(queue.size()).toBe(0)
  })
})
