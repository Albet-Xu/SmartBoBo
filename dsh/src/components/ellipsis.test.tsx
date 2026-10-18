// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Ellipsis } from './ellipsis'

afterEach(cleanup)

function hoverTrigger(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { pointerType: 'mouse' })
  fireEvent.mouseDown(trigger)
  fireEvent.pointerEnter(trigger, { pointerType: 'mouse' })
  fireEvent.mouseOver(trigger)
}

describe('ellipsis tooltip', () => {
  it('溢出放行时 hover 在 500ms 延迟后打开 tooltip，并与触发器互相引用', async () => {
    render(<Ellipsis forceTooltip>a very long truncated line</Ellipsis>)
    const trigger = screen.getByRole('button')

    hoverTrigger(trigger)

    const tooltip = await screen.findByRole('tooltip', undefined, { timeout: 2000 })
    expect(tooltip.textContent).toContain('a very long truncated line')
    expect(trigger.getAttribute('aria-describedby')).toBe(tooltip.id)
  })

  it('未溢出时 hover 触发器不打开 tooltip', async () => {
    render(<Ellipsis>short</Ellipsis>)
    const trigger = screen.getByRole('button')

    hoverTrigger(trigger)
    await new Promise((resolve) => {
      setTimeout(resolve, 1600)
    })

    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(trigger.hasAttribute('aria-describedby')).toBe(false)
  })
})
