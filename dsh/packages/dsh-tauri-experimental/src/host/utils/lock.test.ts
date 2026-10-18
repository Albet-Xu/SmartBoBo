/**
 * host/utils/lock.test.ts — 内核独占工作区锁的契约，含真实独立 Node 进程竞争。
 *
 * 三条不变量：**互斥**（任意时刻只有一个持有者，跨进程成立）、**自愈**（持有者被强杀后
 * 内核释放句柄，等待者能继续）、**不误放**（外部占用端口/旧文件锁一律 fail-closed，
 * 绝不换端口、绝不自动清理）。互斥用独立进程 + `wx` 独占守卫文件验证，单事件循环里的
 * 多个锁实例无法交错同步系统调用，覆盖不到真实的调度窗口。
 */
import type { ChildProcess } from 'node:child_process'
import type { WorkspaceLock } from './lock.types'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { createServer, Server } from 'node:net'
import { tmpdir } from 'node:os'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'pathe'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { REASON_WORKSPACE_BUSY } from '../config/constants'
import { createWorkspaceLock, workspaceLockPort, WorkspaceLockTimeoutError } from './lock'

const temporaryDirectories: string[] = []
const repositoryRoot = fileURLToPath(new URL('../../../../../', import.meta.url))
const workerFile = fileURLToPath(new URL('./fixtures/lock-worker.ts', import.meta.url))
const tick = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-running-changes-lock-'))
  temporaryDirectories.push(root)
  const dshHome = join(root, 'home')
  await mkdir(dshHome, { recursive: true })
  return dshHome
}

afterEach(async () => {
  while (temporaryDirectories.length > 0)
    await rm(temporaryDirectories.pop()!, { recursive: true, force: true })
})

function lockFor(dshHome: string, timeoutMs = 2000): WorkspaceLock {
  return createWorkspaceLock({ dshHome, timeoutMs, retryMs: 5 })
}

function nonCollidingKey(home: string, first: string): string {
  const port = workspaceLockPort(home, first)
  for (let index = 0; index < 1000; index += 1) {
    const candidate = `${first}-parallel-${index}`
    if (workspaceLockPort(home, candidate) !== port)
      return candidate
  }
  throw new Error('could not select a non-colliding workspace key')
}

function gate(): { wait: Promise<void>, open: () => void } {
  let open: () => void = () => {}
  const wait = new Promise<void>((resolve) => {
    open = resolve
  })
  return { wait, open }
}

/** Always release and collect the holder, including on assertion failure. */
async function withHeld(lock: WorkspaceLock, key: string, test: () => Promise<void>): Promise<void> {
  const entered = gate()
  const release = gate()
  const holding = lock.run(key, async () => {
    entered.open()
    await release.wait
  })
  try {
    await Promise.race([entered.wait, holding])
    await test()
  }
  finally {
    release.open()
    await holding
  }
}

interface WorkerMessage {
  type: string
  round?: number
  pid?: number
  port?: number
  name?: string
  reason?: string
  code?: string
  message?: string
}

/** Buffered IPC avoids missing messages delivered before a test installs its waiter. */
class LockWorker {
  readonly child: ChildProcess
  readonly messages: WorkerMessage[] = []
  readonly closed: Promise<void>
  private readonly listeners = new Set<() => void>()
  private output = ''
  private ended = false
  private spawnError: Error | undefined

  constructor(dshHome: string, key: string, guardPath?: string) {
    this.child = spawn(process.execPath, ['--import', 'tsx', workerFile, dshHome, key, ...(guardPath ? [guardPath] : [])], {
      cwd: repositoryRoot,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
    })
    this.child.stdout!.on('data', (chunk) => {
      this.output += String(chunk)
    })
    this.child.stderr!.on('data', (chunk) => {
      this.output += String(chunk)
    })
    this.child.on('message', (message) => {
      this.messages.push(message as WorkerMessage)
      this.notify()
    })
    this.child.on('error', (error) => {
      this.spawnError = error
      this.notify()
    })
    this.closed = new Promise((resolve) => {
      this.child.once('close', () => {
        this.ended = true
        this.notify()
        resolve()
      })
    })
  }

  private notify(): void {
    for (const listener of [...this.listeners])
      listener()
  }

