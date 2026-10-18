import type { SessionLedger, TurnRecord } from '../types'
import { MAX_TURN_RECORDS, MAX_TURNS_PER_SESSION, REASON_EXPIRED } from '../config/constants'

/** 追加/覆盖某 turn 的记录（同号覆盖，保持按 turn 升序）。 */
export function putRecord(ledger: SessionLedger, record: TurnRecord): SessionLedger {
  const turns = ledger.turns.filter(item => item.turn !== record.turn)
  turns.push(record)
  turns.sort((left, right) => left.turn - right.turn)
  return { ...ledger, turns }
}

/**
 * 对账本做「保留窗口 + 硬上限」治理（纯函数）。
 *
 * 超出保留窗口的行只保留审计信息：清空文件明细与 refs，避免账本与载荷随历史无限增长；
 * 只有超过硬上限的最老行才会被真正丢弃。
 */
export function applyRetention(ledger: SessionLedger): { ledger: SessionLedger, refsToDelete: string[] } {
  const turns = [...ledger.turns].sort((left, right) => left.turn - right.turn)
  const refsToDelete: string[] = []
  const excess = new Set(
    turns.slice(0, Math.max(0, turns.length - MAX_TURNS_PER_SESSION)).map(turn => turn.turn),
  )
  const reclaimed = turns.map((turn) => {
    if (!excess.has(turn.turn))
      return turn
    if (turn.beforeRef.length > 0)
      refsToDelete.push(turn.beforeRef)
    if (turn.afterRef.length > 0)
      refsToDelete.push(turn.afterRef)
    return {
      ...turn,
      unavailable: REASON_EXPIRED,
      files: [],
      beforeRef: '',
      afterRef: '',
    }
  })
  const dropCount = Math.max(0, reclaimed.length - MAX_TURN_RECORDS)
  for (const turn of reclaimed.slice(0, dropCount)) {
    if (turn.beforeRef.length > 0)
      refsToDelete.push(turn.beforeRef)
    if (turn.afterRef.length > 0)
      refsToDelete.push(turn.afterRef)
  }
  return {
    ledger: { ...ledger, turns: dropCount > 0 ? reclaimed.slice(dropCount) : reclaimed },
    refsToDelete,
  }
}
