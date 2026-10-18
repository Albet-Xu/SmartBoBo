/**
 * Proxy Pool settings page: the master switch, the fetch strategy, and the
 * ordered source list the host `/proxy` command draws addresses from.
 *
 * The page edits one draft and commits it as a whole, so a half-typed URL
 * never reaches the host. The host stays the single fact source: an untouched
 * page always renders the last committed value, and a committed draft is
 * dropped in favour of the answer the write returned.
 */

import { useEffect, useMemo, useState } from 'react'
import type { DragEvent, ReactNode } from 'react'
import {
  Button, IconChevronDownOutlineRegular, IconChevronUpOutlineRegular, IconPlusOutlineMedium, IconTrashOutlineMedium,
  Input, Switch,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ProxyPoolSettings, ProxySource } from 'bobo-proxy-tool'
import type { SettingsDescribeFace } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  FETCH_STRATEGIES, NEW_PROXY_SOURCE, PROXY_HTTP_TYPES,
  dropExpanded, moveEntry, moveExpanded, proxyPoolPageState, reorderSources,
  type ProxyPoolSaveOutcome,
} from './proxy-pool.ts'
import css from './ProxyPoolSection.module.css'

/** Registration-side dependencies of {@link ProxyPoolSection}. */
export interface ProxyPoolSectionInjected {
  /**
   * Resolve the page's first settings answer; a no-op once one is held.
   * @returns settlement of the read this call started, if any.
   */
  load: () => Promise<void>
  /**
   * Apply one edited pool through the host settings namespace.
   * @param settings - the pool the page currently shows.
   * @returns the write's outcome, which the page turns into its own copy.
   */
  save: (settings: ProxyPoolSettings) => Promise<ProxyPoolSaveOutcome>
  hooks: {
    /** Shared settings mirror, bound by the UI renderer as `useSettings`. */
    settings: SettingsDescribeFace
  }
}

/** Full component props: section owner share, locale seat, and inject face. */
export type ProxyPoolSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.proxy'>
  & InjectFace<ProxyPoolSectionInjected>

type PoolFace = InjectFace<ProxyPoolSectionInjected>
type PoolTranslate = ProxyPoolSectionProps['t']

/**
 * One row's share of a pointer drag: what the row renders as while the gesture
 * is live, and the events the row answers. Absent while the page is read-only,
 * which is also what withholds the drag handle.
 */
interface SourceDrag {
  /** This row is the one the pointer carries. */
  dragging: boolean
  /** A live drag hovers this row with a drop that would move the source. */
  target: boolean
  /** Start carrying this row. */
  onStart: (event: DragEvent<HTMLElement>) => void
  /** Report this row as the current drop target. */
  onOver: (event: DragEvent<HTMLElement>) => void
  /** Apply the drop on this row. */
  onDrop: (event: DragEvent<HTMLElement>) => void
  /** End the gesture, whether it dropped or was cancelled. */
  onEnd: () => void
}

/**
 * One source's own card: identity on the collapsed row, the full field set
 * once expanded, and the ordering controls that set its priority.
 */
