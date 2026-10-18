// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readSource } from './setup/read-source'

/**
 * 右键菜单平台化提示 + 原生剪贴板读取的接线契约（issue #858）。
 *
 * macOS 上 Web Clipboard 读取拿不到授权，右键「粘贴」只能靠帧内的原生命令；
 * 提示文案与加速键也必须按平台渲染，不能再写死 Ctrl+。这里把菜单、词典、
 * 帧内命令白名单与 Rust 命令注册四处字面量锁在一起，任一处漏改都会被指出。
 */
describe('rightclick 平台化提示', () => {
  const menu = readSource('packages/dsh-tauri-rightclick/src/client/register/context-menu.menu.ts')
  const locale = readSource('packages/dsh-tauri-rightclick/src/client/locales/index.ts')

  it('菜单加速键全部经平台化 helper 渲染，不再写死 Ctrl+', () => {
    expect(menu).not.toMatch(/'Ctrl\+/)
    expect(menu).toContain('shortcutLabel(')
    expect(menu).toContain('redoShortcutLabel()')
  })

  it('失败文案带 {key} 占位符，由调用点注入当前平台键位', () => {
    expect(locale).toContain('clipboardReadFailed: \'无法读取剪贴板，请使用 {key}\'')
    expect(locale).toContain('useUndoShortcut: \'请使用 {key} 撤销\'')
    expect(locale).toContain('useRedoShortcut: \'请使用 {key} 重做\'')
    expect(menu).toContain('locale.text(\'clipboardReadFailed\', { key: shortcutLabel(\'V\') })')
  })
})

describe('rightclick 原生剪贴板读取', () => {
  const clipboard = readSource('packages/dsh-tauri-rightclick/src/client/utils/clipboard.ts')
  const invokeBridge = readSource('src/hooks/use-invoke-iframe.ts')
  const builder = readSource('src-tauri/src/desktop/builder.rs')

  it('桌面载体在发起调用前就分流到 read_clipboard_text', () => {
    expect(clipboard).toContain('invoke<string | null>(\'read_clipboard_text\')')
    expect(clipboard).toContain('\'dshDesktop\' in globalThis')
    expect(clipboard.indexOf('\'dshDesktop\' in globalThis'))
      .toBeLessThan(clipboard.indexOf('navigator.clipboard?.readText'))
  })

  it('命令同时登记在帧内白名单与 Tauri invoke_handler', () => {
    expect(invokeBridge).toContain('\'read_clipboard_text\',')
    expect(builder).toContain('crate::bridge::read_clipboard_text,')
  })
})
