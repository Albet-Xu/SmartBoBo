/**
 * Register the Camoufox-backed search provider on `ctx.web`.
 *
 * This plugin only contributes a provider to the `ctx.web` seam; selecting it is
 * a deployment decision via `web.config.searchProvider` = `camoufox`. No API key
 * is required — search runs locally through the BoBo Python/Camoufox engine.
 * @module @deepseek-ai/dsh-web-search-camoufox
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import {
  CamoufoxSearchProvider,
  CAMOUFOX_DEFAULT_ENGINE,
  CAMOUFOX_DEFAULT_MAX_RESULTS,
  CAMOUFOX_DEFAULT_TIMEOUT_MS,
} from './provider.ts'

export {
  CamoufoxSearchProvider,
  CAMOUFOX_PROVIDER_ID,
  CAMOUFOX_DEFAULT_ENGINE,
  CAMOUFOX_DEFAULT_MAX_RESULTS,
} from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-camoufox'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Plugin config (all optional — defaults auto-locate the BoBo `.venv`/`scripts`). */
export interface Config {
  /** Local Python interpreter; omitted = auto-locate the BoBo `.venv`. */
  pythonBin?: string
  /** Python scripts directory; omitted = auto-locate the BoBo `scripts`. */
  scriptsDir?: string
  /** Search engine handed to the script: `baidu` (default) or `bing`. */
  engine?: string
  /** Python-side timeout (ms). */
  timeoutMs?: number
  /** Default result-count cap when the request sets none. */
  maxResults?: number
}

export const Config: z<Config> = z.object({
  // 可不填：未显式配置时由插件自动定位 BoBo 根的 .venv / scripts（可移植）。
  pythonBin: z.string(),
  scriptsDir: z.string(),
  engine: z.string().default(CAMOUFOX_DEFAULT_ENGINE),
  timeoutMs: z.natural().min(1000).default(CAMOUFOX_DEFAULT_TIMEOUT_MS),
  maxResults: z.natural().min(1).default(CAMOUFOX_DEFAULT_MAX_RESULTS),
})

/** Register the Camoufox search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  let current = config
  // 引用同一对象，保持不变即可；未来如需运行时改配置可在此接入 settings section。
  ctx.web.registerSearchProvider(new CamoufoxSearchProvider(() => current))
}