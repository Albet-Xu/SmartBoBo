/**
 * navbar-mask-mirror.test.ts — 导航栏下沿的「dsh 弹层蒙版镜像」契约。
 *
 * 壳层把 iframe 里 dsh 页面的遮罩（`_mask_`）底色/毛玻璃镜像到导航栏下沿，让两段观感
 * 连续；0.1.7-rc.2 把该底色搬到 `::after`，镜像读取的跨代实现与过渡镜像由
 * `packages/dsh-tauri` 的 `style.utils.test.ts` 锁住，这里只锁壳层这一半：
 * 该层必须始终带 iframe 上报的样式、且不得被写成穿透点击（dsh 有模态期间壳层不该可点）。
 * 与 `menu-restart.test.ts` 同一姿势——node 环境无渲染器，用源码关系断言。
 */
import { describe, expect, it } from 'vitest'
import { readSource } from './setup/read-source'

const navbarSource = readSource('src/layout/components/navbar.tsx')

const markedLayer = navbarSource.match(/<div className="absolute"[^>]*\/>/)?.[0] ?? ''

describe('navbar mask mirror layer', () => {
  it('镜像层把 iframe 上报的 marked 样式铺在导航栏上', () => {
    expect(markedLayer).toContain('style={dshStyle.marked || {}}')
  })

  it('镜像层不在 dsh 弹模态期间放行点击', () => {
    expect(markedLayer).toContain('style={dshStyle.marked || {}}')
    expect(markedLayer).not.toContain('pointer-events-none')
  })
})
