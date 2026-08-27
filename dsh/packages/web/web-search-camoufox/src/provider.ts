/**
 * Local Camoufox-backed search provider for `ctx.web` (`web-search-camoufox`).
 *
 * Runs the BoBo Python engine script `scripts/run_camoufox_search.py` in a child
 * process (mirrors `@deepseek-ai/dsh-tool-acquisition`'s orchestration): the script
 * launches a headless Camoufox browser against the configured engine — Baidu by
 * default, Bing optional — and prints one line of JSON on stdout. This provider
 * resolves the BoBo project root by walking up for a sibling `dsh` so it works
 * regardless of the launch working directory, exactly like the acquisition tool.
 *
 * The model-facing `web_search` tool and the `ctx.web` seam are unchanged; only
 * `web.config.searchProvider` selects this provider's id (`camoufox`).
 * @module @deepseek-ai/dsh-web-search-camoufox/provider
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname, join, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'

const execFileAsync = promisify(execFile)

/** Stable id this provider registers under on `ctx.web`. */
export const CAMOUFOX_PROVIDER_ID = 'camoufox'

/** Default engine handed to the Python script (Baidu: China direct, clean URLs). */
export const CAMOUFOX_DEFAULT_ENGINE = 'baidu'

/** Default upper bound on returned sources when the caller sets none. */
export const CAMOUFOX_DEFAULT_MAX_RESULTS = 8

/** Default Python-side timeout (ms); matching search is slower than a plain fetch. */
export const CAMOUFOX_DEFAULT_TIMEOUT_MS = 90_000

/**
 * Locate the BoBo project root (the directory containing `dsh/`, `scripts/`, `.venv`).
 * Walks up from the built module path, independent of the launch cwd or env.
 */
function findProjectRoot(start: string): string | undefined {
  let dir = resolve(start)
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, 'dsh'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}

/** BoBo project root; used to locate `.venv` and `scripts` portably. */
const BOBO_ROOT = findProjectRoot(dirname(fileURLToPath(import.meta.url)))

/** Windows uses `.venv/Scripts/python.exe`; Linux/macOS uses `.venv/bin/python`. */
const PYTHON_SUBPATH = process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python'

/** Resolved provider options (the plugin's `apply` supplies defaults). */
export interface CamoufoxSearchOptions {
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

/** An engine result row as emitted by the Python script. */
interface EngineSource {
  title?: string
  url?: string
  snippet?: string
}

/**
 * Local Camoufox-backed search provider. `available()` is a cheap local check so
 * the seam only selects it when the BoBo venv and search script are present.
 */
export class CamoufoxSearchProvider implements WebSearchProvider {
  readonly id = CAMOUFOX_PROVIDER_ID

  constructor(private readonly resolveOptions: () => CamoufoxSearchOptions) {}

  available(): boolean {
    const { pythonBin, scriptsDir } = this.resolvedPaths()
    return existsSync(pythonBin) && existsSync(join(scriptsDir, 'run_camoufox_search.py'))
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const options = this.resolveOptions()
    const { pythonBin, scriptsDir } = this.resolvedPaths(options)
    const max = request.maxResults ?? options.maxResults ?? CAMOUFOX_DEFAULT_MAX_RESULTS
    const scriptArgs = [
      join(scriptsDir, 'run_camoufox_search.py'),
      '--query', request.query,
      '--engine', options.engine ?? CAMOUFOX_DEFAULT_ENGINE,
      '--max', String(max),
    ]

    let stdout: string
    try {
      const res = await execFileAsync(pythonBin, scriptArgs, {
        signal,
        timeout: options.timeoutMs ?? CAMOUFOX_DEFAULT_TIMEOUT_MS,
        encoding: 'utf-8',
        windowsHide: true,
      })
      stdout = res.stdout
    } catch (error: unknown) {
      if (signal?.aborted === true) {
        throw new Error(`Camoufox search cancelled: ${String(error)}`)
      }
      const message = String((error as { stderr?: string })?.stderr ?? messageOf(error))
      throw new Error(`Camoufox search 后台脚本执行失败: ${message}`)
    }

    let parsed: { sources?: EngineSource[]; truncated?: boolean; error?: string } = {}
    try {
      parsed = JSON.parse(stdout) as typeof parsed
    } catch {
      throw new Error('Camoufox search: 脚本输出不是有效 JSON')
    }
    if (typeof parsed.error === 'string' && parsed.error.length > 0) {
      throw new Error(`Camoufox search 脚本报错: ${parsed.error}`)
    }

    const sources: WebSearchSource[] = (parsed.sources ?? [])
      .map(source => ({
        url: String(source.url ?? ''),
        ...typeof source.title === 'string' && source.title.length > 0 ? { title: source.title } : {},
        ...typeof source.snippet === 'string' && source.snippet.length > 0 ? { snippet: source.snippet } : {},
      }))
      .filter(source => source.url.length > 0)

    return { sources, truncated: parsed.truncated === true }
  }

  /** Resolve python/scripts paths from config, falling back to the auto-located BoBo root. */
  private resolvedPaths(options?: CamoufoxSearchOptions): { pythonBin: string; scriptsDir: string } {
    const opts = options ?? this.resolveOptions()
    return {
      pythonBin: opts.pythonBin ?? (BOBO_ROOT ? join(BOBO_ROOT, PYTHON_SUBPATH) : 'python'),
      scriptsDir: opts.scriptsDir ?? (BOBO_ROOT ? join(BOBO_ROOT, 'scripts') : 'scripts'),
    }
  }
}

/** Stringify an unknown error without the `Error:` prefix. */
function messageOf(error: unknown): string {
  return String(error).replace(/^Error: /u, '')
}