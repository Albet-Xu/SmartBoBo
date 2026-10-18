import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('plugin disable/enable frontend contract', () => {
  it('config-plugin.tsx defines onDisable and onEnable handlers', () => {
    const source = readFileSync(new URL('../src/ui/config/plugin.tsx', import.meta.url), 'utf8')

    expect(source).toContain('onDisable')
    expect(source).toContain('onEnable')
  })

  it('config-plugin.tsx routes disable/enable through the plugin manager', () => {
    const panel = readFileSync(new URL('../src/ui/config/plugin.tsx', import.meta.url), 'utf8')
    const manager = readFileSync(new URL('../src/store/modules/plugins/store.ts', import.meta.url), 'utf8')

    expect(panel).toContain('manager.disable')
    expect(panel).toContain('manager.enable')
    // 宿主命令归管理器统一派发，面板不得再各自持有 mutation
    expect(panel).not.toContain('disable_dsh_plugin')
    expect(panel).not.toContain('enable_dsh_plugin')
    expect(manager).toContain('disable_dsh_plugin')
    expect(manager).toContain('enable_dsh_plugin')
  })

  it('config-plugin.tsx renders a Disabled badge via plugins.disabled_badge', () => {
    const source = readFileSync(new URL('../src/ui/config/plugin.tsx', import.meta.url), 'utf8')

    expect(source).toContain('plugins.disabled_badge')
  })

  it('config-plugin.tsx extends the busy state union with disable + enable', () => {
    const source = readFileSync(new URL('../src/ui/config/plugin.tsx', import.meta.url), 'utf8')

    expect(source).toContain('\'update\' | \'remove\' | \'disable\' | \'enable\'')
  })

  it('config-plugin.tsx confirms before disabling a built-in plugin', () => {
    const source = readFileSync(new URL('../src/ui/config/plugin.tsx', import.meta.url), 'utf8')

    const onDisableMatch = source.match(/async function onDisable[\s\S]*?\n {2}\}/)
    expect(onDisableMatch).not.toBeNull()
    expect(onDisableMatch![0]).toContain('if (plugin?.internal)')
    expect(onDisableMatch![0]).toContain('await openDialog')
    expect(onDisableMatch![0]).toContain('plugins.disable_builtin_confirm_desc')
  })

  it('the plugin manager owns the single plugin list query and update probe', () => {
    const hook = readFileSync(new URL('../src/hooks/use-plugins-manager.ts', import.meta.url), 'utf8')
    const store = readFileSync(new URL('../src/store/modules/plugins/store.ts', import.meta.url), 'utf8')
    const panel = readFileSync(new URL('../src/ui/config/plugin.tsx', import.meta.url), 'utf8')

    expect(hook).toContain('get_dsh_plugins')
    expect(hook).toContain('queryKeys.plugins')
    expect(store).toContain('refresh_plugin_updates')
    // 面板只消费 manager.installed，不再自行查询（消除重复查询）
    expect(panel).not.toContain('get_dsh_plugins')
    expect(panel).not.toContain('refresh_plugin_updates')
    expect(panel).toContain('manager.installed')
  })

  it('en-US.json contains all 7 disable/enable i18n keys', () => {
    const source = readFileSync(new URL('../src/i18n/locales/en-US.json', import.meta.url), 'utf8')

    expect(source).toContain('"plugins.disable"')
    expect(source).toContain('"plugins.enable"')
    expect(source).toContain('"plugins.disabled_badge"')
    expect(source).toContain('"plugins.disable_toast"')
    expect(source).toContain('"plugins.disable_failed"')
    expect(source).toContain('"plugins.enable_toast"')
    expect(source).toContain('"plugins.enable_failed"')
  })

  it('zh-CN.json contains all 7 disable/enable i18n keys', () => {
    const source = readFileSync(new URL('../src/i18n/locales/zh-CN.json', import.meta.url), 'utf8')

    expect(source).toContain('"plugins.disable"')
    expect(source).toContain('"plugins.enable"')
    expect(source).toContain('"plugins.disabled_badge"')
    expect(source).toContain('"plugins.disable_toast"')
    expect(source).toContain('"plugins.disable_failed"')
    expect(source).toContain('"plugins.enable_toast"')
    expect(source).toContain('"plugins.enable_failed"')
  })

  it('config-plugin.tsx stays within shell conventions (no useCallback/useMemo)', () => {
    const source = readFileSync(new URL('../src/ui/config/plugin.tsx', import.meta.url), 'utf8')

    expect(source).not.toContain('useCallback')
    expect(source).not.toContain('useMemo')
  })
})
