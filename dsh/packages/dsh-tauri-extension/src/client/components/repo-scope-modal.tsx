import type { ReactElement } from 'react'
import type { Translate } from '../locales/index.types'
import type { RepoEntryView } from '../types'
import { Button, Checkbox, Modal, Text } from 'dsh-tauri-ui/client'
import { useEffect, useState } from 'react'
import { getRepoList, postRepoScope } from '../apis'

export interface RepoScopeModalProps {
  t: Translate
  entry: RepoEntryView
  onClose: () => void
  onSaved: (scope: string[]) => void
}

export function RepoScopeModal({ t, entry, onClose, onSaved }: RepoScopeModalProps): ReactElement {
  const [presets, setPresets] = useState<string[] | null>(null)
  const [checked, setChecked] = useState<string[]>(entry.scope ?? [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    void getRepoList({ ns: 'presets' }).then(
      (body) => {
        if (!current)
          return
        if ('error' in body) {
          setPresets([])
          setError(body.error)
          return
        }
        setPresets(body.catalog.entries.map(item => item.id))
      },
      (failure: unknown) => {
        if (!current)
          return
        setPresets([])
        setError(failure instanceof Error ? failure.message : String(failure))
      },
    )
    return () => {
      current = false
    }
  }, [])

  const doSave = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const body = await postRepoScope({ toolId: entry.id, scope: checked })
      if ('error' in body)
        throw new Error(body.error)
      onSaved(body.receipt.scope)
    }
    catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
    finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      closeLabel={t('close')}
      title={t('repoScopeTitle')}
      description={entry.id}
      className="w-[min(680px,100%)]!"
      contentClassName="max-h-[calc(100vh-200px)]! overflow-y-auto"
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" disabled={busy || presets === null} onClick={() => void doSave()}>{t('save')}</Button>
        </>
      )}
    >
      <div className="flex flex-col gap-[10px]">
        <Text tone="tertiary">{t('repoScopeIntro')}</Text>
        {presets === null && <Text size="sm" tone="tertiary">{t('loading')}</Text>}
        {presets !== null && presets.length === 0 && <Text size="sm" tone="tertiary">{t('repoScopeEmpty')}</Text>}
        {presets !== null && presets.length > 0 && (
          <div className="flex flex-col gap-[6px] max-h-[min(320px,40vh)] overflow-y-auto py-[2px]">
            {presets.map(id => (
              <Checkbox
                key={id}
                checked={checked.includes(id)}
                disabled={busy}
                title={id}
                onChange={next => setChecked(current => next ? [...current, id] : current.filter(item => item !== id))}
              >
                <span className="[font-family:var(--ds-font-family-code)]">{id}</span>
              </Checkbox>
            ))}
          </div>
        )}
        {error !== null && <Text tone="error">{error}</Text>}
      </div>
    </Modal>
  )
}
