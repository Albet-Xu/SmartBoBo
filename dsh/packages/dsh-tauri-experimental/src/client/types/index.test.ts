import type { SessionSummary, TurnSummary } from './index'
import { expect, it } from 'vitest'

it('accepts legacy summary payloads without hasBaseline and current payloads with it', () => {
  const turn: TurnSummary = {
    turn: 1,
    fileCount: 0,
    insertions: 0,
    deletions: 0,
    unavailable: null,
    truncated: false,
    files: [],
    skippedOversized: [],
    skippedNestedRepos: [],
  }
  const summary: SessionSummary = {
    sessionId: 'session-1',
    isGit: true,
    workspaceRoot: '/workspace',
    unavailableReason: null,
    turns: [turn, { ...turn, hasBaseline: false }],
  }

  expect(summary.turns.map(item => item.hasBaseline)).toEqual([undefined, false])
})
