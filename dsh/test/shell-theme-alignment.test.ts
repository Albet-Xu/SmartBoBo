import { describe, expect, it } from 'vitest'
import { readSource } from './setup/read-source'

const css = readSource('src/styles/main.css')
const [darkTheme = '', lightTheme = ''] = css.split(/^html\[data-theme="light"\] \{/m)

const herouiSemanticTokens = [
  'background',
  'foreground',
  'surface',
  'surface-secondary',
  'surface-tertiary',
  'overlay',
  'muted',
  'default',
  'default-foreground',
  'field-background',
  'field-border',
  'field-border-width',
  'success',
  'success-foreground',
  'warning',
  'warning-foreground',
  'danger',
  'danger-foreground',
  'segment',
  'segment-foreground',
  'border',
  'separator',
  'link',
  'scrollbar-thumb',
]

function declares(block: string, token: string) {
  return new RegExp(`^\\s*--${token}:`, 'm').test(block)
}

describe('壳层主题对齐 dsh alias token', () => {
  it('--accent 取 dsw brand-primary（深色白、浅色黑），不再复用蓝色业务色', () => {
    expect(darkTheme).toMatch(/^\s*--accent:\s*#f9fafb;/m)
    expect(lightTheme).toMatch(/^\s*--accent:\s*#0f1115;/m)
    expect(darkTheme).toMatch(/^\s*--accent-foreground:\s*#0f1115;/m)
    expect(lightTheme).toMatch(/^\s*--accent-foreground:\s*#ffffff;/m)
  })

  it('除品牌主色和蒙版外不覆盖 HeroUI 语义变量，保持官方明暗取值', () => {
    const overridden = herouiSemanticTokens.filter(
      token => declares(darkTheme, token) || declares(lightTheme, token),
    )
    expect(overridden).toEqual([])
  })

  it('不再声明与 HeroUI 同名的 --color-accent/--color-muted/--color-danger（会被内联层覆盖成死值）', () => {
    for (const token of ['--color-accent:', '--color-muted:', '--color-danger:']) {
      expect(css).not.toContain(token)
    }
  })

  it('tailwind.config 把同名颜色指向 HeroUI 语义变量，业务蓝改走 info', () => {
    const config = readSource('tailwind.config.js')
    expect(config).toContain('\'muted\': \'var(--muted)\'')
    expect(config).toContain('\'accent\': \'var(--accent)\'')
    expect(config).toContain('\'danger\': \'var(--danger)\'')
    expect(config).toContain('\'info\': \'var(--color-info)\'')
    expect(config).toContain('\'info-hover\': \'var(--color-info-hover)\'')
  })
})
