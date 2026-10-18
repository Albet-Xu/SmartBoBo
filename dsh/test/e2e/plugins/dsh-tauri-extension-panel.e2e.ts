import type { Browser } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { expectNoSyntheticFallbacks, launchDshBrowser, newDshPage } from '../support/browser'

let browser: Browser
beforeAll(async () => {
  browser = await launchDshBrowser()
})
afterAll(async () => {
  await browser?.close()
})

describe('extension panel official plugins composition', () => {
  it('hides the original sidebar row and mounts the official page only while its first tab is active', async () => {
    const app = await newDshPage(browser, { ready: '[data-dsh-hidden-panel="plugins"]' })
    try {
      const originalRow = app.frame.locator('button:has([data-dsh-hidden-panel="plugins"])')
      expect(await originalRow.count(), '原插件入口必须保留注册但隐藏整行').toBe(1)
      expect(await originalRow.evaluate(el => getComputedStyle(el).display)).toBe('none')
      expect(await originalRow.isVisible()).toBe(false)

      await app.frame.getByRole('button', { name: '插件扩展', exact: true }).click()
      const tabs = app.frame.getByRole('tablist', { name: '插件扩展' })
      const pluginsTab = tabs.getByRole('tab', { name: '插件', exact: true })
      await expect.poll(() => tabs.getByRole('tab').first().textContent()).toBe('插件')
      await expect.poll(() => pluginsTab.getAttribute('aria-selected')).toBe('true')

      const officialPage = app.frame.locator('[data-dsh-extension-plugins] [data-plugin-panel]')
      await expect.poll(() => officialPage.isVisible(), { message: '首 Tab 必须渲染真实官方插件页面' }).toBe(true)
      expect(await officialPage.count()).toBe(1)
      expect(await officialPage.evaluate((el) => {
        const style = getComputedStyle(el)
        return { padding: style.padding, overflow: style.overflow }
      })).toEqual({ padding: '0px', overflow: 'visible' })
      expect(await officialPage.locator(':scope > header[data-window-drag]').evaluate(el => getComputedStyle(el).paddingTop)).toBe('0px')

      const heading = officialPage.locator(':scope > header h1')
      const intro = officialPage.locator(':scope > header > div:first-child > div')
      const titleStyle = await heading.evaluate((el) => {
        const style = getComputedStyle(el)
        return { fontSize: style.fontSize, lineHeight: style.lineHeight, fontWeight: style.fontWeight }
      })
      const introStyle = await intro.evaluate((el) => {
        const style = getComputedStyle(el)
        return { fontSize: style.fontSize, lineHeight: style.lineHeight, color: style.color }
      })
      expect(titleStyle).toEqual({ fontSize: '16px', lineHeight: '24px', fontWeight: '500' })
      expect(introStyle).toMatchObject({ fontSize: '12px', lineHeight: '18px' })
      expect(await officialPage.locator(':scope > header').evaluate(el => getComputedStyle(el).rowGap)).toBe('14px')
      const sparkle = app.frame.locator('[data-dsh-plugins-icon] svg')
      expect(await sparkle.isVisible(), '官方闪光图标必须出现在页头').toBe(true)
      expect(await sparkle.getAttribute('width')).toBe('16')

      await expect.poll(() => officialPage.locator('[data-plugin-item]').count()).toBeGreaterThan(0)
      await officialPage.locator('[data-plugin-item]').first().getByRole('button').first().click()
      const detailTop = officialPage.locator('[data-plugin-item-detail] > div[data-window-drag]')
      await expect.poll(() => detailTop.isVisible()).toBe(true)
      expect(await detailTop.evaluate(el => getComputedStyle(el).paddingTop), '详情顶部间距必须为 12px').toBe('12px')
      expect(await sparkle.isVisible(), '详情页不显示列表页头图标').toBe(false)
      await detailTop.getByRole('button').first().click()

      await tabs.getByRole('tab', { name: '技能', exact: true }).click()
      const skillsPanel = app.frame.getByRole('tabpanel', { name: '技能', exact: true, includeHidden: true })
      await expect.poll(() => skillsPanel.isVisible()).toBe(true)
      expect(await skillsPanel.locator(':scope > div > div:first-child > h3').evaluate((el) => {
        const style = getComputedStyle(el)
        return { fontSize: style.fontSize, lineHeight: style.lineHeight, fontWeight: style.fontWeight }
      }), '插件标题尺寸必须与技能页一致').toEqual(titleStyle)
      expect(await skillsPanel.locator(':scope > div > p').first().evaluate((el) => {
        const style = getComputedStyle(el)
        return { fontSize: style.fontSize, lineHeight: style.lineHeight, color: style.color }
      }), '插件描述尺寸和颜色必须与技能页一致').toEqual(introStyle)
      await expect.poll(() => app.frame.locator('[data-plugin-panel]').count(), { message: '离开插件 Tab 必须卸载官方页面，不能仅 hidden' }).toBe(0)

      await tabs.getByRole('tab', { name: 'MCP', exact: true }).click()
      expect(await skillsPanel.count(), '其他已访问 Tab 仍须保留挂载').toBe(1)
      expect(await skillsPanel.isVisible()).toBe(false)
      await pluginsTab.click()
      await expect.poll(() => officialPage.isVisible()).toBe(true)
      expect(await originalRow.isVisible()).toBe(false)
      expectNoSyntheticFallbacks(app)
      expect(app.errors, '复用官方页面和切换 Tab 不得产生浏览器错误').toEqual([])
    }
    finally {
      await app.close()
    }
  })

  it('keeps the embedded page head on the same axis as its icon on touch viewports', async () => {
    const app = await newDshPage(browser, {
      ready: '[data-dsh-hidden-panel="plugins"]',
      viewport: { width: 399, height: 938 },
      hasTouch: true,
      isMobile: true,
    })
    try {
      const toggle = app.frame.locator('[data-dsh-mobile-sidebar-toggle]')
      if (await toggle.count() > 0)
        await toggle.first().click()
      await expect.poll(() => app.frame.locator('html[data-dsh-mobile-sidebar-open]').count()).toBe(1)
      // 抽屉的偏移是逐帧驱动的，行本身永远不满足 playwright 的 stable 判定；这里用真实
      // 指针点击打开抽屉，再用页内点击选中面板行，几何断言不受影响。
      const panelRow = app.frame.getByRole('button', { name: '插件扩展', exact: true })
      await panelRow.evaluate((el: HTMLElement) => {
        el.click()
      })
      const officialPage = app.frame.locator('[data-dsh-extension-plugins] [data-plugin-panel]')
      await officialPage.waitFor()
      const geometry = await officialPage.evaluate((el) => {
        const wrapper = el.closest('[data-dsh-extension-plugins]') as HTMLElement
        const header = el.querySelector(':scope > header[data-window-drag]') as HTMLElement
        const title = header.querySelector('h1') as HTMLElement
        const icon = wrapper.querySelector('[data-dsh-plugins-icon]') as HTMLElement
        const center = (node: Element): number => {
          const rect = node.getBoundingClientRect()
          return rect.top + rect.height / 2
        }
        return {
          headerPaddingTop: getComputedStyle(header).paddingTop,
          titleCenter: center(title),
          iconCenter: center(icon),
          titleLeft: title.getBoundingClientRect().left,
          iconLeft: icon.getBoundingClientRect().left,
          iconWidth: icon.getBoundingClientRect().width,
          titlePaddingLeft: Number.parseFloat(getComputedStyle(title).paddingLeft),
        }
      })
      expect(geometry.headerPaddingTop, '移动端页头不得叠加主槽的顶距').toBe('0px')
      expect(Math.abs(geometry.iconCenter - geometry.titleCenter), '闪光图标必须与插件标题同轴').toBeLessThanOrEqual(1)
      expect(geometry.iconLeft, '图标必须落在标题的左内边距内').toBeCloseTo(geometry.titleLeft, 1)
      expect(geometry.iconWidth + 10, '图标盒加 10px 间距必须等于标题的 32px 缩进').toBeCloseTo(geometry.titlePaddingLeft, 1)
      expectNoSyntheticFallbacks(app)
      expect(app.errors, '移动端组合官方页面不得产生浏览器错误').toEqual([])
    }
    finally {
      await app.close()
    }
  })
})
