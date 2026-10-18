import { chromium } from 'playwright-core'
import { acquireProxy, proxyPoolOf } from '../proxy.js'

const MAX_CONTENT_CHARS = 128000

export function cloakFetchTool(runtime, deps = {}) {
  const { proxyMode, settings } = deps
  return {
    name: 'cloak_fetch',
    description:
      'Fetch a web page through the CloakBrowser stealth Chromium (long-running cloakserve service over CDP). Renders JavaScript and passes common bot detection. Returns html or visible text, optionally sliced by CSS selector.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute http(s) URL to fetch' },
        format: { type: 'string', enum: ['html', 'text'], description: 'Output format: html (default) or text (visible innerText)' },
        selector: { type: 'string', description: 'Optional CSS selector; only matched elements are extracted; empty match is an error' },
        waitUntil: { type: 'string', enum: ['domcontentloaded', 'load', 'networkidle'], description: 'Navigation wait condition, default domcontentloaded' },
        timeoutMs: { type: 'number', description: 'Navigation timeout in milliseconds, default 30000' },
      },
      required: ['url'],
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          url: { type: 'string' },
          finalUrl: { type: 'string' },
          title: { type: 'string' },
          status: { type: 'integer' },
          format: { type: 'string' },
          bytes: { type: 'integer' },
          truncated: { type: 'boolean' },
          content: { type: 'string' },
          error: { type: 'string' },
        },
        required: ['ok'],
      },
      render: (_args, value) => {
        if (!value.ok) return [{ type: 'text', text: `cloak_fetch failed: ${value.error}` }]
        const head = `url: ${value.finalUrl}\ntitle: ${value.title}\nstatus: ${value.status} format: ${value.format} bytes: ${value.bytes} truncated: ${value.truncated}`
        return [{ type: 'text', text: `${head}\n\n${value.content}` }]
      },
    },
    async execute(args, exec) {
      const format = args.format === 'text' ? 'text' : 'html'
      const waitUntil = args.waitUntil || 'domcontentloaded'
      const timeout = Number(args.timeoutMs) > 0 ? Number(args.timeoutMs) : 30000

      let proxy = null
      const session = exec?.agent?.session
      if (proxyMode && session && proxyMode.of(session)) {
        try {
          const pool = proxyPoolOf(settings?.())
          if (pool?.enabled && pool.sources.some((source) => source.enabled && source.apiUrl)) {
            proxy = await acquireProxy(
              runtime.pythonBin, runtime.scriptsDir, pool, args.url,
              Math.max(pool.timeoutMs + 15000, 60000), exec?.signal,
            )
          }
        } catch (err) {
          return { ok: false, error: String(err?.message ?? err) }
        }
      }

      try {
        await runtime.ensureProxy(proxy)
        await runtime.ensureReady()
      } catch (err) {
        return { ok: false, error: String(err?.message ?? err) }
      }

      let browser
      try {
        const connect = chromium.connectOverCDP ?? chromium.connectOverCdp
        browser = await connect.call(chromium, runtime.endpoint, { timeout })
      } catch (err) {
        return { ok: false, error: `CDP connect failed: ${String(err?.message ?? err)}` }
      }

      const ctx = browser.contexts()[0] ?? await browser.newContext()
      const page = await ctx.newPage()
      const onAbort = () => { page.close().catch(() => {}) }
      exec?.signal?.addEventListener?.('abort', onAbort, { once: true })

      try {
        const resp = await page.goto(args.url, { waitUntil, timeout })
        const finalUrl = page.url()
        const title = await page.title().catch(() => '')
        const status = resp?.status() ?? 0

        let content
        if (args.selector) {
          if (format === 'text') {
            const texts = await page.locator(args.selector).allInnerTexts()
            content = texts.filter((t) => t.trim()).join('\n')
          } else {
            content = await page.locator(args.selector).evaluateAll((els) => els.map((el) => el.outerHTML).join('\n'))
          }
          if (!content.trim()) {
            return { ok: false, url: args.url, finalUrl, title, error: `selector matched nothing: ${args.selector}` }
          }
        } else if (format === 'text') {
          content = await page.evaluate(() => document.body?.innerText ?? '')
        } else {
          content = await page.content()
        }

        const bytes = Buffer.byteLength(content)
        const truncated = content.length > MAX_CONTENT_CHARS
        if (truncated) content = content.slice(0, MAX_CONTENT_CHARS)
        return { ok: true, url: args.url, finalUrl, title, status, format, bytes, truncated, content }
      } catch (err) {
        return { ok: false, url: args.url, error: String(err?.message ?? err) }
      } finally {
        exec?.signal?.removeEventListener?.('abort', onAbort)
        await page.close().catch(() => {})
        await browser.close().catch(() => {})
      }
    },
  }
}
