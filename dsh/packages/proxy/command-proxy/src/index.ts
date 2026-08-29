/**
 * Human-facing `/proxy` command to toggle proxy mode per session.
 *
 * When active, crawl_fetch and generated crawler scripts will attempt to use
 * the configured proxy sources. State is folded from the session log
 * (`proxy/enabled`, last one wins).
 *
 * @module @deepseek-ai/dsh-command-proxy
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
// Import side-effect to trigger module augmentation for ctx.commands
import '@deepseek-ai/dsh-commands'

/** Cordis plugin name. */
export const name = 'command-proxy'

/** Services required before command registration. */
export const inject = ['commands']

// ── Session event ────────────────────────────────────────────────────────

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Whether proxy mode is enabled from this point on: log-only, non-surface,
     * whole-value replace. The last `proxy/enabled` wins.
     */
    'proxy/enabled': { enabled: boolean }
  }
}

/**
 * Whether proxy mode is active after the given events.
 * The last `proxy/enabled` wins; absence means inactive.
 */
export function foldProxyEnabled(events: readonly SessionEvent[], end = events.length): boolean {
  let enabled = false
  let index = 0
  for (const event of events) {
    if (index >= end) break
    index++
    if (event.type === 'proxy/enabled') enabled = event.data.enabled
  }
  return enabled
}

// ── Settings namespace ───────────────────────────────────────────────────

export const PROXY_POOL_NAMESPACE = 'proxy-pool'

/**
 * A single proxy source entry in the pool configuration.
 */
export interface ProxySource {
  /** Human-readable name for this source. */
  name: string
  /** The API URL to fetch proxy IPs from (e.g. dmgetip.asp endpoint). */
  apiUrl: string
  /** API key / username parameter. */
  apiKey: string
  /** Password parameter (may be empty for key-only auth). */
  pwd: string
  /** Number of IPs to fetch per request. */
  getnum: number
  /** HTTP type: 'http' | 'socks5'. */
  httptype: string
  /** Response format parameter (e.g. '2' for newline-separated). */
  geshi: string
  /** Separator parameter (e.g. '1' for newline). */
  fenge: string
  /** Whether this source is enabled. */
  enabled: boolean
}

/**
 * The full proxy-pool settings schema.
 */
export interface ProxyPoolSettings {
  /** List of proxy sources. */
  sources: ProxySource[]
  /** Fetch strategy: 'cache' = fetch a batch and rotate, 'realtime' = fetch per request. */
  fetchStrategy: 'cache' | 'realtime'
  /** Whether the proxy system is globally enabled (master switch). */
  enabled: boolean
  /** Max retries per request before giving up (default 3). */
  maxRetries: number
  /** Request timeout in milliseconds. */
  timeoutMs: number
}

// ── Plugin body ──────────────────────────────────────────────────────────

/**
 * Register the `/proxy` command and the `proxy-pool` settings namespace.
 *
 * The command is designed to be mounted in specific agent presets (crawl,
 * reverse, workflow) only, so it is NOT added to the base bundle.
 */
export function apply(ctx: Context): void {
  // Register the settings namespace for proxy-pool configuration.
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(settingsNamespace(PROXY_POOL_NAMESPACE), z.object({
      sources: z.array(z.object({
        name: z.string(),
        apiUrl: z.string(),
        apiKey: z.string(),
        pwd: z.string().default(''),
        getnum: z.natural().default(50),
        httptype: z.string().default('http'),
        geshi: z.string().default('2'),
        fenge: z.string().default('1'),
        enabled: z.boolean().default(true),
      })).default([]),
      fetchStrategy: z.union([z.const('cache'), z.const('realtime')]).default('cache'),
      enabled: z.boolean().default(false),
      maxRetries: z.natural().default(3),
      timeoutMs: z.natural().default(30000),
    }) as any)
  })

  // Register the `/proxy` command.
  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      name: 'proxy',
      description: 'Toggle proxy mode on/off for the current session',
      input: { hint: '[off]' },
      handler: ({ agent, rawInput }: CommandInvocation): CommandResult => {
        // Parse trailing input into an explicit on/off mode plus the remaining
        // content to hand to the model. Bare `/proxy` means ON (idempotent);
        // anything that is not a leading on/off keyword is treated as a crawl
        // / edit intent and forwarded verbatim — it is never swallowed.
        const trimmed = rawInput.trim()
        const m = /^\s*(on|off)\b([\s\S]*)$/i.exec(trimmed)
        let mode: boolean
        let rest: string
        if (m !== null) {
          const [, kw, tail] = m
          mode = (kw ?? '').toLowerCase() === 'on'
          rest = (tail ?? '').trim()
        } else {
          mode = true
          rest = trimmed
        }

        const current = foldProxyEnabled(agent.session.events)
        if (mode !== current) {
          // Append the state change to the session log.
          agent.session.append('proxy/enabled' as any, { enabled: mode } as any)
        }

        const stateText = mode
          ? '代理模式已开启，采集请求将走代理池。'
          : '代理模式已关闭，采集请求将走本地网络。'

        // Double channel: a short host ack card (deterministic fallback even if
        // the model is unreachable) plus a model turn that speaks to the user.
        if (rest !== '') {
          // Route the remainder to the model as a normal user message so it
          // handles the crawl / task through the (now on/off) proxy.
          agent.followup(createUserMessage({
            content: [{ type: 'text', text: rest }],
            source: { kind: 'user' },
          }))
        } else {
          // Bare on/off: ask the model to confirm the state change aloud.
          agent.followup(createUserMessage({
            content: [{ type: 'text', text: mode
              ? '用户开启了代理模式，请向用户做一句简短确认（例如“代理模式已开启”）。'
              : '用户关闭了代理模式，请向用户做一句简短确认（例如“代理模式已关闭”）。' }],
            source: { kind: 'user' },
          }))
        }

        return {
          kind: 'success',
          text: rest !== '' ? `${stateText} 已把后续请求转给模型。` : stateText,
        }
      },
    })
  })
}
