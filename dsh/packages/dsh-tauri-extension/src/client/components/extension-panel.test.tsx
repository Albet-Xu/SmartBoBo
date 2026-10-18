// @vitest-environment jsdom
import type { SegmentedControlProps } from '../../../../dsh-tauri-ui/src/client/components/segmented-control'
import type { MarketFace } from '../service/market.types'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExtensionPanel } from './extension-panel'

vi.mock('dsh-tauri-ui/client', () => ({
  SegmentedControl: ({ options, value, onChange }: SegmentedControlProps) => (
    <nav data-active={value}>
      {options.map(option => <button key={option.value} type="button" onClick={() => onChange(option.value)}>{option.value}</button>)}
    </nav>
  ),
}))
vi.mock('../locales', () => ({ locale: { text: (key: string) => key } }))
vi.mock('./skills-tab', () => ({
  SkillsTab: () => (
    <section>
      skills-content
      <input aria-label="skill draft" defaultValue="" />
    </section>
  ),
}))
vi.mock('./mcp-tab', () => ({ McpTab: () => <section>mcp-content</section> }))
vi.mock('./repo-tab', () => ({ RepoTab: ({ ns }: { ns: string }) => <section>{`repo-${ns}-content`}</section> }))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('extension panel composition', () => {
  it('renders the official plugins element as the first selected tab', () => {
    const render = vi.fn(() => <section>installed-market-content</section>)
    const market: MarketFace = { version: 1, render, setSettingsVisible: vi.fn(), settingsVisible: () => false }
    const markup = renderToStaticMarkup(<ExtensionPanel plugins={<section>official-plugins-content</section>} market={market} createSkill={async () => {}} />)
    expect(markup).toContain('data-active="plugins"')
    expect(markup).toContain('<button type="button">plugins</button><button type="button">market</button><button type="button">skills</button><button type="button">mcp</button><button type="button">presets</button><button type="button">tools</button>')
    expect(markup).toContain('official-plugins-content')
    expect(render).not.toHaveBeenCalled()
    expect(markup).not.toContain('skills-content')
    expect(markup).not.toContain('mcp-content')
  })

  it('renders plugins without the optional market service', () => {
    const markup = renderToStaticMarkup(<ExtensionPanel plugins={<section>official-plugins-content</section>} market={undefined} createSkill={async () => {}} />)
    expect(markup).toContain('data-active="plugins"')
    expect(markup).toContain('<button type="button">plugins</button><button type="button">skills</button><button type="button">mcp</button><button type="button">presets</button><button type="button">tools</button>')
    expect(markup).toContain('official-plugins-content')
  })

  it('renders the market element with the installed subsection preference when plugins are unavailable', () => {
    const render = vi.fn(() => <section>installed-market-content</section>)
    const market: MarketFace = { version: 1, render, setSettingsVisible: vi.fn(), settingsVisible: () => false }
    const markup = renderToStaticMarkup(<ExtensionPanel market={market} createSkill={async () => {}} />)
    expect(markup).toContain('data-active="market"')
    expect(markup).toContain('<button type="button">market</button><button type="button">skills</button><button type="button">mcp</button><button type="button">presets</button><button type="button">tools</button>')
    expect(render).toHaveBeenCalledExactlyOnceWith({ preferredSubsectionId: 'installed' })
    expect(markup).toContain('installed-market-content')
    expect(markup).not.toContain('skills-content')
    expect(markup).not.toContain('mcp-content')
  })

  it('renders skills when both optional pages are unavailable', () => {
    const markup = renderToStaticMarkup(<ExtensionPanel market={undefined} createSkill={async () => {}} />)
    expect(markup).toContain('data-active="skills"')
    expect(markup).toContain('<button type="button">skills</button><button type="button">mcp</button><button type="button">presets</button><button type="button">tools</button>')
    expect(markup).toContain('skills-content')
    expect(markup).not.toContain('installed-market-content')
    expect(markup).not.toContain('mcp-content')
  })

  it('mounts the presets and tools market tabs on demand', () => {
    const view = render(<ExtensionPanel market={undefined} createSkill={async () => {}} />)
    expect(view.queryByText('repo-presets-content')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'presets' }))
    expect(view.getByText('repo-presets-content').closest('[role="tabpanel"]')?.hasAttribute('hidden')).toBe(false)
    fireEvent.click(view.getByRole('button', { name: 'tools' }))
    expect(view.getByText('repo-tools-content').closest('[role="tabpanel"]')?.hasAttribute('hidden')).toBe(false)
    expect(view.getByText('repo-presets-content').closest('[role="tabpanel"]')?.hasAttribute('hidden')).toBe(true)
  })

  it('unmounts official plugins on tab switches while preserving the skill draft', () => {
    const view = render(<ExtensionPanel plugins={<section>official-plugins-content</section>} market={undefined} createSkill={async () => {}} />)
    const plugins = view.getByText('official-plugins-content')
    fireEvent.click(view.getByRole('button', { name: 'skills' }))
    expect(plugins.isConnected).toBe(false)
    const draft = view.getByRole('textbox', { name: 'skill draft' })
    fireEvent.change(draft, { target: { value: 'unsaved skill' } })
    fireEvent.click(view.getByRole('button', { name: 'plugins' }))
    expect(view.getByText('official-plugins-content')).not.toBe(plugins)
    expect(draft.isConnected).toBe(true)
    expect(draft.closest('[role="tabpanel"]')?.hasAttribute('hidden')).toBe(true)
    fireEvent.click(view.getByRole('button', { name: 'skills' }))
    expect(view.getByRole('textbox', { name: 'skill draft' })).toBe(draft)
    expect((draft as HTMLInputElement).value).toBe('unsaved skill')
  })

  it('keeps a fallback skill draft when official plugins disappear and return', () => {
    const createSkill = async () => {}
    const plugins = <section>official-plugins-content</section>
    const view = render(<ExtensionPanel plugins={plugins} market={undefined} createSkill={createSkill} />)
    view.rerender(<ExtensionPanel market={undefined} createSkill={createSkill} />)
    const draft = view.getByRole('textbox', { name: 'skill draft' })
    fireEvent.change(draft, { target: { value: 'unsaved skill' } })
    view.rerender(<ExtensionPanel plugins={plugins} market={undefined} createSkill={createSkill} />)
    expect(view.getByText('official-plugins-content').closest('[role="tabpanel"]')?.hasAttribute('hidden')).toBe(false)
    expect(draft.isConnected).toBe(true)
    expect(draft.closest('[role="tabpanel"]')?.hasAttribute('hidden')).toBe(true)
    view.rerender(<ExtensionPanel market={undefined} createSkill={createSkill} />)
    expect(view.getByRole('textbox', { name: 'skill draft' })).toBe(draft)
    expect((draft as HTMLInputElement).value).toBe('unsaved skill')
  })

  it('keeps a fallback tab mounted when the market disappears and returns', () => {
    const market: MarketFace = { version: 1, render: () => <section>market</section>, setSettingsVisible: vi.fn(), settingsVisible: () => false }
    const createSkill = async () => {}
    const view = render(<ExtensionPanel market={market} createSkill={createSkill} />)
    view.rerender(<ExtensionPanel market={undefined} createSkill={createSkill} />)
    const draft = view.getByRole('textbox', { name: 'skill draft' })
    fireEvent.change(draft, { target: { value: 'unsaved skill' } })
    view.rerender(<ExtensionPanel market={market} createSkill={createSkill} />)
    expect(draft.isConnected).toBe(true)
    expect(draft.closest('[role="tabpanel"]')?.hasAttribute('hidden')).toBe(true)
    view.rerender(<ExtensionPanel market={undefined} createSkill={createSkill} />)
    expect(view.getByRole('textbox', { name: 'skill draft' })).toBe(draft)
    expect((draft as HTMLInputElement).value).toBe('unsaved skill')
  })
})
