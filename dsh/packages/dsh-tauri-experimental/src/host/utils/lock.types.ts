/**
 * host/utils/lock.types.ts — 跨进程工作区锁的类型面（实现见 ./lock.ts）。
 *
 * 与进程内的 {@link WorkspaceQueue} 是两件事：队列只能串行化**本进程**里的任务，
 * 而同一个 `DSH_HOME` 下可能有多个宿主进程（桌面端重启交叠、手动再起的 `dsh web`、
 * 离线维护脚本）——它们各有一份自己的内存队列，却共用同一份私有快照仓。
 */

/** 跨进程工作区锁的构造选项（缺省值见 host/config/constants）。 */
export interface WorkspaceLockOptions {
  /** 宿主数据根目录（`DSH_HOME`）。 */
  dshHome: string
  /** 等待上限（毫秒）；超时抛 WorkspaceLockTimeoutError。 */
  timeoutMs?: number
  /** 竞争时的重试间隔（毫秒）。 */
  retryMs?: number
}

/**
 * 工作区级**跨进程**互斥锁（内核独占监听句柄，见 ./lock.ts）。
 */
export interface WorkspaceLock {
  /**
   * 在跨进程互斥区内执行任务（获取 → 执行 → 释放；失败原样透出）。
   * @param key - 工作区键。
   * @param task - 要执行的异步任务。
   * @param lockTimeoutMs - 本次获取锁的等待上限（毫秒）；缺省用构造时的 `timeoutMs`。
   *   屏障上的调用会传一个更短的值：等不到的代价只是「这一轮没有快照」，
   *   不该让它拖住用户的对话（见 host/config/constants 的 LOCK_BARRIER_TIMEOUT_MS）。
   */
  run: <T>(key: string, task: () => Promise<T>, lockTimeoutMs?: number) => Promise<T>
  /** 某个工作区的旧协议围栏目录路径（诊断与测试用，不承载内核锁所有权）。 */
  lockPath: (key: string) => string
}
