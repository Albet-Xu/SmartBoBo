import type { ReactElement } from 'react'
import type { Translate } from '../locales/index.types'
import type { RepoEntryView } from '../types'
import { Button, Modal, Text } from 'dsh-tauri-ui/client'

export interface RepoInstallDialogProps {
  t: Translate
  ns: 'presets' | 'tools'
  entry: RepoEntryView | null
  busy: boolean
  onClose: () => void
  onConfirm: () => void
}

export function RepoInstallDialog({ t, ns, entry, busy, onClose, onConfirm }: RepoInstallDialogProps): ReactElement {
  const requires = entry?.requires ?? []
  const unresolved = entry?.unresolved ?? []
  const rows = entry === null
    ? []
    : [
        { label: t('repoSource'), value: ns === 'presets' ? t('repoSourcePresets') : t('repoSourceTools') },
        { label: t('repoId'), value: entry.id },
        { label: t('repoMarketVersion'), value: entry.version ?? '—' },
        { label: t('repoTarget'), value: entry.target },
        ...(entry.scope === undefined || entry.scope.length === 0
          ? []
          : [{ label: t('repoMountedInto'), value: entry.scope.join(', ') }]),
      ]
  return (
    <Modal
      open={entry !== null}
      onClose={onClose}
      closeLabel={t('close')}
      title={t('repoInstallTitle')}
      description={entry?.id}
      className="w-[min(680px,100%)]!"
      contentClassName="max-h-[calc(100vh-200px)]! overflow-y-auto"
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" disabled={busy} onClick={onConfirm}>{busy ? t('repoInstalling') : t('install')}</Button>
        </>
      )}
    >
      <div className="flex flex-col gap-[10px]">
        <Text tone="tertiary">{t('repoInstallWarn')}</Text>
        <div className="flex flex-col gap-[6px] text-[12px] leading-[18px]">
          {rows.map(row => (
            <div className="flex items-start gap-[8px]" key={row.label}>
              <span className="flex-none w-[76px] text-tertiary">{row.label}</span>
              <span className="min-w-0 break-all text-secondary [font-family:var(--ds-font-family-code)]">{row.value}</span>
            </div>
          ))}
        </div>
        {requires.length > 0 && <Text tone="error">{`${t('repoRequires')}: ${requires.join(', ')}`}</Text>}
        {unresolved.length > 0 && <Text tone="error">{`${t('repoUnresolvedTitle')} ${unresolved.join(', ')} ${t('repoUnresolvedHint')}`}</Text>}
      </div>
    </Modal>
  )
}
