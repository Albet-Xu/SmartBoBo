/**
 * navbar-run-menu.test.ts — 壳层「运行」菜单与其「应用」项快捷重启按钮的契约。
 *
 * 与 `menu-restart.test.ts` / `navbar-maximize-icon.test.ts` 同一姿势：壳层组件的契约
 * 以源码关系断言锁定（`unit` project 是 node 环境，拿不到真实渲染结果）。
 *
 * 其中的「拦 pointerup」不是洁癖：React Aria 的 pressable 只在 pointerdown / click 上
 * 收口（`usePress` 这两个事件会 `stopPropagation`），pointerup 会一路冒泡到菜单项，
 * 被菜单项的 `usePress` 当成「松手落在我身上」而补发一次 click，连带触发菜单项动作
 * （弹出配置面板）。浏览器实测：去掉外层 pointerup 拦截后，点重启会同时打开「应用」面板。
 */
import { describe, expect, it } from 'vitest'
import { readLocale, readSource } from './setup/read-source'

const navbarSource = readSource('src/layout/components/navbar.tsx')

const zhCN = readLocale('zh-CN')
const enUS = readLocale('en-US')

describe('「运行」菜单标签', () => {
  it('菜单按钮改用 menu.run，不再复用 app.config（对话框标题仍归 app.config）', () => {
    // 断言键→渲染位置的关系：只改语言包不改按钮（或改错按钮）都判红。
    expect(navbarSource).toMatch(/aria-label=\{t\('menu\.run'\)\}/)
    expect(navbarSource).toMatch(/\{t\('menu\.run'\)\}/)
    expect(navbarSource).not.toContain('t(\'app.config\')')
  })

  it('zh/en 两个语言包都提供 menu.run', () => {
    // 断言键→值：token 出现在无关位置（如注释）不算通过。
    expect(zhCN['menu.run']).toBe('运行')
    expect(enUS['menu.run']).toBe('Run')
  })
})

describe('「应用」项里的快捷重启按钮', () => {
  const restartIndex = navbarSource.indexOf('data-testid="dsh-navbar-item-application-restart"')
  const guardStart = navbarSource.lastIndexOf('<span', restartIndex)
  const guardBlock = navbarSource.slice(guardStart, navbarSource.indexOf('</span>', restartIndex))

  it('只在 application 项渲染图标按钮，并绑定 handleQuickRestart', () => {
    expect(restartIndex).toBeGreaterThan(-1)
    expect(navbarSource).toMatch(/<If cond=\{item\.id === 'application'\}>/)
    expect(navbarSource).toMatch(/onPress=\{handleQuickRestart\}/)
    expect(guardBlock).toContain('aria-label={t(\'app.restart\')}')
  })

  it('快捷重启先收起菜单再重启服务', () => {
    expect(navbarSource).toMatch(/<Dropdown isOpen=\{runMenuOpen\} onOpenChange=\{setRunMenuOpen\}>/)
    expect(navbarSource).toMatch(
      /function handleQuickRestart\(\) \{\s*setRunMenuOpen\(false\)\s*void store\.harness\.restart\(\)/,
    )
  })

  it('按钮外层拦住 pointerdown/pointerup/click，避免菜单项补发 click 触发面板', () => {
    expect(guardStart).toBeGreaterThan(-1)
    expect(guardBlock).toContain('onClick={event => event.stopPropagation()}')
    expect(guardBlock).toContain('onPointerDown={event => event.stopPropagation()}')
    expect(guardBlock).toContain('onPointerUp={event => event.stopPropagation()}')
  })

  it('菜单项本身仍是打开对应配置面板，未被重启按钮顶掉', () => {
    expect(navbarSource).toMatch(/onAction=\{\(\) => handleOpenConfig\(item\.id\)\}/)
  })
})
