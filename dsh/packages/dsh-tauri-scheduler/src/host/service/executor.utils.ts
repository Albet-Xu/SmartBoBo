import type { RunStatus } from '../types'
import { compact, filter, findLast, last, map } from 'lodash-es'

/** 启动窗口：排队的 followup 被 driver 取走前的等待上限。 */
export const SCHEDULER_TURN_START_TIMEOUT_MS = 30_000

const TURN_START_POLL_MS = 10

export interface RunFailure {
  code: string
  message: string
}

/**
 * 等待这一轮真正开始（`session.seq` 增长即视为已启动）。
 *
 * `whenIdle()` 表示「当前没有 driver」，排队的 followup 被取走之前它就会立刻兑现，
 * 因此直接在 followup 后等空闲会读到空事件集，把跑得好好的任务判成没产生 turn。
 */
export async function waitForTurnStart(
  session: { seq: number },
  firstSeq: number,
  timeoutMs = SCHEDULER_TURN_START_TIMEOUT_MS,
): Promise<boolean> {
  const deadlineAt = Date.now() + timeoutMs
  while (session.seq <= firstSeq) {
    if (Date.now() >= deadlineAt)
      return false
    await new Promise(resolve => setTimeout(resolve, TURN_START_POLL_MS))
  }
  return true
}

function reasonOf(reason: Record<string, unknown>): Record<string, unknown> {
  const nested = reason.error
  return typeof nested === 'object' && nested !== null ? nested as Record<string, unknown> : {}
}

/**
 * turn 收尾原因 → 失败文案。
 *
 * `turn/end` 缺失不算失败：核心在异常收尾（取消 / 中断 / 崩溃修复）时可能不补写，
 * 与 `agent/status → idle` 的兜底语义保持一致（见 pet / running-changes 的同名处理）。
 */
export function describeFailure(reason: Record<string, unknown> | undefined): RunFailure {
  if (!reason)
    return { code: 'no_turn_result', message: '本次定时任务没有产生完整 turn。' }
  if (reason.kind === 'error') {
    const error = reasonOf(reason)
    return {
      code: typeof error.code === 'string' ? error.code : 'agent_error',
      message: typeof error.message === 'string' ? error.message : '定时任务 Agent 执行失败。',
    }
  }
  return { code: `turn_${String(reason.kind)}`, message: `定时任务以 ${String(reason.kind)} 结束。` }
}

/** 收尾判定：显式的非 `completed` 原因才判失败，超时与「根本没启动」各自单独归类。 */
export function decideRunOutcome(input: {
  started: boolean
  timedOut: boolean
  reason: Record<string, unknown> | undefined
}): { status: RunStatus, error?: RunFailure } {
  if (input.timedOut)
    return { status: 'failed', error: { code: 'timeout', message: '定时任务超过最大运行时限。' } }
  if (!input.started)
    return { status: 'failed', error: describeFailure(undefined) }
  if (input.reason === undefined || input.reason.kind === 'completed')
    return { status: 'succeeded' }
  return { status: 'failed', error: describeFailure(input.reason) }
}

export interface SessionEventLike {
  readonly seq?: number
  readonly type: string
  readonly data: Record<string, any>
}

export interface SessionEventWatch {
  readonly events: SessionEventLike[]
  stop: () => void
}

/** 摘要只关心 turn 边界，`request/header`、工具结果等不缓存。 */
const SUMMARY_EVENT_TYPES = new Set(['turn/start', 'assistant/message', 'turn/end'])

/**
 * 订阅本轮会话增量。0.1.6-alpha.1 起内核弃用同步历史读取
 * （`snapshotEvents()` 标注 new calls are prohibited），增量够用就不再整段扫历史。
 */
export function watchSessionEvents(
  ctx: { on?: (name: string, listener: (...args: any[]) => void) => () => void },
  session: unknown,
  fromSeq: number,
): SessionEventWatch {
  const events: SessionEventLike[] = []
  const stop = typeof ctx.on === 'function'
    ? ctx.on('session/event', (target: unknown, event: SessionEventLike) => {
        if (target !== session || typeof event?.type !== 'string')
          return
        if (!SUMMARY_EVENT_TYPES.has(event.type))
          return
        if (typeof event.seq === 'number' && event.seq < fromSeq)
          return
        events.push(event)
      })
    : () => {}
  return { events, stop }
}

/**
 * 从会话对象读取本轮之后的事件，提取助手正文与 `turn/end` 收尾原因。
 *
 * 取日志必须走 {@link sessionEvents}：直接读 `session.events` 在 0.1.2-rc.1 起的内核上
 * 恒为 `undefined`，会让收尾原因消失、把失败的跑批误判成成功。
 */
export function summarizeRun(session: unknown, firstSeq: number): {
  readonly text: string
  readonly reason?: Record<string, any>
} {
  return summarizeEvents(sessionEvents(session), firstSeq)
}

/**
 * 优先用增量，但只有拿到收尾原因才信任它。
 *
 * 比上游更保守：增量丢了 `turn/end` 时正文可能仍在，若直接采信就会把失败吞成成功，
 * 因此缺少收尾原因一律回退同步快照。
 */
export function summarizeCollectedRun(
  live: readonly SessionEventLike[],
  session: unknown,
  firstSeq: number,
): ReturnType<typeof summarizeRun> {
  const fromLive = summarizeEvents(live, firstSeq)
  if (fromLive.reason !== undefined)
    return fromLive
  return summarizeRun(session, firstSeq)
}

function summarizeEvents(events: readonly SessionEventLike[], firstSeq: number): {
  readonly text: string
  readonly reason?: Record<string, any>
} {
  const scoped = filter(events, event => typeof event.seq !== 'number' || event.seq >= firstSeq)
  const texts = compact(map(filter(scoped, { type: 'assistant/message' }), textOf))
  const reason = findLast(scoped, { type: 'turn/end' })?.data.reason as Record<string, any> | undefined
  return { text: last(texts) ?? '', ...(reason ? { reason } : {}) }
}

/** 插件 fiber 卸载会让挂起的宿主调用抛 `INACTIVE_EFFECT`：这是取消，不是执行失败。 */
export function isPluginUnloadError(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && (error as { readonly code?: unknown }).code === 'INACTIVE_EFFECT'
}

/** 内核 `Session` 的日志面逐版本漂移：0.1.2-rc.1 起移除 `events` 访问器，以 `snapshotEvents()` 为准，`log` / `events` 仅作兜底。 */
function sessionEvents(value: unknown): readonly SessionEventLike[] {
  if (typeof value !== 'object' || value === null)
    return []
  const session = value as Record<string, unknown>
  const snapshotEvents = session.snapshotEvents
  if (typeof snapshotEvents === 'function') {
    const snapshot: unknown = Reflect.apply(snapshotEvents, value, [])
    if (Array.isArray(snapshot))
      return snapshot as readonly SessionEventLike[]
  }
  if (Array.isArray(session.log))
    return session.log as readonly SessionEventLike[]
  return Array.isArray(session.events) ? session.events as readonly SessionEventLike[] : []
}

function textOf(event: SessionEventLike): string {
  const blocks = (event.data.message?.content ?? []) as readonly { type: string, text?: string }[]
  return blocks.filter(block => block.type === 'text').map(block => block.text ?? '').join('')
}
