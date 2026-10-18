import postcss from 'postcss'
import { describe, expect, it, vi } from 'vitest'
import { cssr } from '../../../../dsh-tauri-ui/src/client/utils/cssr'
import { MOBILE_MEDIA_QUERIES } from '../../../../dsh-tauri/src/client/utils/device'
import mobileStyle from './mobile.cssr'

vi.mock('dsh-tauri/client', () => ({ MOBILE_MEDIA_QUERIES }))
vi.mock('dsh-tauri-ui/client', () => ({ cssr }))

describe('mobile conversation layout', () => {
  const root = postcss.parse(mobileStyle.render())

  it('keeps the existing mobile layout overrides scoped to touch devices', () => {
    const media = root.nodes.find(node => node.type === 'atrule' && node.name === 'media' && node.params === '(hover: none) and (any-pointer: coarse) and (any-hover: none)')
    expect(media?.type).toBe('atrule')
    if (media?.type !== 'atrule')
      throw new Error('Missing mobile media query')
    expect(media.params).toBe('(hover: none) and (any-pointer: coarse) and (any-hover: none)')
    const css = media.toString()
    for (const selector of [
      '[data-dsh-mobile-preferences]',
      '[data-slot="conversation.composer.bar"] [class$="_dock"]',
      '[class$="_composerStack"] > [data-slot="conversation.input.dock"]',
      '[class$="_turnErrorCode"]',
      '[data-slot="conversation.header"] [class$="_header"]',
      '[data-slot="main"] header[class*="_pageHead"]',
      '[data-slot="conversation.view"] [class$="_scroll"]',
      '[class*="_userStack"]',
      '[data-slot="main"] [data-conversation-scroll]',

    ]) {
      expect(css).toContain(selector)
    }
  })

  it('keeps the extension panel’s embedded official page head out of the main-slot clearance', () => {
    const matches: Array<{ selector: string, paddingTop: string }> = []
    root.walkRules(/header\[class\*="_pageHead"\]/, (rule) => {
      let paddingTop = ''
      rule.walkDecls('padding-top', (decl) => {
        paddingTop = `${decl.value}${decl.important ? ' !important' : ''}`
      })
      matches.push({ selector: rule.selector, paddingTop })
    })
    expect(matches).toEqual([{
      selector: '[data-slot="main"] header[class*="_pageHead"]:not([data-dsh-extension-plugins] *)',
      paddingTop: '24px !important',
    }])
  })

  it('positions the drawer without relying on the upstream collapsed marker', () => {
    const css = root.toString()
    for (const selector of [
      'html[data-dsh-mobile-sidebar] [data-slot="root"] > [class$="_frame"]',
      'html[data-dsh-mobile-sidebar] [class$="_sidebarCol"]',
      'html[data-dsh-mobile-sidebar] body [data-slot="sidebar"]',
      'html[data-dsh-mobile-sidebar] [class$="_centerCol"]',
      'html[data-dsh-mobile-sidebar-open] [data-dsh-mobile-sidebar-shade]',
      '[data-dsh-mobile-topbar]',
    ]) {
      expect(css).toContain(selector)
    }
    expect(css).toContain('grid-template-columns: minmax(0, 1fr) !important')
    expect(css).not.toContain('[data-sidebar-collapsed]')
  })

  const declarations = (selector: string): Record<string, string> => {
    const values: Record<string, string> = {}
    root.walkRules(selector, (rule) => {
      rule.walkDecls((decl) => {
        values[decl.prop] = `${decl.value}${decl.important ? ' !important' : ''}`
      })
    })
    return values
  }

  it('keeps the sidebar stationary behind a raised rounded main panel without a gray shade', () => {
    expect(declarations('html[data-dsh-mobile-sidebar] [class$="_sidebarCol"]')).toMatchObject({
      'z-index': '0',
      'transform': 'none',
    })
    expect(declarations('html[data-dsh-mobile-sidebar] [class$="_centerCol"]')).toMatchObject({
      'position': 'absolute',
      'inset': '0',
      'z-index': '1',
      'transform': 'translate3d(var(--dsh-mobile-sidebar-offset), 0, 0)',
      '--dsh-mobile-sidebar-radius': 'clamp(0px, calc(var(--dsh-mobile-sidebar-offset) / 10), 24px)',
      'border-radius': 'var(--dsh-mobile-sidebar-radius) 0 0 var(--dsh-mobile-sidebar-radius)',
      'corner-shape': 'round',
      'background-color': 'Canvas',
      'background-image': 'linear-gradient(var(--dsw-alias-bg-base, Canvas), var(--dsw-alias-bg-base, Canvas))',
      'box-shadow': 'none',
    })
    expect(declarations('html[data-dsh-mobile-sidebar] body [data-slot="sidebar"]')).toMatchObject({
      // 终端模式外观会在折叠标记下隐藏侧栏，抽屉接管时用更高特异度还原可见性。
      visibility: 'visible',
    })
    expect(declarations('html[data-dsh-mobile-sidebar-open] [class$="_centerCol"], html[data-dsh-mobile-sidebar-dragging] [class$="_centerCol"]')).toMatchObject({
      'box-shadow': 'var(--dsw-shadow-lv3)',
    })
    expect(declarations('[data-dsh-mobile-sidebar-shade]').background).toBe('transparent')
    expect(declarations('html[data-dsh-mobile-sidebar] [data-side="sidebar"]').display).toBe('none !important')
    expect(declarations('[data-dsh-mobile-topbar]')).toMatchObject({
      position: 'sticky',
      top: '0',
    })
  })

  it('keeps the navbar controls as naked icons without button backgrounds or shadows', () => {
    for (const selector of ['[data-dsh-mobile-sidebar-toggle]', '[data-dsh-mobile-new-session]']) {
      expect(declarations(selector)).toMatchObject({
        'padding': '0',
        'border': '0',
        'background': 'transparent',
        'box-shadow': 'none',
      })
    }
  })

  it('renders the mobile sidebar icon at 20px inside the touch media query', () => {
    expect(declarations('[data-dsh-mobile-sidebar-toggle]')).toMatchObject({ width: '20px', height: '20px' })
    const rules: unknown[] = []
    root.walkRules('[data-dsh-mobile-sidebar-toggle]', (rule) => {
      rules.push(rule)
      expect(rule.parent?.type).toBe('atrule')
      if (rule.parent?.type === 'atrule')
        expect(rule.parent.params).toBe('(hover: none) and (any-pointer: coarse) and (any-hover: none)')
    })
    expect(rules).toHaveLength(1)
  })

  it('keeps the new-session icon at 24px', () => {
    expect(declarations('[data-dsh-mobile-new-session]')).toMatchObject({ width: '24px', height: '24px' })
    const rules: unknown[] = []
    root.walkRules('[data-dsh-mobile-new-session]', (rule) => {
      rules.push(rule)
      expect(rule.parent?.type).toBe('atrule')
      if (rule.parent?.type === 'atrule')
        expect(rule.parent.params).toBe('(hover: none) and (any-pointer: coarse) and (any-hover: none)')
    })
    expect(rules).toHaveLength(1)
  })

  it('overrides conversation scroll bottom padding to zero inside the mobile media query', () => {
    const declarations: unknown[] = []
    root.walkRules('[data-slot="main"] [data-conversation-scroll]', (rule) => {
      const parent = rule.parent
      expect(parent?.type).toBe('atrule')
      if (parent?.type === 'atrule')
        expect(parent.params).toBe('(hover: none) and (any-pointer: coarse) and (any-hover: none)')
      rule.walkDecls((decl) => {
        declarations.push([decl.prop, decl.value, decl.important])
      })
    })
    expect(declarations).toEqual([['padding-bottom', '0', true]])
  })
})
