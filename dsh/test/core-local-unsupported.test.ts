import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compareVersions, isCoreUnsupported, MIN_SUPPORTED_CORE_VERSION } from '@/utils/core-version'

const CORE_PANEL = new URL('../src/ui/config/core.tsx', import.meta.url)
const RESOURCE_MANIFEST = new URL('../src-tauri/resources/manifest.jsonc', import.meta.url)

/** 随包推荐核心版本（前端核心面板的「更新」提示基线）。 */
function recommendedVersion(): string {
  // 资源清单是 JSONC（允许行注释）：解析前先剥掉行注释。
  const raw = JSON.parse(
    readFileSync(RESOURCE_MANIFEST, 'utf8').replace(/^\s*\/\/.*$/gm, ''),
  ) as { engines: { dsh: { recommend: string } } }
  return raw.engines.dsh.recommend
}

/** `isUnsupportedLocal` 的函数体源码（用于锁定它不再复用推荐版本当基线）。 */
function localPredicateSource(): string {
  const source = readFileSync(CORE_PANEL, 'utf8')
  const start = source.indexOf('function isUnsupportedLocal')
  expect(start).toBeGreaterThan(-1)
  return source.slice(start, source.indexOf('\n}', start))
}

/**
 * 兼容性只由**最低支持基线**（0.1.5-rc.1）决定，与推荐核心版本无关。
 *
 * 回归背景：本地核心的判定曾复用「推荐核心版本」（`manifest.jsonc` 的
 * `engines.dsh.recommend`，误报发生时
 * 为 0.1.7-alpha.1）当基线，于是 0.1.5-rc.3 这类**高于最低支持基线**的本地核心被误判为
 * 「不兼容」：行内挂红标、激活被拒、提示文案还引用推荐版本号。最低支持基线独立于推荐
 * 版本（issue #596），两者不可混用。
 *
 * 推荐版本随发布上下调整（曾从 0.1.7-alpha.1 回退到 0.1.5-rc.3），因此这里的断言只锁
 * 「基线 ↔ 兼容性」的契约，不锁推荐版本与某个具体核心版本的相对取值。
 */
describe('local core compatibility baseline', () => {
  it('最低支持基线与推荐核心版本是两个不同的版本', () => {
    expect(MIN_SUPPORTED_CORE_VERSION).toBe('0.1.5-rc.1')
    expect(recommendedVersion()).not.toBe(MIN_SUPPORTED_CORE_VERSION)
    // 推荐版本高于最低支持基线，这正是误判的来源
    expect(compareVersions(recommendedVersion(), MIN_SUPPORTED_CORE_VERSION)).toBeGreaterThan(0)
  })

  it('高于最低支持基线的本地核心不算不兼容（误报版本 0.1.5-rc.3）', () => {
    // 误报现场：0.1.5-rc.3 > 0.1.5-rc.1，却被按当时的推荐版本（0.1.7-alpha.1）挡下
    expect(compareVersions('0.1.5-rc.3', MIN_SUPPORTED_CORE_VERSION)).toBeGreaterThan(0)
    expect(isCoreUnsupported('0.1.5-rc.3')).toBe(false)
  })

  it('基线本身及更高版本都算兼容，低于基线的旧版本才算不兼容', () => {
    expect(isCoreUnsupported(MIN_SUPPORTED_CORE_VERSION)).toBe(false)
    expect(isCoreUnsupported('0.1.5-rc.2')).toBe(false)
    expect(isCoreUnsupported('0.1.7-alpha.1')).toBe(false)
    expect(isCoreUnsupported('0.1.5-alpha.2')).toBe(true)
    expect(isCoreUnsupported('0.1.2-rc.1')).toBe(true)
  })
})

describe('config core panel local compatibility predicate', () => {
  it('不复用推荐核心版本当兼容性基线', () => {
    const predicate = localPredicateSource()
    expect(predicate).toContain('isUnsupportedCore(core)')
    expect(predicate).not.toContain('recommendedVersion')
  })

  it('不再引用已删除的推荐版本基线工具', () => {
    expect(readFileSync(CORE_PANEL, 'utf8')).not.toContain('isCoreBelowBaseline')
  })

  it('「不兼容」提示文案引用最低支持基线而不是推荐版本', () => {
    const source = readFileSync(CORE_PANEL, 'utf8')
    expect(source).toContain('t(\'core.local_unsupported_hint\', { version: MIN_SUPPORTED_CORE_VERSION })')
  })
})
