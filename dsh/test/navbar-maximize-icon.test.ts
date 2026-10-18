/**
 * navbar-maximize-icon.test.ts — 标题栏最大化按钮的字形契约（issue #673）。
 *
 * 该按钮是自绘的：最大化后必须换成「还原」字形并同步 aria-label，未最大化时保持
 * 单方块。与 `menu-restart.test.ts` 同一姿势——壳层组件的契约以源码关系断言锁定，
 * 因为 `unit` project 是 node 环境（无 DOM/渲染器），拿不到真实渲染结果。
 */
import { describe, expect, it } from 'vitest'
import { readLocale, readSource } from './setup/read-source'

const navbarSource = readSource('src/layout/components/navbar.tsx')

const zhCN = readLocale('zh-CN')
const enUS = readLocale('en-US')

describe('maximize button follows the window state', () => {
  it('reads isMaximized() and subscribes to onResized for the maximize state', () => {
    // 断言「订阅来源」而非孤立 token：初读 + resize 重读缺一不可，
    // 只留其中一个都会让拖拽区双击 / Win+↑ 等原生路径漏同步。
    expect(navbarSource).toMatch(/const isMaximized = useMaximized\(\)/)
    expect(navbarSource).toMatch(/await appWindow\.isMaximized\(\)/)
    expect(navbarSource).toMatch(/await appWindow\.onResized\(/)
  })

  it('swaps the glyph between Copy (restore) and Square (maximize)', () => {
    // 断言 then/else 与 cond 的绑定关系：把 Copy/Square 写反、或丢掉 cond 都判红。
    expect(navbarSource).toMatch(
      /cond=\{isMaximized\}[\s\S]*?then=\{<Copy[\s\S]*?else=\{<Square/,
    )
  })

  it('switches the aria-label together with the glyph', () => {
    expect(navbarSource).toMatch(
      /aria-label=\{t\(isMaximized \? 'nav\.restore' : 'nav\.maximize'\)\}/,
    )
  })
})

describe('nav.restore locale keys', () => {
  it('provides the restore label in both locales, next to nav.maximize', () => {
    // 断言键→值的关系：token 出现在无关位置（如注释）不算通过。
    expect(zhCN['nav.restore']).toBe('还原')
    expect(enUS['nav.restore']).toBe('Restore')
    expect(zhCN['nav.maximize']).toBe('最大化')
    expect(enUS['nav.maximize']).toBe('Maximize')
  })
})
