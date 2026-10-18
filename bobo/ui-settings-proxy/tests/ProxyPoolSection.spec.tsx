// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { SettingsMirrorSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { ProxyPoolSection } from '../src/client/ProxyPoolSection.tsx'
import type { ProxyPoolSectionProps } from '../src/client/ProxyPoolSection.tsx'
import type { ProxyPoolSaveOutcome } from '../src/client/proxy-pool.ts'
import { en, type ProxyPoolKey } from '../src/client/locales.ts'
import type { ProxyPoolSettings, ProxySource } from 'bobo-proxy-tool'

afterEach(cleanup)

/** The section's save callback, spelled once so the mocks carry its parameter. */
type SaveFn = (settings: ProxyPoolSettings) => Promise<ProxyPoolSaveOutcome>

// Outside every TS project by design (bobo test-naming rule); tsc -b over src+tests is clean,
// only tsgolint's orphan-file fallback reports error types here.
// oxlint-disable-next-line typescript/no-unsafe-assignment
const t = ((key: ProxyPoolKey, params?: Record<string, string | number>): string =>
  Object.entries(params ?? {}).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    en[key],
  )) as ProxyPoolSectionProps['t']

const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue

function source(name: string, overrides: Partial<ProxySource> = {}): ProxySource {
  return {
    name,
    apiUrl: `https://proxy.example/${name}`,
    apiKey: `${name}-key`,
    pwd: '',
    getnum: 50,
    httptype: 'http',
    geshi: '2',
    fenge: '1',
    enabled: true,
    ...overrides,
  }
}

function view(sources: readonly ProxySource[], revision = 4): SettingsNamespaceView {
  return {
    ns: 'proxy-pool',
    schema: json({}),
    value: json({ sources, fetchStrategy: 'cache', enabled: true, maxRetries: 3, timeoutMs: 30000 }),
    applies: 'live',
    secrets: [],
    revision,
    autoGenerate: false,
  }
}

function props(options: {
  snapshot: SettingsMirrorSnapshot
  save?: ProxyPoolSectionProps['save']
  load?: () => Promise<void>
}): ProxyPoolSectionProps {
  return {
    // oxlint-disable-next-line typescript/no-unsafe-assignment
    t,
    load: options.load ?? (async () => {}),
    save: options.save ?? (async () => ({ kind: 'written' })),
    useSettings: ((select: (state: SettingsMirrorSnapshot) => unknown) => select(options.snapshot)),
  } as unknown as ProxyPoolSectionProps
}

function ready(
  sources: readonly ProxySource[],
  options: { writable?: boolean; save?: ProxyPoolSectionProps['save'] } = {},
): ProxyPoolSectionProps {
  return props({
    snapshot: {
      status: 'ready',
      view: { namespaces: [view(sources)], writable: options.writable ?? true, hasDocument: true },
      error: null,
    },
    ...options.save === undefined ? {} : { save: options.save },
  })
}

/** The single numeric field of a labelled control group. */
function numberField(label: string): HTMLInputElement {
  return screen.getByLabelText(label) as HTMLInputElement
}

/** The single text field carrying a visible value. */
function valueField(value: string): HTMLInputElement {
  return screen.getByDisplayValue(value) as HTMLInputElement
}

/** A dataTransfer stand-in: jsdom implements no DataTransfer at all. */
function dragData(): Pick<DataTransfer, 'effectAllowed' | 'dropEffect' | 'setData'> {
  return { effectAllowed: 'uninitialized', dropEffect: 'none', setData: vi.fn() }
}

/** The drag handle one source's card carries. */
function handleOf(name: string): HTMLElement {
  return screen.getByLabelText(`Drag ${name} to reorder`)
}

/** The list row one source's card renders as. */
function rowOf(name: string): HTMLElement {
  const row = handleOf(name).closest('li')
  if (row === null) throw new Error(`no row for ${name}`)
  return row
}

