/**
 * host/utils/lock.ts — 操作系统持有的工作区级跨进程互斥。
 *
 * 不通过「读旧锁 → rename/unlink」接管共享锁位：两次调用之间它可能已属于新持有者（这是
 * 旧文件锁协议被审查确认的互斥漏洞）。每个 (canonical DSH_HOME, workspace) 确定性映射到
 * 一个 IPv4 loopback TCP 端口，只有 `listen` 成功才能执行任务，整个任务完成后才 close。
 * 进程退出由内核释放句柄，不猜 PID、不抢活锁；`exclusive` 禁止 cluster 共享句柄，
 * 不启用 reusePort，也绝不尝试备用端口。端口映射变更须先停止全部旧宿主，禁止新旧映射混跑。
 *
 * 哈希碰撞或外部程序占用端口只会额外串行/报忙，不会同时放行。要求同机同网络命名空间；
 * 不支持多个容器/WSL 网络命名空间或多台机器共用同一份快照仓。宿主崩溃后的孤儿 Git
 * 不由本层监管：重启前须确认旧写者已退出，不能把句柄回收当成进程树终止。
 *
 * `locks/<hash>.lock/` 是永久空目录，仅阻止旧版单文件协议创建锁，不承载新协议的所有权。
 * 旧文件（含死 PID/空文件/半截 JSON）不自动删除；升级须停止所有旧宿主，残骸只能离线人工清除。
 */

import type { Server } from 'node:net'
import type { WorkspaceLock, WorkspaceLockOptions } from './lock.types'
import { createHash } from 'node:crypto'
import { mkdir, realpath } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'pathe'
import {
  LOCK_DIR_NAME,
  LOCK_RETRY_INTERVAL_MS,
  LOCK_WAIT_TIMEOUT_MS,
  REASON_WORKSPACE_BUSY,
  SNAPSHOT_FEATURE_DIR,
} from '../config/constants'
import { workspaceHash, workspaceKey } from './workspace'

/** 等待超时：捕获据此如实记不可用；屏障据此取消尚未开始的快照。 */
export class WorkspaceLockTimeoutError extends Error {
  /** 线协议原因码（客户端据此给文案）。 */
  readonly reason = REASON_WORKSPACE_BUSY

  constructor(message: string) {
    super(message)
    this.name = 'WorkspaceLockTimeoutError'
  }
}

/** 固定映射是协议的一部分：碰撞只能等待，不能换端口（换了就不再互斥）。 */
export function workspaceLockPort(dshHome: string, key: string): number {
  const identity = JSON.stringify([workspaceKey(dshHome), workspaceKey(key)])
  const hash = createHash('sha256').update(identity).digest().readUInt32BE(0)
  // 低于 Linux/Windows 默认动态端口范围；自定义范围或其他监听者仍可能占用，按忙处理。
  return 20000 + hash % 10000
}

/** 监听成功后的异步错误延迟到 task 完成后处理，不能提前释放正在工作的句柄。 */
const listenerErrors = new WeakMap<Server, Error>()

/** 一次内核原子竞争。监听连接立刻销毁，避免 close 等待外部连接而无法释放。 */
async function tryListen(port: number): Promise<Server | null> {
  const server = createServer((socket) => {
    socket.on('error', () => {})
    socket.destroy()
  })
  return new Promise<Server | null>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException): void => {
      if (error.code === 'EADDRINUSE')
        resolve(null)
      else
        reject(error)
    }
    server.once('error', onError)
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.removeListener('error', onError)
      server.on('error', (error) => {
        listenerErrors.set(server, error)
      })
      resolve(server)
    })
  })
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
  })
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** 同一进程的多个实例也各自竞争内核句柄，不共享所有权。 */
export function createWorkspaceLock(options: WorkspaceLockOptions): WorkspaceLock {
  const timeoutMs = options.timeoutMs ?? LOCK_WAIT_TIMEOUT_MS
  const retryMs = options.retryMs ?? LOCK_RETRY_INTERVAL_MS
  const lockPath = (key: string): string =>
    join(options.dshHome, SNAPSHOT_FEATURE_DIR, LOCK_DIR_NAME, `${workspaceHash(key)}.lock`)

  async function acquire(key: string, waitMs: number): Promise<Server> {
    const deadline = Date.now() + Math.max(0, waitMs)
    // 必须先创建并严格解析数据目录：不存在的 symlink 子路径会从词法路径变成真实路径，
    // 若先散列再 mkdir，同一个 options 字符串在首次获取前后也会映射到两个端口。
    await mkdir(options.dshHome, { recursive: true })
    const canonicalHome = await realpath(options.dshHome)
    const port = workspaceLockPort(canonicalHome, key)
    const timeout = (): WorkspaceLockTimeoutError =>
      new WorkspaceLockTimeoutError(`workspace lock not acquired after ${waitMs}ms (key=${key}, port=${port})`)
    for (;;) {
      if (Date.now() >= deadline)
        throw timeout()
      const server = await tryListen(port)
      if (server !== null) {
        try {
          // 不覆盖旧版文件锁。旧宿主释放文件后可建目录；死文件需离线人工迁移。
          await mkdir(lockPath(key), { recursive: true })
          if (Date.now() >= deadline)
            throw timeout()
          return server
        }
        catch (error) {
          await closeServer(server)
          const code = (error as NodeJS.ErrnoException)?.code
          if (code !== 'EEXIST' && code !== 'ENOTDIR')
            throw error
        }
      }
      const remaining = deadline - Date.now()
      if (remaining <= 0)
        throw timeout()
      await delay(Math.min(Math.max(1, retryMs), remaining))
    }
  }

  return {
    async run<T>(key: string, task: () => Promise<T>, lockTimeoutMs?: number): Promise<T> {
      const server = await acquire(key, lockTimeoutMs ?? timeoutMs)
      try {
        const result = await task()
        const error = listenerErrors.get(server)
        if (error !== undefined)
          throw error
        return result
      }
      finally {
        // 只关闭自己的内核句柄，没有会误删新持有者锁位的读改写窗口。
        await closeServer(server)
      }
    },
    lockPath,
  }
}
