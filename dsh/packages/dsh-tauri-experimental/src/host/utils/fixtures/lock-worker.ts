/** Real Node/tsx worker: no mocks and no inherited Vitest module registry. */
import { open, unlink } from 'node:fs/promises'
import process from 'node:process'
import { createWorkspaceLock, workspaceLockPort } from '../lock'

const [dshHome, key, guardPath] = process.argv.slice(2)
if (!dshHome || !key || !process.send)
  throw new Error('lock-worker requires dshHome, key and an IPC channel')

const lock = createWorkspaceLock({ dshHome, timeoutMs: 10_000, retryMs: 2 })
let release: (() => void) | undefined
let activeRound: number | undefined

function send(message: object): void {
  process.send?.(message)
}

async function start(round: number, timeoutMs?: number): Promise<void> {
  if (activeRound !== undefined)
    throw new Error('start received while a round is active')
  activeRound = round
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  send({ type: 'started', round })
  try {
    await lock.run(key!, async () => {
      // Independent of the TCP protocol: wx detects even very short double entry.
      const guard = guardPath ? await open(guardPath, 'wx') : undefined
      try {
        await guard?.writeFile(`${process.pid}:${round}`)
        send({ type: 'entered', round, pid: process.pid })
        await released
      }
      finally {
        await guard?.close()
        if (guard)
          await unlink(guardPath!)
      }
    }, timeoutMs)
    activeRound = undefined
    release = undefined
    send({ type: 'finished', round })
  }
  catch (error) {
    activeRound = undefined
    release = undefined
    const caught = error as Error & { reason?: string, code?: string }
    send({ type: 'failed', round, name: caught.name, reason: caught.reason, code: caught.code, message: caught.message })
  }
}

process.on('message', (message: { type: string, round: number, timeoutMs?: number }) => {
  if (message.type === 'start') {
    void start(message.round, message.timeoutMs).catch((error: Error) => {
      send({ type: 'failed', round: message.round, message: error.stack })
    })
  }
  else if (message.type === 'release' && message.round === activeRound) {
    release?.()
  }
})
// A failed parent must not leave an orphan listening forever.
process.on('disconnect', () => process.exit(0))
send({ type: 'ready', pid: process.pid, port: workspaceLockPort(dshHome, key) })
