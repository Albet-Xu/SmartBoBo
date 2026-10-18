// @vitest-environment jsdom
import type { ReactNode } from 'react'
import type { MarketSkillItemView, MarketSourcesView } from '../types'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { getMarketDetail, getMarketFile, getMarketSearch, postMarketInstall } from '../apis'
import { SkillMarketView } from './skill-market-view'

vi.mock('../apis', () => ({ getMarketDetail: vi.fn(), getMarketFile: vi.fn(), getMarketSearch: vi.fn(), postMarketInstall: vi.fn() }))
vi.mock('./markdown', () => ({ MarkdownPreview: ({ text }: { text: string }) => <div>{text}</div> }))
vi.mock('dsh-tauri-ui/client', () => {
  const Content = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  return {
    Button: ({ children, disabled, onClick }: { children?: ReactNode, disabled?: boolean, onClick?: () => void }) => <button type="button" disabled={disabled} onClick={onClick}>{children}</button>,
    Card: Object.assign(Content, { List: Content, Title: Content, Description: Content }),
    Checkbox: ({ checked, disabled, onChange, children }: { checked: boolean, disabled?: boolean, onChange: (next: boolean) => void, children?: ReactNode }) => (
      <label>
        <input type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />
        {children}
      </label>
    ),
    fileSizeText: (bytes: number) => `${bytes}B`,
    Input: ({ value, placeholder, onChange, onKeyDown }: { value?: string, placeholder?: string, onChange?: (event: { target: { value: string } }) => void, onKeyDown?: (event: { key: string }) => void }) => (
      <input
        placeholder={placeholder}
        value={value ?? ''}
        onChange={event => onChange?.({ target: { value: event.target.value } })}
        onKeyDown={event => onKeyDown?.({ key: event.key })}
      />
    ),
    Modal: ({ open, children, footer }: { open: boolean, children?: ReactNode, footer?: ReactNode }) => (
      open
        ? (
            <div>
              {children}
              {footer}
            </div>
          )
        : null
    ),
    Tag: Content,
    Text: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
  }
})

const t = (key: string) => key

function item(overrides: Partial<MarketSkillItemView> = {}): MarketSkillItemView {
  return {
    id: 'clawhub:alpha',
    source: 'clawhub',
    slug: 'alpha',
    name: 'alpha',
    summary: 'alpha summary',
    author: { handle: 'ada' },
    stats: { downloads: 12 },
    tags: [],
    securityStatus: 'unknown',
    installState: 'installable',
    version: '1.0.0',
    ...overrides,
  }
}

function pageOf(items: MarketSkillItemView[], sources: MarketSourcesView = { clawhub: 'ok', skillhub: 'ok' }) {
  return { page: { items, nextCursor: null, sources } }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

it('keeps install disabled until the SKILL.md acknowledgement is ticked', async () => {
  vi.mocked(getMarketSearch).mockResolvedValue(pageOf([item()], { clawhub: 'ok', skillhub: 'degraded' }))
  vi.mocked(postMarketInstall).mockResolvedValue({ receipt: { id: 'clawhub:alpha', dirName: 'alpha', dir: '/skills/alpha', fileCount: 3, replaced: false } })
  const onInstalled = vi.fn()
  render(<SkillMarketView t={t} onInstalled={onInstalled} />)

  expect(await screen.findByText('alpha')).toBeTruthy()
  expect(screen.getByText('skillMarketSources: skillMarketSourceClawhub skillMarketStatusOk / skillMarketSourceSkillhub skillMarketStatusDegraded')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'install' }))
  expect((screen.getAllByRole('button', { name: 'install' })[1] as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getAllByRole('button', { name: 'install' })[1])
  expect(postMarketInstall).not.toHaveBeenCalled()

  fireEvent.click(screen.getByRole('checkbox', { name: 'skillMarketAck' }))
  expect((screen.getAllByRole('button', { name: 'install' })[1] as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(screen.getAllByRole('button', { name: 'install' })[1])

  await waitFor(() => expect(postMarketInstall).toHaveBeenCalledWith({ id: 'clawhub:alpha' }))
  expect(onInstalled).toHaveBeenCalledExactlyOnceWith(false, 'alpha')
  await waitFor(() => expect(getMarketSearch).toHaveBeenCalledTimes(2))
})

it('disables install and names the reason when the entry cannot be installed', async () => {
  vi.mocked(getMarketSearch).mockResolvedValue(pageOf([item({ installState: 'not-installable', notInstallableReason: 'name-conflict' })]))
  render(<SkillMarketView t={t} onInstalled={vi.fn()} />)

  expect(await screen.findByText('skillMarketNotInstallable: skillMarketReasonNameConflict')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'install' }) as HTMLButtonElement).disabled).toBe(true)
})

it('renders the skill detail and previews a listed file', async () => {
  vi.mocked(getMarketSearch).mockResolvedValue(pageOf([item()]))
  vi.mocked(getMarketDetail).mockResolvedValue({
    detail: {
      id: 'clawhub:alpha',
      name: 'alpha',
      source: 'clawhub',
      summary: 'alpha summary',
      description: '# alpha',
      skillMd: '# alpha',
      frontmatter: {},
      files: [{ path: 'SKILL.md', size: 2048 }],
      capabilities: [{ kind: 'shell', severity: 'high', label: '运行命令', evidence: ['rm -rf /'] }],
      triggers: ['when lost'],
      installState: 'installable',
      updateAvailable: false,
      version: '1.0.0',
    },
  })
  vi.mocked(getMarketFile).mockResolvedValue({ file: { path: 'SKILL.md', content: 'alpha body', language: 'markdown', size: 10, truncated: false } })
  render(<SkillMarketView t={t} onInstalled={vi.fn()} />)

  fireEvent.click(await screen.findByRole('button', { name: 'repoDetail' }))
  expect(await screen.findByText('运行命令')).toBeTruthy()
  expect(screen.getByText('when lost')).toBeTruthy()
  expect(screen.getByText('rm -rf /')).toBeTruthy()
  expect(screen.getByText('# alpha')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'SKILL.md' }))
  await waitFor(() => expect(getMarketFile).toHaveBeenCalledWith({ id: 'clawhub:alpha', path: 'SKILL.md' }))
  expect(await screen.findByText('alpha body')).toBeTruthy()
})
