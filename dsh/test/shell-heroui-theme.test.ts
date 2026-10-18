import type { Rule } from 'postcss'
import { globSync } from 'node:fs'
import { parse } from 'postcss'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { button } from '../src/components/primitives'
import { readSource } from './setup/read-source'

const css = parse(readSource('src/styles/main.css'))

function declarations(selector: string): Record<string, string> {
  const values: Record<string, string> = {}
  css.walkRules(selector, (rule) => {
    rule.walkDecls(({ prop, value }) => {
      values[prop] = value
    })
  })
  return values
}

function heroRadiusOverrides(path: string): string[] {
  const source = ts.createSourceFile(path, readSource(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const imports = new Set<string>()
  const overrides: string[] = []
  for (const node of source.statements) {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier) || node.moduleSpecifier.text !== '@heroui/react')
      continue
    const bindings = node.importClause?.namedBindings
    if (bindings && ts.isNamedImports(bindings)) {
      for (const specifier of bindings.elements)
        imports.add(specifier.name.text)
    }
  }
  function visit(node: ts.Node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const name = node.tagName.getText(source).split('.')[0]
      if (imports.has(name)) {
        for (const attribute of node.attributes.properties) {
          if (ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'className') {
            const text = attribute.initializer?.getText(source) ?? ''
            if (/\brounded(?:\b|-)/.test(text))
              overrides.push(`${node.tagName.getText(source)}: ${text}`)
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return overrides
}

describe('壳层 HeroUI 通过官方主题机制对齐 dsh', () => {
  it('半径基准使 xs/sm/md/lg 分别为 4/8/12/16px，输入框为 12px', () => {
    expect(declarations(':root')).toMatchObject({
      '--radius': '16px',
      '--field-radius': '12px',
    })
  })

  it('主题扩展将大圆角映射到 dsh 的 20/24/28/32px', () => {
    const radii: Record<string, string> = {}
    css.walkAtRules('theme', (rule) => {
      expect(rule.params).toBe('inline')
      rule.walkDecls(({ prop, value }) => {
        radii[prop] = value
      })
    })
    expect(radii).toEqual({
      '--radius-xl': 'calc(var(--radius) * 1.25)',
      '--radius-2xl': 'calc(var(--radius) * 1.5)',
      '--radius-3xl': 'calc(var(--radius) * 1.75)',
      '--radius-4xl': 'calc(var(--radius) * 2)',
    })
  })

  it.each([
    ['.button', ['border-radius: var(--radius-md)']],
    ['.button--sm', ['border-radius: var(--radius-sm)']],
    ['.button--lg', ['border-radius: var(--radius-lg)']],
    ['.card', ['border-radius: var(--radius-lg)']],
    ['.dropdown__popover', ['border-radius: var(--radius-lg)']],
    ['.select__popover', ['border-radius: var(--radius-lg)']],
    ['.popover', ['border-radius: var(--radius-lg)']],
    ['.toast', ['border-radius: var(--radius-lg)']],
    ['.menu-item', ['border-radius: var(--radius-md)', 'min-height: calc(var(--spacing) * 3)']],
    ['.list-box-item', ['border-radius: var(--radius-md)', 'min-height: calc(var(--spacing) * 3)']],
    ['.tooltip', ['border-radius: var(--radius-sm)']],
    ['.close-button', ['border-radius: var(--radius-sm)']],
    ['.checkbox__control', ['border-radius: var(--radius-xs)']],
    ['.checkbox__control::before', ['border-radius: inherit']],
  ])('%s 的 BEM 全局定制仅设置预期声明', (selector, expected) => {
    const rules: Rule[] = []
    css.walkRules((rule) => {
      const parent = rule.parent
      if (parent?.type === 'atrule' && parent.name === 'layer' && parent.params === 'components' && rule.selectors.includes(selector))
        rules.push(rule)
    })
    expect(rules).toHaveLength(1)
    expect(rules[0].nodes?.map(node => node.toString())).toEqual(expected)
  })

  it('标签沿用 HeroUI 默认胶囊，不添加重复的 BEM 圆角定制', () => {
    expect(declarations('.chip')).toEqual({})
  })

  it('蒙版使用 dsh bg-mask-1：深色黑色 50%、浅色黑色 24%', () => {
    expect(declarations(':root')['--backdrop']).toBe('rgba(0, 0, 0, 0.5)')
    expect(declarations('html[data-theme="light"]')['--backdrop']).toBe('rgba(0, 0, 0, 0.24)')
  })

  it('原生运行期恢复蒙版复用 HeroUI backdrop，不再硬编码 40%', () => {
    const recovery = readSource('src/ui/plugin/recovery.tsx')
    expect(recovery).toContain('fixed inset-0 z-50 flex items-center justify-center bg-backdrop p-4')
    expect(recovery).not.toContain('bg-black/40')
  })

  it('所有壳层 HeroUI 组件都不再用 rounded 工具类覆盖主题', () => {
    const paths = globSync('src/**/*.tsx', { cwd: new URL('../', import.meta.url) })
      .filter(path => !path.endsWith('.test.tsx'))
    expect(paths.length).toBeGreaterThan(0)
    const overrides = paths.flatMap(path => heroRadiusOverrides(path).map(override => `${path}: ${override}`))
    expect(overrides).toEqual([])
  })

  it('操作 Chip 样式变体不再携带隐藏圆角覆盖', () => {
    const plugin = readSource('src/ui/config/plugin.tsx')
    const actionChip = plugin.slice(plugin.indexOf('const actionChip = tv('), plugin.indexOf('const QUEUED_ACTIONS'))
    expect(actionChip).toContain('cursor-not-allowed opacity-50')
    expect(actionChip).toContain('cursor-pointer')
    expect(actionChip).not.toMatch(/\brounded(?:\b|-)/)
  })

  it.each(['sm', 'md'] as const)('加载页原生 %s 按钮共享官方主题圆角，不保留硬编码胶囊半径', (size) => {
    const classes = button({ size }).split(/\s+/)
    expect(classes.filter(className => className.startsWith('rounded'))).toEqual([`rounded-${size}`])
    expect(readSource('src/components/primitives.ts')).not.toContain('rounded-[')
  })

  it('加载页原生按钮不重复声明内联圆角', () => {
    expect(readSource('src/layout/components/loadable.tsx')).not.toContain('borderRadius')
    expect(readSource('src/layout/components/setup.tsx')).not.toContain('borderRadius')
  })
})
