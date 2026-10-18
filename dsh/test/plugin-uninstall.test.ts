import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// ── Suite A — i18n keys exist (source assertion on JSON) ─────────────────────
describe('plugin preset chip i18n keys', () => {
  it('provides plugins.preset in en-US = "Preset"', () => {
    const source = readFileSync(new URL('../src/i18n/locales/en-US.json', import.meta.url), 'utf8')
    const messages = JSON.parse(source) as Record<string, string>
    expect(messages).toHaveProperty('plugins.preset')
    expect(messages['plugins.preset']).toBe('Preset')
  })

  it('provides plugins.preset in zh-CN = "预设"', () => {
    const source = readFileSync(new URL('../src/i18n/locales/zh-CN.json', import.meta.url), 'utf8')
    const messages = JSON.parse(source) as Record<string, string>
    expect(messages).toHaveProperty('plugins.preset')
    expect(messages['plugins.preset']).toBe('预设')
  })

  it('updates plugins.panel_tooltip in en-US to mention uninstall', () => {
    const source = readFileSync(new URL('../src/i18n/locales/en-US.json', import.meta.url), 'utf8')
    const messages = JSON.parse(source) as Record<string, string>
    expect(messages['plugins.panel_tooltip']).toContain('Preset plugins can be uninstalled here')
  })

  it('updates plugins.panel_tooltip in zh-CN to mention uninstall', () => {
    const source = readFileSync(new URL('../src/i18n/locales/zh-CN.json', import.meta.url), 'utf8')
    const messages = JSON.parse(source) as Record<string, string>
    expect(messages['plugins.panel_tooltip']).toContain('预设插件可在此卸载')
  })
})

describe('one-click plugin upgrade messages', () => {
  it.each([
    ['en-US', 'Upgrade All', 'Upgrade or repair all {{count}} available plugins', 'No plugins available to upgrade'],
    ['zh-CN', '一键升级', '升级或修复全部可操作的插件（{{count}}）', '暂无可升级的插件'],
  ] as const)('provides the %s bulk upgrade label and hints', (locale, label, hint, empty) => {
    const source = readFileSync(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url), 'utf8')
    const messages = JSON.parse(source) as Record<string, string>
    expect(messages).toMatchObject({
      'plugins.upgrade_all': label,
      'plugins.upgrade_all_hint': hint,
      'plugins.upgrade_all_empty': empty,
    })
  })
})

// ── Suite B — component references the preset key + condition ────────────────
describe('configPlugin preset chip', () => {
  it('renders the plugins.preset key', () => {
    const source = readFileSync(new URL('../src/ui/config/plugin.tsx', import.meta.url), 'utf8')
    expect(source).toContain('plugins.preset')
  })

  it('renders internal plugins in a collapsible group instead of hiding them', () => {
    const source = readFileSync(new URL('../src/ui/config/plugin.tsx', import.meta.url), 'utf8')
    expect(source, '内置插件分组标题').toContain('plugins.builtin_title')
    expect(source, '内置插件默认折叠').toContain('const [showInternal, toggleShowInternal] = useToggle()')
    expect(source, '内置插件与可管理插件分开成两个列表').toContain('const managedPlugins = plugins.filter(plugin => !plugin.internal)')
    expect(source, '内置插件行由分组条件渲染').toContain('cond={internalPlugins.length > 0}')
  })

  it('drives the empty state from the managed list only', () => {
    const source = readFileSync(new URL('../src/ui/config/plugin.tsx', import.meta.url), 'utf8')
    // 仅剩内置插件时，可管理列表为空态必须显式提示，而不是留下悬空的折叠分组。
    expect(source, '空态绑定可管理插件列表').toContain(`<If cond={managedPlugins.length > 0} else={<Empty>{t('plugins.empty')}</Empty>}>`)
  })

  it('guards the chip on recommended (preset, non-internal)', () => {
    const source = readFileSync(new URL('../src/ui/config/plugin.tsx', import.meta.url), 'utf8')
    // 预设 chip 只对「预设且非内置」渲染：内置插件即便在预设清单中也不打「预设」标。
    expect(source, '预设 chip 仅对非内置的 recommended 渲染').toContain('cond={!plugin.internal && plugin.recommended}')
    // 内置插件保留「内置」徽标，但与普通插件分组隔离。
    expect(source).toContain('plugins.builtin')
  })

  it('allows internal toggles while withholding uninstall/snapshot', () => {
    const source = readFileSync(new URL('../src/ui/config/plugin.tsx', import.meta.url), 'utf8')
    expect(source, '禁用入口包含内置插件').toContain('cond={!plugin.patchDisabled && !plugin.disabled}')
    expect(source, '启用入口包含内置插件的桌面禁用态').toContain('cond={plugin.patchDisabled || plugin.disabled}')
    expect(source, '快照入口由 !plugin.internal 守卫').toContain('<If cond={!plugin.internal}>')
  })

  it('hides the snapshot entries behind a default-off advanced toggle', () => {
    const source = readFileSync(new URL('../src/ui/config/plugin.tsx', import.meta.url), 'utf8')
    expect(source, '高级选项默认关闭').toContain('const [advanced, toggleAdvanced] = useToggle()')
    expect(source, '快照入口受高级选项控制').toContain('<If cond={advanced}>')
    expect(source, '控件挂在「打开预设」左侧').toContain('plugins.advanced_options')
  })
})

// ── Suite C — uninstall routes through the manager + settles without a restart prompt ──
describe('configPlugin uninstall flow', () => {
  it('routes uninstall through the manager batch command', () => {
    const panel = readFileSync(new URL('../src/ui/config/plugin.tsx', import.meta.url), 'utf8')
    const store = readFileSync(new URL('../src/store/modules/plugins/store.ts', import.meta.url), 'utf8')

    expect(panel).toContain('manager.uninstall')
    expect(panel).not.toContain('remove_dsh_plugin')
    expect(store).toContain('remove_dsh_plugins')
  })

  it('settles results without offering a restart', () => {
    const store = readFileSync(new URL('../src/store/modules/plugins/store.ts', import.meta.url), 'utf8')

    // 队列自己热更新插件：结果气泡不挂「重启」按钮，也不再让气泡常驻
    expect(store).not.toContain('restartAction')
    expect(store).not.toContain('actionProps: restart')
  })

  it('shows a confirm dialog before uninstall', () => {
    const source = readFileSync(new URL('../src/ui/config/plugin.tsx', import.meta.url), 'utf8')
    expect(source).toContain('remove_confirm_title')
  })
})
