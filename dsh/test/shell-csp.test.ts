import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * 壳层与本地实例同属回环：远端机器在 `remote-*` 弹窗里以 `http://127.0.0.1:<port>`
 * 作为文档来源，壳层也要放行本地实例来源。ssh 数据面已改走
 * `@tauri-apps/plugin-http`（请求在内核侧发出，不受文档 CSP 约束），但 CSP 漏掉
 * 本地实例来源仍会让 iframe/窗口加载被拒，控制台只刷「Refused to connect because
 * it violates the document's Content Security Policy」。端口因占用冲突会自动递增
 * （见后端 runtime info），所以只能按 host 通配。
 */
const config = JSON.parse(
  readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'),
) as { app: { security: Record<'csp' | 'devCsp', string> } }

const serviceOrigin = /DSH_HOST: &str = "([^"]+)"/.exec(
  readFileSync(new URL('../src-tauri/src/config/constants.rs', import.meta.url), 'utf8'),
)?.[1]

describe('shell CSP loopback data plane', () => {
  it('reads the loopback service host from the Rust constants', () => {
    expect(serviceOrigin).toBe('http://127.0.0.1')
  })

  it.each(['csp', 'devCsp'] as const)('%s lets the shell fetch the local dsh instance', (key) => {
    const connectSrc = /(?:^|; )connect-src ([^;]+)/.exec(config.app.security[key])?.[1] ?? ''
    expect(connectSrc).toContain(`${serviceOrigin}:*`)
  })
})
