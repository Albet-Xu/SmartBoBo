/**
 * host/service/turns.ts — 每会话账本的变更编排（load-modify-save 串行 + 保留窗口治理）。
 *
 * 同一会话的 load-modify-save 全部经过 {@link mutate} 串行化，避免并发结算交叉覆盖；
 * 队尾结算即出队，长期运行不会每会话常驻一条 Promise。
 */

import type { SessionLedger, TurnRecord } from '../types'
import type { LedgerMutation, WorkspaceState } from './turns.types'
import { defineService } from 'dsh-tauri'
import { ledgerQueues } from '../config/runtime'
import { ledger } from './ledger'
import { applyRetention, putRecord } from './turns.utils'

export const turns = defineService({
  /** 追加/覆盖某 turn 的记录；返回需要调用方删除的 refs（保留窗口淘汰时非空）。 */
  async record(sessionId: string, record: TurnRecord): Promise<string[]> {
    const mutation = await mutate(sessionId, current => putRecord(current, record))
    return mutation.refsToDelete
  },

  /** 记录工作区资格结论（非 Git / 被拒绝的目录也要留痕）。 */
  async note(sessionId: string, state: WorkspaceState): Promise<void> {
    await mutate(sessionId, (current) => {
      if (current.workspaceRoot === state.workspaceRoot
        && current.isGit === state.isGit
        && current.unavailableReason === state.unavailableReason) {
        return null
      }
      return { ...current, ...state }
    })
  },
})

// --- internal ---

/** 在会话级串行区内执行 load-modify-save，并顺带做保留窗口治理。 */
async function mutate(sessionId: string, task: (current: SessionLedger) => SessionLedger | null): Promise<LedgerMutation> {
  const previous = ledgerQueues.get(sessionId) ?? Promise.resolve()
  const run = previous.then(async (): Promise<LedgerMutation> => {
    const current = await ledger.load(sessionId)
    const next = task(current)
    if (next === null)
      return { refsToDelete: [] }
    const retained = applyRetention(next)
    await ledger.save(retained.ledger)
    return { refsToDelete: retained.refsToDelete }
  })
  // 队尾只保留「已结算」的守卫，并在结算后出队：否则每见过一个会话就常驻一条 Promise。
  const guard = run.then(() => undefined, () => undefined)
  ledgerQueues.set(sessionId, guard)
  void guard.then(() => {
    if (ledgerQueues.get(sessionId) === guard)
      ledgerQueues.delete(sessionId)
  })
  return run
}
