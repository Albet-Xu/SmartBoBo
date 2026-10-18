/**
 * host/utils/queue.ts — 工作区级串行的纯工厂：进程内 FIFO + 跨进程内核锁。
 *
 * 私有快照仓的 index 与 refs 是每个工作区共享的可变状态：捕获、结算、运行中实时读数
 * 与容量治理都在动同一份 index，任何两件并发就会撞 `index.lock` 或读到半更新的
 * index。两道闸门各解决一半，缺一不可：
 *   1. **进程内 FIFO**（本文件）：同一进程的任务按提交顺序串行。顺序是**先排队再拿锁**——
 *      反过来会让同一条道里的下一个任务去跟自己人争跨进程锁，白烧掉等待预算；
 *   2. **跨进程内核锁**（utils/lock.ts）：同一个 `DSH_HOME` 下可能同时有多个宿主进程
 *      （桌面端重启交叠、用户手动再起的 `dsh web`、离线维护脚本），内存队列对它们无效。
 *
 * 等待上限（`lockTimeoutMs`）只约束**跨进程锁**那一段；`options.waitDeadline` 是绝对
 * 截止时间（Date.now 毫秒），从**入队前**开始覆盖进程内排队与锁竞争。
 * 屏障的治理与 before 合为一个任务；到期只取消**尚未开始**的任务：
 * 已开始的 git 必须完整等待，绝不在执行中超时放行屏障，否则迟到的 before 会把模型
 * 已经改过的文件拍成错误基线。
 *
 * 队尾在结算后立即出队：否则每见过一个工作区就常驻一条 Promise，长期运行会无界增长。
 * 队尾守卫跟随真实操作（含迟到的锁释放），而不是跟随调用方拿到的 Promise.race。
 */

import type { WorkspaceLock } from './lock.types'
import { WorkspaceLockTimeoutError } from './lock'

/** 单次任务的等待策略；执行开始后不再受等待预算约束。 */
export interface WorkspaceQueueRunOptions {
  /** 绝对截止时间（Date.now 毫秒）：覆盖进程内排队与跨进程锁等待，可供多个阶段共用。 */
  waitDeadline?: number
}

/** 工作区级串行队列。 */
export interface WorkspaceQueue {
  /**
   * 在指定工作区的串行区内执行任务（拒绝原样透出）。
   * @param key - 工作区键。
   * @param task - 要执行的异步任务。
   * @param lockTimeoutMs - 本次获取**跨进程锁**的等待上限（毫秒）；缺省用锁的默认值。
   * @param options - 跨阶段共享等待截止时间；超时后未开始的任务永不执行，已开始的任务完整等待。
   */
  run: <T>(key: string, task: () => Promise<T>, lockTimeoutMs?: number, options?: WorkspaceQueueRunOptions) => Promise<T>
  /** 当前仍在排队/在飞的工作区数（诊断与测试用）。 */
  size: () => number
}

/** 队列选项。 */
export interface WorkspaceQueueOptions {
  /**
   * 跨进程锁（见 utils/lock.ts）。只要同一个 `DSH_HOME` 下可能出现第二个宿主进程就必须传：
   * 只靠进程内队列，两个进程会并发动同一份私有仓的 index 与 refs。
   * 缺省（省略）时只做进程内串行。
   */
  lock?: WorkspaceLock | undefined
}

export function createWorkspaceQueue(options: WorkspaceQueueOptions = {}): WorkspaceQueue {
  const lock = options.lock
  const tails = new Map<string, Promise<unknown>>()
  return {
    run<T>(key: string, task: () => Promise<T>, lockTimeoutMs?: number, runOptions: WorkspaceQueueRunOptions = {}): Promise<T> {
      const previous = tails.get(key) ?? Promise.resolve()
      const deadline = runOptions.waitDeadline
      let cancelled = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeoutError = (): WorkspaceLockTimeoutError =>
        new WorkspaceLockTimeoutError(`workspace wait deadline exceeded (key=${key})`)
      const clearTimer = (): void => {
        if (timer !== undefined)
          clearTimeout(timer)
      }
      const assertWaiting = (): void => {
        if (cancelled || (deadline !== undefined && Date.now() >= deadline)) {
          cancelled = true
          throw timeoutError()
        }
      }
      const startTask = (): Promise<T> => {
        // 定时器只能放弃等待，不能让排在队内或迟到拿锁的任务在等待预算过期后执行。
        assertWaiting()
        clearTimer()
        // 一旦开始执行，就必须等其完成及锁释放；绝不在执行中超时放行屏障。
        return task()
      }
      // 调用者可以提前结束等待，但队尾必须跟随真实操作（含迟到的锁释放），不能跟随 race。
      const settled = previous.then(async (): Promise<T> => {
        assertWaiting()
        if (lock === undefined)
          return startTask()
        let remaining = lockTimeoutMs
        if (deadline !== undefined) {
          remaining = Math.min(lockTimeoutMs ?? Number.POSITIVE_INFINITY, deadline - Date.now())
          if (remaining <= 0)
            throw timeoutError()
        }
        return lock.run(key, startTask, remaining)
      })
      const guard = settled.then(() => undefined, () => undefined)
      tails.set(key, guard)
      void guard.then(() => {
        clearTimer()
        if (tails.get(key) === guard)
          tails.delete(key)
      })
      if (deadline === undefined)
        return settled
      const expired = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          cancelled = true
          reject(timeoutError())
        }, Math.max(0, deadline - Date.now()))
      })
      return Promise.race([settled, expired])
    },
    size: () => tails.size,
  }
}
