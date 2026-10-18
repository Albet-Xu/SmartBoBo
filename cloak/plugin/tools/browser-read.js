import { spawn } from 'node:child_process'
import { createConnection } from 'node:net'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { crc32 } from 'node:zlib'

/**
 * The read budget: same cap cloak_fetch uses, so one page can never flood a
 * reply. Longer pages are cut with `truncated: true`.
 */
const MAX_CONTENT_CHARS = 128000

/** Mirrors tool-acquisition's deriveBrowserPort(): one deployment, one port. */
const PORT_BASE = 20_000
const PORT_SPAN = 20_000

/** One command's budget over the local TCP channel. */
const COMMAND_TIMEOUT_MS = 30_000

/** How long a cold browser_server.py may take to answer READY. */
const START_TIMEOUT_MS = 60_000

/**
 * The agent-facing reader for the page the user has open in the built-in
 * browser (right-sidebar panel).
 *
 * The panel and the agent share one CloakBrowser session page — the same page
 * the user is looking at, with their cookies. This tool reads that live page
 * (url / title / visible text) through browser_server.py's `panel_state` +
 * `debug_evaluate` ops on the deployment's derived TCP port, exactly like the
 * panel's own commands do. It never opens or closes a page.
 *
 * @param runtime - the dsh-cloakbrowser cloakRuntime (root/pythonBin/scriptsDir).
 * @returns a dsh tool definition ({name, description, parameters, output, execute}).
 */
export function browserReadTool(runtime) {
  const projectRoot = path.resolve(runtime.root, '..')
  const port = PORT_BASE + ((crc32(Buffer.from(projectRoot)) >>> 0) % PORT_SPAN)
  let starting = null

  /** Send one line-JSON command to browser_server; null when unreachable. */
  function send(req, timeoutMs = COMMAND_TIMEOUT_MS) {
    return new Promise((resolve) => {
      const socket = createConnection({ host: '127.0.0.1', port })
      let buffer = ''
      let settled = false
      const done = (value) => {
        if (settled) return
        settled = true
        socket.destroy()
        resolve(value)
      }
      socket.setTimeout(timeoutMs, () => { done(null) })
      socket.on('error', () => { done(null) })
      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf-8')
        const newline = buffer.indexOf('\n')
        if (newline === -1) return
        try {
          done(JSON.parse(buffer.slice(0, newline)))
        } catch {
          done(null)
        }
      })
      socket.on('connect', () => {
        socket.write(`${JSON.stringify(req)}\n`)
      })
    })
  }

  /** Reach the service on the derived port; spawn one (pythonw, hidden) when none answers. */
  async function ensureService() {
    if (await send({ op: 'ping' })) return true
    if (starting !== null) return starting
    starting = (async () => {
      const script = path.join(runtime.scriptsDir, 'browser_server.py')
      if (!existsSync(runtime.pythonBin) || !existsSync(script)) {
        throw new Error(`browser service not provisioned (${runtime.pythonBin} / ${script})`)
      }
      await new Promise((resolveStart, rejectStart) => {
        const child = spawn(runtime.pythonBin, [script, '--port', String(port)], {
          cwd: runtime.root,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'ignore'],
        })
        let output = ''
        const timer = setTimeout(() => {
          child.kill()
          rejectStart(new Error('browser service did not report READY in time'))
        }, START_TIMEOUT_MS)
        child.once('error', (err) => {
          clearTimeout(timer)
          rejectStart(err)
        })
        child.once('exit', (code) => {
          clearTimeout(timer)
          if (code !== 0 && code !== null) rejectStart(new Error(`browser service exited with code ${code}`))
        })
        child.stdout.on('data', (chunk) => {
          output += chunk.toString('utf-8')
          if (output.includes('READY ')) {
            clearTimeout(timer)
            // Drained for the rest of the service's life; its stdout contract
            // is the one READY line, already consumed.
            child.stdout.resume()
            resolveStart()
          }
        })
      })
      return true
    })().finally(() => { starting = null })
    return starting
  }

  return {
    name: 'browser_read_current',
    description:
      'Read the page the user currently has open in the built-in browser (right-sidebar "内置浏览器" panel / the shared CloakBrowser session): returns its url, title and visible text. Use when the user asks about what they are looking at, e.g. "summarize the page I have open" or "what video am I watching". Reads the live shared page with the user\'s login state; never opens or closes a page.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          url: { type: 'string' },
          title: { type: 'string' },
          chars: { type: 'integer' },
          truncated: { type: 'boolean' },
          text: { type: 'string' },
          error: { type: 'string' },
        },
        required: ['ok'],
      },
      render: (_args, value) => {
        if (!value.ok) return [{ type: 'text', text: `browser_read_current failed: ${value.error}` }]
        const head = `url: ${value.url}\ntitle: ${value.title}\nchars: ${value.chars} truncated: ${value.truncated}`
        return [{ type: 'text', text: `${head}\n\n${value.text}` }]
      },
    },
    async execute(_args, exec) {
      try {
        await ensureService()
      } catch (err) {
        return { ok: false, error: String(err?.message ?? err) }
      }
      const onAbort = () => { /* local sockets die with the process; nothing to release */ }
      exec?.signal?.addEventListener?.('abort', onAbort, { once: true })
      try {
        const state = await send({ op: 'panel_state' })
        if (state === null) return { ok: false, error: 'browser service unreachable' }
        if (state.ok !== true) return { ok: false, error: String(state.error ?? 'panel_state failed') }
        if (state.has_page !== true) {
          return { ok: false, error: 'The built-in browser has no open page (the user is not looking at anything right now).' }
        }
        const extracted = await send({
          op: 'debug_evaluate',
          expression: '(() => ({ href: location.href, title: document.title, text: document.body?.innerText ?? "" }))()',
        })
        if (extracted === null) return { ok: false, error: 'browser service unreachable' }
        if (extracted.ok !== true) return { ok: false, error: String(extracted.error ?? 'debug_evaluate failed') }
        const result = extracted.result ?? {}
        const raw = typeof result.text === 'string' ? result.text : ''
        const chars = raw.length
        const truncated = chars > MAX_CONTENT_CHARS
        return {
          ok: true,
          url: typeof result.href === 'string' && result.href !== '' ? result.href : String(state.url ?? ''),
          title: typeof result.title === 'string' ? result.title : String(state.title ?? ''),
          chars,
          truncated,
          text: truncated ? raw.slice(0, MAX_CONTENT_CHARS) : raw,
        }
      } finally {
        exec?.signal?.removeEventListener?.('abort', onAbort)
      }
    },
  }
}
