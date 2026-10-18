import type { ReactElement } from 'react'
import type { Translate } from '../locales/index.types'
import type { RepoCatalogView, RepoDetailView, RepoEntryView } from '../types'
import { Action, ArrowRotateRight, Button, Card, fileSizeText, Icon, Input, Modal, Pill, Puzzle, Tag, TerminalLine, Text, Toast, TriangleExclamation as Warning } from 'dsh-tauri-ui/client'
import { useEffect, useState } from 'react'
import { getRepoDetail, getRepoList, postRepoInstall, postRepoUninstall } from '../apis'
import { MarkdownPreview } from './markdown'
import { failText } from './outcome.utils'
import { RepoInstallDialog } from './repo-install-dialog'
import { RepoScopeModal } from './repo-scope-modal'

export interface RepoTabProps {
  t: Translate
  ns: 'presets' | 'tools'
}

type RepoView = 'market' | 'installed'

function nsLabel(t: Translate, ns: RepoTabProps['ns']): string {
  return ns === 'presets' ? t('presetsTab') : t('toolsTab')
}

function marketLabel(t: Translate, ns: RepoTabProps['ns']): string {
  return ns === 'presets' ? t('repoPresetMarketView') : t('repoToolMarketView')
}

function warningTags(t: Translate, entry: RepoEntryView): ReactElement | null {
  const missingDeps = entry.requires.length > 0
  const unresolvedRows = (entry.unresolved?.length ?? 0) > 0
  if (!missingDeps && !unresolvedRows)
    return null
  return (
    <div className="flex items-center gap-[6px] flex-wrap">
      {missingDeps && <Tag tone="warning">{t('repoRequiresTag')}</Tag>}
      {unresolvedRows && <Tag tone="warning">{t('repoUnresolvedTag')}</Tag>}
    </div>
  )
}

function warningDetails(t: Translate, entry: RepoEntryView): ReactElement | null {
  if (entry.requires.length === 0 && (entry.unresolved?.length ?? 0) === 0)
    return null
  return (
    <div className="flex flex-col gap-[4px] border border-border-l2 rounded-[8px] bg-layer-3 px-[12px] py-[8px]">
      {entry.requires.length > 0 && <Text tone="error">{`${t('repoRequires')}: ${entry.requires.join(', ')} · ${t('repoRequiresHint')}`}</Text>}
      {(entry.unresolved?.length ?? 0) > 0 && <Text tone="error">{`${t('repoUnresolvedTitle')} ${entry.unresolved?.join(', ') ?? ''} ${t('repoUnresolvedHint')}`}</Text>}
    </div>
  )
}