  wait(type: string, round?: number): Promise<WorkerMessage> {
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>
      let check: () => void
      const finish = (error?: Error, message?: WorkerMessage): void => {
        clearTimeout(timer)
        this.listeners.delete(check)
        if (error)
          reject(error)
        else
          resolve(message!)
      }
      check = (): void => {
        const message = this.messages.find(item => item.type === type && item.round === round)
        const failure = this.messages.find(item => item.type === 'failed' && item.round === round)
        if (message)
          finish(undefined, message)
        else if (failure || this.spawnError || this.ended)
          finish(new Error(`worker ${this.child.pid}: ${JSON.stringify(failure ?? this.spawnError ?? 'exited')}\n${this.output}`))
      }
      timer = setTimeout(() => finish(new Error(`worker ${this.child.pid} waiting for ${type}/${round}\n${this.output}\n${JSON.stringify(this.messages)}`)), 15_000)
      this.listeners.add(check)
      check()
    })
  }

  send(type: 'start' | 'release', round: number, timeoutMs?: number): void {
    this.child.send({ type, round, timeoutMs })
  }

  async stop(): Promise<void> {
    if (!this.ended)
      this.child.kill('SIGKILL')
    await this.closed
  }
}

async function withWorkers(
  specs: { home: string, key: string, guard?: string }[],
  test: (workers: LockWorker[]) => Promise<void>,
): Promise<void> {
  const workers: LockWorker[] = []
  try {
    for (const spec of specs)
      workers.push(new LockWorker(spec.home, spec.key, spec.guard))
    await Promise.all(workers.map(worker => worker.wait('ready')))
    expect(new Set(workers.map(worker => worker.child.pid)).size).toBe(workers.length)
    expect(workers.every(worker => worker.child.pid !== process.pid)).toBe(true)
    await test(workers)
  }
  finally {
    // Do not remove temp directories until all children and their piped stdio close.
    await Promise.all(workers.map(worker => worker.stop()))
  }
}

describe('createWorkspaceLock — public contract', () => {
  it('same workspace serializes independent lock instances', async () => {
    const home = await fixture()
    const first = lockFor(home)
    const second = lockFor(home)
    let entered = false
    let waiting: Promise<void> | undefined
    try {
      await withHeld(first, 'C:/repo', async () => {
        waiting = second.run('C:/repo', async () => {
          entered = true
        })
        await tick(60)
        expect(entered).toBe(false)
      })
      await waiting
      expect(entered).toBe(true)
    }
    finally {
      await waiting
    }
  })

  it('different workspace keys can enter before the holder releases', async () => {
    const home = await fixture()
    const lock = lockFor(home)
    const first = 'C:/repo-a'
    const second = nonCollidingKey(home, first)
    expect(workspaceLockPort(home, first)).not.toBe(workspaceLockPort(home, second))
    await withHeld(lock, first, async () => {
      await expect(lock.run(second, async () => 'parallel')).resolves.toBe('parallel')
    })
  })

  it('timeout preserves WorkspaceLockTimeoutError and the busy reason', async () => {
    const home = await fixture()
    await withHeld(lockFor(home), 'C:/repo', async () => {
      let entered = false
      const failure = lockFor(home, 80).run('C:/repo', async () => {
        entered = true
      })
      await expect(failure).rejects.toBeInstanceOf(WorkspaceLockTimeoutError)
      await expect(failure).rejects.toMatchObject({ name: 'WorkspaceLockTimeoutError', reason: REASON_WORKSPACE_BUSY })
      expect(entered).toBe(false)
    })
  })

  it('per-call timeout overrides the default without changing subsequent calls', async () => {
    const home = await fixture()
    const late = lockFor(home, 5000)
    await withHeld(lockFor(home), 'C:/repo', async () => {
      const started = Date.now()
      await expect(late.run('C:/repo', async () => 'never', 80)).rejects.toBeInstanceOf(WorkspaceLockTimeoutError)
      expect(Date.now() - started).toBeLessThan(1500)
    })
    await expect(late.run('C:/repo', async () => 'ok')).resolves.toBe('ok')
  })

  it('throwing tasks release the kernel handle, but retain the empty fence directory', async () => {
    const home = await fixture()
    const lock = lockFor(home)
    const failure = new Error('capture failed')
    await expect(lock.run('C:/repo', async () => {
      throw failure
    })).rejects.toBe(failure)
    await expect(lockFor(home).run('C:/repo', async () => 'ok')).resolves.toBe('ok')
    expect((await stat(lock.lockPath('C:/repo'))).isDirectory()).toBe(true)
    expect(await readdir(lock.lockPath('C:/repo'))).toEqual([])
  })
})

