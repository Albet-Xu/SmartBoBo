/**
 * 前端日志 — 仅劫持 `console.*`
 *
 * 约定：
 * - 业务直接使用 `console.*`，本模块劫持后自动透传到 Rust `desktop.frontdesk.log`
 * - 级别：trace < debug < info < warn < error < off，与 `tracing` 级别一一映射，兼容 `RUST_LOG`
 * - 生产环境默认屏蔽 trace/debug，开发环境全量；可通过 `localStorage.logger.level` 动态调整
 * - 浏览器与 Rust 日志分离：前端 `console.*` → `desktop.frontdesk.log`（`target: "frontend"` 标识，类 `dsh` 的 `target: "dsh"`），后端 `log::*` → `desktop.log`
 */

import { invoke } from '@tauri-apps/api/core'

// 保存原始 console，避免劫持后递归；本模块职责即劫持 console，需要引用原始方法
/* eslint-disable no-console -- 有意引用原始 console 方法 */
const _origConsole: Record<string, (...a: unknown[]) => void> | null
  = typeof console !== 'undefined'
    ? {
        log: console.log.bind(console),
        info: console.info.bind(console),
        debug: (console.debug ?? console.log).bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console),
        trace: (console.trace ?? console.log).bind(console),
      }
    : null
/* eslint-enable no-console */

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'off'

const LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  off: 5,
}

function resolveLevel(): LogLevel {
  try {
    const stored = localStorage.getItem('logger.level') as LogLevel | null
    if (stored && stored in LEVEL_ORDER)
      return stored
  }
  catch {
    // localStorage 不可用时忽略
  }
  if (import.meta.env.DEV)
    return 'debug'
  return 'info'
}

const currentLevel: LogLevel = resolveLevel()

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel]
}

function serializeMessage(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string')
        return a
      if (a instanceof Error)
        return `${a.message}\n${a.stack ?? ''}`.trim()
      try {
        return JSON.stringify(a)
      }
      catch {
        return String(a)
      }
    })
    .join(' ')
}

function forwardToRust(level: LogLevel, tag: string, args: unknown[]) {
  if (level === 'off')
    return
  try {
    const message = serializeMessage(args)
    void invoke('log_frontend', { level, target: tag, message }).catch(() => {})
  }
  catch {
    // Tauri 未就绪时忽略
  }
}

// ---------------------------------------------------------------------------
// 全局错误兜底：未捕获异常 / 未处理 Promise 统一走 tracing
// ---------------------------------------------------------------------------

if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    const msg = event.error instanceof Error ? event.error.stack ?? event.error.message : event.message
    void forwardToRust('error', 'Window', [msg, `${event.filename}:${event.lineno}:${event.colno}`])
  })
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason instanceof Error ? (event.reason.stack ?? event.reason.message) : String(event.reason)
    void forwardToRust('error', 'Window', ['unhandledrejection:', reason])
  })
}

// ---------------------------------------------------------------------------
// console.* 劫持：裸 console.* 自动路由到后端 desktop.frontdesk.log
// 保持原有 DevTools 输出语义，仅增加透传；`target: "frontend"` 与后端 `dsh` 的 `target: "dsh"` 对称
// ---------------------------------------------------------------------------
if (typeof window !== 'undefined' && typeof console !== 'undefined' && _origConsole) {
  const _consoleLevel: Record<string, LogLevel> = {
    log: 'info',
    info: 'info',
    debug: 'debug',
    warn: 'warn',
    error: 'error',
    trace: 'trace',
  }
  for (const m of ['log', 'info', 'debug', 'warn', 'error', 'trace'] as const) {
    const orig = (_origConsole as Record<string, (...a: unknown[]) => void>)[m] ?? _origConsole.log
    const lvl = _consoleLevel[m] ?? 'info'
    if ((orig as unknown as { __hijacked?: boolean }).__hijacked)
      continue
    const hijacked = (...args: unknown[]) => {
      if (!shouldLog(lvl))
        return
      if (import.meta.env.PROD && LEVEL_ORDER[lvl] < LEVEL_ORDER.warn) {
        forwardToRust(lvl, 'frontend', args)
        return
      }
      try {
        orig(...args)
      }
      catch {
        // 忽略控制台异常
      }
      forwardToRust(lvl, 'frontend', args)
    }
    ;(hijacked as unknown as { __hijacked: boolean }).__hijacked = true
    ;(console as unknown as Record<string, unknown>)[m] = hijacked
  }
}
