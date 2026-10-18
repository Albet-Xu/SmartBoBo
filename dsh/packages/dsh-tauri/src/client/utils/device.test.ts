import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectMobileDevice, isMobileDevice } from './device'

const MOBILE_QUERIES = ['(hover: none)', '(any-pointer: coarse)', '(any-hover: none)']

function matcher(answers: Record<string, boolean>) {
  const queries: string[] = []
  const matches = (query: string): boolean => {
    queries.push(query)
    return answers[query] ?? false
  }
  return {
    queries,
    matches,
    matchMedia: (query: string) => ({ matches: matches(query) }),
  }
}

function stubWindow(matchMedia?: (query: string) => { matches: boolean }): void {
  vi.stubGlobal('window', matchMedia === undefined ? undefined : { matchMedia })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isMobileDevice', () => {
  it('treats a touch device with a coarse pointer as mobile', () => {
    const probe = matcher({
      '(hover: none)': true,
      '(any-pointer: coarse)': true,
      '(any-hover: none)': true,
    })

    expect(isMobileDevice(probe.matches)).toBe(true)
    expect(probe.queries).toEqual(MOBILE_QUERIES)
  })

  it('keeps every partially matching device on the desktop branch', () => {
    const mouseDesktop = matcher({ '(hover: none)': false, '(any-pointer: coarse)': false })
    const touchscreenLaptop = matcher({ '(hover: none)': false, '(any-pointer: coarse)': true })
    const hoverTouch = matcher({ '(hover: none)': true, '(any-pointer: coarse)': false })

    expect(isMobileDevice(mouseDesktop.matches)).toBe(false)
    expect(isMobileDevice(touchscreenLaptop.matches)).toBe(false)
    expect(isMobileDevice(hoverTouch.matches)).toBe(false)
  })

  it('keeps a touchscreen with a secondary mouse on the desktop branch', () => {
    const tabletWithMouse = matcher({
      '(hover: none)': true,
      '(any-pointer: coarse)': true,
      '(any-hover: hover)': true,
    })

    expect(isMobileDevice(tabletWithMouse.matches)).toBe(false)
    expect(tabletWithMouse.queries).toEqual(MOBILE_QUERIES)
  })

  it('ignores viewport width', () => {
    const narrowDesktop = matcher({
      '(max-width: 480px)': true,
      '(hover: none)': false,
      '(any-pointer: coarse)': false,
    })

    expect(isMobileDevice(narrowDesktop.matches)).toBe(false)
    expect(narrowDesktop.queries).not.toContain('(max-width: 480px)')
  })
})

describe('detectMobileDevice', () => {
  it('probes the device capabilities through the kernel matchMedia', () => {
    const probe = matcher({
      '(hover: none)': true,
      '(any-pointer: coarse)': true,
      '(any-hover: none)': true,
    })
    stubWindow(probe.matchMedia)

    expect(detectMobileDevice()).toBe(true)
    expect(probe.queries).toEqual(MOBILE_QUERIES)
  })

  it.each([undefined, {}])('falls back to desktop when matchMedia is unavailable (%s)', (window) => {
    vi.stubGlobal('window', window)
    expect(detectMobileDevice()).toBe(false)
  })
})