describe('createWorkspaceLock — legacy fencing and diagnostics', () => {
  it.each([
    ['live pid', JSON.stringify({ pid: process.pid, token: 'live', acquiredAt: 1 })],
    ['dead pid', JSON.stringify({ pid: 2147483647, token: 'dead', acquiredAt: 1 })],
    ['empty file', ''],
    ['partial JSON', '{"pid": 4242, "token": "cut-of'],
  ])('%s is fail-closed and untouched until explicitly removed', async (_name, content) => {
    const home = await fixture()
    const lock = lockFor(home, 80)
    const path = lock.lockPath('C:/repo')
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content)
    let entered = false
    await expect(lock.run('C:/repo', async () => {
      entered = true
    })).rejects.toBeInstanceOf(WorkspaceLockTimeoutError)
    expect(entered).toBe(false)
    expect((await stat(path)).isFile()).toBe(true)
    expect(await readFile(path, 'utf8')).toBe(content)
    expect(await readdir(dirname(path))).toEqual([path.split('/').at(-1)])

    // This is an explicit offline migration, never an automatic PID/token takeover.
    await rm(path)
    await expect(lockFor(home).run('C:/repo', async () => 'migrated')).resolves.toBe('migrated')
    expect((await stat(path)).isDirectory()).toBe(true)
    expect(await readdir(path)).toEqual([])
  })

  it('permanent empty lock directory and its parent can be rebuilt', async () => {
    const home = await fixture()
    const lock = lockFor(home)
    const path = lock.lockPath('C:/repo')
    await mkdir(path, { recursive: true })
    await expect(lock.run('C:/repo', async () => 'existing')).resolves.toBe('existing')
    expect(await readdir(path)).toEqual([])
    for (const removed of [path, dirname(path)]) {
      await rm(removed, { recursive: true })
      await expect(lock.run('C:/repo', async () => 'rebuilt')).resolves.toBe('rebuilt')
      expect((await stat(path)).isDirectory()).toBe(true)
      expect(await readdir(path)).toEqual([])
    }
  })

  it('lockPath stays under DSH_HOME, with stable normalized workspace identity', async () => {
    const home = await fixture()
    const lock = lockFor(home)
    const path = lock.lockPath('C:/repo')
    expect(dirname(path)).toBe(join(home, 'dsh-tauri-experimental', 'locks'))
    expect(path.endsWith('.lock')).toBe(true)
    expect(lock.lockPath('C:/repo')).toBe(path)
    expect(lock.lockPath('C:/other-repo')).not.toBe(path)
    expect(lock.lockPath('C:/Repo') === lock.lockPath('c:/repo')).toBe(process.platform === 'win32')
  })
})

