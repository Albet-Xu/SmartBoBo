// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readSource } from './setup/read-source'

/**
 * 剪贴板图片回退桥的协议契约（issue #610）。
 *
 * Linux/WebKitGTK 下 iframe 的 paste 事件拿不到图片，由注入脚本
 * （`src-tauri/src/desktop/paste.rs` 的 `PASTE_SHIM_JS`）向宿主请求原生读取，
 * 宿主（`src/layout/components/iframe.tsx`）回包后重新合成一次 paste。
 *
 * 宿主 → iframe 的桥统一由 `useIframePost` 补 `source: 'dsh-desktop'`，只按 `type`
 * 识别。回包若改用自定义 `source`，注入脚本仍按 `source` 过滤就会把回包丢掉，
 * 贴图静默失败（0.15.5 的回归）。这些用例把两端的字面量与匹配方式锁在一起。
 */
const REPLY_TYPE = 'dsh://clipboard-image:reply'

describe('clipboard image bridge protocol', () => {
  const shim = readSource('src-tauri/src/desktop/paste.rs')
  const iframe = readSource('src/layout/components/iframe.tsx')

  it('replies with the type the injected shim waits for', () => {
    expect(shim).toContain(`var RES_TYPE = '${REPLY_TYPE}'`)
    expect(iframe).toContain(`type: '${REPLY_TYPE}'`)
  })

  it('identifies the host reply by type instead of source', () => {
    expect(shim).toContain('data.type !== RES_TYPE')
    expect(shim).not.toContain('RES_SRC')
    expect(shim).not.toContain('data.source !==')
    expect(iframe).not.toContain(`source: '${REPLY_TYPE}'`)
  })

  it('only accepts replies from the direct parent window', () => {
    expect(shim).toContain('event.source !== window.parent')
  })
})
