/**
 * Model-facing `crawl_fetch`: renders one page through the deployment's
 * long-lived CloakBrowser-backed browser service (browser_server.py over cloakserve CDP) and saves the formats the call asks for.
 *
 * The plugin owns two things beyond the tool registration: the browser service
 * the captures share (stopped when this plugin instance is disposed, so a
 * session end closes the browser) and the session proxy fold a capture reads.
 * @module bobo-crawl-tool
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { CloakBrowserService } from './browser-server.ts'
import { registerCrawlFetchTool } from './crawl-tool.ts'
import { resolveDeployment } from './deployment.ts'
import { SessionProxyMode } from './proxy.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-acquisition'

/** Services required before the tool can be registered. */
export const inject = ['tools']

/** Plugin config: deployment paths and the waits one capture may spend. */
export interface Config {
  /** Python interpreter path; blank or absent locates the project root's `.venv`. */
  pythonBin?: string
  /** Directory holding the capture scripts; blank or absent locates `<project root>/scripts`. */
  scriptsDir?: string
  /** Capture directory; blank or absent saves into the calling session's workspace `data`. */
  dataDir?: string
  /** Budget for one crawl engine invocation, in milliseconds. Defaults to 120000. */
  timeoutMs?: number
  /** Budget for the browser service to report itself ready after a launch, in milliseconds. Defaults to 60000. */
  serverStartTimeoutMs?: number
  /** Budget for one proxy-pool invocation, in milliseconds. Defaults to 15000. */
  proxyFetchTimeoutMs?: number
}

/** Config after schemastery has filled every defaulted field. */
interface ResolvedConfig extends Config {
  dataDir: string
  timeoutMs: number
  serverStartTimeoutMs: number
  proxyFetchTimeoutMs: number
}

export const Config: z<Config> = z.object({
  // Left blank rather than defaulted: an absent value is what lets the plugin
  // locate the BoBo project root from its own position.
  pythonBin: z.string(),
  scriptsDir: z.string(),
  dataDir: z.string().default(''),
  timeoutMs: z.natural().min(1_000).default(120_000),
  serverStartTimeoutMs: z.natural().min(1_000).default(60_000),
  proxyFetchTimeoutMs: z.natural().min(1_000).default(15_000),
})

/** Reject a configured budget that is not whole positive milliseconds. */
function assertBudget(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`tool-acquisition: ${name} must be a positive integer number of milliseconds`)
  }
}

/**
 * Register `crawl_fetch` and take ownership of the browser service it drives.
 *
 * @param ctx - context whose `tools` registry receives the tool; the
 *   registration and the browser service both leave with this plugin instance.
 * @param config - deployment paths and budgets, validated by {@link Config}.
 * @throws {Error} when a configured budget is not whole positive milliseconds.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig
  assertBudget('timeoutMs', resolved.timeoutMs)
  assertBudget('serverStartTimeoutMs', resolved.serverStartTimeoutMs)
  assertBudget('proxyFetchTimeoutMs', resolved.proxyFetchTimeoutMs)
  const deployment = resolveDeployment({
    pythonBin: resolved.pythonBin,
    scriptsDir: resolved.scriptsDir,
    dataDir: resolved.dataDir,
  })
  const browser = new CloakBrowserService(deployment, resolved.serverStartTimeoutMs)
  ctx.effect(() => () => { browser.dispose() }, 'tool-acquisition.browser-server')
  registerCrawlFetchTool(ctx, {
    deployment,
    browser,
    proxyMode: new SessionProxyMode(ctx),
    timeoutMs: resolved.timeoutMs,
    proxyTimeoutMs: resolved.proxyFetchTimeoutMs,
  })
}