describe('workspaceLockPort — fixed kernel identity', () => {
  it('keeps derived ports below the default ephemeral ranges', () => {
    for (let index = 0; index < 512; index += 1) {
      const port = workspaceLockPort('C:/dsh-port-range', `C:/repo-${index}`)
      expect(port).toBeGreaterThanOrEqual(20000)
      expect(port).toBeLessThan(30000)
    }
  })

  it('colliding workspace keys serialize instead of falling back to another port', async () => {
    const home = await fixture()
    const seen = new Map<number, string>()
    let collision: [string, string] | undefined
    for (let index = 0; index <= 10000; index += 1) {
      const key = `C:/collision-${index}`
      const port = workspaceLockPort(home, key)
      const previous = seen.get(port)
      if (previous !== undefined) {
        collision = [previous, key]
        break
      }
      seen.set(port, key)
    }
    expect(collision).toBeDefined()
    const [first, second] = collision!
    expect(workspaceLockPort(home, first)).toBe(workspaceLockPort(home, second))
    await withHeld(lockFor(home), first, async () => {
      await expect(lockFor(home, 80).run(second, async () => 'never')).rejects.toBeInstanceOf(WorkspaceLockTimeoutError)
    })
    await expect(lockFor(home).run(second, async () => 'released')).resolves.toBe('released')
  })

  it('is stable, path-normalized and includes DSH_HOME', async () => {
    const home = await fixture()
    const key = join(home, 'repo')
    const port = workspaceLockPort(home, key)
    expect(Number.isInteger(port)).toBe(true)
    expect(port).toBeGreaterThanOrEqual(20000)
    expect(port).toBeLessThan(30000)
    expect(workspaceLockPort(home, key)).toBe(port)
    expect(workspaceLockPort(`${home}/.`, `${key}/child/..`)).toBe(port)
    // Fixed identities: a collision is permitted in general, not expected for this pair.
    expect(workspaceLockPort('C:/dsh-home-a', 'C:/repo')).not.toBe(workspaceLockPort('C:/dsh-home-b', 'C:/repo'))
    if (process.platform === 'win32') {
      expect(workspaceLockPort(home.toUpperCase(), key.toUpperCase())).toBe(port)
      expect(workspaceLockPort(home.replaceAll('/', '\\'), key.replaceAll('/', '\\'))).toBe(port)
    }
    await withWorkers([{ home, key }, { home, key }], async (workers) => {
      for (const worker of workers)
        expect((await worker.wait('ready')).port).toBe(port)
    })
  })

  it('an unrelated external listener forces timeout, never a fallback port/file lock', async () => {
    const home = await fixture()
    const key = 'C:/repo'
    const listener = createServer(socket => socket.destroy())
    try {
      await new Promise<void>((resolve, reject) => {
        listener.once('error', reject)
        listener.listen({ host: '127.0.0.1', port: workspaceLockPort(home, key), exclusive: true }, resolve)
      })
      let entered = false
      await expect(lockFor(home, 100).run(key, async () => {
        entered = true
      })).rejects.toBeInstanceOf(WorkspaceLockTimeoutError)
      expect(entered).toBe(false)
      await withWorkers([{ home, key }], async ([worker]) => {
        worker!.send('start', 0, 100)
        const failure = await worker!.wait('failed', 0)
        expect(failure).toMatchObject({ name: 'WorkspaceLockTimeoutError', reason: REASON_WORKSPACE_BUSY })
        expect(worker!.messages.some(message => message.type === 'entered')).toBe(false)
      })
    }
    finally {
      if (listener.listening)
        await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()))
    }
    await expect(lockFor(home).run(key, async () => 'released')).resolves.toBe('released')
  })
})

