import type { Browser } from 'playwright'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const rust = readFileSync('src-tauri/src/service/patch/mobile_composer.rs', 'utf8')
function value(name: string): string {
  const match = new RegExp(`const ${name}: &str = (?:r#"([\\s\\S]*?)"#|"((?:\\\\.|[^"\\\\])*)");`).exec(rust)
  if (!match)
    throw new Error(`Missing Rust patch constant ${name}`)
  return match[1] ?? JSON.parse(`"${match[2]}"`) as string
}
const require = createRequire(import.meta.url)
const original = readFileSync(require.resolve('@deepseek-ai/dsh-client-ui-conversation/client'), 'utf8')
let source = original
for (const name of ['KEYMAP', 'ENTER', 'AUTOFOCUS', 'ROOT']) {
  const anchor = value(name)
  expect(source.split(anchor).length - 1, `真实上游 ${name} 必须唯一匹配`).toBe(1)
  source = source.replace(anchor, name === 'KEYMAP' ? value('MOBILE') + anchor : value(`${name}_PATCHED`))
}
const keymap = source.slice(source.indexOf('function isComposingEvent('), source.indexOf('//#region lib/types/client/input/editor/view-binding.js'))
const focus = source.match(/if \(locked \|\| editor === null \|\| isDshMobileComposer\(\)\) return;\s*focusDraftEditor\(editor, revealSelection\);/)![0]
const lexical = source.slice(source.indexOf('//#region ../../../node_modules/.pnpm/lexical@'), source.indexOf('//#region ../../../node_modules/.pnpm/@lexical+history@'))
const focusEditor = source.slice(source.indexOf('function focusDraftEditor('), source.indexOf('/**\n\t\t* Forward wheel movement'))
const primary = source.slice(source.indexOf('const onPrimary = () => {'), source.indexOf('const claimActive ='))
let browser: Browser
beforeAll(async () => {
  browser = await chromium.launch()
})
afterAll(async () => {
  await browser?.close()
})

describe('mobile composer keyboard policy', () => {
  it.each([
    { mobile: true, enabled: true },
    { mobile: false, enabled: true },
    { mobile: true, enabled: false },
  ])('keeps automatic focus and Enter plugin-specific (mobile=$mobile, enabled=$enabled)', async ({ mobile, enabled }) => {
    const adapted = mobile && enabled
    const page = await browser.newPage({ isMobile: mobile, hasTouch: mobile, viewport: { width: 390, height: 844 } })
    try {
      await page.setContent('<button id="session">session</button><div id="draft" data-composer-input contenteditable="true">hello</div><button id="send">send</button>')
      if (enabled)
        await page.evaluate(() => document.documentElement.setAttribute('data-dsh-mobile-ui', ''))
      await page.evaluate(({ keymap, focus, lexical, focusEditor, primary }) => {
        const root = document.querySelector<HTMLElement>('#draft')!
        // eslint-disable-next-line no-new-func
        const run = new Function(`${lexical}\n${keymap}\n${focusEditor}\nreturn { createEditor: ys, registerPlainText: O$1, registerComposerKeymap, isDshMobileComposer, focusDraftEditor, enter: cn$1 };`)
        const api = run()
        const editor = api.createEditor({
          namespace: 'mobile-composer-regression',
          onError: (error: Error) => {
            throw error
          },
        })
        api.registerPlainText(editor)
        editor.setRootElement(root)
        let sends = 0
        api.registerComposerKeymap(editor, {
          arbitrate: () => 'pass',
          canSubmit: () => true,
          submit: () => { sends++ },
          dismissPopup: () => {},
        })
        // eslint-disable-next-line no-new-func
        const automaticFocus = new Function('locked', 'editor', 'isDshMobileComposer', 'focusDraftEditor', 'revealSelection', focus)
        document.querySelector('#session')!.addEventListener('click', () => {
          editor.setRootElement(null)
          editor.setRootElement(root)
          automaticFocus(false, editor, api.isDshMobileComposer, api.focusDraftEditor, () => {})
        })
        // eslint-disable-next-line no-new-func
        const primaryAction = new Function('primaryStops', 'stop', 'keyboard', 'empty', 'disabled', 'machineBusy', 'uploadsPending', 'primarySubmitMode', `${primary}; return onPrimary;`)
        const onPrimary = primaryAction(false, undefined, {
          submit: () => {
            sends++
          },
        }, false, false, false, false, 'queue')
        document.querySelector('#send')!.addEventListener('click', onPrimary)
        Object.assign(window, { sends: () => sends, virtualEnter: () => editor.dispatchCommand(api.enter, null) })
      }, { keymap, focus, lexical, focusEditor, primary })
      await page.locator('#session').click()
      expect(await page.locator('#draft').evaluate(element => document.activeElement === element), '手机切换会话不得自动聚焦，桌面仍聚焦').toBe(!adapted)
      await page.locator('#draft').click()
      await page.keyboard.type('hello')
      await page.locator('#session').click()
      expect(await page.locator('#draft').evaluate(element => document.activeElement === element), '重绑已有草稿也不得在手机自动聚焦').toBe(!adapted)
      await page.locator('#draft').click()
      await page.keyboard.press('Enter')
      expect(await page.evaluate(() => (window as unknown as { sends: () => number }).sends()), '手机 Enter 不发送').toBe(adapted ? 0 : 1)
      if (adapted) {
        expect(await page.locator('#draft').evaluate(element => element.querySelectorAll('div, br').length), '手机 Enter 应保留原生换行节点').toBeGreaterThan(0)
        await page.keyboard.press('Control+Enter')
        expect(await page.evaluate(() => (window as unknown as { sends: () => number }).sends()), '手机组合回车也不发送').toBe(0)
      }
      await page.evaluate(() => (window as unknown as { virtualEnter: () => void }).virtualEnter())
      expect(await page.evaluate(() => (window as unknown as { sends: () => number }).sends()), '无 KeyboardEvent 的虚拟回车也按设备选择换行或发送').toBe(adapted ? 0 : 2)
      await page.locator('#send').click()
      expect(await page.evaluate(() => (window as unknown as { sends: () => number }).sends()), '实际上游按钮处理函数仍可发送').toBe(adapted ? 1 : 3)
    }
    finally {
      await page.close()
    }
  })
})
