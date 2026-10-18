import type { ReactElement } from 'react'
import type { Translate } from '../locales/index.types'
import type { MarketFileView, MarketSkillDetailView, MarketSkillItemView, MarketSourcesView } from '../types'
import { Button, Card, Checkbox, fileSizeText, Input, Modal, Tag, Text } from 'dsh-tauri-ui/client'
import { useEffect, useState } from 'react'
import { getMarketDetail, getMarketFile, getMarketSearch, postMarketInstall } from '../apis'
import { MARKET_NOT_INSTALLABLE_LOCALE_KEYS, MARKET_SOURCE_LOCALE_KEYS, MARKET_SOURCE_STATUS_LOCALE_KEYS } from '../constants'
import { MarkdownPreview } from './markdown'

export interface SkillMarketViewProps {
  t: Translate
  onInstalled: (replaced: boolean, dirName: string) => void
}

export function SkillMarketView({ t, onInstalled }: SkillMarketViewProps): ReactElement {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<MarketSkillItemView[] | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [sources, setSources] = useState<MarketSourcesView | null>(null)
  const [detail, setDetail] = useState<MarketSkillDetailView | null>(null)
  const [preview, setPreview] = useState<MarketFileView | null>(null)
  const [confirm, setConfirm] = useState<{ id: string, name: string } | null>(null)
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void runSearch('', undefined)
  }, [])

  async function runSearch(text: string, next: string | undefined): Promise<void> {
    setBusy(true)
    setError(null)
    if (next === undefined)
      setItems(null)
    try {
      const body = await getMarketSearch({ q: text, ...(next === undefined ? {} : { cursor: next }) })
      if ('error' in body)
        throw new Error(body.error)
      const page = body.page
      setItems(current => next === undefined || current === null ? page.items : [...current, ...page.items])
      setCursor(page.nextCursor)
      setSources(page.sources)
    }
    catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
      if (next === undefined) {
        setItems([])
        setCursor(null)
      }
    }
    finally {
      setBusy(false)
    }
  }

  const openDetail = async (id: string): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const body = await getMarketDetail({ id })
      if ('error' in body)
        throw new Error(body.error)
      setDetail(body.detail)
    }
    catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
    finally {
      setBusy(false)
    }
  }

  const openFile = async (path: string): Promise<void> => {
    if (detail === null)
      return
    setBusy(true)
    setError(null)
    try {
      const body = await getMarketFile({ id: detail.id, path })
      if ('error' in body)
        throw new Error(body.error)
      setPreview(body.file)
    }
    catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
    finally {
      setBusy(false)
    }
  }

  const doInstall = async (): Promise<void> => {
    if (confirm === null)
      return
    setBusy(true)
    setError(null)
    try {
      const body = await postMarketInstall({ id: confirm.id })
      if ('error' in body)
        throw new Error(body.error)
      setConfirm(null)
      setDetail(null)
      setPreview(null)
      onInstalled(body.receipt.replaced, body.receipt.dirName)
      await runSearch(query, undefined)
    }
    catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
    finally {
      setBusy(false)
    }
  }

  const openConfirm = (id: string, name: string): void => {
    setAck(false)
    setError(null)
    setConfirm({ id, name })
  }

  const closeConfirm = (): void => {
    setConfirm(null)
    setError(null)
  }

  const backToResults = (): void => {
    setDetail(null)
    setPreview(null)
    setError(null)
  }

  const sourceText = (source: string): string => {
    const key = MARKET_SOURCE_LOCALE_KEYS[source]
    return key === undefined ? source : t(key)
  }

  const statusText = (status: string): string => {
    const key = MARKET_SOURCE_STATUS_LOCALE_KEYS[status]
    return key === undefined ? status : t(key)
  }

  const reasonText = (code: string): string => {
    const key = MARKET_NOT_INSTALLABLE_LOCALE_KEYS[code]
    return key === undefined ? code : t(key)
  }

  const results = (
    <div className="flex flex-col gap-[10px]">
      <div className="flex items-center gap-[6px] flex-wrap">
        <Input
          className="flex-1 min-w-[220px]"
          type="search"
          placeholder={t('skillMarketSearchPlaceholder')}
          aria-label={t('search')}
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter')
              void runSearch(query, undefined)
          }}
        />
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void runSearch(query, undefined)}>{t('search')}</Button>
      </div>
      {sources !== null && <Text tone="tertiary">{`${t('skillMarketSources')}: ${t('skillMarketSourceClawhub')} ${statusText(sources.clawhub)} / ${t('skillMarketSourceSkillhub')} ${statusText(sources.skillhub)}`}</Text>}
      {error !== null && <Text tone="error">{error}</Text>}
      {items === null && <Text size="sm" tone="tertiary">{t('loading')}</Text>}
      {items !== null && items.length === 0 && <Text size="sm" tone="tertiary">{t('skillMarketEmpty')}</Text>}
      {items !== null && items.length > 0 && (
        <Card.List className="grid grid-cols-[repeat(2,minmax(0,1fr))] items-stretch gap-[10px] max-[680px]:grid-cols-[minmax(0,1fr)]">
          {items.map(item => (
            <Card key={item.id} className="mx-0 flex flex-col gap-[8px] px-[14px] py-[12px]">
              <div className="flex items-center gap-[6px] flex-wrap">
                <Card.Title className="flex-1 min-w-0 font-semibold" title={item.name}>{item.name}</Card.Title>
                <Tag tone="info">{sourceText(item.source)}</Tag>
                {item.installState === 'installed' && <Tag tone="quiet">{t('skillMarketInstalledTag')}</Tag>}
              </div>
              <Card.Description className="text-secondary line-clamp-2" title={item.summary}>{item.summary}</Card.Description>
              <div className="flex items-center gap-[6px] flex-wrap text-[12px] leading-[18px] text-tertiary">
                <span>{item.author.displayName ?? item.author.handle}</span>
                <span className="tabular-nums">{`${t('skillMarketDownloads')} ${item.stats.downloads}`}</span>
                {item.version !== undefined && <Tag variant="version">{item.version}</Tag>}
              </div>
              {item.installState === 'not-installable' && (
                <Text tone="error">
                  {item.notInstallableReason === undefined
                    ? t('skillMarketNotInstallable')
                    : `${t('skillMarketNotInstallable')}: ${reasonText(item.notInstallableReason)}`}
                </Text>
              )}
              <div className="flex items-center gap-[6px] flex-wrap">
                <span className="flex-1" />
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => void openDetail(item.id)}>{t('repoDetail')}</Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={busy || item.installState === 'not-installable'}
                  onClick={() => openConfirm(item.id, item.name)}
                >
                  {item.installState === 'installed' ? t('update') : t('install')}
                </Button>
              </div>
            </Card>
          ))}
        </Card.List>
      )}
      <div className="flex items-center gap-[6px] flex-wrap">
        <span className="flex-1" />
        {cursor !== null && <Button variant="ghost" size="sm" disabled={busy} onClick={() => void runSearch(query, cursor)}>{t('skillMarketLoadMore')}</Button>}
      </div>
    </div>
  )

  const detailView = detail === null
    ? null
    : (
        <div className="flex flex-col gap-[10px]">
          <div className="flex items-center gap-[6px] flex-wrap">
            <Button variant="ghost" size="sm" onClick={backToResults}>{t('skillMarketBack')}</Button>
            <span className="flex-1" />
            <Button variant="primary" size="sm" disabled={busy || detail.notInstallableReason !== undefined} onClick={() => openConfirm(detail.id, detail.name)}>{t('install')}</Button>
          </div>
          <div className="flex items-center gap-[6px] flex-wrap">
            <h3 className="m-0 text-[15px] leading-[22px] font-medium">{detail.name}</h3>
            <Tag tone="info">{sourceText(detail.source)}</Tag>
            {detail.version !== undefined && <Tag variant="version">{detail.version}</Tag>}
            {detail.updateAvailable && <Tag tone="info">{t('skillMarketUpdateTag')}</Tag>}
            {detail.cached === true && <Tag tone="quiet">{t('skillMarketCachedTag')}</Tag>}
          </div>
          <Text tone="tertiary">{detail.summary}</Text>
          {detail.notInstallableReason !== undefined && <Text tone="error">{`${t('skillMarketNotInstallable')}: ${reasonText(detail.notInstallableReason)}`}</Text>}
          {detail.triggers.length > 0 && (
            <div className="flex items-center gap-[6px] flex-wrap">
              <span className="text-[12px] leading-[18px] text-tertiary">{t('skillMarketTriggers')}</span>
              {detail.triggers.map(trigger => <Tag key={trigger} tone="neutral">{trigger}</Tag>)}
            </div>
          )}
          {detail.capabilities.length > 0 && (
            <section className="flex flex-col gap-[8px]">
              <div className="text-[12px] leading-[18px] text-tertiary">{t('skillMarketCapabilities')}</div>
              <ul className="flex flex-col gap-[8px] m-0 p-0 list-none">
                {detail.capabilities.map(capability => (
                  <li className="flex flex-col gap-[4px] border border-border-l2 rounded-[8px] bg-layer-3 px-[12px] py-[8px]" key={capability.kind}>
                    <div className="flex items-center gap-[6px] flex-wrap">
                      <Tag tone={capability.severity === 'high' ? 'danger' : 'warning'}>{capability.label}</Tag>
                      <span className="text-[12px] leading-[18px] text-tertiary [font-family:var(--ds-font-family-code)]">{capability.kind}</span>
                    </div>
                    {capability.evidence.length > 0 && (
                      <ul className="flex flex-col gap-[2px] m-0 p-0 list-none text-[12px] leading-[18px] text-secondary [font-family:var(--ds-font-family-code)]">
                        {capability.evidence.map(line => <li className="break-all" key={line}>{line}</li>)}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="flex flex-col gap-[6px]">
            <div className="text-[12px] leading-[18px] text-tertiary">{t('skillMarketFiles')}</div>
            {detail.files.length === 0 && <Text size="sm" tone="tertiary">{t('skillMarketFileEmpty')}</Text>}
            {detail.files.length > 0 && (
              <ul className="flex flex-col gap-[2px] m-0 p-0 list-none max-h-[min(220px,32vh)] overflow-y-auto">
                {detail.files.map(file => (
                  <li className="flex items-center gap-[8px]" key={file.path}>
                    <Button variant="link" className="min-w-0 break-all [font-family:var(--ds-font-family-code)]" disabled={busy} onClick={() => void openFile(file.path)}>{file.path}</Button>
                    <span className="flex-none text-[12px] leading-[18px] text-tertiary tabular-nums">{fileSizeText(file.size)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="flex flex-col gap-[6px]">
            <div className="text-[12px] leading-[18px] text-tertiary">{t('skillMarketDescription')}</div>
            <div className="min-h-[200px] border border-border-l2 rounded-[8px] px-[12px] py-[8px] bg-layer-1 text-[13px]">
              <MarkdownPreview text={detail.description} />
            </div>
          </section>
          {error !== null && <Text tone="error">{error}</Text>}
        </div>
      )

  return (
    <div className="flex flex-col gap-[10px]">
      {results}

      <Modal
        open={detail !== null}
        onClose={backToResults}
        closeLabel={t('close')}
        title={t('skillMarketDetailTitle')}
        description={detail?.id}
        className="w-[min(860px,100%)]!"
        contentClassName="max-h-[calc(100vh-160px)]! overflow-y-auto"
      >
        {detailView}
      </Modal>

      <Modal
        open={preview !== null}
        onClose={() => setPreview(null)}
        closeLabel={t('close')}
        title={t('skillMarketPreviewTitle')}
        description={preview?.path}
        className="w-[min(760px,100%)]!"
        contentClassName="max-h-[calc(100vh-220px)]! overflow-y-auto"
      >
        {preview !== null && (
          <div className="flex flex-col gap-[8px]">
            {preview.truncated && <Text tone="tertiary">{t('skillMarketPreviewTruncated')}</Text>}
            <pre className="m-0 px-[12px] py-[10px] overflow-x-auto border border-border-l2 rounded-[8px] bg-layer-3 text-[12px] leading-[18px] whitespace-pre-wrap break-all [font-family:var(--ds-font-family-code)]">{preview.content}</pre>
          </div>
        )}
      </Modal>

      <Modal
        open={confirm !== null}
        onClose={closeConfirm}
        closeLabel={t('close')}
        title={t('skillMarketInstallTitle')}
        description={confirm?.name}
        className="w-[min(560px,100%)]!"
        footer={(
          <>
            <Button variant="ghost" onClick={closeConfirm}>{t('cancel')}</Button>
            <Button variant="primary" disabled={busy || !ack} onClick={() => void doInstall()}>{t('install')}</Button>
          </>
        )}
      >
        <div className="flex flex-col gap-[10px]">
          <Text tone="tertiary">{t('skillMarketInstallWarn')}</Text>
          <Checkbox checked={ack} disabled={busy} onChange={setAck}>{t('skillMarketAck')}</Checkbox>
          {error !== null && <Text tone="error">{error}</Text>}
        </div>
      </Modal>
    </div>
  )
}
