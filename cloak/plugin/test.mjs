import { apply } from './index.js'
import { chromium } from 'playwright-core'

let tool = null
let cleanup = null
const ctx = {
  tools: { register: (t) => { tool = t } },
  effect: (fn) => { cleanup = fn() },
}

const preUp = await fetch('http://127.0.0.1:9333/').then((r) => r.ok).catch(() => false)

await apply(ctx, { port: 9333, readyTimeoutMs: 60000 })
console.log('registered tool:', tool?.name)

const signal = new AbortController().signal

const r1 = await tool.execute({ url: 'https://example.com' }, { signal })
console.log('r1 html:', { ok: r1.ok, title: r1.title, status: r1.status, bytes: r1.bytes })
if (!r1.ok) { console.error('r1 failed:', r1.error); process.exit(1) }

const r2 = await tool.execute({ url: 'https://example.com', format: 'text' }, { signal })
console.log('r2 text:', { ok: r2.ok, bytes: r2.bytes })
if (!r2.ok) { console.error('r2 failed:', r2.error); process.exit(1) }

const r3 = await tool.execute({ url: 'https://example.com', selector: 'p' }, { signal })
console.log('r3 selector p bytes:', { ok: r3.ok, bytes: r3.bytes })
if (!r3.ok) { console.error('r3 failed:', r3.error); process.exit(1) }

const r4 = await tool.execute({ url: 'https://example.com', selector: '#does-not-exist' }, { signal })
console.log('r4 miss selector (expect ok=false):', { ok: r4.ok })
if (r4.ok) { console.error('r4 should fail'); process.exit(1) }

const blocks = tool.output.render({}, r1)
console.log('render blocks:', blocks.length)

const connect = chromium.connectOverCDP ?? chromium.connectOverCdp
const browser = await connect.call(chromium, 'http://127.0.0.1:9333')
const page = await browser.contexts()[0].newPage()
await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 30000 })
const stealth = await page.evaluate(() => ({ webdriver: navigator.webdriver, plugins: navigator.plugins.length }))
console.log('stealth:', JSON.stringify(stealth))
if (stealth.webdriver !== false) { console.error('stealth failed'); process.exit(1) }
await page.close()
await browser.close()

await cleanup()
const stillUp = await fetch('http://127.0.0.1:9333/').then((r) => r.ok).catch(() => false)
console.log(`after dispose up=${stillUp} (was ${preUp})`)
if (stillUp !== preUp) { console.error('dispose lifecycle mismatch'); process.exit(1) }
console.log('E2E OK')
