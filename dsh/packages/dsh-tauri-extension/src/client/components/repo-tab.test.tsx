// @vitest-environment jsdom
import type { ReactNode } from 'react'
import type { RepoEntryView } from '../types'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { getRepoDetail, getRepoList, postRepoInstall, postRepoScope, postRepoUninstall } from '../apis'
import { RepoTab } from './repo-tab'

vi.mock('../apis', () => ({ getRepoDetail: vi.fn(), getRepoList: vi.fn(), postRepoInstall: vi.fn(), postRepoScope: vi.fn(), postRepoUninstall: vi.fn() }))
vi.mock('./markdown', () => ({ MarkdownPreview: ({ text }: { text: string }) => <div>{text}</div> }))
vi.mock('dsh-tauri-ui/client', () => {
  const Content = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  const Empty = () => null
  return {
    Action: Empty,
    ArrowRotateRight: Empty,
    Button: ({ children, disabled, onClick }: { children?: ReactNode, disabled?: boolean, onClick?: () => void }) => <button type="button" disabled={disabled} onClick={onClick}>{children}</button>,
    Card: Object.assign(Content, { List: Content, Title: Content, Description: Content }),
    Checkbox: ({ checked, disabled, onChange, children }: { checked: boolean, disabled?: boolean, onChange: (next: boolean) => void, children?: ReactNode }) => (
      <label>
        <input type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />
        {children}
      </label>
    ),
    fileSizeText: (bytes: number) => `${bytes}B`,
    Icon: Empty,
    Input: ({ value, placeholder, onChange }: { value?: string, placeholder?: string, onChange?: (event: { target: { value: string } }) => void }) => (
      <input placeholder={placeholder} value={value ?? ''} onChange={event => onChange?.({ target: { value: event.target.value } })} />
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
    Pill: ({ children, active, onClick }: { children?: ReactNode, active?: boolean, onClick?: () => void }) => <button type="button" data-active={active} onClick={onClick}>{children}</button>,
    Puzzle: Empty,
    Tag: Content,
    TerminalLine: Empty,
    Text: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
    Toast: ({ text }: { text: string }) => <div>{text}</div>,
    TriangleExclamation: Empty,
  }
})

const t = (key: string) => key

const installedPreset: RepoEntryView = {
  ns: 'presets',
  id: 'focus',
  name: 'focus',
  description: 'focus preset',
  version: '2.0.0',
  installedVersion: '1.0.0',
  status: 'update-available',
  tags: ['focus'],
  requires: [],
  size: 2048,
  target: '/dsh/.agent-presets/focus',
  unresolved: ['../../bobo/plugins/missing'],
}

const availablePreset: RepoEntryView = {
  ns: 'presets',
  id: 'deep',
  name: 'deep',
  description: 'deep preset',
  version: '1.0.0',
  installedVersion: null,
  status: 'available',
  tags: ['research'],
  requires: ['ripgrep'],
  size: 4096,
  target: '/dsh/.agent-presets/deep',
}

const installedTool: RepoEntryView = {
  ns: 'tools',
  id: 'rg',
  name: 'rg',
  description: 'ripgrep tool',
  version: '1.0.0',
  installedVersion: '1.0.0',
  status: 'installed',
  tags: [],
  requires: [],
  size: null,
  target: '/dsh/.bobo-market/tools/rg',
  builtin: false,
  scope: ['focus'],
}

function catalogOf(entries: RepoEntryView[], restored = false) {
  return { catalog: { entries, generatedAt: null, restored } }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

it('lists an installed entry in the market view with its update action and badge', async () => {
  vi.mocked(getRepoList).mockResolvedValue(catalogOf([installedPreset]))
  render(<RepoTab t={t} ns="presets" />)

  expect(await screen.findByRole('button', { name: 'update' })).toBeTruthy()
  expect(getRepoList).toHaveBeenCalledWith({ ns: 'presets' })
  expect(screen.getByText('repoInstalledVersion: 1.0.0')).toBeTruthy()
  expect(screen.getByText('2.0.0')).toBeTruthy()
  expect(screen.getByText('repoUpdateAvailable')).toBeTruthy()
  expect(screen.getByText('repoUnresolvedTag')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'uninstall' })).toBeNull()
})

