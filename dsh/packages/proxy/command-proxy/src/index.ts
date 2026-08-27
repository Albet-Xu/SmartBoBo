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
        const arg = rawInput.trim().toLowerCase()

        // Determine target state: /proxy (no args) = toggle on, /proxy off = turn off
        const current = foldProxyEnabled(agent.session.events)
        const target = arg === 'off' ? false : !current

        if (target === current) {
          return {
            kind: 'success',
            text: target ? 'Proxy mode is already on.' : 'Proxy mode is already off.',
          }
        }

        // Append the state change to the session log.
        agent.session.append('proxy/enabled' as any, { enabled: target } as any)

        return {
          kind: 'success',
          text: target
            ? 'Proxy mode on. Crawl requests will use the configured proxy pool. Use /proxy off to disable.'
            : 'Proxy mode off. Crawl requests will use the local network.',
        }
      },
    })
  })
}