describe('ProxyPoolSection', () => {
  it('renders the committed pool', () => {
    render(<ProxyPoolSection {...ready([source('alpha'), source('beta', { enabled: false })])} />)

    expect(screen.getByRole('heading', { name: 'Proxy pool' })).toBeDefined()
    expect(screen.getByRole('switch', { name: 'Serve requests through the pool' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getAllByRole('switch', { name: /^Enable / })).toHaveLength(2)
    expect(screen.getByText('alpha')).toBeDefined()
    expect(screen.getByText('beta')).toBeDefined()
    expect(screen.getByText('Off')).toBeDefined()
  })

  it('drives its own reload on the first render', () => {
    const load = vi.fn(async () => {})
    render(<ProxyPoolSection {...props({ snapshot: { status: 'idle', view: undefined, error: null }, load })} />)

    expect(load).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Loading…')).toBeDefined()
  })

  it('reports a connection that keeps preferences process-local', () => {
    render(<ProxyPoolSection {...props({
      snapshot: { status: 'unavailable', view: undefined, error: null },
    })} />)

    expect(screen.getByText('This connection does not serve settings.')).toBeDefined()
  })

  it('explains the namespace a host registers only once a collection session starts', () => {
    render(<ProxyPoolSection {...props({
      snapshot: { status: 'ready', view: { namespaces: [], writable: true, hasDocument: true }, error: null },
    })} />)

    expect(screen.getByText(en.namespaceMissing)).toBeDefined()
    expect(screen.getByText(en.namespaceHint)).toBeDefined()
  })

  it('reports a failed settings read with the host diagnostic', () => {
    render(<ProxyPoolSection {...props({
      snapshot: { status: 'idle', view: undefined, error: 'gateway/unavailable' },
    })} />)

    expect(screen.getByText('Loading the proxy pool failed.')).toBeDefined()
  })

  it('commits the edited pool as a whole', async () => {
    const save = vi.fn<SaveFn>(async () => ({ kind: 'written' }))
    render(<ProxyPoolSection {...ready([source('alpha')], { save })} />)

    fireEvent.change(numberField('Max retries'), { target: { value: '7' } })
    expect(save).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => { expect(save).toHaveBeenCalledTimes(1) })
    expect(save.mock.calls[0]?.[0]).toMatchObject({ maxRetries: 7, sources: [{ name: 'alpha' }] })
    expect(await screen.findByText('Saved.')).toBeDefined()
  })

  it('adds a source and drops the whole draft on cancel', async () => {
    const save = vi.fn<SaveFn>(async () => ({ kind: 'written' }))
    render(<ProxyPoolSection {...ready([source('alpha')], { save })} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add source' }))
    fireEvent.change(valueField('Source 2'), { target: { value: 'gamma' } })
    fireEvent.change(numberField('Max retries'), { target: { value: '9' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => { expect(numberField('Max retries').value).toBe('3') })
    expect(save).not.toHaveBeenCalled()
    expect(screen.queryByDisplayValue('gamma')).toBeNull()
  })

  it('keeps a card open across the edits typed into it', () => {
    render(<ProxyPoolSection {...ready([source('alpha')])} />)

    fireEvent.click(screen.getByRole('button', { name: 'alpha' }))
    fireEvent.change(screen.getByLabelText('API URL'), {
      target: { value: 'https://proxy.example/edited' },
    })
    fireEvent.click(screen.getByRole('switch', { name: 'Enable alpha' }))

    expect(screen.getByDisplayValue('https://proxy.example/edited')).toBeDefined()
  })

  it('keeps a source just added open while it is renamed and filled in', () => {
    render(<ProxyPoolSection {...ready([source('alpha')])} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add source' }))
    fireEvent.change(valueField('Source 2'), { target: { value: 'gamma' } })
    fireEvent.change(within(rowOf('gamma')).getByLabelText('API URL'), {
      target: { value: 'https://proxy.example/gamma' },
    })

    expect(valueField('gamma')).toBeDefined()
    expect(screen.getByDisplayValue('https://proxy.example/gamma')).toBeDefined()
  })

  it('closes the open card once the draft is committed', async () => {
    const save = vi.fn<SaveFn>(async () => ({ kind: 'written' }))
    render(<ProxyPoolSection {...ready([source('alpha')], { save })} />)

    fireEvent.click(screen.getByRole('button', { name: 'alpha' }))
    fireEvent.change(screen.getByLabelText('API URL'), { target: { value: 'https://proxy.example/e' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => { expect(save).toHaveBeenCalledTimes(1) })
    expect(screen.queryByLabelText('API URL')).toBeNull()
    expect(screen.getByRole('button', { name: 'alpha' })).toBeDefined()
  })

  it('carries an open card through a reorder and a neighbour removal', () => {
    render(<ProxyPoolSection {...ready([source('alpha'), source('beta'), source('gamma')])} />)

    fireEvent.click(screen.getByRole('button', { name: 'gamma' }))
    expect(within(rowOf('gamma')).getByLabelText('API URL')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Move gamma up' }))
    expect(within(rowOf('gamma')).getByLabelText('API URL')).toBeDefined()
    expect(within(rowOf('beta')).queryByLabelText('API URL')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Delete alpha' }))
    expect(within(rowOf('gamma')).getByLabelText('API URL')).toBeDefined()
    expect(within(rowOf('beta')).queryByLabelText('API URL')).toBeNull()
  })

  it('reorders sources through the priority controls', async () => {
    const save = vi.fn<SaveFn>(async () => ({ kind: 'written' }))
    render(<ProxyPoolSection {...ready([source('alpha'), source('beta')], { save })} />)

    fireEvent.click(screen.getByRole('button', { name: 'Move beta up' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => { expect(save).toHaveBeenCalledTimes(1) })
    expect(save.mock.calls[0]?.[0].sources.map(entry => entry.name)).toEqual(['beta', 'alpha'])
  })

  it('renders the conflict copy and leaves the draft editable', async () => {
    const save = vi.fn<SaveFn>(async () => ({ kind: 'conflict' }))
    render(<ProxyPoolSection {...ready([source('alpha')], { save })} />)

    fireEvent.change(numberField('Max retries'), { target: { value: '8' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText(en.conflict)).toBeDefined()
    expect(numberField('Max retries').value).toBe('8')
  })

  it('renders the host diagnostic a refusal carries', async () => {
    const save = vi.fn<SaveFn>(async () => ({ kind: 'refused', message: '$.fetchStrategy invalid' }))
    render(<ProxyPoolSection {...ready([source('alpha')], { save })} />)

    fireEvent.click(screen.getByRole('switch', { name: 'Serve requests through the pool' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('$.fetchStrategy invalid')).toBeDefined()
  })

  it('refuses edits while the settings document is read-only', () => {
    render(<ProxyPoolSection {...ready([source('alpha')], { writable: false })} />)

    expect(screen.getByText(en.readOnly)).toBeDefined()
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Add source' }).hasAttribute('disabled')).toBe(true)
    expect(screen.queryByLabelText('Drag alpha to reorder')).toBeNull()
  })

  it('reorders sources through a drag', async () => {
    const save = vi.fn<SaveFn>(async () => ({ kind: 'written' }))
    render(<ProxyPoolSection {...ready([source('alpha'), source('beta')], { save })} />)

    const carried = dragData()
    fireEvent.dragStart(handleOf('alpha'), { dataTransfer: carried })
    expect(carried.effectAllowed).toBe('move')
    expect(carried.setData).toHaveBeenCalledWith('text/plain', '0')
    const hovered = dragData()
    fireEvent.dragOver(rowOf('beta'), { dataTransfer: hovered })
    expect(hovered.dropEffect).toBe('move')
    fireEvent.drop(rowOf('beta'), { dataTransfer: dragData() })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => { expect(save).toHaveBeenCalledTimes(1) })
    expect(save.mock.calls[0]?.[0].sources.map(entry => entry.name)).toEqual(['beta', 'alpha'])
  })

  it('marks the carried row and its drop target, and clears both on drag end', () => {
    render(<ProxyPoolSection {...ready([source('alpha'), source('beta')])} />)

    fireEvent.dragStart(handleOf('alpha'), { dataTransfer: dragData() })
    fireEvent.dragOver(rowOf('beta'), { dataTransfer: dragData() })

    expect(rowOf('alpha').className).toContain('cardDragging')
    expect(rowOf('beta').className).toContain('cardDropTarget')

    // A gesture released outside the list ends without a drop, so the
    // highlight it raised has to go with it.
    fireEvent.dragEnd(handleOf('alpha'))

    expect(rowOf('alpha').className).not.toContain('cardDragging')
    expect(rowOf('beta').className).not.toContain('cardDropTarget')
  })

  it('treats a drop back onto the carried row as no edit', () => {
    render(<ProxyPoolSection {...ready([source('alpha'), source('beta')])} />)

    fireEvent.dragStart(handleOf('alpha'), { dataTransfer: dragData() })
    fireEvent.dragOver(rowOf('alpha'), { dataTransfer: dragData() })

    expect(rowOf('alpha').className).not.toContain('cardDropTarget')
    fireEvent.drop(rowOf('alpha'), { dataTransfer: dragData() })

    expect(rowOf('alpha').className).not.toContain('cardDragging')
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true)
  })

  it('ignores a drop no gesture on this page started', () => {
    render(<ProxyPoolSection {...ready([source('alpha'), source('beta')])} />)

    fireEvent.dragOver(rowOf('beta'), { dataTransfer: dragData() })
    fireEvent.drop(rowOf('beta'), { dataTransfer: dragData() })

    expect(rowOf('beta').className).not.toContain('cardDropTarget')
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true)
  })
})