describe('createWorkspaceLock — real process contention', () => {
  it('repeated multi-process races never double-enter an independent wx guard', async () => {
    const home = await fixture()
    const guard = join(home, 'critical-section.guard')
    await withWorkers(Array.from({ length: 4 }, () => ({ home, key: 'C:/repo', guard })), async (workers) => {
      for (let round = 0; round < 8; round += 1) {
        for (const worker of workers)
          worker.send('start', round)
        await Promise.all(workers.map(worker => worker.wait('started', round)))
        await Promise.all(workers.map(async (worker) => {
          await worker.wait('entered', round)
          expect(await readFile(guard, 'utf8')).toBe(`${worker.child.pid}:${round}`)
          await tick(10)
          worker.send('release', round)
          await worker.wait('finished', round)
        }))
        await expect(stat(guard)).rejects.toMatchObject({ code: 'ENOENT' })
      }
      expect(workers.flatMap(worker => worker.messages).filter(message => message.type === 'entered')).toHaveLength(32)
      expect(workers.flatMap(worker => worker.messages).filter(message => message.type === 'failed')).toEqual([])
    })
  })

  it('different keys enter in different processes while the first remains held', async () => {
    const home = await fixture()
    const firstKey = 'C:/repo-a'
    const secondKey = nonCollidingKey(home, firstKey)
    expect(workspaceLockPort(home, firstKey)).not.toBe(workspaceLockPort(home, secondKey))
    await withWorkers([{ home, key: firstKey }, { home, key: secondKey }], async ([first, second]) => {
      first!.send('start', 0)
      await first!.wait('entered', 0)
      second!.send('start', 0)
      await second!.wait('entered', 0)
      expect(first!.messages.some(message => message.type === 'finished')).toBe(false)
      for (const worker of [first!, second!]) {
        worker.send('release', 0)
        await worker.wait('finished', 0)
      }
    })
  })

  it('deleting diagnostics while a child holds the kernel lock cannot admit another process', async () => {
    const home = await fixture()
    const key = 'C:/repo'
    const guard = join(home, 'critical-section.guard')
    const lock = lockFor(home, 100)
    await withWorkers([{ home, key, guard }, { home, key, guard }], async ([holder, waiter]) => {
      holder!.send('start', 0)
      await holder!.wait('entered', 0)
      await rm(dirname(lock.lockPath(key)), { recursive: true })
      waiter!.send('start', 0, 100)
      expect(await waiter!.wait('failed', 0)).toMatchObject({ name: 'WorkspaceLockTimeoutError', reason: REASON_WORKSPACE_BUSY })
      await expect(lock.run(key, async () => 'never')).rejects.toBeInstanceOf(WorkspaceLockTimeoutError)
      expect(await readFile(guard, 'utf8')).toBe(`${holder!.child.pid}:0`)
      holder!.send('release', 0)
      await holder!.wait('finished', 0)
      waiter!.send('start', 1)
      await waiter!.wait('entered', 1)
      expect((await stat(lock.lockPath(key))).isDirectory()).toBe(true)
      waiter!.send('release', 1)
      await waiter!.wait('finished', 1)
    })
  })

  it('killing a holder with SIGKILL lets an already waiting child and then the parent acquire', async () => {
    const home = await fixture()
    const key = 'C:/repo'
    // No guard here: a killed process intentionally cannot unlink a filesystem guard.
    await withWorkers([{ home, key }, { home, key }], async ([holder, waiter]) => {
      holder!.send('start', 0)
      await holder!.wait('entered', 0)
      waiter!.send('start', 0)
      await waiter!.wait('started', 0)
      await tick(80)
      expect(waiter!.messages.some(message => message.type === 'entered')).toBe(false)
      await holder!.stop()
      await waiter!.wait('entered', 0)
      await expect(lockFor(home, 80).run(key, async () => 'never')).rejects.toBeInstanceOf(WorkspaceLockTimeoutError)
      waiter!.send('release', 0)
      await waiter!.wait('finished', 0)
      await expect(lockFor(home).run(key, async () => 'parent')).resolves.toBe('parent')
      expect((await stat(lockFor(home).lockPath(key))).isDirectory()).toBe(true)
    })
  })
})

describe('kernel lock lifecycle regressions', () => {
  it('canonicalizes a missing home through an alias before deriving its port', async () => {
    const root = await fixture()
    const real = join(root, 'real')
    const alias = join(root, 'alias')
    await mkdir(real)
    await symlink(real, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const home = join(alias, 'new-home')
    await withHeld(lockFor(home), 'ws', async () => {
      await expect(lockFor(home, 60).run('ws', async () => 'never')).rejects.toBeInstanceOf(WorkspaceLockTimeoutError)
      await expect(lockFor(join(real, 'new-home'), 60).run('ws', async () => 'never')).rejects.toBeInstanceOf(WorkspaceLockTimeoutError)
    })
  })

  it('handles a listening server error without throwing from emit or releasing an active task', async () => {
    const home = await fixture()
    const failure = new Error('simulated accept failure')
    const listen = vi.spyOn(Server.prototype, 'listen')
    try {
      await expect(lockFor(home).run('ws', async () => {
        const server = listen.mock.instances[0]
        if (!(server instanceof Server))
          throw new Error('listener was not created')
        expect(() => server.emit('error', failure)).not.toThrow()
        await expect(lockFor(home, 60).run('ws', async () => 'never')).rejects.toBeInstanceOf(WorkspaceLockTimeoutError)
        return 'done'
      })).rejects.toBe(failure)
      await expect(lockFor(home).run('ws', async () => 'released')).resolves.toBe('released')
    }
    finally {
      listen.mockRestore()
    }
  })
})
