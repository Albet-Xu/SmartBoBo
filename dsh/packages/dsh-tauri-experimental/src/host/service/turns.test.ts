import type { SessionLedger, TurnRecord } from '../types'
import { rmSync } from 'node:fs'
import { join } from 'pathe'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTestDshHome, testDshHome } from '../../../../.test/test-utils'
import { LEDGER_VERSION, MAX_TURN_RECORDS, MAX_TURNS_PER_SESSION, REASON_EXPIRED, SNAPSHOT_FEATURE_DIR } from '../config/constants'
import { ledger } from './ledger'
import { turns } from './turns'
import { applyRetention } from './turns.utils'

vi.mock('dsh-tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof import('dsh-tauri')>()
  const { testDshHome: home } = await import('../../../../.test/test-utils')
  return { ...actual, DSH_HOME: home }
})

function blank(sessionId: string): SessionLedger {
  return {
    version: LEDGER_VERSION,
    sessionId,
    workspaceRoot: null,
    isGit: false,
    unavailableReason: null,
    turns: [],
  }
}

function record(turn: number): TurnRecord {
  return {
    turn,
    beforeRef: `refs/running-changes/s/${turn}/before`,
    afterRef: `refs/running-changes/s/${turn}/after`,
    files: [],
    insertions: 0,
    deletions: 0,
    createdAt: turn,
    unavailable: null,
  }
}

/** `resetTestDshHome` 不覆盖插件数据目录（账本），用例间必须自行清理。 */
function cleanPluginData(): void {
  rmSync(join(testDshHome, SNAPSHOT_FEATURE_DIR), { recursive: true, force: true })
}

beforeEach(() => {
  vi.restoreAllMocks()
  resetTestDshHome()
  cleanPluginData()
})

describe('turns', () => {
  it('records turns in order and overwrites the same turn number', async () => {
    await turns.record('session-2', record(1))
    await turns.record('session-2', record(2))
    expect((await ledger.load('session-2')).turns.map(turn => turn.turn)).toEqual([1, 2])
    await turns.record('session-2', { ...record(2), insertions: 7 })
    const stored = await ledger.load('session-2')
    expect(stored.turns.map(turn => turn.turn)).toEqual([1, 2])
    expect(stored.turns[1]?.insertions).toBe(7)
  })

  it('keeps sessions isolated from each other', async () => {
    await turns.record('session-a', record(1))
    await turns.record('session-b', record(1))
    await ledger.save({ ...blank('session-a'), isGit: true, workspaceRoot: 'C:/a' })
    expect((await ledger.load('session-a')).workspaceRoot).toBe('C:/a')
    expect((await ledger.load('session-b')).workspaceRoot).toBeNull()
  })

  it('serializes concurrent load-modify-save so no update is lost', async () => {
    await Promise.all(Array.from({ length: 8 }, (_, index) => turns.record('session-lock', record(index + 1))))
    expect((await ledger.load('session-lock')).turns.map(turn => turn.turn)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('only writes the workspace state when it actually changes', async () => {
    await turns.note('session-ws', { workspaceRoot: 'C:/p', isGit: true, unavailableReason: null })
    const save = vi.spyOn(ledger, 'save')

    await turns.note('session-ws', { workspaceRoot: 'C:/p', isGit: true, unavailableReason: null })
    expect(save).toHaveBeenCalledTimes(0)
    expect((await ledger.load('session-ws')).workspaceRoot).toBe('C:/p')

    await turns.note('session-ws', { workspaceRoot: 'C:/q', isGit: true, unavailableReason: null })
    expect(save).toHaveBeenCalledTimes(1)
    expect((await ledger.load('session-ws')).workspaceRoot).toBe('C:/q')
  })
})

describe('turns.utils', () => {
  it('把超出保留窗口的 turn 回收（清空明细与 refs）并回传其 refs（审计行保留）', async () => {
    const overflow = MAX_TURNS_PER_SESSION + 3
    const seeded: SessionLedger = {
      ...blank('session-retain'),
      turns: Array.from({ length: overflow }, (_, index) => record(index + 1)),
    }
    const retained = applyRetention(seeded)
    await ledger.save(retained.ledger)

    // 最老 3 条各自的 before/after ref 都要删（对象随之可被 prune 回收）。
    expect(retained.refsToDelete).toHaveLength(6)
    const stored = await ledger.load('session-retain')
    // 回收只锁 refs、不抹审计：行还在、计数还在，但文件明细与 refs 已清空。
    expect(stored.turns).toHaveLength(overflow)
    expect(stored.turns[0]?.turn).toBe(1)
    expect(stored.turns[0]?.unavailable).toBe(REASON_EXPIRED)
    expect(stored.turns[0]?.files).toEqual([])
    expect(stored.turns[0]?.beforeRef).toBe('')
    expect(stored.turns.at(-1)?.unavailable ?? null).toBeNull()
  })

  it('超过硬上限的最老审计行被真正丢弃', async () => {
    const overflow = MAX_TURN_RECORDS + 5
    const seeded: SessionLedger = {
      ...blank('session-cap'),
      turns: Array.from({ length: overflow }, (_, index) => record(index + 1)),
    }
    const retained = applyRetention(seeded)
    await ledger.save(retained.ledger)

    const stored = await ledger.load('session-cap')
    expect(stored.turns).toHaveLength(MAX_TURN_RECORDS)
    expect(stored.turns[0]?.turn).toBe(overflow - MAX_TURN_RECORDS + 1)
    expect(stored.turns.at(-1)?.turn).toBe(overflow)
  })
})