export function RepoTab({ t, ns }: RepoTabProps): ReactElement {
  const [catalog, setCatalog] = useState<RepoCatalogView | null>(null)
  const [detail, setDetail] = useState<RepoDetailView | null>(null)
  const [installTarget, setInstallTarget] = useState<RepoEntryView | null>(null)
  const [uninstallTarget, setUninstallTarget] = useState<RepoEntryView | null>(null)
  const [scopeTarget, setScopeTarget] = useState<RepoEntryView | null>(null)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [view, setView] = useState<RepoView>('market')
  const [reload, setReload] = useState(0)
  const [toast, setToast] = useState<{ text: string, ok: boolean, seq: number } | null>(null)

  useEffect(() => {
    let current = true
    void getRepoList({ ns }).then(
      (body) => {
        if (!current)
          return
        if ('error' in body) {
          setCatalog({ entries: [], generatedAt: null, restored: false })
          setToast({ text: failText(t, new Error(body.error)), ok: false, seq: Date.now() })
          return
        }
        setCatalog(body.catalog)
      },
      (failure: unknown) => {
        if (!current)
          return
        setCatalog({ entries: [], generatedAt: null, restored: false })
        setToast({ text: failText(t, failure), ok: false, seq: Date.now() })
      },
    )
    return () => {
      current = false
    }
  }, [ns, reload, t])

  const doInstall = async (): Promise<void> => {
    if (installTarget === null)
      return
    const entry = installTarget
    setBusy(true)
    try {
      const body = await postRepoInstall({
        ns,
        id: entry.id,
        ...(entry.scope === undefined || entry.scope.length === 0 ? {} : { scope: entry.scope }),
      })
      if ('error' in body)
        throw new Error(body.error)
      const applied = body.receipt.replaced ? t('repoUpdated') : t('repoInstalled')
      setToast({ text: ns === 'presets' ? `${applied}. ${t('repoRestartHint')}` : applied, ok: true, seq: Date.now() })
      setInstallTarget(null)
      setReload(value => value + 1)
    }
    catch (failure) {
      setToast({ text: failText(t, failure), ok: false, seq: Date.now() })
    }
    finally {
      setBusy(false)
    }
  }

  const doUninstall = async (): Promise<void> => {
    if (uninstallTarget === null)
      return
    const entry = uninstallTarget
    setBusy(true)
    try {
      const body = await postRepoUninstall({ ns, id: entry.id })
      if ('error' in body)
        throw new Error(body.error)
      const followed = body.receipt.followedBy
      setToast({
        text: followed.length === 0 ? t('repoUninstalled') : `${t('repoUninstalled')} · ${t('repoFollowedBy')}: ${followed.join(', ')}`,
        ok: true,
        seq: Date.now(),
      })
      setUninstallTarget(null)
      setReload(value => value + 1)
    }
    catch (failure) {
      setToast({ text: failText(t, failure), ok: false, seq: Date.now() })
    }
    finally {
      setBusy(false)
    }
  }

  const openDetail = async (entry: RepoEntryView): Promise<void> => {
    setBusy(true)
    try {
      const body = await getRepoDetail({ ns, id: entry.id })
      if ('error' in body)
        throw new Error(body.error)
      setDetail(body.detail)
    }
    catch (failure) {
      setToast({ text: failText(t, failure), ok: false, seq: Date.now() })
    }
    finally {
      setBusy(false)
    }
  }

  const needle = query.trim().toLowerCase()
  const matched = (catalog?.entries ?? []).filter(entry =>
    needle === ''
    || entry.id.toLowerCase().includes(needle)
    || entry.name.toLowerCase().includes(needle)
    || entry.description.toLowerCase().includes(needle)
    || entry.tags.some(tag => tag.toLowerCase().includes(needle)),
  )
  const installedCount = (catalog?.entries ?? []).filter(entry => entry.installedVersion !== null).length
  const shown = matched.filter(entry => view === 'market' || entry.installedVersion !== null)
  const detailEntry = detail === null ? null : (catalog?.entries ?? []).find(entry => entry.id === detail.id) ?? null

  const actionRow = (entry: RepoEntryView): ReactElement => (
    <div className="flex items-center gap-[6px] flex-wrap">
      <span className="flex-1" />
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => void openDetail(entry)}>{t('repoDetail')}</Button>
      {ns === 'tools' && entry.installedVersion !== null && <Button variant="ghost" size="sm" disabled={busy} onClick={() => setScopeTarget(entry)}>{t('repoScope')}</Button>}
      {entry.status === 'update-available' && <Button variant="primary" size="sm" disabled={busy} onClick={() => setInstallTarget(entry)}>{t('update')}</Button>}
      {entry.installedVersion === null && <Button variant="primary" size="sm" disabled={busy} onClick={() => setInstallTarget(entry)}>{t('install')}</Button>}
      {view === 'installed' && <Button variant="ghost" size="sm" disabled={busy} onClick={() => setUninstallTarget(entry)}>{t('uninstall')}</Button>}
    </div>
  )

  return (
    <div className="flex flex-col gap-[14px] text-primary">
      <div className="flex items-center gap-[10px] flex-wrap [&_h3]:m-0 [&_h3]:text-[16px] [&_h3]:leading-[24px] [&_h3]:font-medium">
        <span className="inline-flex items-center justify-center flex-none w-[22px] h-[22px]"><Icon as={ns === 'presets' ? Puzzle : TerminalLine} size={16} /></span>
        <h3>{nsLabel(t, ns)}</h3>
      </div>
      <Text tone="tertiary">{ns === 'presets' ? t('presetsIntro') : t('toolsIntro')}</Text>

      <div className="flex items-center gap-[7px] px-[2px] mt-[2px] [&_h3]:m-0 [&_h3]:text-[13px] [&_h3]:leading-[20px] [&_h3]:font-semibold">
        <h3>{nsLabel(t, ns)}</h3>
        {catalog !== null && (
          <span className="text-[12px] leading-[18px] text-tertiary tabular-nums">
            {shown.length}
            /
            {catalog.entries.length}
          </span>
        )}
        <span className="flex-1" />
        <Input className="w-[200px] max-[680px]:w-[140px]" type="search" placeholder={t('searchRepo')} aria-label={t('searchRepo')} value={query} onChange={event => setQuery(event.target.value)} />
        <Action variant="toolbar" icon={<Icon as={ArrowRotateRight} />} aria-label={t('refresh')} title={t('refresh')} disabled={busy} onClick={() => setReload(value => value + 1)} />
      </div>

      <div className="flex items-center gap-[6px] flex-wrap" role="group" aria-label={nsLabel(t, ns)}>
        <Pill active={view === 'market'} onClick={() => setView('market')}>
          {catalog === null ? marketLabel(t, ns) : `${marketLabel(t, ns)} ${catalog.entries.length}`}
        </Pill>
        <Pill active={view === 'installed'} onClick={() => setView('installed')}>
          {catalog === null ? t('repoInstalledSection') : `${t('repoInstalledSection')} ${installedCount}`}
        </Pill>
      </div>

      {catalog?.restored === true && <Text tone="tertiary">{t('repoRestored')}</Text>}
      {catalog === null && <Text size="sm" tone="tertiary">{t('loading')}</Text>}
      {catalog !== null && shown.length === 0 && (
        <Text size="sm" tone="tertiary">
          {view === 'installed'
            ? t('repoInstalledEmpty')
            : catalog.entries.length === 0 ? t('repoEmpty') : t('repoNoMatch')}
        </Text>
      )}

      {shown.length > 0 && (
        <Card.List className="grid grid-cols-[repeat(2,minmax(0,1fr))] items-stretch gap-[10px] max-[680px]:grid-cols-[minmax(0,1fr)]">
          {shown.map(entry => (
            <Card key={entry.id} className="mx-0 flex flex-col gap-[8px] px-[14px] py-[12px]">
              <div className="flex items-center gap-[6px] flex-wrap">
                <Card.Title className="flex-1 min-w-0 font-semibold [font-family:var(--ds-font-family-code)]" title={entry.id}>{entry.name}</Card.Title>
                {entry.status === 'update-available' && <Tag tone="info">{t('repoUpdateAvailable')}</Tag>}
                {entry.status === 'installed' && <Tag tone="quiet">{t('repoInstalledTag')}</Tag>}
                {entry.version !== null && <Tag variant="version">{entry.version}</Tag>}
                {entry.builtin === true && <Tag tone="quiet">{t('repoBuiltin')}</Tag>}
                {entry.category !== undefined && <Tag tone="neutral">{entry.category}</Tag>}
              </div>
              <Card.Description className="text-secondary line-clamp-2" title={entry.description}>{entry.description}</Card.Description>
              <div className="flex items-center gap-[6px] flex-wrap text-[12px] leading-[18px] text-tertiary">
                {entry.installedVersion !== null && <span className="tabular-nums">{`${t('repoInstalledVersion')}: ${entry.installedVersion}`}</span>}
                {entry.size !== null && <span className="tabular-nums">{fileSizeText(entry.size)}</span>}
                {entry.tags.map(tag => <Tag key={tag} tone="neutral">{tag}</Tag>)}
              </div>
              {ns === 'tools' && entry.scope !== undefined && entry.scope.length > 0 && <Text tone="tertiary">{`${t('repoMountedInto')}: ${entry.scope.join(', ')}`}</Text>}
              {warningTags(t, entry)}
              {actionRow(entry)}
            </Card>
          ))}
        </Card.List>
      )}

      <Modal
        open={detail !== null}
        onClose={() => setDetail(null)}
        closeLabel={t('close')}
        title={t('repoDetailTitle')}
        description={detail?.id}
        className="w-[min(760px,100%)]!"
        contentClassName="max-h-[calc(100vh-160px)]! overflow-y-auto"
      >
        {detail !== null && (
          <div className="flex flex-col gap-[10px]">
            {detail.cached && <Text tone="tertiary">{t('repoDetailCached')}</Text>}
            {detailEntry !== null && warningDetails(t, detailEntry)}
            {detailEntry !== null && (
              <Text tone="tertiary">{`${t('repoTarget')}: ${detailEntry.target}`}</Text>
            )}
            <div className="min-h-[240px] border border-border-l2 rounded-[8px] px-[12px] py-[8px] bg-layer-1 text-[13px]">
              <MarkdownPreview text={detail.markdown} />
            </div>
            <div className="flex items-center gap-[6px] flex-wrap">
              <span className="flex-1" />
              <Button variant="ghost" onClick={() => setDetail(null)}>{t('close')}</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={uninstallTarget !== null}
        onClose={() => setUninstallTarget(null)}
        closeLabel={t('close')}
        title={t('uninstallConfirm')}
        description={uninstallTarget?.id}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setUninstallTarget(null)}>{t('cancel')}</Button>
            <Button variant="primary" disabled={busy} onClick={() => void doUninstall()}>{t('uninstall')}</Button>
          </>
        )}
      >
        <p>{t('uninstallWarn')}</p>
      </Modal>

      <RepoInstallDialog t={t} ns={ns} entry={installTarget} busy={busy} onClose={() => setInstallTarget(null)} onConfirm={() => void doInstall()} />

      {scopeTarget !== null && (
        <RepoScopeModal
          t={t}
          entry={scopeTarget}
          onClose={() => setScopeTarget(null)}
          onSaved={() => {
            setScopeTarget(null)
            setToast({ text: t('repoScopeSaved'), ok: true, seq: Date.now() })
            setReload(value => value + 1)
          }}
        />
      )}

      {toast !== null && <Toast key={toast.seq} text={toast.text} icon={toast.ok ? undefined : <Icon as={Warning} />} onDone={() => setToast(null)} />}
    </div>
  )
}