it('keeps the install path and the full warning text in the detail dialog', async () => {
  vi.mocked(getRepoList).mockResolvedValue(catalogOf([installedPreset]))
  vi.mocked(getRepoDetail).mockResolvedValue({ detail: { id: 'focus', markdown: '# focus', cached: false } })
  render(<RepoTab t={t} ns="presets" />)

  fireEvent.click(await screen.findByRole('button', { name: 'repoDetail' }))
  expect(await screen.findByText('repoTarget: /dsh/.agent-presets/focus')).toBeTruthy()
  expect(screen.getByText('repoUnresolvedTitle ../../bobo/plugins/missing repoUnresolvedHint')).toBeTruthy()
})

it('switches to the installed view before offering an uninstall', async () => {
  vi.mocked(getRepoList).mockResolvedValue(catalogOf([installedPreset]))
  vi.mocked(postRepoUninstall).mockResolvedValue({ receipt: { ns: 'presets', id: 'focus', followedBy: ['rg'] } })
  render(<RepoTab t={t} ns="presets" />)

  expect(screen.queryByRole('button', { name: 'uninstall' })).toBeNull()
  fireEvent.click(await screen.findByRole('button', { name: 'repoInstalledSection 1' }))
  fireEvent.click(screen.getByRole('button', { name: 'uninstall' }))
  fireEvent.click(screen.getAllByRole('button', { name: 'uninstall' })[1])

  await waitFor(() => expect(postRepoUninstall).toHaveBeenCalledWith({ ns: 'presets', id: 'focus' }))
  expect(await screen.findByText('repoUninstalled · repoFollowedBy: rg')).toBeTruthy()
  await waitFor(() => expect(getRepoList).toHaveBeenCalledTimes(2))
})

it('flags the missing dependency on the card and details it in the install dialog', async () => {
  vi.mocked(getRepoList).mockResolvedValue(catalogOf([availablePreset], true))
  vi.mocked(postRepoInstall).mockResolvedValue({ receipt: { ns: 'presets', id: 'deep', version: '1.0.0', target: '/dsh/.agent-presets/deep', replaced: false, fileCount: 4 } })
  render(<RepoTab t={t} ns="presets" />)

  expect(await screen.findByText('repoRestored')).toBeTruthy()
  expect(screen.getByText('4096B')).toBeTruthy()
  expect(screen.getByText('repoRequiresTag')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'install' }))
  expect(screen.getByText('repoRequires: ripgrep')).toBeTruthy()
  fireEvent.click(screen.getAllByRole('button', { name: 'install' })[1])

  await waitFor(() => expect(postRepoInstall).toHaveBeenCalledWith({ ns: 'presets', id: 'deep' }))
  expect(await screen.findByText('repoInstalled. repoRestartHint')).toBeTruthy()
  await waitFor(() => expect(getRepoList).toHaveBeenCalledTimes(2))
})

it('shows the installed view as empty when nothing is installed', async () => {
  vi.mocked(getRepoList).mockResolvedValue(catalogOf([availablePreset]))
  render(<RepoTab t={t} ns="presets" />)

  fireEvent.click(await screen.findByRole('button', { name: 'repoInstalledSection 0' }))
  expect(screen.getByText('repoInstalledEmpty')).toBeTruthy()
})

it('pre-checks the mounted presets and saves the tool scope', async () => {
  vi.mocked(getRepoList).mockImplementation(async params => params?.ns === 'presets'
    ? catalogOf([installedPreset, availablePreset])
    : catalogOf([installedTool]))
  vi.mocked(postRepoScope).mockResolvedValue({ receipt: { toolId: 'rg', scope: ['focus', 'deep'] } })
  render(<RepoTab t={t} ns="tools" />)

  expect(await screen.findByText('rg')).toBeTruthy()
  expect(screen.getByText('repoMountedInto: focus')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'repoScope' }))
  const mounted = await screen.findByRole('checkbox', { name: 'focus' })
  expect((mounted as HTMLInputElement).checked).toBe(true)
  expect((screen.getByRole('checkbox', { name: 'deep' }) as HTMLInputElement).checked).toBe(false)

  fireEvent.click(screen.getByRole('checkbox', { name: 'deep' }))
  fireEvent.click(screen.getByRole('button', { name: 'save' }))

  await waitFor(() => expect(postRepoScope).toHaveBeenCalledWith({ toolId: 'rg', scope: ['focus', 'deep'] }))
  expect(await screen.findByText('repoScopeSaved')).toBeTruthy()
})