function SourceCard({ source, index, count, readOnly, expanded, drag, t, onToggle, onChange, onRemove, onMove }: {
  source: ProxySource
  index: number
  count: number
  readOnly: boolean
  expanded: boolean
  drag: SourceDrag | undefined
  t: PoolTranslate
  onToggle: () => void
  onChange: (patch: Partial<ProxySource>) => void
  onRemove: () => void
  onMove: (to: number) => void
}): ReactNode {
  const name = source.name.trim() === '' ? t('unnamed') : source.name
  const classes = [css['card']]
  if (drag?.dragging === true) classes.push(css['cardDragging'])
  if (drag?.target === true) classes.push(css['cardDropTarget'])
  return (
    <li className={classes.join(' ')} onDragOver={drag?.onOver} onDrop={drag?.onDrop}>
      <div className={css['cardHead']}>
        {/* The pointer's grip on priority; the two buttons in the row's
            actions stay the keyboard path to the same reorder. */}
        {drag === undefined ? null : (
          <span
            className={css['dragHandle']}
            draggable
            title={t('dragHandleShort')}
            aria-label={t('dragHandle', { name })}
            onDragStart={drag.onStart}
            onDragEnd={drag.onEnd}
          >≡</span>
        )}
        <button
          type="button"
          className={css['expandButton']}
          aria-expanded={expanded}
          aria-label={name}
          onClick={onToggle}
        >
          <IconChevronDownOutlineRegular className={expanded ? css['chevronOpen'] : css['chevronClosed']} />
        </button>
        {expanded ? (
          <Input
            className={`${css['nameInput']}`}
            value={source.name}
            placeholder={t('sourceNamePlaceholder')}
            aria-label={t('sourceName')}
            disabled={readOnly}
            onChange={(event) => { onChange({ name: event.currentTarget.value }) }}
          />
        ) : (
          <span className={css['cardName']}>{name}</span>
        )}
        {source.enabled ? null : <span className={css['cardTag']}>{t('disabledTag')}</span>}
        <span className={css['cardActions']}>
          <Button
            variant="ghost"
            size="sm"
            disabled={readOnly || index === 0}
            title={t('moveUpShort')}
            aria-label={t('moveUp', { name })}
            onClick={() => { onMove(index - 1) }}
          >
            <IconChevronUpOutlineRegular />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={readOnly || index === count - 1}
            title={t('moveDownShort')}
            aria-label={t('moveDown', { name })}
            onClick={() => { onMove(index + 1) }}
          >
            <IconChevronDownOutlineRegular />
          </Button>
          <Switch
            checked={source.enabled}
            disabled={readOnly}
            label={t('enabledNamed', { name })}
            onChange={(next) => { onChange({ enabled: next }) }}
          />
          <Button
            variant="ghost"
            size="sm"
            disabled={readOnly}
            title={t('remove')}
            aria-label={t('removeNamed', { name })}
            onClick={onRemove}
          >
            <IconTrashOutlineMedium />
          </Button>
        </span>
      </div>
      {expanded ? (
        <div className={css['fields']}>
          <label className={css['fieldWide']}>
            <span className={css['fieldLabel']}>{t('apiUrl')}</span>
            <Input
              value={source.apiUrl}
              placeholder={t('apiUrlPlaceholder')}
              disabled={readOnly}
              onChange={(event) => { onChange({ apiUrl: event.currentTarget.value }) }}
            />
          </label>
          <label className={css['field']}>
            <span className={css['fieldLabel']}>{t('apiKey')}</span>
            <Input
              value={source.apiKey}
              disabled={readOnly}
              onChange={(event) => { onChange({ apiKey: event.currentTarget.value }) }}
            />
          </label>
          <label className={css['field']}>
            <span className={css['fieldLabel']}>{t('pwd')}</span>
            <Input
              value={source.pwd}
              disabled={readOnly}
              onChange={(event) => { onChange({ pwd: event.currentTarget.value }) }}
            />
          </label>
          <label className={css['field']}>
            <span className={css['fieldLabel']}>{t('getnum')}</span>
            <Input
              type="number"
              min={1}
              value={source.getnum}
              disabled={readOnly}
              onChange={(event) => { onChange({ getnum: countFrom(event.currentTarget.value, source.getnum) }) }}
            />
          </label>
          <label className={css['field']}>
            <span className={css['fieldLabel']}>{t('httpType')}</span>
            <select
              className={css['select']}
              value={source.httptype}
              aria-label={t('httpType')}
              disabled={readOnly}
              onChange={(event) => { onChange({ httptype: event.currentTarget.value }) }}
            >
              {PROXY_HTTP_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
              {/* A stored type outside the known pair stays selectable verbatim
                  rather than being silently rewritten by the next save. */}
              {PROXY_HTTP_TYPES.some(type => type === source.httptype)
                ? null
                : <option value={source.httptype}>{source.httptype}</option>}
            </select>
          </label>
          <label className={css['field']}>
            <span className={css['fieldLabel']}>{t('geshi')}</span>
            <Input
              value={source.geshi}
              disabled={readOnly}
              onChange={(event) => { onChange({ geshi: event.currentTarget.value }) }}
            />
          </label>
          <label className={css['field']}>
            <span className={css['fieldLabel']}>{t('fenge')}</span>
            <Input
              value={source.fenge}
              disabled={readOnly}
              onChange={(event) => { onChange({ fenge: event.currentTarget.value }) }}
            />
          </label>
        </div>
      ) : null}
    </li>
  )
}

/**
 * Read a positive count out of a number field, keeping the previous value for
 * an empty or fractional entry (a cleared field parses to no count at all).
 * @param raw - the field's text.
 * @param previous - the value to keep when the entry names no count.
 * @returns the count the pool should store.
 */
function countFrom(raw: string, previous: number): number {
  const parsed = Number.parseInt(raw, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : previous
}

/** Render the page status line for a state the editor cannot render from. */
function StatusLine({ state, t }: {
  state: 'loading' | 'unavailable' | 'absent' | 'read' | 'section'
  t: PoolTranslate
}): ReactNode {
  return (
    <div className={css['section']}>
      <p className={css['status']}>
        {state === 'loading' ? t('loading') : null}
        {state === 'unavailable' ? t('unavailable') : null}
        {state === 'absent' ? t('namespaceMissing') : null}
        {state === 'read' ? t('loadFailed') : null}
        {state === 'section' ? t('malformed') : null}
      </p>
      {state === 'absent' ? <p className={css['status']}>{t('namespaceHint')}</p> : null}
    </div>
  )
}

/**
 * Render the Proxy Pool section content.
 * @param props - composed slot props (see {@link ProxyPoolSectionProps}).
 * @returns the settings section element tree.
 */
export function ProxyPoolSection(props: ProxyPoolSectionProps): ReactNode {
  const { useSettings, load, save, t } = props
  return <Loaded face={{ useSettings, load, save }} t={t} />
}

function Loaded({ face, t }: { face: PoolFace; t: PoolTranslate }): ReactNode {
  const { useSettings, load, save } = face
  const mirror = useSettings(snapshot => snapshot)
  // Memoized on the mirrored snapshot so one render does not re-decode the
  // pool the page is not editing.
  const page = useMemo(() => proxyPoolPageState(mirror), [mirror])
  const [draft, setDraft] = useState<ProxyPoolSettings | undefined>(undefined)
  // Open rows by rendered position. Positions rather than entries because every
  // field edit replaces the edited entry with a new record, and an open row has
  // to survive the edit that is being typed into it. Committing or dropping the
  // draft closes every row, so the set only describes the draft in progress.
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set())
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [saved, setSaved] = useState(false)
  const [dragIndex, setDragIndex] = useState<number | undefined>(undefined)
  const [dropIndex, setDropIndex] = useState<number | undefined>(undefined)

  useEffect(() => {
    if (mirror.status === 'idle') void load()
  }, [load, mirror.status])

  if (page.status !== 'ready') {
    return <StatusLine state={page.status === 'failed' ? page.reason : page.status} t={t} />
  }

  const committed = page.settings
  const settings = draft ?? committed
  const dirty = draft !== undefined
  const readOnly = !page.writable

  const patch = (next: Partial<ProxyPoolSettings>): void => {
    setSaved(false)
    setDraft(previous => ({ ...(previous ?? committed), ...next }))
  }

  const patchSource = (index: number, next: Partial<ProxySource>): void => {
    patch({ sources: settings.sources.map((source, at) => at === index ? { ...source, ...next } : source) })
  }

  const addSource = (): void => {
    const source = { ...NEW_PROXY_SOURCE, name: t('newSourceName', { index: settings.sources.length + 1 }) }
    patch({ sources: [...settings.sources, source] })
    // The appended row is the one the user has to fill in, so it opens.
    setExpanded(previous => new Set([...previous, settings.sources.length]))
  }

  const removeSource = (index: number): void => {
    patch({ sources: settings.sources.filter((_source, at) => at !== index) })
    setExpanded(previous => dropExpanded(previous, index))
  }

  const moveSource = (from: number, to: number): void => {
    patch({ sources: [...moveEntry(settings.sources, from, to)] })
    setExpanded(previous => moveExpanded(previous, from, to))
  }

  /**
   * Settle the gesture. A drop and a release outside the list both end here,
   * so no row keeps a highlight the pointer has left behind.
   */
  const endDrag = (): void => {
    setDragIndex(undefined)
    setDropIndex(undefined)
  }

  /**
   * Carry one source. The gesture carries its index as text as well, because a
   * drag that sets no data does not start at all in Firefox.
   * @param event - the row's dragstart.
   * @param index - the carried source's position in the rendered list.
   */
  const startDrag = (event: DragEvent<HTMLElement>, index: number): void => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(index))
    setDragIndex(index)
  }

  /**
   * Mark the row a live drag would land on. A gesture this page did not start
   * carries no source, so it keeps the browser's own refusal.
   * @param event - the row's dragover.
   * @param index - the hovered row's position in the rendered list.
   */
  const overDrag = (event: DragEvent<HTMLElement>, index: number): void => {
    if (dragIndex === undefined) return
    // Only a prevented default accepts a drop.
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDropIndex(index)
  }

  /**
   * Apply the drop through the same fold the priority buttons use, and settle
   * the gesture. A drop that asks for no move leaves the draft untouched.
   * @param event - the row's drop.
   * @param index - the target row's position in the rendered list.
   */
  const dropDrag = (event: DragEvent<HTMLElement>, index: number): void => {
    if (dragIndex === undefined) return
    event.preventDefault()
    const next = reorderSources(settings.sources, dragIndex, index)
    if (next !== null) {
      patch({ sources: [...next] })
      setExpanded(previous => moveExpanded(previous, dragIndex, index))
    }
    endDrag()
  }

  const toggleSource = (index: number): void => {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const submit = async (): Promise<void> => {
    if (draft === undefined) return
    setSaving(true)
    setFailure(undefined)
    setSaved(false)
    const outcome = await save(draft)
    setSaving(false)
    if (outcome.kind === 'written') {
      // The committed draft leaves nothing in progress, so every row closes
      // back to its name — including the one just filled in.
      setDraft(undefined)
      setExpanded(new Set())
      setSaved(true)
      return
    }
    if (outcome.kind === 'conflict') setFailure(t('conflict'))
    else if (outcome.kind === 'absent') setFailure(t('namespaceMissing'))
    else setFailure(outcome.message)
  }

  return (
    <div className={css['section']}>
      <div className={css['header']}>
        <h2 className={css['title']}>{t('title')}</h2>
        <p className={css['intro']}>{t('intro')}</p>
      </div>

      {readOnly ? <p className={css['notice']}>{t('readOnly')}</p> : null}
      {page.staleError === null ? null : <p className={css['notice']}>{page.staleError}</p>}

      <div className={css['switchRow']}>
        <Switch
          checked={settings.enabled}
          disabled={readOnly}
          label={t('enabled')}
          onChange={(next) => { patch({ enabled: next }) }}
        />
        <span className={css['switchText']}>
          <span className={css['switchTitle']}>{t('enabled')}</span>
          <span className={css['hint']}>{t('enabledHint')}</span>
        </span>
      </div>

      <div className={css['settingsGrid']}>
        <label className={css['field']}>
          <span className={css['fieldLabel']}>{t('strategy')}</span>
          <select
            className={css['select']}
            value={settings.fetchStrategy}
            aria-label={t('strategy')}
            disabled={readOnly}
            onChange={(event) => {
              patch({ fetchStrategy: event.currentTarget.value as ProxyPoolSettings['fetchStrategy'] })
            }}
          >
            {FETCH_STRATEGIES.map(strategy => (
              <option key={strategy} value={strategy}>
                {strategy === 'cache' ? t('strategyCache') : t('strategyRealtime')}
              </option>
            ))}
          </select>
        </label>
        <label className={css['field']}>
          <span className={css['fieldLabel']}>{t('maxRetries')}</span>
          <Input
            type="number"
            min={1}
            value={settings.maxRetries}
            disabled={readOnly}
            onChange={(event) => { patch({ maxRetries: countFrom(event.currentTarget.value, settings.maxRetries) }) }}
          />
        </label>
        <label className={css['field']}>
          <span className={css['fieldLabel']}>{t('timeoutMs')}</span>
          <Input
            type="number"
            min={1000}
            step={1000}
            value={settings.timeoutMs}
            disabled={readOnly}
            onChange={(event) => { patch({ timeoutMs: countFrom(event.currentTarget.value, settings.timeoutMs) }) }}
          />
        </label>
      </div>

      <div className={css['sources']}>
        <div className={css['sourcesHead']}>
          <span className={css['sectionLabel']}>{t('sources')}</span>
          <Button
            variant="outline"
            size="sm"
            icon={<IconPlusOutlineMedium />}
            disabled={readOnly}
            onClick={addSource}
          >
            {t('addSource')}
          </Button>
        </div>
        <p className={css['hint']}>{t('sourcesHint')}</p>
        {settings.sources.length === 0
          ? <p className={css['empty']}>{t('sourcesEmpty')}</p>
          : (
            <ol className={css['list']}>
              {settings.sources.map((source, index) => {
                const drag: SourceDrag | undefined = readOnly
                  ? undefined
                  : {
                    dragging: dragIndex === index,
                    // The carried row is never its own target: that drop asks
                    // for no move.
                    target: dropIndex === index && dragIndex !== index,
                    onStart: (event) => { startDrag(event, index) },
                    onOver: (event) => { overDrag(event, index) },
                    onDrop: (event) => { dropDrag(event, index) },
                    onEnd: endDrag,
                  }
                return (
                  <SourceCard
                    key={index}
                    source={source}
                    index={index}
                    count={settings.sources.length}
                    readOnly={readOnly}
                    expanded={expanded.has(index)}
                    drag={drag}
                    t={t}
                    onToggle={() => { toggleSource(index) }}
                    onChange={(next) => { patchSource(index, next) }}
                    onRemove={() => { removeSource(index) }}
                    onMove={(to) => { moveSource(index, to) }}
                  />
                )
              })}
            </ol>
          )}
      </div>

      <div className={css['actions']}>
        {failure === undefined ? null : <p className={css['error']}>{failure}</p>}
        {saved ? <p className={css['savedNotice']}>{t('saved')}</p> : null}
        <Button
          variant="outline"
          disabled={!dirty || saving}
          onClick={() => {
            setDraft(undefined)
            setExpanded(new Set())
            setFailure(undefined)
            setSaved(false)
          }}
        >
          {t('cancel')}
        </Button>
        <Button
          variant="primary"
          disabled={!dirty || saving || readOnly}
          onClick={() => { void submit() }}
        >
          {saving ? t('saving') : t('save')}
        </Button>
      </div>
    </div>
  )
}
