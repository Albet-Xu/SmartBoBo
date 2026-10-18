import type { DiscardJob } from '../types'
import { readFileSync } from 'node:fs'
import { defineService, DSH_HOME } from 'dsh-tauri'
import { get, isPlainObject } from 'lodash-es'
import { join } from 'pathe'
import { WORKTREES_DIR } from '../config/constants'
import { storage } from '../storage'

const JOBS_KEY = `${WORKTREES_DIR}/jobs.json`

const INTERRUPTED_ERROR = '删除在上次运行结束前未完成'

export const jobs = defineService({
  load(): DiscardJob[] {
    try {
      return parseJobs(readFileSync(join(DSH_HOME, JOBS_KEY), 'utf8'))
    }
    catch (error) {
      // 只有「文件/目录不存在」才算空队列；其余读取失败必须让 recover() 报错，
      // 否则未完成的删除任务会被当成不存在而永远不再续跑
      const code = get(error, 'code')
      if (code === 'ENOENT' || code === 'ENOTDIR')
        return []
      throw error
    }
  },

  async save(records: readonly DiscardJob[]): Promise<void> {
    await storage.setItem(JOBS_KEY, `${JSON.stringify({ version: 1, jobs: records }, null, 2)}\n`)
  },
})

// --- internal ---

function parseJobs(raw: string): DiscardJob[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    const list: unknown = get(parsed, 'jobs')
    return Array.isArray(list) ? list.map(parseJob).filter(job => job !== null) : []
  }
  catch {
    return []
  }
}

/** 落盘时只有「已完成 / 未完成」两种事实：进程中断留下的 deleting 视为失败，等待下次重跑。 */
function parseJob(value: unknown): DiscardJob | null {
  if (!isPlainObject(value))
    return null
  const record = value as Record<string, unknown>
  const jobId = record.jobId
  const sessionId = record.sessionId
  const worktreeKey = record.worktreeKey
  if (typeof jobId !== 'string' || !jobId || typeof sessionId !== 'string' || typeof worktreeKey !== 'string')
    return null
  const worktreePath = typeof record.worktreePath === 'string' && record.worktreePath ? record.worktreePath : ''
  const attempts = typeof record.attempts === 'number' && Number.isSafeInteger(record.attempts) && record.attempts >= 0
    ? record.attempts
    : 0
  const base = { jobId, sessionId, worktreeKey, ...(worktreePath ? { worktreePath } : {}), attempts }
  if (record.state === 'completed')
    return { ...base, state: 'completed' }
  return {
    ...base,
    state: 'failed',
    error: typeof record.error === 'string' && record.error ? record.error : INTERRUPTED_ERROR,
  }
}
